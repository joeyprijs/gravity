import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel } from "../core/utils.js";
import { CSS, FLAG_KEYS, LOG } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import { performSkillCheck, getEscalatedDc, escalateDc } from "./skill-checks.js";

/**
 * DialogueSystem manages NPC dialogue trees, branching conversations, 
 * skill checks, and merchant store interfaces (buy/sell loops).
 * 
 * Data Design:
 * - Dialogue branches are loaded as Node Graphs from NPC JSON files.
 * - All conversational state changes, merchant stocks, and DC escalations 
 *   are stored in persistent `gameState` flags to guarantee save safety.
 */
export class DialogueSystem {
  /**
   * Constructs the DialogueSystem.
   * Binds a listener to the state manager to auto-refresh store values.
   * 
   * @param {object} engine - The central RPGEngine coordination instance.
   */
  constructor(engine) {
    this.engine = engine;
    this.currentNPC = null;
    this.currentNPCId = null;
    this.storeOpen = false;
    this.activeDiscount = 0;

    // Reactively refresh the store UI whenever a state change occurs
    // (e.g. buying/selling changes gold and inventory, which must update instantly).
    gameState.subscribe(() => {
      if (this.storeOpen) this.renderStore(true);
    });
  }

  /**
   * Initiates a conversation branch with a specific NPC.
   * 
   * @param {string} npcId - The NPC database identifier to talk to.
   */
  startDialogue(npcId) {
    this.storeOpen = false;
    this.activeDiscount = 0;
    const npc = this.engine.data.npcs[npcId];
    
    if (!npc) { 
      console.warn(`[Gravity] startDialogue: unknown NPC ID "${npcId}"`); 
      return; 
    }

    this.engine.resetScene();
    this.currentNPC = npc;
    this.currentNPCId = npcId;
    
    // Clear dynamic DC escalation states for conversational rolls when starting fresh
    gameState.setFlag(FLAG_KEYS.dialogueDc(npcId), {});
    
    if (npc.conversations) {
      this.renderDialogue("start");
    } else {
      this.renderDialogueFallback(); // Minimal default greetings for flavor-only NPCs
    }
  }

