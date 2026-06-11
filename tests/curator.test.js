import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import curatorPlugin from '../src/plugins/curator.js';
import { ACTIONS } from '../src/core/config.js';

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
  relic_crown: { name: 'Ancient Crown', type: 'Flavour', reputation: 25 },
};

// Minimal engine mock — only the registration surface the plugin touches.
function makeEngine() {
  const registry = new Map();
  const decorators = [];
  const calls = { logs: [], customUI: [] };
  const engine = {
    data: { items: TEST_ITEMS, scenes: {}, rules: null },
    t: (key) => key,
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    registerAction: (name, fn) => registry.set(name, fn),
    registerSceneDecorator: (decorator) => decorators.push(decorator),
    setCustomUIOpen: (open) => calls.customUI.push(open),
    scene: { handleOption: () => {} },
  };
  return { engine, registry, decorators, calls };
}

beforeEach(() => gameState.init(TEST_RULES, TEST_ITEMS));

test('plugin registers its scene decorator and action handlers', () => {
  const { engine, registry, decorators } = makeEngine();
  curatorPlugin(engine);
  assert.equal(decorators.length, 1);
  assert.equal(typeof decorators[0].description, 'function');
  assert.equal(typeof decorators[0].options, 'function');
  assert.ok(registry.has(ACTIONS.MANAGE_EXHIBITS));
  assert.ok(registry.has(ACTIONS.ADD_DISPLAY));
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
  registry.get(ACTIONS.ADD_DISPLAY)({ type: ACTIONS.ADD_DISPLAY, name: 'Oak Pedestal', cost: 40 }, engine);

  const displays = gameState.getDisplaysForScene('home_museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].name, 'Oak Pedestal');
  assert.equal(gameState.getPlayer().resources.gold, 60);
});

test('add_display: refuses when the player cannot afford it', () => {
  const { engine, registry, calls } = makeEngine();
  curatorPlugin(engine);
  gameState.setCurrentSceneId('home_museum');
  registry.get(ACTIONS.ADD_DISPLAY)({ type: ACTIONS.ADD_DISPLAY, cost: 500 }, engine);

  assert.equal(gameState.getDisplaysForScene('home_museum').length, 0);
  assert.equal(gameState.getPlayer().resources.gold, 100);
  assert.equal(calls.logs[0].message, 'ui.notEnoughGold');
});

test('add_display: an explicit target scene overrides the current scene', () => {
  const { engine, registry } = makeEngine();
  curatorPlugin(engine);
  gameState.setCurrentSceneId('home_museum');
  registry.get(ACTIONS.ADD_DISPLAY)({ type: ACTIONS.ADD_DISPLAY, scene: 'home_museum_armor', cost: 0 }, engine);

  assert.equal(gameState.getDisplaysForScene('home_museum').length, 0);
  assert.equal(gameState.getDisplaysForScene('home_museum_armor').length, 1);
});
