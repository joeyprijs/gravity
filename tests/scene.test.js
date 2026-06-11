import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { SceneRenderer } from '../src/systems/scene.js';
import { FLAG_KEYS } from '../src/core/config.js';

// Minimal rules required by gameState.init() — mirrors the key values from rules.json.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0, perception: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

const TEST_ITEMS = {
  healing_potion: { name: 'Healing Potion' },
  rusty_sword:    { name: 'Rusty Sword' },
};

// Minimal engine mock — covers everything the headless SceneRenderer logic
// touches. t() echoes the locale key so log assertions compare against keys.
function makeEngine({ items = TEST_ITEMS, scenes = {}, tables = {}, hooks = {}, decorators = [] } = {}) {
  const calls = { logs: [], renderedScenes: [], combat: [], emitted: [] };
  const engine = {
    data: { items, scenes, tables, npcs: {}, rules: null },
    t: (key) => key,
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    emit: (event, data) => calls.emitted.push({ event, data }),
    getDescriptionHook: (name) => hooks[name] || null,
    sceneDecorators: decorators,
    combatSystem: { startCombat: (enemies, cfg) => calls.combat.push({ enemies, cfg }) },
    renderScene: (sceneId) => calls.renderedScenes.push(sceneId),
    runActions: () => {},
    inCombat: false,
    inDialogue: false,
    inCustomUI: false,
    isGameStart: false,
  };
  return { engine, calls };
}

function makeSR(engineOpts) {
  const { engine, calls } = makeEngine(engineOpts);
  const sr = new SceneRenderer(engine);
  sr.renderOptions = mock.fn();
  return { sr, engine, calls };
}

beforeEach(() => gameState.init(TEST_RULES));
afterEach(() => mock.restoreAll());

// ── _resolveDescription ───────────────────────────────────────────────────────

test('_resolveDescription: plain string is returned as-is', () => {
  const { sr } = makeSR();
  assert.equal(sr._resolveDescription({ description: 'A damp cell.' }), 'A damp cell.');
});

test('_resolveDescription: conditional array falls back to the unconditioned entry', () => {
  const { sr } = makeSR();
  const scene = { description: [
    { condition: { flag: 'door_open', value: true }, text: 'The door stands open.' },
    { text: 'The door is shut.' },
  ]};
  assert.equal(sr._resolveDescription(scene), 'The door is shut.');
});

test('_resolveDescription: first matching conditional entry wins', () => {
  const { sr } = makeSR();
  gameState.setFlag('door_open', true);
  const scene = { description: [
    { condition: { flag: 'door_open', value: true }, text: 'The door stands open.' },
    { condition: { flag: 'door_open', value: true }, text: 'Never reached.' },
    { text: 'The door is shut.' },
  ]};
  assert.equal(sr._resolveDescription(scene), 'The door stands open.');
});

test('_resolveDescription: descriptionHook output is appended', () => {
  const { sr } = makeSR({ hooks: { weather: () => ' Rain patters down.' } });
  const scene = { description: 'A courtyard.', descriptionHook: 'weather' };
  assert.equal(sr._resolveDescription(scene), 'A courtyard. Rain patters down.');
});

test('_resolveDescription: scene decorators append to every scene', () => {
  const decorator = { description: (scene, sceneId) => `<aside>${sceneId}</aside>` };
  const { sr } = makeSR({ decorators: [decorator] });
  gameState.setCurrentSceneId('cell');
  assert.equal(sr._resolveDescription({ description: 'Bare walls.' }), 'Bare walls.<aside>cell</aside>');
});

// ── _rollTable ────────────────────────────────────────────────────────────────

test('_rollTable: unknown or empty tables return null', () => {
  const { sr } = makeSR({ tables: { empty: { entries: [] } } });
  assert.equal(sr._rollTable('missing'), null);
  assert.equal(sr._rollTable('empty'), null);
});

test('_rollTable: weighted picks honour entry weights', () => {
  const entries = [{ item: 'common', weight: 3 }, { item: 'rare', weight: 1 }];
  const { sr } = makeSR({ tables: { loot: { entries } } });
  // Total weight 4: r in (0,3] → common, r in (3,4] → rare.
  mock.method(Math, 'random', () => 0.5); // r = 2
  assert.equal(sr._rollTable('loot').item, 'common');
  mock.method(Math, 'random', () => 0.9); // r = 3.6
  assert.equal(sr._rollTable('loot').item, 'rare');
});

test('_rollTable: weight defaults to 1 per entry', () => {
  const entries = [{ item: 'a' }, { item: 'b' }];
  const { sr } = makeSR({ tables: { loot: { entries } } });
  mock.method(Math, 'random', () => 0.99); // r = 1.98 → second entry
  assert.equal(sr._rollTable('loot').item, 'b');
});

// ── _awardDiscoveredLoot ──────────────────────────────────────────────────────

