import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import {
  registerCuratorState,
  getMuseumReputation,
  addDisplayToScene,
  placeItemInDisplay,
  takeItemFromDisplay,
} from '../src/plugins/curator.js';
import { makeRules } from './helpers.js';

const TEST_RULES = makeRules({
  playerDefaults: {
    name: 'Joey',
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 100 },
    attributes: { ac: 10, initiative: 0, reputation: 0 },
  },
  startingScene: 'museum_room',
});

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
  assert.equal(getMuseumReputation(gameState), 0);

  gameState.addToInventory('relic_crown', 1);

  assert.equal(gameState.getPlayer().attributes.reputation, 25);
  assert.equal(getMuseumReputation(gameState), 25);
  assert.deepEqual(gameState.pluginState('curator').obtainedItems, ['relic_crown']);
});

test('subsequent acquisitions: does not award duplicate reputation', () => {
  gameState.addToInventory('relic_crown', 1);
  assert.equal(gameState.getPlayer().attributes.reputation, 25);

  gameState.addToInventory('relic_crown', 1);
  assert.equal(gameState.getPlayer().attributes.reputation, 25);
});

test('exhibiting relics: dynamically updates museum reputation', () => {
  gameState.addToInventory('relic_crown', 1);
  gameState.addToInventory('relic_shard', 1);

  assert.equal(gameState.getPlayer().attributes.reputation, 35);
  assert.equal(getMuseumReputation(gameState), 35);

  const displayId = addDisplayToScene(gameState, 'museum_room', { name: 'Exhibition Pedestal' });

  placeItemInDisplay(gameState, 'museum_room', displayId, 'relic_crown');

  assert.equal(getMuseumReputation(gameState), 60, 'permanent 35 + the exhibited crown');

  takeItemFromDisplay(gameState, 'museum_room', displayId);

  assert.equal(getMuseumReputation(gameState), 35);
});
