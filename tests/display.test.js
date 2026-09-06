import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import {
  addDisplayToScene,
  getDisplaysForScene,
  placeItemInDisplay,
  takeItemFromDisplay,
} from '../src/plugins/curator.js';
import { makeRules } from './helpers.js';

const TEST_RULES = makeRules({
  playerDefaults: {
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 100 },
    inventory: [
      { item: 'rusty_sword',    amount: 1 },
      { item: 'healing_potion', amount: 2 },
    ],
  },
});

beforeEach(() => gameState.init(TEST_RULES));

test('the cases live in the curator bag, not in core state', () => {
  addDisplayToScene(gameState, 'home_museum', { id: 'pedestal', name: 'Pedestal' });

  assert.equal(gameState.state.displays, undefined, 'no top-level displays field');
  assert.equal(gameState.state.plugins.curator.displays.home_museum[0].id, 'pedestal');
});

test('placeItemInDisplay: puts inventory item in display case, removing it from player inventory', () => {
  const displayId = addDisplayToScene(gameState, 'home_museum', { name: 'Main Stand' });

  const success = placeItemInDisplay(gameState, 'home_museum', displayId, 'rusty_sword');
  assert.equal(success, true);

  const displays = getDisplaysForScene(gameState, 'home_museum');
  assert.equal(displays[0].item, 'rusty_sword');

  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.equal(invEntry, undefined, 'Expected sword to be removed from player inventory');
});

test('placeItemInDisplay: fails if item is not in inventory', () => {
  addDisplayToScene(gameState, 'museum', { id: 'pedestal', name: 'Pedestal' });
  const success = placeItemInDisplay(gameState, 'museum', 'pedestal', 'no_such_item');
  assert.equal(success, false);
  assert.equal(getDisplaysForScene(gameState, 'museum')[0].item, null);
});

test('takeItemFromDisplay: retrieves item from display case, adding it back to player inventory', () => {
  const displayId = addDisplayToScene(gameState, 'home_museum', { name: 'Main Stand' });
  placeItemInDisplay(gameState, 'home_museum', displayId, 'rusty_sword');

  const retrievedId = takeItemFromDisplay(gameState, 'home_museum', displayId);
  assert.equal(retrievedId, 'rusty_sword');

  const displays = getDisplaysForScene(gameState, 'home_museum');
  assert.equal(displays[0].item, null);

  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.ok(invEntry);
  assert.equal(invEntry.amount, 1);
});

