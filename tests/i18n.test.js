import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage } from '../src/core/i18n.js';

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
