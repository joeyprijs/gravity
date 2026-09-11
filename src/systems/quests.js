import { LOG, MISSION_STATUS } from '../core/config.js';
import { evaluateCondition } from './condition.js';

// Quest triggers and staged missions. All progress lives in the StateManager.
//
// Stages are one-way: a mission starts on its first stage; a stage's
// advanceWhen is re-evaluated on every mutation and the moment the stage
// becomes current, chaining through satisfied stages; advancing past the last
// completes the mission. A stage's rewards fire when it is advanced past;
// stages skipped by a forward jump grant nothing.
export class QuestSystem {
  constructor(engine) {
    this.engine = engine;
    // Rewards granted by an advance re-enter the hook below.
    this._checking = false;

    this.engine.on('scene:entered', ({ scene }) => {
      if (scene.questTrigger) this.handleTrigger(scene.questTrigger);
    });

    this.engine.state.onMutation((method) => {
      // The mission setters run their own checks.
      if (method === 'setMissionStatus' || method === 'setMissionStage') return;
      this.checkAutoAdvance();
    });
  }

  // { mission, status } or { mission, stage }. True when a transition happened.
  handleTrigger(triggerData) {
    if (!triggerData.mission) return false;
    const mId = triggerData.mission;
    const mData = this.engine.data.missions[mId];
    const status = this.engine.state.getMissionStatus(mId);
    // Complete and failed are terminal.
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
    // Re-entering a scene must not re-log the quest.
    if (triggerData.status === MISSION_STATUS.ACTIVE && status === MISSION_STATUS.NOT_STARTED) {
      this.engine.state.setMissionStatus(mId, MISSION_STATUS.ACTIVE);
      this.engine.log(LOG.QUEST, this.engine.t('quest.started', { name: mData.name, description: mData.description }), 'quest');
      // The first stage's objective may already be satisfied.
      this.checkAutoAdvance(mId);
      return true;
    }
    return false;
  }

  // Forward only, so a re-run pipeline never regresses the quest.
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

  // Chains through satisfied stages, for one mission or all.
  checkAutoAdvance(missionId = null) {
    if (this._checking) return;
    this._checking = true;
    try {
      for (const [mId, mData] of Object.entries(this.engine.data.missions ?? {})) {
        if (missionId && mId !== missionId) continue;
        const stages = mData.stages ?? [];
        // Each pass advances one stage.
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

  // Fires fromStage's rewards and enters toStage, or completes the mission.
  _advanceStage(mId, mData, fromStage, toStage) {
    if (!toStage) {
      this.completeMission(mId, mData);
      return;
    }
    if (fromStage?.rewards) this._grantRewards(fromStage.rewards);
    this.engine.state.setMissionStage(mId, toStage.id);
    this.engine.log(LOG.QUEST, this.engine.t('quest.stageAdvanced', { name: mData.name, description: toStage.description }), 'quest');
  }

  // The current stage's rewards, then the mission's own.
  completeMission(mId, mData) {
    const cur = (mData.stages ?? []).find(s => s.id === this.engine.state.getMissionStage(mId));
    this.engine.state.setMissionStatus(mId, MISSION_STATUS.COMPLETE);
    this.engine.log(LOG.QUEST, this.engine.t('quest.completed', { name: mData.name }), 'quest');
    if (cur?.rewards) this._grantRewards(cur.rewards);
    if (mData.missionRewards) this._grantRewards(mData.missionRewards);
  }

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
