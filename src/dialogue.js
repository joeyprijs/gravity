import { gameState } from "./state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton, applyOptionsLayout } from "./utils.js";
import { MERCHANT_SELL_RATIO, EL, CSS, LOG } from "./config.js";
import { evaluateCondition } from "./condition.js";

// DialogueSystem handles NPC conversations and the merchant buy/sell interface.
// Conversations are driven by a node graph defined in NPC JSON files. If an NPC
// has no conversations object, a minimal fallback UI is shown instead.
export class DialogueSystem {
  constructor(engine) {
    this.engine = engine;
    this.currentNPC = null;
    this.storeOpen = false;

    // Re-render the store on any state change so gold and inventory stay in
    // sync — removing the need for UIManager to know the store exists.
    gameState.subscribe(() => {
      if (this.storeOpen) this.renderStore(true);
    });
  }

  startDialogue(npcId) {
    const npc = this.engine.data.npcs[npcId];
    if (!npc) { console.warn(`[Gravity] startDialogue: unknown NPC "${npcId}"`); return; }

    this.engine.scene.reset();
    this.currentNPC = npc;
    if (npc.conversations) {
      this.renderDialogue("start");
    } else {
      this.renderDialogueFallback();
    }
  }

  renderDialogue(nodeId = "start", overrideText = null) {
    const node = this.currentNPC.conversations[nodeId];
    if (!node) { console.warn(`[Gravity] renderDialogue: unknown node "${nodeId}" on NPC "${this.currentNPC.name}"`); return; }

    const displayString = overrideText || node.npcText;

    if (nodeId === "start") {
      this.engine.openScene(CSS.SCENE_DIALOGUE);
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
      );
    } else {
      this.engine.log(this.currentNPC.name, displayString);
    }

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = this.engine.t('ui.locationDialogue', { name: this.currentNPC.name });

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    (node.responses || []).forEach(res => {
      if (!evaluateCondition(res.condition ?? null, gameState)) return;

      const btn = buildOptionButton(res.text);
      btn.onclick = () => {
        this.engine.log(LOG.PLAYER, res.text, 'choice');

        if (res.changeStateFlag) {
          gameState.setFlag(res.changeStateFlag.flag, res.changeStateFlag.value);
        }
        if (res.giveItem) {
          gameState.addToInventory(res.giveItem, res.giveItemAmount || 1);
          const name = this.engine.data.items[res.giveItem]?.name || res.giveItem;
          this.engine.log(LOG.SYSTEM, this.engine.t('loot.receivedItem', { name }), 'loot');
        }
        if (res.setMission) {
          this.engine.questSystem.handleTrigger({ mission: res.setMission, status: res.setMissionStatus || 'active' });
        }

        if (res.goToConversation) {
          this.renderDialogue(res.goToConversation);
        } else if (res.action === "trade") {
          this.renderStore();
        } else if (res.action === "leave") {
          this.engine.renderScene(gameState.getCurrentSceneId());
        }
      };
      container.appendChild(btn);
    });

    applyOptionsLayout(container);
  }

  renderDialogueFallback(overrideText = null) {
    const displayString = overrideText || this.engine.t('dialogue.greeting', { name: this.currentNPC.name });

    this.engine.openScene(CSS.SCENE_DIALOGUE);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
    );

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = this.engine.t('ui.locationDialogue', { name: this.currentNPC.name });

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

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
  }

  renderStore(isUpdate = false) {
    if (!isUpdate) {
      this.storeOpen = true;
      this.engine.openScene(CSS.SCENE_MERCHANT);
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(
          this.engine.t('dialogue.merchantWaresTitle', { name: this.currentNPC.name }),
          this.engine.t('dialogue.merchantGreeting', { name: this.currentNPC.name })
        )
      );
    }

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = this.engine.t('ui.locationMerchant', { name: this.currentNPC.name });

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    const goldBar = createElement('div', CSS.STORE_STATS_GOLD, `<strong>${this.engine.t('dialogue.yourGold', { amount: gameState.getPlayer().gold })}</strong>`);
    container.appendChild(goldBar);

    // Buy items
    if (this.currentNPC.carriedItems) {
      this.currentNPC.carriedItems.forEach(itemId => {
        const item = this.engine.data.items[itemId];
        if (item) {
          const btn = buildOptionButton(
            this.engine.t('dialogue.buyButton', { name: item.name }),
            this.engine.t('dialogue.buyPrice', { amount: item.value })
          );
          if (gameState.getPlayer().gold < item.value) btn.disabled = true;
          btn.onclick = () => {
            gameState.modifyPlayerStat('gold', -item.value);
            gameState.addToInventory(itemId, 1);
            this.engine.log(LOG.PLAYER, this.engine.t('dialogue.bought', { name: item.name, price: item.value }), 'loot');
            this.renderStore(true);
          };
          container.appendChild(btn);
        }
      });
    }

    // Sell items
    const player = gameState.getPlayer();
    player.inventory.forEach(invItem => {
      const item = this.engine.data.items[invItem.item];
      if (item && item.value > 0) {
        const sellValue = Math.floor(item.value * MERCHANT_SELL_RATIO);
        if (sellValue > 0) {
          const btn = buildOptionButton(
            this.engine.t('dialogue.sellButton', { name: item.name, count: invItem.amount }),
            this.engine.t('dialogue.sellPrice', { amount: sellValue }),
            true
          );
          btn.onclick = () => {
            gameState.removeFromInventory(invItem.item, 1);
            gameState.modifyPlayerStat('gold', sellValue);
            this.engine.log(LOG.PLAYER, this.engine.t('dialogue.sold', { name: item.name, price: sellValue }), 'loot');
            this.renderStore(true);
          };
          container.appendChild(btn);
        }
      }
    });

    const neverMind = this.engine.t('dialogue.neverMind');
    const leaveBtn = buildOptionButton(neverMind);
    leaveBtn.onclick = () => {
      this.storeOpen = false;
      this.engine.log(LOG.PLAYER, neverMind, 'choice');

      const exitStr = this.currentNPC.storeExitText || this.engine.t('dialogue.comeAgain');
      if (this.currentNPC.conversations) {
        this.renderDialogue("start", exitStr);
      } else {
        this.renderDialogueFallback(exitStr);
      }
    };
    container.appendChild(leaveBtn);
    applyOptionsLayout(container);
  }
}
