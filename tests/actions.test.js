import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { registerBuiltinActions } from '../src/systems/actions.js';
import { ACTIONS, LOG } from '../src/core/config.js';

// Minimal rules required by gameState.init() — mirrors the key values from rules.json.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: 'start_scene',
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

const TEST_ITEMS = {
  healing_potion: { name: 'Healing Potion' },
  storybook: {
    name: 'Storybook', type: 'Special',
    story: { chapters: [{ id: 'one', text: 'One.' }, { id: 'two', text: 'Two.' }] },
  },
};

// Shortcuts to avoid repeating player.resources.* throughout tests.
const gold = () => gameState.getPlayer().resources.gold;
const hp   = () => gameState.getPlayer().resources.hp.current;
const ap   = () => gameState.getPlayer().resources.ap.current;

// Minimal engine mock: collects registered handlers in a Map (like the real
// action registry) and records every outbound call so tests can assert on them.
// t() echoes the locale key, so log assertions compare against keys directly.
function makeEngine({ rules = TEST_RULES, items = TEST_ITEMS } = {}) {
  const registry = new Map();
  const calls = { logs: [], amends: [], renderedScenes: [], combat: [], dialogue: [], chests: [], customUI: [] };
  const engine = {
    data: { items, rules },
    state: gameState,
    t: (key) => key,
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    // Amendable by default (as if a [Player] option line was just logged);
    // tests flip it to false to exercise the standalone-yield fallback.
    amendable: true,
    amendLog(suffix) { if (this.amendable) calls.amends.push(suffix); return this.amendable; },
    registerAction: (name, fn) => registry.set(name, fn),
    combatSystem: { startCombat: (enemies, action) => calls.combat.push({ enemies, action }) },
    dialogueSystem: { startDialogue: (npcId) => calls.dialogue.push(npcId) },
    renderScene: (sceneId) => calls.renderedScenes.push(sceneId),
    setCustomUIOpen: (open) => calls.customUI.push(open),
    ui: { renderChestUI: (chestId) => calls.chests.push(chestId) },
  };
  registerBuiltinActions(engine);
  // Dispatch helper mirroring engine.runActions for a single action.
  const run = (action) => registry.get(action.type)(action, engine);
  return { engine, registry, calls, run };
}

beforeEach(() => gameState.init(TEST_RULES));
afterEach(() => mock.restoreAll());

// ── loot ──────────────────────────────────────────────────────────────────────

test('loot: gold goes to the gold resource, not the inventory', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'gold', amount: 25 });
  assert.equal(gold(), 25);
  assert.equal(gameState.getPlayer().inventory.length, 0);
  assert.equal(calls.logs[0].message, 'loot.foundGold');
});

test('loot: item is added with default amount 1; received selects the handed-over key', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion' });
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(entry.amount, 1);
  assert.equal(calls.logs[0].message, 'loot.foundItem');
  run({ type: ACTIONS.LOOT, item: 'healing_potion', received: true });
  assert.equal(calls.logs[1].message, 'loot.receivedItem');
});

test('loot: log false suppresses the log line, item still awarded', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion', log: false });
  assert.equal(calls.logs.length, 0);
  assert.ok(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion'));
});

test('loot: xpReward awards XP and logs it', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion', xpReward: 30 });
  assert.equal(gameState.getPlayer().xp, 30);
  assert.equal(calls.logs.at(-1).message, 'loot.xpGained');
});

// ── combat ────────────────────────────────────────────────────────────────────

test('combat: starts combat with the listed enemies and passes the action through', () => {
  const { run, calls } = makeEngine();
  const action = { type: ACTIONS.COMBAT, enemies: ['goblin_grunt'], setFlag: 'won' };
  run(action);
  assert.deepEqual(calls.combat[0].enemies, ['goblin_grunt']);
  assert.equal(calls.combat[0].action, action);
});

// ── return ────────────────────────────────────────────────────────────────────

test('return: renders the stored return scene', () => {
  const { run, calls } = makeEngine();
  gameState.setReturnSceneId('dungeon_start');
  run({ type: ACTIONS.RETURN });
  assert.deepEqual(calls.renderedScenes, ['dungeon_start']);
});

test('return: falls back to rules.startingScene when no return scene is stored', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.RETURN });
  assert.deepEqual(calls.renderedScenes, ['start_scene']);
});

// ── full_rest / heal ──────────────────────────────────────────────────────────

test('full_rest: restores hp to full and leaves AP alone (combat-only)', () => {
  const { run } = makeEngine();
  gameState.modifyPlayerStat('hp', -6);
  gameState.modifyPlayerStat('ap', -2);
  run({ type: ACTIONS.FULL_REST });
  assert.equal(hp(), gameState.getPlayer().resources.hp.max);
  assert.equal(ap(), 1); // AP is a per-combat budget; rest doesn't touch it
});

