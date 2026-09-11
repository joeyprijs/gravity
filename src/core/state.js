import { MISSION_STATUS } from './config.js';
import { equipmentAttributeBonuses, getByPath, isResourcePool, setByPath } from './utils.js';

const MAX_LOG_ENTRIES = 200;

// Increment when the save schema changes. loadFromObject() migrates older saves
// forward so they remain compatible. Each migration function receives the raw
// parsed data object and mutates it in-place.
const SAVE_VERSION = 8;

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
  // v2 → v3: displays map added for dynamic exhibits curation. The map later
  // moved into the curator's own bag (its plugin migration v2), which is where
  // a loaded save ends up — this step only puts the field where that one looks.
  3: (data) => {
    if (!('displays' in data)) data.displays = {};
  },
  // v3 → v4: world clock and timers added.
  4: (data) => {
    if (!('time' in data)) data.time = { ticks: 0 };
    if (!('timers' in data)) data.timers = [];
  },
  // v4 → v5: mission entries went from bare status strings to
  // { status, stage } objects (staged quests). Idempotent — object entries
  // pass through untouched (the legacy-stamp adoption below can re-run this).
  5: (data) => {
    for (const [id, entry] of Object.entries(data.missions ?? {})) {
      if (typeof entry === 'string') data.missions[id] = { status: entry };
    }
  },
  // v5 → v6: player.itemUses added (rest-limited item uses). An absent entry
  // means "full", so older saves load with every use available.
  6: (data) => { if (!('itemUses' in data.player)) data.player.itemUses = {}; },
  // v6 → v7: equipment slots became declared data with semantic ids
  // (rules.playerDefaults.equipmentSlots) instead of English display names,
  // Torso and Legs merged into one body slot, and two ring slots appeared.
  // Legs holds nothing in the demo, but a save may carry armor there: it
  // takes the body slot if Torso left it free, and otherwise goes back to the
  // pack rather than being dropped on the floor.
  7: (data) => {
    const old = data.player.equipment ?? {};
    const equipment = {
      head: old.Head ?? null,
      necklace: old.Amulet ?? null,
      body: old.Torso ?? old.Legs ?? null,
      left_hand: old['Left Hand'] ?? null,
      right_hand: old['Right Hand'] ?? null,
      left_ring: null,
      right_ring: null,
    };
    if (old.Legs && equipment.body !== old.Legs) {
      const stack = data.player.inventory?.find(entry => entry.item === old.Legs);
      if (stack) stack.amount = (stack.amount ?? 1) + 1;
      else (data.player.inventory ??= []).push({ item: old.Legs, amount: 1 });
    }
    data.player.equipment = equipment;
  },
  // v7 → v8: stories map added (story books — granted chapter ids per book item).
  8: (data) => { if (!('stories' in data)) data.stories = {}; },
};

// Saves written before plugin migrations had their own version line (see
// registerMigration) carried the curator's stamp — 5 — on the core counter.
const LEGACY_PLUGIN_STAMP = 5;

// The core version pre-partition saves were actually at: core migrations
// never went past 4 while the legacy stamp was in use.
const LEGACY_STAMP_CORE_VERSION = 4;

