// The save format: how a state object becomes a save file and how an older
// file is brought forward to the current shape on load. StateManager
// (state.js) owns the live game; this module owns nothing but the file — so
// when a save breaks, this is the one place to read.

// Increment when the save schema changes. adoptSave() migrates older saves
// forward so they remain compatible. Each migration receives the raw parsed
// data object and mutates it in place.
export const SAVE_VERSION = 8;

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
// StateManager.registerMigration) carried the curator's stamp — 5 — on the
// core counter.
const LEGACY_PLUGIN_STAMP = 5;

// The core version pre-partition saves were actually at: core migrations
// never went past 4 while the legacy stamp was in use.
const LEGACY_STAMP_CORE_VERSION = 4;

// The state.flags prefixes that historically held check bookkeeping — moved
// into state.checkState on load.
const LEGACY_CHECK_PREFIXES = ['skill_dc_', 'dialogue_dc_', 'dialogue_resolved_'];

function migrate(data, pluginMigrations) {
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

// A state object as save-file text: JSON, then UTF-8 bytes, then base64.
export function encodeSave(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  // A manual loop: spreading the byte array can overflow the stack on large saves.
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

// Save-file text back to the raw parsed object. Plain JSON is accepted too,
// so a hand-edited save still loads. Throws on text that is neither.
export function decodeSave(text) {
  let raw = text;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    raw = new TextDecoder().decode(bytes);
  } catch {
    // Not base64 — try it as JSON as it stands.
  }
  return JSON.parse(raw);
}

// Brings a parsed save up to the current shape, in place: the structural
// check, the migration chains, the rules-driven backfills, and the check-state
// normalization. Returns false for a save too malformed to load — nothing has
// been touched by then, so the caller can keep the game it has.
//
// rules is the loaded rules object (null before init); pluginMigrations the
// registered per-plugin lines; sceneFlags the flags data/flags declares.
export function adoptSave(data, { rules, pluginMigrations, sceneFlags }) {
  // Saves are user-supplied files and may be hand-edited or corrupt. Reject a
  // structurally invalid save before committing to it, so a bad load fails
  // cleanly instead of throwing mid-migration with state half-replaced.
  if (!data || typeof data !== 'object'
      || typeof data.player !== 'object' || data.player === null
      || !Array.isArray(data.log)) {
    console.warn('[Gravity] loadFromObject: save data is missing required fields; load aborted.');
    return false;
  }

  migrate(data, pluginMigrations);
  // Every post-partition save carries the plugin version map, even an empty
  // one — the legacy-stamp detection in migrate() relies on its presence.
  data.pluginSaveVersions ??= {};

  // Seed resources the rules declare but the save predates (e.g. a game
  // that adds a resource after players already have saves). Rules-driven
  // rather than a numbered migration, since which resources exist is per-game data.
  const ruleResources = rules?.playerDefaults?.resources;
  if (ruleResources && data.player.resources) {
    for (const [key, value] of Object.entries(ruleResources)) {
      if (!(key in data.player.resources)) {
        data.player.resources[key] = structuredClone(value);
      }
    }
  }

  // Same for attributes the rules declare but the save predates (e.g.
  // strength/intelligence added after release) — without the backfill,
  // stat points can never be spent on them and attacks roll +0 forever.
  if (data.player.attributes) {
    for (const attr of (rules?.customAttributes ?? [])) {
      if (!(attr.id in data.player.attributes)) {
        data.player.attributes[attr.id] = attr.default ?? 0;
      }
    }
  }
  // And the banked stat-point counter (added with rules.levelUp).
  data.player.statPoints ??= 0;

  // And the flags data/flags declares but the save predates — getFlag falls
  // back to false, so without this a flag added after release with a true
  // default would read false on old saves, hiding whatever it gates.
  if (!data.flags) data.flags = {};
  for (const [flag, value] of Object.entries(sceneFlags)) {
    if (!(flag in data.flags)) data.flags[flag] = value;
  }

  // Check bookkeeping lives in state.checkState, not state.flags. Older
  // saves stored it under prefixed flag keys — move those over. Done as an
  // unconditional, idempotent normalization rather than a numbered
  // migration: save versions can't distinguish interim builds that stamped
  // a current version while still writing check state into flags.
  if (!data.checkState) data.checkState = {};
  for (const key of Object.keys(data.flags)) {
    if (LEGACY_CHECK_PREFIXES.some(p => key.startsWith(p))) {
      data.checkState[key] ??= data.flags[key];
      delete data.flags[key];
    }
  }
  return true;
}
