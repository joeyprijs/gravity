import { gameState } from "./state.js";
import { createElement, clearElement } from "./utils.js";
import { ITEM_TYPE_ORDER, XP_PER_LEVEL, EL, CSS, MSG } from "./config.js";
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
          // Decode the base64+UTF-8 encoding written by state.js downloadSave().
          // TextDecoder is the modern replacement for the deprecated escape() approach.
          try {
            const binary = atob(raw);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            raw = new TextDecoder().decode(bytes);
          } catch (_) {}
          const data = JSON.parse(raw);
          gameState.loadFromObject(data);
          this.engine.isGameStart = true;
          clearElement(EL.SCENE_NARRATIVE);
          this.engine.currentSceneEl = null;
          this.engine.scene.reset();
          this.engine.recalculateAC();
          this.engine.log("System", MSG.GAME_LOADED, 'system', false);
          const lastDesc = this.engine.narrative.restore(gameState.getLog());
          if (lastDesc !== null) {
            this.engine.scene.lastRenderedSceneId = gameState.getCurrentSceneId();
            this.engine.scene.lastRenderedDesc = lastDesc;
          }
          const currentScene = this.engine.data.scenes[gameState.getCurrentSceneId()];
          if (currentScene) this.engine.scene.renderOptions(currentScene);
        } catch (err) {
          console.error(err);
          this.engine.log("System", MSG.GAME_LOAD_FAILED);
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
      invTab.appendChild(createElement('p', CSS.ITEM_TYPE, 'Inventory is empty.'));
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
        currentGroup = createElement('div', CSS.ITEM_LIST);
        currentGroup.appendChild(createElement('h3', CSS.ITEM_LIST_TITLE, itemData.type));
        currentUl = createElement('ul', CSS.ITEM_LIST_ITEMS);
        currentGroup.appendChild(currentUl);
        invTab.appendChild(currentGroup);
      }

      const li = createElement('li', CSS.ITEM_LIST_ITEM);
      const label = `${itemData.name}${invItem.amount > 1 ? ` (x${invItem.amount})` : ''}`;

      const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
      descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, label));
      descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, itemData.description));
      const statsEl = this.buildItemStatsEl(itemData);
      if (statsEl) descDiv.appendChild(statsEl);

      const actionsDiv = createElement('div', CSS.ITEM_ACTIONS);
      if (itemData.type === 'Consumable') {
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], 'Use');
        btn.dataset.action = 'consume';
        btn.dataset.item = invItem.item;
        actionsDiv.appendChild(btn);
      } else if (itemData.type === 'Weapon' || itemData.type === 'Spell') {
        for (const [slot, label] of [['Left Hand', 'Left hand'], ['Right Hand', 'Right hand']]) {
          const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], label);
          btn.dataset.action = 'equip';
          btn.dataset.slot = slot;
          btn.dataset.item = invItem.item;
          actionsDiv.appendChild(btn);
        }
      } else if (itemData.type === 'Armor') {
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], 'Equip');
        btn.dataset.action = 'equip';
        btn.dataset.slot = itemData.slot;
        btn.dataset.item = invItem.item;
        actionsDiv.appendChild(btn);
      }

      li.appendChild(descDiv);
      li.appendChild(actionsDiv);
      currentUl.appendChild(li);
    });
  }

  renderEquipment(player) {
    const equipTab = document.getElementById('equipment-tab');
    equipTab.innerHTML = '';
    for (const slot in player.equipment) {
      const group = createElement('div', CSS.ITEM_LIST);
      group.appendChild(createElement('h3', CSS.ITEM_LIST_TITLE, slot));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      const li = createElement('li', CSS.ITEM_LIST_ITEM);
      const itemId = player.equipment[slot];
      if (itemId) {
        const itemData = this.engine.data.items[itemId];
        const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
        descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, itemData.name));
        descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, `${itemData.type}: ${itemData.description}`));
        const statsEl = this.buildItemStatsEl(itemData);
        if (statsEl) descDiv.appendChild(statsEl);

        const unequipBtn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], 'Unequip');
        unequipBtn.dataset.action = 'unequip';
        unequipBtn.dataset.slot = slot;

        li.appendChild(descDiv);
        li.appendChild(createElement('div', CSS.ITEM_ACTIONS)).appendChild(unequipBtn);
      } else {
        li.appendChild(createElement('span', CSS.ITEM_TYPE, 'Empty'));
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

    const buildQuestItem = (mData, extraClass = null) => {
      const li = createElement('li', extraClass ? [CSS.ITEM_LIST_ITEM, extraClass] : CSS.ITEM_LIST_ITEM);
      const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
      descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, mData.name));
      descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, mData.description));
      li.appendChild(descDiv);
      return li;
    };

    for (const [mId, mData] of Object.entries(this.engine.data.missions)) {
      const status = gameState.getMissionStatus(mId);
      if (status === "active") {
        activeList.push(buildQuestItem(mData));
      } else if (status === "complete") {
        completedList.push(buildQuestItem(mData, CSS.ITEM_LIST_ITEM_DONE));
      }
    }

    if (activeList.length > 0) {
      const group = createElement('div', CSS.ITEM_LIST);
      group.appendChild(createElement('h3', CSS.ITEM_LIST_TITLE, 'Active Quests'));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      activeList.forEach(li => ul.appendChild(li));
      group.appendChild(ul);
      container.appendChild(group);
    }
    if (completedList.length > 0) {
      const group = createElement('div', CSS.ITEM_LIST);
      group.appendChild(createElement('h3', CSS.ITEM_LIST_TITLE, 'Completed Quests'));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      completedList.forEach(li => ul.appendChild(li));
      group.appendChild(ul);
      container.appendChild(group);
    }
    if (activeList.length === 0 && completedList.length === 0) {
      container.appendChild(createElement('p', CSS.ITEM_TYPE, 'No active quests.'));
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

    const buildMuseumRow = (b, btnLabel, onClickFn) => {
      const itemData = this.engine.data.items[b.item];
      const name = itemData?.name || b.item;
      const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
      const row = createElement('div', CSS.ITEM_LIST_ITEM);
      const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
      descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, label));
      row.appendChild(descDiv);
      const btn = createElement('button', btnLabel === 'Display' ? [CSS.BTN, CSS.BTN_ITEM, CSS.BTN_DEPOSIT] : [CSS.BTN, CSS.BTN_ITEM], btnLabel);
      btn.onclick = onClickFn;
      row.appendChild(btn);
      return row;
    };

    const chestDiv = createElement('div', [CSS.GLASS_PANEL, CSS.MUSEUM_SECTION]);
    chestDiv.appendChild(createElement('h3', CSS.MUSEUM_HEADING, 'Museum Displays'));
    if (chest && chest.length > 0) {
      chest.forEach(b => {
        const itemData = this.engine.data.items[b.item];
        chestDiv.appendChild(buildMuseumRow(b, 'Take', () => {
          gameState.withdrawFromChest(b.item, 1);
          this.engine.log("System", `You retrieved ${itemData?.name || b.item} from the display.`);
          this.renderMuseumChestUI();
        }));
      });
    } else {
      chestDiv.appendChild(createElement('p', CSS.ITEM_TYPE, 'No items on display.'));
    }

    const invDiv = createElement('div', [CSS.GLASS_PANEL, CSS.MUSEUM_SECTION]);
    invDiv.appendChild(createElement('h3', CSS.MUSEUM_HEADING, 'Your Inventory'));
    if (pInv && pInv.length > 0) {
      pInv.forEach(b => {
        const itemData = this.engine.data.items[b.item];
        invDiv.appendChild(buildMuseumRow(b, 'Display', () => {
          gameState.depositToChest(b.item, 1);
          this.engine.log("System", `You proudly displayed ${itemData?.name || b.item}.`);
          this.renderMuseumChestUI();
        }));
      });
    } else {
      invDiv.appendChild(createElement('p', CSS.ITEM_TYPE, 'Inventory is empty.'));
    }

    const closeBtn = createElement('button', [CSS.OPTION_BTN, CSS.MUSEUM_DONE_BTN]);
    closeBtn.appendChild(createElement('span', '', 'Done Managing'));
    closeBtn.onclick = () => this.engine.renderScene(gameState.getCurrentSceneId());

    optionsContainer.appendChild(chestDiv);
    optionsContainer.appendChild(invDiv);
    optionsContainer.appendChild(closeBtn);
  }

  // Returns a div.item__stats element, or null if the item has no displayable stats.
  buildItemStatsEl(itemData) {
    const statStrs = [];
    if (itemData.actionPoints !== undefined) statStrs.push(`AP: ${itemData.actionPoints}`);
    if (itemData.bonusHitChance !== undefined) {
      const sign = itemData.bonusHitChance >= 0 ? '+' : '';
      statStrs.push(`Hit: ${sign}${itemData.bonusHitChance}`);
    }
    if (itemData.attributes) {
      for (const k in itemData.attributes) statStrs.push(`${k}: ${itemData.attributes[k]}`);
    }
    if (statStrs.length === 0) return null;
    return createElement('div', CSS.ITEM_STATS, statStrs.join(', '));
  }
}
