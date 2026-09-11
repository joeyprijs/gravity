import { createElement, buildCard, createSectionToggles, getItemLabel, itemCardStatsFor, slotLabel } from '../core/utils.js';
import { EL, CSS } from '../core/config.js';
import { itemHasUse } from '../systems/items.js';

// The inventory's group key for createSectionToggles.
const INVENTORY_SECTION_GROUP = 'inventory';

// Types used from the pack rather than equipped; itemHasUse decides per item.
const USABLE_TYPES = new Set(['Consumable', 'Special', 'Book']);

// The inventory panel: every item a card, and an item you can act on is its
// card. Sections collapse via their headings.
export class InventoryUI {
  constructor(engine) {
    this.engine = engine;
    this._toggles = createSectionToggles(INVENTORY_SECTION_GROUP);
  }

  renderInventory(player, newItems = null) {
    const panel = document.getElementById(EL.TAB_INVENTORY);
    panel.replaceChildren();

    // One fallback for every type comparison, or the section checks diverge.
    const typeOf = (itemId) => this.engine.data.items[itemId]?.type || 'Flavour';
    const equippedEntries = Object.entries(player.equipment).filter(([, id]) => id);
    const typeOrder = this.engine.data.rules?.itemTypeOrder || {};
    const sortedInv = [...player.inventory].sort((a, b) =>
      (typeOrder[typeOf(a.item)] ?? 99) - (typeOrder[typeOf(b.item)] ?? 99));

    if (equippedEntries.length === 0 && sortedInv.length === 0) {
      const section = createElement('div', CSS.PANEL_SECTION);
      section.appendChild(createElement('p', CSS.CARD_BODY, this.engine.t('ui.inventoryEmpty')));
      panel.appendChild(section);
      return;
    }

    // Clicking an equipped card takes it off.
    if (equippedEntries.length > 0) {
      const ul = this._buildSection(panel, 'equipped', this.engine.t('ui.equippedSection'), equippedEntries.length);
      equippedEntries.forEach(([slot, itemId]) => {
        const itemData = this.engine.data.items[itemId];
        if (!itemData) return;
        ul.appendChild(this._itemRow({
          title: itemData.name,
          body: this.engine.t('ui.equippedTo', { slot: slotLabel(this.engine.t, slot) }),
          // The body line names the slot the item is in; no slot row too.
          stats: itemCardStatsFor(this.engine, itemData, { slot: false }),
        }, { action: 'unequip', slot }));
      });
    }

    // A collapsed section's heading wears the dot for a new item inside.
    const newTypes = new Set();
    if (newItems) sortedInv.forEach(entry => {
      if (newItems.has(entry.item)) newTypes.add(typeOf(entry.item));
    });

    let currentType = null;
    let currentUl = null;
    sortedInv.forEach(invItem => {
      const itemData = this.engine.data.items[invItem.item];
      if (!itemData) return;

      const type = typeOf(invItem.item);
      if (type !== currentType) {
        currentType = type;
        // Total units, so stacks count in full.
        const count = sortedInv.reduce((sum, entry) =>
          typeOf(entry.item) === type ? sum + (entry.amount ?? 1) : sum, 0);
        currentUl = this._buildSection(panel, `type:${type}`, this.engine.t(`itemTypes.${type}`), count,
          newTypes.has(type) && this._toggles.isCollapsed(`type:${type}`));
      }

      // The card carries the item, never a slot: the engine picks the slot.
      let dataset = null;
      if (USABLE_TYPES.has(itemData.type) && itemHasUse(itemData)) dataset = { action: 'consume', item: invItem.item };
      else if (['Weapon', 'Spell', 'Armor'].includes(itemData.type)) dataset = { action: 'equip', item: invItem.item };

      const spec = {
        title: getItemLabel(this.engine.data.items, invItem.item, invItem.amount),
        body: itemData.description,
        stats: itemCardStatsFor(this.engine, itemData),
        classes: newItems?.has(invItem.item) ? [CSS.CARD_NEW] : [],
      };

      // An inert card still names its item, for the hover-to-acknowledge handler.
      if (dataset) {
        currentUl.appendChild(this._itemRow(spec, dataset));
      } else {
        const card = buildCard({ tag: 'li', ...spec });
        card.dataset.item = invItem.item;
        currentUl.appendChild(card);
      }
    });
  }

  // A button card in an <li>. The dataset drives UIManager's delegated click
  // handler; CSS.BTN_ITEM is its hook, and the game-over blanket disable's.
  _itemRow(spec, dataset) {
    const card = buildCard({ ...spec, tag: 'button', classes: [CSS.BTN_ITEM, ...(spec.classes ?? [])] });
    Object.assign(card.dataset, dataset);
    const li = createElement('li');
    li.appendChild(card);
    return li;
  }

  // Returns the list element.
  _buildSection(panel, key, labelText, count, hasNew = false) {
    const section = createElement('div', CSS.PANEL_SECTION);
    const headingClasses = [CSS.SECTION_HEADING, CSS.SECTION_TOGGLE];
    // Expanded, the card's own dot is in view.
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
}
