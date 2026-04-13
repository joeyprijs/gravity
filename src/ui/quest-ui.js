import { gameState } from "../core/state.js";
import { createElement, clearElement } from "../core/utils.js";
import { CSS, EL } from "../core/config.js";

// QuestUI renders the quest log sidebar panel.
export class QuestUI {
  constructor(engine) {
    this.engine = engine;
  }

  render() {
    const container = document.getElementById(EL.TAB_QUESTS);
    if (!container) return;
    clearElement(container);

    const activeList = [];
    const completedList = [];

    const buildQuestItem = (mData, extraClass = null) => {
      const li = createElement('li', extraClass ? [CSS.ITEM_LIST_ITEM, extraClass] : CSS.ITEM_LIST_ITEM);
      const descDiv = createElement('div', CSS.ITEM_DESCRIPTION);
      descDiv.appendChild(createElement('strong', CSS.ITEM_TITLE, mData.name));
      descDiv.appendChild(createElement('div', CSS.ITEM_TYPE, mData.description));
      li.appendChild(descDiv);
      return li;
    };

    for (const [mId, mData] of Object.entries(this.engine.data.missions)) {
      const status = gameState.getMissionStatus(mId);
      if (status === "active") {
        activeList.push(buildQuestItem(mData));
      } else if (status === "complete") {
        completedList.push(buildQuestItem(mData, CSS.ITEM_LIST_ITEM_DONE));
      }
    }

    if (activeList.length > 0) {
      const group = createElement('div', CSS.ITEM_LIST);
      group.appendChild(createElement('h3', CSS.ITEM_LIST_TITLE, this.engine.t('ui.questsActive')));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      activeList.forEach(li => ul.appendChild(li));
      group.appendChild(ul);
      container.appendChild(group);
    }
    if (completedList.length > 0) {
      const group = createElement('div', CSS.ITEM_LIST);
      group.appendChild(createElement('h3', CSS.ITEM_LIST_TITLE, this.engine.t('ui.questsCompleted')));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      completedList.forEach(li => ul.appendChild(li));
      group.appendChild(ul);
      container.appendChild(group);
    }
    if (activeList.length === 0 && completedList.length === 0) {
      container.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.questsNone')));
    }
  }
}
