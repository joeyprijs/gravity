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

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

    clearElement(container);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

    if (reminder) container.appendChild(reminder);

    // Done at top — always reachable without scrolling
    const doneBtn = buildOptionButton(this.engine.t('ui.museumDone'));
    doneBtn.onclick = () => this.engine.renderScene(gameState.getCurrentSceneId());
    container.appendChild(doneBtn);

    // Chest section
    const chestSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    chestSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.museumTitle')));
    if (chest.length > 0) {
      chest.forEach(b => {
        const name = this.engine.data.items[b.item]?.name || b.item;
        const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
        const btn = buildOptionButton(label, this.engine.t('ui.museumTake'));
        btn.onclick = () => {
          gameState.withdrawFromChest(b.item, 1);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.museumTook', { name }));
          this.render(true);
        };
        chestSection.appendChild(btn);
      });
    } else {
      const emptyBtn = buildOptionButton(this.engine.t('ui.museumEmpty'));
      emptyBtn.disabled = true;
      chestSection.appendChild(emptyBtn);
    }
    panel.insertBefore(chestSection, skillsContainer);

    // Inventory section
    const invSection = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
    invSection.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.inventoryTitle')));
    if (pInv.length > 0) {
      pInv.forEach(b => {
        const name = this.engine.data.items[b.item]?.name || b.item;
        const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
        const btn = buildOptionButton(label, this.engine.t('ui.museumDisplay'));
        btn.onclick = () => {
          gameState.depositToChest(b.item, 1);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.museumDisplayed', { name }));
          this.render(true);
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