test('default yields amend the act line: heal and full_rest extend the [Player] entry, no second line', () => {
  const { engine, run, calls } = makeEngine();
  run({ type: ACTIONS.HEAL, amount: 4 });
  run({ type: ACTIONS.FULL_REST });
  assert.deepEqual(calls.amends, ['actions.heal', 'actions.fullRest']);
  assert.equal(calls.logs.length, 0);
  // With nothing to amend (no choice line preceding), the yield stands alone.
  engine.amendable = false;
  run({ type: ACTIONS.HEAL, amount: 4 });
  assert.ok(calls.logs.some(l => l.type === LOG.PLAYER && l.variant === 'choice'));
});

test('a negative heal amends with a signed yield: "(-2 HP)", never "(+-2 HP)"', () => {
  const { engine, run, calls } = makeEngine();
  engine.t = (key, params) => params ? `${key}:${params.amount}` : key;
  run({ type: ACTIONS.HEAL, amount: -2 });
  run({ type: ACTIONS.HEAL, amount: 2 });
  assert.deepEqual(calls.amends, ['actions.heal:-2', 'actions.heal:+2']);
});

// ── short_rest ────────────────────────────────────────────────────────────────

// Rules with the short-rest pool declared: 2 uses, flat 4 HP per draw (a
// number, so the roll suffix stays empty and assertions stay deterministic).
const SHORT_REST_RULES = {
  ...TEST_RULES,
  playerDefaults: {
    ...TEST_RULES.playerDefaults,
    resources: { ...TEST_RULES.playerDefaults.resources, shortRests: { current: 2, max: 2 } },
  },
  shortRest: { resource: 'shortRests', heal: 4 },
};

test('short_rest: heals, spends one pool use, and amends the act line with the yield', () => {
  gameState.init(SHORT_REST_RULES);
  const { run, calls } = makeEngine({ rules: SHORT_REST_RULES });
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.SHORT_REST });
  assert.equal(hp(), 6);
  assert.equal(gameState.getPlayer().resources.shortRests.current, 1);
  assert.deepEqual(calls.amends, ['actions.heal']);
});

test('short_rest: an empty pool refuses in the world\'s voice and heals nothing', () => {
  gameState.init(SHORT_REST_RULES);
  const { run, calls } = makeEngine({ rules: SHORT_REST_RULES });
  gameState.modifyPlayerStat('shortRests', -2);
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.SHORT_REST });
  assert.equal(hp(), 2);
  assert.ok(calls.logs.some(l => l.message === 'actions.shortRestExhausted'));
  assert.equal(calls.amends.length, 0);
});

test('full_rest refills the short-rest pool along with HP', () => {
  gameState.init(SHORT_REST_RULES);
  const { run } = makeEngine({ rules: SHORT_REST_RULES });
  gameState.modifyPlayerStat('shortRests', -2);
  gameState.modifyPlayerStat('hp', -6);
  run({ type: ACTIONS.FULL_REST });
  assert.equal(hp(), gameState.getPlayer().resources.hp.max);
  assert.equal(gameState.getPlayer().resources.shortRests.current, 2);
});

test('rests restore rest-limited item uses: a short rest only the short_rest items, a full rest everything', () => {
  const items = {
    fire_spell: { name: 'F', type: 'Spell', attributes: { uses: { max: 3, refresh: 'short_rest' } } },
    big_spell:  { name: 'B', type: 'Spell', attributes: { uses: { max: 2, refresh: 'full_rest' } } },
  };
  gameState.init(SHORT_REST_RULES, items);
  const { run } = makeEngine({ rules: SHORT_REST_RULES, items });
  gameState.spendItemUse('fire_spell');
  gameState.spendItemUse('big_spell');

  run({ type: ACTIONS.SHORT_REST });
  assert.equal(gameState.getItemUses('fire_spell').current, 3, 'a breather brings the short-rest spell back');
  assert.equal(gameState.getItemUses('big_spell').current, 1, 'the full-rest spell stays spent');

  gameState.spendItemUse('fire_spell');
  run({ type: ACTIONS.FULL_REST });
  assert.equal(gameState.getItemUses('fire_spell').current, 3);
  assert.equal(gameState.getItemUses('big_spell').current, 2, 'a night restores everything');
});

test('short_rest: a string log override narrates instead of the default yield', () => {
  gameState.init(SHORT_REST_RULES);
  const { run, calls } = makeEngine({ rules: SHORT_REST_RULES });
  gameState.modifyPlayerStat('hp', -6);
  run({ type: ACTIONS.SHORT_REST, log: 'You doze against the wall.' });
  assert.ok(calls.logs.some(l => l.message === 'You doze against the wall.'));
  assert.equal(calls.amends.length, 0, 'the default yield line stays silent');
  assert.equal(gameState.getPlayer().resources.shortRests.current, 1, 'the pool still spends');
});

