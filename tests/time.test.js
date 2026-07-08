import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDay, getTickOfDay, getSegment, ticksUntilSegment, resolveTimeCost } from '../src/systems/time.js';
import { gameState } from '../src/core/state.js';

// Mirrors the demo's rules.time: a 24-tick day starting at tick-of-day 8.
const TIME_RULES = {
  ticksPerDay: 24,
  startTick: 8,
  segments: [
    { id: 'morning', from: 6 },
    { id: 'day',     from: 10 },
    { id: 'evening', from: 18 },
    { id: 'night',   from: 22 },
  ],
};

const TEST_RULES = {
  playerDefaults: {
    name: '', level: 1, xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10 },
    inventory: [], equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// ── Pure derivation helpers ───────────────────────────────────────────────────

test('getTickOfDay: offsets by startTick and wraps at ticksPerDay', () => {
  assert.equal(getTickOfDay(0, TIME_RULES), 8);
  assert.equal(getTickOfDay(16, TIME_RULES), 0);   // 16 + 8 = 24 → wraps
  assert.equal(getTickOfDay(40, TIME_RULES), 0);   // full extra day
  assert.equal(getTickOfDay(5, { ticksPerDay: 24 }), 5); // startTick defaults to 0
});

test('getTickOfDay/getDay: null without a positive ticksPerDay', () => {
  assert.equal(getTickOfDay(10, null), null);
  assert.equal(getTickOfDay(10, {}), null);
  assert.equal(getDay(10, { ticksPerDay: 0 }), null);
});

test('getDay: 1-based and advances when the wrapped day boundary passes', () => {
  assert.equal(getDay(0, TIME_RULES), 1);
  assert.equal(getDay(15, TIME_RULES), 1);  // 15 + 8 = 23, still day 1
  assert.equal(getDay(16, TIME_RULES), 2);  // 24 → day 2
  assert.equal(getDay(40, TIME_RULES), 3);
});

test('getSegment: picks the last segment whose "from" has passed', () => {
  assert.equal(getSegment(0, TIME_RULES), 'morning');  // tick-of-day 8
  assert.equal(getSegment(2, TIME_RULES), 'day');      // 10
  assert.equal(getSegment(11, TIME_RULES), 'evening'); // 19
  assert.equal(getSegment(14, TIME_RULES), 'night');   // 22
});

test('getSegment: pre-dawn hours wrap to the latest segment', () => {
  assert.equal(getSegment(18, TIME_RULES), 'night'); // tick-of-day 2 < morning.from
});

test('getSegment: null without segments or ticksPerDay', () => {
  assert.equal(getSegment(5, { ticksPerDay: 24 }), null);
  assert.equal(getSegment(5, null), null);
});

test('ticksUntilSegment: distance to the next occurrence, never 0', () => {
  assert.equal(ticksUntilSegment(0, TIME_RULES, 'day'), 2);       // 8 → 10
  assert.equal(ticksUntilSegment(0, TIME_RULES, 'morning'), 22);  // 8 → next day's 6
  // Exactly at the segment start: a full day, not 0 ("sleep until morning" in
  // the morning sleeps to tomorrow's morning).
  assert.equal(ticksUntilSegment(22, TIME_RULES, 'morning'), 24); // tick-of-day 6
  assert.equal(ticksUntilSegment(0, TIME_RULES, 'nope'), null);
  assert.equal(ticksUntilSegment(0, null, 'morning'), null);
});

test('resolveTimeCost: explicit cost wins (including 0), then kind default, then free', () => {
  const rules = { time: { defaultCosts: { navigate: 3, skillAttempt: 1 } } };
  assert.equal(resolveTimeCost(5, 'navigate', rules), 5);
  assert.equal(resolveTimeCost(0, 'navigate', rules), 0);
  assert.equal(resolveTimeCost(undefined, 'navigate', rules), 3);
  assert.equal(resolveTimeCost(undefined, 'fullRest', rules), 0);
  assert.equal(resolveTimeCost(undefined, null, rules), 0);
  assert.equal(resolveTimeCost(undefined, 'navigate', null), 0);
});

// ── StateManager clock & timers ───────────────────────────────────────────────

beforeEach(() => gameState.init(TEST_RULES));

test('advanceTime: accumulates ticks and ignores non-positive amounts', () => {
  assert.equal(gameState.getTicks(), 0);
  gameState.advanceTime(5);
  gameState.advanceTime(0);
  gameState.advanceTime(-3);
  assert.equal(gameState.getTicks(), 5);
});

test('advanceTime: returns due timers in deadline order and removes them', () => {
  gameState.setTimer({ id: 'late',  deadline: 10, actions: [{ type: 'log' }] });
  gameState.setTimer({ id: 'early', deadline: 4,  actions: [{ type: 'set_flag' }] });
  gameState.setTimer({ id: 'far',   deadline: 99, actions: [] });

  const fired = gameState.advanceTime(12);
  assert.deepEqual(fired.map(t => t.id), ['early', 'late']);
  assert.deepEqual(gameState.state.timers.map(t => t.id), ['far']);

  // Already-fired timers don't fire again.
  assert.deepEqual(gameState.advanceTime(1), []);
});

test('setTimer: re-arming an id replaces the previous deadline', () => {
  gameState.setTimer({ id: 'alarm', deadline: 5, actions: [] });
  gameState.setTimer({ id: 'alarm', deadline: 20, actions: [] });
  assert.deepEqual(gameState.advanceTime(10), []);
  assert.equal(gameState.advanceTime(10).length, 1);
});

test('cancelTimer: a cancelled timer never fires; unknown ids are a no-op', () => {
  gameState.setTimer({ id: 'alarm', deadline: 5, actions: [] });
  gameState.cancelTimer('alarm');
  gameState.cancelTimer('never_existed');
  assert.deepEqual(gameState.advanceTime(10), []);
});

test('clock and timers serialize into the save state', () => {
  gameState.setTimer({ id: 'alarm', deadline: 30, actions: [{ type: 'set_flag', flag: 'x', value: true }] });
  gameState.advanceTime(7);
  const roundTripped = JSON.parse(JSON.stringify(gameState.state));
  assert.equal(roundTripped.time.ticks, 7);
  assert.equal(roundTripped.timers.length, 1);
  assert.equal(roundTripped.timers[0].id, 'alarm');
});
