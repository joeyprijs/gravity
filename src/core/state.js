import { MISSION_STATUS } from "./config.js";
import { equipmentAttributeBonuses, getByPath, setByPath } from "./utils.js";

const MAX_LOG_ENTRIES = 200;

// Increment when the save schema changes. loadFromObject() migrates older saves
// forward so they remain compatible. Each migration function receives the raw
// parsed data object and mutates it in-place.
const SAVE_VERSION = 4;

const MIGRATIONS = {
  // v0 → v1: player.name was added; give it an empty default on older saves.
  1: (data) => { if (!('name' in data.player)) data.player.name = ''; },
  // v1 → v2: museumChest array moved into generic chests map.
  2: (data) => {
    if ('museumChest' in data) {
      data.chests = { museum: data.museumChest };
      delete data.museumChest;
    } else {
      data.chests = {};
    }
  },
  // v2 → v3: displays map added for dynamic exhibits curation.
  3: (data) => {
    if (!('displays' in data)) {
      data.displays = {};
    }
  },
  // v3 → v4: world clock and timers added.
  4: (data) => {
    if (!('time' in data)) data.time = { ticks: 0 };
    if (!('timers' in data)) data.timers = [];
  },
};

function migrate(data, extraMigrations = {}) {
  const from = data.saveVersion ?? 0;
  const allMigrations = { ...MIGRATIONS, ...extraMigrations };
  const maxVersion = Math.max(SAVE_VERSION, ...Object.keys(extraMigrations).map(Number));
  // A save from a newer engine (from >= maxVersion) is already current or ahead;
  // leave it untouched rather than re-running migrations or rewriting its
  // version backwards.
  if (from >= maxVersion) return;
  for (let v = from + 1; v <= maxVersion; v++) {
    if (allMigrations[v]) allMigrations[v](data);
  }
  data.saveVersion = maxVersion;
}

function makeDefaultState(rules) {
  const player = structuredClone(rules.playerDefaults);
  (rules.customAttributes ?? []).forEach(attr => {
    player.attributes[attr.id] = attr.default ?? 0;
  });
  // Banked level-up stat points (rules.levelUp.statPoints per level).
  player.statPoints = 0;
  return {
    saveVersion: SAVE_VERSION,
    player,
    flags: {},
    checkState: {},
    missions: {},
    currentSceneId: rules.startingScene || null,
    returnSceneId: null,
    chests: {},
    displays: {},
    visitedScenes: [],
    time: { ticks: 0 },
    timers: [],
    log: []
  };
}

// The state.flags prefixes that historically held check bookkeeping — used by
// loadFromObject to normalize older saves into state.checkState.
const LEGACY_CHECK_PREFIXES = ['skill_dc_', 'dialogue_dc_', 'dialogue_resolved_'];

// StateManager is the single source of truth for all mutable game data.
// All writes go through its methods, which call notifyListeners() so the UI
// stays in sync automatically. The state object is serialized for save files.
class StateManager {
  constructor() {
    // Minimal skeleton state. Properly initialized by init(rules) once
    // rules.json is loaded. This skeleton is sufficient for registerMissions()
    // and registerSceneFlags() which are called during data loading.
    this.state = {
      saveVersion: SAVE_VERSION,
      player: {},
      flags: {},
      checkState: {},
      missions: {},
      currentSceneId: null,
      returnSceneId: null,
      chests: {},
      displays: {},
      visitedScenes: [],
      time: { ticks: 0 },
      timers: [],
      log: []
    };
    this.listeners = [];
    this._rules = null;
    this._items = {};
    this._extraMigrations = {};
    this._mutationHooks = [];
    this._statHandlers = {};
  }

  // ── Plugin lifecycle hooks ──────────────────────────────────────────────
  // The formal alternative to wrapping StateManager methods on the live
  // singleton: plugins observe mutations and intercept custom stats through
  // these registrations instead.

