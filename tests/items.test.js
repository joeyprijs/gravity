import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { equipItem, itemHasUse, unequipItem, useItem } from '../src/systems/items.js';
import { gameState } from '../src/core/state.js';

const LEFT = 'left_hand';
const RIGHT = 'right_hand';

const ITEMS = {
  sword:   { name: 'Sword',   type: 'Weapon', attributes: { damageRoll: '1d6', actionPoints: 1 } },
  dagger:  { name: 'Dagger',  type: 'Weapon', attributes: { damageRoll: '1d4', actionPoints: 1 } },
  flames:  { name: 'Flames',  type: 'Spell',  attributes: { damageRoll: '2d6', actionPoints: 2 } },
  frost:   { name: 'Frost',   type: 'Spell',  attributes: { damageRoll: '1d8', actionPoints: 2 } },
  // A weapon naming the hand kind outright, where the four above leave the
  // type to imply it — both routes must land in the same place.
  cudgel:  { name: 'Cudgel',  type: 'Weapon', slot: 'hand', attributes: { damageRoll: '1d6', actionPoints: 1 } },
  knife:   { name: 'Knife',   type: 'Weapon', attributes: { damageRoll: '1d4', actionPoints: 1 } },
  jerkin:  { name: 'Jerkin',  type: 'Armor',  slot: 'body', attributes: { armorClassBonus: 2, actionPoints: 0 } },
  // A shield is Armor that lives in a hand — the kind, not the type, decides.
  shield:  { name: 'Shield',  type: 'Armor',  slot: 'hand', attributes: { armorClassBonus: 2, actionPoints: 1 } },
  signet:  { name: 'Signet',  type: 'Armor',  slot: 'ring', attributes: { attributeBonuses: { ac: 1 } } },
  band:    { name: 'Band',    type: 'Armor',  slot: 'ring', attributes: {} },
  // A story book (the engine stamps item ids at load; the fixture stamps its own).
  book: {
    id: 'book', name: 'Book', type: 'Book',
    story: { chapters: [{ id: 'start', text: 'First.' }, { id: 'end', text: 'Last.' }] },
  },
};

const SLOTS = [
  { id: 'body', kind: 'body' },
  { id: LEFT, kind: 'hand' },
  { id: RIGHT, kind: 'hand' },
  { id: 'left_ring', kind: 'ring' },
  { id: 'right_ring', kind: 'ring' },
];

