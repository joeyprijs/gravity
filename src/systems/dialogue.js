import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel } from "../core/utils.js";
import { ACTIONS, CSS, FLAG_KEYS, LOG } from "../core/config.js";
import { evaluateCondition } from "./condition.js";
import {
  performSkillCheck, normalizeOutcomes, resolveRetryText,
  getAttempts, recordAttempt, isResolved, markResolved,
  skillBadge, retryGate, applyRetryGate, spendRetryCost,
  skillApCost, apGate, applyApGate, spendAp
} from "./skill-checks.js";

// Actions that move the conversation to a new panel (node, store, or scene).
// _runActions reports these as "navigated" so callers skip re-rendering the
// current node's options on top of the new panel.
const DIALOGUE_NAV_ACTIONS = new Set([ACTIONS.GO_TO_CONVERSATION, ACTIONS.TRADE, ACTIONS.LEAVE]);

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

    this._registerActions();
  }

  /**
   * Registers the dialogue actions on the engine's global action registry so
   * conversation nodes and scene options share one extension mechanism.
   * The conversation-bound actions warn and no-op outside an active dialogue.
   *
   * @private
   */
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
        gameState.setFlag(FLAG_KEYS.tradeDiscount(this.currentNPCId), pct);
      }
      this.renderStore();
    }));

    this.engine.registerAction(ACTIONS.LEAVE, (_action, engine) => {
      engine.renderScene(gameState.getCurrentSceneId());
    });

    this.engine.registerAction(ACTIONS.MAKE_FRIENDLY, requireNPC(ACTIONS.MAKE_FRIENDLY, () => {
      gameState.setFlag(FLAG_KEYS.friendly(this.currentNPCId), true);
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

    // Clear per-conversation check state (attempt counts, in-conversation
    // exhaustion) when starting fresh. Permanently resolved responses live in
    // a separate flag (FLAG_KEYS.dialogueResolved) and survive this reset.
    gameState.setFlag(FLAG_KEYS.dialogueDc(npcId), {});
    
    if (npc.conversations) {
      this.renderDialogue("start");
    } else {
      this.renderDialogueFallback(); // Minimal default greetings for flavor-only NPCs
    }
  }

  /**
   * Runs a conversation node's action pipeline through the global action
   * registry (dialogue actions are registered there too — see _registerActions).
   *
   * @private
   * @param {object[]} actions - Array of actions to run.
   * @returns {boolean} True if navigation occurred (dialogue closed, new node, or trade opened).
   */
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
    const dcStateKey = FLAG_KEYS.dialogueDc(this.currentNPCId);
    const resolvedKey = FLAG_KEYS.dialogueResolved(this.currentNPCId);
    const skillResponses = [];

    (node.responses || []).forEach((res, i) => {
      // Hide options whose condition requirements are not met
      if (!evaluateCondition(res.condition ?? null, gameState)) return;

      const needsCheck = !!res.skillCheck && res.dc > 0;
      const resKey = `${res.skillCheck}_${nodeId}_${i}`;

      // A resolveOnce response stays retired across conversations; an
      // exhausted maxAttempts budget retires it for the rest of this
      // conversation only (patience resets on re-talk).
      if (needsCheck && (isResolved(resolvedKey, resKey) || isResolved(dcStateKey, resKey))) return;

      const attempts = needsCheck ? getAttempts(dcStateKey, resKey) : 0;
      const gate = needsCheck ? retryGate(this.engine, attempts) : { cost: 0, blocked: false };
      // Checked responses charge apCost ?? rules default; plain responses stay
      // free unless they set an explicit apCost (like scene narrative beats).
      const ap = apGate(this.engine, needsCheck ? skillApCost(this.engine, res) : (res.apCost ?? 0));
      const displayText = needsCheck ? resolveRetryText(res, attempts) : res.text;
      const badge = needsCheck
        ? applyRetryGate(this.engine, gate, applyApGate(this.engine, ap, skillBadge(this.engine, res.skillCheck, res.dc)))
        : applyApGate(this.engine, ap, null);
      const btn = buildOptionButton(displayText, badge);
      if (gate.blocked || ap.blocked) btn.disabled = true;

      btn.onclick = () => {
        this.engine.log(LOG.PLAYER, displayText, 'choice');

        // Dialogue is free by default; an explicit timeCost on a response
        // advances the clock (browsing a store never costs time). Checked
        // responses charge after the roll is narrated, so the passage of time
        // reads as a consequence of the attempt; plain responses charge up
        // front, before their pipeline can navigate away.
        if (needsCheck) {
          spendRetryCost(this.engine, gate);
          spendAp(ap);
          const outcomes = normalizeOutcomes(res);
          const { tier, success } = performSkillCheck(this.engine, res.skillCheck, res.dc, outcomes, attempts);
          if (res.timeCost > 0) this.engine.advanceTime(res.timeCost);
          if (res.resolveOnce) markResolved(resolvedKey, resKey);

          if (!success) {
            // Partial and failure tiers both count as an attempt; partial is
            // fail-forward, so its pipeline still runs.
            const attemptCount = recordAttempt(dcStateKey, resKey);
            const tierActions = outcomes[tier].actions;
            const failNavigated = tierActions.length ? this._runActions(tierActions) : false;
            let exhaustNavigated = false;
            if (!res.resolveOnce && res.maxAttempts && attemptCount >= res.maxAttempts) {
              markResolved(dcStateKey, resKey);
              if (res.onExhausted?.length) exhaustNavigated = this._runActions(res.onExhausted);
            }
            if (!failNavigated && !exhaustNavigated) this.renderDialogue(nodeId, null, true);
            return;
          }

          // Success / critical tier routing. Re-render when the pipeline
          // didn't navigate (like the failure branch above), so a resolveOnce
          // response retires from the panel instead of staying clickable.
          const tierActions = outcomes[tier].actions;
          const navigated = tierActions.length ? this._runActions(tierActions) : false;
          if (!navigated) this.renderDialogue(nodeId, null, true);
          return;
        }

        // Action routing for plain (check-free) responses. Read through
        // normalizeOutcomes so a response authored in the outcomes
        // shape keeps working if its check is later removed.
        spendAp(ap);
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

    this._buildBuySection(panel, skillsContainer);
    this._buildSellSection(panel, skillsContainer);

    this.engine.scrollNarrativeToBottom();
  }

  /**
   * Builds the merchant "Buy" section: one button per in-stock carried item,
   * with discount-adjusted prices and stock bookkeeping in persistent flags.
   *
   * @private
   * @param {HTMLElement} panel - The scene options panel.
   * @param {HTMLElement} skillsContainer - Insertion anchor for option sections.
   */
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
      // Compute custom discount: Math.floor(Value * (1 - Discount)).
      // A negative discount is a markup — an annoyed merchant padding prices.
      const price = this.activeDiscount !== 0 ? Math.floor(item.value * (1 - this.activeDiscount)) : item.value;
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

  /**
   * Builds the merchant "Sell" section: one button per sellable inventory item.
   * Sell value = floor(itemValue * rules.merchantSellRatio).
   *
   * @private
   * @param {HTMLElement} panel - The scene options panel.
   * @param {HTMLElement} skillsContainer - Insertion anchor for option sections.
   */
  _buildSellSection(panel, skillsContainer) {
    const player = gameState.getPlayer();
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
        gameState.removeFromInventory(invItem.item, 1);
        gameState.modifyPlayerStat('gold', sellValue);
        this.engine.log(LOG.PLAYER, this.engine.t('dialogue.sold', { name: item.name, price: sellValue }), 'loot');
        this.renderStore(true);
      };
      sellSection.appendChild(btn);
    });
    panel.insertBefore(sellSection, skillsContainer);
  }
}
