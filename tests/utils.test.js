import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentsTable, itemStatLines, equipmentAttributeBonuses } from '../src/core/utils.js';

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

// ── buildContentsTable ────────────────────────────────────────────────────────
// One builder behind every "what does this container hold" table (a chest's
// stacks, a museum room's display cases), so they cannot drift apart.

test('buildContentsTable: no rows means no table at all', () => {
  assert.equal(buildContentsTable(['Stored', 'Amount'], []), '');
});

test('buildContentsTable: with an empty message, that message stands in for the table', () => {
  const html = buildContentsTable(['Stored', 'Amount'], [], 'Chest is empty.');
  assert.match(html, /contents-table__empty">Chest is empty\.</);
  assert.ok(!html.includes('<table'), 'no headers over nothing');
});

test('buildContentsTable: the empty message is escaped too', () => {
  assert.match(buildContentsTable(['a', 'b'], [], '<b>empty</b>'), /&lt;b&gt;empty/);
});

test('buildContentsTable: a row per entry, with the headers given', () => {
  const html = buildContentsTable(['Stored', 'Amount'], [{ label: 'Rusty Sword', value: '2' }]);
  assert.match(html, /<th>Stored<\/th><th>Amount<\/th>/);
  assert.match(html, /<td>Rusty Sword<\/td>/);
  assert.match(html, /contents-table__value--filled">2</);
});

test('buildContentsTable: an empty entry styles its value as a placeholder', () => {
  const html = buildContentsTable(['Stand', 'Relic'], [{ label: 'Pedestal', value: '(Empty)', empty: true }]);
  assert.match(html, /contents-table__value--empty">\(Empty\)</);
});

test('buildContentsTable: labels and values are escaped — both can be player input', () => {
  const html = buildContentsTable(['Stand', 'Relic'], [
    { label: '<img src=x onerror=alert(1)>', value: '<b>relic</b>' },
  ]);
  assert.ok(!html.includes('<img'), 'the raw tag must not survive');
  assert.ok(!html.includes('<b>'), 'nor markup in the value');
  assert.match(html, /&lt;img/);
});