test('_awardDiscoveredLoot: single item is added and logged by name', () => {
  const { sr, calls } = makeSR();
  sr._awardDiscoveredLoot([{ item: 'healing_potion' }]);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion').amount, 1);
  assert.equal(calls.logs[0].message, 'Found Healing Potion.');
});

test('_awardDiscoveredLoot: gold goes to the gold resource', () => {
  const { sr, calls } = makeSR();
  sr._awardDiscoveredLoot([{ item: 'gold', amount: 7 }]);
  assert.equal(gameState.getPlayer().resources.gold, 7);
  assert.equal(gameState.getPlayer().inventory.length, 0);
  assert.equal(calls.logs[0].message, 'Found 7 loot.gold.');
});

test('_awardDiscoveredLoot: duplicate drops aggregate into one stack and label', () => {
  const { sr, calls } = makeSR();
  sr._awardDiscoveredLoot([{ item: 'healing_potion' }, { item: 'healing_potion', amount: 2 }]);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion').amount, 3);
  assert.equal(calls.logs[0].message, 'Found Healing Potion (x3).');
});

test('_awardDiscoveredLoot: two kinds of loot join with "and"', () => {
  const { sr, calls } = makeSR();
  sr._awardDiscoveredLoot([{ item: 'healing_potion' }, { item: 'rusty_sword' }]);
  assert.equal(calls.logs[0].message, 'Found Healing Potion and Rusty Sword.');
});

test('_awardDiscoveredLoot: table entries roll concrete drops', () => {
  const entries = [{ item: 'healing_potion' }];
  const { sr } = makeSR({ tables: { stash: { entries } } });
  sr._awardDiscoveredLoot([{ table: 'stash', itemDrops: 2 }]);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion').amount, 2);
});

test('_awardDiscoveredLoot: nothing found logs nothing', () => {
  const { sr, calls } = makeSR();
  sr._awardDiscoveredLoot([]);
  assert.equal(calls.logs.length, 0);
});

// ── _resolveDiscovery ─────────────────────────────────────────────────────────

