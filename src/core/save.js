// The save format: how a state object becomes a save file, and how an older
// file is brought forward on load. Nothing here touches the live game.

// Bump when the save schema changes, and add the migration below. Each one
// mutates the raw parsed save in place.
export const SAVE_VERSION = 8;

const MIGRATIONS = {
  // v0 → v1: player.name was added.
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
  // v2 → v3: displays map added. It later moved into the curator's bag (its
  // plugin migration v2); this step puts the field where that one looks.
  3: (data) => {
    if (!('displays' in data)) data.displays = {};
  },
  // v3 → v4: world clock and timers added.
  4: (data) => {
    if (!('time' in data)) data.time = { ticks: 0 };
    if (!('timers' in data)) data.timers = [];
  },
  // v4 → v5: mission entries became { status, stage } objects. Idempotent,
  // because the legacy-stamp adoption below can re-run it.
  5: (data) => {
    for (const [id, entry] of Object.entries(data.missions ?? {})) {
      if (typeof entry === 'string') data.missions[id] = { status: entry };
    }
  },
  // v5 → v6: player.itemUses added; an absent entry means full.
  6: (data) => { if (!('itemUses' in data.player)) data.player.itemUses = {}; },
  // v6 → v7: slots got semantic ids, Torso and Legs merged into body, and two
  // ring slots appeared. Armor in Legs takes body if Torso left it free, else
  // goes back to the pack.
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
  // v7 → v8: stories map added (granted chapter ids per book).
  8: (data) => { if (!('stories' in data)) data.stories = {}; },
};

// Before plugins had their own version line, the curator stamped 5 on the
// core counter; the core data of such a save is really at 4.
const LEGACY_PLUGIN_STAMP = 5;
const LEGACY_STAMP_CORE_VERSION = 4;

// state.flags prefixes that once held check bookkeeping, now in checkState.
const LEGACY_CHECK_PREFIXES = ['skill_dc_', 'dialogue_dc_', 'dialogue_resolved_'];

function migrate(data, pluginMigrations) {
  // A pre-partition save (no pluginSaveVersions) adopts the core version its
  // data really has, not SAVE_VERSION, or the v5 migration would be skipped.
  if (data.saveVersion === LEGACY_PLUGIN_STAMP && !('pluginSaveVersions' in data)) {
    data.saveVersion = LEGACY_STAMP_CORE_VERSION;
  }

  const from = data.saveVersion ?? 0;
  // A save from a newer engine is left alone.
  if (from < SAVE_VERSION) {
    for (let v = from + 1; v <= SAVE_VERSION; v++) {
      if (MIGRATIONS[v]) MIGRATIONS[v](data);
    }
    data.saveVersion = SAVE_VERSION;
  }

  // Plugin lines are partitioned from the core counter; same forward-only rule.
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

// JSON, then UTF-8 bytes, then base64.
export function encodeSave(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  // A loop: spreading the byte array can overflow the stack on a large save.
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

// Plain JSON is accepted too, so a hand-edited save loads. Throws otherwise.
export function decodeSave(text) {
  let raw = text;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    raw = new TextDecoder().decode(bytes);
  } catch {
    // Not base64: try it as JSON as it stands.
  }
  return JSON.parse(raw);
}

// Brings a parsed save up to the current shape in place: shape check,
// migrations, rules-driven backfills, check-state normalization. False for a
// save too malformed to load, before anything was touched.
export function adoptSave(data, { rules, pluginMigrations, sceneFlags }) {
  // A save is a user file, possibly hand-edited: reject a bad shape before
  // a migration can throw halfway.
  if (!data || typeof data !== 'object'
      || typeof data.player !== 'object' || data.player === null
      || !Array.isArray(data.log)) {
    console.warn('[Gravity] loadFromObject: save data is missing required fields; load aborted.');
    return false;
  }

  migrate(data, pluginMigrations);
  // The legacy-stamp detection above relies on this map being present.
  data.pluginSaveVersions ??= {};

  // Resources, attributes, stat points, and flags the rules declare but the
  // save predates. Rules-driven, not numbered migrations: what exists is
  // per-game data.
  const ruleResources = rules?.playerDefaults?.resources;
  if (ruleResources && data.player.resources) {
    for (const [key, value] of Object.entries(ruleResources)) {
      if (!(key in data.player.resources)) {
        data.player.resources[key] = structuredClone(value);
      }
    }
  }

  if (data.player.attributes) {
    for (const attr of (rules?.customAttributes ?? [])) {
      if (!(attr.id in data.player.attributes)) {
        data.player.attributes[attr.id] = attr.default ?? 0;
      }
    }
  }
  data.player.statPoints ??= 0;

  if (!data.flags) data.flags = {};
  for (const [flag, value] of Object.entries(sceneFlags)) {
    if (!(flag in data.flags)) data.flags[flag] = value;
  }

  // Older saves kept check bookkeeping under prefixed flags. Unconditional,
  // not a numbered migration: interim builds stamped a current version while
  // still writing there.
  if (!data.checkState) data.checkState = {};
  for (const key of Object.keys(data.flags)) {
    if (LEGACY_CHECK_PREFIXES.some(p => key.startsWith(p))) {
      data.checkState[key] ??= data.flags[key];
      delete data.flags[key];
    }
  }
  return true;
}
