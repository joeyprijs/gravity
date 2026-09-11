import { escapeHtml } from '../../core/utils.js';

// The museum itself: the display cases and what stands in them, the derived
// reputation stat, the wings and their layout on the map, and the plugin's
// save data. Everything here works on the StateManager and the loaded data;
// nothing here touches the DOM — that is panel.js.

// Hook registrations are per-StateManager: each registered manager gets its
// own record ({ items, engine }) that the hook callbacks read through, so two
// engines booted in one page (a manual-boot harness, the test suite) each
// keep their own reputation current instead of the first registration winning
// forever. Repeat registrations only refresh the record (the test suite
// re-inits state per test).
const registrations = new WeakMap(); // StateManager → { items, engine }

// The curator's save-data bag ({ museumReputation, obtainedItems, rooms,
// displays }).
export const bagOf = (state) => state.pluginState('curator');

// The museum's display cases, keyed by scene id — stored in the bag beside
// the wings that hold them (see the header note on cases vs chests).
const displaysOf = (state) => (bagOf(state).displays ??= {});

// Generated case ids: display_<timestamp>_<sequence>.
let displaySeq = 0;

// A case as it is stored: the authored/installed fields and nothing derived.
function makeDisplay(config) {
  displaySeq += 1;
  return {
    id: config.id || `display_${Date.now()}_${displaySeq}`,
    name: config.name || 'Display Case',
    item: config.item || null,
  };
}

// The display cases registered for a scene (empty array if none).
export function getDisplaysForScene(state, sceneId) {
  return displaysOf(state)[sceneId] ?? [];
}

export function findDisplay(state, sceneId, displayId) {
  return getDisplaysForScene(state, sceneId).find(d => d.id === displayId);
}

// Installs a new case in a scene and returns its id (generated when the
// config carries none).
export function addDisplayToScene(state, sceneId, config) {
  const map = displaysOf(state);
  const display = makeDisplay(config);
  (map[sceneId] ??= []).push(display);
  state.notifyListeners('displays');
  return display.id;
}

