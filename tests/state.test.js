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

test('modifyPlayerStat: a declared custom resource is modifiable by name and clamped', () => {
  gameState.init({ ...TEST_RULES, playerDefaults: {
    ...TEST_RULES.playerDefaults,
    resources: { ...TEST_RULES.playerDefaults.resources, luckPoints: { current: 3, max: 3 } },
  }});
  const luck = () => gameState.getPlayer().resources.luckPoints.current;
  gameState.modifyPlayerStat('luckPoints', -1);
  assert.equal(luck(), 2);
  gameState.modifyPlayerStat('luckPoints', -10);
  assert.equal(luck(), 0);            // clamps to 0
  gameState.modifyPlayerStat('luckPoints', 99);
  assert.equal(luck(), 3);            // clamps to max
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

test('addToInventory: rejects unknown item ID when an item database is provided', () => {
  gameState.init(TEST_RULES, { rusty_sword: { name: 'Rusty Sword' } });
  const added = gameState.addToInventory('no_such_item');
  assert.equal(added, false);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'no_such_item'), undefined);
});

test('addToInventory: accepts known item ID when an item database is provided', () => {
  gameState.init(TEST_RULES, { rusty_sword: { name: 'Rusty Sword' } });
  const added = gameState.addToInventory('rusty_sword');
  assert.equal(added, true);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword').amount, 2);
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

test('equipItem: fails and returns false if item is not in inventory', () => {
  const success = gameState.equipItem('Right Hand', 'no_such_item');
  assert.equal(success, false);
  assert.equal(gameState.getPlayer().equipment['Right Hand'], undefined);
});

test('depositToChest: clamps to actual inventory amount', () => {
  // healing_potion starts at 2
  gameState.depositToChest('chest1', 'healing_potion', 5);
  // Should only deposit 2
  const chest = gameState.getChest('chest1');
  assert.equal(chest.find(i => i.item === 'healing_potion').amount, 2);
  // Inventory should have 0
  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(invEntry, undefined);
});

test('withdrawFromChest: clamps to actual chest amount', () => {
  // Deposit 2 first
  gameState.depositToChest('chest1', 'healing_potion', 2);
  // Withdraw 5
  gameState.withdrawFromChest('chest1', 'healing_potion', 5);
  // Should only withdraw 2
  const chest = gameState.getChest('chest1');
  assert.equal(chest.length, 0);
  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(invEntry.amount, 2);
});

test('placeItemInDisplay: fails if item is not in inventory', () => {
  gameState.addDisplayToScene('museum', { id: 'pedestal', name: 'Pedestal' });
  const success = gameState.placeItemInDisplay('museum', 'pedestal', 'no_such_item');
  assert.equal(success, false);
  const displays = gameState.getDisplaysForScene('museum');
  assert.equal(displays[0].item, null);
});

test('countPlayerItem: correctly counts and filters equipped vs unequipped items', () => {
  // Reset and initialize with starting items
  gameState.init(TEST_RULES);
  
  // 'healing_potion' starts with amount: 2 in inventory, none equipped
  assert.equal(gameState.countPlayerItem('healing_potion'), 2);
  assert.equal(gameState.countPlayerItem('healing_potion', { includeEquipped: false }), 2);

  // Equip 'rusty_sword' (starts at 1 in inventory)
  gameState.equipItem('Right Hand', 'rusty_sword');
  
  // Total count should still be 1 (equipped)
  assert.equal(gameState.countPlayerItem('rusty_sword'), 1);
  // Unequipped inventory count should be 0
  assert.equal(gameState.countPlayerItem('rusty_sword', { includeEquipped: false }), 0);

  // Add another 'rusty_sword' to inventory
  gameState.addToInventory('rusty_sword', 1);

  // Total count should now be 2 (1 equipped, 1 in inventory)
  assert.equal(gameState.countPlayerItem('rusty_sword'), 2);
  // Unequipped inventory count should be 1
  assert.equal(gameState.countPlayerItem('rusty_sword', { includeEquipped: false }), 1);

  // Check non-existent item
  assert.equal(gameState.countPlayerItem('unknown_item'), 0);
  assert.equal(gameState.countPlayerItem('unknown_item', { includeEquipped: false }), 0);
});

test('loadFromObject: rejects malformed saves and returns false', () => {
  assert.equal(gameState.loadFromObject(null), false);
  assert.equal(gameState.loadFromObject({}), false);
  assert.equal(gameState.loadFromObject({ player: null, log: [] }), false);
  assert.equal(gameState.loadFromObject({ player: {}, log: 'not-an-array' }), false);
});

test('loadFromObject: applies a valid save and migrates an old one forward', () => {
  const ok = gameState.loadFromObject({ player: {}, log: [] }); // no saveVersion → migrates from 0
  assert.equal(ok, true);
  assert.equal(gameState.getPlayer().name, ''); // migration 1 added player.name
  assert.equal(gameState.state.saveVersion, 4); // brought up to the current version
  assert.deepEqual(gameState.state.time, { ticks: 0 }); // migration 4 seeded the clock
  assert.deepEqual(gameState.state.timers, []);
});

test('migrate: leaves a future-versioned save untouched (no backward rewrite)', () => {
  gameState.loadFromObject({ saveVersion: 99, player: { name: 'x' }, log: [] });
  assert.equal(gameState.state.saveVersion, 99);
});

test('addXP: does not hang when xpPerLevel is 0 — banks XP without leveling', () => {
  gameState.init({ ...TEST_RULES, xpPerLevel: 0 });
  gameState.addXP(50);
  const p = gameState.getPlayer();
  assert.equal(p.level, 1);
  assert.equal(p.xp, 50);
});
