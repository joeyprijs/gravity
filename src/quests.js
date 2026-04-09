import { gameState } from "./state.js";

export class QuestSystem {
  constructor(engine) {
    this.engine = engine;
  }

  handleTrigger(triggerData) {
    if (!triggerData.mission) return false;
    const mId = triggerData.mission;
    const mData = this.engine.data.missions[mId];
    if (!mData || gameState.getMissionStatus(mId) === "complete") return false;

    if (triggerData.status === "complete") {
      this.completeMission(mId, mData);
      return true;
    }
    if (triggerData.status === "active" && gameState.getMissionStatus(mId) === "not_started") {
      gameState.setMissionStatus(mId, "active");
      this.engine.log('Quest', `${mData.name}: ${mData.description}`, 'quest');
      return true;
    }
    return false;
  }

  completeMission(mId, mData) {
    gameState.setMissionStatus(mId, "complete");
    this.engine.log("Quest", `Quest complete: ${mData.name}!`, 'quest');
    if (mData.missionRewards?.xp) {
      gameState.addXP(mData.missionRewards.xp);
      this.engine.log("Quest", `Earned ${mData.missionRewards.xp} XP.`, 'loot');
    }
    if (mData.missionRewards?.gold) {
      gameState.modifyPlayerStat('gold', mData.missionRewards.gold);
      this.engine.log("Quest", `Earned ${mData.missionRewards.gold} Gold.`, 'loot');
    }
    gameState.forceUpdate();
  }
}
