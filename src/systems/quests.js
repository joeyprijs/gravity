import { gameState } from "../core/state.js";
import { LOG, MISSION_STATUS } from "../core/config.js";

// QuestSystem processes quest triggers that are embedded in scene JSON and
// fires the appropriate state transitions (not_started → active → complete).
// All quest progress is stored in gameState; this class holds no state of its own.
export class QuestSystem {
  constructor(engine) {
    this.engine = engine;

    this.engine.on('scene:entered', ({ scene }) => {
      if (scene.questTrigger) this.handleTrigger(scene.questTrigger);
    });
  }

  /**
   * Applies a scene's questTrigger block to mission state.
   *
   * @param {{ mission: string, status: ('active'|'complete') }} triggerData - The trigger.
   * @returns {boolean} True if a mission transition occurred; false if skipped
   *   (unknown mission, already complete, or no state change needed).
   */
  handleTrigger(triggerData) {
    if (!triggerData.mission) return false;
    const mId = triggerData.mission;
    const mData = this.engine.data.missions[mId];
    // Silently skip unknown missions and already-completed ones (completion is one-way).
    if (!mData || gameState.getMissionStatus(mId) === MISSION_STATUS.COMPLETE) return false;

    if (triggerData.status === MISSION_STATUS.COMPLETE) {
      this.completeMission(mId, mData);
      return true;
    }
    // Only activate a mission that hasn't started yet — re-entering a scene
    // should not re-log the quest description.
    if (triggerData.status === MISSION_STATUS.ACTIVE && gameState.getMissionStatus(mId) === MISSION_STATUS.NOT_STARTED) {
      gameState.setMissionStatus(mId, MISSION_STATUS.ACTIVE);
      this.engine.log(LOG.QUEST, this.engine.t('quest.started', { name: mData.name, description: mData.description }), 'quest');
      return true;
    }
    return false;
  }

  /**
   * Marks a mission complete, logs the result, and grants any XP/gold rewards.
   *
   * @param {string} mId - The mission id.
   * @param {object} mData - The mission definition (name, missionRewards).
   */
  completeMission(mId, mData) {
    gameState.setMissionStatus(mId, MISSION_STATUS.COMPLETE);
    this.engine.log(LOG.QUEST, this.engine.t('quest.completed', { name: mData.name }), 'quest');
    if (mData.missionRewards?.xp) {
      gameState.addXP(mData.missionRewards.xp);
      this.engine.log(LOG.QUEST, this.engine.t('quest.earnedXP', { amount: mData.missionRewards.xp }), 'loot');
    }
    if (mData.missionRewards?.gold) {
      gameState.modifyPlayerStat('gold', mData.missionRewards.gold);
      this.engine.log(LOG.QUEST, this.engine.t('quest.earnedGold', { amount: mData.missionRewards.gold }), 'loot');
    }
    // forceUpdate() so the quest log panel and stat bars reflect rewards immediately.
    gameState.forceUpdate();
  }
}
