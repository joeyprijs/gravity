import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel } from "../core/utils.js";
import { ACTIONS, CHECK_KEYS, CSS, FLAG_KEYS, LOG } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import {
  runCheckAttempt, checkPresentation, normalizeOutcomes,
  getAttempts, isResolved,
  spendRetryCost
} from "./skill-checks.js";

// Actions that move the conversation to a new panel (node, store, or scene).
// _runActions reports these as "navigated" so callers skip re-rendering the
// current node's options on top of the new panel.
const DIALOGUE_NAV_ACTIONS = new Set([ACTIONS.GO_TO_CONVERSATION, ACTIONS.TRADE, ACTIONS.LEAVE]);

// DialogueSystem manages NPC conversation trees — branching nodes with
// skill-checked responses — and the merchant store (buy/sell). All
// conversation bookkeeping lives in state (checkState for attempt maps,
// flags for merchant stock and discounts), so it survives save/load.
export class DialogueSystem {
  constructor(engine) {
    this.engine = engine;
    this.currentNPC = null;
    this.currentNPCId = null;
    this.activeDiscount = 0;

    // Reactively refresh the store UI whenever a state change occurs
    // (e.g. buying/selling changes gold and inventory, which must update instantly).
    this.engine.state.subscribe(() => {
      if (this.engine.mode === 'store') this.renderStore(true);
    });

    this._registerActions();
  }

  // Clears the conversation data when the player leaves dialogue for a scene.
  // Called by engine.renderScene — the mode transition itself is the engine's.
  close() {
    this.currentNPC = null;
    this.currentNPCId = null;
  }

