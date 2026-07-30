import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import curatorPlugin from '../src/plugins/curator.js';

// The plugin's register function injects a reputation header into the page on
// load. These tests run headless, so a one-method document stub makes that
// injection a no-op (querySelector finds no anchor element to attach to).
globalThis.document = { querySelector: () => null };

// Minimal rules required by gameState.init() — mirrors the key values from rules.json.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 100 },
    attributes: { ac: 10, initiative: 0, reputation: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: 'home_museum',
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

const TEST_ITEMS = {
  relic_crown: { name: 'Ancient Crown', type: 'Flavour', attributes: { reputation: 25 } },
};

// Minimal engine mock — only the registration surface the plugin touches.
function makeEngine(pluginConfigs = {}) {
  const registry = new Map();
  const decorators = [];
  const sheetRows = [];
  const validators = [];
  const listeners = new Map();
  const calls = { logs: [], customUI: [] };
  const engine = {
    data: { items: TEST_ITEMS, scenes: {}, rules: null },
    state: gameState,
    inCombat: false,
    t: (key) => key,
    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    emit: (event, data) => (listeners.get(event) ?? []).forEach(h => h(data)),
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    registerAction: (name, fn) => registry.set(name, fn),
    registerSceneDecorator: (decorator) => decorators.push(decorator),
    registerSheetRow: (row) => sheetRows.push(row),
    registerValidator: (fn) => validators.push(fn),
    pluginConfig: (id) => pluginConfigs[id] || {},
    setCustomUIOpen: (open) => calls.customUI.push(open),
    scene: { handleOption: () => {} },
  };
  return { engine, registry, decorators, sheetRows, validators, calls };
}

beforeEach(() => gameState.init(TEST_RULES, TEST_ITEMS));

test('plugin registers a validator that flags the deprecated top-level item.reputation', () => {
  const { engine, validators } = makeEngine();
  curatorPlugin(engine);
  assert.equal(validators.length, 1);

  const issues = [];
  const data = { items: {
    good: { attributes: { reputation: 10 } },       // correct shape — no issue
    legacy: { reputation: 10 },                      // deprecated top-level — flagged
  } };
  validators[0](data, { add: (group, message) => issues.push({ group, message }) });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].group, 'Item "legacy"');
  assert.match(issues[0].message, /reputation moved into the attributes object/);
});

test('plugin validator flags the removed rules.curator block', () => {
  const { engine, validators } = makeEngine();
  curatorPlugin(engine);

  const issues = [];
  validators[0]({ items: {}, rules: { curator: { installCost: 200 } } },
    { add: (group, message) => issues.push({ group, message }) });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].group, 'Rules');
  assert.match(issues[0].message, /rules\.curator was removed/);
});

// Arriving in a room with cases opens the curator panel. Only the cases that
// must NOT open it are asserted here — opening one renders DOM these headless
// tests have none of, so the positive path is covered by the browser smoke test.
test('scene:entered opens the panel on arrival only, and only where there is curating to do', () => {
  const { engine, calls } = makeEngine();
  curatorPlugin(engine);
  const enter = (scene, isEntry = true, startsCombat = false) =>
    engine.emit('scene:entered', { sceneId: 'somewhere', scene, isEntry, startsCombat });

  enter({ supportsExhibits: true }, false);
  assert.deepEqual(calls.customUI, [], 'a re-render or save restore does not reopen a closed panel');

  enter({});
  assert.deepEqual(calls.customUI, [], 'a room with no cases is left alone');

  // A fight comes first — one already running, or one the render is about to
  // start (the scene's autoAttack fires right after this emit, so inCombat is
  // still false at emit time).
  enter({ supportsExhibits: true }, true, true);
  assert.deepEqual(calls.customUI, [], 'an auto-encounter about to start keeps the panel shut');

  engine.inCombat = true;
  enter({ supportsExhibits: true });
  assert.deepEqual(calls.customUI, [], 'a fight already running comes first');
});

// ── Museum map layout ────────────────────────────────────────────────────────
// Geometry derived from each wing's slot, so a museum that grows never needs
// hand-placed coordinates. See layoutMuseum for the slot → position rules.

const TEST_LAYOUT = { museumLayout: { top: 1800, left: 2640, roomWidth: 120, roomHeight: 100 } };

// One hall plus `slots` wings, each with a background to prove it survives.
function museumScenes(slots) {
  const scenes = { hall: { museumHall: true, mapDefinitions: { top: 0, left: 0, width: 1, height: 1 } } };
  slots.forEach(slot => {
    scenes[`wing${slot}`] = { museumSlot: slot, mapDefinitions: { top: 0, left: 0, width: 1, height: 1, background: 'red' } };
  });
  return scenes;
}

