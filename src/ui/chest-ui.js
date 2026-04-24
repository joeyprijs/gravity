import { gameState } from "../core/state.js";
import { createElement, clearElement, buildOptionButton } from "../core/utils.js";
import { CSS, EL, LOG } from "../core/config.js";

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
    const scene = this.engine.data.scenes[gameState.getCurrentSceneId()];
    if (scene) this.engine.scene.refreshDescription(scene);
  }

  render() {
    const chest = gameState.getChest(this.chestId);
    const pInv = gameState.getPlayer().inventory;

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

    clearElement(container);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

    if (reminder) container.appendChild(reminder);

    const doneBtn = buildOptionButton(this.tChest('Done'));
    doneBtn.onclick = () => {
      this.engine._customUIOpen = false;
      const scene = this.engine.data.scenes[gameState.getCurrentSceneId()];
      if (scene) this.engine.scene.renderOptions(scene);
    };
    container.appendChild(doneBtn);

    const chestSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    chestSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.tChest('Title')));
    if (chest.length > 0) {
      chest.forEach(b => {
        const name = this.engine.data.items[b.item]?.name || b.item;
        const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
        const btn = buildOptionButton(label, this.tChest('Withdraw'));
        btn.onclick = () => {
          gameState.withdrawFromChest(this.chestId, b.item, 1);
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

    const invSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    invSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.inventoryTitle')));
    if (pInv.length > 0) {
      pInv.forEach(b => {
        const name = this.engine.data.items[b.item]?.name || b.item;
        const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
        const btn = buildOptionButton(label, this.tChest('Deposit'));
        btn.onclick = () => {
          gameState.depositToChest(this.chestId, b.item, 1);
          this.engine.log(LOG.SYSTEM, this.tAction('Deposited', { name }));
          this._refreshSceneDesc();
          this.render();
        };
        invSection.appendChild(btn);
      });
    } else {
      invSection.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.inventoryEmpty')));
    }
    panel.insertBefore(invSection, skillsContainer);

    this.engine.scrollNarrativeToBottom();
  }
}
