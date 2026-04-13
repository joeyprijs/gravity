import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roll, parseDamage } from '../src/systems/dice.js';

test('roll returns value within range', () => {
  for (let i = 0; i < 100; i++) {
    const r = roll(1, 6);
    assert.ok(r >= 1 && r <= 6, `roll(1,6) returned ${r}`);
  }
});

test('roll: single value range returns that value', () => {
  for (let i = 0; i < 20; i++) {
    assert.equal(roll(5, 5), 5);
  }
});

test('parseDamage: standard dice notation (min face)', () => {
  const orig = Math.random;
  Math.random = () => 0; // always returns min face (1 on any die)
  const result = parseDamage('2d6');
  assert.equal(result.total, 2);
  Math.random = orig;
});

test('parseDamage: dice with positive modifier', () => {
  const orig = Math.random;
  Math.random = () => 0;
  const result = parseDamage('1d8+3');
  assert.equal(result.total, 4); // 1 + 3
  Math.random = orig;
});

test('parseDamage: dice with negative modifier clamps to 0', () => {
  const orig = Math.random;
  Math.random = () => 0;
  const result = parseDamage('1d4-5');
  assert.equal(result.total, 0); // 1 - 5 = -4, clamped to 0
  Math.random = orig;
});

test('parseDamage: legacy range syntax', () => {
  const orig = Math.random;
  Math.random = () => 0;
  const result = parseDamage('1-4');
  assert.equal(result.total, 1); // min of range
  Math.random = orig;
});

test('parseDamage: null fallback', () => {
  const result = parseDamage(null);
  assert.deepEqual(result, { total: 1, string: '1' });
});

test('parseDamage: empty string fallback', () => {
  const result = parseDamage('');
  assert.deepEqual(result, { total: 1, string: '1' });
});

test('parseDamage: rollStr includes modifier', () => {
  const orig = Math.random;
  Math.random = () => 0;
  const result = parseDamage('1d6+2');
  assert.ok(result.string.includes('+2'), `Expected "+2" in "${result.string}"`);
  Math.random = orig;
});

test('parseDamage: rollStr includes negative modifier', () => {
  const orig = Math.random;
  Math.random = () => 0;
  const result = parseDamage('2d4-1');
  assert.ok(result.string.includes('-1'), `Expected "-1" in "${result.string}"`);
  Math.random = orig;
});
