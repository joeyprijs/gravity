import { createElement } from "../core/utils.js";
import { EL, CSS } from "../core/config.js";

// InventoryUI renders the inventory and equipment sidebar panels.
export class InventoryUI {
  constructor(engine) {
    this.engine = engine;
  }

  renderInventory(player) {
    const panel = document.getElementById(EL.TAB_INVENTORY);
    panel.innerHTML = '';

    const equippedEntries = Object.entries(player.equipment).filter(([, id]) => id);
    const typeOrder = this.engine.data.rules?.itemTypeOrder || {};
    const sortedInv = [...player.inventory].sort((a, b) => {
      const typeA = this.engine.data.items[a.item]?.type || 'Flavour';
      const typeB = this.engine.data.items[b.item]?.type || 'Flavour';
      return (typeOrder[typeA] || 99) - (typeOrder[typeB] || 99);
    });

    if (equippedEntries.length === 0 && sortedInv.length === 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.inventoryEmpty')));
      panel.appendChild(section);
      return;
    }

    // Equipped section
    if (equippedEntries.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.equippedSection')));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      equippedEntries.forEach(([slot, itemId]) => {
        const itemData = this.engine.data.items[itemId];
        if (!itemData) return;
        const li = createElement('li', CSS.ITEM_LIST_ITEM);
        const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
        descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, itemData.name));
        descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, itemData.description));
        descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, this.engine.t('ui.equippedTo', { slot })));
        const statsEl = this.buildItemStatsEl(itemData);
        if (statsEl) descDiv.appendChild(statsEl);
        const actionsDiv = createElement('div', CSS.ITEM_ACTIONS);
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.unequipButton'));
        btn.dataset.action = 'unequip';
        btn.dataset.slot = slot;
        actionsDiv.appendChild(btn);
        li.appendChild(descDiv);
        li.appendChild(actionsDiv);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      panel.appendChild(section);
    }

    // Unequipped items, grouped by type
    let currentType = null;
    let currentSection = null;
    let currentUl = null;
    sortedInv.forEach(invItem => {
      const itemData = this.engine.data.items[invItem.item];
      if (!itemData) return;

      if (itemData.type !== currentType) {
        currentType = itemData.type;
        currentSection = createElement('div', CSS.SCENE_OPTIONS);
        currentSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t(`itemTypes.${itemData.type}`)));
        currentUl = createElement('ul', CSS.ITEM_LIST_ITEMS);
        currentSection.appendChild(currentUl);
        panel.appendChild(currentSection);
      }

      const li = createElement('li', CSS.ITEM_LIST_ITEM);
      const label = `${itemData.name}${invItem.amount > 1 ? ` (x${invItem.amount})` : ''}`;
      const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
      descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, label));
      descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, itemData.description));
      if (itemData.type === 'Armor' && itemData.slot) {
        descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, this.engine.t('ui.armorSlot', { slot: itemData.slot })));
      }
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
