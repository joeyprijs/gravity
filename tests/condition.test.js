import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition } from '../src/systems/condition.js';

function makeState({ flags = {}, inventory = [], equipment = {}, level = 1, gold = 0, missions = {}, stages = {}, currentStages = {}, attrs = {}, stories = {} } = {}) {
  return {
    getFlag: (f) => flags[f] ?? false,
    hasStoryChapter: (s, c) => (stories[s] ?? []).includes(c),
    getPlayer: () => ({ inventory, equipment, level, resources: { gold }, attributes: attrs }),
    getMissionStatus: (m) => missions[m] ?? 'not_started',
    getMissionStage: (m) => currentStages[m] ?? null,
    missionStageIndex: (m, sId) => (stages[m] ?? []).indexOf(sId),
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

test('flag leaf: missing flag defaults to false', () => {
  const state = makeState();
  assert.equal(evaluateCondition({ flag: 'nonexistent', value: false }, state), true);
  assert.equal(evaluateCondition({ flag: 'nonexistent', value: true }, state), false);
});

test('item leaf: presence without a count, at-least with one', () => {
  const state = makeState({ inventory: [{ item: 'key', amount: 2 }] });
  assert.equal(evaluateCondition({ item: 'key' }, state), true);
  assert.equal(evaluateCondition({ item: 'torch' }, state), false);
  assert.equal(evaluateCondition({ item: 'key', count: 2 }, state), true);
  assert.equal(evaluateCondition({ item: 'key', count: 3 }, state), false);
});

test('bare numeric leaves compare at-least (level, gold)', () => {
  const state = makeState({ level: 3, gold: 50 });
  assert.equal(evaluateCondition({ level: 3 }, state), true);
  assert.equal(evaluateCondition({ level: 2 }, state), true);
  assert.equal(evaluateCondition({ level: 4 }, state), false);
  assert.equal(evaluateCondition({ gold: 50 }, state), true);
  assert.equal(evaluateCondition({ gold: 51 }, state), false);
});

test('combinators: and / or / not, nesting freely', () => {
  const state = makeState({ flags: { a: true, b: false } });
  const isA = { flag: 'a', value: true };
  const isB = { flag: 'b', value: true };
  assert.equal(evaluateCondition({ and: [isA, isB] }, state), false);
  assert.equal(evaluateCondition({ or: [isA, isB] }, state), true);
  assert.equal(evaluateCondition({ or: [isB, isB] }, state), false);
  assert.equal(evaluateCondition({ not: isA }, state), false);
  // a=true AND NOT b=true → true AND true → true
  assert.equal(evaluateCondition({ and: [isA, { not: isB }] }, state), true);
});

test('mission leaf: matching status returns true', () => {
  const state = makeState({ missions: { quest_1: 'complete' } });
  assert.equal(evaluateCondition({ mission: 'quest_1', status: 'complete' }, state), true);
});

test('mission leaf: non-matching status returns false', () => {
  const state = makeState({ missions: { quest_1: 'active' } });
  assert.equal(evaluateCondition({ mission: 'quest_1', status: 'complete' }, state), false);
});

test('mission stage leaf: exact current stage, active missions only', () => {
  const staged = { missions: { q: 'active' }, stages: { q: ['collect', 'report'] }, currentStages: { q: 'collect' } };
  assert.equal(evaluateCondition({ mission: 'q', stage: 'collect' }, makeState(staged)), true);
  assert.equal(evaluateCondition({ mission: 'q', stage: 'report' }, makeState(staged)), false);
  // A finished mission is not "doing" any stage.
  const done = { ...staged, missions: { q: 'complete' } };
  assert.equal(evaluateCondition({ mission: 'q', stage: 'collect' }, makeState(done)), false);
});

test('mission stageReached leaf: at-or-past by stage order, surviving mission end', () => {
  const stages = { q: ['collect', 'report', 'celebrate'] };
  const mid = { missions: { q: 'active' }, stages, currentStages: { q: 'report' } };
  assert.equal(evaluateCondition({ mission: 'q', stageReached: 'collect' }, makeState(mid)), true);
  assert.equal(evaluateCondition({ mission: 'q', stageReached: 'report' }, makeState(mid)), true);
  assert.equal(evaluateCondition({ mission: 'q', stageReached: 'celebrate' }, makeState(mid)), false);
  // Unknown target stages never match.
  assert.equal(evaluateCondition({ mission: 'q', stageReached: 'ghost' }, makeState(mid)), false);
  // The recorded stage stays where it got to — still true after completion.
  const done = { missions: { q: 'complete' }, stages, currentStages: { q: 'celebrate' } };
  assert.equal(evaluateCondition({ mission: 'q', stageReached: 'report' }, makeState(done)), true);
  // Not-started missions have no recorded stage.
  const fresh = { missions: {}, stages, currentStages: {} };
  assert.equal(evaluateCondition({ mission: 'q', stageReached: 'collect' }, makeState(fresh)), false);
});

// (Equipped items counting toward possession is countPlayerItem's contract,
// owned by state.test.js — the leaf only compares the total it returns.)

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

// The day/segment math itself is time.js's contract, owned by time.test.js —
// here only the leaf wiring matters: it reads the clock through rules.time
// and evaluates false when a game never configured one.
test('day and segment leaves read rules.time, and are false without it', () => {
  assert.equal(evaluateCondition({ day: { is: 1 } }, makeTimeState(0)), true);
  assert.equal(evaluateCondition({ segment: 'morning' }, makeTimeState(0)), true); // tick-of-day 8
  assert.equal(evaluateCondition({ segment: 'day' }, makeTimeState(0)), false);
  assert.equal(evaluateCondition({ day: { at_least: 1 } }, makeTimeState(0, null)), false);
  assert.equal(evaluateCondition({ segment: 'day' }, makeTimeState(0, null)), false);
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

test('story leaf: true only for a granted chapter of that story', () => {
  const state = makeState({ stories: { gertas_lamb: ['the_fair'] } });
  assert.equal(evaluateCondition({ story: 'gertas_lamb', chapter: 'the_fair' }, state), true);
  assert.equal(evaluateCondition({ story: 'gertas_lamb', chapter: 'the_mill' }, state), false);
  assert.equal(evaluateCondition({ story: 'other_book', chapter: 'the_fair' }, state), false);
  assert.equal(evaluateCondition({ not: { story: 'gertas_lamb', chapter: 'the_mill' } }, state), true,
    'the resume gate: heard this far, not further');
});
