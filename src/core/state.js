import { MISSION_STATUS } from './config.js';
import { equipmentAttributeBonuses, getByPath, isResourcePool, setByPath } from './utils.js';
import { SAVE_VERSION, adoptSave, encodeSave } from './save.js';

const MAX_LOG_ENTRIES = 200;

// Every field a save file carries.
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
  // The declared slots become the equipment map, in declaration order (which
  // is render order); keeping the declaration around too would let them drift.
  player.equipment = Object.fromEntries(
    (player.equipmentSlots ?? []).map(slot => [slot.id, null])
  );
  delete player.equipmentSlots;
  player.statPoints = 0;
  // itemId → remaining uses; an absent entry means full (see getItemUses).
  player.itemUses = {};
  return {
    ...makeSkeletonState(),
    player,
    currentSceneId: rules.startingScene || null,
  };
}

// The single source of truth for mutable game data. Every write goes through
// a method here, which notifies the UI; the state object is what a save holds.
class StateManager {
  constructor() {
    // A skeleton until init(rules): enough for the registrations that run
    // during data loading.
    this.state = makeSkeletonState();
    this.listeners = [];
    this._rules = null;
    this._items = {};
    this._missions = {};
    // The flags data/flags declares, re-applied on reset and load.
    this._sceneFlags = {};
    this._pluginMigrations = {};
    this._mutationHooks = [];
    this._statHandlers = {};
  }

  // Plugin lifecycle hooks

  // fn(method, info) runs after a mutation completes and BEFORE its listeners
  // are notified, so what a hook derives is in place for the render. Guarded
  // no-ops do not emit. A hook may mutate state, but not through the method
  // it is hooked on.
  onMutation(fn) {
    this._mutationHooks.push(fn);
  }

  _emitMutation(method, info = {}) {
    this._mutationHooks.forEach(fn => fn(method, info));
  }

  // fn(delta) replaces modifyPlayerStat for one stat entirely, notification
  // included; for a plugin that derives a stat instead of storing it.
  registerStatHandler(stat, fn) {
    this._statHandlers[stat] = fn;
  }

  // An absolute write (modifyPlayerStat is a delta); creates the attribute.
  setPlayerAttribute(attr, value) {
    if (!this.state.player?.attributes) return;
    this.state.player.attributes[attr] = value;
    this.notifyListeners('stats');
  }

  // Replaces the skeleton with the default state the rules describe. With
  // items given, addToInventory rejects ids not in it.
  init(rules, items = {}) {
    this._rules = rules;
    this._items = items;
    this.state = makeDefaultState(rules);
    this._stampPluginVersions();
    this._emitMutation('init', { rules, items });
  }

  // A fresh state is current, so a saved new game never re-runs plugin migrations.
  _stampPluginVersions() {
    for (const [pluginId, line] of Object.entries(this._pluginMigrations)) {
      this.state.pluginSaveVersions[pluginId] = Math.max(...Object.keys(line).map(Number));
    }
  }

  // A save migration on the plugin's own version line
  // (state.pluginSaveVersions[pluginId], starting at 1), partitioned from the
  // core counter so a plugin can never make a save skip a core migration.
  // fn mutates the raw parsed save in place.
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

  // The download itself is the UI layer's, so this module stays headless.
  getSaveString() {
    return encodeSave(this.state);
  }

  // False, with the current game untouched, for a save too malformed to load.
  loadFromObject(parsedData) {
    const adopted = adoptSave(parsedData, {
      rules: this._rules,
      pluginMigrations: this._pluginMigrations,
      sceneFlags: this._sceneFlags,
    });
    if (!adopted) return false;
    this.state = parsedData;
    this._emitMutation('loadFromObject');
    this.notifyListeners();
    return true;
  }