  // Registers the dialogue actions on the engine's global action registry so
  // conversation nodes and scene options share one extension mechanism. The
  // conversation-bound actions warn and no-op outside an active dialogue.
  _registerActions() {
    const requireNPC = (type, fn) => (action, engine) => {
      if (!this.currentNPC) {
        console.warn(`[Gravity] action "${type}" requires an active dialogue — ignored`);
        return;
      }
      fn(action, engine);
    };

    this.engine.registerAction(ACTIONS.GO_TO_CONVERSATION, requireNPC(ACTIONS.GO_TO_CONVERSATION, (action) => {
      this.renderDialogue(action.node);
    }));

    this.engine.registerAction(ACTIONS.TRADE, requireNPC(ACTIONS.TRADE, (action) => {
      const rawPct = typeof action.tradeDiscount === 'string'
        ? parseFloat(action.tradeDiscount)
        : (action.tradeDiscount ?? 0);
      // Guard against malformed discount data (e.g. "abc") that would make every
      // price NaN; an unparseable discount means no discount.
      const pct = Number.isFinite(rawPct) ? rawPct : 0;
      this.activeDiscount = pct / 100;

      // Optionally save this discount permanently in the session state.
      // Markups (negative values) persist too — an offended merchant's
      // grudge should outlast the conversation, same as earned goodwill.
      if (action.persistDiscount && pct !== 0) {
        this.engine.state.setFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId), pct);
      }
      this.renderStore();
    }));

    this.engine.registerAction(ACTIONS.LEAVE, (_action, engine) => {
      engine.renderScene(this.engine.state.getCurrentSceneId());
    });

    this.engine.registerAction(ACTIONS.MAKE_FRIENDLY, requireNPC(ACTIONS.MAKE_FRIENDLY, () => {
      this.engine.state.setFlag(FLAG_KEYS.friendly(this.currentNPCId), true);
    }));

    this.engine.registerAction(ACTIONS.QUEST_TRIGGER, (action, engine) => {
      engine.handleQuestTrigger(action);
    });
  }

  /**
   * Initiates a conversation branch with a specific NPC.
   *
   * @param {string} npcId - The NPC database identifier to talk to.
   */
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

    // Clear per-conversation check state (attempt counts, in-conversation
    // exhaustion) when starting fresh. Permanently resolved responses live in
    // a separate map (CHECK_KEYS.dialogueResolved) and survive this reset.
    this.engine.state.setCheckState(CHECK_KEYS.dialogueDc(npcId), {});

    if (npc.conversations) {
      this.renderDialogue("start");
    } else {
      this.renderDialogueFallback(); // Minimal default greetings for flavor-only NPCs
    }
  }

  // Runs a conversation node's action pipeline through the global action
  // registry. Returns true when navigation occurred — the dialogue closed,
  // a new node rendered, or the store opened — so callers skip re-rendering
  // the current node's options over the new panel.
  _runActions(actions) {
    let navigated = false;
    for (const action of (actions || [])) {
      const handler = this.engine.getActionHandler(action.type);
      if (!handler) {
        console.warn(`[Gravity] dialogue: unrecognized action node type "${action.type}"`);
        continue;
      }
      handler(action, this.engine);
      // Clearing currentNPC acts as the "left dialogue" signal (e.g. a navigate
      // action rendered a scene); the nav set covers in-dialogue panel changes.
      if (DIALOGUE_NAV_ACTIONS.has(action.type) || !this.currentNPC) navigated = true;
    }
    return navigated;
  }

  /**
   * Renders the conversation interface for a specific dialogue node.
   * Compiles player reply choices and checks dynamic skill check gates.
   *
   * @param {string} [nodeId="start"] - The node key inside the NPC's conversation tree.
   * @param {string|null} [overrideText=null] - Text override (e.g. store farewell
   *   lines). An override means the node is being re-shown, not entered, so its
   *   action pipeline is NOT re-run (a greeting gift must not be granted again
   *   every time the player backs out of the store).
   * @param {boolean} [optionsOnly=false] - If true, skips appending narrative text blocks.
   */
  renderDialogue(nodeId = "start", overrideText = null, optionsOnly = false) {
    const node = this.currentNPC.conversations[nodeId];
    if (!node) {
      console.warn(`[Gravity] renderDialogue: unknown conversation node "${nodeId}" on NPC "${this.currentNPC.name}"`);
      return;
    }

    if (!optionsOnly) {
      const displayString = overrideText || node.npcText;

      if (nodeId === "start") {
        this.engine.openScene(CSS.SCENE_DIALOGUE);
        this.engine.currentSceneEl.appendChild(
          buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
        );
      } else {
        this.engine.log(this.currentNPC.name, displayString);
      }

      if (!overrideText) this._runActions(node.actions || []);
    }

    const { container, skillsContainer } = resetOptionsPanel(
      this.engine.t('ui.locationDialogue', { name: this.currentNPC.name })
    );

    // ── Conversational Skill Checks ─────────────────────────────────────────
    // Attempt counts live in a per-conversation flag map (reset by
    // startDialogue); permanent resolution markers live in a separate flag
    // that survives across conversations and saves.
    const dcStateKey = CHECK_KEYS.dialogueDc(this.currentNPCId);
    const resolvedKey = CHECK_KEYS.dialogueResolved(this.currentNPCId);
    const skillResponses = [];

    (node.responses || []).forEach((res, i) => {
      if (!evaluateCondition(res.condition ?? null, this.engine.state)) return;

      const needsCheck = !!res.skillCheck && res.dc > 0;
      const resKey = `${res.skillCheck}_${nodeId}_${i}`;

      // A resolveOnce response stays retired across conversations; an
      // exhausted maxAttempts budget retires it for the rest of this
      // conversation only (patience resets on re-talk).
      if (needsCheck && (isResolved(this.engine.state, resolvedKey, resKey) || isResolved(this.engine.state, dcStateKey, resKey))) return;

      // Checked responses carry a retry badge; plain responses are free.
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

        // Dialogue is free by default; an explicit timeCost on a response
        // advances the clock (browsing a store never costs time). Checked
        // responses charge after the roll is narrated, so the passage of time
        // reads as a consequence of the attempt; plain responses charge up
        // front, before their pipeline can navigate away.
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
            // Re-render options-only when nothing navigated, so a resolveOnce
            // response retires from the panel instead of staying clickable.
            rerender: () => this.renderDialogue(nodeId, null, true),
          });
          return;
        }

        // Action routing for plain (check-free) responses. Read through
        // normalizeOutcomes so a response authored in the outcomes
        // shape keeps working if its check is later removed.
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

  /**
   * Renders a basic, parameterless fallback greeting screen for simple NPCs.
   *
   * @param {string|null} [overrideText=null] - Narrative text override.
   */
  renderDialogueFallback(overrideText = null) {
    const displayString = overrideText || this.engine.t('dialogue.greeting', { name: this.currentNPC.name });

    this.engine.openScene(CSS.SCENE_DIALOGUE);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
    );

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

  // The merchant's remaining stock for an item: the persisted flag when a
  // sale has happened, else the NPC-configured amount (null = unlimited).
  // Stock lives in flags so the static NPC file is never mutated.
  _getStock(itemId, npcAmount) {
    if (npcAmount === null) return null;
    const flagVal = this.engine.state.getFlag(FLAG_KEYS.merchantStock(this.currentNPCId, itemId));
    return flagVal !== false ? flagVal : npcAmount;
  }

  /**
   * Renders the interactive Merchant Shop UI, listing buy/sell items and dynamic prices.
   *
   * @param {boolean} [isUpdate=false] - If true, skips appending narrative text blocks.
   */
  renderStore(isUpdate = false) {
    if (!isUpdate) {
      // Pull saved discounts from previous conversation branches if active
      if (this.activeDiscount === 0) {
        const saved = this.engine.state.getFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId));
        if (saved) this.activeDiscount = saved / 100;
      }
      this.engine.setMode('store');
      this.engine.openScene(CSS.SCENE_MERCHANT);
      // An active discount or markup is stated with the greeting — repriced
      // wares the player can't recognize as repriced aren't a consequence.
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
          this.engine.t.bind(this.engine)
        )
      );
    }

    const { panel, container, skillsContainer } = resetOptionsPanel(
      this.engine.t('ui.locationMerchant', { name: this.currentNPC.name })
    );

    // Exit Button placed at the top for accessibility
    const neverMind = this.engine.t('dialogue.neverMind');
    const leaveBtn = buildOptionButton(neverMind);
    leaveBtn.onclick = () => {
      this.engine.setMode('dialogue');
      this.activeDiscount = 0;
      this.engine.log(LOG.PLAYER, neverMind, 'choice');

      const exitStr = this.currentNPC.storeExitText || this.engine.t('dialogue.comeAgain');
      if (this.currentNPC.conversations) {
        this.renderDialogue("start", exitStr);
      } else {
        this.renderDialogueFallback(exitStr);
      }
    };
    container.appendChild(leaveBtn);

    this._buildBuySection(panel, skillsContainer);
    this._buildSellSection(panel, skillsContainer);

    this.engine.scrollNarrativeToBottom();
  }

  // Builds the merchant "Buy" section: one button per in-stock carried item,
  // with discount-adjusted prices and stock bookkeeping in persistent flags.
  _buildBuySection(panel, skillsContainer) {
    // carriedItems entries are normalized to { item, amount } at load.
    const buyItems = (this.currentNPC.carriedItems || [])
      .map(({ item: id, amount: npcAmount }) => {
        const stock = this._getStock(id, npcAmount);
        return { id, item: this.engine.data.items[id], stock, npcAmount };
      })
      .filter(({ item, stock }) => item && stock !== 0);

    if (!buyItems.length) return;

    const buySection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    buySection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('dialogue.buyGroup')));

    buyItems.forEach(({ id: itemId, item, stock, npcAmount }) => {
      const displayName = stock !== null ? `${item.name} (x${stock})` : item.name;
      // A negative discount is a markup — an annoyed merchant padding prices.
      const price = this.activeDiscount !== 0 ? Math.floor(item.value * (1 - this.activeDiscount)) : item.value;
      const btn = buildOptionButton(
        this.engine.t('dialogue.buyButton', { name: displayName }),
        this.engine.t('dialogue.buyPrice', { amount: price })
      );

      if (this.engine.state.getPlayer().resources.gold < price) btn.disabled = true;

      // No explicit re-render: the store's state subscription re-renders on
      // the gold/inventory notifications these mutations emit.
      btn.onclick = () => {
        if (npcAmount !== null) {
          this.engine.state.setFlag(FLAG_KEYS.merchantStock(this.currentNPCId, itemId), stock - 1);
        }
        this.engine.state.modifyPlayerStat('gold', -price);
        this.engine.state.addToInventory(itemId, 1);
        this.engine.log(LOG.PLAYER, this.engine.t('dialogue.bought', { name: item.name, price }), 'loot');
      };
      buySection.appendChild(btn);
    });
    panel.insertBefore(buySection, skillsContainer);
  }

  // Builds the merchant "Sell" section: one button per sellable inventory
  // item, priced at floor(itemValue * rules.merchantSellRatio).
  _buildSellSection(panel, skillsContainer) {
    const player = this.engine.state.getPlayer();
    const sellRatio = this.engine.data.rules?.merchantSellRatio ?? 0.5;
    const sellItems = player.inventory.filter(invItem => {
      const item = this.engine.data.items[invItem.item];
      return item && item.value > 0 && Math.floor(item.value * sellRatio) > 0;
    });

    if (!sellItems.length) return;

    const sellSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    sellSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('dialogue.sellGroup')));

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
        this.engine.log(LOG.PLAYER, this.engine.t('dialogue.sold', { name: item.name, price: sellValue }), 'loot');
      };
      sellSection.appendChild(btn);
    });
    panel.insertBefore(sellSection, skillsContainer);
  }
}
