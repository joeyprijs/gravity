import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';

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

test('getDisplaysForScene: returns empty array initially', () => {
  const displays = gameState.getDisplaysForScene('home_museum');
  assert.deepEqual(displays, []);
});

test('addDisplayToScene: registers new display case and returns unique ID', () => {
  const displayId = gameState.addDisplayToScene('home_museum', {
    name: 'Glass Pedestal'
  });

  assert.ok(displayId, 'Expected a generated display ID');
  const displays = gameState.getDisplaysForScene('home_museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].id, displayId);
  assert.equal(displays[0].name, 'Glass Pedestal');
  assert.equal(displays[0].item, null);
});

test('addDisplayToScene: respects pre-defined display ID and attributes', () => {
  const displayId = gameState.addDisplayToScene('home_museum', {
    id: 'custom_display_1',
    name: 'Legendary Exhibit Box',
    item: 'relic_crown',
    allowedTypes: ['Flavour']
  });

  assert.equal(displayId, 'custom_display_1');
  const displays = gameState.getDisplaysForScene('home_museum');
  assert.equal(displays.length, 1);
  assert.equal(displays[0].name, 'Legendary Exhibit Box');
  assert.equal(displays[0].item, 'relic_crown');
  assert.deepEqual(displays[0].allowedTypes, ['Flavour']);
});

test('placeItemInDisplay: puts inventory item in display case, removing it from player inventory', () => {
  const displayId = gameState.addDisplayToScene('home_museum', { name: 'Main Stand' });

  // rusty_sword starts with amount: 1
  const success = gameState.placeItemInDisplay('home_museum', displayId, 'rusty_sword');
  assert.equal(success, true);

  const displays = gameState.getDisplaysForScene('home_museum');
  assert.equal(displays[0].item, 'rusty_sword');

  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.equal(invEntry, undefined, 'Expected sword to be removed from player inventory');
});

test('placeItemInDisplay: returns false for invalid display cases', () => {
  const success = gameState.placeItemInDisplay('home_museum', 'no_such_display', 'rusty_sword');
  assert.equal(success, false);
});

test('takeItemFromDisplay: retrieves item from display case, adding it back to player inventory', () => {
  const displayId = gameState.addDisplayToScene('home_museum', { name: 'Main Stand' });
  gameState.placeItemInDisplay('home_museum', displayId, 'rusty_sword');

  // Withdraw
  const retrievedId = gameState.takeItemFromDisplay('home_museum', displayId);
  assert.equal(retrievedId, 'rusty_sword');

  const displays = gameState.getDisplaysForScene('home_museum');
  assert.equal(displays[0].item, null);

  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.ok(invEntry);
  assert.equal(invEntry.amount, 1);
});

test('takeItemFromDisplay: returns null when withdrawing from empty display case', () => {
  const displayId = gameState.addDisplayToScene('home_museum', { name: 'Main Stand' });
  const result = gameState.takeItemFromDisplay('home_museum', displayId);
  assert.equal(result, null);
});

test('migration: v2 save file dynamically adds displays object', () => {
  const oldSave = {
    saveVersion: 2,
    player: {
      name: 'Joey',
      level: 1,
      xp: 0,
      resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 50 },
      attributes: { ac: 10, initiative: 0 },
      inventory: [],
      equipment: {}
    },
    flags: {},
    missions: {},
    currentSceneId: 'dungeon_start',
    returnSceneId: null,
    chests: {},
    visitedScenes: [],
    log: []
  };

  gameState.loadFromObject(oldSave);

  const displays = gameState.getDisplaysForScene('dungeon_start');
  assert.deepEqual(displays, []);
  assert.ok(gameState.state.displays, 'Migration should define displays object in state');
});
