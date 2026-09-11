import { escapeHtml } from '../../core/utils.js';

// The museum itself: the display cases and what stands in them, the derived
// reputation stat, the wings and their layout on the map, and the plugin's
// save data. Everything here works on the StateManager and the loaded data;
// nothing here touches the DOM — that is panel.js.

// One record per StateManager, read through by the hooks, so two engines in
// one page (the smoke harness) each keep their own reputation current. A
// repeat registration refreshes the record.
const registrations = new WeakMap(); // StateManager → { items, engine }

// { museumReputation, obtainedItems, rooms, displays }.
export const bagOf = (state) => state.pluginState('curator');

// The display cases, keyed by scene id.
const displaysOf = (state) => (bagOf(state).displays ??= {});

let displaySeq = 0;

// A case as stored: nothing derived.
function makeDisplay(config) {
  displaySeq += 1;
  return {
    id: config.id || `display_${Date.now()}_${displaySeq}`,
    name: config.name || 'Display Case',
    item: config.item || null,
  };
}

export function getDisplaysForScene(state, sceneId) {
  return displaysOf(state)[sceneId] ?? [];
}

export function findDisplay(state, sceneId, displayId) {
  return getDisplaysForScene(state, sceneId).find(d => d.id === displayId);
}

// Returns the new case's id.
export function addDisplayToScene(state, sceneId, config) {
  const map = displaysOf(state);
  const display = makeDisplay(config);
  (map[sceneId] ??= []).push(display);
  state.notifyListeners('displays');
  return display.id;
}

// False when the case or the item does not exist.
export function placeItemInDisplay(state, sceneId, displayId, itemId) {
  const display = findDisplay(state, sceneId, displayId);
  if (!display) return false;
  if (state.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return false;

  display.item = itemId;
  state.removeFromInventory(itemId, 1, { silent: true });
  // Before the notification, so the render it triggers counts the case.
  refreshReputation(state);
  state.notifyListeners('inventory');
  return true;
}

// Returns the item id taken, or null for an empty or missing case.
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

// A scene's authored `displays` are its starting furniture, seeded once and
// never over a save. On init/load/reset, because the panel and the decorator
// ask for cases while rendering, which is too late to discover them.
function syncAuthoredDisplays(engine) {
  if (!engine) return;
  const map = displaysOf(engine.state);
  for (const [sceneId, scene] of Object.entries(engine.data.scenes)) {
    if (!scene.displays?.length || map[sceneId]?.length) continue;
    map[sceneId] = scene.displays.map(makeDisplay);
  }
}

// The build button and the build_wing action must agree on the price.
export const DEFAULT_WING_COST = 250;

export function getMuseumReputation(state) {
  return state.getPlayer()?.attributes?.reputation ?? 0;
}

// The permanent score plus the reputation of every relic on display.
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

// For the module-level mutators, which cannot close over the registered items.
function refreshReputation(state) {
  updateReputation(state, registrations.get(state)?.items ?? {});
}

// The first acquisition of a reputation-bearing item scores permanently.
function handleAcquisition(state, items, itemId) {
  const itemData = items[itemId];
  if (!itemData?.attributes?.reputation) return;
  const obtained = (bagOf(state).obtainedItems ??= []);
  if (obtained.includes(itemId)) return;
  obtained.push(itemId);
  state.modifyPlayerStat('reputation', itemData.attributes.reputation);
}

// The stat handler, the mutation hooks, and the save migrations. Idempotent
// per StateManager. engine is optional: the state-level tests run without one.
export function registerCuratorState(state, items = {}, engine = null) {
  const existing = registrations.get(state);
  if (existing) {
    existing.items = items;
    if (engine) existing.engine = engine;
    return;
  }
  const reg = { items, engine };
  registrations.set(state, reg);

  // A delta adjusts the permanent score; the attribute is recomputed from it.
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
        // Wings, then the cases in them, then their worth: each reads the last.
        syncMuseumRooms(reg.engine);
        syncAuthoredDisplays(reg.engine);
        updateReputation(state, reg.items);
        break;
      case 'addToInventory':
        handleAcquisition(state, reg.items, info.itemId);
        break;
    }
  });

  // v1: adopts the top-level fields older saves carried into the bag, and
  // seeds a save that predates the curator. Idempotent: a pre-partition save
  // re-runs it once.
  state.registerMigration('curator', 1, (data) => {
    if (!data.plugins) data.plugins = {};
    const saved = data.plugins.curator ?? (data.plugins.curator = {});
    saved.museumReputation ??= data.museumReputation ?? 0;
    if (!saved.obtainedItems) {
      if (data.obtainedItems) {
        saved.obtainedItems = data.obtainedItems;
      } else {
        // Everything already owned or exhibited, so it never re-scores.
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

  // v2: the displays map moved from core state into the bag. Must run after
  // v1, which reads data.displays for its backfill.
  state.registerMigration('curator', 2, (data) => {
    if (!data.plugins) data.plugins = {};
    const saved = data.plugins.curator ?? (data.plugins.curator = {});
    saved.displays ??= data.displays ?? {};
    delete data.displays;
  });
}

// Derives the museum's map geometry from each wing's `museumSlot`: even slots
// north of the hall, odd slots south, one column per two rooms, the hall as
// wide as the columns in use. Needs museumLayout { top, left, roomWidth,
// roomHeight } in the plugin config; without it nothing is touched.
//
//     ┌────┬────┐   slots 0, 2 north
//   ──┼────┴────┤   the hall spans every column
//     └────┴────┘   slots 1, 3 south
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

  // An empty museum still has its hall, one column wide.
  if (hall) Object.assign(hall.mapDefinitions ??= {}, {
    left, top, width: roomWidth * Math.max(columns, 1), height: roomHeight,
  });
}

// The rooms whose arrival opens the curator panel.
export function isMuseumRoom(scene, hasDisplays) {
  return Boolean(scene.museumHall || scene.supportsExhibits || hasDisplays);
}

// { id, scene } of the scene flagged museumHall; null without a museum.
export function findHall(engine) {
  const entry = Object.entries(engine.data.scenes).find(([, s]) => s.museumHall);
  return entry ? { id: entry[0], scene: entry[1] } : null;
}

// One past the highest slot in use; id and geometry both follow from it.
export function nextMuseumSlot(engine) {
  const slots = Object.values(engine.data.scenes)
    .map(s => s.museumSlot)
    .filter(Number.isInteger);
  return slots.length ? Math.max(...slots) + 1 : 0;
}

// A built wing as a scene: everything but the player's name is derived from
// the slot, the locale, and the hall. The name is player input rendered as
// HTML in the description, so it is escaped there.
function buildRoomScene(engine, hall, room) {
  // Without a museumLayout there is no geometry to derive, so no map presence
  // rather than undefined coordinates: a save with wings can load anywhere.
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

// Rebuilds the built wings' scenes from the save's { id, name, slot } records
// and re-runs the layout; museumBuilt marks the scenes a loaded save must drop.
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