test('museum layout: wings pair up per column, even north of the hall and odd south', () => {
  const { engine } = makeEngine({ curator: TEST_LAYOUT });
  engine.data.scenes = museumScenes([0, 1, 2, 3]);
  curatorPlugin(engine);

  const geom = (id) => engine.data.scenes[id].mapDefinitions;
  assert.deepEqual(geom('wing0'), { top: 1700, left: 2640, width: 120, height: 100, background: 'red' });
  assert.deepEqual(geom('wing1'), { top: 1900, left: 2640, width: 120, height: 100, background: 'red' });
  assert.deepEqual(geom('wing2'), { top: 1700, left: 2760, width: 120, height: 100, background: 'red' });
  assert.deepEqual(geom('wing3'), { top: 1900, left: 2760, width: 120, height: 100, background: 'red' });
});

test('museum layout: the hall spans every column in use — that is the room for the next wing', () => {
  for (const [slots, width] of [[[], 120], [[0], 120], [[0, 1], 120], [[0, 1, 2], 240], [[0, 1, 2, 3, 4], 360]]) {
    const { engine } = makeEngine({ curator: TEST_LAYOUT });
    engine.data.scenes = museumScenes(slots);
    curatorPlugin(engine);
    assert.equal(engine.data.scenes.hall.mapDefinitions.width, width, `${slots.length} wings`);
  }
});

// (Wing-overlap safety is asserted against the SHIPPED layout in
// data-integrity.test.js — the formula has one owner there.)

test('museum layout: without the manifest config, authored geometry is left alone', () => {
  const { engine } = makeEngine();   // no museumLayout
  engine.data.scenes = museumScenes([0, 1]);
  curatorPlugin(engine);
  assert.deepEqual(engine.data.scenes.wing1.mapDefinitions, { top: 0, left: 0, width: 1, height: 1, background: 'red' });
  assert.deepEqual(engine.data.scenes.hall.mapDefinitions, { top: 0, left: 0, width: 1, height: 1 });
});

// ── Building wings ───────────────────────────────────────────────────────────
// A built wing lives in the save as { id, name, slot }; its scene is synthesized
// from that on boot and on load, so nothing about it is stored twice.

const WING_CONFIG = { curator: { ...TEST_LAYOUT, wingCost: 40 } };

// A museum with just its hall — the state every game starts in.
function hallOnly() {
  return {
    home_museum: {
      museumHall: true, name: 'Museum Lobby', region: 'player_home',
      mapDefinitions: { top: 1800, left: 2640, width: 120, height: 100 },
    },
  };
}

function withMuseum(pluginConfigs = WING_CONFIG) {
  const made = makeEngine(pluginConfigs);
  made.engine.data.scenes = hallOnly();
  curatorPlugin(made.engine);
  return made;
}

test('build_wing: charges the gold and records the wing in the save', () => {
  const { engine, registry } = withMuseum();
  registry.get('build_wing')({ type: 'build_wing', name: 'Pottery Wing' }, engine);

  assert.equal(engine.state.getPlayer().resources.gold, 60);
  assert.deepEqual(gameState.pluginState('curator').rooms,
    [{ id: 'home_museum_wing_0', name: 'Pottery Wing', slot: 0 }]);
});

test('build_wing: synthesizes a bare, exhibitable scene at its derived spot', () => {
  const { engine, registry } = withMuseum();
  registry.get('build_wing')({ type: 'build_wing', name: 'Pottery Wing' }, engine);

  const wing = engine.data.scenes.home_museum_wing_0;
  assert.equal(wing.name, 'Pottery Wing');
  assert.equal(wing.region, 'player_home', 'inherits the hall\'s region, so it maps with the house');
  assert.equal(wing.museumBuilt, true);
  assert.equal(wing.supportsExhibits, true, 'the player can install cases in it');
  assert.equal(wing.showsReputation, true);
  assert.deepEqual(wing.displays, undefined, 'built bare — the player decides what goes in');
  assert.deepEqual(wing.mapDefinitions, { background: undefined, top: 1700, left: 2640, width: 120, height: 100 });
  assert.deepEqual(wing.options[0].actions, [{ type: 'navigate', destination: 'home_museum' }]);
  assert.equal(wing.options[0].isBack, true);
});

test('build_wing: each wing takes the next slot, and the hall widens to cover them', () => {
  const { engine, registry } = withMuseum();
  const hallWidth = () => engine.data.scenes.home_museum.mapDefinitions.width;
  const build = (name) => registry.get('build_wing')({ type: 'build_wing', name, cost: 0 }, engine);

  build('One');
  assert.equal(hallWidth(), 120, 'the first wing fits the column the hall already had');
  build('Two');
  assert.equal(hallWidth(), 120, 'its pair goes south of the same column');
  build('Three');
  assert.equal(hallWidth(), 240, 'the third opens a new column — that is the map room for it');

  const slots = gameState.pluginState('curator').rooms.map(r => r.slot);
  assert.deepEqual(slots, [0, 1, 2]);
  assert.deepEqual(engine.data.scenes.home_museum_wing_2.mapDefinitions.left, 2760);
});