function migrate(data, pluginMigrations = {}) {
  // Adopt pre-partition saves back onto the core line at the version their
  // data really has — NOT SAVE_VERSION, which now sits past the stamp and
  // would skip the v5 mission migration. Detectable exactly — partitioned
  // saves always carry pluginSaveVersions, pre-partition saves never do.
  if (data.saveVersion === LEGACY_PLUGIN_STAMP && !('pluginSaveVersions' in data)) {
    data.saveVersion = LEGACY_STAMP_CORE_VERSION;
  }

  const from = data.saveVersion ?? 0;
  // A save from a newer engine (from >= SAVE_VERSION) is already current or
  // ahead; leave it untouched rather than re-running migrations or rewriting
  // its version backwards.
  if (from < SAVE_VERSION) {
    for (let v = from + 1; v <= SAVE_VERSION; v++) {
      if (MIGRATIONS[v]) MIGRATIONS[v](data);
    }
    data.saveVersion = SAVE_VERSION;
  }

  // Plugin migrations run on their own per-plugin version line
  // (data.pluginSaveVersions[pluginId]), so a plugin stamping its save data
  // can never make the core version number lie, or the reverse. Same
  // forward-only rule as the core line.
  for (const [pluginId, line] of Object.entries(pluginMigrations)) {
    const versions = Object.keys(line).map(Number).sort((a, b) => a - b);
    const max = versions[versions.length - 1];
    const current = data.pluginSaveVersions?.[pluginId] ?? 0;
    if (current >= max) continue;
    for (const v of versions) {
      if (v > current) line[v](data);
    }
    (data.pluginSaveVersions ??= {})[pluginId] = max;
  }
}

// The empty state shape — every field a save file carries.
function makeSkeletonState() {
  return {
    saveVersion: SAVE_VERSION,
    pluginSaveVersions: {},
    player: {},
    flags: {},
    checkState: {},
    missions: {},
    currentSceneId: null,
    returnSceneId: null,
    chests: {},
    stories: {},
    visitedScenes: [],
    time: { ticks: 0 },
    timers: [],
    log: []
  };
}

