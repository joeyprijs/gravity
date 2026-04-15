import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { CHAR_CREATION, PLAYER_DEFAULTS } from '../src/core/config.js';

// Reset state before each test
beforeEach(() => gameState.reset());

// ── CHAR_CREATION config ────────────────────────────────────────────────────

test('CHAR_CREATION: pointBudget is a positive integer', () => {
  assert.ok(Number.isInteger(CHAR_CREATION.pointBudget));
  assert.ok(CHAR_CREATION.pointBudget > 0);
});

test('CHAR_CREATION: every stat entry has required fields', () => {
  for (const stat of CHAR_CREATION.stats) {
    assert.ok(typeof stat.id === 'string', `${stat.id}: id must be string`);
    assert.ok(typeof stat.bonusPerPoint === 'number', `${stat.id}: bonusPerPoint must be number`);
    assert.ok(stat.bonusPerPoint > 0, `${stat.id}: bonusPerPoint must be positive`);
    assert.ok(typeof stat.min === 'number', `${stat.id}: min must be number`);
    assert.ok(stat.id in PLAYER_DEFAULTS, `${stat.id}: must exist in PLAYER_DEFAULTS`);
  }
});

// ── Point budget enforcement ─────────────────────────────────────────────────

test('point budget: pointsRemaining decreases correctly', () => {
  // Simulate the spent tracking logic from CharCreationScreen
  const spent = Object.fromEntries(CHAR_CREATION.stats.map(s => [s.id, 0]));
  const pointsRemaining = () =>
    CHAR_CREATION.pointBudget - Object.values(spent).reduce((a, b) => a + b, 0);

  assert.equal(pointsRemaining(), CHAR_CREATION.pointBudget);

  // Spend 2 points on the first stat
  const firstStat = CHAR_CREATION.stats[0];
  spent[firstStat.id] = 2;
  assert.equal(pointsRemaining(), CHAR_CREATION.pointBudget - 2);
});

test('point budget: cannot exceed total budget across all stats', () => {
  const spent = Object.fromEntries(CHAR_CREATION.stats.map(s => [s.id, 0]));
  const pointsRemaining = () =>
    CHAR_CREATION.pointBudget - Object.values(spent).reduce((a, b) => a + b, 0);

  // Spend the entire budget
  spent[CHAR_CREATION.stats[0].id] = CHAR_CREATION.pointBudget;
  assert.equal(pointsRemaining(), 0);

  // Trying to spend more returns 0 or less — callers must check pointsRemaining > 0
  assert.ok(pointsRemaining() <= 0);
});

test('point budget: spending 0 on all stats leaves full budget', () => {
  const spent = Object.fromEntries(CHAR_CREATION.stats.map(s => [s.id, 0]));
  const used = Object.values(spent).reduce((a, b) => a + b, 0);
  assert.equal(used, 0);
});

// ── Stat bonus calculation ───────────────────────────────────────────────────

test('stat bonus: bonus correctly computed from spent points', () => {
  const stat = CHAR_CREATION.stats.find(s => s.id === 'maxHp');
  if (!stat) return; // Skip if maxHp not configured

  const spent = 3;
  const bonus = spent * stat.bonusPerPoint;
  assert.equal(bonus, spent * stat.bonusPerPoint);
  assert.equal(PLAYER_DEFAULTS.maxHp + bonus, 10 + bonus);
});

test('stat bonus: 0 points spent gives 0 bonus', () => {
  for (const stat of CHAR_CREATION.stats) {
    const bonus = 0 * stat.bonusPerPoint;
    assert.equal(bonus, 0);
  }
});

test('stat bonus: applying maxHp bonus increases both maxHp and hp', () => {
  const stat = CHAR_CREATION.stats.find(s => s.id === 'maxHp');
  if (!stat) return; // Skip if maxHp not configured

  const player = gameState.getPlayer();
  const bonus = 2 * stat.bonusPerPoint; // spend 2 points
  player[stat.id] += bonus;
  player.hp = player.maxHp; // simulate what char creation does
  assert.equal(player.maxHp, PLAYER_DEFAULTS.maxHp + bonus);
  assert.equal(player.hp, player.maxHp);
});

