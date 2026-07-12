import { createElement, buildCard, getItemLabel, itemStatLines } from "../core/utils.js";
import { EL, CSS, WEAPON_SLOTS } from "../core/config.js";
import { gameState } from "../core/state.js";

// Collapse state persists across page loads — it's a UI preference, not game
// state, so it lives beside the page rather than in the save file.
const COLLAPSED_KEY = 'gravity:inventory-collapsed';

// InventoryUI renders the inventory and equipment sidebar panels. Every item
// renders as a standard card (see buildCard); sections collapse via their
// headings so a grown inventory stays navigable.
export class InventoryUI {
  constructor(engine) {
    this.engine = engine;
    this._collapsed = new Set(this._loadCollapsed());
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
      const section = createElement('div', CSS.PANEL_SECTION);
      section.appendChild(createElement('p', CSS.CARD_BODY, this.engine.t('ui.inventoryEmpty')));
      panel.appendChild(section);
      return;
    }

    // Equipped section — no description line: the slot and stats are what
    // matter for gear you already know you own.
    if (equippedEntries.length > 0) {
      const ul = this._buildSection(panel, 'equipped', this.engine.t('ui.equippedSection'), equippedEntries.length);
      equippedEntries.forEach(([slot, itemId]) => {
        const itemData = this.engine.data.items[itemId];
        if (!itemData) return;
        const btn = createElement('button', [CSS.BTN, CSS.BTN_ITEM], this.engine.t('inventory.unequipButton'));
        btn.dataset.action = 'unequip';
        btn.dataset.slot = slot;
        ul.appendChild(buildCard({
          tag: 'li',
          title: itemData.name,
          body: this.engine.t('ui.equippedTo', { slot }),
          stats: this._itemStats(itemData),
          actions: [btn],
        }));
      });
    }

    // Unequipped items, grouped by type
    let currentType = null;
    let currentUl = null;
    sortedInv.forEach(invItem => {
      const itemData = this.engine.data.items[invItem.item];
      if (!itemData) return;

      if (itemData.type !== currentType) {
        currentType = itemData.type;
        // The heading count is total units, so potion stacks count in full.
        const count = sortedInv.reduce((sum, entry) =>
          (this.engine.data.items[entry.item]?.type || 'Flavour') === itemData.type
            ? sum + (entry.amount ?? 1) : sum, 0);
        currentUl = this._buildSection(panel, `type:${itemData.type}`, this.engine.t(`itemTypes.${itemData.type}`), count);
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

      const title = getItemLabel(this.engine.data.items, invItem.item, invItem.amount);
      // Actionless items (keepsakes, key items) render compact — title and
      // stats only — so collections don't turn the panel into a scroll.
      if (actions.length === 0) {
        currentUl.appendChild(buildCard({
          tag: 'li',
          title,
          stats: this._itemStats(itemData),
          classes: [CSS.CARD_COMPACT],
        }));
        return;
      }

      currentUl.appendChild(buildCard({
        tag: 'li',
        title,
        body: [
          itemData.description,
          itemData.type === 'Armor' && itemData.slot ? this.engine.t('ui.armorSlot', { slot: itemData.slot }) : null,
        ],
        stats: this._itemStats(itemData),
        actions,
      }));
    });
  }

  // Builds a collapsible section (heading toggle + card list) and returns
  // the list element. Collapsing hides the list in place — no re-render, so
  // the action buttons keep their bindings. The muted count tells the player
  // what a collapsed section holds without opening it.
  _buildSection(panel, key, labelText, count) {
    const section = createElement('div', CSS.PANEL_SECTION);
    const heading = createElement('button', [CSS.SECTION_HEADING, CSS.SECTION_TOGGLE]);
    heading.appendChild(createElement('span', CSS.SECTION_TOGGLE_LABEL, labelText));
    if (count !== undefined) heading.appendChild(createElement('span', CSS.SECTION_TOGGLE_COUNT, String(count)));
    const ul = createElement('ul', CSS.CARD_LIST);
    const applyState = (collapsed) => {
      ul.hidden = collapsed;
      heading.classList.toggle(CSS.SECTION_TOGGLE_COLLAPSED, collapsed);
    };
    applyState(this._collapsed.has(key));
    heading.onclick = () => {
      const collapsed = !this._collapsed.delete(key);
      if (collapsed) this._collapsed.add(key);
      applyState(collapsed);
      this._saveCollapsed();
    };
    section.appendChild(heading);
    section.appendChild(ul);
    panel.appendChild(section);
    return ul;
  }

  _loadCollapsed() {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(COLLAPSED_KEY) || '[]');
    } catch {
      return [];
    }
  }

  _saveCollapsed() {
    try {
      globalThis.localStorage?.setItem(COLLAPSED_KEY, JSON.stringify([...this._collapsed]));
    } catch { /* storage unavailable (private mode) — collapse state stays per-session */ }
  }

  // The card's accent stat lines — same lines as the combat attack buttons
  // (see itemStatLines); the hit line shows the player's current modifier.
  _itemStats(itemData) {
    const lines = itemStatLines(this.engine.t.bind(this.engine), itemData, gameState.getPlayer().attributes);
    return lines.length > 0 ? lines : undefined;
  }
}
