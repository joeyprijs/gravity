import { createElement, buildCard } from '../core/utils.js';
import { CSS, EL, MISSION_STATUS } from '../core/config.js';

// QuestUI renders the quest log sidebar panel.
export class QuestUI {
  constructor(engine) {
    this.engine = engine;
  }

  /**
   * Renders the quest log: one card section per mission status — active,
   * completed, failed — and an empty note when no quest has surfaced yet.
   *
   * @param {Set<string>|null} [newQuests] - Mission ids that progressed since
   *   the player last viewed the tab; their cards wear the "new" dot.
   */
  render(newQuests = null) {
    const panel = document.getElementById(EL.TAB_QUESTS);
    if (!panel) return;
    panel.innerHTML = '';

    // A started/completed quest wears a dot until the player rests the pointer
    // on its card (see UIManager.setup) or leaves the tab. The card names its
    // mission in the dataset — that's what the hover handler acknowledges.
    // An active staged quest shows its current objective as a second body line.
    const buildQuestCard = (id, mission, { done = false, stageDesc = null } = {}) => {
      const card = buildCard({
        tag: 'li',
        title: mission.name,
        body: stageDesc ? [mission.description, stageDesc] : mission.description,
        classes: [done ? CSS.CARD_DONE : null, newQuests?.has(id) ? CSS.CARD_NEW : null].filter(Boolean),
      });
      card.dataset.mission = id;
      return card;
    };

    const groups = {
      [MISSION_STATUS.ACTIVE]: [],
      [MISSION_STATUS.COMPLETE]: [],
      [MISSION_STATUS.FAILED]: [],
    };

    for (const [id, mission] of Object.entries(this.engine.data.missions)) {
      const status = this.engine.state.getMissionStatus(id);
      const cards = groups[status];
      if (!cards) continue;

      if (status === MISSION_STATUS.ACTIVE) {
        const stage = (mission.stages ?? []).find(s => s.id === this.engine.state.getMissionStage(id));
        cards.push(buildQuestCard(id, mission, { stageDesc: stage?.description }));
      } else {
        cards.push(buildQuestCard(id, mission, { done: true }));
      }
    }

    const sections = [
      ['ui.questsActive', groups[MISSION_STATUS.ACTIVE]],
      ['ui.questsCompleted', groups[MISSION_STATUS.COMPLETE]],
      ['ui.questsFailed', groups[MISSION_STATUS.FAILED]],
    ];

    for (const [headingKey, cards] of sections) {
      if (!cards.length) continue;

      const section = createElement('div', CSS.PANEL_SECTION);
      const list = createElement('ul', CSS.CARD_LIST);

      section.appendChild(createElement('div', CSS.SECTION_HEADING, this.engine.t(headingKey)));
      cards.forEach(card => list.appendChild(card));
      section.appendChild(list);
      panel.appendChild(section);
    }

    if (sections.every(([, cards]) => !cards.length)) {
      const section = createElement('div', CSS.PANEL_SECTION);
      section.appendChild(createElement('p', CSS.CARD_BODY, this.engine.t('ui.questsNone')));
      panel.appendChild(section);
    }
  }
}
