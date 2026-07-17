import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { registerCuratorState, getMuseumReputation } from '../src/plugins/curator.js';

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
    attributes: { reputation: 25 }
  },
  relic_shard: {
    name: "Sunstone Shard",
    type: "Flavour",
    attributes: { reputation: 10 }
  },
  rusty_sword: {
    name: "Rusty Sword",
    type: "Weapon"
  }
};

beforeEach(() => {
  registerCuratorState(gameState, TEST_ITEMS);
  gameState.init(TEST_RULES, TEST_ITEMS);
});

test('first-time acquisition: awards reputation to player and museum', () => {
  assert.equal(gameState.getPlayer().attributes.reputation, 0);
  assert.equal(getMuseumReputation(), 0);

  // Obtain relic_crown for the first time
  gameState.addToInventory('relic_crown', 1);

  assert.equal(gameState.getPlayer().attributes.reputation, 25);
  assert.equal(getMuseumReputation(), 25); // museumReputation permanent = 25, display = 0
  assert.deepEqual(gameState.pluginState('curator').obtainedItems, ['relic_crown']);
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
  assert.equal(getMuseumReputation(), 35); // permanent 35 + 0 display = 35

  const displayId = gameState.addDisplayToScene('museum_room', { name: 'Exhibition Pedestal' });

  // Place relic_crown on display
  gameState.placeItemInDisplay('museum_room', displayId, 'relic_crown');

  // Museum reputation should be permanent (35) + display (relic_crown: 25) = 60
  assert.equal(getMuseumReputation(), 60);

  // Retrieve relic_crown from display
  gameState.takeItemFromDisplay('museum_room', displayId);

  // Museum reputation should drop back to 35
  assert.equal(getMuseumReputation(), 35);
});

test('migration: a v3 save gains the core clock (v4) and curator fields (v5)', () => {
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

  assert.equal(gameState.state.saveVersion, 5);
  assert.equal(gameState.pluginState('curator').museumReputation, 0);

  // The core v4 migration must run too — before the collision guard, the
  // curator's migration (then also registered at 4) silently shadowed it.
  assert.deepEqual(gameState.state.time, { ticks: 0 });
  assert.deepEqual(gameState.state.timers, []);

  // Should have populated obtainedItems from legacy inventory, equipment, and displays
  assert.ok(gameState.pluginState('curator').obtainedItems.includes('relic_shard'));
  assert.ok(gameState.pluginState('curator').obtainedItems.includes('rusty_sword'));
  assert.ok(gameState.pluginState('curator').obtainedItems.includes('relic_crown'));
  assert.equal(gameState.pluginState('curator').obtainedItems.length, 3);
});