  appendLog(entry) {
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG_ENTRIES) this.state.log.shift();
  }

  // The persisted half of NarrativeLog.amendLast: reaches back past narrator
  // entries to the newest choice line, but never across a scene boundary.
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

  // Seeds a not_started entry per mission, skipping the ones a loaded save
  // holds; keeps the definitions for the stage lookups below.
  registerMissions(missionsData) {
    this._missions = missionsData;
    Object.keys(missionsData).forEach(missionId => {
      if (!(missionId in this.state.missions)) {
        this.state.missions[missionId] = { status: MISSION_STATUS.NOT_STARTED };
      }
    });
  }

  // Seeds the declared flags, skipping the ones a loaded save holds.
  registerSceneFlags(flagsMap) {
    this._sceneFlags = { ...flagsMap };
    Object.entries(flagsMap).forEach(([flag, value]) => {
      if (!(flag in this.state.flags)) this.state.flags[flag] = value;
    });
  }

  reset() {
    this.state = makeDefaultState(this._rules);
    this._stampPluginVersions();
    Object.assign(this.state.flags, this._sceneFlags);
    this._emitMutation('reset');
    this.notifyListeners();
  }

  getFlag(flagName) { return this.state.flags[flagName] ?? false; }
  // No notification: the flow that set the flag drives its own re-render. The
  // mutation still emits, so quest advanceWhen observers see the write.
  setFlag(flagName, value) {
    this.state.flags[flagName] = value;
    this._emitMutation('setFlag', { flag: flagName, value });
  }

  // Check bookkeeping

  // The skill-check maps (attempts, resolution, discovery), keyed by
  // CHECK_KEYS. Like setFlag, writes do not notify.

  getCheckState(key) { return this.state.checkState[key]; }
  setCheckState(key, value) { this.state.checkState[key] = value; }

  // Null before init.
  getRules() { return this._rules; }

  // World clock & timers

  // One monotonic tick counter; days and segments derive from it
  // (systems/time.js). Time moves only through advanceTime, never from the
  // wall clock, so saves replay deterministically.

  getTicks() { return this.state.time?.ticks ?? 0; }

  // Returns the timers that came due, in deadline order, for the engine to
  // run; a non-positive amount is ignored.
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

  // A timer with the same id replaces the old one.
  setTimer(timer) {
    if (!timer?.id) return;
    if (!this.state.timers) this.state.timers = [];
    this.state.timers = this.state.timers.filter(t => t.id !== timer.id);
    this.state.timers.push(timer);
  }

  cancelTimer(id) {
    if (!this.state.timers) return;
    this.state.timers = this.state.timers.filter(t => t.id !== id);
  }

  getPlayer() { return this.state.player; }

  // stat is a resource ('hp', 'gold'), 'maxHp'/'maxAp', or any attribute;
  // amount a delta, or 'full' to top a { current, max } resource up.
  modifyPlayerStat(stat, amount) {
    // 'full' resolves before handler dispatch: handlers expect numeric deltas.
    const p = this.state.player;
    if (amount === 'full') {
      const res = p.resources?.[stat];
      if (!isResourcePool(res)) return;
      amount = res.max - res.current;
    }

    const handler = this._statHandlers[stat];
    if (handler) {
      handler(amount);
      return;
    }

    this._applyStatDelta(stat, amount);
    this._emitMutation('modifyPlayerStat', { stat, amount });
    this.notifyListeners('stats');
  }

  // Several deltas, one notification: the equip path applies a whole bonus
  // map at once. Handled stats still go to their handler.
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

  // { current, max, refresh } for a rest-limited item (attributes.uses), or
  // null without a cap. An absent itemUses entry reads as full, so older
  // saves load with every use available.
  getItemUses(itemId) {
    const uses = this._items[itemId]?.attributes?.uses;
    if (!Number.isInteger(uses?.max) || uses.max < 1) return null;
    const current = this.state.player.itemUses?.[itemId] ?? uses.max;
    return { current, max: uses.max, refresh: uses.refresh ?? 'full_rest' };
  }

  // Clamped at 0; a no-op without a uses cap.
  spendItemUse(itemId) {
    const uses = this.getItemUses(itemId);
    if (!uses) return;
    (this.state.player.itemUses ??= {})[itemId] = Math.max(0, uses.current - 1);
    this._emitMutation('spendItemUse', { itemId });
    this.notifyListeners('stats');
  }

  // A full rest restores every item's uses; a short rest only those that
  // declare uses.refresh: "short_rest".
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

  // No handler dispatch, no notification.
  _applyStatDelta(stat, amount) {
    const { resources, attributes } = this.state.player;

    if (stat === 'maxHp') { resources.hp.max += amount; return; }
    if (stat === 'maxAp') { resources.ap.max += amount; return; }
    if (stat === 'gold')  { resources.gold += amount; return; }

    // Any declared { current, max } resource, clamped to [0, max]: how a game
    // adds its own pools without engine changes.
    const res = resources?.[stat];
    if (isResourcePool(res)) {
      res.current = Math.max(0, Math.min(res.current + amount, res.max));
    } else if (attributes && stat in attributes) {
      attributes[stat] += amount;
    }
  }

  // The threshold is level × xpPerLevel; surplus carries over, so one award
  // can level up more than once.
  addXP(amount) {
    const p = this.state.player;
    p.xp += amount;
    const xpPerLevel = this._rules.xpPerLevel;
    // A non-positive xpPerLevel would loop forever; XP still banks and
    // validate.js reports the rules.
    if (xpPerLevel > 0) {
      const statPointsPerLevel = this._rules.levelUp?.statPoints ?? 0;
      // A malformed levelUpHpBonus means no growth rather than NaN HP.
      const hpBonus = Number.isFinite(this._rules.levelUpHpBonus) ? this._rules.levelUpHpBonus : 0;
      let threshold = p.level * xpPerLevel;
      while (p.xp >= threshold) {
        p.xp -= threshold;
        p.level++;
        p.resources.hp.max += hpBonus;
        p.resources.hp.current = p.resources.hp.max;
        if (statPointsPerLevel > 0) p.statPoints = (p.statPoints ?? 0) + statPointsPerLevel;
        threshold = p.level * xpPerLevel;
      }
    }
    this._emitMutation('addXP', { amount });
    this.notifyListeners('stats');
  }

  // The live value minus worn bonuses. Point-buy caps compare against this,
  // so gear can neither block a spend nor be cycled to exceed the max.
  playerBaseAttribute(attrId) {
    const p = this.state.player;
    let worn = 0;
    for (const itemId of Object.values(p.equipment ?? {})) {
      if (itemId) worn += equipmentAttributeBonuses(this._items[itemId])[attrId] ?? 0;
    }
    return (p.attributes?.[attrId] ?? 0) - worn;
  }

  // Point-buy semantics, shared by character creation and level-up: raising
  // a resource cap raises the resource with it.
  _applyStatBonus(target, bonus) {
    const p = this.state.player;
    setByPath(p, target, (getByPath(p, target) ?? 0) + bonus);
    const resource = target.match(/^resources\.(\w+)\.max$/)?.[1];
    if (resource && p.resources[resource]?.current !== undefined) {
      p.resources[resource].current += bonus;
    }
  }

  // bonuses pairs dotted rules.charCreation.stats ids with the total bought.
  applyCharCreation(name, bonuses) {
    this.state.player.name = name;
    for (const { id, bonus } of bonuses) {
      if (bonus > 0) this._applyStatBonus(id, bonus);
    }
    this._emitMutation('applyCharCreation', { name });
    this.notifyListeners('stats');
  }

  // A plugin's save-data bag (state.plugins.<id>), created on first access.
  pluginState(id) {
    if (!this.state.plugins) this.state.plugins = {};
    if (!this.state.plugins[id]) this.state.plugins[id] = {};
    return this.state.plugins[id];
  }

  // Spends one banked point on an attribute id (+1, refused at its base-value
  // cap) or a dotted charCreation.stats id (that entry's bonusPerPoint), so
  // level-up covers the same stats as character creation. Returns whether it
  // was spent.
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

  // The inventory and chest contents share the { item, amount } stack shape.
  _addToItemList(list, itemId, amount) {
    const existing = list.find(i => i.item === itemId);
    if (existing) existing.amount += amount;
    else list.push({ item: itemId, amount });
  }

  // Returns the updated list, dropping a stack that reaches zero.
  _removeFromItemList(list, itemId, amount) {
    const existing = list.find(i => i.item === itemId);
    if (!existing) return list;
    existing.amount -= amount;
    return existing.amount <= 0 ? list.filter(i => i.item !== itemId) : list;
  }

  // An unknown id is rejected (when init got an item database), so bad data
  // never puts an unrenderable entry in the pack. silent skips notification
  // and marks the add as an internal move, which the tab notifier ignores.
  addToInventory(itemId, amount = 1, { silent = false } = {}) {
    if (Object.keys(this._items).length && !this._items[itemId]) {
      console.warn(`[Gravity] addToInventory: unknown item "${itemId}" — ignored`);
      return false;
    }
    this._addToItemList(this.state.player.inventory, itemId, amount);
    this._emitMutation('addToInventory', { itemId, amount, silent });
    if (!silent) this.notifyListeners('inventory');
    return true;
  }

  // A no-op for an absent item; silent skips notification.
  removeFromInventory(itemId, amount = 1, { silent = false } = {}) {
    this.state.player.inventory = this._removeFromItemList(this.state.player.inventory, itemId, amount);
    this._emitMutation('removeFromInventory', { itemId, amount });
    if (!silent) this.notifyListeners('inventory');
  }

  // Swaps the slot's current item back into the pack; null unequips. Returns
  // whether the change was made.
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

  // Status and stage move independently; this leaves the stage alone.
  setMissionStatus(missionId, status) {
    const entry = (this.state.missions[missionId] ??= {});
    entry.status = status;
    this._emitMutation('setMissionStatus', { missionId, status });
    this.notifyListeners('quests');
  }

  // Null before the mission starts. A started mission that never advanced
  // reports the first declared stage, so an active mission is never stageless.
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

  // The position stageReached conditions compare by; -1 when unknown.
  missionStageIndex(missionId, stageId) {
    const stages = this._missions?.[missionId]?.stages;
    if (!Array.isArray(stages)) return -1;
    return stages.findIndex(s => s.id === stageId);
  }

  // Story chapters

  // Which chapters of each story book the player has heard, keyed by the
  // book's item id; the book's authored chapter list owns text and order.

  // In grant order, not authored order.
  getStoryChapters(storyId) { return this.state.stories?.[storyId] ?? []; }

  hasStoryChapter(storyId, chapterId) { return this.getStoryChapters(storyId).includes(chapterId); }

  // False, and no emit, for a chapter already granted.
  grantStoryChapter(storyId, chapterId) {
    if (this.hasStoryChapter(storyId, chapterId)) return false;
    ((this.state.stories ??= {})[storyId] ??= []).push(chapterId);
    this._emitMutation('grantStoryChapter', { storyId, chapterId });
    // Only the book's card renders granted chapters.
    this.notifyListeners('inventory');
    return true;
  }

  getCurrentSceneId() { return this.state.currentSceneId; }
  setCurrentSceneId(sceneId) { this.state.currentSceneId = sceneId; this.notifyListeners('map'); }

  getVisitedScenes() { return this.state.visitedScenes; }
  // No notification: the scene render that follows updates the map itself.
  addVisitedScene(sceneId) {
    if (!this.state.visitedScenes.includes(sceneId)) this.state.visitedScenes.push(sceneId);
  }

  getReturnSceneId() { return this.state.returnSceneId; }
  setReturnSceneId(sceneId) { this.state.returnSceneId = sceneId; }

  // Inventory stacks plus, by default, worn slots.
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

  getChest(chestId) { return this.state.chests[chestId] ?? []; }

  // Creates the chest on first use.
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

  // callback(state, hint): the hint ('stats', 'inventory', 'quests', 'map',
  // 'time', or undefined for everything) narrows what the UI re-renders. An
  // unknown hint updates nothing, so a plugin's own render never rides on it.
  subscribe(callback) { this.listeners.push(callback); }
  notifyListeners(hint) { this.listeners.forEach(cb => cb(this.state, hint)); }
}

export const gameState = new StateManager();
