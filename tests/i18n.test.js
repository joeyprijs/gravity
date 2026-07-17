import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatList, isOne, resolveLanguage } from '../src/core/i18n.js';

test('exact tag match wins', () => {
  assert.equal(resolveLanguage(['en', 'pt-br'], ['pt-BR', 'en']), 'pt-br');
});

test('regional tags fall back to their base code', () => {
  assert.equal(resolveLanguage(['en', 'nl'], ['nl-NL', 'en-US']), 'nl');
});

test('preference order is respected over available order', () => {
  assert.equal(resolveLanguage(['nl', 'fr'], ['fr', 'nl']), 'fr');
});

test('matching is case-insensitive', () => {
  assert.equal(resolveLanguage(['EN'], ['en-us']), 'EN');
});

test('no preference match falls back to the fallback language', () => {
  assert.equal(resolveLanguage(['en', 'nl'], ['ja', 'ko'], 'en'), 'en');
});

test('unavailable fallback resolves to the first available language', () => {
  assert.equal(resolveLanguage(['nl', 'fr'], ['ja'], 'en'), 'nl');
});

test('empty preference list resolves to the fallback', () => {
  assert.equal(resolveLanguage(['en', 'nl'], []), 'en');
});

test('no declared locales resolves to the fallback', () => {
  assert.equal(resolveLanguage([], ['nl-NL']), 'en');
  assert.equal(resolveLanguage(undefined, undefined, 'fr'), 'fr');
});

test('formatList: joins with the language\'s own list grammar', () => {
  assert.equal(formatList('en', ['a']), 'a');
  assert.equal(formatList('en', ['a', 'b']), 'a and b');
  assert.equal(formatList('en', ['a', 'b', 'c']), 'a, b, and c');
});

test('isOne: singular counts pick the One-variant message keys', () => {
  assert.equal(isOne('en', 1), true);
  assert.equal(isOne('en', 0), false);
  assert.equal(isOne('en', 2), false);
});