  /**
   * Registers a hook called after a state mutation completes (and after its
   * notifyListeners call). Guard-rejected calls (e.g. addToInventory of an
   * unknown item) do not emit. Hooks may themselves mutate state — but must
   * not call the method they are hooked on.
   *
   * Emitting methods: init, loadFromObject, reset, modifyPlayerStat,
   * modifyPlayerStats, addXP, spendStatPoint, applyCharCreation,
   * addToInventory, removeFromInventory, equipItem, placeItemInDisplay,
   * takeItemFromDisplay, advanceTime.
   *
   * @param {(method: string, info: object) => void} fn - Receives the
   *   StateManager method name and an info object with its relevant arguments
   *   (e.g. { itemId, amount } for addToInventory).
   */
  onMutation(fn) {
    this._mutationHooks.push(fn);
  }

  _emitMutation(method, info = {}) {
    this._mutationHooks.forEach(fn => fn(method, info));
  }

  /**
   * Registers an interceptor for modifyPlayerStat(stat, amount). When a
   * handler exists for the stat it fully replaces the default behavior,
   * including listener notification. Used by plugins that derive a stat
   * instead of storing it directly (e.g. the curator plugin's reputation).
   *
   * @param {string} stat - The stat name to intercept.
   * @param {(amount: number) => void} fn - Receives the delta passed to modifyPlayerStat.
   */
  registerStatHandler(stat, fn) {
    this._statHandlers[stat] = fn;
  }

  /**
   * Sets a player attribute to an absolute value (modifyPlayerStat is
   * delta-based). Creates the attribute if it does not exist yet.
   *
   * @param {string} attr - The attribute name (e.g. 'reputation').
   * @param {number} value - The new absolute value.
   */
  setPlayerAttribute(attr, value) {
    if (!this.state.player?.attributes) return;
    this.state.player.attributes[attr] = value;
    this.notifyListeners('stats');
  }

  /**
   * Called by the engine after rules.json is loaded. Replaces the skeleton
   * state with a proper default state derived from the rules. Must be called
   * before any gameplay code accesses the player object.
   *
   * @param {object} rules - The parsed rules.json (playerDefaults, xpPerLevel, …).
   * @param {Object<string, object>} [items] - The item database (engine.data.items).
   *   When provided, addToInventory rejects IDs that are not in it.
   */
  init(rules, items = {}) {
    this._rules = rules;
    this._items = items;
    this.state = makeDefaultState(rules);
    this._emitMutation('init', { rules, items });
  }

  /**
   * Plugin hook: registers a migration for a version above the core SAVE_VERSION.
   * Plugins that change their own save data call this during their register() fn.
   *
   * Throws on a version collision: a plugin migration registered at (or below)
   * a core version would silently shadow the core migration in migrate()'s
   * merge, so saves would skip core steps — fail loudly at registration instead.
   *
   * @param {number} version - The save version this migration produces.
   * @param {(data: object) => void} fn - Mutates the raw parsed save object in place.
   */
  registerMigration(version, fn) {
    if (version <= SAVE_VERSION) {
      throw new Error(`[Gravity] registerMigration: version ${version} collides with a core migration (core SAVE_VERSION is ${SAVE_VERSION}) — use a higher version`);
    }
    if (version in this._extraMigrations) {
      throw new Error(`[Gravity] registerMigration: version ${version} is already registered`);
    }
    this._extraMigrations[version] = fn;
  }