// Minimal rules — every item above in the pack, and the demo's slot shape.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0 },
    inventory: Object.keys(ITEMS).map(item => ({ item, amount: 1 })),
    equipmentSlots: SLOTS,
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// Minimal engine mock — equipItem/unequipItem touch nothing else.
function makeMockEngine() {
  return {
    data: { items: ITEMS, rules: { unequipApCost: 1, playerDefaults: { equipmentSlots: SLOTS } } },
    state: gameState,
    t: (key) => key,
    log: () => {},
    mode: 'scene',
    get inCombat() { return this.mode === 'combat'; },
    get isGameOver() { return this.mode === 'gameover'; },
    _spendAP: () => true,
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

test('equipItem: hand items fill left, then right', () => {
  equipItem(engine, 'sword');
  assert.deepEqual(hands(), ['sword', null]);

  equipItem(engine, 'dagger');
  assert.deepEqual(hands(), ['sword', 'dagger']);
});

test('equipItem: both hands full, the incoming item replaces its own type', () => {
  equipItem(engine, 'sword');
  equipItem(engine, 'flames');
  assert.deepEqual(hands(), ['sword', 'flames']);

  // A new weapon swaps the weapon, keeping the spell — and vice versa.
  equipItem(engine, 'dagger');
  assert.deepEqual(hands(), ['dagger', 'flames']);

  equipItem(engine, 'frost');
  assert.deepEqual(hands(), ['dagger', 'frost']);
});

test('equipItem: when the types cannot decide, the left hand is replaced', () => {
  // Two weapons, a third incoming: both hands match, the left goes first.
  equipItem(engine, 'sword');
  equipItem(engine, 'dagger');
  equipItem(engine, 'cudgel');
  assert.deepEqual(hands(), ['cudgel', 'dagger']);

  // Two weapons, a spell incoming: neither hand matches, the left still goes.
  equipItem(engine, 'flames');
  assert.deepEqual(hands(), ['flames', 'dagger']);
});

test('equipItem: a freed hand is filled before the other is swapped out', () => {
  equipItem(engine, 'sword');
  equipItem(engine, 'dagger');
  unequipItem(engine, RIGHT);

  equipItem(engine, 'flames');
  assert.deepEqual(hands(), ['sword', 'flames']);
});

test('equipItem: a weapon reaches a hand whether it names the kind or implies it', () => {
  // 'cudgel' declares the hand kind and 'knife' declares nothing — the type
  // supplies the kind, and the order is what picks which hand.
  equipItem(engine, 'cudgel');
  equipItem(engine, 'knife');
  assert.deepEqual(hands(), ['cudgel', 'knife']);
});

test('equipItem: other gear goes to the slot of the kind it declares', () => {
  equipItem(engine, 'jerkin');
  assert.equal(gameState.getPlayer().equipment.body, 'jerkin');
  assert.deepEqual(hands(), [null, null]);
});

test('equipItem: a kind with two slots fills both before it replaces either', () => {
  const rings = () => {
    const { equipment } = gameState.getPlayer();
    return [equipment.left_ring, equipment.right_ring];
  };
  equipItem(engine, 'signet');
  assert.deepEqual(rings(), ['signet', null], 'the first ring takes the first free slot');

  equipItem(engine, 'band');
  assert.deepEqual(rings(), ['signet', 'band'], 'the second finds the other hand, not the first ring');

  // Both full and both the same type: the first slot of the kind gives way.
  equipItem(engine, 'signet');
  assert.deepEqual(rings(), ['signet', 'band']);
});

test('equipItem: a shield competes for a hand, because its kind says so', () => {
  equipItem(engine, 'sword');
  equipItem(engine, 'shield');
  assert.deepEqual(hands(), ['sword', 'shield'], 'Armor by type, but a hand by kind');

  // A second weapon replaces the weapon, not the shield — same-type wins.
  equipItem(engine, 'dagger');
  assert.deepEqual(hands(), ['dagger', 'shield']);
});

test('equipItem/unequipItem: the worn armor bonus goes on and comes back off', () => {
  const before = gameState.getPlayer().attributes.ac;
  equipItem(engine, 'jerkin');
  assert.equal(gameState.getPlayer().attributes.ac, before + 2);
  unequipItem(engine, 'body');
  assert.equal(gameState.getPlayer().attributes.ac, before);
});

// ── itemHasUse ────────────────────────────────────────────────────────────────

test('itemHasUse: true for anything useItem can act on, false for inert gear', () => {
  assert.ok(itemHasUse({ attributes: { healingAmount: 4 } }), 'a consumable effect');
  assert.ok(itemHasUse({ attributes: { teleportScene: 'home_living_room' } }), 'a teleport is a use');

  assert.ok(!itemHasUse({ attributes: { damageRoll: '1d6' } }), 'a weapon is equipped, not used');
  assert.ok(!itemHasUse({ attributes: {} }));
  assert.ok(!itemHasUse({}), 'no attributes at all');
  assert.ok(!itemHasUse(null));
});

// ── story books ───────────────────────────────────────────────────────────────

test('useItem: a story book replays heard chapters in authored order and is never consumed', () => {
  const logs = [];
  engine.log = (type, message, variant) => logs.push({ type, message, variant });
  engine.data.scenes = {};
  // Heard out of order — the retelling still follows the authored order.
  gameState.grantStoryChapter('book', 'end');
  gameState.grantStoryChapter('book', 'start');
  useItem(engine, 'book');
  assert.equal(logs[0].message, 'player.readBook');
  assert.equal(logs[0].variant, 'choice');
  assert.deepEqual(logs.slice(1).map(l => l.message), ['First.', 'Last.']);
  assert.equal(gameState.countPlayerItem('book'), 1, 'reading never consumes the book');
});

test('useItem: a book with no heard chapters reads as blank pages', () => {
  const logs = [];
  engine.log = (type, message) => logs.push(message);
  engine.data.scenes = {};
  useItem(engine, 'book');
  assert.deepEqual(logs, ['player.readBook', 'story.emptyBook']);
});

test('itemHasUse: a story book is readable, so its card is a control', () => {
  assert.ok(itemHasUse({ story: { chapters: [{ id: 'a', text: 'A.' }] } }));
});
