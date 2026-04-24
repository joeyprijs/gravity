import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';

// Minimal rules that mirror the key values from rules.json.
// State must be init'd before each test since gameState is a singleton.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0 },
    inventory: [
      { item: 'rusty_sword',    amount: 1 },
      { item: 'flames',         amount: 1 },
      { item: 'healing_potion', amount: 2 },
    ],
    equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// Shortcuts to avoid repeating player.resources.hp.current etc. throughout tests.
const hp    = () => gameState.getPlayer().resources.hp.current;
const maxHp = () => gameState.getPlayer().resources.hp.max;
const ap    = () => gameState.getPlayer().resources.ap.current;
const maxAp = () => gameState.getPlayer().resources.ap.max;

beforeEach(() => gameState.init(TEST_RULES));

test('addXP: level increases at threshold, carries surplus', () => {
  // Level 1 threshold = 1 × 100 = 100 XP
  gameState.addXP(150);
  const player = gameState.getPlayer();
  assert.equal(player.level, 2);
  assert.equal(player.xp, 50);
});

test('addXP: multiple level increases in one call', () => {
  // 350 XP: lvl1→2 costs 100, lvl2→3 costs 200, 50 left over
  gameState.addXP(350);
  const player = gameState.getPlayer();
  assert.equal(player.level, 3);
  assert.equal(player.xp, 50);
});

test('addXP: level-up increases maxHp', () => {
  const before = maxHp();
  gameState.addXP(100);
  assert.equal(maxHp(), before + 5);
});

test('modifyPlayerStat hp: clamps to maxHp on overflow', () => {
  gameState.modifyPlayerStat('hp', 1000);
  assert.equal(hp(), maxHp());
});

test('modifyPlayerStat hp: clamps to 0 on underflow', () => {
  gameState.modifyPlayerStat('hp', -1000);
  assert.equal(hp(), 0);
});

test('modifyPlayerStat ap: clamps to maxAp on overflow', () => {
  gameState.modifyPlayerStat('ap', 1000);
  assert.equal(ap(), maxAp());
});

test('modifyPlayerStat ap: clamps to 0 on underflow', () => {
  gameState.modifyPlayerStat('ap', -1000);
  assert.equal(ap(), 0);
});

test('addToInventory: stacks existing item', () => {
  // rusty_sword starts at 1
  gameState.addToInventory('rusty_sword', 2);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.equal(entry.amount, 3);
});

test('addToInventory: adds new item as new entry', () => {
  gameState.addToInventory('gold_coin', 5);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'gold_coin');
  assert.ok(entry, 'Expected gold_coin to be in inventory');
  assert.equal(entry.amount, 5);
});

test('removeFromInventory: decrements amount', () => {
  // healing_potion starts at 2
  gameState.removeFromInventory('healing_potion', 1);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(entry.amount, 1);
});

test('removeFromInventory: removes entry when amount hits 0', () => {
  // healing_potion starts at 2, remove both
  gameState.removeFromInventory('healing_potion', 2);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(entry, undefined);
});

test('appendLog caps at 200 entries', () => {
  for (let i = 0; i < 250; i++) {
    gameState.appendLog({ type: 'test', message: `msg${i}` });
  }
  assert.ok(gameState.getLog().length <= 200, `Expected ≤200 entries, got ${gameState.getLog().length}`);
});

test('appendLog: most recent entry preserved after trim', () => {
  for (let i = 0; i < 250; i++) {
    gameState.appendLog({ type: 'test', message: `msg${i}` });
  }
  assert.equal(gameState.getLog().at(-1).message, 'msg249');
});

test('setFlag / getFlag round-trips', () => {
  gameState.setFlag('test_flag', true);
  assert.equal(gameState.getFlag('test_flag'), true);
  gameState.setFlag('test_flag', false);
  assert.equal(gameState.getFlag('test_flag'), false);
});

test('getFlag: missing flag returns false', () => {
  assert.equal(gameState.getFlag('no_such_flag'), false);
});

test('getFlag: stored falsy non-boolean value is preserved (not coerced to false)', () => {
  gameState.setFlag('count', 0);
  assert.equal(gameState.getFlag('count'), 0);
  assert.notEqual(gameState.getFlag('count'), false);
});

test('registerSceneFlags: initialises flags not yet in state', () => {
  gameState.registerSceneFlags({ door_open: false, boss_killed: false });
  assert.equal(gameState.getFlag('door_open'), false);
  assert.equal(gameState.getFlag('boss_killed'), false);
});

test('registerSceneFlags: does not overwrite flags already set in state', () => {
  gameState.setFlag('door_open', true);
  gameState.registerSceneFlags({ door_open: false });
  assert.equal(gameState.getFlag('door_open'), true);
});

test('reset: re-applies registered scene flags to their initial values', () => {
  gameState.registerSceneFlags({ door_open: false });
  gameState.setFlag('door_open', true);
  gameState.reset();
  assert.equal(gameState.getFlag('door_open'), false);
});

test('setMissionStatus / getMissionStatus round-trips', () => {
  gameState.setMissionStatus('test_mission', 'active');
  assert.equal(gameState.getMissionStatus('test_mission'), 'active');
});

test('getMissionStatus: unregistered mission returns not_started', () => {
  assert.equal(gameState.getMissionStatus('unknown_mission'), 'not_started');
});