  /**
   * Returns the state serialized as a base64-encoded save string. The
   * download mechanics (Blob, anchor click) live in the UI layer so this
   * module stays headless — see UIManager's save handler.
   *
   * @returns {string} Base64-encoded UTF-8 JSON of the full state.
   */
  getSaveString() {
    const jsonStr = JSON.stringify(this.state);

    // Encode to UTF-8 bytes then base64. TextEncoder + forEach avoids the
    // deprecated unescape() and is safe for all Unicode characters. The
    // spread-operator alternative (...bytes) can overflow the stack on large
    // saves, so we use a manual loop instead.
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  /**
   * Replaces the entire state with a parsed save object, migrating older
   * save versions forward first. Notifies all listeners.
   *
   * @param {object} parsedData - The parsed save JSON (see getSaveString).
   * @returns {boolean} True if the save was applied; false if it was rejected
   *   as malformed (callers can surface a clean error instead of crashing).
   */
  loadFromObject(parsedData) {
    // Saves are user-supplied files and may be hand-edited or corrupt. Reject a
    // structurally invalid save before committing to it, so a bad load fails
    // cleanly instead of throwing mid-migration with state half-replaced.
    if (!parsedData || typeof parsedData !== 'object'
        || typeof parsedData.player !== 'object' || parsedData.player === null
        || !Array.isArray(parsedData.log)) {
      console.warn('[Gravity] loadFromObject: save data is missing required fields; load aborted.');
      return false;
    }

    // Run schema migrations so older saves stay compatible.
    migrate(parsedData, this._extraMigrations);

    // Seed resources the rules declare but the save predates (e.g. a game
    // that adds a resource after players already have saves). Rules-driven
    // rather than a numbered migration, since which resources exist is per-game data.
    const ruleResources = this._rules?.playerDefaults?.resources;
    if (ruleResources && parsedData.player.resources) {
      for (const [key, value] of Object.entries(ruleResources)) {
        if (!(key in parsedData.player.resources)) {
          parsedData.player.resources[key] = structuredClone(value);
        }
      }
    }

    // Same for attributes the rules declare but the save predates (e.g.
    // strength/intelligence added after release) — without the backfill,
    // stat points can never be spent on them and attacks roll +0 forever.
    if (parsedData.player.attributes) {
      for (const attr of (this._rules?.customAttributes ?? [])) {
        if (!(attr.id in parsedData.player.attributes)) {
          parsedData.player.attributes[attr.id] = attr.default ?? 0;
        }
      }
    }
    // And the banked stat-point counter (added with rules.levelUp).
    parsedData.player.statPoints ??= 0;

    // Check bookkeeping lives in state.checkState, not state.flags. Older
    // saves stored it under prefixed flag keys — move those over. Done as an
    // unconditional, idempotent normalization rather than a numbered
    // migration: save versions can't distinguish interim builds that stamped
    // a current version while still writing check state into flags.
    if (!parsedData.checkState) parsedData.checkState = {};
    for (const key of Object.keys(parsedData.flags ?? {})) {
      if (LEGACY_CHECK_PREFIXES.some(p => key.startsWith(p))) {
        parsedData.checkState[key] ??= parsedData.flags[key];
        delete parsedData.flags[key];
      }
    }

    this.state = parsedData;
    this.notifyListeners();
    this._emitMutation('loadFromObject');
    return true;
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
        this.state.missions[missionId] = MISSION_STATUS.NOT_STARTED;
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
    this._emitMutation('reset');
  }

  getFlag(flagName) { return this.state.flags[flagName] ?? false; }
  setFlag(flagName, value) { this.state.flags[flagName] = value; }

  // ── Check bookkeeping ─────────────────────────────────────────────────────
  // The engine-private skill-check state maps (attempt counts, resolution
  // markers, discovery progress), keyed by the CHECK_KEYS builders. Like
  // setFlag, writes deliberately do not notify: check state only surfaces
  // through re-renders the check flow itself drives.

  /** @returns {*} The stored check-state entry, or undefined. */
  getCheckState(key) { return this.state.checkState[key]; }
  setCheckState(key, value) { this.state.checkState[key] = value; }

  /** @returns {object|null} The loaded rules object (null before init). */
  getRules() { return this._rules; }

  // ── World clock & timers ──────────────────────────────────────────────────
  // The clock is a single monotonic tick counter; days and segments are
  // derived presentation (see systems/time.js). Time only moves through
  // advanceTime — never from wall-clock — so saves replay deterministically.

  /** @returns {number} Absolute ticks elapsed since the game started. */
  getTicks() { return this.state.time?.ticks ?? 0; }

  /**
   * Advances the world clock and collects the timers that came due, in
   * deadline order. The engine's advanceTime delegate runs their pipelines —
   * StateManager stays free of action handling.
   *
   * @param {number} amount - Ticks to advance (non-positive amounts are ignored).
   * @returns {Array<{id: string, deadline: number, actions: object[]}>} Fired timers.
   */
  advanceTime(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return [];
    if (!this.state.time) this.state.time = { ticks: 0 };
    this.state.time.ticks += amount;
    const now = this.state.time.ticks;

    const timers = this.state.timers || [];
    const due = timers.filter(t => t.deadline <= now).sort((a, b) => a.deadline - b.deadline);
    if (due.length) this.state.timers = timers.filter(t => t.deadline > now);

    this.notifyListeners('time');
    this._emitMutation('advanceTime', { amount, ticks: now });
    return due;
  }

  /**
   * Arms (or re-arms) a timer. A timer with the same id replaces the old one.
   * @param {{id: string, deadline: number, actions: object[]}} timer
   */
  setTimer(timer) {
    if (!timer?.id) return;
    if (!this.state.timers) this.state.timers = [];
    this.state.timers = this.state.timers.filter(t => t.id !== timer.id);
    this.state.timers.push(timer);
  }

  /**
   * Disarms a timer by id. Unknown ids are a no-op.
   * @param {string} id
   */
  cancelTimer(id) {
    if (!this.state.timers) return;
    this.state.timers = this.state.timers.filter(t => t.id !== id);
  }

  getPlayer() { return this.state.player; }

  /**
   * Modifies a player stat by the given amount. Accepts convenience names
   * ('hp', 'ap', 'maxHp', 'maxAp', 'gold') or any attribute name ('ac',
   * 'charisma', 'perception', …). hp/ap are clamped to [0, max]. Stats with a
   * registered stat handler are delegated to it instead.
   *
   * @param {string} stat - Stat or attribute name.
   * @param {number|'full'} amount - Delta to apply (may be negative), or
   *   'full' to top a { current, max } resource up to its cap — the recurring
   *   refill idiom at combat boundaries and rest.
   */
  modifyPlayerStat(stat, amount) {
    // A registered stat handler fully replaces the default behavior.
    const handler = this._statHandlers[stat];
    if (handler) {
      handler(amount);
      return;
    }

    const p = this.state.player;
    if (amount === 'full') {
      const res = p.resources?.[stat];
      if (!(res && typeof res === 'object' && 'current' in res)) return;
      amount = res.max - res.current;
    }
    this._applyStatDelta(stat, amount);
    this.notifyListeners('stats');
    this._emitMutation('modifyPlayerStat', { stat, amount });
  }

  /**
   * Applies several stat deltas as one mutation with a single 'stats'
   * notification — the equip/unequip path applies a whole bonus map at once,
   * and per-key calls would re-render the UI once per attribute. Zero deltas
   * are skipped; stats with a registered handler still delegate to it
   * (handlers notify themselves).
   *
   * @param {Object<string, number>} deltas - Stat name → delta.
   */
  modifyPlayerStats(deltas) {
    let changed = false;
    for (const [stat, amount] of Object.entries(deltas)) {
      if (!amount) continue;
      const handler = this._statHandlers[stat];
      if (handler) {
        handler(amount);
        continue;
      }
      this._applyStatDelta(stat, amount);
      changed = true;
    }
    if (!changed) return;
    this.notifyListeners('stats');
    this._emitMutation('modifyPlayerStats', { deltas });
  }

  // The delta application shared by modifyPlayerStat and modifyPlayerStats —
  // no handler dispatch, no notification.
  _applyStatDelta(stat, amount) {
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
      default: {
        // Any declared { current, max } resource is modifiable by name and
        // clamped to [0, max] — this is how games add their own resources
        // (e.g. a "luckPoints" retry currency) without engine changes.
        const res = p.resources?.[stat];
        if (res && typeof res === 'object' && 'current' in res) {
          res.current = Math.max(0, Math.min(res.current + amount, res.max));
        } else if (p.attributes && stat in p.attributes) {
          p.attributes[stat] += amount;
        }
        break;
      }
    }
  }

