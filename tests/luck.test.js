import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { luckEnabled, luckOdds, performLuckCheck, retryLuckCost } from '../src/systems/skill-checks.js';

// Rules WITH the opt-in luck resource (mirrors the demo's shape).
const LUCK_RULES = {
  playerDefaults: {
    name: '', level: 1, xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, luck: { current: 7, max: 9 }, gold: 0 },
    attributes: { ac: 10 },
    inventory: [], equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// Rules WITHOUT luck — the resource is strictly opt-in.
const NO_LUCK_RULES = {
  ...LUCK_RULES,
  playerDefaults: {
    ...LUCK_RULES.playerDefaults,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
  },
};

const luck = () => gameState.getPlayer().resources.luck;

function makeEngine() {
  const logs = [];
  return { engine: { t: (key) => key, log: (type, message, variant) => logs.push({ type, message, variant }) }, logs };
}

beforeEach(() => gameState.init(LUCK_RULES));
afterEach(() => mock.restoreAll());

// ── The resource ──────────────────────────────────────────────────────────────

test('modifyPlayerStat luck: clamps to [0, max]', () => {
  gameState.modifyPlayerStat('luck', -100);
  assert.equal(luck().current, 0);
  gameState.modifyPlayerStat('luck', 100);
  assert.equal(luck().current, 9);
});

test('modifyPlayerStat maxLuck: raises max; lowering clamps current down', () => {
  gameState.modifyPlayerStat('maxLuck', 2);
  assert.equal(luck().max, 11);
  assert.equal(luck().current, 7);
  gameState.modifyPlayerStat('maxLuck', -6);
  assert.equal(luck().max, 5);
  assert.equal(luck().current, 5);
});

test('modifyPlayerStat luck: a no-op in games without the resource', () => {
  gameState.init(NO_LUCK_RULES);
  gameState.modifyPlayerStat('luck', 3);
  gameState.modifyPlayerStat('maxLuck', 3);
  assert.equal(gameState.getPlayer().resources.luck, undefined);
});

test('luckEnabled reflects the opt-in resource', () => {
  assert.equal(luckEnabled(), true);
  gameState.init(NO_LUCK_RULES);
  assert.equal(luckEnabled(), false);
});

test('loadFromObject: seeds rules-declared resources missing from older saves', () => {
  const oldSave = {
    saveVersion: 4,
    player: {
      name: 'x', level: 1, xp: 0,
      resources: { hp: { current: 5, max: 10 }, ap: { current: 3, max: 3 }, gold: 12 },
      attributes: { ac: 10 }, inventory: [], equipment: {},
    },
    flags: {}, missions: {}, chests: {}, displays: {}, visitedScenes: [],
    time: { ticks: 0 }, timers: [], log: [],
  };
  assert.equal(gameState.loadFromObject(oldSave), true);
  assert.deepEqual(luck(), { current: 7, max: 9 });
  // Existing resources are never overwritten.
  assert.equal(gameState.getPlayer().resources.hp.current, 5);
});

// ── Test Your Luck ────────────────────────────────────────────────────────────

test('luckOdds: 2d6 roll-under probabilities as whole percentages', () => {
  assert.equal(luckOdds(0), 0);
  assert.equal(luckOdds(2), 3);
  assert.equal(luckOdds(7), 58);
  assert.equal(luckOdds(12), 100);
  assert.equal(luckOdds(99), 100); // clamped
});

test('performLuckCheck: lucky when 2d6 ≤ current luck, then luck -1 regardless', () => {
  const { engine, logs } = makeEngine();
  mock.method(Math, 'random', () => 0); // each d6 rolls 1 → total 2 ≤ 7
  const result = performLuckCheck(engine);
  assert.equal(result.lucky, true);
  assert.equal(result.rolled, 2);
  assert.equal(luck().current, 6);
  assert.equal(logs[0].message, 'actions.luckSuccess');
});

test('performLuckCheck: unlucky still spends the point', () => {
  const { engine, logs } = makeEngine();
  mock.method(Math, 'random', () => 0.99); // each d6 rolls 6 → total 12 > 7
  const result = performLuckCheck(engine);
  assert.equal(result.lucky, false);
  assert.equal(luck().current, 6);
  assert.equal(logs[0].message, 'actions.luckFail');
});

test('performLuckCheck: luck never goes below 0', () => {
  const { engine } = makeEngine();
  gameState.modifyPlayerStat('luck', -7);
  mock.method(Math, 'random', () => 0.99);
  performLuckCheck(engine);
  assert.equal(luck().current, 0);
});

test('performLuckCheck: warns and resolves unlucky without the resource', () => {
  gameState.init(NO_LUCK_RULES);
  const { engine, logs } = makeEngine();
  const result = performLuckCheck(engine);
  assert.equal(result.lucky, false);
  assert.equal(logs.length, 0);
});

// ── Retry currency ────────────────────────────────────────────────────────────

test('retryLuckCost: defaults to 0, reads rules, and requires the resource', () => {
  assert.equal(retryLuckCost(null), 0);
  assert.equal(retryLuckCost({}), 0);
  assert.equal(retryLuckCost({ skillRetryLuckCost: 2 }), 2);
  gameState.init(NO_LUCK_RULES);
  assert.equal(retryLuckCost({ skillRetryLuckCost: 2 }), 0);
});
