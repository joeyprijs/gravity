import { MSG } from "./config.js";

const MAX_LOG_ENTRIES = 200;

// Increment when the save schema changes. loadFromObject() migrates older saves
// forward so they remain compatible. Each migration function receives the raw
// parsed data object and mutates it in-place.
const SAVE_VERSION = 7;

const MIGRATIONS = {
  // v0 → v1: added player.name
  1: (data) => {
    if (!data.player) data.player = {};
    if (data.player.name === undefined) data.player.name = "";
  },
  // v1 → v2: added museumChest, visitedScenes, log
  2: (data) => {
    if (!data.museumChest)   data.museumChest   = [];
    if (!data.visitedScenes) data.visitedScenes = [];
    if (!data.log)           data.log           = [];
  },
  // v2 → v3: removed baseAcBonus (AC is now stored directly on player.ac)
  3: (data) => {
    if (data.player) delete data.player.baseAcBonus;
  },
  // --- D&D prototype historical debt (v3–v6) ---
  // These migrations are game-specific and would be omitted in a clean engine
  // distribution. Plugin-based games should use registerMigration() instead.
  // v3 → v4: renamed player.level → player.reputation
  4: (data) => {
    if (data.player && data.player.level !== undefined) {
      data.player.reputation = data.player.level;
      delete data.player.level;
    }
  },
  // v4 → v5: re-introduced player.level as separate progression stat
  5: (data) => {
    if (data.player && data.player.level === undefined) data.player.level = 1;
  },
  // v5 → v6: renamed player.reputation → player.charisma
  6: (data) => {
    if (data.player && data.player.reputation !== undefined) {
      data.player.charisma = data.player.reputation;
      delete data.player.reputation;
    }
  },
  // v6 → v7: restructure flat player stats into resources/attributes sub-objects
  7: (data) => {
    const p = data.player;
    if (!p || p.resources) return; // already migrated or no player
    p.resources = {
      hp:   { current: p.hp   ?? 10, max: p.maxHp ?? 10 },
      ap:   { current: p.ap   ?? 3,  max: p.maxAp ?? 3  },
      gold: p.gold ?? 0
    };
    p.attributes = {
      ac:         p.ac         ?? 10,
      initiative: p.initiative ?? 0,
      perception: p.perception ?? 0,
      charisma:   p.charisma   ?? 0,
      sneak:      p.sneak      ?? 0
    };
    ['hp', 'maxHp', 'ap', 'maxAp', 'gold', 'ac', 'initiative', 'perception', 'charisma', 'sneak']
      .forEach(k => delete p[k]);
  },
};

function migrate(data, extraMigrations = {}) {
  const from = data.saveVersion ?? 0;
  const allMigrations = { ...MIGRATIONS, ...extraMigrations };
  const maxVersion = Math.max(SAVE_VERSION, ...Object.keys(extraMigrations).map(Number));
  for (let v = from + 1; v <= maxVersion; v++) {
    if (allMigrations[v]) allMigrations[v](data);
  }
  data.saveVersion = maxVersion;
}

function makeDefaultState(rules) {
  return {
    saveVersion: SAVE_VERSION,
    player: JSON.parse(JSON.stringify(rules.playerDefaults)),
    flags: {},
    missions: {},
    currentSceneId: rules.startingScene || null,
    returnSceneId: null,
    museumChest: [],
    visitedScenes: [],
    log: []
  };
}

// StateManager is the single source of truth for all mutable game data.
// All writes go through its methods, which call notifyListeners() so the UI
// stays in sync automatically. The state object is serialised for save files.
class StateManager {
  constructor() {
    // Minimal skeleton state. Properly initialised by init(rules) once
    // rules.json is loaded. This skeleton is sufficient for registerMissions()
    // and registerSceneFlags() which are called during data loading.
    this.state = {
      saveVersion: SAVE_VERSION,
      player: {},
      flags: {},
      missions: {},
      currentSceneId: null,
      returnSceneId: null,
      museumChest: [],
      visitedScenes: [],
      log: []
    };
    this.listeners = [];
    this._rules = null;
    this._extraMigrations = {};
  }

  // Called by the engine after rules.json is loaded. Replaces the skeleton
  // state with a proper default state derived from the rules. Must be called
  // before any gameplay code accesses the player object.
  init(rules) {
    this._rules = rules;
    this.state = makeDefaultState(rules);
  }

  // Plugin hook: register a migration for a version above the core SAVE_VERSION.
  // Plugins that change their own save data call this during their register() fn.
  registerMigration(version, fn) {
    this._extraMigrations[version] = fn;
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
    // Run schema migrations so older saves stay compatible.
    migrate(parsedData, this._extraMigrations);

    // Strip the "game loaded" notification from the restored log so it doesn't
    // appear as a duplicate each time the player loads a save.
    parsedData.log = parsedData.log.filter(e => e.message !== MSG.GAME_LOADED);
    this.state = parsedData;
    this.notifyListeners();
  }