  /**
   * Awards XP and handles level-up. XP threshold scales with level so each
   * level requires more XP than the last (threshold = level × xpPerLevel).
   * Surplus XP carries over and can trigger multiple level-ups in one call.
   *
   * @param {number} amount - XP to award.
   */
  addXP(amount) {
    const p = this.state.player;
    p.xp += amount;
    const xpPerLevel = this._rules.xpPerLevel;
    // Guard against a missing or non-positive xpPerLevel (bad rules data): a
    // threshold of 0 would make `xp >= threshold` always true and loop forever.
    // XP still banks; validate.js flags the misconfiguration on boot.
    if (xpPerLevel > 0) {
      const statPointsPerLevel = this._rules.levelUp?.statPoints ?? 0;
      let threshold = p.level * xpPerLevel;
      while (p.xp >= threshold) {
        p.xp -= threshold;
        p.level++;
        p.resources.hp.max += this._rules.levelUpHpBonus;
        p.resources.hp.current = p.resources.hp.max;
        // Bank point-buy currency (spent via spendStatPoint / the stats panel).
        if (statPointsPerLevel > 0) p.statPoints = (p.statPoints ?? 0) + statPointsPerLevel;
        threshold = p.level * xpPerLevel;
      }
    }
    this.notifyListeners('stats');
    this._emitMutation('addXP', { amount });
  }

