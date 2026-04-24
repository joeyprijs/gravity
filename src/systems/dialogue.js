import { gameState } from "../core/state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "../core/utils.js";
import { MAX_D20_ROLL, EL, CSS, LOG } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import { roll } from "./dice.js";

// DialogueSystem handles NPC conversations and the merchant buy/sell interface.
// Conversations are driven by a node graph defined in NPC JSON files. If an NPC
// has no conversations object, a minimal fallback UI is shown instead.
export class DialogueSystem {
  constructor(engine) {
    this.engine = engine;
    this.currentNPC = null;
    this.currentNPCId = null;
    this.storeOpen = false;
    this.activeDiscount = 0;

    // Re-render the store on any state change so gold and inventory stay in
    // sync — removing the need for UIManager to know the store exists.
    gameState.subscribe(() => {
      if (this.storeOpen) this.renderStore(true);
    });
  }

  startDialogue(npcId) {
    this.storeOpen = false;
    this.activeDiscount = 0;
    const npc = this.engine.data.npcs[npcId];
    if (!npc) { console.warn(`[Gravity] startDialogue: unknown NPC "${npcId}"`); return; }

    this.engine.resetScene();
    this.currentNPC = npc;
    this.currentNPCId = npcId;
    gameState.setFlag(`dialogue_dc_${npcId}`, {});
    if (npc.conversations) {
      this.renderDialogue("start");
    } else {
      this.renderDialogueFallback();
    }
  }

  // Runs an actions[] pipeline through the global action registry first, then
  // handles dialogue-specific action types (goToConversation, trade, leave,
  // makeFriendly, questTrigger) that only make sense within a conversation.
  _runActions(actions) {
    for (const action of (actions || [])) {
      const globalHandler = this.engine.getActionHandler(action.type);
      if (globalHandler) {
        globalHandler(action, this.engine);
        continue;
      }
      switch (action.type) {
        case 'goToConversation':
          this.renderDialogue(action.node);
          break;
        case 'trade': {
          const pct = typeof action.tradeDiscount === 'string'
            ? parseFloat(action.tradeDiscount)
            : (action.tradeDiscount || 0);
          this.activeDiscount = pct / 100;
          if (action.persistDiscount && pct > 0) {
            gameState.setFlag(`trade_discount_${this.currentNPCId}`, pct);
          }
          this.renderStore();
          break;
        }
        case 'leave':
          this.engine.renderScene(gameState.getCurrentSceneId());
          break;
        case 'makeFriendly':
          gameState.setFlag(`friendly_${this.currentNPCId}`, true);
          break;
        case 'questTrigger':
          this.engine.handleQuestTrigger(action);
          break;
        default:
          console.warn(`[Gravity] dialogue: unknown action type "${action.type}"`);
      }
    }
  }

