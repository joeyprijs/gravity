import { gameState } from "../core/state.js";
import { createElement } from "../core/utils.js";
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
      if (status === MISSION_STATUS.ACTIVE) {
        activeList.push(buildQuestItem(mData));
      } else if (status === MISSION_STATUS.COMPLETE) {
        completedList.push(buildQuestItem(mData, CSS.ITEM_LIST_ITEM_DONE));
      }
    }

    if (activeList.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.questsActive')));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      activeList.forEach(li => ul.appendChild(li));
      section.appendChild(ul);
      panel.appendChild(section);
    }

    const clockRows = this._buildClockRows();
    if (clockRows.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.clocksHeading')));
      const list = createElement('div', 'attr-list');
      clockRows.forEach(row => list.appendChild(row));
      section.appendChild(list);
      panel.appendChild(section);
    }

    if (completedList.length > 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING, this.engine.t('ui.questsCompleted')));
      const ul = createElement('ul', CSS.ITEM_LIST_ITEMS);
      completedList.forEach(li => ul.appendChild(li));
      section.appendChild(ul);
      panel.appendChild(section);
    }
    if (activeList.length === 0 && completedList.length === 0 && clockRows.length === 0) {
      const section = createElement('div', CSS.SCENE_OPTIONS);
      section.appendChild(createElement('p', CSS.ITEM_TYPE, this.engine.t('ui.questsNone')));
      panel.appendChild(section);
    }
  }

  // Clocks: progress tracks render as filled/empty pips, labeled timers as
  // ticks-remaining countdowns. Unlabeled timers stay the world's secret
  // machinery and never surface here. Rows reuse the attr-list idiom
  // (label left, value right).
  _buildClockRows() {
    const rows = [];

    for (const clock of Object.values(gameState.getClocks())) {
      const row = createElement('div', 'attr-list__row');
      row.appendChild(createElement('span', 'attr-list__label', clock.label));
      const pips = '●'.repeat(clock.filled) + '○'.repeat(Math.max(0, clock.segments - clock.filled));
      row.appendChild(createElement('span', 'attr-list__value attr-list__value--pips', pips));
      rows.push(row);
    }

    const now = gameState.getTicks();
    for (const timer of gameState.getTimers()) {
      if (!timer.label) continue;
      const remaining = Math.max(0, timer.deadline - now);
      const row = createElement('div', 'attr-list__row');
      row.appendChild(createElement('span', 'attr-list__label', timer.label));
      row.appendChild(createElement('span', 'attr-list__value', remaining === 1
        ? this.engine.t('ui.clockTickLeft')
        : this.engine.t('ui.clockTicksLeft', { count: remaining })));
      rows.push(row);
    }

    return rows;
  }
}
