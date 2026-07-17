import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition } from '../src/systems/condition.js';

function makeState({ flags = {}, inventory = [], equipment = {}, level = 1, gold = 0, missions = {}, attrs = {} } = {}) {
  return {
    getFlag: (f) => flags[f] ?? false,
    getPlayer: () => ({ inventory, equipment, level, resources: { gold }, attributes: attrs }),
    getMissionStatus: (m) => missions[m] ?? 'not_started',
    countPlayerItem(itemId, { includeEquipped = true } = {}) {
      const invEntry = inventory.find(i => i.item === itemId);
      const invCount = invEntry ? invEntry.amount : 0;
      if (!includeEquipped) return invCount;
      const equipCount = Object.values(equipment).filter(id => id === itemId).length;
      return invCount + equipCount;
    },
  };
}

test('null condition returns true', () => {
  assert.equal(evaluateCondition(null, makeState()), true);
});

test('flag leaf: matching value returns true', () => {
  const state = makeState({ flags: { door_open: true } });
  assert.equal(evaluateCondition({ flag: 'door_open', value: true }, state), true);
});

test('flag leaf: non-matching value returns false', () => {
  const state = makeState({ flags: { door_open: true } });
  assert.equal(evaluateCondition({ flag: 'door_open', value: false }, state), false);
});

test('flag leaf: missing flag defaults to false', () => {
  const state = makeState();
  assert.equal(evaluateCondition({ flag: 'nonexistent', value: false }, state), true);
  assert.equal(evaluateCondition({ flag: 'nonexistent', value: true }, state), false);
});

test('item leaf: item present returns true', () => {
  const state = makeState({ inventory: [{ item: 'key', amount: 1 }] });
  assert.equal(evaluateCondition({ item: 'key' }, state), true);
});

test('item leaf: item absent returns false', () => {
  const state = makeState({ inventory: [] });
  assert.equal(evaluateCondition({ item: 'key' }, state), false);
});

test('level leaf: exact level returns true', () => {
  const state = makeState({ level: 3 });
  assert.equal(evaluateCondition({ level: 3 }, state), true);
});

test('level leaf: higher level also returns true (>=)', () => {
  const state = makeState({ level: 5 });
  assert.equal(evaluateCondition({ level: 3 }, state), true);
});

test('level leaf: lower level returns false', () => {
  const state = makeState({ level: 2 });
  assert.equal(evaluateCondition({ level: 3 }, state), false);
});

test('gold leaf: exact gold returns true', () => {
  const state = makeState({ gold: 50 });
  assert.equal(evaluateCondition({ gold: 50 }, state), true);
});

test('gold leaf: less gold returns false', () => {
  const state = makeState({ gold: 49 });
  assert.equal(evaluateCondition({ gold: 50 }, state), false);
});

test('and combinator: both true returns true', () => {
  const state = makeState({ flags: { a: true, b: true } });
  assert.equal(evaluateCondition({ and: [{ flag: 'a', value: true }, { flag: 'b', value: true }] }, state), true);
});

test('and combinator: one false returns false', () => {
  const state = makeState({ flags: { a: true, b: false } });
  assert.equal(evaluateCondition({ and: [{ flag: 'a', value: true }, { flag: 'b', value: true }] }, state), false);
});

test('or combinator: both false returns false', () => {
  const state = makeState({ flags: { a: false, b: false } });
  assert.equal(evaluateCondition({ or: [{ flag: 'a', value: true }, { flag: 'b', value: true }] }, state), false);
});

test('or combinator: one true returns true', () => {
  const state = makeState({ flags: { a: true, b: false } });
  assert.equal(evaluateCondition({ or: [{ flag: 'a', value: true }, { flag: 'b', value: true }] }, state), true);
});

test('not combinator: negates true to false', () => {
  const state = makeState({ flags: { a: true } });
  assert.equal(evaluateCondition({ not: { flag: 'a', value: true } }, state), false);
});

test('not combinator: negates false to true', () => {
  const state = makeState({ flags: { a: false } });
  assert.equal(evaluateCondition({ not: { flag: 'a', value: true } }, state), true);
});

test('nested and/or/not', () => {
  const state = makeState({ flags: { a: true, b: false } });
  // a=true AND NOT b=true → true AND true → true
  const cond = { and: [{ flag: 'a', value: true }, { not: { flag: 'b', value: true } }] };
  assert.equal(evaluateCondition(cond, state), true);
});

