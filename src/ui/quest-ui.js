import { gameState } from "../core/state.js";
import { createElement, buildCard } from "../core/utils.js";
import { CSS, EL, MISSION_STATUS } from "../core/config.js";

// QuestUI renders the quest log sidebar panel.
export class QuestUI {
  constructor(engine) {
    this.engine = engine;
  }

  render() {
    const panel = document.getElementById(EL.TAB_QUESTS);
    if (!panel) return;
    panel.innerHTML = '';

    const activeList = [];
    const completedList = [];

    const buildQuestItem = (mData, extraClass = null) => buildCard({
      tag: 'li',
      title: mData.name,
      body: mData.description,
      classes: extraClass ? [extraClass] : [],
    });

    for (const [mId, mData] of Object.entries(this.engine.data.missions)) {
      const status = gameState.getMissionStatus(mId);
      if (status === MISSION_STATUS.ACTIVE) {
        activeList.push(buildQuestItem(mData));
      } else if (status === MISSION_STATUS.COMPLETE) {
        completedList.push(buildQuestItem(mData, CSS.CARD_DONE));
      }
    }

    if (activeList.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.questsActive')));
      const ul = createElement('ul', CSS.CARD_LIST);
      activeList.forEach(li => ul.appendChild(li));
      section.appendChild(ul);
      panel.appendChild(section);
    }
    if (completedList.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.questsCompleted')));
      const ul = createElement('ul', CSS.CARD_LIST);
      completedList.forEach(li => ul.appendChild(li));
      section.appendChild(ul);
      panel.appendChild(section);
    }
    if (activeList.length === 0 && completedList.length === 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('p', CSS.CARD_BODY, this.engine.t('ui.questsNone')));
      panel.appendChild(section);
    }
  }
}