test('_resolveDiscovery: hits mark items found, misses escalate their DC', () => {
  const { sr } = makeSR();
  gameState.setCurrentSceneId('cell');
  const opt = { skillCheck: 'perception', items: [{ item: 'healing_potion', dc: 5 }, { item: 'rusty_sword', dc: 15, increment: 2 }] };
  const state = { dcs: [5, 15], found: [false, false] };
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');

  mock.method(Math, 'random', () => 0.45); // roll(1,20) = 10: ≥5 hits, <15 misses
  sr._resolveDiscovery(opt, state, skillKey, {});

  const saved = gameState.getFlag(skillKey);
  assert.deepEqual(saved.found, [true, false]);
  assert.deepEqual(saved.dcs, [5, 17]);
  assert.ok(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion'));
  assert.equal(sr.renderOptions.mock.callCount(), 1);
});

test('_resolveDiscovery: log key reflects found / found-more / fail', () => {
  const { sr, calls } = makeSR();
  const opt = { skillCheck: 'perception', items: [{ item: 'healing_potion', dc: 5 }, { item: 'rusty_sword', dc: 15 }] };
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');

  // Each discovery logs the roll outcome first, then the found-loot summary.
  mock.method(Math, 'random', () => 0.45); // roll 10: one hit, one miss → more to find
  sr._resolveDiscovery(opt, { dcs: [5, 15], found: [false, false] }, skillKey, {});
  assert.equal(calls.logs[0].message, 'actions.lookAroundFoundMore');

  mock.method(Math, 'random', () => 0.95); // roll 20: last item found
  sr._resolveDiscovery(opt, { dcs: [5, 16], found: [true, false] }, skillKey, {});
  assert.equal(calls.logs[2].message, 'actions.lookAroundFound');

  mock.method(Math, 'random', () => 0); // roll 1: nothing found
  sr._resolveDiscovery(opt, { dcs: [5, 15], found: [false, false] }, skillKey, {});
  assert.equal(calls.logs.at(-1).message, 'actions.lookAroundFail');
});

// ── render preludes ───────────────────────────────────────────────────────────

test('_registerInitialDisplays: registers scene displays once', () => {
  const { sr } = makeSR();
  const scene = { displays: [{ id: 'case1', name: 'Glass Case' }] };
  sr._registerInitialDisplays(scene, 'museum');
  sr._registerInitialDisplays(scene, 'museum');
  const displays = gameState.getDisplaysForScene('museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].id, 'case1');
});

test('_registerInitialDisplays: leaves save-restored displays untouched', () => {
  const { sr } = makeSR();
  gameState.addDisplayToScene('museum', { id: 'from_save', name: 'Old Case', item: 'rusty_sword' });
  sr._registerInitialDisplays({ displays: [{ id: 'case1', name: 'Glass Case' }] }, 'museum');
  const displays = gameState.getDisplaysForScene('museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].id, 'from_save');
});

test('_resetSkillDcs: pass/fail checks reset their escalation map on re-entry', () => {
  const { sr } = makeSR();
  const key = FLAG_KEYS.skillDc('lockpick', 'cell');
  gameState.setFlag(key, { 0: 16 });
  sr._resetSkillDcs({ skills: [{ skillCheck: 'lockpick', dc: 10 }] }, 'cell');
  assert.deepEqual(gameState.getFlag(key), {});
});

test('_resetSkillDcs: item discovery resets DCs but keeps found items', () => {
  const { sr } = makeSR();
  const key = FLAG_KEYS.skillDc('perception', 'cell');
  gameState.setFlag(key, { dcs: [9, 19], found: [true, false] });
  sr._resetSkillDcs({ skills: [{ skillCheck: 'perception', items: [{ dc: 5 }, { dc: 15 }] }] }, 'cell');
  assert.deepEqual(gameState.getFlag(key), { dcs: [5, 15], found: [true, false] });
});

test('_resetSkillDcs: discovery checks never attempted are left alone', () => {
  const { sr } = makeSR();
  const key = FLAG_KEYS.skillDc('perception', 'cell');
  sr._resetSkillDcs({ skills: [{ skillCheck: 'perception', items: [{ dc: 5 }] }] }, 'cell');
  assert.equal(gameState.getFlag(key), false);
});

// ── _maybeStartAutoAttack ─────────────────────────────────────────────────────

test('_maybeStartAutoAttack: no autoAttack returns false', () => {
  const { sr, calls } = makeSR();
  assert.equal(sr._maybeStartAutoAttack({}), false);
  assert.equal(calls.combat.length, 0);
});

test('_maybeStartAutoAttack: unmet condition blocks the encounter', () => {
  const { sr, calls } = makeSR();
  const scene = { autoAttack: { enemies: ['goblin_grunt'], condition: { flag: 'ambush', value: true } } };
  assert.equal(sr._maybeStartAutoAttack(scene), false);
  assert.equal(calls.combat.length, 0);
});

test('_maybeStartAutoAttack: starts combat and reports true when allowed', () => {
  const { sr, calls } = makeSR();
  const scene = { autoAttack: { enemies: ['goblin_grunt'] } };
  assert.equal(sr._maybeStartAutoAttack(scene), true);
  assert.deepEqual(calls.combat[0].enemies, ['goblin_grunt']);
});

// ── render guards / handleOption / restoreFromSave ────────────────────────────

test('render: refuses to render during combat', () => {
  const { sr, engine } = makeSR();
  engine.inCombat = true;
  gameState.setCurrentSceneId('cell');
  sr.render('elsewhere');
  assert.equal(gameState.getCurrentSceneId(), 'cell');
});

test('render: unknown scene logs an error and bails', () => {
  const error = mock.method(console, 'error', () => {});
  const { sr } = makeSR();
  sr.render('no_such_scene');
  assert.equal(error.mock.callCount(), 1);
});

test('handleOption: re-renders options when no action navigated', () => {
  const scene = { options: [] };
  const { sr, engine } = makeSR({ scenes: { cell: scene } });
  gameState.setCurrentSceneId('cell');
  sr.handleOption({ text: 'Inspect the wall', actions: [] });
  assert.equal(sr.renderOptions.mock.callCount(), 1);
  assert.equal(sr.renderOptions.mock.calls[0].arguments[0], scene);
});

test('handleOption: skips the re-render when an action changed the scene', () => {
  const { sr, engine } = makeSR({ scenes: { cell: {} } });
  gameState.setCurrentSceneId('cell');
  engine.runActions = () => gameState.setCurrentSceneId('corridor');
  sr.handleOption({ text: 'Head north', actions: [{ type: 'navigate', destination: 'corridor' }] });
  assert.equal(sr.renderOptions.mock.callCount(), 0);
});

test('handleOption: log false suppresses the player choice log', () => {
  const { sr, calls } = makeSR({ scenes: { cell: {} } });
  gameState.setCurrentSceneId('cell');
  sr.handleOption({ text: 'Silent option', log: false, actions: [] });
  assert.equal(calls.logs.length, 0);
});

test('restoreFromSave: syncs the description cache and re-renders options', () => {
  const scene = { options: [] };
  const { sr } = makeSR({ scenes: { cell: scene } });
  sr.restoreFromSave('cell', 'A damp cell.');
  assert.equal(sr.lastRenderedSceneId, 'cell');
  assert.equal(sr.lastRenderedDesc, 'A damp cell.');
  assert.equal(sr.renderOptions.mock.callCount(), 1);
});

test('restoreFromSave: a null description leaves the cache empty', () => {
  const { sr } = makeSR({ scenes: { cell: {} } });
  sr.restoreFromSave('cell', null);
  assert.equal(sr.lastRenderedSceneId, null);
});