test('mission leaf: matching status returns true', () => {
  const state = makeState({ missions: { quest_1: 'complete' } });
  assert.equal(evaluateCondition({ mission: 'quest_1', status: 'complete' }, state), true);
});

test('mission leaf: non-matching status returns false', () => {
  const state = makeState({ missions: { quest_1: 'active' } });
  assert.equal(evaluateCondition({ mission: 'quest_1', status: 'complete' }, state), false);
});

test('item leaf: equipped item returns true', () => {
  const state = makeState({ equipment: { 'Right Hand': 'sword' } });
  assert.equal(evaluateCondition({ item: 'sword' }, state), true);
});

test('item leaf: item both in inventory and equipped aggregates count', () => {
  const state = makeState({
    inventory: [{ item: 'sword', amount: 1 }],
    equipment: { 'Right Hand': 'sword' }
  });
  // Total 2 swords, should satisfy count: 2
  assert.equal(evaluateCondition({ item: 'sword', count: 2 }, state), true);
  // Total 2 swords, does not satisfy count: 3
  assert.equal(evaluateCondition({ item: 'sword', count: 3 }, state), false);
});

// ── time / day / segment leaves ───────────────────────────────────────────────

const TIME_RULES = {
  ticksPerDay: 24,
  startTick: 8,
  segments: [
    { id: 'morning', from: 6 },
    { id: 'day',     from: 10 },
    { id: 'night',   from: 22 },
  ],
};

function makeTimeState(ticks, rules = { time: TIME_RULES }) {
  const state = makeState();
  state.getTicks = () => ticks;
  state.getRules = () => rules;
  return state;
}

test('time leaf: compares absolute elapsed ticks', () => {
  assert.equal(evaluateCondition({ time: { at_least: 10 } }, makeTimeState(12)), true);
  assert.equal(evaluateCondition({ time: { at_least: 10 } }, makeTimeState(9)), false);
  assert.equal(evaluateCondition({ time: 5 }, makeTimeState(5)), true); // bare number = at_least
});

test('time leaf: a state without a clock evaluates against 0', () => {
  assert.equal(evaluateCondition({ time: { at_least: 1 } }, makeState()), false);
  assert.equal(evaluateCondition({ time: { at_most: 0 } }, makeState()), true);
});

test('day leaf: derives the 1-based day from rules.time', () => {
  assert.equal(evaluateCondition({ day: { is: 1 } }, makeTimeState(0)), true);
  assert.equal(evaluateCondition({ day: { at_least: 2 } }, makeTimeState(16)), true); // 16+8 = 24 → day 2
});

test('day leaf: false without rules.time', () => {
  assert.equal(evaluateCondition({ day: { at_least: 1 } }, makeTimeState(0, null)), false);
});

test('segment leaf: matches the current day segment, including the pre-dawn wrap', () => {
  assert.equal(evaluateCondition({ segment: 'morning' }, makeTimeState(0)), true);   // tick-of-day 8
  assert.equal(evaluateCondition({ segment: 'day' }, makeTimeState(2)), true);        // 10
  assert.equal(evaluateCondition({ segment: 'night' }, makeTimeState(18)), true);     // 2 → wraps to night
  assert.equal(evaluateCondition({ segment: 'day' }, makeTimeState(0)), false);
  assert.equal(evaluateCondition({ segment: 'day' }, makeTimeState(0, null)), false); // no config
});


// ── custom attributes shadowing built-in leaves ───────────────────────────────

test('a custom attribute named like a time leaf keeps its attribute semantics', () => {
  // Pre-existing games may define an attribute named "time"; its conditions
  // must keep comparing the attribute, not the world clock.
  const state = makeState({ attrs: { time: 5 } });
  assert.equal(evaluateCondition({ time: { at_least: 5 } }, state), true);  // attribute 5, ticks 0
  assert.equal(evaluateCondition({ time: { at_least: 6 } }, state), false);
});

test('a "luck" custom attribute is a plain attribute leaf', () => {
  const state = makeState({ attrs: { luck: 2 } });
  assert.equal(evaluateCondition({ luck: { at_least: 2 } }, state), true);
  assert.equal(evaluateCondition({ luck: { at_least: 3 } }, state), false);
});
