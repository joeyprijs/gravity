import { buildCard, buildContentsTable, createElement, buildOptionButton, getItemLabel, itemCardStats, resetOptionsPanel } from "../core/utils.js";
import { CSS, LOG } from "../core/config.js";

// ChestUI renders the deposit/withdraw panel for a chest (opened by the
// manage_chest action): the chest's contents and the player's inventory as
// two sections, one card per stack. A card IS the control — clicking a chest
// row takes it out, clicking an inventory row puts it in — and it carries the
// item's stat lines, the same card the inventory and the curator's cases show.
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

  // What the chest holds, as a contents table in the narrative — written after
  // the [Player] line that opened it, then kept current as stacks move: a row
  // per stack, gone when the last one leaves, and an empty-chest message when
  // nothing is left. Re-opening writes a fresh table further down the log.
  _renderContents(chest) {
    this._contentsEl ??= this.engine.narrative.appendBlock();
    this._contentsEl.innerHTML = buildContentsTable(
      [this.tChest('TableItem'), this.tChest('TableAmount')],
      chest.map(stack => ({
        label: getItemLabel(this.engine.data.items, stack.item),
        value: String(stack.amount ?? 1),
      })),
      this.tChest('Empty'),
    );
  }

  // One stack as a clickable card: its label, and the item's own stat lines.
  _itemCard(stack) {
    const itemData = this.engine.data.items[stack.item];
    return buildCard({
      tag: 'button',
      title: getItemLabel(this.engine.data.items, stack.item, stack.amount),
      stats: itemData
        ? itemCardStats(this.engine.t.bind(this.engine), itemData, this.engine.state.getPlayer().attributes)
        : undefined,
    });
  }

  render() {
    const chest = this.engine.state.getChest(this.chestId);
    const pInv = this.engine.state.getPlayer().inventory;

    this._renderContents(chest);

    // The panel names the chest, the way a museum room's panel names the room —
    // it has taken the screen over, so the heading should say what you are
    // looking at. Closing hands the heading back to the scene.
    const { panel, container, skillsContainer } = resetOptionsPanel(this.tChest('Title'));

    const doneBtn = buildOptionButton(this.tChest('Done'));
    doneBtn.onclick = () => {
      // Shutting it is a choice the player made, logged in their voice like the
      // "Open Personal Chest" that started the visit — not narration.
      this.engine.log(LOG.PLAYER, this.tChest('Close'), 'choice');
      this.engine.setCustomUIOpen(false);
      const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
      if (scene) this.engine.scene.renderOptions(scene);
    };
    container.appendChild(doneBtn);

    const chestSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    chestSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.tChest('Contents')));
    if (chest.length > 0) {
      chest.forEach(b => {
        const name = getItemLabel(this.engine.data.items, b.item);
        const btn = this._itemCard(b);
        btn.onclick = () => {
          this.engine.state.withdrawFromChest(this.chestId, b.item, 1);
          this.engine.log(LOG.SYSTEM, this.tAction('Took', { name }));
          this.render();
        };
        chestSection.appendChild(btn);
      });
    } else {
      const emptyBtn = buildOptionButton(this.tChest('Empty'));
      emptyBtn.disabled = true;
      chestSection.appendChild(emptyBtn);
    }
    panel.insertBefore(chestSection, skillsContainer);

    const invSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    invSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t('ui.inventoryTitle')));
    if (pInv.length > 0) {
      pInv.forEach(b => {
        const name = getItemLabel(this.engine.data.items, b.item);
        const btn = this._itemCard(b);
        btn.onclick = () => {
          this.engine.state.depositToChest(this.chestId, b.item, 1);
          this.engine.log(LOG.SYSTEM, this.tAction('Deposited', { name }));
          this.render();
        };
        invSection.appendChild(btn);
      });
    } else {
      invSection.appendChild(createElement('p', CSS.CARD_BODY, this.engine.t('ui.inventoryEmpty')));
    }
    panel.insertBefore(invSection, skillsContainer);

    this.engine.scrollNarrativeToBottom();
  }
}