test('log overrides resolve through t(): a locale key translates, a one-off line logs as-is', () => {
  const { engine, run, calls } = makeEngine();
  engine.t = (key) => key === 'actions.fullRestMorning' ? 'You wake with the morning light.' : key;
  run({ type: ACTIONS.FULL_REST, log: 'actions.fullRestMorning' });
  assert.ok(calls.logs.some(l => l.message === 'You wake with the morning light.'));
  run({ type: ACTIONS.FULL_REST, log: 'A one-off narrative line.' });
  assert.ok(calls.logs.some(l => l.message === 'A one-off narrative line.'));
});

test('heal: explicit amount takes precedence', () => {
  const { run } = makeEngine();
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.HEAL, amount: 4 });
  assert.equal(hp(), 6);
});

test('heal: falls back to rules.snackHealAmount', () => {
  const { run } = makeEngine({ rules: { ...TEST_RULES, snackHealAmount: 3 } });
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.HEAL });
  assert.equal(hp(), 5);
});

test('heal: defaults to 2 when rules define no snackHealAmount', () => {
  const { run } = makeEngine({ rules: null });
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.HEAL });
  assert.equal(hp(), 4);
});

// ── time actions ──────────────────────────────────────────────────────────────

test('advance_time: "until" derives the distance to the segment and wins over "amount"; unknown segments advance nothing', () => {
  const warn = mock.method(console, 'warn', () => {});
  const rules = { ...TEST_RULES, time: { ticksPerDay: 24, segments: [{ id: 'morning', from: 6 }] } };
  gameState.init(rules);
  const { engine, run } = makeEngine({ rules });
  const advanced = [];
  engine.advanceTime = (n) => advanced.push(n);
  run({ type: ACTIONS.ADVANCE_TIME, amount: 1, until: 'morning' }); // tick 0 → morning starts at 6
  assert.deepEqual(advanced, [6]);
  run({ type: ACTIONS.ADVANCE_TIME, until: 'noon' });
  assert.deepEqual(advanced, [6], 'an unresolvable segment is a warning no-op');
  assert.equal(warn.mock.callCount(), 1);
});

test('set_timer arms on the live clock, re-arming an id replaces it, cancel_timer disarms', () => {
  const { run } = makeEngine();
  run({ type: ACTIONS.SET_TIMER, id: 'alarm', afterTicks: 5, actions: [] });
  run({ type: ACTIONS.SET_TIMER, id: 'alarm', afterTicks: 2, actions: [] });
  run({ type: ACTIONS.SET_TIMER, id: 'other', afterTicks: 2, actions: [] });
  run({ type: ACTIONS.CANCEL_TIMER, id: 'other' });
  const due = gameState.advanceTime(2);
  assert.deepEqual(due.map(t => t.id), ['alarm'], 'only the re-armed deadline came due');
});

// ── grant_chapter ─────────────────────────────────────────────────────────────

test('grant_chapter: the first chapter writes the book into the pack, later ones only fill it', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.GRANT_CHAPTER, item: 'storybook', chapter: 'one' });
  assert.equal(gameState.countPlayerItem('storybook'), 1);
  assert.deepEqual(gameState.getStoryChapters('storybook'), ['one']);
  assert.equal(calls.logs[0].message, 'story.bookStarted');

  run({ type: ACTIONS.GRANT_CHAPTER, item: 'storybook', chapter: 'two' });
  assert.equal(gameState.countPlayerItem('storybook'), 1, 'the book is written once');
  assert.equal(calls.logs[1].message, 'story.chapterWritten');
});

test('grant_chapter: re-grants are silent no-ops, unknown chapters are refused', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.GRANT_CHAPTER, item: 'storybook', chapter: 'one' });
  run({ type: ACTIONS.GRANT_CHAPTER, item: 'storybook', chapter: 'one' });
  assert.deepEqual(gameState.getStoryChapters('storybook'), ['one']);
  assert.equal(calls.logs.length, 1, 're-listening logs nothing');

  const warn = mock.method(console, 'warn', () => {});
  run({ type: ACTIONS.GRANT_CHAPTER, item: 'storybook', chapter: 'ghost' });
  run({ type: ACTIONS.GRANT_CHAPTER, item: 'ghost_book', chapter: 'one' });
  assert.deepEqual(gameState.getStoryChapters('storybook'), ['one'], 'bad references grant nothing');
  assert.equal(warn.mock.callCount(), 2);
});
