import { createElement, buildCard, createSectionToggles, getItemLabel, itemStatLines } from "../core/utils.js";
import { EL, CSS, WEAPON_SLOTS } from "../core/config.js";

// Group key for the inventory's in-memory section collapse state — a
// per-session UI preference reset on reload, not saved (see
// createSectionToggles).
const INVENTORY_SECTION_GROUP = 'inventory';

// InventoryUI renders the inventory and equipment sidebar panels. Every item
// renders as a standard card (see buildCard); sections collapse via their
// headings so a grown inventory stays navigable.
export class InventoryUI {
  constructor(engine) {
    this.engine = engine;
    this._toggles = createSectionToggles(INVENTORY_SECTION_GROUP);
  }

  renderInventory(player, newItems = null) {
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

    // Item types that hold a newly-gained item — their section heading wears
    // the dot so a collapsed section still flags what's inside.
    const newTypes = new Set();
    if (newItems) sortedInv.forEach(entry => {
      if (newItems.has(entry.item)) newTypes.add(this.engine.data.items[entry.item]?.type || 'Flavour');
    });

    // Unequipped items, grouped by type
    let currentType = null;
    let currentUl = null;
    sortedInv.forEach(invItem => {
      const itemData = this.engine.data.items[invItem.item];
      if (!itemData) return;

      // Untyped items fall back to 'Flavour' everywhere the type is compared
      // (sorting, the new-set above, this grouping) — one fallback, applied
      // consistently, or the section key/count/dot checks diverge.
      const type = itemData.type || 'Flavour';
      if (type !== currentType) {
        currentType = type;
        // The heading count is total units, so potion stacks count in full.
        const count = sortedInv.reduce((sum, entry) =>
          (this.engine.data.items[entry.item]?.type || 'Flavour') === type
            ? sum + (entry.amount ?? 1) : sum, 0);
        currentUl = this._buildSection(panel, `type:${type}`, this.engine.t(`itemTypes.${type}`), count,
          newTypes.has(type) && this._toggles.isCollapsed(`type:${type}`));
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
      // A freshly-gained item wears a dot until the player leaves the tab.
      const classes = newItems?.has(invItem.item) ? [CSS.CARD_NEW] : [];
      // Actionless items (keepsakes, key items): a standard card, no buttons.
      if (actions.length === 0) {
        currentUl.appendChild(buildCard({
          tag: 'li',
          title,
          body: itemData.description,
          stats: this._itemStats(itemData),
          classes,
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
        classes,
      }));
    });
  }

  // Builds a collapsible section (heading toggle + card list) and returns
  // the list element. The muted count tells the player what a collapsed
  // section holds without opening it.
  _buildSection(panel, key, labelText, count, hasNew = false) {
    const section = createElement('div', CSS.PANEL_SECTION);
    const headingClasses = [CSS.SECTION_HEADING, CSS.SECTION_TOGGLE];
    // Only a COLLAPSED section holding a new item wears the dot (callers pass
    // hasNew accordingly) — expanded, the item's own card dot is in view.
    if (hasNew) headingClasses.push(CSS.SECTION_TOGGLE_NOTIFY);
    const heading = createElement('button', headingClasses);
    heading.appendChild(createElement('span', CSS.SECTION_TOGGLE_LABEL, labelText));
    if (count !== undefined) heading.appendChild(createElement('span', CSS.SECTION_TOGGLE_COUNT, String(count)));
    const ul = createElement('ul', CSS.CARD_LIST);
    this._toggles.wire(heading, ul, key);
    section.appendChild(heading);
    section.appendChild(ul);
    panel.appendChild(section);
    return ul;
  }

  // The card's accent stat lines — same lines as the combat attack buttons
  // (see itemStatLines); the hit line shows the player's current modifier.
  _itemStats(itemData) {
    const lines = itemStatLines(this.engine.t.bind(this.engine), itemData, this.engine.state.getPlayer().attributes);
    return lines.length > 0 ? lines : undefined;
  }
}
