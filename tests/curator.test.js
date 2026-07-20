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
  const calls = { logs: [], customUI: [] };
  const engine = {
    data: { items: TEST_ITEMS, scenes: {}, rules: null },
    state: gameState,
    t: (key) => key,
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

test('plugin registers its scene decorator, action handlers, and sheet row', () => {
  const { engine, registry, decorators, sheetRows } = makeEngine();
  curatorPlugin(engine);
  assert.equal(decorators.length, 1);
  assert.equal(typeof decorators[0].description, 'function');
  assert.equal(typeof decorators[0].options, 'function');
  assert.ok(registry.has('manage_exhibits'));
  assert.ok(registry.has('add_display'));
  assert.deepEqual(sheetRows, [{ label: 'plugin.curator.reputationLabel', bind: 'attributes.reputation' }]);
});

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

test('exhibits decorator: scenes without displays get no table', () => {
  const { engine, decorators } = makeEngine();
  curatorPlugin(engine);
  assert.equal(decorators[0].description({}, 'home_kitchen', engine), '');
});

test('exhibits decorator: renders a row per display with item label or empty marker', () => {
  const { engine, decorators } = makeEngine();
  curatorPlugin(engine);
  gameState.addDisplayToScene('home_museum', { id: 'd1', name: 'North Stand', item: 'relic_crown' });
  gameState.addDisplayToScene('home_museum', { id: 'd2', name: 'South Stand' });

  const html = decorators[0].description({}, 'home_museum', engine);
  assert.match(html, /North Stand/);
  assert.match(html, /Ancient Crown/);
  assert.match(html, /South Stand/);
  assert.match(html, /plugin\.curator\.curatorEmpty/);
});

test('exhibits decorator: player-entered display names are HTML-escaped', () => {
  const { engine, decorators } = makeEngine();
  curatorPlugin(engine);
  gameState.addDisplayToScene('home_museum', { id: 'd1', name: '<img src=x onerror=alert(1)>' });

  const html = decorators[0].description({}, 'home_museum', engine);
  assert.ok(!html.includes('<img'), 'expected the raw tag to be escaped');
  assert.match(html, /&lt;img/);
});

test('add_display: installs a named display and charges the cost', () => {
  const { engine, registry } = makeEngine();
  curatorPlugin(engine);
  gameState.setCurrentSceneId('home_museum');
  registry.get('add_display')({ type: 'add_display', name: 'Oak Pedestal', cost: 40 }, engine);

  const displays = gameState.getDisplaysForScene('home_museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].name, 'Oak Pedestal');
  assert.equal(gameState.getPlayer().resources.gold, 60);
});

test('add_display: refuses when the player cannot afford it', () => {
  const { engine, registry, calls } = makeEngine();
  curatorPlugin(engine);
  gameState.setCurrentSceneId('home_museum');
  registry.get('add_display')({ type: 'add_display', cost: 500 }, engine);

  assert.equal(gameState.getDisplaysForScene('home_museum').length, 0);
  assert.equal(gameState.getPlayer().resources.gold, 100);
  assert.equal(calls.logs[0].message, 'ui.notEnoughGold');
});

test('add_display: an explicit target scene overrides the current scene', () => {
  const { engine, registry } = makeEngine();
  curatorPlugin(engine);
  gameState.setCurrentSceneId('home_museum');
  registry.get('add_display')({ type: 'add_display', scene: 'home_museum_armor', cost: 0 }, engine);

  assert.equal(gameState.getDisplaysForScene('home_museum').length, 0);
  assert.equal(gameState.getDisplaysForScene('home_museum_armor').length, 1);
});

test('a pre-time (v3) save with the curator active runs core AND plugin migrations', () => {
  const { engine } = makeEngine();
  curatorPlugin(engine); // idempotent — ensures migration 5 is registered

  const ok = gameState.loadFromObject({
    saveVersion: 3,
    player: {
      name: 'Keeper', level: 1, xp: 0,
      resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 5 },
      attributes: { ac: 10, initiative: 0, reputation: 0 },
      inventory: [{ item: 'relic_crown', amount: 1 }],
      equipment: {},
    },
    flags: {}, missions: {}, chests: {}, displays: {}, visitedScenes: [], log: [],
  });

  assert.equal(ok, true);
  // Before the collision guard, the curator's migration shadowed core v4 and
  // these two seeds were silently skipped.
  assert.deepEqual(gameState.state.time, { ticks: 0 }, 'core v4 seeded the clock');
  assert.deepEqual(gameState.state.timers, [], 'core v4 seeded timers');
  assert.equal(gameState.pluginState('curator').museumReputation, 0, 'curator v5 seeded the permanent score');
  assert.deepEqual(gameState.pluginState('curator').obtainedItems, ['relic_crown'], 'curator v5 backfilled owned relics');
  assert.equal(gameState.state.saveVersion, 5);
});
