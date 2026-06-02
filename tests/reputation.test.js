import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { patchState } from '../src/plugins/curator.js';

const TEST_RULES = {
  playerDefaults: {
    name: 'Joey',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 100 },
    attributes: { ac: 10, initiative: 0, reputation: 0 },
    inventory: [],
    equipment: {
      "Left Hand": null,
      "Right Hand": null
    },
  },
  customAttributes: [],
  startingScene: 'museum_room',
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

const TEST_ITEMS = {
  relic_crown: {
    name: "Ancient Crown",
    type: "Flavour",
    reputation: 25
  },
  relic_shard: {
    name: "Sunstone Shard",
    type: "Flavour",
    reputation: 10
  },
  rusty_sword: {
    name: "Rusty Sword",
    type: "Weapon"
  }
};

beforeEach(() => {
  patchState(TEST_ITEMS);
  gameState.init(TEST_RULES, TEST_ITEMS);
});

test('first-time acquisition: awards reputation to player and museum', () => {
  assert.equal(gameState.getPlayer().attributes.reputation, 0);
  assert.equal(gameState.getMuseumReputation(), 0);

  // Obtain relic_crown for the first time
  gameState.addToInventory('relic_crown', 1);

  assert.equal(gameState.getPlayer().attributes.reputation, 25);
  assert.equal(gameState.getMuseumReputation(), 25); // museumReputation permanent = 25, display = 0
  assert.deepEqual(gameState.state.obtainedItems, ['relic_crown']);
});

test('subsequent acquisitions: does not award duplicate reputation', () => {
  gameState.addToInventory('relic_crown', 1);
  assert.equal(gameState.getPlayer().attributes.reputation, 25);

  // Obtain relic_crown again
  gameState.addToInventory('relic_crown', 1);
  assert.equal(gameState.getPlayer().attributes.reputation, 25); // stays 25
});

test('non-reputation items: do not award reputation upon acquisition', () => {
  gameState.addToInventory('rusty_sword', 1);
  assert.equal(gameState.getPlayer().attributes.reputation, 0);
});

test('exhibiting relics: dynamically updates museum reputation', () => {
  // First, obtain relics to get permanent reputation
  gameState.addToInventory('relic_crown', 1); // +25 permanent
  gameState.addToInventory('relic_shard', 1); // +10 permanent
  
  assert.equal(gameState.getPlayer().attributes.reputation, 35);
  assert.equal(gameState.getMuseumReputation(), 35); // permanent 35 + 0 display = 35

  const displayId = gameState.addDisplayToScene('museum_room', { name: 'Exhibition Pedestal' });

  // Place relic_crown on display
  gameState.placeItemInDisplay('museum_room', displayId, 'relic_crown');

  // Museum reputation should be permanent (35) + display (relic_crown: 25) = 60
  assert.equal(gameState.getMuseumReputation(), 60);

  // Retrieve relic_crown from display
  gameState.takeItemFromDisplay('museum_room', displayId);

  // Museum reputation should drop back to 35
  assert.equal(gameState.getMuseumReputation(), 35);
});

test('migration v3 to v4: initializes stats and populates obtainedItems from existing items', () => {
  const legacySave = {
    saveVersion: 3,
    player: {
      name: 'Joey',
      level: 1,
      xp: 0,
      resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 50 },
      attributes: { ac: 10, initiative: 0 },
      inventory: [
        { item: 'relic_shard', amount: 1 }
      ],
      equipment: {
        "Right Hand": 'rusty_sword'
      }
    },
    flags: {},
    missions: {},
    currentSceneId: 'museum_room',
    returnSceneId: null,
    chests: {},
    displays: {
      museum_room: [
        { id: 'display_1', name: 'Case', item: 'relic_crown' }
      ]
    },
    visitedScenes: [],
    log: []
  };

  gameState.loadFromObject(legacySave);

  assert.equal(gameState.state.saveVersion, 4);
  assert.equal(gameState.state.museumReputation, 0);
  
  // Should have populated obtainedItems from legacy inventory, equipment, and displays
  assert.ok(gameState.state.obtainedItems.includes('relic_shard'));
  assert.ok(gameState.state.obtainedItems.includes('rusty_sword'));
  assert.ok(gameState.state.obtainedItems.includes('relic_crown'));
  assert.equal(gameState.state.obtainedItems.length, 3);
});
