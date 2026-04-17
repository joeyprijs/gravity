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
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    clearElement(container);
    if (reminder) container.appendChild(reminder);

    // Done at top — always reachable without scrolling
    const doneBtn = buildOptionButton(this.engine.t('ui.museumDone'));
    doneBtn.onclick = () => this.engine.renderScene(gameState.getCurrentSceneId());
    container.appendChild(doneBtn);

    // Chest section
    container.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.museumTitle')));
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
        container.appendChild(btn);
      });
    } else {
      container.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.museumEmpty')));
    }

    // Inventory section
    container.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.inventoryTitle')));
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
        container.appendChild(btn);
      });
    } else {
      container.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.inventoryEmpty')));
    }

    this.engine.scrollNarrativeToBottom();
  }
}
