import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { SceneRenderer } from '../src/systems/scene.js';
import { FLAG_KEYS } from '../src/core/config.js';
import { getAttempts, recordAttempt } from '../src/systems/skill-checks.js';

// Minimal DOM stand-in — just enough for createElement/buildOptionButton to run
// headless. Elements are only built by the code under test, never queried back.
const fakeEl = () => ({
  classList: { add() {} },
  children: [],
  appendChild(child) { this.children.push(child); return child; },
  setAttribute() {},
  removeAttribute() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});
globalThis.document = { createElement: fakeEl, getElementById: fakeEl };

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
    openScene: () => {},
    currentSceneEl: { appendChild: () => {} },
    scrollNarrativeToBottom: () => {},
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

test('_resolveDiscovery: hits mark items found, misses stay at their base DC', () => {
  const { sr } = makeSR();
  gameState.setCurrentSceneId('cell');
  const opt = { skillCheck: 'perception', items: [{ item: 'healing_potion', dc: 5 }, { item: 'rusty_sword', dc: 15 }] };
  const state = { found: [false, false] };
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');

  mock.method(Math, 'random', () => 0.45); // roll(1,20) = 10: ≥5 hits, <15 misses
  sr._resolveDiscovery(opt, 0, state, skillKey, {});

  const saved = gameState.getFlag(skillKey).disc_0;
  assert.deepEqual(saved.found, [true, false]);
  assert.equal(saved.tries, 1);
  assert.ok(!saved.resolved);
  assert.ok(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion'));
  assert.equal(sr.renderOptions.mock.callCount(), 1);
});

test('_resolveDiscovery: maxAttempts exhaustion retires the check and runs onExhausted', () => {
  const { sr, engine } = makeSR();
  gameState.setCurrentSceneId('cell');
  const ranPipelines = [];
  engine.runActions = (actions) => ranPipelines.push(actions);
  const opt = {
    skillCheck: 'perception',
    maxAttempts: 2,
    onExhausted: [{ type: 'set_flag', flag: 'gave_up', value: true }],
    items: [{ item: 'rusty_sword', dc: 25 }],
  };
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');

  mock.method(Math, 'random', () => 0); // roll 1: never finds anything
  sr._resolveDiscovery(opt, 0, { found: [false] }, skillKey, {});
  assert.ok(!gameState.getFlag(skillKey).disc_0.resolved);
  assert.equal(ranPipelines.length, 0);

  sr._resolveDiscovery(opt, 0, gameState.getFlag(skillKey).disc_0, skillKey, {});
  assert.ok(gameState.getFlag(skillKey).disc_0.resolved);
  assert.deepEqual(ranPipelines, [opt.onExhausted]);
});

test('_resolveDiscovery: resolveOnce retires the check after a single roll', () => {
  const { sr } = makeSR();
  gameState.setCurrentSceneId('cell');
  const opt = { skillCheck: 'perception', resolveOnce: true, items: [{ item: 'rusty_sword', dc: 25 }] };
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');

  mock.method(Math, 'random', () => 0); // roll 1: nothing found
  sr._resolveDiscovery(opt, 0, { found: [false] }, skillKey, {});
  assert.ok(gameState.getFlag(skillKey).disc_0.resolved);
  // A retired check no longer renders a button.
  assert.equal(sr._buildItemDiscoveryButton(opt, 0, 'cell', {}), null);
});

test('_resolveDiscovery: log key reflects found / found-more / fail', () => {
  const { sr, calls } = makeSR();
  const opt = { skillCheck: 'perception', items: [{ item: 'healing_potion', dc: 5 }, { item: 'rusty_sword', dc: 15 }] };
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');

  // Each discovery logs the roll line, then the outcome narration as its own
  // entry, then the found-loot summary.
  mock.method(Math, 'random', () => 0.45); // roll 10: one hit, one miss → more to find
  sr._resolveDiscovery(opt, 0, { found: [false, false] }, skillKey, {});
  assert.equal(calls.logs[0].message, 'actions.lookAroundRoll');
  assert.equal(calls.logs[1].message, 'actions.lookAroundFoundMore');

  mock.method(Math, 'random', () => 0.95); // roll 20: last item found
  sr._resolveDiscovery(opt, 0, { found: [true, false] }, skillKey, {});
  assert.equal(calls.logs[4].message, 'actions.lookAroundFound');

  mock.method(Math, 'random', () => 0); // roll 1: nothing found
  sr._resolveDiscovery(opt, 0, { found: [false, false] }, skillKey, {});
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

test('_resetSkillAttempts: clears attempt counters but keeps resolution markers', () => {
  const { sr } = makeSR();
  const key = FLAG_KEYS.skillDc('lockpick', 'cell');
  gameState.setFlag(key, { tries_0: 2, resolved_1: true });
  sr._resetSkillAttempts({ skills: [{ skillCheck: 'lockpick', dc: 10 }] }, 'cell');
  assert.deepEqual(gameState.getFlag(key), { resolved_1: true });
});

test('_resetSkillAttempts: discovery keeps found items and resolution, drops tries', () => {
  const { sr } = makeSR();
  const key = FLAG_KEYS.skillDc('perception', 'cell');
  gameState.setFlag(key, { found: [true, false], tries: 3, resolved: true });
  sr._resetSkillAttempts({ skills: [{ skillCheck: 'perception', items: [{ dc: 5 }, { dc: 15 }] }] }, 'cell');
  assert.deepEqual(gameState.getFlag(key), { found: [true, false], resolved: true });
});

test('_resetSkillAttempts: checks never attempted are left alone', () => {
  const { sr } = makeSR();
  const key = FLAG_KEYS.skillDc('perception', 'cell');
  sr._resetSkillAttempts({ skills: [{ skillCheck: 'perception', items: [{ dc: 5 }] }] }, 'cell');
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

test('render: skipAutoAttack suppresses the scene autoAttack (post-victory re-render)', () => {
  const scene = { description: 'Goblins block the way.', autoAttack: { enemies: ['goblin_grunt'] } };
  const { sr, calls } = makeSR({ scenes: { corridor: scene } });
  sr.render('corridor', { skipAutoAttack: true });
  assert.equal(calls.combat.length, 0);
  sr.render('corridor');
  assert.equal(calls.combat.length, 1);
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

// ── _buildPassFailButton: re-render guards ────────────────────────────────────

test('_buildPassFailButton: success that opens a dialogue skips the scene re-render', () => {
  const { sr, engine, calls } = makeSR({ scenes: { cell: {} } });
  gameState.setCurrentSceneId('cell');
  engine.runActions = () => { engine.inDialogue = true; };
  mock.method(Math, 'random', () => 0.99); // d20 roll of 20 — passes DC 5
  const btn = sr._buildPassFailButton(
    { text: 'Persuade the guard', skillCheck: 'perception', dc: 5, actions: [{ type: 'dialogue', npc: 'guard' }] },
    0, 'cell', {}
  );
  btn.onclick();
  assert.equal(calls.renderedScenes.length, 0);
});

test('_buildPassFailButton: failure whose onFailure opens a custom UI skips the options re-render', () => {
  const { sr, engine } = makeSR({ scenes: { cell: {} } });
  gameState.setCurrentSceneId('cell');
  engine.runActions = () => { engine.inCustomUI = true; };
  mock.method(Math, 'random', () => 0); // d20 roll of 1 — fails DC 5
  const btn = sr._buildPassFailButton(
    { text: 'Pick the lock', skillCheck: 'perception', dc: 5, onFailure: [{ type: 'manage_chest' }] },
    0, 'cell', {}
  );
  btn.onclick();
  assert.equal(sr.renderOptions.mock.callCount(), 0);
});

// ── Outcome tiers, resolveOnce, maxAttempts ──────────────────────────────────


test('_buildPassFailButton: partial tier runs its pipeline and still counts an attempt', () => {
  const { sr, engine } = makeSR();
  gameState.setCurrentSceneId('cell');
  const ran = [];
  engine.runActions = (a) => ran.push(a);
  const partialActions = [{ type: 'set_flag', flag: 'grazed', value: true }];
  const opt = { text: 'Sneak', skillCheck: 'perception', dc: 12, outcomes: { partial: { margin: 3, actions: partialActions } } };
  const btn = sr._buildPassFailButton(opt, 0, 'cell', {});
  mock.method(Math, 'random', () => 0.5); // roll 11 vs DC 12 → margin -1 → partial
  btn.onclick();
  assert.deepEqual(ran, [partialActions]);
  assert.equal(getAttempts(FLAG_KEYS.skillDc('perception', 'cell'), 0), 1);
});

test('_buildPassFailButton: resolveOnce retires the check after a single roll', () => {
  const { sr } = makeSR();
  gameState.setCurrentSceneId('cell');
  const opt = { text: 'Leap', skillCheck: 'perception', dc: 15, resolveOnce: true };
  const btn = sr._buildPassFailButton(opt, 0, 'cell', {});
  mock.method(Math, 'random', () => 0); // roll 1 — failure
  btn.onclick();
  assert.equal(sr._buildPassFailButton(opt, 0, 'cell', {}), null);
});

test('_buildPassFailButton: exhausting maxAttempts runs onExhausted and retires the check', () => {
  const { sr, engine } = makeSR();
  gameState.setCurrentSceneId('cell');
  const ran = [];
  engine.runActions = (a) => ran.push(a);
  const onExhausted = [{ type: 'set_flag', flag: 'gave_up', value: true }];
  const opt = { text: 'Plead', skillCheck: 'perception', dc: 18, maxAttempts: 2, onExhausted };
  mock.method(Math, 'random', () => 0); // always roll 1 — failure

  sr._buildPassFailButton(opt, 0, 'cell', {}).onclick();
  assert.ok(!ran.includes(onExhausted));

  sr._buildPassFailButton(opt, 0, 'cell', {}).onclick();
  assert.ok(ran.includes(onExhausted));
  assert.equal(sr._buildPassFailButton(opt, 0, 'cell', {}), null);
});


// ── Narrative (free) checks ───────────────────────────────────────────────────

test('_buildNarrativeButton: logs resultText, runs actions, and retires after one use', () => {
  const { sr, engine, calls } = makeSR();
  gameState.setCurrentSceneId('cell');
  const ran = [];
  engine.runActions = (a) => ran.push(a);
  const actions = [{ type: 'set_flag', flag: 'read_tracks', value: true }];
  const opt = { text: 'Study the tracks', skillCheck: 'perception', resultText: 'Old footprints.', actions };

  const btn = sr._buildNarrativeButton(opt, 0, 'cell', {});
  btn.onclick();
  assert.ok(calls.logs.some(l => l.message === 'Old footprints.'));
  assert.deepEqual(ran, [actions]);
  assert.equal(sr._buildNarrativeButton(opt, 0, 'cell', {}), null);
});

test('_buildNarrativeButton: repeatable checks walk resultText variants per use', () => {
  const { sr, calls } = makeSR();
  gameState.setCurrentSceneId('cell');
  const opt = { text: 'Listen', skillCheck: 'perception', repeatable: true, resultText: ['Dripping water.', 'Still dripping.'] };

  sr._buildNarrativeButton(opt, 0, 'cell', {}).onclick();
  assert.ok(calls.logs.some(l => l.message === 'Dripping water.'));
  const again = sr._buildNarrativeButton(opt, 0, 'cell', {});
  assert.notEqual(again, null);
  again.onclick();
  assert.ok(calls.logs.some(l => l.message === 'Still dripping.'));
});

test('_buildNarrativeButton: without resultText falls back to the locale line', () => {
  const { sr, calls } = makeSR();
  gameState.setCurrentSceneId('cell');
  sr._buildNarrativeButton({ text: 'Look', skillCheck: 'perception' }, 0, 'cell', {}).onclick();
  assert.ok(calls.logs.some(l => l.message === 'actions.lookAroundEmpty'));
});


// ── Passive checks ────────────────────────────────────────────────────────────

test('_rollPassiveChecks: writes the flag once, returns success texts, never re-rolls', () => {
  const { sr } = makeSR();
  const scene = { passiveChecks: [{ skillCheck: 'perception', dc: 10, flag: 'noticed', text: 'A glint.' }] };

  mock.method(Math, 'random', () => 0.99); // roll 20 — success
  assert.deepEqual(sr._rollPassiveChecks(scene, 'cell'), ['A glint.']);
  assert.equal(gameState.getFlag('noticed'), true);

  // Re-entry: already rolled — nothing changes even with a losing roll queued.
  mock.method(Math, 'random', () => 0);
  assert.deepEqual(sr._rollPassiveChecks(scene, 'cell'), []);
  assert.equal(gameState.getFlag('noticed'), true);
});

test('_rollPassiveChecks: failure writes false and stays silent', () => {
  const { sr } = makeSR();
  const scene = { passiveChecks: [{ skillCheck: 'perception', dc: 15, flag: 'noticed', text: 'A glint.' }] };
  mock.method(Math, 'random', () => 0); // roll 1 — failure
  assert.deepEqual(sr._rollPassiveChecks(scene, 'cell'), []);
  assert.equal(gameState.getFlag('noticed'), false);
});

// ── Time costs ────────────────────────────────────────────────────────────────

test('handleOption: navigate options charge the default travel cost before the pipeline', () => {
  const { sr, engine } = makeSR({ scenes: { cell: {} } });
  engine.data.rules = { time: { defaultCosts: { navigate: 2 } } };
  const charged = [];
  engine.advanceTime = (n) => charged.push(n);
  gameState.setCurrentSceneId('cell');
  sr.handleOption({ text: 'Go', actions: [{ type: 'navigate', destination: 'exit' }] });
  assert.deepEqual(charged, [2]);
});

test('handleOption: an explicit timeCost of 0 opts out of the default', () => {
  const { sr, engine } = makeSR({ scenes: { cell: {} } });
  engine.data.rules = { time: { defaultCosts: { navigate: 2 } } };
  const charged = [];
  engine.advanceTime = (n) => charged.push(n);
  gameState.setCurrentSceneId('cell');
  sr.handleOption({ text: 'Go', timeCost: 0, actions: [{ type: 'navigate', destination: 'exit' }] });
  assert.deepEqual(charged, []);
});

test('skill attempts charge the skillAttempt default (or their explicit timeCost)', () => {
  const { sr, engine } = makeSR();
  engine.data.rules = { time: { defaultCosts: { skillAttempt: 1 } } };
  const charged = [];
  engine.advanceTime = (n) => charged.push(n);
  gameState.setCurrentSceneId('cell');
  mock.method(Math, 'random', () => 0);
  sr._buildPassFailButton({ text: 'Try', skillCheck: 'perception', dc: 10 }, 0, 'cell', {}).onclick();
  sr._buildPassFailButton({ text: 'Try', skillCheck: 'perception', dc: 10, timeCost: 5 }, 1, 'cell', {}).onclick();
  assert.deepEqual(charged, [1, 5]);
});

test('a discovery attempt narrates the roll and loot before time is charged', () => {
  const { sr, engine, calls } = makeSR();
  engine.data.rules = { time: { defaultCosts: { skillAttempt: 1 } } };
  engine.advanceTime = () => calls.logs.push({ message: 'timePassed' });
  gameState.setCurrentSceneId('cell');
  const opt = { skillCheck: 'perception', items: [{ item: 'healing_potion', dc: 5 }] };

  mock.method(Math, 'random', () => 0.45); // roll 10 ≥ 5 — found
  sr._resolveDiscovery(opt, 0, { found: [false] }, FLAG_KEYS.skillDc('perception', 'cell'), {});

  const messages = calls.logs.map(l => l.message);
  const timeAt = messages.indexOf('timePassed');
  assert.ok(timeAt !== -1);
  assert.ok(messages.indexOf('actions.lookAroundFound') < timeAt);
  assert.ok(messages.findIndex(m => m.includes('Healing Potion')) < timeAt);
});

test('a pass/fail attempt narrates the roll before time is charged', () => {
  const { sr, engine, calls } = makeSR();
  engine.data.rules = { time: { defaultCosts: { skillAttempt: 1 } } };
  engine.advanceTime = () => calls.logs.push({ message: 'timePassed' });
  gameState.setCurrentSceneId('cell');

  mock.method(Math, 'random', () => 0); // roll 1 — failure
  sr._buildPassFailButton({ text: 'Try', skillCheck: 'perception', dc: 15 }, 0, 'cell', {}).onclick();

  const messages = calls.logs.map(l => l.message);
  const timeAt = messages.indexOf('timePassed');
  assert.ok(timeAt !== -1);
  assert.ok(messages.indexOf('actions.skillFail') !== -1);
  assert.ok(messages.indexOf('actions.skillFail') < timeAt);
});

// ── Shared-skill flag map: discovery must not clobber sibling check state ────

test('discovery state is namespaced: a search never revives a resolved sibling check', () => {
  // Regression: a scene with "Look Around" (discovery) and a resolveOnce
  // pass/fail check on the SAME skill. Discovery used to overwrite the whole
  // shared flag map, wiping the sibling's resolution marker — letting a
  // one-shot check (and its reward) repeat forever.
  const { sr } = makeSR();
  gameState.setCurrentSceneId('chamber');
  const skillKey = FLAG_KEYS.skillDc('perception', 'chamber');
  const climb = { text: 'Climb', skillCheck: 'perception', dc: 12, resolveOnce: true };
  const search = { text: 'Look Around', skillCheck: 'perception', items: [{ item: 'rusty_sword', dc: 25 }] };

  // Climb once (failure) — resolveOnce retires it.
  mock.method(Math, 'random', () => 0);
  sr._buildPassFailButton(climb, 1, 'chamber', {}).onclick();
  assert.equal(sr._buildPassFailButton(climb, 1, 'chamber', {}), null);

  // Search the same scene with the same skill.
  sr._buildItemDiscoveryButton(search, 0, 'chamber', {}).onclick();

  // The climb must STAY resolved, and the discovery state lives alongside it.
  assert.equal(sr._buildPassFailButton(climb, 1, 'chamber', {}), null);
  assert.deepEqual(gameState.getFlag(skillKey).disc_0.found, [false]);
});

test('discovery adopts legacy top-level state from older saves', () => {
  const { sr } = makeSR();
  gameState.setCurrentSceneId('cell');
  const skillKey = FLAG_KEYS.skillDc('perception', 'cell');
  gameState.setFlag(skillKey, { dcs: [5], found: [true], tries: 2 });
  const opt = { text: 'Look', skillCheck: 'perception', items: [{ item: 'rusty_sword', dc: 5 }] };

  // Everything already found in the legacy state → no button.
  assert.equal(sr._buildItemDiscoveryButton(opt, 0, 'cell', {}), null);
});