  /**
   * Evaluates dialogue-specific actions inside a conversation node pipeline.
   * Unrecognized action types are forwarded to the global RPGEngine action registry.
   * 
   * @private
   * @param {object[]} actions - Array of actions to run.
   * @returns {boolean} True if navigation occurred (dialogue closed, new node, or trade opened).
   */
  _runActions(actions) {
    let navigated = false;
    for (const action of (actions || [])) {
      const globalHandler = this.engine.getActionHandler(action.type);
      
      // Handoff to global engine actions (e.g. loot, set_flag, navigate)
      if (globalHandler) {
        globalHandler(action, this.engine);
        // Clearing currentNPC acts as the "left dialogue" signal
        if (!this.currentNPC) navigated = true;
        continue;
      }
      
      // Dialogue-specific local actions
      switch (action.type) {
        case 'goToConversation':
          this.renderDialogue(action.node);
          navigated = true;
          break;
          
        case 'trade': {
          const pct = typeof action.tradeDiscount === 'string'
            ? parseFloat(action.tradeDiscount)
            : (action.tradeDiscount || 0);
          this.activeDiscount = pct / 100;
          
          // Optionally save this discount permanently in the session state
          if (action.persistDiscount && pct > 0) {
            gameState.setFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId), pct);
          }
          this.renderStore();
          navigated = true;
          break;
        }
        
        case 'leave':
          this.engine.renderScene(gameState.getCurrentSceneId());
          navigated = true;
          break;
          
        case 'makeFriendly':
          gameState.setFlag(FLAG_KEYS.friendly(this.currentNPCId), true);
          break;
          
        case 'questTrigger':
          this.engine.handleQuestTrigger(action);
          break;
          
        default:
          console.warn(`[Gravity] dialogue: unrecognized action node type "${action.type}"`);
      }
    }
    return navigated;
  }

  /**
   * Renders the conversation interface for a specific dialogue node.
   * Compiles player reply choices and checks dynamic skill check gates.
   * 
   * @param {string} [nodeId="start"] - The node key inside the NPC's conversation tree.
   * @param {string|null} [overrideText=null] - Text override (e.g. store farewell lines).
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

      this._runActions(node.actions || []);
    }

    const { container, skillsContainer } = resetOptionsPanel(
      this.engine.t('ui.locationDialogue', { name: this.currentNPC.name })
    );

    // ── Conversational Skill Checks ─────────────────────────────────────────
    // Reads escalated DCs from persistent flags to keep saves robust.
    const dcStateKey = FLAG_KEYS.dialogueDc(this.currentNPCId);
    const skillResponses = [];

    (node.responses || []).forEach((res, i) => {
      // Hide options whose condition requirements are not met
      if (!evaluateCondition(res.condition ?? null, gameState)) return;

      const needsCheck = !!res.skillCheck && res.dc > 0;
      const resKey = `${res.skillCheck}_${nodeId}_${i}`;
      const dc = needsCheck ? getEscalatedDc(dcStateKey, resKey, res.dc) : 0;

      const badge = needsCheck ? this.engine.t(`actions.skillBadge.${res.skillCheck}`, { dc }) : null;
      const btn = buildOptionButton(res.text, badge);

      btn.onclick = () => {
        this.engine.log(LOG.PLAYER, res.text, 'choice');

        if (needsCheck) {
          const { success } = performSkillCheck(this.engine, res.skillCheck, dc);

          if (!success) {
            // Conversational DC Escalation: Failed attempts raise the difficulty
            // by a custom increment so that repeat trials are increasingly challenging.
            escalateDc(dcStateKey, resKey, dc, res.increment ?? 1);

            // Execute failure actions pipeline if registered
            const failNavigated = res.onFailure?.length ? this._runActions(res.onFailure) : false;
            if (!failNavigated) this.renderDialogue(nodeId, null, true);
            return;
          }
        }

        // Action routing on success
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
      this.engine.renderScene(gameState.getCurrentSceneId());
    };
    container.appendChild(leaveBtn);
    
    this.engine.scrollNarrativeToBottom();
  }

  /**
   * Retrieves an item's current stock count from a merchant.
   * Reads from persistent session flags to avoid mutating static files.
   * 
   * @private
   * @param {string} itemId - The item identifier.
   * @param {number|null} npcAmount - Stock count configured in NPC file (null = unlimited).
   * @returns {number|null} Current stock count remaining, or null for unlimited.
   */
  _getStock(itemId, npcAmount) {
    if (npcAmount === null) return null;
    const flagVal = gameState.getFlag(FLAG_KEYS.merchantStock(this.currentNPCId, itemId));
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
        const saved = gameState.getFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId));
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

    const { panel, container, skillsContainer } = resetOptionsPanel(
      this.engine.t('ui.locationMerchant', { name: this.currentNPC.name })
    );

    // Exit Button placed at the top for accessibility
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

    // ── 1. Buy Panel ────────────────────────────────────────────────────────
    const buyItems = (this.currentNPC.carriedItems || [])
      .map(entry => {
        const id = typeof entry === 'string' ? entry : entry.item;
        const npcAmount = typeof entry === 'object' && entry !== null ? (entry.amount ?? null) : null;
        const stock = this._getStock(id, npcAmount);
        return { id, item: this.engine.data.items[id], stock, npcAmount };
      })
      .filter(({ item, stock }) => item && stock !== 0);

    if (buyItems.length) {
      const buySection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
      buySection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('dialogue.buyGroup')));
      
      buyItems.forEach(({ id: itemId, item, stock, npcAmount }) => {
        const displayName = stock !== null ? `${item.name} (x${stock})` : item.name;
        // Compute custom discount: Math.floor(Value * (1 - Discount))
        const price = this.activeDiscount > 0 ? Math.floor(item.value * (1 - this.activeDiscount)) : item.value;
        const btn = buildOptionButton(
          this.engine.t('dialogue.buyButton', { name: displayName }),
          this.engine.t('dialogue.buyPrice', { amount: price })
        );
        
        if (gameState.getPlayer().resources.gold < price) btn.disabled = true;
        
        btn.onclick = () => {
          if (npcAmount !== null) {
            gameState.setFlag(FLAG_KEYS.merchantStock(this.currentNPCId, itemId), stock - 1);
          }
          gameState.modifyPlayerStat('gold', -price);
          gameState.addToInventory(itemId, 1);
          this.engine.log(LOG.PLAYER, this.engine.t('dialogue.bought', { name: item.name, price }), 'loot');
          this.renderStore(true);
        };
        buySection.appendChild(btn);
      });
      panel.insertBefore(buySection, skillsContainer);
    }

    // ── 2. Sell Panel ───────────────────────────────────────────────────────
    // Sell value = floor(ItemValue * merchantSellRatio)
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
