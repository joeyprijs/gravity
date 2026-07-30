import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameState } from '../src/core/state.js';

// The creation screen itself is DOM-bound and belongs to the smoke test.
// What lives here is the layer beneath it: the rules.charCreation contract
// the screen reads, and applyCharCreation — the one sanctioned mutation it
// performs (state.js owns the dotted-path bonus logic, see _applyStatBonus).
const rules = JSON.parse(readFileSync(new URL('../data/rules.json', import.meta.url), 'utf8'));
const CHAR_CREATION = rules.charCreation;

function getPath(obj, path) { return path.split('.').reduce((v, k) => v?.[k], obj); }

const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0, strength: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

beforeEach(() => gameState.init(TEST_RULES));

// ── The shipped charCreation config ─────────────────────────────────────────

test('every charCreation stat has the fields the screen reads, and its id resolves on the initialized player', () => {
  assert.ok(CHAR_CREATION.stats.length > 0, 'there are stats to buy');
  // The screen reads and bumps each stat by dotted path on the LIVE player —
  // playerDefaults plus the customAttributes init seeds into attributes. A
  // typo'd path would silently read undefined and write a stray field.
  const seeded = {
    ...rules.playerDefaults,
    attributes: {
      ...rules.playerDefaults.attributes,
      ...Object.fromEntries((rules.customAttributes ?? []).map(a => [a.id, 0])),
    },
  };
  for (const stat of CHAR_CREATION.stats) {
    assert.equal(typeof stat.id, 'string');
    assert.equal(typeof stat.localeKey, 'string');
    assert.ok(stat.bonusPerPoint > 0, `${stat.id} has a positive bonusPerPoint`);
    assert.notEqual(getPath(seeded, stat.id), undefined,
      `stat id "${stat.id}" resolves on the initialized player`);
  }
});

// ── applyCharCreation ───────────────────────────────────────────────────────

test('applyCharCreation: sets the chosen name', () => {
  gameState.applyCharCreation('Wobbe', []);
  assert.equal(gameState.getPlayer().name, 'Wobbe');
});

test('applyCharCreation: a resources max bonus raises current along with max', () => {
  gameState.applyCharCreation('Wobbe', [{ id: 'resources.hp.max', bonus: 4 }]);
  const hp = gameState.getPlayer().resources.hp;
  assert.equal(hp.max, 14);
  assert.equal(hp.current, 14, 'the player starts with the bought HP, not wounded');
});

test('applyCharCreation: attribute bonuses land on their dotted path; zero-point picks are skipped', () => {
  gameState.applyCharCreation('Wobbe', [
    { id: 'attributes.strength', bonus: 2 },
    { id: 'attributes.ac', bonus: 0 },
  ]);
  const p = gameState.getPlayer();
  assert.equal(p.attributes.strength, 2);
  assert.equal(p.attributes.ac, 10, 'an unspent stat keeps its default');
});
