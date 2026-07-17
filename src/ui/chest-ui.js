import { createElement, buildOptionButton, getItemLabel, resetOptionsPanel } from "../core/utils.js";
import { CSS, LOG } from "../core/config.js";

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

  _refreshSceneDesc() {
    const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
    if (scene) this.engine.scene.refreshDescription(scene);
  }

  render() {
    const chest = this.engine.state.getChest(this.chestId);
    const pInv = this.engine.state.getPlayer().inventory;

    const { panel, container, skillsContainer } = resetOptionsPanel();

    const doneBtn = buildOptionButton(this.tChest('Done'));
    doneBtn.onclick = () => {
      this.engine.setCustomUIOpen(false);
      const scene = this.engine.data.scenes[this.engine.state.getCurrentSceneId()];
      if (scene) this.engine.scene.renderOptions(scene);
    };
    container.appendChild(doneBtn);

    const chestSection = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
    chestSection.appendChild(createElement('div', CSS.SECTION_HEADING, this.tChest('Title')));
    if (chest.length > 0) {
      chest.forEach(b => {
        const name = getItemLabel(this.engine.data.items, b.item);
        const btn = buildOptionButton(getItemLabel(this.engine.data.items, b.item, b.amount), this.tChest('Withdraw'));
        btn.onclick = () => {
          this.engine.state.withdrawFromChest(this.chestId, b.item, 1);
          this.engine.log(LOG.SYSTEM, this.tAction('Took', { name }));
          this._refreshSceneDesc();
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
        const btn = buildOptionButton(getItemLabel(this.engine.data.items, b.item, b.amount), this.tChest('Deposit'));
        btn.onclick = () => {
          this.engine.state.depositToChest(this.chestId, b.item, 1);
          this.engine.log(LOG.SYSTEM, this.tAction('Deposited', { name }));
          this._refreshSceneDesc();
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
