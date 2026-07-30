import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseDamage, rollTable } from '../src/systems/dice.js';

afterEach(() => mock.restoreAll());

// Pins Math.random to its floor so every die shows its min face.
const minRolls = () => mock.method(Math, 'random', () => 0);

// ── parseDamage ───────────────────────────────────────────────────────────────

test('parseDamage: dice notation with modifiers, and the modifier in the roll string', () => {
  minRolls();
  assert.equal(parseDamage('2d6').total, 2);
  const plus = parseDamage('1d8+3');
  assert.equal(plus.total, 4); // 1 + 3
  assert.ok(plus.string.includes('+3'), `expected "+3" in "${plus.string}"`);
  const minus = parseDamage('2d4-1');
  assert.equal(minus.total, 1); // 2 - 1
  assert.ok(minus.string.includes('-1'), `expected "-1" in "${minus.string}"`);
});

test('parseDamage: a negative total clamps to 0 — damage never heals', () => {
  minRolls();
  assert.equal(parseDamage('1d4-5').total, 0); // 1 - 5 = -4, clamped
});

test('parseDamage: legacy range syntax', () => {
  minRolls();
  assert.equal(parseDamage('1-4').total, 1); // min of range
});

test('parseDamage: missing notation falls back to a flat 1', () => {
  assert.deepEqual(parseDamage(null), { total: 1, string: '1' });
  assert.deepEqual(parseDamage(''), { total: 1, string: '1' });
});

test('parseDamage: malformed range falls back to a flat 1 instead of NaN', () => {
  for (const bad of ['a-b', '1-2-3', '2-x']) {
    const result = parseDamage(bad);
    assert.ok(Number.isFinite(result.total), `${bad} produced non-finite total`);
    assert.equal(result.total, 1);
  }
});

// ── rollTable ─────────────────────────────────────────────────────────────────

test('rollTable: missing or empty tables return null', () => {
  assert.equal(rollTable(undefined), null);
  assert.equal(rollTable({ entries: [] }), null);
});

test('rollTable: weighted picks honour entry dropWeights', () => {
  const table = { entries: [{ item: 'common', dropWeight: 3 }, { item: 'rare', dropWeight: 1 }] };
  // Total weight 4: r in (0,3] → common, r in (3,4] → rare.
  mock.method(Math, 'random', () => 0.5); // r = 2
  assert.equal(rollTable(table).item, 'common');
  mock.method(Math, 'random', () => 0.9); // r = 3.6
  assert.equal(rollTable(table).item, 'rare');
});

test('rollTable: dropWeight defaults to 1 per entry', () => {
  const table = { entries: [{ item: 'a' }, { item: 'b' }] };
  mock.method(Math, 'random', () => 0.99); // r = 1.98 → second entry
  assert.equal(rollTable(table).item, 'b');
});
