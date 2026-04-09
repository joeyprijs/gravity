import { gameState } from "./state.js";
import { createElement, clearElement } from "./utils.js";
import { ITEM_TYPE_ORDER, XP_PER_LEVEL } from "./config.js";
import { MapManager } from "./map.js";

export class UIManager {
  constructor(engine) {
    this.engine = engine;
    this.map = new MapManager(engine);
  }

  setup() {
    // Tab switching
    document.querySelectorAll('.tabs__btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tabs__btn').forEach(b => b.classList.remove('tabs__btn--active'));
        document.querySelectorAll('.tabs__content').forEach(c => c.classList.remove('tabs__content--active'));
        e.target.classList.add('tabs__btn--active');
        document.getElementById(e.target.dataset.tab).classList.add('tabs__content--active');
      });
    });

    // Save
    document.getElementById('btn-save').addEventListener('click', () => {
      if (gameState.downloadSave()) this.engine.log("System", "Game Saved to Disk.");
    });

    // Load
    const fileInput = document.getElementById('file-upload');
    document.getElementById('btn-load').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          let raw = ev.target.result;
          try { raw = decodeURIComponent(escape(atob(raw))); } catch (_) {}
          const data = JSON.parse(raw);
          gameState.loadFromObject(data);
          this.engine.isGameStart = true;
          clearElement('scene-narrative');
          this.engine.currentSceneEl = null;
          this.engine.scene.reset();
          this.engine.recalculateAC();
          this.engine.log("System", "Game Loaded from Disk.", 'system', false);
          const lastDesc = this.engine.narrative.restore(gameState.getLog());
          if (lastDesc !== null) {
            this.engine.scene.lastRenderedSceneId = gameState.getCurrentSceneId();
            this.engine.scene.lastRenderedDesc = lastDesc;
          }
          const currentScene = this.engine.data.scenes[gameState.getCurrentSceneId()];
          if (currentScene) this.engine.scene.renderOptions(currentScene);
        } catch (err) {
          console.error(err);
          this.engine.log("System", "Failed to parse save file.");
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Restart
    document.getElementById('btn-restart').addEventListener('click', () => {
      gameState.reset();
      window.location.reload();
    });

    this.map.setup();
    this.engine.narrative.setupScrollObserver();
  }

  update() {
    const player = gameState.getPlayer();

    // Stats
    document.getElementById('stat-level').innerText = `Lvl ${player.level}`;
    document.getElementById('stat-hp').innerText = `HP: ${player.hp}/${player.maxHp}`;
    document.getElementById('stat-ap').innerText = `AP: ${player.ap}/${player.maxAp}`;
    document.getElementById('stat-ac').innerText = `AC: ${player.ac}`;
    document.getElementById('stat-initiative').innerText = `Init: ${player.initiative}`;
    document.getElementById('stat-gold').innerText = `Gold: ${player.gold}`;

    // XP bar
    const xpPerc = (player.xp / (player.level * XP_PER_LEVEL)) * 100;
    document.getElementById('xp-bar').style.width = `${xpPerc}%`;

    this.renderInventory(player);
    this.renderEquipment(player);
    this.updateQuestLog();
    this.map.renderMinimap();

    if (this.engine.dialogueSystem.storeOpen) {
      this.engine.dialogueSystem.renderStore(true);
    }

    this.bindItemActions();
  }

  renderInventory(player) {
    const sortedInv = [...player.inventory].sort((a, b) => {
      const typeA = this.engine.data.items[a.item]?.type || "Flavour";
      const typeB = this.engine.data.items[b.item]?.type || "Flavour";
      return (ITEM_TYPE_ORDER[typeA] || 99) - (ITEM_TYPE_ORDER[typeB] || 99);
    });

    const invTab = document.getElementById('inventory-tab');
    invTab.innerHTML = '';

    if (sortedInv.length === 0) {
      invTab.appendChild(createElement('p', 'item__type', 'Inventory is empty.'));
      return;
    }

    let currentType = null;
    let currentGroup = null;
    let currentUl = null;

    sortedInv.forEach(invItem => {
      const itemData = this.engine.data.items[invItem.item];
      if (!itemData) return;

      if (itemData.type !== currentType) {
        currentType = itemData.type;
        currentGroup = createElement('div', 'item-list');
        currentGroup.appendChild(createElement('h3', 'item-list__title', itemData.type));
        currentUl = createElement('ul', 'item-list__items');
        currentGroup.appendChild(currentUl);
        invTab.appendChild(currentGroup);
      }

      const li = createElement('li', 'item-list__item');
      const statsHtml = this.buildItemStatsHtml(itemData);

      let buttonsHtml = '';
      if (itemData.type === 'Consumable') {
        buttonsHtml = `<button class="btn btn--item" data-action="consume" data-item="${invItem.item}">Use</button>`;
      } else if (itemData.type === 'Weapon' || itemData.type === 'Spell') {
        buttonsHtml = `
          <button class="btn btn--item" data-action="equip" data-slot="Left Hand" data-item="${invItem.item}">Left hand</button>
          <button class="btn btn--item" data-action="equip" data-slot="Right Hand" data-item="${invItem.item}">Right hand</button>
        `;
      } else if (itemData.type === 'Armor') {
        buttonsHtml = `<button class="btn btn--item" data-action="equip" data-slot="${itemData.slot}" data-item="${invItem.item}">Equip</button>`;
      }

      li.innerHTML = `
        <div class="item__description">
          <strong class="item__title">${itemData.name}${invItem.amount > 1 ? ` (x${invItem.amount})` : ''}</strong>
          <div class="item__type">${itemData.description}</div>
          ${statsHtml}
        </div>
        <div class="item__actions">${buttonsHtml}</div>
      `;
      currentUl.appendChild(li);
    });
  }

  renderEquipment(player) {
    const equipTab = document.getElementById('equipment-tab');
    equipTab.innerHTML = '';
    for (const slot in player.equipment) {
      const group = createElement('div', 'item-list');
      group.appendChild(createElement('h3', 'item-list__title', slot));
      const ul = createElement('ul', 'item-list__items');
      const li = createElement('li', 'item-list__item');
      const itemId = player.equipment[slot];
      if (itemId) {
        const itemData = this.engine.data.items[itemId];
        const statsHtml = this.buildItemStatsHtml(itemData);
        li.innerHTML = `
          <div class="item__description">
            <strong class="item__title">${itemData.name}</strong>
            <div class="item__type">${itemData.type}: ${itemData.description}</div>
            ${statsHtml}
          </div>
          <div class="item__actions"><button class="btn btn--item" data-action="unequip" data-slot="${slot}">Unequip</button></div>
        `;
      } else {
        li.appendChild(createElement('span', 'item__type', 'Empty'));
      }
      ul.appendChild(li);
      group.appendChild(ul);
      equipTab.appendChild(group);
    }
  }

  updateQuestLog() {
    const container = document.getElementById('quests-tab');
    if (!container) return;
    clearElement(container);

    const activeList = [];
    const completedList = [];

    for (const [mId, mData] of Object.entries(this.engine.data.missions)) {
      const status = gameState.getMissionStatus(mId);
      if (status === "active") {
        activeList.push(createElement('li', 'item-list__item', `
          <div class="item__description">
            <strong class="item__title">${mData.name}</strong>
            <div class="item__type">${mData.description}</div>
          </div>
        `));
      } else if (status === "complete") {
        completedList.push(createElement('li', ['item-list__item', 'item-list__item--completed'], `
          <div class="item__description">
            <strong class="item__title">${mData.name}</strong>
            <div class="item__type">${mData.description}</div>
          </div>
        `));
      }
    }

    if (activeList.length > 0) {
      const group = createElement('div', 'item-list');
      group.appendChild(createElement('h3', 'item-list__title', 'Active Quests'));
      const ul = createElement('ul', 'item-list__items');
      activeList.forEach(li => ul.appendChild(li));
      group.appendChild(ul);
      container.appendChild(group);
    }
    if (completedList.length > 0) {
      const group = createElement('div', 'item-list');
      group.appendChild(createElement('h3', 'item-list__title', 'Completed Quests'));
      const ul = createElement('ul', 'item-list__items');
      completedList.forEach(li => ul.appendChild(li));
      group.appendChild(ul);
      container.appendChild(group);
    }
    if (activeList.length === 0 && completedList.length === 0) {
      container.appendChild(createElement('p', 'item__type', 'No active quests.'));
    }
  }

  // Buttons call engine game-logic methods — UI layer owns no game logic here.
  bindItemActions() {
    document.querySelectorAll('.btn--item').forEach(btn => {
      // Use onclick so re-binding on every update() replaces previous handlers
      // instead of stacking duplicates.
      btn.onclick = (e) => {
        const { action, item: itemId, slot } = e.target.dataset;
        if (action === "consume") this.engine.useItem(itemId);
        else if (action === "equip") this.engine.equipItem(slot, itemId);
        else if (action === "unequip") this.engine.unequipItem(slot);
      };
    });
  }

  renderMuseumChestUI() {
    const optionsContainer = document.getElementById('scene-options');
    optionsContainer.innerHTML = '';

    const chest = gameState.getMuseumChest();
    const pInv = gameState.getPlayer().inventory;

    const chestDiv = createElement('div', 'glass-panel');
    chestDiv.innerHTML = `<h3 style="margin-bottom:10px; color:var(--text-primary);">Museum Displays</h3>`;
    if (chest && chest.length > 0) {
      chest.forEach(b => {
        const itemData = this.engine.data.items[b.item];
        const row = createElement('div', 'item-list__item');
        row.innerHTML = `<div class="item__description"><strong class="item__title">${itemData?.name || b.item}${b.amount > 1 ? ` (x${b.amount})` : ''}</strong></div>`;
        const btn = createElement('button', ['btn', 'btn--item'], 'Take');
        btn.onclick = () => {
          gameState.withdrawFromChest(b.item, 1);
          this.engine.log("System", `You retrieved ${itemData?.name || b.item} from the display.`);
          this.renderMuseumChestUI();
        };
        row.appendChild(btn);
        chestDiv.appendChild(row);
      });
    } else {
      chestDiv.innerHTML += `<p class="item__type">No items on display.</p>`;
    }

    const invDiv = createElement('div', 'glass-panel');
    invDiv.style.marginTop = '10px';
    invDiv.innerHTML = `<h3 style="margin-bottom:10px; color:var(--text-primary);">Your Inventory</h3>`;
    if (pInv && pInv.length > 0) {
      pInv.forEach(b => {
        const itemData = this.engine.data.items[b.item];
        const row = createElement('div', 'item-list__item');
        row.innerHTML = `<div class="item__description"><strong class="item__title">${itemData?.name || b.item}${b.amount > 1 ? ` (x${b.amount})` : ''}</strong></div>`;
        const btn = createElement('button', ['btn', 'btn--item'], 'Display');
        btn.style.background = 'var(--xp-color)';
        btn.onclick = () => {
          gameState.depositToChest(b.item, 1);
          this.engine.log("System", `You proudly displayed ${itemData?.name || b.item}.`);
          this.renderMuseumChestUI();
        };
        row.appendChild(btn);
        invDiv.appendChild(row);
      });
    } else {
      invDiv.innerHTML += `<p class="item__type">Inventory is empty.</p>`;
    }

    const closeBtn = createElement('button', 'option-btn');
    closeBtn.innerHTML = `<span>Done Managing</span>`;
    closeBtn.style.marginTop = '15px';
    closeBtn.onclick = () => this.engine.renderScene(gameState.getCurrentSceneId());

    optionsContainer.appendChild(chestDiv);
    optionsContainer.appendChild(invDiv);
    optionsContainer.appendChild(closeBtn);
  }

  buildItemStatsHtml(itemData) {
    const statStrs = [];
    if (itemData.actionPoints !== undefined) statStrs.push(`AP: ${itemData.actionPoints}`);
    if (itemData.bonusHitChance !== undefined) {
      const sign = itemData.bonusHitChance >= 0 ? '+' : '';
      statStrs.push(`Hit: ${sign}${itemData.bonusHitChance}`);
    }
    if (itemData.attributes) {
      for (const k in itemData.attributes) statStrs.push(`${k}: ${itemData.attributes[k]}`);
    }
    return statStrs.length > 0 ? `<div class="item__stats">${statStrs.join(', ')}</div>` : '';
  }
}