  /**
   * An attribute's base value: the live value minus what worn equipment
   * contributes (attributeBonuses / armorClassBonus). Point-buy caps compare
   * against this, so gear can neither block a legitimate spend nor be
   * equip-cycled to exceed the configured max.
   *
   * @param {string} attrId - A declared attribute id.
   * @returns {number}
   */
  playerBaseAttribute(attrId) {
    const p = this.state.player;
    let worn = 0;
    for (const itemId of Object.values(p.equipment ?? {})) {
      if (itemId) worn += equipmentAttributeBonuses(this._items[itemId])[attrId] ?? 0;
    }
    return (p.attributes?.[attrId] ?? 0) - worn;
  }

  // Applies a point-buy bonus to a dotted player path with char creation's
  // semantics: raising a resource cap raises the resource itself by the same
  // amount, so invested points are felt immediately. Shared by
  // applyCharCreation and spendStatPoint so the two can't drift.
  _applyStatBonus(target, bonus) {
    const p = this.state.player;
    setByPath(p, target, (getByPath(p, target) ?? 0) + bonus);
    const resource = target.match(/^resources\.(\w+)\.max$/)?.[1];
    if (resource && p.resources[resource]?.current !== undefined) {
      p.resources[resource].current += bonus;
    }
  }

  /**
   * Applies the character-creation choices as one sanctioned mutation: the
   * chosen name plus the point-buy bonuses. The creation screen calls this
   * instead of writing the player object directly.
   *
   * @param {string} name - The player's chosen name.
   * @param {Array<{id: string, bonus: number}>} bonuses - Dotted
   *   rules.charCreation.stats ids with the total bonus bought for each.
   */
  applyCharCreation(name, bonuses) {
    this.state.player.name = name;
    for (const { id, bonus } of bonuses) {
      if (bonus > 0) this._applyStatBonus(id, bonus);
    }
    this.notifyListeners('stats');
    this._emitMutation('applyCharCreation', { name });
  }

