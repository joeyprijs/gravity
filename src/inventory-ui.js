import { createElement } from "./utils.js";
import { ITEM_TYPE_ORDER, EL, CSS } from "./config.js";

// InventoryUI renders the inventory and equipment sidebar panels.
export class InventoryUI {
  constructor(engine) {
    this.engine = engine;
  }

  renderInventory(player) {
    const sortedInv = [...player.inventory].sort((a, b) => {
      const typeA = this.engine.data.items[a.item]?.type || "Flavour";
      const typeB = this.engine.data.items[b.item]?.type || "Flavour";
      return (ITEM_TYPE_ORDER[typeA] || 99) - (ITEM_TYPE_ORDER[typeB] || 99);
    });

    const invTab = document.getElementById(EL.TAB_INVENTORY);
    invTab.innerHTML = '';

    if (sortedInv.length === 0) {
      invTab.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.inventoryEmpty')));
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
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.useButton'));
        btn.dataset.action = 'consume';
        btn.dataset.item = invItem.item;
        actionsDiv.appendChild(btn);
      } else if (itemData.type === 'Weapon' || itemData.type === 'Spell') {
        for (const [slot, labelKey] of [['Left Hand', 'inventory.leftHandButton'], ['Right Hand', 'inventory.rightHandButton']]) {
          const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t(labelKey));
          btn.dataset.action = 'equip';
          btn.dataset.slot = slot;
          btn.dataset.item = invItem.item;
          actionsDiv.appendChild(btn);
        }
      } else if (itemData.type === 'Armor') {
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.equipButton'));
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
    const equipTab = document.getElementById(EL.TAB_EQUIPMENT);
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
        descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, this.engine.t('ui.equipmentTypeFormat', { type: itemData.type, description: itemData.description })));
        const statsEl = this.buildItemStatsEl(itemData);
        if (statsEl) descDiv.appendChild(statsEl);

        const unequipBtn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.unequipButton'));
        unequipBtn.dataset.action = 'unequip';
        unequipBtn.dataset.slot = slot;

        li.appendChild(descDiv);
        li.appendChild(createElement('div', CSS.ITEM_ACTIONS)).appendChild(unequipBtn);
      } else {
        li.appendChild(createElement('span', CSS.ITEM_TYPE, this.engine.t('ui.slotEmpty')));
      }
      ul.appendChild(li);
      group.appendChild(ul);
      equipTab.appendChild(group);
    }
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
      for (const k in itemData.attributes) {
        const v = itemData.attributes[k];
        if (typeof v !== 'object') statStrs.push(`${k}: ${v}`);
      }
    }
    if (statStrs.length === 0) return null;
    return createElement('div', CSS.ITEM_STATS, statStrs.join(', '));
  }
}
