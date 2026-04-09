import { gameState } from "./state.js";

// QuestSystem processes quest triggers that are embedded in scene JSON and
// fires the appropriate state transitions (not_started → active → complete).
// All quest progress is stored in gameState; this class holds no state of its own.
export class QuestSystem {
  constructor(engine) {
    this.engine = engine;
  }

  // Called by SceneRenderer when a scene has a questsTriggeredOnEntry block.
  // triggerData: { mission: <id>, status: "active" | "complete" }
  // Returns true if a transition occurred, false if the trigger was skipped.
  handleTrigger(triggerData) {
    if (!triggerData.mission) return false;
    const mId = triggerData.mission;
    const mData = this.engine.data.missions[mId];
    // Silently skip unknown missions and already-completed ones (completion is one-way).
    if (!mData || gameState.getMissionStatus(mId) === "complete") return false;

    if (triggerData.status === "complete") {
      this.completeMission(mId, mData);
      return true;
    }
    // Only activate a mission that hasn't started yet — re-entering a scene
    // should not re-log the quest description.
    if (triggerData.status === "active" && gameState.getMissionStatus(mId) === "not_started") {
      gameState.setMissionStatus(mId, "active");
      this.engine.log('Quest', `${mData.name}: ${mData.description}`, 'quest');
      return true;
    }
    return false;
  }

  // Marks a mission complete, logs the result, and grants any XP/gold rewards.
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
    // forceUpdate() so the quest log panel and stat bars reflect rewards immediately.
    gameState.forceUpdate();
  }
}
