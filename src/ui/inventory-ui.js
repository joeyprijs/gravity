import { createElement, buildCard, createSectionToggles, getItemLabel, itemCardStats } from "../core/utils.js";
import { EL, CSS } from "../core/config.js";
import { itemHasUse } from "../systems/items.js";

// Group key for the inventory's in-memory section collapse state — a
// per-session UI preference reset on reload, not saved (see
// createSectionToggles).
const INVENTORY_SECTION_GROUP = 'inventory';

// Item types used straight from the pack rather than equipped. A Special item
// often carries a use (the Hearthstone's teleport) but need not — hence the
// itemHasUse check at the call site, which keeps a story key an inert card.
const USABLE_TYPES = new Set(['Consumable', 'Special']);

// InventoryUI renders the inventory and equipment sidebar panels. Every item
// renders as a standard card (see buildCard) and an item you can act on IS
// its card — clicking it uses, equips or unequips the thing (see _itemRow),
// so there are no per-item action buttons. Sections collapse via their
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
    // matter for gear you already know you own. Clicking a card takes it off.
    if (equippedEntries.length > 0) {
      const ul = this._buildSection(panel, 'equipped', this.engine.t('ui.equippedSection'), equippedEntries.length);
      equippedEntries.forEach(([slot, itemId]) => {
        const itemData = this.engine.data.items[itemId];
        if (!itemData) return;
        ul.appendChild(this._itemRow({
          title: itemData.name,
          body: this.engine.t('ui.equippedTo', { slot }),
          // No slot row here — "Equipped: Torso" above it already said so, and
          // it names the slot the item is actually IN, which for a hand item
          // is the one the engine picked rather than the one it declares.
          stats: this._itemStats(itemData, { slot: false }),
        }, { action: 'unequip', slot }));
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

      // What clicking the card does. Gear equips into the slot the engine
      // picks for it (hand items alternate left/right — see systems/items.js),
      // so the card carries the item, never a slot.
      let dataset = null;
      if (USABLE_TYPES.has(itemData.type) && itemHasUse(itemData)) dataset = { action: 'consume', item: invItem.item };
      else if (['Weapon', 'Spell', 'Armor'].includes(itemData.type)) dataset = { action: 'equip', item: invItem.item };

      const spec = {
        title: getItemLabel(this.engine.data.items, invItem.item, invItem.amount),
        // The slot used to sit here as a body line; it's a stat row now, so it
        // lines up with the rest of the item's facts (see itemCardStats).
        body: itemData.description,
        stats: this._itemStats(itemData),
        // A freshly-gained item wears a dot until the player rests the pointer
        // on its card (see UIManager.setup) or leaves the tab.
        classes: newItems?.has(invItem.item) ? [CSS.CARD_NEW] : [],
      };

      // Actionless items (keepsakes, key items): a plain card, nothing to
      // click. It still names its item in the dataset — that's what the
      // hover-to-acknowledge handler reads off a dotted card (see
      // UIManager.setup); an actionable card carries it already.
      if (dataset) {
        currentUl.appendChild(this._itemRow(spec, dataset));
      } else {
        const card = buildCard({ tag: 'li', ...spec });
        card.dataset.item = invItem.item;
        currentUl.appendChild(card);
      }
    });
  }

  // A row whose whole card is the control: a button card wrapped in an <li>,
  // so the section stays a real list while the card itself is what you click.
  // The dataset drives the panel's delegated click handler (see UIManager);
  // CSS.BTN_ITEM is the hook it — and combat's "no acting on your enemy's
  // turn" blanket disable — looks for.
  _itemRow(spec, dataset) {
    const card = buildCard({ ...spec, tag: 'button', classes: [CSS.BTN_ITEM, ...(spec.classes ?? [])] });
    Object.assign(card.dataset, dataset);
    const li = createElement('li');
    li.appendChild(card);
    return li;
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

  // The card's stat lines (see itemCardStats), bound to the engine's
  // translator and the player's current attributes.
  _itemStats(itemData, options) {
    return itemCardStats(this.engine.t.bind(this.engine), itemData, this.engine.state.getPlayer().attributes,
      { ...options, uses: this.engine.state.getItemUses(itemData.id) });
  }
}
