import { gameState } from "./state.js";
import { createElement } from "./utils.js";
import { CSS, EL, LOG } from "./config.js";

// MuseumUI handles the museum chest deposit/withdraw interface.
export class MuseumUI {
  constructor(engine) {
    this.engine = engine;
  }

  render() {
    const optionsContainer = document.getElementById(EL.SCENE_OPTIONS);
    optionsContainer.innerHTML = '';

    const chest = gameState.getMuseumChest();
    const pInv = gameState.getPlayer().inventory;

    const buildMuseumRow = (b, btnLabel, isDeposit, onClickFn) => {
      const itemData = this.engine.data.items[b.item];
      const name = itemData?.name || b.item;
      const label = b.amount > 1 ? `${name} (x${b.amount})` : name;
      const row = createElement('div', CSS.ITEM_LIST_ITEM);
      const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
      descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, label));
      row.appendChild(descDiv);
      const btn = createElement('button', isDeposit ? [CSS.BTN, CSS.BTN_ITEM, CSS.BTN_DEPOSIT] : [CSS.BTN, CSS.BTN_ITEM], btnLabel);
      btn.onclick = onClickFn;
      row.appendChild(btn);
      return row;
    };

    const chestDiv = createElement('div', [CSS.GLASS_PANEL, CSS.MUSEUM_SECTION]);
    chestDiv.appendChild(createElement('h3', CSS.MUSEUM_HEADING, this.engine.t('ui.museumTitle')));
    if (chest && chest.length > 0) {
      chest.forEach(b => {
        const itemData = this.engine.data.items[b.item];
        chestDiv.appendChild(buildMuseumRow(b, this.engine.t('ui.museumTake'), false, () => {
          gameState.withdrawFromChest(b.item, 1);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.museumTook', { name: itemData?.name || b.item }));
          this.render();
        }));
      });
    } else {
      chestDiv.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.museumEmpty')));
    }

    const invDiv = createElement('div', [CSS.GLASS_PANEL, CSS.MUSEUM_SECTION]);
    invDiv.appendChild(createElement('h3', CSS.MUSEUM_HEADING, this.engine.t('ui.inventoryTitle')));
    if (pInv && pInv.length > 0) {
      pInv.forEach(b => {
        const itemData = this.engine.data.items[b.item];
        invDiv.appendChild(buildMuseumRow(b, this.engine.t('ui.museumDisplay'), true, () => {
          gameState.depositToChest(b.item, 1);
          this.engine.log(LOG.SYSTEM, this.engine.t('actions.museumDisplayed', { name: itemData?.name || b.item }));
          this.render();
        }));
      });
    } else {
      invDiv.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.inventoryEmpty')));
    }

    const closeBtn = createElement('button', [CSS.OPTION_BTN, CSS.MUSEUM_DONE_BTN]);
    closeBtn.appendChild(createElement('span', '', this.engine.t('ui.museumDone')));
    closeBtn.onclick = () => this.engine.renderScene(gameState.getCurrentSceneId());

    optionsContainer.appendChild(chestDiv);
    optionsContainer.appendChild(invDiv);
    optionsContainer.appendChild(closeBtn);
  }
}