// Moves an item from the player's inventory into a case. False when the case
// or the item doesn't exist.
export function placeItemInDisplay(state, sceneId, displayId, itemId) {
  const display = findDisplay(state, sceneId, displayId);
  if (!display) return false;
  if (state.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return false;

  display.item = itemId;
  state.removeFromInventory(itemId, 1, { silent: true });
  // Recompute before the notification: the render it triggers must already
  // count what now stands in this case.
  refreshReputation(state);
  state.notifyListeners('inventory');
  return true;
}

// Moves the item in a case back into the player's inventory. Returns the item
// id taken, or null when the case was empty or missing.
export function takeItemFromDisplay(state, sceneId, displayId) {
  const display = findDisplay(state, sceneId, displayId);
  if (!display?.item) return null;

  const itemId = display.item;
  display.item = null;
  state.addToInventory(itemId, 1, { silent: true });
  refreshReputation(state);
  state.notifyListeners('inventory');
  return itemId;
}

// A scene file's `displays` array is the museum's starting furniture. Seeded
// once per scene, and never over a save: cases already in the bag are the ones
// the player installed and filled. Runs on init/load/reset rather than on
// scene render — the panel and the scene decorator both ask whether a room has
// cases while rendering it, which is too late to be discovering them.
function syncAuthoredDisplays(engine) {
  if (!engine) return;
  const map = displaysOf(engine.state);
  for (const [sceneId, scene] of Object.entries(engine.data.scenes)) {
    if (!scene.displays?.length || map[sceneId]?.length) continue;
    map[sceneId] = scene.displays.map(makeDisplay);
  }
}

// What building a wing costs when the game's config doesn't say — the demo's
// configured price. One constant because two places must agree on it: the
// hall's build button (its label and its affordability check) and the
// build_wing action that does the charging.
export const DEFAULT_WING_COST = 250;

// The museum reputation currently shown to the player (permanent + display bonus).
export function getMuseumReputation(state) {
  return state.getPlayer()?.attributes?.reputation ?? 0;
}

// Recomputes the derived reputation attribute from the permanent score plus
// the reputation of every relic currently on display.
function updateReputation(state, items) {
  let rep = bagOf(state).museumReputation ?? 0;
  const displays = displaysOf(state);
  for (const sceneId in displays) {
    for (const display of displays[sceneId]) {
      if (display.item && items[display.item]) {
        rep += items[display.item].attributes?.reputation ?? 0;
      }
    }
  }
  state.setPlayerAttribute('reputation', rep);
}

// Recomputes reputation for a state whose item database is only known to its
// registration — the display mutators above are module functions, so they can't
// close over the `items` the register call was given.
function refreshReputation(state) {
  updateReputation(state, registrations.get(state)?.items ?? {});
}

// First-time acquisition of a reputation-bearing item awards its reputation
// permanently. obtainedItems tracks which items have already been counted.
function handleAcquisition(state, items, itemId) {
  const itemData = items[itemId];
  if (!itemData?.attributes?.reputation) return;
  const obtained = (bagOf(state).obtainedItems ??= []);
  if (obtained.includes(itemId)) return;
  obtained.push(itemId);
  state.modifyPlayerStat('reputation', itemData.attributes.reputation);
}

// Registers the curator's state integrations: the reputation stat handler,
// the mutation hooks that keep the derived attribute current, and the save
// migration for the plugin's fields. Idempotent per StateManager — repeat
// calls only refresh the registration's item/engine references (the test
// suite re-inits state per test). The engine reference is optional: the
// state-level tests call this on its own, and room synthesis stays out of
// their way.
export function registerCuratorState(state, items = {}, engine = null) {
  const existing = registrations.get(state);
  if (existing) {
    existing.items = items;
    if (engine) existing.engine = engine;
    return;
  }
  const reg = { items, engine };
  registrations.set(state, reg);

  // modifyPlayerStat('reputation', delta) adjusts the permanent score; the
  // visible attribute is recomputed (and notified) from updateReputation.
  state.registerStatHandler('reputation', (amount) => {
    const bag = bagOf(state);
    bag.museumReputation = (bag.museumReputation ?? 0) + amount;
    updateReputation(state, reg.items);
  });

  state.onMutation((method, info) => {
    switch (method) {
      case 'init':
      case 'loadFromObject':
      case 'reset':
        // Wings first, then the cases standing in them, then what they are
        // worth: each step reads the one before it. (Built wings carry no
        // authored cases — the player installs those — but a wing's scene has
        // to exist before anything walks data.scenes looking for them.)
        syncMuseumRooms(reg.engine);
        syncAuthoredDisplays(reg.engine);
        updateReputation(state, reg.items);
        break;
      case 'addToInventory':
        handleAcquisition(state, reg.items, info.itemId);
        break;
    }
  });

  // The curator's save data, version 1 on the plugin's own migration line
  // (state.pluginSaveVersions.curator — partitioned from the core
  // saveVersion). Adopts the pre-bag top-level fields older saves carried,
  // and seeds defaults for saves that predate the curator entirely.
  // Idempotent on purpose: saves stamped 5 by the pre-partition version line
  // re-run it once when they adopt the partitioned form.
  state.registerMigration('curator', 1, (data) => {
    if (!data.plugins) data.plugins = {};
    const saved = data.plugins.curator ?? (data.plugins.curator = {});
    saved.museumReputation ??= data.museumReputation ?? 0;
    if (!saved.obtainedItems) {
      if (data.obtainedItems) {
        saved.obtainedItems = data.obtainedItems;
      } else {
        // Backfill from everything the player already owns or exhibits, so
        // pre-curator relics don't re-award reputation on pickup.
        const currentItems = new Set();
        (data.player?.inventory ?? []).forEach(i => currentItems.add(i.item));
        Object.values(data.player?.equipment ?? {}).forEach(itemId => {
          if (itemId) currentItems.add(itemId);
        });
        for (const sceneId in (data.displays ?? {})) {
          data.displays[sceneId].forEach(d => { if (d.item) currentItems.add(d.item); });
        }
        saved.obtainedItems = Array.from(currentItems);
      }
    }
    delete data.museumReputation;
    delete data.obtainedItems;
  });

  // v2: the displays map moved out of core state into this bag, where the wings
  // holding those cases already lived. MUST run after v1, which reads
  // data.displays for its obtainedItems backfill — migrate() walks a plugin's
  // versions in ascending order, so it does; anything that reorders them breaks
  // that backfill silently.
  state.registerMigration('curator', 2, (data) => {
    if (!data.plugins) data.plugins = {};
    const saved = data.plugins.curator ?? (data.plugins.curator = {});
    saved.displays ??= data.displays ?? {};
    delete data.displays;
  });
}

// Lays the museum out on the world map. A museum that can grow can't have its
// coordinates authored one room at a time: a wing declares which slot it
// occupies (`museumSlot`) and the geometry is derived from that, so however
// many rooms exist, they tile without overlapping and without anyone editing
// pixels. Slots run away from the hall in a pair per column — even slots north
// of it, odd slots south — so the museum grows one column per TWO rooms and
// stays roughly square instead of stretching into a ribbon.
//
//     ┌────┬────┐        slot 0   slot 2      (north, columns 0 and 1)
//     │ 0  │ 2  │
//   ──┼────┴────┤        the hall (museumHall) spans every column in use
//     │ 1  │ 3  │
//     └────┴────┘        slot 1   slot 3      (south)
//
// The hall's own width follows the column count, which is what makes room for
// the next wing on the map. Geometry only — nothing here knows what a room
// holds. Needs `museumLayout: { top, left, roomWidth, roomHeight }` in the
// plugin's manifest config (the hall's top-left corner and one room's size);
// without it the authored mapDefinitions are left exactly as they are.
export function layoutMuseum(engine) {
  const layout = engine.pluginConfig('curator').museumLayout;
  if (!layout) return;
  const { top, left, roomWidth, roomHeight } = layout;

  let columns = 0;
  let hall = null;
  for (const scene of Object.values(engine.data.scenes)) {
    if (scene.museumHall) hall = scene;
    if (!Number.isInteger(scene.museumSlot)) continue;
    const column = Math.floor(scene.museumSlot / 2);
    columns = Math.max(columns, column + 1);
    Object.assign(scene.mapDefinitions ??= {}, {
      left: left + column * roomWidth,
      top: scene.museumSlot % 2 ? top + roomHeight : top - roomHeight,
      width: roomWidth,
      height: roomHeight,
    });
  }

  // An empty museum still has its hall — one column wide.
  if (hall) Object.assign(hall.mapDefinitions ??= {}, {
    left, top, width: roomWidth * Math.max(columns, 1), height: roomHeight,
  });
}

// Rooms the curator takes over on arrival: the hall (its wings and the building
// of them) and anything holding display cases. Both get a panel instead of a
// plain option list, so the museum reads the same wherever you stand in it.
export function isMuseumRoom(scene, hasDisplays) {
  return Boolean(scene.museumHall || scene.supportsExhibits || hasDisplays);
}

// The museum's hall, as { id, scene } — the scene flagged museumHall. Null in
// a game that has no museum.
export function findHall(engine) {
  const entry = Object.entries(engine.data.scenes).find(([, s]) => s.museumHall);
  return entry ? { id: entry[0], scene: entry[1] } : null;
}

// The slot a newly built wing takes: one past the highest in use, so ids and
// geometry both follow from it and nothing has to be counted or stored twice.
export function nextMuseumSlot(engine) {
  const slots = Object.values(engine.data.scenes)
    .map(s => s.museumSlot)
    .filter(Number.isInteger);
  return slots.length ? Math.max(...slots) + 1 : 0;
}

// A built wing as a scene object. Everything but the player's chosen name is
// derived: the id and geometry from the slot, the room's text from the plugin's
// locale, the region and the way back from the hall it opens off. Bare on
// purpose — the player installs display cases and decides what goes in.
// The name is player input, and a description is rendered as HTML, so it is
// escaped going in (the option button and map label take text nodes).
function buildRoomScene(engine, hall, room) {
  // Geometry comes from layoutMuseum; without a museumLayout there is none to
  // derive, and a bare mapDefinitions would put the wing on the map at
  // undefined coordinates — so the wing gets no map presence at all. (Building
  // is gated on the layout, but a save carrying wings can be loaded anywhere.)
  const layout = engine.pluginConfig('curator').museumLayout;
  return {
    id: room.id,
    name: room.name,
    region: hall.scene.region,
    museumSlot: room.slot,
    museumBuilt: true,
    supportsExhibits: true,
    showsReputation: true,
    description: engine.t('plugin.curator.wingDescription', { name: escapeHtml(room.name) }),
    ...(layout ? { mapDefinitions: { background: layout.roomBackground } } : {}),
    options: [{
      text: engine.t('plugin.curator.wingBack', { name: hall.scene.name }),
      isBack: true,
      actions: [{ type: 'navigate', destination: hall.id }],
    }],
  };
}

// Brings data.scenes in line with the built wings in the save, then re-runs the
// layout. Wings live in the save as { id, name, slot } and nothing else — their
// scenes are rebuilt from that on every load, so a saved game can never carry
// stale coordinates or drift from the layout rules. Called on boot, on load,
// and after building: a loaded save must also DROP the wings the previous game
// had, which is what museumBuilt marks.
export function syncMuseumRooms(engine) {
  if (!engine) return;
  const hall = findHall(engine);
  if (!hall) return;

  const rooms = bagOf(engine.state).rooms ?? [];
  const wanted = new Map(rooms.map(r => [r.id, r]));
  for (const [id, scene] of Object.entries(engine.data.scenes)) {
    if (scene.museumBuilt && !wanted.has(id)) delete engine.data.scenes[id];
  }
  for (const room of rooms) {
    engine.data.scenes[room.id] ??= buildRoomScene(engine, hall, room);
  }
  layoutMuseum(engine);
}
