import { gameState } from "../core/state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "../core/utils.js";
import { CSS, EL, LOG } from "../core/config.js";

// MuseumUI handles the museum chest deposit/withdraw interface.
export class MuseumUI {
  constructor(engine) {
    this.engine = engine;
  }

  render(isUpdate = false) {
    const chest = gameState.getMuseumChest();
    const pInv = gameState.getPlayer().inventory;

    if (!isUpdate) {
      this.engine.openScene(CSS.SCENE_DIALOGUE);
      const chestNames = chest.map(b => this.engine.data.items[b.item]?.name || b.item).join(', ');
      this.engine.currentSceneEl.appendChild(
        buildSceneDescription(
          this.engine.t('ui.museumTitle'),
          chest.length > 0
            ? this.engine.t('actions.museumDisplayedWithin', { names: chestNames })
            : this.engine.t('actions.museumRoomEmpty')
        )
      );
    }

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    // Chest section
    const chestGroup = createElement('div', CSS.OPTIONS_GROUP);
    chestGroup.appendChild(createElement('div', CSS.OPTIONS_GROUP_LABEL, this.engine.t('ui.museumTitle')));
    const chestBtns = createElement('div', CSS.OPTIONS_GROUP_BUTTONS);
    if (chest.length > 0) {
      chest.forEach(b => {
        const name = this.engine.data.items[b.item]?.name || b.item;
        const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
        const btn = buildOptionButton(label);
        btn.onclick = () => {
          gameState.withdrawFromChest(b.item, 1);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.museumTook', { name }));
          this.render(true);
        };
        chestBtns.appendChild(btn);
      });
    } else {
      chestBtns.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.museumEmpty')));
    }
    chestGroup.appendChild(chestBtns);
    container.appendChild(chestGroup);

    // Inventory section
    const invGroup = createElement('div', CSS.OPTIONS_GROUP);
    invGroup.appendChild(createElement('div', CSS.OPTIONS_GROUP_LABEL, this.engine.t('ui.inventoryTitle')));
    const invBtns = createElement('div', CSS.OPTIONS_GROUP_BUTTONS);
    if (pInv.length > 0) {
      pInv.forEach(b => {
        const name = this.engine.data.items[b.item]?.name || b.item;
        const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
        const btn = buildOptionButton(label);
        btn.onclick = () => {
          gameState.depositToChest(b.item, 1);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.museumDisplayed', { name }));
          this.render(true);
        };
        invBtns.appendChild(btn);
      });
    } else {
      invBtns.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.inventoryEmpty')));
    }
    invGroup.appendChild(invBtns);
    container.appendChild(invGroup);

    const doneBtn = buildOptionButton(this.engine.t('ui.museumDone'));
    doneBtn.onclick = () => this.engine.renderScene(gameState.getCurrentSceneId());
    container.appendChild(doneBtn);

    this.engine.scrollNarrativeToBottom();
  }
}
