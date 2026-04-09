import { gameState } from "./state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "./utils.js";
import { MERCHANT_SELL_RATIO, EL, CSS } from "./config.js";

// DialogueSystem handles NPC conversations and the merchant buy/sell interface.
// Conversations are driven by a node graph defined in NPC JSON files. If an NPC
// has no conversations object, a minimal fallback UI is shown instead.
export class DialogueSystem {
  constructor(engine) {
    this.engine = engine;
    this.currentNPC = null;
    this.storeOpen = false;
  }

  startDialogue(npcId) {
    const npc = this.engine.data.npcs[npcId];
    if (!npc) return;

    this.engine.lastRenderedSceneId = null;
    this.currentNPC = npc;
    if (npc.conversations) {
      this.renderDialogue("start");
    } else {
      this.renderDialogueFallback();
    }
  }

  renderDialogue(nodeId = "start", overrideText = null) {
    const node = this.currentNPC.conversations[nodeId];
    if (!node) return;

    const displayString = overrideText || node.npcText;

    if (nodeId === "start") {
      this.engine.openScene('dialogue');
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
      );
    } else {
      this.engine.log(this.currentNPC.name, displayString);
    }

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = `DIALOGUE: ${this.currentNPC.name}`;

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    node.responses.forEach(res => {
      const btn = buildOptionButton(res.text);
      btn.onclick = () => {
        this.engine.log('player', res.text, 'choice');

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
  }

  renderDialogueFallback(overrideText = null) {
    const displayString = overrideText || `Greetings, traveler. I am ${this.currentNPC.name}.`;

    this.engine.openScene('dialogue');
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(this.currentNPC.name, `[${this.currentNPC.name}] ${displayString}`)
    );

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = `DIALOGUE: ${this.currentNPC.name}`;

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    if (this.currentNPC.isMerchant) {
      const tradeBtn = buildOptionButton('Trade');
      tradeBtn.onclick = () => {
        this.engine.log('player', 'Trade', 'choice');
        this.renderStore();
      };
      container.appendChild(tradeBtn);
    }

    const leaveBtn = buildOptionButton('Leave');
    leaveBtn.onclick = () => {
      this.engine.renderScene(gameState.getCurrentSceneId());
    };
    container.appendChild(leaveBtn);
  }

  renderStore(isUpdate = false) {
    if (!isUpdate) {
      this.storeOpen = true;
      this.engine.openScene('merchant');
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(`${this.currentNPC.name}'s Wares`, `[${this.currentNPC.name}] Take a look!`)
      );
    }

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = `MERCHANT: ${this.currentNPC.name}`;

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    const goldBar = createElement('div', CSS.STORE_STATS_GOLD, `<strong>Your Gold: ${gameState.getPlayer().gold}</strong>`);
    container.appendChild(goldBar);

    // Buy items
    if (this.currentNPC.carriedItems) {
      this.currentNPC.carriedItems.forEach(itemId => {
        const item = this.engine.data.items[itemId];
        if (item) {
          const btn = buildOptionButton(`Buy ${item.name}`, `${item.value} Gold`);
          if (gameState.getPlayer().gold < item.value) btn.disabled = true;
          btn.onclick = () => {
            gameState.modifyPlayerStat('gold', -item.value);
            gameState.addToInventory(itemId, 1);
            this.engine.log("player", `Bought ${item.name} for ${item.value} Gold.`, 'loot');
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
          const btn = buildOptionButton(`Sell ${item.name} (x${invItem.amount})`, `+${sellValue} Gold`, true);
          btn.onclick = () => {
            gameState.removeFromInventory(invItem.item, 1);
            gameState.modifyPlayerStat('gold', sellValue);
            this.engine.log("player", `Sold ${item.name} for ${sellValue} Gold.`, 'loot');
            this.renderStore(true);
          };
          container.appendChild(btn);
        }
      }
    });

    const leaveBtn = buildOptionButton('Never mind.');
    leaveBtn.onclick = () => {
      this.storeOpen = false;
      this.engine.log('player', 'Never mind.', 'choice');

      const exitStr = this.currentNPC.storeExitText || "Come again.";
      if (this.currentNPC.conversations) {
        this.renderDialogue("start", exitStr);
      } else {
        this.renderDialogueFallback(exitStr);
      }
    };
    container.appendChild(leaveBtn);
  }
}
