import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemStatLines, equipmentAttributeBonuses, apEconomyRules } from '../src/core/utils.js';

// t() echoes "key:params" so assertions can check both key and values.
const t = (key, p) => p ? `${key}:${JSON.stringify(p)}` : key;

// ── itemStatLines ─────────────────────────────────────────────────────────────

test('itemStatLines: AP, hit attribute with wielder modifier, then attributes in order', () => {
  const item = { actionPoints: 1, attackAttribute: 'strength', attributes: { damageRoll: '1d6' } };
  const lines = itemStatLines(t, item, { strength: 2 });
  assert.match(lines[0], /itemStats\.actionPoints/);
  assert.match(lines[1], /itemStats\.hit.*"Strength".*"\+2"/);
  assert.match(lines[2], /itemStats\.damageRoll/);

  // Missing attribute value reads as +0; no governing attribute → no hit line.
  assert.match(itemStatLines(t, item)[1], /itemStats\.hit.*"\+0"/);
  assert.deepEqual(itemStatLines(t, { attributes: {} }), []);
});

test('itemStatLines: attributeBonuses and modifyResource render one line per entry', () => {
  const lines = itemStatLines(t, {
    attributes: {
      attributeBonuses: { perception: 1, luck: -1 },
      modifyResource: { resource: 'luckPoints', amount: 2 },
    },
  });
  assert.match(lines[0], /itemStats\.attributeBonus.*Perception.*\+1/);
  assert.match(lines[1], /itemStats\.attributeBonus.*Luck.*-1/);
  assert.match(lines[2], /itemStats\.modifyResource.*\+2/);
});

test('itemStatLines: unknown scalar attributes fall back to key: value', () => {
  // Engine t() returns the bare key for missing entries — mirror that here.
  const tMissing = (key) => key;
  const lines = itemStatLines(tMissing, { attributes: { itemWeight: 3 } });
  assert.deepEqual(lines, ['itemWeight: 3']);
});

test('itemStatLines: authoring-data attributes (teleportScene) never render', () => {
  assert.deepEqual(itemStatLines(t, { attributes: { teleportScene: 'home_door' } }), []);
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

// ── apEconomyRules ────────────────────────────────────────────────────────────

test('apEconomyRules: defaults reproduce classic behavior; knobs pass through', () => {
  assert.deepEqual(apEconomyRules(null), {
    refillOnCombatStart: true, refillPerRound: 'full', restRestore: 'full',
    minPerTurn: 0, maxPerTurn: 0, skillAttemptCost: 0,
  });
  const eco = apEconomyRules({ apEconomy: { refillOnCombatStart: false, refillPerRound: 2, maxPerTurn: 3 } });
  assert.equal(eco.refillOnCombatStart, false);
  assert.equal(eco.refillPerRound, 2);
  assert.equal(eco.maxPerTurn, 3);
  assert.equal(eco.restRestore, 'full');
});
