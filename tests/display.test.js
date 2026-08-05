import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import {
  addDisplayToScene,
  getDisplaysForScene,
  placeItemInDisplay,
  takeItemFromDisplay,
} from '../src/plugins/curator.js';

const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 100 },
    attributes: { ac: 10, initiative: 0 },
    inventory: [
      { item: 'rusty_sword',    amount: 1 },
      { item: 'healing_potion', amount: 2 },
    ],
    equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

beforeEach(() => gameState.init(TEST_RULES));

test('addDisplayToScene: registers new display case and returns unique ID', () => {
  const displayId = addDisplayToScene(gameState, 'home_museum', {
    name: 'Glass Pedestal'
  });

  assert.ok(displayId, 'Expected a generated display ID');
  const displays = getDisplaysForScene(gameState, 'home_museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].id, displayId);
  assert.equal(displays[0].name, 'Glass Pedestal');
  assert.equal(displays[0].item, null);
});

test('addDisplayToScene: respects pre-defined display ID and attributes', () => {
  const displayId = addDisplayToScene(gameState, 'home_museum', {
    id: 'custom_display_1',
    name: 'Legendary Exhibit Box',
    item: 'relic_crown'
  });

  assert.equal(displayId, 'custom_display_1');
  const displays = getDisplaysForScene(gameState, 'home_museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].name, 'Legendary Exhibit Box');
  assert.equal(displays[0].item, 'relic_crown');
});

test('the cases live in the curator bag, not in core state', () => {
  addDisplayToScene(gameState, 'home_museum', { id: 'pedestal', name: 'Pedestal' });

  assert.equal(gameState.state.displays, undefined, 'no top-level displays field');
  assert.equal(gameState.state.plugins.curator.displays.home_museum[0].id, 'pedestal');
});

test('placeItemInDisplay: puts inventory item in display case, removing it from player inventory', () => {
  const displayId = addDisplayToScene(gameState, 'home_museum', { name: 'Main Stand' });

  // rusty_sword starts with amount: 1
  const success = placeItemInDisplay(gameState, 'home_museum', displayId, 'rusty_sword');
  assert.equal(success, true);

  const displays = getDisplaysForScene(gameState, 'home_museum');
  assert.equal(displays[0].item, 'rusty_sword');

  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.equal(invEntry, undefined, 'Expected sword to be removed from player inventory');
});

test('placeItemInDisplay: returns false for invalid display cases', () => {
  const success = placeItemInDisplay(gameState, 'home_museum', 'no_such_display', 'rusty_sword');
  assert.equal(success, false);
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

  // Withdraw
  const retrievedId = takeItemFromDisplay(gameState, 'home_museum', displayId);
  assert.equal(retrievedId, 'rusty_sword');

  const displays = getDisplaysForScene(gameState, 'home_museum');
  assert.equal(displays[0].item, null);

  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.ok(invEntry);
  assert.equal(invEntry.amount, 1);
});

test('takeItemFromDisplay: returns null when withdrawing from empty display case', () => {
  const displayId = addDisplayToScene(gameState, 'home_museum', { name: 'Main Stand' });
  const result = takeItemFromDisplay(gameState, 'home_museum', displayId);
  assert.equal(result, null);
});