function makeDefaultState(rules) {
  const player = structuredClone(rules.playerDefaults);
  (rules.customAttributes ?? []).forEach(attr => {
    player.attributes[attr.id] = attr.default ?? 0;
  });
  // The declared slots ARE the equipment map, all empty, in declaration
  // order — which is the order the equipped panel renders them in. Holding
  // the declaration and the live map separately would let them drift.
  player.equipment = Object.fromEntries(
    (player.equipmentSlots ?? []).map(slot => [slot.id, null])
  );
  delete player.equipmentSlots;
  // Banked level-up stat points (rules.levelUp.statPoints per level).
  player.statPoints = 0;
  // Remaining uses of rest-limited items (itemId → remaining). An absent
  // entry means "full" — see getItemUses.
  player.itemUses = {};
  return {
    ...makeSkeletonState(),
    player,
    currentSceneId: rules.startingScene || null,
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
    // Skeleton until init(rules) runs — enough for registerMissions() and
    // registerSceneFlags(), which are called during data loading.
    this.state = makeSkeletonState();
    this.listeners = [];
    this._rules = null;
    this._items = {};
    this._missions = {};
    // The flags data/flags declares, kept so reset() and loadFromObject() can
    // re-apply the defaults a fresh or older state is missing.
    this._sceneFlags = {};
    this._pluginMigrations = {};
    this._mutationHooks = [];
    this._statHandlers = {};
  }

  // Plugin lifecycle hooks

  // The formal alternative to wrapping StateManager methods on the live
  // singleton: plugins observe mutations and intercept custom stats through
  // these registrations instead.

  /**
   * Registers a hook called after a state mutation completes, immediately
   * BEFORE its notifyListeners call — so anything a hook derives or records
   * (plugin stats, the UI's new-entry sets) is in place for the render that
   * notification triggers. Guard-rejected calls (e.g. addToInventory of an
   * unknown item) do not emit. Hooks may themselves mutate state — but must
   * not call the method they are hooked on.
   *
   * fn receives the StateManager method name and an info object with its
   * relevant arguments (e.g. { itemId, amount } for addToInventory).
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
   * fn receives the delta passed to modifyPlayerStat.
   */
  registerStatHandler(stat, fn) {
    this._statHandlers[stat] = fn;
  }

  // Sets a player attribute to an absolute value (modifyPlayerStat is
  // delta-based). Creates the attribute if it does not exist yet.
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
   * When items (engine.data.items) is provided, addToInventory rejects ids
   * that are not in it.
   */
  init(rules, items = {}) {
    this._rules = rules;
    this._items = items;
    this.state = makeDefaultState(rules);
    this._stampPluginVersions();
    this._emitMutation('init', { rules, items });
  }

  // Fresh states are current: stamp every registered plugin's latest version
  // so saving and reloading a new game doesn't re-run plugin migrations.
  _stampPluginVersions() {
    for (const [pluginId, line] of Object.entries(this._pluginMigrations)) {
      this.state.pluginSaveVersions[pluginId] = Math.max(...Object.keys(line).map(Number));
    }
  }

  /**
   * Plugin hook: registers a save migration on the plugin's own version line.
   * Plugins that change their own save data call this during their register()
   * fn. Core and plugin versions are partitioned — state.saveVersion never
   * carries a plugin's number (and vice versa: plugin lines live under
   * state.pluginSaveVersions[pluginId]), so a plugin stamping its data can
   * never make a save silently skip a future core migration.
   *
   * version is the plugin save version the migration produces (each plugin's
   * line starts at 1); fn mutates the raw parsed save object in place.
   */
  registerMigration(pluginId, version, fn) {
    if (typeof pluginId !== 'string' || !pluginId) {
      throw new Error('[Gravity] registerMigration: a plugin id string is required — plugin migrations run on their own per-plugin version line (registerMigration(pluginId, version, fn))');
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`[Gravity] registerMigration: version must be a positive integer (got ${version})`);
    }
    const line = (this._pluginMigrations[pluginId] ??= {});
    if (version in line) {
      throw new Error(`[Gravity] registerMigration: "${pluginId}" version ${version} is already registered`);
    }
    line[version] = fn;
  }

  /**
   * Returns the state serialized as a base64-encoded save string. The
   * download mechanics (Blob, anchor click) live in the UI layer so this
   * module stays headless — see UIManager's save handler.
   */
  getSaveString() {
    const jsonStr = JSON.stringify(this.state);

    // UTF-8 bytes, then base64. A manual loop: spreading the byte array can
    // overflow the stack on large saves.
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  /**
   * Replaces the entire state with a parsed save object, migrating older
   * save versions forward first. Notifies all listeners.
   *
   * Returns false when the save is rejected as malformed, so callers can
   * surface a clean error instead of crashing.
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

    migrate(parsedData, this._pluginMigrations);
    // Every post-partition save carries the plugin version map, even an empty
    // one — the legacy-stamp detection in migrate() relies on its presence.
    parsedData.pluginSaveVersions ??= {};

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

    // And the flags data/flags declares but the save predates — getFlag falls
    // back to false, so without this a flag added after release with a true
    // default would read false on old saves, hiding whatever it gates.
    // (registerSceneFlags ran at boot against the pre-load state; this is its
    // counterpart for the state that replaces it.)
    if (!parsedData.flags) parsedData.flags = {};
    for (const [flag, value] of Object.entries(this._sceneFlags)) {
      if (!(flag in parsedData.flags)) parsedData.flags[flag] = value;
    }

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
    this._emitMutation('loadFromObject');
    this.notifyListeners();
    return true;
  }

  appendLog(entry) {
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG_ENTRIES) this.state.log.shift();
  }

  // Extends the newest choice entry in place — the yield-amend path (see
  // NarrativeLog.amendLast), so a reloaded save shows the act and its yield
  // as the one line they were live. Reaches past narrator entries (time
  // ticks, timers land between an act and its yield) but never across a
  // scene boundary, mirroring amendLast's in-DOM scope.
  amendLog(suffix) {
    for (let i = this.state.log.length - 1; i >= 0; i--) {
      const entry = this.state.log[i];
      if (entry.type === 'scene') return;
      if (entry.variant === 'choice') {
        entry.message += suffix;
        return;
      }
    }
  }

  getLog() { return this.state.log; }

  // Called once on startup to ensure every mission ID exists in state.
  // Skips missions already present so loaded saves are not overwritten.
  // Keeps the definitions so stage lookups (getMissionStage's first-stage
  // fallback, missionStageIndex) work without reaching into engine data.
  registerMissions(missionsData) {
    this._missions = missionsData;
    Object.keys(missionsData).forEach(missionId => {
      if (!(missionId in this.state.missions)) {
        this.state.missions[missionId] = { status: MISSION_STATUS.NOT_STARTED };
      }
    });
  }

  // Called once on startup with the flags declared in data/flags.json.
  // Only sets flags that don't yet exist in state so loaded saves are preserved.
  registerSceneFlags(flagsMap) {
    this._sceneFlags = { ...flagsMap };
    Object.entries(flagsMap).forEach(([flag, value]) => {
      if (!(flag in this.state.flags)) this.state.flags[flag] = value;
    });
  }

  // Wipes all state back to defaults and re-applies the scene flags so that
  // the initial option visibility is correct immediately after a restart.
  reset() {
    this.state = makeDefaultState(this._rules);
    this._stampPluginVersions();
    Object.assign(this.state.flags, this._sceneFlags);
    this._emitMutation('reset');
    this.notifyListeners();
  }

  getFlag(flagName) { return this.state.flags[flagName] ?? false; }
  // Deliberately no notifyListeners (flag changes surface through the
  // re-renders their own flow drives) — but the mutation IS emitted, so
  // observers of world state (quest advanceWhen conditions) see flag writes.
  setFlag(flagName, value) {
    this.state.flags[flagName] = value;
    this._emitMutation('setFlag', { flag: flagName, value });
  }

  // Check bookkeeping

  // The engine-private skill-check state maps (attempt counts, resolution
  // markers, discovery progress), keyed by the CHECK_KEYS builders. Like
  // setFlag, writes deliberately do not notify: check state only surfaces
  // through re-renders the check flow itself drives.

  // The stored check-state entry, or undefined.
  getCheckState(key) { return this.state.checkState[key]; }
  setCheckState(key, value) { this.state.checkState[key] = value; }

  // The loaded rules object (null before init).
  getRules() { return this._rules; }

  // World clock & timers

  // The clock is a single monotonic tick counter; days and segments are
  // derived presentation (see systems/time.js). Time only moves through
  // advanceTime — never from wall-clock — so saves replay deterministically.

  // Absolute ticks elapsed since the game started.
  getTicks() { return this.state.time?.ticks ?? 0; }

  /**
   * Advances the world clock and collects the timers that came due, in
   * deadline order. The engine's advanceTime delegate runs their pipelines —
   * StateManager stays free of action handling.
   *
   * Non-positive amounts are ignored.
   */
  advanceTime(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return [];
    if (!this.state.time) this.state.time = { ticks: 0 };
    this.state.time.ticks += amount;
    const now = this.state.time.ticks;

    const timers = this.state.timers || [];
    const due = timers.filter(t => t.deadline <= now).sort((a, b) => a.deadline - b.deadline);
    if (due.length) this.state.timers = timers.filter(t => t.deadline > now);

    this._emitMutation('advanceTime', { amount, ticks: now });
    this.notifyListeners('time');
    return due;
  }

  // Arms (or re-arms) a timer. A timer with the same id replaces the old one.
  setTimer(timer) {
    if (!timer?.id) return;
    if (!this.state.timers) this.state.timers = [];
    this.state.timers = this.state.timers.filter(t => t.id !== timer.id);
    this.state.timers.push(timer);
  }

  // Disarms a timer by id. Unknown ids are a no-op.
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
   * amount is a delta, or 'full' to top a { current, max } resource up to its
   * cap — the recurring refill idiom at combat boundaries and rest.
   */
  modifyPlayerStat(stat, amount) {
    // Resolve the 'full' sentinel BEFORE any handler dispatch: handlers expect
    // numeric deltas ('full' has no meaning for a derived stat), and only a
    // declared { current, max } resource can be topped up.
    const p = this.state.player;
    if (amount === 'full') {
      const res = p.resources?.[stat];
      if (!isResourcePool(res)) return;
      amount = res.max - res.current;
    }

    // A registered stat handler fully replaces the default behavior.
    const handler = this._statHandlers[stat];
    if (handler) {
      handler(amount);
      return;
    }

    this._applyStatDelta(stat, amount);
    this._emitMutation('modifyPlayerStat', { stat, amount });
    this.notifyListeners('stats');
  }

  /**
   * Applies several stat deltas as one mutation with a single 'stats'
   * notification — the equip/unequip path applies a whole bonus map at once,
   * and per-key calls would re-render the UI once per attribute. Zero deltas
   * are skipped; stats with a registered handler still delegate to it
   * (handlers notify themselves).
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
    this._emitMutation('modifyPlayerStats', { deltas });
    this.notifyListeners('stats');
  }

  /**
   * The remaining uses of a rest-limited item (attributes.uses). Only spent
   * counts are stored (player.itemUses); an absent entry reads as full, so
   * saves that predate an item's uses cap load with every use available.
   *
   * Returns { current, max, refresh } — refresh names the rest that restores
   * the uses ('short_rest' or the default 'full_rest') — or null when the item
   * declares no uses cap.
   */
  getItemUses(itemId) {
    const uses = this._items[itemId]?.attributes?.uses;
    if (!Number.isInteger(uses?.max) || uses.max < 1) return null;
    const current = this.state.player.itemUses?.[itemId] ?? uses.max;
    return { current, max: uses.max, refresh: uses.refresh ?? 'full_rest' };
  }

  // Spends one use of a rest-limited item, clamped at 0. A no-op for items
  // without a uses cap.
  spendItemUse(itemId) {
    const uses = this.getItemUses(itemId);
    if (!uses) return;
    (this.state.player.itemUses ??= {})[itemId] = Math.max(0, uses.current - 1);
    this._emitMutation('spendItemUse', { itemId });
    this.notifyListeners('stats');
  }

  /**
   * Restores rest-limited item uses at a rest boundary. A full rest restores
   * everything; a short rest only the items that declare
   * uses.refresh: "short_rest" (the default refresh is the full rest).
   */
  refreshItemUses(rest) {
    const spent = this.state.player.itemUses ?? {};
    let changed = false;
    for (const itemId of Object.keys(spent)) {
      const refresh = this._items[itemId]?.attributes?.uses?.refresh ?? 'full_rest';
      if (rest === 'full_rest' || refresh === rest) {
        delete spent[itemId];
        changed = true;
      }
    }
    if (!changed) return;
    this._emitMutation('refreshItemUses', { rest });
    this.notifyListeners('stats');
  }

  // The delta application shared by modifyPlayerStat and modifyPlayerStats —
  // no handler dispatch, no notification.
  _applyStatDelta(stat, amount) {
    const { resources, attributes } = this.state.player;

    if (stat === 'maxHp') { resources.hp.max += amount; return; }
    if (stat === 'maxAp') { resources.ap.max += amount; return; }
    if (stat === 'gold')  { resources.gold += amount; return; }

    // Any declared { current, max } resource — hp and ap included — is
    // modifiable by name and clamped to [0, max]. This is how games add
    // their own resources (e.g. a "luckPoints" retry currency) without
    // engine changes.
    const res = resources?.[stat];
    if (isResourcePool(res)) {
      res.current = Math.max(0, Math.min(res.current + amount, res.max));
    } else if (attributes && stat in attributes) {
      attributes[stat] += amount;
    }
  }

  /**
   * Awards XP and handles level-up. XP threshold scales with level so each
   * level requires more XP than the last (threshold = level × xpPerLevel).
   * Surplus XP carries over and can trigger multiple level-ups in one call.
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
      // A missing (or non-numeric) levelUpHpBonus means no HP growth — never
      // NaN'd HP. validate.js flags a malformed value on boot.
      const hpBonus = Number.isFinite(this._rules.levelUpHpBonus) ? this._rules.levelUpHpBonus : 0;
      let threshold = p.level * xpPerLevel;
      while (p.xp >= threshold) {
        p.xp -= threshold;
        p.level++;
        p.resources.hp.max += hpBonus;
        p.resources.hp.current = p.resources.hp.max;
        // Bank point-buy currency (spent via spendStatPoint / the stats panel).
        if (statPointsPerLevel > 0) p.statPoints = (p.statPoints ?? 0) + statPointsPerLevel;
        threshold = p.level * xpPerLevel;
      }
    }
    this._emitMutation('addXP', { amount });
    this.notifyListeners('stats');
  }

  /**
   * An attribute's base value: the live value minus what worn equipment
   * contributes (attributeBonuses / armorClassBonus). Point-buy caps compare
   * against this, so gear can neither block a legitimate spend nor be
   * equip-cycled to exceed the configured max.
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
   * bonuses pairs dotted rules.charCreation.stats ids with the total bonus
   * bought for each.
   */
  applyCharCreation(name, bonuses) {
    this.state.player.name = name;
    for (const { id, bonus } of bonuses) {
      if (bonus > 0) this._applyStatBonus(id, bonus);
    }
    this._emitMutation('applyCharCreation', { name });
    this.notifyListeners('stats');
  }

  /**
   * A named bag for plugin-owned save data, stored under state.plugins.<id>
   * and serialized with the save. The sanctioned alternative to plugins
   * writing top-level state fields directly.
   *
   * Created on first access.
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
   * Returns whether the point was spent.
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
    this._emitMutation('spendStatPoint', { attrId: target });
    this.notifyListeners('stats');
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
   * options.silent skips listener notification. Returns true when the item
   * was added.
   */
  addToInventory(itemId, amount = 1, { silent = false } = {}) {
    if (Object.keys(this._items).length && !this._items[itemId]) {
      console.warn(`[Gravity] addToInventory: unknown item "${itemId}" — ignored`);
      return false;
    }
    this._addToItemList(this.state.player.inventory, itemId, amount);
    // silent flows to observers too: a silent add is an internal move (equip
    // swap, chest/display withdrawal), not a narrative gain — the tab notifier
    // dots only on non-silent gains.
    this._emitMutation('addToInventory', { itemId, amount, silent });
    if (!silent) this.notifyListeners('inventory');
    return true;
  }

  /**
   * Removes an item stack from the player inventory; entries that reach zero
   * are dropped. Removing an absent item is a no-op.
   *
   * options.silent skips listener notification.
   */
  removeFromInventory(itemId, amount = 1, { silent = false } = {}) {
    this.state.player.inventory = this._removeFromItemList(this.state.player.inventory, itemId, amount);
    this._emitMutation('removeFromInventory', { itemId, amount });
    if (!silent) this.notifyListeners('inventory');
  }

  /**
   * Equips an item into an equipment slot, returning any previously equipped
   * item to the inventory. Pass null to unequip.
   *
   * slot is a declared slot id (e.g. 'right_hand'). Returns whether the change
   * was made.
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
    this._emitMutation('equipItem', { slot, itemId });
    this.notifyListeners('inventory');
    return true;
  }

  getMissionStatus(missionId) { return this.state.missions[missionId]?.status || MISSION_STATUS.NOT_STARTED; }

  // Preserves the entry's stage — status and stage move independently
  // (activation sets status; advancement sets stage).
  setMissionStatus(missionId, status) {
    const entry = (this.state.missions[missionId] ??= {});
    entry.status = status;
    this._emitMutation('setMissionStatus', { missionId, status });
    this.notifyListeners('quests');
  }

  /**
   * The mission's current stage id. Null for missions that haven't started
   * (or have no stages). A started mission that never advanced — including
   * saves that predate a mission gaining stages — reports the first declared
   * stage, so authors never see a "stageless but active" gap.
   */
  getMissionStage(missionId) {
    const entry = this.state.missions[missionId];
    if (!entry?.status || entry.status === MISSION_STATUS.NOT_STARTED) return null;
    return entry.stage ?? this._missions?.[missionId]?.stages?.[0]?.id ?? null;
  }

  setMissionStage(missionId, stage) {
    const entry = (this.state.missions[missionId] ??= {});
    entry.stage = stage;
    this._emitMutation('setMissionStage', { missionId, stage });
    this.notifyListeners('quests');
  }

  /**
   * A stage's position in its mission's authored stage order — what
   * "stageReached" conditions compare by. -1 for unknown missions, stageless
   * missions, and unknown stage ids.
   */
  missionStageIndex(missionId, stageId) {
    const stages = this._missions?.[missionId]?.stages;
    if (!Array.isArray(stages)) return -1;
    return stages.findIndex(s => s.id === stageId);
  }

  // Story chapters

  // The chapters the player has heard of each story book (state.stories,
  // keyed by the book's item id). Granted state written at listen time, never
  // derived — the book item's authored chapter list owns text and order; this
  // map only answers "which chapters have been heard".

  // The granted chapter ids (grant order, not authored order).
  getStoryChapters(storyId) { return this.state.stories?.[storyId] ?? []; }

  hasStoryChapter(storyId, chapterId) { return this.getStoryChapters(storyId).includes(chapterId); }

  // Grants a story chapter. Idempotent: a chapter already granted returns
  // false and emits nothing — hearing a story twice is not an event.
  grantStoryChapter(storyId, chapterId) {
    if (this.hasStoryChapter(storyId, chapterId)) return false;
    ((this.state.stories ??= {})[storyId] ??= []).push(chapterId);
    this._emitMutation('grantStoryChapter', { storyId, chapterId });
    // 'inventory': the book's card shows its chapter count, and nothing else
    // in the UI renders granted chapters.
    this.notifyListeners('inventory');
    return true;
  }

  getCurrentSceneId() { return this.state.currentSceneId; }
  setCurrentSceneId(sceneId) { this.state.currentSceneId = sceneId; this.notifyListeners('map'); }

  getVisitedScenes() { return this.state.visitedScenes; }
  // Intentionally no notifyListeners() — scene rendering drives its own display
  // update, and triggering a full UI re-render here would be redundant.
  addVisitedScene(sceneId) {
    if (!this.state.visitedScenes.includes(sceneId)) this.state.visitedScenes.push(sceneId);
  }

  getReturnSceneId() { return this.state.returnSceneId; }
  setReturnSceneId(sceneId) { this.state.returnSceneId = sceneId; }

  // Returns the total quantity of the item in the player's possession.
  // By default, includes both unequipped inventory stacks and equipped slots.
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

  // A chest's contents (empty array if absent).
  getChest(chestId) { return this.state.chests[chestId] ?? []; }

  // Moves an item stack from the player inventory into a chest, creating the
  // chest on first use.
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

  // Moves an item stack from a chest back into the player inventory.
  // No-op when the chest doesn't contain the item.
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
   * Subscribes to state changes. Every mutation calls back with the full
   * state and an optional hint ('stats', 'inventory', 'quests', 'map', 'time',
   * or undefined for a full update) so subscribers can re-render only the
   * affected region. A plugin may notify with a hint of its own (the curator
   * uses 'displays'); an unrecognised hint updates nothing in particular,
   * which is why a plugin's own render doesn't ride on it.
   */
  subscribe(callback) { this.listeners.push(callback); }
  notifyListeners(hint) { this.listeners.forEach(cb => cb(this.state, hint)); }
}

export const gameState = new StateManager();
