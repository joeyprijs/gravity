import { LOG, MISSION_STATUS } from '../core/config.js';
import { evaluateCondition } from './condition.js';

// QuestSystem processes quest triggers — scene questTrigger blocks and the
// questTrigger action — and drives staged missions: explicit forward stage
// jumps, observed advanceWhen conditions, and the terminal complete/failed
// states. All quest progress lives in the StateManager; this class holds none
// of its own.
//
// Stage semantics (all one-way, matching completion):
// - A mission with a `stages` array starts on its first stage at activation.
// - A stage's `advanceWhen` condition is observed: it is re-evaluated on
//   every state mutation AND the moment the stage becomes current, so a
//   player who already satisfies an objective (met the quest-giver late,
//   item already in the bag) advances instantly — chaining through as many
//   stages as are satisfied. Advancement is recorded, not continuously
//   required: once advanced, the condition turning false again never
//   regresses the stage.
// - Advancing past the final stage completes the mission.
// - A stage's `rewards` fire when that stage is completed (advanced past);
//   stages skipped by an explicit forward jump grant nothing.
export class QuestSystem {
  constructor(engine) {
    this.engine = engine;
    // Reentrancy guard: advancing a stage grants rewards (XP, gold) whose
    // own mutations re-enter the hook below.
    this._checking = false;

    this.engine.on('scene:entered', ({ scene }) => {
      if (scene.questTrigger) this.handleTrigger(scene.questTrigger);
    });

    this.engine.state.onMutation((method) => {
      // Skip the mission setters themselves — handleTrigger and the advance
      // path run their own checks at the right moments.
      if (method === 'setMissionStatus' || method === 'setMissionStage') return;
      this.checkAutoAdvance();
    });
  }

  /**
   * Applies a questTrigger block to mission state.
   *
   * @param {{ mission: string, status?: ('active'|'complete'|'failed'), stage?: string }} triggerData
   *   Either a status transition or a forward stage jump (not both).
   * @returns {boolean} True if a mission transition occurred; false if skipped
   *   (unknown mission, terminal status, or no state change needed).
   */
  handleTrigger(triggerData) {
    if (!triggerData.mission) return false;
    const mId = triggerData.mission;
    const mData = this.engine.data.missions[mId];
    const status = this.engine.state.getMissionStatus(mId);
    // Silently skip unknown missions; complete and failed are terminal.
    if (!mData || status === MISSION_STATUS.COMPLETE || status === MISSION_STATUS.FAILED) return false;

    if (triggerData.status === MISSION_STATUS.COMPLETE) {
      this.completeMission(mId, mData);
      return true;
    }
    // Only a mission that is underway can fail.
    if (triggerData.status === MISSION_STATUS.FAILED) {
      if (status !== MISSION_STATUS.ACTIVE) return false;
      this.engine.state.setMissionStatus(mId, MISSION_STATUS.FAILED);
      this.engine.log(LOG.QUEST, this.engine.t('quest.failed', { name: mData.name }), 'quest');
      return true;
    }
    if (triggerData.stage) {
      if (status !== MISSION_STATUS.ACTIVE) return false;
      return this._jumpToStage(mId, mData, triggerData.stage);
    }
    // Only activate a mission that hasn't started yet — re-entering a scene
    // should not re-log the quest description.
    if (triggerData.status === MISSION_STATUS.ACTIVE && status === MISSION_STATUS.NOT_STARTED) {
      this.engine.state.setMissionStatus(mId, MISSION_STATUS.ACTIVE);
      this.engine.log(LOG.QUEST, this.engine.t('quest.started', { name: mData.name, description: mData.description }), 'quest');
      // The first stage's objective may already be satisfied.
      this.checkAutoAdvance(mId);
      return true;
    }
    return false;
  }

  // An explicit stage jump from a trigger. Forward-only: a trigger naming an
  // earlier (or the current) stage is a no-op, so re-running its pipeline
  // never regresses the quest. The stage being left counts as completed —
  // its rewards fire; stages skipped over grant nothing.
  _jumpToStage(mId, mData, targetId) {
    const stages = mData.stages ?? [];
    const targetIdx = stages.findIndex(s => s.id === targetId);
    if (targetIdx < 0) {
      console.warn(`[Gravity] questTrigger: unknown stage "${targetId}" on mission "${mId}"`);
      return false;
    }
    const curIdx = stages.findIndex(s => s.id === this.engine.state.getMissionStage(mId));
    if (targetIdx <= curIdx) return false;
    this._advanceStage(mId, mData, stages[curIdx], stages[targetIdx]);
    return true;
  }

  /**
   * Re-evaluates advanceWhen for active staged missions and advances every
   * stage whose condition holds — chaining, since each new stage may already
   * be satisfied too. Called from the mutation hook and after activation.
   *
   * @param {string|null} [missionId=null] - Limit the check to one mission.
   */
  checkAutoAdvance(missionId = null) {
    if (this._checking) return;
    this._checking = true;
    try {
      for (const [mId, mData] of Object.entries(this.engine.data.missions ?? {})) {
        if (missionId && mId !== missionId) continue;
        const stages = mData.stages ?? [];
        // Bounded by the stage count — each pass advances exactly one stage.
        for (let i = 0; i < stages.length; i++) {
          if (this.engine.state.getMissionStatus(mId) !== MISSION_STATUS.ACTIVE) break;
          const cur = stages.find(s => s.id === this.engine.state.getMissionStage(mId));
          if (!cur?.advanceWhen || !evaluateCondition(cur.advanceWhen, this.engine.state)) break;
          this._advanceStage(mId, mData, cur, stages[stages.indexOf(cur) + 1]);
        }
      }
    } finally {
      this._checking = false;
    }
  }

  // Completes `fromStage` (fires its rewards) and enters `toStage` — or the
  // mission's completion when there is no next stage.
  _advanceStage(mId, mData, fromStage, toStage) {
    if (!toStage) {
      this.completeMission(mId, mData);
      return;
    }
    if (fromStage?.rewards) this._grantRewards(fromStage.rewards);
    this.engine.state.setMissionStage(mId, toStage.id);
    this.engine.log(LOG.QUEST, this.engine.t('quest.stageAdvanced', { name: mData.name, description: toStage.description }), 'quest');
  }

  /**
   * Marks a mission complete, logs the result, and grants rewards: the
   * current stage's (completing the mission finishes that stage too), then
   * the mission's own.
   *
   * @param {string} mId - The mission id.
   * @param {object} mData - The mission definition (name, stages, missionRewards).
   */
  completeMission(mId, mData) {
    const cur = (mData.stages ?? []).find(s => s.id === this.engine.state.getMissionStage(mId));
    this.engine.state.setMissionStatus(mId, MISSION_STATUS.COMPLETE);
    this.engine.log(LOG.QUEST, this.engine.t('quest.completed', { name: mData.name }), 'quest');
    if (cur?.rewards) this._grantRewards(cur.rewards);
    if (mData.missionRewards) this._grantRewards(mData.missionRewards);
  }

  // Grants an { xp, gold } rewards block with its log lines.
  _grantRewards(rewards) {
    if (rewards.xp) {
      this.engine.state.addXP(rewards.xp);
      this.engine.log(LOG.QUEST, this.engine.t('quest.earnedXP', { amount: rewards.xp }), 'loot');
    }
    if (rewards.gold) {
      this.engine.state.modifyPlayerStat('gold', rewards.gold);
      this.engine.log(LOG.QUEST, this.engine.t('quest.earnedGold', { amount: rewards.gold }), 'loot');
    }
  }
}
