import { LEVELUP_HP_BONUS, XP_PER_LEVEL, PLAYER_DEFAULTS, STARTING_SCENE, MSG } from "./config.js";

const DEFAULT_STATE = {
  player: PLAYER_DEFAULTS,
  flags: {},
  missions: {},
  currentSceneId: STARTING_SCENE,
  returnSceneId: null,
  museumChest: [],
  visitedScenes: [],
  log: []
};

// StateManager is the single source of truth for all mutable game data.
// All writes go through its methods, which call notifyListeners() so the UI
// stays in sync automatically. The state object is serialised for save files.
class StateManager {
  constructor() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.listeners = [];
  }

  downloadSave() {
    const jsonStr = JSON.stringify(this.state);

    // Encode to UTF-8 bytes then base64. TextEncoder + forEach avoids the
    // deprecated unescape() and is safe for all Unicode characters. The
    // spread-operator alternative (...bytes) can overflow the stack on large
    // saves, so we use a manual loop instead.
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const encoded = btoa(binary);

    const blob = new Blob([encoded], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    const name = `Gravity_${y}${m}${d}_${h}${min}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  loadFromObject(parsedData) {
    if (!parsedData.museumChest) parsedData.museumChest = [];
    if (!parsedData.visitedScenes) parsedData.visitedScenes = [];
    if (!parsedData.log) parsedData.log = [];
    // Strip the "game loaded" notification from the restored log so it doesn't
    // appear as a duplicate each time the player loads a save.
    parsedData.log = parsedData.log.filter(e => e.message !== MSG.GAME_LOADED);
    this.state = parsedData;
    this.notifyListeners();
  }

  appendLog(entry) { this.state.log.push(entry); }
  getLog() { return this.state.log; }

  // Called once on startup to ensure every mission ID exists in state.
  // Skips missions already present so loaded saves are not overwritten.
  registerMissions(missionsData) {
    Object.keys(missionsData).forEach(missionId => {
      if (!(missionId in this.state.missions)) {
        this.state.missions[missionId] = "not_started";
      }
    });
  }

  // Called once on startup with all requiredState flags collected from scene JSON.
  // Only sets flags that don't yet exist in state so loaded saves are preserved.
  // Also keeps a copy in this.sceneFlags so reset() can re-apply them.
  registerSceneFlags(flagsMap) {
    this.sceneFlags = { ...flagsMap };
    Object.entries(flagsMap).forEach(([flag, value]) => {
      if (!(flag in this.state.flags)) this.state.flags[flag] = value;
    });
  }

  // Wipes all state back to defaults and re-applies the scene flags so that
  // the initial option visibility is correct immediately after a restart.
  reset() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    if (this.sceneFlags) Object.assign(this.state.flags, this.sceneFlags);
    this.notifyListeners();
  }

  getFlag(flagName) { return this.state.flags[flagName] || false; }
  setFlag(flagName, value) { this.state.flags[flagName] = value; this.notifyListeners(); }

  getPlayer() { return this.state.player; }

  modifyPlayerStat(stat, amount) {
    this.state.player[stat] += amount;
    if (stat === "hp" && this.state.player.hp > this.state.player.maxHp) this.state.player.hp = this.state.player.maxHp;
    if (stat === "hp" && this.state.player.hp < 0) this.state.player.hp = 0;
    if (stat === "ap" && this.state.player.ap > this.state.player.maxAp) this.state.player.ap = this.state.player.maxAp;
    if (stat === "ap" && this.state.player.ap < 0) this.state.player.ap = 0;
    this.notifyListeners();
  }

  // Awards XP and handles level-up. XP threshold scales with level so each
  // level requires more XP than the last (threshold = level × XP_PER_LEVEL).
  // On level-up: surplus XP is NOT carried over, HP is fully restored.
  addXP(amount) {
    this.state.player.xp += amount;
    const threshold = this.state.player.level * XP_PER_LEVEL;
    if (this.state.player.xp >= threshold) {
      this.state.player.xp -= threshold;
      this.state.player.level++;
      this.state.player.maxHp += LEVELUP_HP_BONUS;
      this.state.player.hp = this.state.player.maxHp;
    }
    this.notifyListeners();
  }

  addToInventory(itemId, amount = 1) {
    const existing = this.state.player.inventory.find(i => i.item === itemId);
    if (existing) existing.amount += amount;
    else this.state.player.inventory.push({ item: itemId, amount });
    this.notifyListeners();
  }

  removeFromInventory(itemId, amount = 1) {
    const existing = this.state.player.inventory.find(i => i.item === itemId);
    if (existing) {
      existing.amount -= amount;
      if (existing.amount <= 0) {
        this.state.player.inventory = this.state.player.inventory.filter(i => i.item !== itemId);
      }
    }
    this.notifyListeners();
  }

  equipItem(slot, itemId) {
    if (this.state.player.equipment[slot]) {
      this.addToInventory(this.state.player.equipment[slot], 1);
    }
    if (itemId) {
      this.removeFromInventory(itemId, 1);
    }
    this.state.player.equipment[slot] = itemId;
    this.notifyListeners();
  }

  getMissionStatus(missionId) { return this.state.missions[missionId] || "not_started"; }
  setMissionStatus(missionId, status) { this.state.missions[missionId] = status; this.notifyListeners(); }

  getCurrentSceneId() { return this.state.currentSceneId; }
  setCurrentSceneId(sceneId) { this.state.currentSceneId = sceneId; this.notifyListeners(); }

  getVisitedScenes() { return this.state.visitedScenes; }
  // Intentionally no notifyListeners() — scene rendering drives its own display
  // update, and triggering a full UI re-render here would be redundant.
  addVisitedScene(sceneId) {
    if (!this.state.visitedScenes.includes(sceneId)) {
      this.state.visitedScenes.push(sceneId);
    }
  }

  getReturnSceneId() { return this.state.returnSceneId; }
  setReturnSceneId(sceneId) { this.state.returnSceneId = sceneId; this.notifyListeners(); }

  getMuseumChest() { return this.state.museumChest; }

  depositToChest(itemId, amount = 1) {
    const existing = this.state.museumChest.find(i => i.item === itemId);
    if (existing) {
      existing.amount += amount;
    } else {
      this.state.museumChest.push({ item: itemId, amount: amount });
    }
    this.removeFromInventory(itemId, amount);
  }

  withdrawFromChest(itemId, amount = 1) {
    const existing = this.state.museumChest.find(i => i.item === itemId);
    if (!existing) return;
    existing.amount -= amount;
    if (existing.amount <= 0) {
      this.state.museumChest = this.state.museumChest.filter(i => i.item !== itemId);
    }
    this.addToInventory(itemId, amount);
  }

  subscribe(callback) { this.listeners.push(callback); }
  notifyListeners() { this.listeners.forEach(cb => cb(this.state)); }
  forceUpdate() { this.notifyListeners(); }
}

export const gameState = new StateManager();