  /**
   * A named bag for plugin-owned save data, stored under state.plugins.<id>
   * and serialized with the save. The sanctioned alternative to plugins
   * writing top-level state fields directly.
   *
   * @param {string} id - The plugin id (e.g. 'curator').
   * @returns {object} The plugin's mutable bag (created on first access).
   */
  pluginState(id) {
    if (!this.state.plugins) this.state.plugins = {};
    if (!this.state.plugins[id]) this.state.plugins[id] = {};
    return this.state.plugins[id];
  }

  /**
   * Spends one banked level-up stat point. Two target forms:
   * - A declared attribute id (e.g. 'perception'): +1 to the attribute,
   *   refused when its BASE value (worn bonuses excluded — see
   *   playerBaseAttribute) already sits at the optional per-attribute cap
   *   (customAttributes[].max).
   * - A dotted rules.charCreation.stats id (e.g. 'resources.hp.max'): applies
   *   that entry's bonusPerPoint with char creation's semantics (see
   *   _applyStatBonus). This keeps level-up point-buy covering the same
   *   stats as character creation.
   * Always refused when no points are banked or the target isn't declared.
   *
   * @param {string} target - A declared attribute id or charCreation.stats id.
   * @returns {boolean} Whether the point was spent.
   */
  spendStatPoint(target) {
    const p = this.state.player;
    if ((p.statPoints ?? 0) <= 0) return false;
    if (target.includes('.')) {
      const decl = (this._rules.charCreation?.stats ?? []).find(s => s.id === target);
      if (!decl) return false;
      this._applyStatBonus(target, decl.bonusPerPoint ?? 1);
    } else {
      if (!(p.attributes && target in p.attributes)) return false;
      const decl = (this._rules.customAttributes ?? []).find(a => a.id === target);
      if (decl?.max !== undefined && this.playerBaseAttribute(target) >= decl.max) return false;
      p.attributes[target] += 1;
    }
    p.statPoints -= 1;
    this.notifyListeners('stats');
    this._emitMutation('spendStatPoint', { attrId: target });
    return true;
  }

  // Shared add/remove logic for {item, amount} stack collections (the player
  // inventory and chest contents share the same entry shape).
  _addToItemList(list, itemId, amount) {
    const existing = list.find(i => i.item === itemId);
    if (existing) existing.amount += amount;
    else list.push({ item: itemId, amount });
  }

  // Decrements a stack and returns the updated list, dropping entries that
  // reach zero. Returns the list unchanged when the item is absent.
  _removeFromItemList(list, itemId, amount) {
    const existing = list.find(i => i.item === itemId);
    if (!existing) return list;
    existing.amount -= amount;
    return existing.amount <= 0 ? list.filter(i => i.item !== itemId) : list;
  }

  /**
   * Adds an item stack to the player inventory (inventory entries have the
   * shape { item: string, amount: number }). Unknown item IDs are rejected
   * with a console warning so bad data can't put unrenderable entries into
   * the inventory — the check only applies when an item database was provided
   * to init(), keeping headless tests free to use ad-hoc IDs.
   *
   * @param {string} itemId - The item identifier.
   * @param {number} [amount=1] - Stack size to add.
   * @param {{silent?: boolean}} [options] - silent skips listener notification.
   * @returns {boolean} True when the item was added.
   */
  addToInventory(itemId, amount = 1, { silent = false } = {}) {
    if (Object.keys(this._items).length && !this._items[itemId]) {
      console.warn(`[Gravity] addToInventory: unknown item "${itemId}" — ignored`);
      return false;
    }
    this._addToItemList(this.state.player.inventory, itemId, amount);
    if (!silent) this.notifyListeners('inventory');
    this._emitMutation('addToInventory', { itemId, amount });
    return true;
  }

