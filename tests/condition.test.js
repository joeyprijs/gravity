import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition } from '../src/systems/condition.js';

function makeState({ flags = {}, inventory = [], level = 1, gold = 0, missions = {}, attrs = {} } = {}) {
  return {
    getFlag: (f) => flags[f] ?? false,
    getPlayer: () => ({ inventory, level, resources: { gold }, attributes: attrs }),
    getMissionStatus: (m) => missions[m] ?? 'not_started',
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
