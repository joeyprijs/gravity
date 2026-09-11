import { buildPanelSection, buildSceneDescription, buildOptionButton, createElement, isSpecialItem, resetOptionsPanel } from '../core/utils.js';
import { CHECK_KEYS, CSS, FLAG_KEYS, LOG } from '../core/config.js';
import { evaluateCondition } from './condition.js';
import {
  runCheckAttempt, checkPresentation, normalizeOutcomes,
  getAttempts, isResolved,
  spendRetryCost
} from './skill-checks.js';

// Actions that move the conversation to a new panel; _runActions reports
// them as navigation.
const DIALOGUE_NAV_ACTIONS = new Set(['goToConversation', 'trade', 'leave']);

// Conversation trees with skill-checked responses, and the merchant store.
// All bookkeeping lives in state, so it survives a save.
export class DialogueSystem {
  constructor(engine) {
    this.engine = engine;
    this.currentNPC = null;
    this.currentNPCId = null;
    this.activeDiscount = 0;

    // Buying and selling change gold and inventory; the store follows.
    this.engine.state.subscribe(() => {
      if (this.engine.mode === 'store') this.renderStore(true);
    });

    this._registerActions();
  }

  // Called by engine.renderScene; the mode transition is the engine's.
  close() {
    this.currentNPC = null;
    this.currentNPCId = null;
  }

