import { createElement, buildCard, getItemLabel, itemStatLines } from "../core/utils.js";
import { EL, CSS, WEAPON_SLOTS } from "../core/config.js";
import { gameState } from "../core/state.js";

// InventoryUI renders the inventory and equipment sidebar panels. Every item
// renders as a standard card (see buildCard) with its controls in the
// actions row.
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
      return (typeOrder[typeA] ?? 99) - (typeOrder[typeB] ?? 99);
    });

    if (equippedEntries.length === 0 && sortedInv.length === 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('p', CSS.CARD_BODY, this.engine.t('ui.inventoryEmpty')));
      panel.appendChild(section);
      return;
    }

    // Equipped section
    if (equippedEntries.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.equippedSection')));
      const ul = createElement('ul', CSS.CARD_LIST);
      equippedEntries.forEach(([slot, itemId]) => {
        const itemData = this.engine.data.items[itemId];
        if (!itemData) return;
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.unequipButton'));
        btn.dataset.action = 'unequip';
        btn.dataset.slot = slot;
        ul.appendChild(buildCard({
          tag: 'li',
          title: itemData.name,
          body: [itemData.description, this.engine.t('ui.equippedTo', { slot })],
          stats: this._itemStats(itemData),
          actions: [btn],
        }));
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
        currentUl = createElement('ul', CSS.CARD_LIST);
        currentSection.appendChild(currentUl);
        panel.appendChild(currentSection);
      }

      const actions = [];
      if (itemData.type === 'Consumable') {
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.useButton'));
        btn.dataset.action = 'consume';
        btn.dataset.item = invItem.item;
        actions.push(btn);
      } else if (itemData.type === 'Weapon' || itemData.type === 'Spell') {
        for (const [slot, labelKey] of [[WEAPON_SLOTS[0], 'inventory.leftHandButton'], [WEAPON_SLOTS[1], 'inventory.rightHandButton']]) {
          const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t(labelKey));
          btn.dataset.action = 'equip';
          btn.dataset.slot = slot;
          btn.dataset.item = invItem.item;
          actions.push(btn);
        }
      } else if (itemData.type === 'Armor') {
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.equipButton'));
        btn.dataset.action = 'equip';
        btn.dataset.slot = itemData.slot;
        btn.dataset.item = invItem.item;
        actions.push(btn);
      }

      currentUl.appendChild(buildCard({
        tag: 'li',
        title: getItemLabel(this.engine.data.items, invItem.item, invItem.amount),
        body: [
          itemData.description,
          itemData.type === 'Armor' && itemData.slot ? this.engine.t('ui.armorSlot', { slot: itemData.slot }) : null,
        ],
        stats: this._itemStats(itemData),
        actions,
      }));
    });
  }

  // The card's accent stat lines — same lines as the combat attack buttons
  // (see itemStatLines); the hit line shows the player's current modifier.
  _itemStats(itemData) {
    const lines = itemStatLines(this.engine.t.bind(this.engine), itemData, gameState.getPlayer().attributes);
    return lines.length > 0 ? lines.join('\n') : undefined;
  }
}