test('build_wing: without a museumLayout, nothing is built and nothing is charged', () => {
  // A wing's geometry is derived from the layout, so a game that configures
  // the curator without one must not build wings that would land nowhere.
  const { engine, registry } = withMuseum({ curator: { wingCost: 40 } });
  registry.get('build_wing')({ type: 'build_wing', name: 'Pottery Wing' }, engine);

  assert.equal(engine.state.getPlayer().resources.gold, 100, 'no gold taken');
  assert.deepEqual(gameState.pluginState('curator').rooms ?? [], []);
  assert.equal(Object.keys(engine.data.scenes).length, 1, 'no scene synthesized');
});

test('build_wing: an unaffordable wing is not built — and no wingCost means the default 250, never 0', () => {
  // installCost falls back to a real price; wingCost must too, or a game that
  // configures the layout but forgets the cost hands out free wings. The
  // player's 100 gold can't cover the default, so this build is refused too.
  const { engine, registry, calls } = withMuseum({ curator: TEST_LAYOUT });
  registry.get('build_wing')({ type: 'build_wing', name: 'Marble Hall' }, engine);

  assert.equal(engine.state.getPlayer().resources.gold, 100, 'no gold taken');
  assert.deepEqual(gameState.pluginState('curator').rooms ?? [], []);
  assert.equal(Object.keys(engine.data.scenes).length, 1, 'no scene synthesized');
  assert.equal(calls.logs[0].message, 'ui.notEnoughGold');
});

test('build_wing: an unnamed wing falls back to a numbered name', () => {
  const { engine, registry } = withMuseum();
  registry.get('build_wing')({ type: 'build_wing' }, engine);
  // The test translator returns keys, so this asserts the fallback path is the
  // locale one rather than a hardcoded English string.
  assert.equal(gameState.pluginState('curator').rooms[0].name, 'plugin.curator.wingDefaultName');
});

test('build_wing: wings survive a save round-trip, and a loaded save drops the last game\'s', () => {
  const { engine, registry } = withMuseum();
  registry.get('build_wing')({ type: 'build_wing', name: 'Pottery Wing' }, engine);

  const save = JSON.parse(JSON.stringify(gameState.state));
  gameState.init(TEST_RULES, TEST_ITEMS);
  assert.equal(engine.data.scenes.home_museum_wing_0, undefined, 'a new game has no built wings');

  assert.equal(gameState.loadFromObject(save), true);
  const wing = engine.data.scenes.home_museum_wing_0;
  assert.equal(wing?.name, 'Pottery Wing', 'the load rebuilt the wing from the save');
  assert.deepEqual(wing.mapDefinitions.top, 1700, 'and re-derived its geometry');

  // A save from a museum-less game must take the wing back off the map.
  const empty = JSON.parse(JSON.stringify(save));
  empty.plugins.curator.rooms = [];
  assert.equal(gameState.loadFromObject(empty), true);
  assert.equal(engine.data.scenes.home_museum_wing_0, undefined);
  assert.equal(engine.data.scenes.home_museum.mapDefinitions.width, 120);
});

test('a pre-time (v3) save with the curator active runs core AND plugin migrations', () => {
  const { engine } = makeEngine();
  curatorPlugin(engine); // idempotent — ensures the curator migration is registered

  const ok = gameState.loadFromObject({
    saveVersion: 3,
    player: {
      name: 'Keeper', level: 1, xp: 0,
      resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 5 },
      attributes: { ac: 10, initiative: 0, reputation: 0 },
      inventory: [{ item: 'relic_crown', amount: 1 }],
      equipment: { 'Right Hand': 'rusty_sword' },
    },
    flags: {}, missions: {}, chests: {},
    displays: { museum_room: [{ id: 'display_1', name: 'Case', item: 'relic_shard' }] },
    visitedScenes: [], log: [],
  });

  assert.equal(ok, true);
  // Before the version-line partition, the curator's migration shadowed core
  // v4 and these two seeds were silently skipped.
  assert.deepEqual(gameState.state.time, { ticks: 0 }, 'core v4 seeded the clock');
  assert.deepEqual(gameState.state.timers, [], 'core v4 seeded timers');
  assert.equal(gameState.pluginState('curator').museumReputation, 0, 'the curator migration seeded the permanent score');
  // The backfill sweeps every place a relic can already live: carried,
  // worn, and exhibited.
  assert.deepEqual([...gameState.pluginState('curator').obtainedItems].sort(),
    ['relic_crown', 'relic_shard', 'rusty_sword']);
  // Core and plugin versions are partitioned: the core counter never carries
  // the curator's number.
  assert.equal(gameState.state.saveVersion, 4);
  assert.equal(gameState.state.pluginSaveVersions.curator, 1);
});