  /**
   * Removes an item stack from the player inventory; entries that reach zero
   * are dropped. Removing an absent item is a no-op.
   *
   * @param {string} itemId - The item identifier.
   * @param {number} [amount=1] - Stack size to remove.
   * @param {{silent?: boolean}} [options] - silent skips listener notification.
   */
  removeFromInventory(itemId, amount = 1, { silent = false } = {}) {
    this.state.player.inventory = this._removeFromItemList(this.state.player.inventory, itemId, amount);
    if (!silent) this.notifyListeners('inventory');
    this._emitMutation('removeFromInventory', { itemId, amount });
  }

  /**
   * Equips an item into an equipment slot, returning any previously equipped
   * item to the inventory. Pass null to unequip.
   *
   * @param {string} slot - The equipment slot name (e.g. 'Right Hand').
   * @param {string|null} itemId - The item to equip, or null to clear the slot.
   * @returns {boolean} True if successfully equipped or unequipped, false otherwise.
   */
  equipItem(slot, itemId) {
    if (itemId) {
      if (this.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return false;
    }
    if (this.state.player.equipment[slot]) {
      this.addToInventory(this.state.player.equipment[slot], 1, { silent: true });
    }
    if (itemId) {
      this.removeFromInventory(itemId, 1, { silent: true });
    }
    this.state.player.equipment[slot] = itemId;
    this.notifyListeners('inventory');
    this._emitMutation('equipItem', { slot, itemId });
    return true;
  }

  getMissionStatus(missionId) { return this.state.missions[missionId] || MISSION_STATUS.NOT_STARTED; }
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

  /**
   * Returns the total quantity of the item in the player's possession.
   * By default, includes both unequipped inventory stacks and equipped slots.
   *
   * @param {string} itemId - The item identifier.
   * @param {object} [options]
   * @param {boolean} [options.includeEquipped=true] - Whether to include equipped slots.
   * @returns {number} The total count.
   */
  countPlayerItem(itemId, { includeEquipped = true } = {}) {
    const player = this.state.player;
    if (!player) return 0;
    const invEntry = player.inventory?.find(i => i.item === itemId);
    const invCount = invEntry ? invEntry.amount : 0;
    if (!includeEquipped) return invCount;
    const equipCount = player.equipment
      ? Object.values(player.equipment).filter(id => id === itemId).length
      : 0;
    return invCount + equipCount;
  }

  /**
   * @param {string} chestId - The chest identifier (from a manage_chest action).
   * @returns {Array<{item: string, amount: number}>} The chest contents (empty array if absent).
   */
  getChest(chestId) { return this.state.chests[chestId] ?? []; }

  /**
   * Moves an item stack from the player inventory into a chest, creating the
   * chest on first use.
   *
   * @param {string} chestId - The chest identifier.
   * @param {string} itemId - The item to deposit.
   * @param {number} [amount=1] - Stack size to move.
   */
  depositToChest(chestId, itemId, amount = 1) {
    const existing = this.state.player.inventory.find(i => i.item === itemId);
    if (!existing) return;
    const actualAmount = Math.min(amount, existing.amount);
    if (actualAmount <= 0) return;

    if (!this.state.chests[chestId]) this.state.chests[chestId] = [];
    this._addToItemList(this.state.chests[chestId], itemId, actualAmount);
    this.removeFromInventory(itemId, actualAmount, { silent: true });
    this.notifyListeners('inventory');
  }

  /**
   * Moves an item stack from a chest back into the player inventory.
   * No-op when the chest doesn't contain the item.
   *
   * @param {string} chestId - The chest identifier.
   * @param {string} itemId - The item to withdraw.
   * @param {number} [amount=1] - Stack size to move.
   */
  withdrawFromChest(chestId, itemId, amount = 1) {
    const chest = this.state.chests[chestId];
    const existing = chest?.find(i => i.item === itemId);
    if (!existing) return;
    const actualAmount = Math.min(amount, existing.amount);
    if (actualAmount <= 0) return;

    this.state.chests[chestId] = this._removeFromItemList(chest, itemId, actualAmount);
    this.addToInventory(itemId, actualAmount, { silent: true });
    this.notifyListeners('inventory');
  }

  /**
   * @param {string} sceneId - The scene to look up.
   * @returns {Array<{id: string, name: string, item: string|null, allowedTypes: string[]|null}>}
   *   The display cases registered for the scene (empty array if none).
   */
  getDisplaysForScene(sceneId) {
    if (!this.state.displays) this.state.displays = {};
    return this.state.displays[sceneId] ?? [];
  }

  /**
   * The whole displays map — every scene's display cases, keyed by scene id.
   * For consumers that must scan all exhibits at once (the curator's derived
   * reputation) so they never reach into the raw state object.
   * @returns {Object<string, Array<{id: string, name: string, item: string|null, allowedTypes: string[]|null}>>}
   */
  getAllDisplays() {
    if (!this.state.displays) this.state.displays = {};
    return this.state.displays;
  }

  /**
   * Registers a new display case on a scene.
   *
   * @param {string} sceneId - The scene to add the display to.
   * @param {{id?: string, name?: string, item?: string, allowedTypes?: string[]}} displayConfig
   * @returns {string} The display's ID (generated when not supplied).
   */
  addDisplayToScene(sceneId, displayConfig) {
    if (!this.state.displays) this.state.displays = {};
    if (!this.state.displays[sceneId]) this.state.displays[sceneId] = [];

    // Sequence suffix guarantees uniqueness even when two displays are added
    // within the same millisecond (Date.now() alone would collide).
    this._displaySeq = (this._displaySeq ?? 0) + 1;
    const id = displayConfig.id || `display_${Date.now()}_${this._displaySeq}`;
    const newDisplay = {
      id,
      name: displayConfig.name || "Display Case",
      item: displayConfig.item || null,
      allowedTypes: displayConfig.allowedTypes || null
    };

    this.state.displays[sceneId].push(newDisplay);
    this.notifyListeners('displays');
    return id;
  }

  /**
   * Moves an item from the player inventory onto a display case.
   *
   * @param {string} sceneId - The scene holding the display.
   * @param {string} displayId - The display case ID.
   * @param {string} itemId - The item to place.
   * @returns {boolean} False when the display or item doesn't exist.
   */
  placeItemInDisplay(sceneId, displayId, itemId) {
    const displays = this.getDisplaysForScene(sceneId);
    const display = displays.find(d => d.id === displayId);
    if (!display) return false;

    if (this.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return false;

    display.item = itemId;
    this.removeFromInventory(itemId, 1, { silent: true });
    this.notifyListeners('inventory');
    this._emitMutation('placeItemInDisplay', { sceneId, displayId, itemId });
    return true;
  }

  /**
   * Moves the item on a display case back into the player inventory.
   *
   * @param {string} sceneId - The scene holding the display.
   * @param {string} displayId - The display case ID.
   * @returns {string|null} The item ID taken, or null when the display was empty/missing.
   */
  takeItemFromDisplay(sceneId, displayId) {
    const displays = this.getDisplaysForScene(sceneId);
    const display = displays.find(d => d.id === displayId);
    if (!display || !display.item) return null;

    const itemId = display.item;
    display.item = null;
    this.addToInventory(itemId, 1, { silent: true });
    this.notifyListeners('inventory');
    this._emitMutation('takeItemFromDisplay', { sceneId, displayId, itemId });
    return itemId;
  }


  /**
   * Subscribes to state changes. Every mutation calls back with the full
   * state and an optional hint ('stats', 'inventory', 'quests', 'map',
   * 'displays', or undefined for a full update) so subscribers can re-render
   * only the affected region.
   *
   * @param {(state: object, hint?: string) => void} callback
   */
  subscribe(callback) { this.listeners.push(callback); }
  notifyListeners(hint) { this.listeners.forEach(cb => cb(this.state, hint)); }
}

export const gameState = new StateManager();