  // The conversation-bound actions warn and no-op outside a dialogue.
  _registerActions() {
    const requireNPC = (type, fn) => (action, engine) => {
      if (!this.currentNPC) {
        console.warn(`[Gravity] action "${type}" requires an active dialogue — ignored`);
        return;
      }
      fn(action, engine);
    };

    this.engine.registerAction('goToConversation', requireNPC('goToConversation', (action) => {
      this.renderDialogue(action.node);
    }));

    this.engine.registerAction('trade', requireNPC('trade', (action) => {
      const rawPct = typeof action.tradeDiscount === 'string'
        ? parseFloat(action.tradeDiscount)
        : (action.tradeDiscount ?? 0);
      // An unparseable discount is no discount, not NaN prices.
      const pct = Number.isFinite(rawPct) ? rawPct : 0;
      this.activeDiscount = pct / 100;

      // Markups persist too: a grudge outlasts the conversation like goodwill.
      if (action.persistDiscount && pct !== 0) {
        this.engine.state.setFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId), pct);
      }
      this.renderStore();
    }));

    this.engine.registerAction('leave', (_action, engine) => {
      engine.renderScene(this.engine.state.getCurrentSceneId());
    });

    this.engine.registerAction('questTrigger', (action, engine) => {
      engine.handleQuestTrigger(action);
    });
  }

  startDialogue(npcId) {
    this.activeDiscount = 0;
    const npc = this.engine.data.npcs[npcId];

    if (!npc) {
      console.warn(`[Gravity] startDialogue: unknown NPC ID "${npcId}"`);
      return;
    }

    this.engine.resetScene();
    this.engine.setMode('dialogue');
    this.currentNPC = npc;
    this.currentNPCId = npcId;

    // Attempt counts reset per conversation; resolved responses live in a
    // separate map and survive.
    this.engine.state.setCheckState(CHECK_KEYS.dialogueDc(npcId), {});

    if (npc.conversations) {
      this.renderDialogue('start');
    } else {
      this.renderDialogueFallback(); // Minimal default greetings for flavor-only NPCs
    }
  }

  // True when a pipeline navigated: closed the dialogue, changed node, or
  // opened the store.
  _runActions(actions) {
    let navigated = false;
    for (const action of (actions || [])) {
      const handler = this.engine.getActionHandler(action.type);
      if (!handler) {
        console.warn(`[Gravity] dialogue: unrecognized action node type "${action.type}"`);
        continue;
      }
      handler(action, this.engine);
      // A cleared currentNPC means a scene was rendered.
      if (DIALOGUE_NAV_ACTIONS.has(action.type) || !this.currentNPC) navigated = true;
    }
    return navigated;
  }

  // overrideText re-shows the node without re-running its actions (a greeting
  // gift must not repeat on every store exit); optionsOnly skips the text.
  renderDialogue(nodeId = 'start', overrideText = null, optionsOnly = false) {
    const node = this.currentNPC.conversations[nodeId];
    if (!node) {
      console.warn(`[Gravity] renderDialogue: unknown conversation node "${nodeId}" on NPC "${this.currentNPC.name}"`);
      return;
    }

    if (!optionsOnly) {
      const displayString = overrideText || node.npcText;

      if (nodeId === 'start') {
        this._openDialogueScene(displayString);
      } else {
        this.engine.log(this.currentNPC.name, displayString);
      }

      if (!overrideText) this._runActions(node.actions || []);
    }

    const { container, skillsContainer } = resetOptionsPanel(
      this.engine.t('ui.locationDialogue', { name: this.currentNPC.name })
    );

    // Conversational skill checks
    const dcStateKey = CHECK_KEYS.dialogueDc(this.currentNPCId);
    const resolvedKey = CHECK_KEYS.dialogueResolved(this.currentNPCId);
    const skillResponses = [];

    (node.responses || []).forEach((res, i) => {
      if (!evaluateCondition(res.condition, this.engine.state)) return;

      const needsCheck = !!res.skillCheck && res.dc > 0;
      const resKey = `${res.skillCheck}_${nodeId}_${i}`;

      // resolveOnce retires across conversations; exhaustion only until re-talk.
      if (needsCheck && (isResolved(this.engine.state, resolvedKey, resKey) || isResolved(this.engine.state, dcStateKey, resKey))) return;

      let p;
      if (needsCheck) {
        p = checkPresentation(this.engine, res, getAttempts(this.engine.state, dcStateKey, resKey));
      } else {
        p = { gate: { cost: 0, blocked: false }, displayText: res.text, badge: null, blocked: false };
      }
      const btn = buildOptionButton(p.displayText, p.badge);
      if (p.blocked) btn.disabled = true;

      btn.onclick = () => {
        this.engine.log(LOG.PLAYER, p.displayText, 'choice');

        // Dialogue is free unless a response carries a timeCost.
        if (needsCheck) {
          spendRetryCost(this.engine, p.gate);
          let navigated = false;
          runCheckAttempt(this.engine, res, {
            attemptKey: dcStateKey,
            resolvedKey,
            entryKey: resKey,
            runActions: (actions) => { navigated = this._runActions(actions) || navigated; },
            didNavigate: () => navigated,
            chargeTime: () => { if (res.timeCost > 0) this.engine.advanceTime(res.timeCost); },
            // So a resolveOnce response retires from the panel.
            rerender: () => this.renderDialogue(nodeId, null, true),
          });
          return;
        }

        // Through normalizeOutcomes, so the outcomes shape keeps working
        // when a check is removed.
        if (res.timeCost > 0) this.engine.advanceTime(res.timeCost);
        this._runActions(normalizeOutcomes(res).success.actions);
      };

      if (needsCheck) {
        skillResponses.push(btn);
      } else {
        container.appendChild(btn);
      }
    });

    if (skillResponses.length > 0) {
      const heading = createElement('div', CSS.SECTION_HEADING, this.engine.t('ui.skillsHeading'));
      skillsContainer.appendChild(heading);
      skillResponses.forEach(btn => skillsContainer.appendChild(btn));
      skillsContainer.removeAttribute('hidden');
    }

    this.engine.scrollNarrativeToBottom();
  }

  _openDialogueScene(text) {
    this.engine.openScene(CSS.SCENE_DIALOGUE);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${text}`)
    );
  }

  // For an NPC with no conversation tree.
  renderDialogueFallback(overrideText = null) {
    this._openDialogueScene(overrideText || this.engine.t('dialogue.greeting', { name: this.currentNPC.name }));

    const { container } = resetOptionsPanel(
      this.engine.t('ui.locationDialogue', { name: this.currentNPC.name })
    );

    if (this.currentNPC.isMerchant) {
      const tradeBtn = buildOptionButton(this.engine.t('dialogue.trade'));
      tradeBtn.onclick = () => {
        this.engine.log(LOG.PLAYER, this.engine.t('dialogue.trade'), 'choice');
        this.renderStore();
      };
      container.appendChild(tradeBtn);
    }

    const leaveBtn = buildOptionButton(this.engine.t('dialogue.leave'));
    leaveBtn.onclick = () => {
      this.engine.renderScene(this.engine.state.getCurrentSceneId());
    };
    container.appendChild(leaveBtn);

    this.engine.scrollNarrativeToBottom();
  }

  // The persisted flag once a sale happened, else the authored amount (null:
  // unlimited). In flags, so the NPC data is never mutated.
  _getStock(itemId, npcAmount) {
    if (npcAmount === null) return null;
    const flagVal = this.engine.state.getFlag(FLAG_KEYS.merchantStock(this.currentNPCId, itemId));
    return flagVal !== false ? flagVal : npcAmount;
  }

  // isUpdate skips the narrative block.
  renderStore(isUpdate = false) {
    if (!isUpdate) {
      if (this.activeDiscount === 0) {
        const saved = this.engine.state.getFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId));
        if (saved) this.activeDiscount = saved / 100;
      }
      this.engine.setMode('store');
      this.engine.openScene(CSS.SCENE_MERCHANT);
      // A discount the player cannot see is not a consequence.
      let greeting = this.engine.t('dialogue.merchantGreeting', { name: this.currentNPC.name });
      if (this.activeDiscount !== 0) {
        const pct = Math.round(Math.abs(this.activeDiscount * 100));
        greeting += ' ' + this.engine.t(
          this.activeDiscount < 0 ? 'dialogue.pricesMarkedUp' : 'dialogue.pricesDiscounted',
          { pct }
        );
      }
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(
          this.engine.t('dialogue.merchantWaresTitle', { name: this.currentNPC.name }),
          greeting,
          this.engine.t
        )
      );
    }

    const { panel, container, skillsContainer } = resetOptionsPanel(
      this.engine.t('ui.locationMerchant', { name: this.currentNPC.name })
    );

    const neverMind = this.engine.t('dialogue.neverMind');
    const leaveBtn = buildOptionButton(neverMind);
    leaveBtn.onclick = () => {
      this.engine.setMode('dialogue');
      this.activeDiscount = 0;
      this.engine.log(LOG.PLAYER, neverMind, 'choice');

      const exitStr = this.currentNPC.storeExitText || this.engine.t('dialogue.comeAgain');
      if (this.currentNPC.conversations) {
        this.renderDialogue('start', exitStr);
      } else {
        this.renderDialogueFallback(exitStr);
      }
    };
    container.appendChild(leaveBtn);

    this._buildBuySection(panel, skillsContainer);
    this._buildSellSection(panel, skillsContainer);

    this.engine.scrollNarrativeToBottom();
  }

  _buildBuySection(panel, skillsContainer) {
    const buyItems = (this.currentNPC.carriedItems || [])
      .map(({ item: id, amount: npcAmount }) => {
        const stock = this._getStock(id, npcAmount);
        return { id, item: this.engine.data.items[id], stock, npcAmount };
      })
      .filter(({ item, stock }) => item && stock !== 0);

    if (!buyItems.length) return;

    const buySection = buildPanelSection(this.engine.t('dialogue.buyGroup'));

    buyItems.forEach(({ id: itemId, item, stock, npcAmount }) => {
      const displayName = stock !== null ? `${item.name} (x${stock})` : item.name;
      // A negative discount is a markup.
      const price = this.activeDiscount !== 0 ? Math.floor(item.value * (1 - this.activeDiscount)) : item.value;
      const btn = buildOptionButton(
        this.engine.t('dialogue.buyButton', { name: displayName }),
        this.engine.t('dialogue.buyPrice', { amount: price })
      );

      if (this.engine.state.getPlayer().resources.gold < price) btn.disabled = true;

      // The store's subscription re-renders on the notifications.
      btn.onclick = () => {
        if (npcAmount !== null) {
          this.engine.state.setFlag(FLAG_KEYS.merchantStock(this.currentNPCId, itemId), stock - 1);
        }
        this.engine.state.modifyPlayerStat('gold', -price);
        this.engine.state.addToInventory(itemId, 1);
        // Narrated: a transaction, like lifting a relic out of a case.
        this.engine.log(LOG.SYSTEM, this.engine.t('dialogue.bought', { name: item.name, price }), 'loot');
      };
      buySection.appendChild(btn);
    });
    panel.insertBefore(buySection, skillsContainer);
  }

  // Priced at floor(value * rules.merchantSellRatio).
  _buildSellSection(panel, skillsContainer) {
    const player = this.engine.state.getPlayer();
    const sellRatio = this.engine.data.rules?.merchantSellRatio ?? 0.5;
    const sellItems = player.inventory.filter(invItem => {
      const item = this.engine.data.items[invItem.item];
      if (isSpecialItem(item)) return false;
      return item && item.value > 0 && Math.floor(item.value * sellRatio) > 0;
    });

    if (!sellItems.length) return;

    const sellSection = buildPanelSection(this.engine.t('dialogue.sellGroup'));

    sellItems.forEach(invItem => {
      const item = this.engine.data.items[invItem.item];
      const sellValue = Math.floor(item.value * sellRatio);
      const btn = buildOptionButton(
        this.engine.t('dialogue.sellButton', { name: item.name, count: invItem.amount }),
        this.engine.t('dialogue.sellPrice', { amount: sellValue })
      );

      btn.onclick = () => {
        this.engine.state.removeFromInventory(invItem.item, 1);
        this.engine.state.modifyPlayerStat('gold', sellValue);
        this.engine.log(LOG.SYSTEM, this.engine.t('dialogue.sold', { name: item.name, price: sellValue }), 'loot');
      };
      sellSection.appendChild(btn);
    });
    panel.insertBefore(sellSection, skillsContainer);
  }
}