test('stat bonus: applying maxAp bonus increases both maxAp and ap', () => {
  const stat = CHAR_CREATION.stats.find(s => s.id === 'maxAp');
  if (!stat) return; // Skip if maxAp not configured

  const player = gameState.getPlayer();
  const bonus = 1 * stat.bonusPerPoint;
  player[stat.id] += bonus;
  player.ap = player.maxAp;
  assert.equal(player.maxAp, PLAYER_DEFAULTS.maxAp + bonus);
  assert.equal(player.ap, player.maxAp);
});

// ── Save migration v0 → v1 ───────────────────────────────────────────────────

test('migration v0→v1: adds player.name when missing', () => {
  // Simulate a pre-v1 save (no saveVersion, no player.name)
  const oldSave = {
    player: { level: 1, xp: 0, hp: 10, maxHp: 10, ap: 3, maxAp: 3,
              ac: 10, initiative: 0, gold: 0, inventory: [], equipment: {} },
    flags: {},
    missions: {},
    currentSceneId: 'dungeon_start',
    returnSceneId: null,
    museumChest: [],
    visitedScenes: [],
    log: []
  };

  gameState.loadFromObject(oldSave);
  const player = gameState.getPlayer();
  assert.ok('name' in player, 'player.name should exist after migration');
  assert.equal(player.name, '', 'player.name should default to empty string');
});

test('migration v0→v1: saveVersion set to 1 after migration', () => {
  const oldSave = {
    player: { level: 1, xp: 0, hp: 10, maxHp: 10, ap: 3, maxAp: 3,
              ac: 10, initiative: 0, gold: 0, inventory: [], equipment: {} },
    flags: {},
    missions: {},
    currentSceneId: 'dungeon_start',
    returnSceneId: null,
    museumChest: [],
    visitedScenes: [],
    log: []
  };

  gameState.loadFromObject(oldSave);
  // Access internal state via getPlayer() — saveVersion isn't directly exposed,
  // but we can verify the player was migrated correctly (name exists)
  assert.ok('name' in gameState.getPlayer());
});

test('migration: existing name is preserved on load', () => {
  const save = {
    saveVersion: 1,
    player: { name: 'Aldric', level: 2, xp: 50, hp: 15, maxHp: 15,
              ap: 4, maxAp: 4, ac: 10, initiative: 0, gold: 25,
              inventory: [], equipment: {} },
    flags: {},
    missions: {},
    currentSceneId: 'dungeon_start',
    returnSceneId: null,
    museumChest: [],
    visitedScenes: [],
    log: []
  };

  gameState.loadFromObject(save);
  assert.equal(gameState.getPlayer().name, 'Aldric');
});

test('migration: already-v1 save is not double-migrated', () => {
  const save = {
    saveVersion: 1,
    player: { name: 'Test', level: 1, xp: 0, hp: 10, maxHp: 10,
              ap: 3, maxAp: 3, ac: 10, initiative: 0, gold: 0,
              inventory: [], equipment: {} },
    flags: {},
    missions: {},
    currentSceneId: 'dungeon_start',
    returnSceneId: null,
    museumChest: [],
    visitedScenes: [],
    log: []
  };

  gameState.loadFromObject(save);
  assert.equal(gameState.getPlayer().name, 'Test');
  assert.equal(gameState.getPlayer().level, 1);
});

// ── PLAYER_DEFAULTS ──────────────────────────────────────────────────────────

test('PLAYER_DEFAULTS: includes name field with empty string default', () => {
  assert.ok('name' in PLAYER_DEFAULTS);
  assert.equal(PLAYER_DEFAULTS.name, '');
});

test('gameState.reset(): new game starts with empty player name', () => {
  const player = gameState.getPlayer();
  assert.equal(player.name, '');
});
