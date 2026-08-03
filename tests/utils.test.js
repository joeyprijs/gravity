import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemCardStats, itemStatLines, equipmentAttributeBonuses, compassPoint, COMPASS_POINTS } from '../src/core/utils.js';

// t() echoes "key:params" so assertions can check both key and values.
const t = (key, p) => p ? `${key}:${JSON.stringify(p)}` : key;

// ── itemStatLines ─────────────────────────────────────────────────────────────

test('itemStatLines: AP, hit attribute with wielder modifier, then attributes in order', () => {
  const item = { attributes: { actionPoints: 1, damageRoll: '1d6', attackAttribute: 'strength' } };
  const lines = itemStatLines(t, item, { strength: 2 });
  assert.match(lines[0], /itemStats\.actionPoints/);
  assert.match(lines[1], /itemStats\.hit.*"Strength".*"\+2"/);
  assert.match(lines[2], /itemStats\.damageRoll/);

  // Missing attribute value reads as +0; no governing attribute → no hit line.
  assert.match(itemStatLines(t, item)[1], /itemStats\.hit.*"\+0"/);
  assert.deepEqual(itemStatLines(t, { attributes: {} }), []);
});

test('itemStatLines: attributeBonuses render one line per entry', () => {
  const lines = itemStatLines(t, {
    attributes: {
      attributeBonuses: { perception: 1, luck: -1 },
    },
  });
  assert.match(lines[0], /itemStats\.attributeBonus.*Perception.*\+1/);
  assert.match(lines[1], /itemStats\.attributeBonus.*Luck.*-1/);
});

test('itemStatLines: unknown scalar attributes fall back to key: value', () => {
  // Engine t() returns the bare key for missing entries — mirror that here.
  const tMissing = (key) => key;
  const lines = itemStatLines(tMissing, { attributes: { itemWeight: 3 } });
  assert.deepEqual(lines, ['itemWeight: 3']);
});

test('itemStatLines: authoring-data attributes (teleportScene) never render', () => {
  assert.deepEqual(itemStatLines(t, { attributes: { teleportScene: 'home_living_room' } }), []);
});

// ── equipmentAttributeBonuses ─────────────────────────────────────────────────

test('equipmentAttributeBonuses: merges attributeBonuses with legacy armorClassBonus', () => {
  assert.deepEqual(equipmentAttributeBonuses(null), {});
  assert.deepEqual(equipmentAttributeBonuses({ attributes: { armorClassBonus: 2 } }), { ac: 2 });
  assert.deepEqual(
    equipmentAttributeBonuses({ attributes: { armorClassBonus: 2, attributeBonuses: { perception: 1, ac: 1 } } }),
    { ac: 3, perception: 1 }
  );
});

// ── itemCardStats ─────────────────────────────────────────────────────────────

test('itemCardStats: the slot leads and worth trails, around the shared stat lines', () => {
  const lines = itemCardStats(t, {
    type: 'Armor', slot: 'Amulet', value: 40,
    attributes: { attributeBonuses: { perception: 1 } },
  });
  assert.match(lines[0], /itemStats\.slot.*Amulet/, 'the slot is the first row');
  assert.match(lines[1], /itemStats\.attributeBonus/);
  assert.match(lines.at(-1), /itemStats\.value/, 'worth is the last row');
});

test('itemCardStats: only armor prints a slot — a weapon goes to whichever hand is free', () => {
  // rusty_sword declares "Right Hand" and the engine ignores it, so the card
  // must not claim otherwise.
  const weapon = itemCardStats(t, { type: 'Weapon', slot: 'Right Hand', attributes: { damageRoll: '1d6' } });
  assert.ok(!weapon.some(l => l.includes('itemStats.slot')), 'no slot row on a weapon');
  assert.ok(!itemCardStats(t, { type: 'Armor', attributes: { armorClassBonus: 1 } })
    .some(l => l.includes('itemStats.slot')), 'nor on armor that declares none');
});

test('itemCardStats: { slot: false } drops the slot row for the equipped list', () => {
  const item = { type: 'Armor', slot: 'Amulet', value: 40, attributes: { attributeBonuses: { perception: 1 } } };
  const lines = itemCardStats(t, item, {}, { slot: false });
  assert.ok(!lines.some(l => l.includes('itemStats.slot')), 'no slot row');
  assert.match(lines[0], /itemStats\.attributeBonus/, 'the rest is unchanged');
});

// ── compassPoint ──────────────────────────────────────────────────────────────
// The direction an option's arrow points, and the order roads are authored in,
// both come out of this. Its rounding has been wrong twice on the way in — once
// ordering by raw bearing, which files a road at 340° after south, and once at
// eight points, which asks the eye to decode a diagonal — so the boundaries are
// worth holding still.

const at = (left, top) => ({ mapDefinitions: { left, top, width: 10, height: 10 } });
const here = at(100, 100);

test('compassPoint: four cardinals, from a screen where north is up', () => {
  assert.equal(compassPoint(here, at(100, 0)), 'N');
  assert.equal(compassPoint(here, at(200, 100)), 'E');
  assert.equal(compassPoint(here, at(100, 200)), 'S');
  assert.equal(compassPoint(here, at(0, 100)), 'W');
  assert.deepEqual(COMPASS_POINTS, ['N', 'E', 'S', 'W']);
});

test('compassPoint: rounds to the nearest cardinal, and wraps at due north', () => {
  // A shade west of north is north, not west, and emphatically not "after
  // south" — which is what a raw 0–360 comparison does with 340°.
  assert.equal(compassPoint(here, at(90, 40)), 'N');    // ~ -9°
  assert.equal(compassPoint(here, at(110, 40)), 'N');   // ~ +9°
  // A true diagonal is not its own point any more: it lands on one side.
  assert.ok(['N', 'E'].includes(compassPoint(here, at(160, 40))), 'north-east resolves to a cardinal');
  // Just past the 45° boundary is unambiguously the next one round.
  assert.equal(compassPoint(here, at(200, 90)), 'E');
  assert.equal(compassPoint(here, at(200, 110)), 'E');
});

test('compassPoint: nowhere in particular is null, never a direction', () => {
  assert.equal(compassPoint(here, at(100, 100)), null, 'the same place has no bearing from itself');
  assert.equal(compassPoint(here, { name: 'unplaced' }), null, 'a scene with no mapDefinitions');
  assert.equal(compassPoint({ name: 'unplaced' }, here), null, 'or standing in one');
  assert.equal(compassPoint(here, null), null);
  assert.equal(compassPoint(null, here), null);
});
