import { buildCard, buildPanelSection, createElement, buildOptionButton, getItemLabel, isSpecialItem, itemCardStatsFor, resetOptionsPanel } from '../core/utils.js';
import { CSS, LOG } from '../core/config.js';

// ChestUI renders the deposit/withdraw panel for a chest (opened by the
// manage_chest action): the chest's contents and the player's inventory as
// two sections, one card per stack. A card IS the control — clicking a chest
// row takes it out, clicking an inventory row puts it in — and it carries the
// item's stat lines, the same card the inventory and the curator's cases show.
// The panel IS the view of the contents; the narrative log only records what
// moved, never a standing inventory of what's inside.
export class ChestUI {
  constructor(engine, chestId) {
    this.engine = engine;
    this.chestId = chestId;
  }

  // Tries ui.{chestId}{key} first, falls back to ui.chest{key}.
  tChest(key, params) {
    const specific = `ui.${this.chestId}${key}`;
    const resolved = this.engine.t(specific, params);
    return resolved === specific ? this.engine.t(`ui.chest${key}`, params) : resolved;
  }

  // Same fallback pattern for actions.* log strings.
  tAction(key, params) {
    const specific = `actions.${this.chestId}${key}`;
    const resolved = this.engine.t(specific, params);
    return resolved === specific ? this.engine.t(`actions.chest${key}`, params) : resolved;
  }

  // One stack as a clickable card: its label, and the item's own stat lines.
  _itemCard(stack) {
    const itemData = this.engine.data.items[stack.item];
    return buildCard({
      tag: 'button',
      title: getItemLabel(this.engine.data.items, stack.item, stack.amount),
      stats: itemData ? itemCardStatsFor(this.engine, itemData) : undefined,
    });
  }

  // One section of stacks: clicking a card moves one item and logs it under
  // the given actions.* key; an empty section shows the placeholder instead.
  _stackSection(heading, stacks, move, logKey, emptyEl) {
    const section = buildPanelSection(heading);
    if (stacks.length === 0) {
      section.appendChild(emptyEl);
      return section;
    }
    stacks.forEach(b => {
      const btn = this._itemCard(b);
      btn.onclick = () => {
        move(b.item);
        this.engine.log(LOG.SYSTEM, this.tAction(logKey, { name: getItemLabel(this.engine.data.items, b.item) }));
        this.render();
      };
      section.appendChild(btn);
    });
    return section;
  }

  render() {
    const chest = this.engine.state.getChest(this.chestId);
    // Special items are never offered: a story relic stays on the player, so
    // it can't be stowed and forgotten in a chest (see isSpecialItem).
    const pInv = this.engine.state.getPlayer().inventory
      .filter(stack => !isSpecialItem(this.engine.data.items[stack.item]));

    // The panel names the chest, the way a museum room's panel names the room —
    // it has taken the screen over, so the heading should say what you are
    // looking at. Closing hands the heading back to the scene.
    const { panel, container, skillsContainer } = resetOptionsPanel(this.tChest('Title'));

    // The button names the act, and the log records the words the player
    // clicked — one phrase, the way "Open Personal Chest" reads on the way in.
    const close = this.tChest('Close');
    const closeBtn = buildOptionButton(close);
    closeBtn.onclick = () => {
      // Shutting it is a choice the player made, logged in their voice like the
      // "Open Personal Chest" that started the visit — not narration.
      this.engine.log(LOG.PLAYER, close, 'choice');
      this.engine.setCustomUIOpen(false);
      const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
      if (scene) this.engine.scene.renderOptions(scene);
    };
    container.appendChild(closeBtn);

    const emptyBtn = buildOptionButton(this.tChest('Empty'));
    emptyBtn.disabled = true;
    panel.insertBefore(this._stackSection(this.tChest('Contents'), chest,
      item => this.engine.state.withdrawFromChest(this.chestId, item, 1), 'Took', emptyBtn), skillsContainer);
    panel.insertBefore(this._stackSection(this.engine.t('ui.inventoryTitle'), pInv,
      item => this.engine.state.depositToChest(this.chestId, item, 1), 'Deposited',
      createElement('p', CSS.CARD_BODY, this.engine.t('ui.inventoryEmpty'))), skillsContainer);

    this.engine.scrollNarrativeToBottom();
  }
}
