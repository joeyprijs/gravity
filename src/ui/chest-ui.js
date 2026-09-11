import { buildCard, buildPanelSection, createElement, buildOptionButton, getItemLabel, isSpecialItem, itemCardStatsFor, resetOptionsPanel } from '../core/utils.js';
import { CSS, LOG } from '../core/config.js';
import { translateOr } from '../core/i18n.js';

// The chest panel: the chest's contents and the pack as two sections of
// cards; clicking a card moves one item across. The log records what moved.
export class ChestUI {
  constructor(engine, chestId) {
    this.engine = engine;
    this.chestId = chestId;
  }

  // Tries ui.{chestId}{key} first, falls back to ui.chest{key}.
  tChest(key, params) {
    return translateOr(this.engine.t, `ui.${this.chestId}${key}`, this.engine.t(`ui.chest${key}`, params), params);
  }

  // Same fallback pattern for actions.* log strings.
  tAction(key, params) {
    return translateOr(this.engine.t, `actions.${this.chestId}${key}`, this.engine.t(`actions.chest${key}`, params), params);
  }

  _itemCard(stack) {
    const itemData = this.engine.data.items[stack.item];
    return buildCard({
      tag: 'button',
      title: getItemLabel(this.engine.data.items, stack.item, stack.amount),
      stats: itemData ? itemCardStatsFor(this.engine, itemData) : undefined,
    });
  }

  // Clicking a card runs move and logs under the actions.* key.
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
    // A Special item cannot be stowed and forgotten.
    const pInv = this.engine.state.getPlayer().inventory
      .filter(stack => !isSpecialItem(this.engine.data.items[stack.item]));

    // The heading names the chest while the panel has the screen.
    const { panel, container, skillsContainer } = resetOptionsPanel(this.tChest('Title'));

    const close = this.tChest('Close');
    const closeBtn = buildOptionButton(close);
    closeBtn.onclick = () => {
      // A choice, in the player's voice, like the open that started the visit.
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