  appendLog(entry) {
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG_ENTRIES) {
      this.state.log.shift();
    }
  }
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

  // Called once on startup with the flags declared in data/flags.json.
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
    this.state = makeDefaultState(this._rules);
    if (this.sceneFlags) Object.assign(this.state.flags, this.sceneFlags);
    this.notifyListeners();
  }

  getFlag(flagName) { return this.state.flags[flagName] ?? false; }
  setFlag(flagName, value) { this.state.flags[flagName] = value; }

  getPlayer() { return this.state.player; }

  // Modifies a player stat by the given amount.
  // Accepts convenience names ('hp', 'ap', 'maxHp', 'maxAp', 'gold') or any
  // attribute name ('ac', 'charisma', 'perception', etc.). Resources are clamped.
  modifyPlayerStat(stat, amount) {
    const p = this.state.player;
    switch (stat) {
      case 'hp':
        p.resources.hp.current = Math.max(0, Math.min(p.resources.hp.current + amount, p.resources.hp.max));
        break;
      case 'maxHp':
        p.resources.hp.max += amount;
        break;
      case 'ap':
        p.resources.ap.current = Math.max(0, Math.min(p.resources.ap.current + amount, p.resources.ap.max));
        break;
      case 'maxAp':
        p.resources.ap.max += amount;
        break;
      case 'gold':
        p.resources.gold += amount;
        break;
      default:
        if (p.attributes && stat in p.attributes) {
          p.attributes[stat] += amount;
        }
        break;
    }
    this.notifyListeners('stats');
  }

  // Awards XP and handles level-up. XP threshold scales with level so each
  // level requires more XP than the last (threshold = level × xpPerLevel).
  // Surplus XP carries over and can trigger multiple level-ups in one call.
  addXP(amount) {
    const p = this.state.player;
    p.xp += amount;
    let threshold = p.level * this._rules.xpPerLevel;
    while (p.xp >= threshold) {
      p.xp -= threshold;
      p.level++;
      p.resources.hp.max += this._rules.levelUpHpBonus;
      p.resources.hp.current = p.resources.hp.max;
      threshold = p.level * this._rules.xpPerLevel;
    }
    this.notifyListeners('stats');
  }

  addToInventory(itemId, amount = 1, { silent = false } = {}) {
    const existing = this.state.player.inventory.find(i => i.item === itemId);
    if (existing) existing.amount += amount;
    else this.state.player.inventory.push({ item: itemId, amount });
    if (!silent) this.notifyListeners('inventory');
  }

  removeFromInventory(itemId, amount = 1, { silent = false } = {}) {
    const existing = this.state.player.inventory.find(i => i.item === itemId);
    if (existing) {
      existing.amount -= amount;
      if (existing.amount <= 0) {
        this.state.player.inventory = this.state.player.inventory.filter(i => i.item !== itemId);
      }
    }
    if (!silent) this.notifyListeners('inventory');
  }

  equipItem(slot, itemId) {
    if (this.state.player.equipment[slot]) {
      this.addToInventory(this.state.player.equipment[slot], 1, { silent: true });
    }
    if (itemId) {
      this.removeFromInventory(itemId, 1, { silent: true });
    }
    this.state.player.equipment[slot] = itemId;
    this.notifyListeners('inventory');
  }

  getMissionStatus(missionId) { return this.state.missions[missionId] || "not_started"; }
  setMissionStatus(missionId, status) { this.state.missions[missionId] = status; this.notifyListeners('quests'); }

  getCurrentSceneId() { return this.state.currentSceneId; }
  setCurrentSceneId(sceneId) { this.state.currentSceneId = sceneId; this.notifyListeners('map'); }

  getVisitedScenes() { return this.state.visitedScenes; }
  // Intentionally no notifyListeners() — scene rendering drives its own display
  // update, and triggering a full UI re-render here would be redundant.
  addVisitedScene(sceneId) {
    if (!this.state.visitedScenes.includes(sceneId)) {
      this.state.visitedScenes.push(sceneId);
    }
  }

  getReturnSceneId() { return this.state.returnSceneId; }
  setReturnSceneId(sceneId) { this.state.returnSceneId = sceneId; }

  getMuseumChest() { return this.state.museumChest; }

  depositToChest(itemId, amount = 1) {
    const existing = this.state.museumChest.find(i => i.item === itemId);
    if (existing) {
      existing.amount += amount;
    } else {
      this.state.museumChest.push({ item: itemId, amount: amount });
    }
    this.removeFromInventory(itemId, amount, { silent: true });
    this.notifyListeners('inventory');
  }

  withdrawFromChest(itemId, amount = 1) {
    const existing = this.state.museumChest.find(i => i.item === itemId);
    if (!existing) return;
    existing.amount -= amount;
    if (existing.amount <= 0) {
      this.state.museumChest = this.state.museumChest.filter(i => i.item !== itemId);
    }
    this.addToInventory(itemId, amount, { silent: true });
    this.notifyListeners('inventory');
  }

  subscribe(callback) { this.listeners.push(callback); }
  notifyListeners(hint) { this.listeners.forEach(cb => cb(this.state, hint)); }
  forceUpdate(hint) { this.notifyListeners(hint); }
}

export const gameState = new StateManager();
