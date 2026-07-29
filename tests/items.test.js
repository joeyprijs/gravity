import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { equipItem, itemHasUse, unequipItem } from '../src/systems/items.js';
import { gameState } from '../src/core/state.js';
import { WEAPON_SLOTS } from '../src/core/config.js';

const [LEFT, RIGHT] = WEAPON_SLOTS;

const ITEMS = {
  sword:   { name: 'Sword',   type: 'Weapon', slot: RIGHT, attributes: { damageRoll: '1d6', actionPoints: 1 } },
  dagger:  { name: 'Dagger',  type: 'Weapon', slot: RIGHT, attributes: { damageRoll: '1d4', actionPoints: 1 } },
  flames:  { name: 'Flames',  type: 'Spell',  slot: RIGHT, attributes: { damageRoll: '2d6', actionPoints: 2 } },
  cudgel:  { name: 'Cudgel',  type: 'Weapon', slot: LEFT,  attributes: { damageRoll: '1d6', actionPoints: 1 } },
  // A weapon that declares no slot at all — the demo's dagger does the same.
  knife:   { name: 'Knife',   type: 'Weapon', attributes: { damageRoll: '1d4', actionPoints: 1 } },
  jerkin:  { name: 'Jerkin',  type: 'Armor',  slot: 'Torso', attributes: { armorClassBonus: 2, actionPoints: 0 } },
};

// Minimal rules — the four items above in the pack, the demo's hand/torso slots.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0 },
    inventory: Object.keys(ITEMS).map(item => ({ item, amount: 1 })),
    equipment: { Torso: null, [LEFT]: null, [RIGHT]: null },
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// Minimal engine mock — equipItem/unequipItem touch nothing else.
function makeMockEngine() {
  return {
    data: { items: ITEMS, rules: { unequipApCost: 1 } },
    state: gameState,
    t: (key) => key,
    log: () => {},
    mode: 'scene',
    get inCombat() { return this.mode === 'combat'; },
    get isGameOver() { return this.mode === 'gameover'; },
    _spendAP: () => true,
    _lastEquippedHand: null,
  };
}

const hands = () => {
  const { equipment } = gameState.getPlayer();
  return [equipment[LEFT], equipment[RIGHT]];
};

let engine;
beforeEach(() => {
  gameState.init(TEST_RULES, ITEMS);
  engine = makeMockEngine();
});

test('equipItem: hand items fill left, then right, then alternate', () => {
  equipItem(engine, 'sword');
  assert.deepEqual(hands(), ['sword', null]);

  equipItem(engine, 'dagger');
  assert.deepEqual(hands(), ['sword', 'dagger']);

  // Both hands full: the next equip goes back to the left, and the one after
  // that to the right.
  equipItem(engine, 'flames');
  assert.deepEqual(hands(), ['flames', 'dagger']);

  equipItem(engine, 'cudgel');
  assert.deepEqual(hands(), ['flames', 'cudgel']);
});

test('equipItem: a freed hand is filled before the other is swapped out', () => {
  equipItem(engine, 'sword');
  equipItem(engine, 'dagger');
  unequipItem(engine, RIGHT);

  equipItem(engine, 'flames');
  assert.deepEqual(hands(), ['sword', 'flames']);
});

test('equipItem: a weapon goes to a hand whatever slot it declares', () => {
  // 'cudgel' declares the left hand and 'knife' declares none — the type is
  // what puts them in a hand, and the order is what picks which.
  equipItem(engine, 'cudgel');
  equipItem(engine, 'knife');
  assert.deepEqual(hands(), ['cudgel', 'knife']);
});

test('equipItem: other gear goes to the slot it declares', () => {
  equipItem(engine, 'jerkin');
  assert.equal(gameState.getPlayer().equipment.Torso, 'jerkin');
  assert.deepEqual(hands(), [null, null]);
});

test('equipItem/unequipItem: the worn armor bonus goes on and comes back off', () => {
  const before = gameState.getPlayer().attributes.ac;
  equipItem(engine, 'jerkin');
  assert.equal(gameState.getPlayer().attributes.ac, before + 2);
  unequipItem(engine, 'Torso');
  assert.equal(gameState.getPlayer().attributes.ac, before);
});

// ── itemHasUse ────────────────────────────────────────────────────────────────

test('itemHasUse: true for anything useItem can act on, false for inert gear', () => {
  assert.ok(itemHasUse({ attributes: { healingAmount: 4 } }), 'a consumable effect');
  assert.ok(itemHasUse({ attributes: { teleportScene: 'home_door' } }), 'a teleport is a use');

  assert.ok(!itemHasUse({ attributes: { damageRoll: '1d6' } }), 'a weapon is equipped, not used');
  assert.ok(!itemHasUse({ attributes: {} }));
  assert.ok(!itemHasUse({}), 'no attributes at all');
  assert.ok(!itemHasUse(null));
});