  renderDialogue(nodeId = "start", overrideText = null, optionsOnly = false) {
    const node = this.currentNPC.conversations[nodeId];
    if (!node) { console.warn(`[Gravity] renderDialogue: unknown node "${nodeId}" on NPC "${this.currentNPC.name}"`); return; }

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

      this._runActions(node.actions || []);
    }

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    clearElement(container);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());
    if (reminder) {
      reminder.innerText = this.engine.t('ui.locationDialogue', { name: this.currentNPC.name });
      container.appendChild(reminder);
    }

    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    clearElement(skillsContainer);
    skillsContainer.setAttribute('hidden', '');

    const dcStateKey = `dialogue_dc_${this.currentNPCId}`;
    const dcState = gameState.getFlag(dcStateKey);
    const skillResponses = [];

    (node.responses || []).forEach((res, i) => {
      if (!evaluateCondition(res.condition ?? null, gameState)) return;

      const needsCheck = !!res.skillCheck && res.dc > 0;
      const resKey = `${res.skillCheck}_${nodeId}_${i}`;
      const dc = needsCheck ? (dcState[resKey] || res.dc) : 0;

      const badge = needsCheck ? this.engine.t(`actions.skillBadge.${res.skillCheck}`, { dc }) : null;
      const btn = buildOptionButton(res.text, badge);

      btn.onclick = () => {
        this.engine.log(LOG.PLAYER, res.text, 'choice');

        if (needsCheck) {
          const mod = gameState.getPlayer().attributes[res.skillCheck] || 0;
          const rolled = roll(1, MAX_D20_ROLL) + mod;
          const success = rolled >= dc;
          const logKey = success ? 'actions.skillSuccess' : 'actions.skillFail';
          this.engine.log(LOG.SYSTEM, this.engine.t(logKey, { roll: rolled, mod, dc, skill: res.skillCheck }), success ? 'loot' : 'system');
          if (!success) {
            dcState[resKey] = dc + (res.increment ?? 1);
            gameState.setFlag(dcStateKey, dcState);
            this.renderDialogue(nodeId, null, true);
            return;
          }
        }

        this._runActions(res.actions || []);
      };

      if (needsCheck) {
        skillResponses.push(btn);
      } else {
        container.appendChild(btn);
      }
    });

    if (skillResponses.length > 0) {
      const heading = createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.skillsHeading'));
      skillsContainer.appendChild(heading);
      skillResponses.forEach(btn => skillsContainer.appendChild(btn));
      skillsContainer.removeAttribute('hidden');
    }

    this.engine.scrollNarrativeToBottom();
  }

  renderDialogueFallback(overrideText = null) {
    const displayString = overrideText || this.engine.t('dialogue.greeting', { name: this.currentNPC.name });

    this.engine.openScene(CSS.SCENE_DIALOGUE);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
    );

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    clearElement(container);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());
    if (reminder) {
      reminder.innerText = this.engine.t('ui.locationDialogue', { name: this.currentNPC.name });
      container.appendChild(reminder);
    }

    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    clearElement(skillsContainer);
    skillsContainer.setAttribute('hidden', '');

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
      this.engine.renderScene(gameState.getCurrentSceneId());
    };
    container.appendChild(leaveBtn);
    this.engine.scrollNarrativeToBottom();
  }

  renderStore(isUpdate = false) {
    if (!isUpdate) {
      if (this.activeDiscount === 0) {
        const saved = gameState.getFlag(`trade_discount_${this.currentNPCId}`);
        if (saved) this.activeDiscount = saved / 100;
      }
      this.storeOpen = true;
      this.engine.openScene(CSS.SCENE_MERCHANT);
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(
          this.engine.t('dialogue.merchantWaresTitle', { name: this.currentNPC.name }),
          this.engine.t('dialogue.merchantGreeting', { name: this.currentNPC.name })
        )
      );
    }

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

    clearElement(container);
    clearElement(skillsContainer);
    skillsContainer.setAttribute('hidden', '');
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

    if (reminder) {
      reminder.innerText = this.engine.t('ui.locationMerchant', { name: this.currentNPC.name });
      container.appendChild(reminder);
    }

    // Never mind at top — always reachable without scrolling
    const neverMind = this.engine.t('dialogue.neverMind');
    const leaveBtn = buildOptionButton(neverMind);
    leaveBtn.onclick = () => {
      this.storeOpen = false;
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

    // Buy items
    const buyItems = (this.currentNPC.carriedItems || [])
      .map(entry => {
        const id = typeof entry === 'string' ? entry : entry.item;
        const stock = typeof entry === 'object' && entry !== null ? (entry.amount ?? null) : null;
        return { id, item: this.engine.data.items[id], stock, entry };
      })
      .filter(({ item, stock }) => item && stock !== 0);

    if (buyItems.length) {
      const buySection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
      buySection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('dialogue.buyGroup')));
      buyItems.forEach(({ id: itemId, item, stock, entry }) => {
        const displayName = stock !== null ? `${item.name} (x${stock})` : item.name;
        const price = this.activeDiscount > 0 ? Math.floor(item.value * (1 - this.activeDiscount)) : item.value;
        const btn = buildOptionButton(
          this.engine.t('dialogue.buyButton', { name: displayName }),
          this.engine.t('dialogue.buyPrice', { amount: price })
        );
        if (gameState.getPlayer().resources.gold < price) btn.disabled = true;
        btn.onclick = () => {
          if (stock !== null) entry.amount--;
          gameState.modifyPlayerStat('gold', -price);
          gameState.addToInventory(itemId, 1);
          this.engine.log(LOG.PLAYER, this.engine.t('dialogue.bought', { name: item.name, price }), 'loot');
          this.renderStore(true);
        };
        buySection.appendChild(btn);
      });
      panel.insertBefore(buySection, skillsContainer);
    }

    // Sell items
    const player = gameState.getPlayer();
    const sellRatio = this.engine.data.rules?.merchantSellRatio ?? 0.5;
    const sellItems = player.inventory.filter(invItem => {
      const item = this.engine.data.items[invItem.item];
      return item && item.value > 0 && Math.floor(item.value * sellRatio) > 0;
    });

    if (sellItems.length) {
      const sellSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
      sellSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('dialogue.sellGroup')));
      sellItems.forEach(invItem => {
        const item = this.engine.data.items[invItem.item];
        const sellValue = Math.floor(item.value * sellRatio);
        const btn = buildOptionButton(
          this.engine.t('dialogue.sellButton', { name: item.name, count: invItem.amount }),
          this.engine.t('dialogue.sellPrice', { amount: sellValue })
        );
        btn.onclick = () => {
          gameState.removeFromInventory(invItem.item, 1);
          gameState.modifyPlayerStat('gold', sellValue);
          this.engine.log(LOG.PLAYER, this.engine.t('dialogue.sold', { name: item.name, price: sellValue }), 'loot');
          this.renderStore(true);
        };
        sellSection.appendChild(btn);
      });
      panel.insertBefore(sellSection, skillsContainer);
    }

    this.engine.scrollNarrativeToBottom();
  }
}
