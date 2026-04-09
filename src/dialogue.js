import { gameState } from "./state.js";
import { createElement, clearElement } from "./utils.js";
import { MERCHANT_SELL_RATIO } from "./config.js";

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
      const desc = createElement('div', 'scene__description');
      desc.innerHTML = `<h2 class="scene__title">${this.currentNPC.name}</h2><p class="scene__body">[${this.currentNPC.name}] ${displayString}</p>`;
      this.engine.currentSceneEl.appendChild(desc);
    } else {
      this.engine.log(this.currentNPC.name, displayString);
    }

    const reminder = document.getElementById('scene-location-reminder');
    if (reminder) reminder.innerText = `DIALOGUE: ${this.currentNPC.name}`;

    const container = document.getElementById('scene-options');
    clearElement(container);

    node.responses.forEach(res => {
      const btn = createElement('button', 'option-btn', `<span>${res.text}</span>`);

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
    const desc = createElement('div', 'scene__description');
    desc.innerHTML = `<h2 class="scene__title">${this.currentNPC.name}</h2><p class="scene__body">[${this.currentNPC.name}] ${displayString}</p>`;
    this.engine.currentSceneEl.appendChild(desc);

    const reminder = document.getElementById('scene-location-reminder');
    if (reminder) reminder.innerText = `DIALOGUE: ${this.currentNPC.name}`;

    const container = document.getElementById('scene-options');
    clearElement(container);

    if (this.currentNPC.isMerchant) {
      const tradeBtn = createElement('button', 'option-btn', `<span>Trade</span>`);
      tradeBtn.onclick = () => {
        this.engine.log('player', 'Trade', 'choice');
        this.renderStore();
      };
      container.appendChild(tradeBtn);
    }

    const leaveBtn = createElement('button', 'option-btn', `<span>Leave</span>`);
    leaveBtn.onclick = () => {
      this.engine.renderScene(gameState.getCurrentSceneId());
    };
    container.appendChild(leaveBtn);
  }

  renderStore(isUpdate = false) {
    if (!isUpdate) {
      this.storeOpen = true;
      this.engine.openScene('merchant');
      const desc = createElement('div', 'scene__description');
      desc.innerHTML = `<h2 class="scene__title">${this.currentNPC.name}'s Wares</h2><p class="scene__body">[${this.currentNPC.name}] Take a look!</p>`;
      this.engine.currentSceneEl.appendChild(desc);
    }

    const reminder = document.getElementById('scene-location-reminder');
    if (reminder) reminder.innerText = `MERCHANT: ${this.currentNPC.name}`;

    const container = document.getElementById('scene-options');
    clearElement(container);

    const goldBar = createElement('div', 'store-stats__gold-bar', `<strong>Your Gold: ${gameState.getPlayer().gold}</strong>`);
    container.appendChild(goldBar);

    // Buy items
    if (this.currentNPC.carriedItems) {
      this.currentNPC.carriedItems.forEach(itemId => {
        const item = this.engine.data.items[itemId];
        if (item) {
          const btn = createElement('button', 'option-btn', `<span>Buy ${item.name}</span> <span class="option-btn__req-text">${item.value} Gold</span>`);

          if (gameState.getPlayer().gold < item.value) {
            btn.disabled = true;
          }

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
          const btn = createElement('button', 'option-btn', `<span>Sell ${item.name} (x${invItem.amount})</span> <span class="option-btn__req-text option-btn__req-text--sell">+${sellValue} Gold</span>`);
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

    const leaveBtn = createElement('button', 'option-btn', `<span>Never mind.</span>`);
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
