import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pack, unpack, detectType } from '../studio/js/complex/logic.js';
import { autoLayout } from '../studio/js/complex/nodes.js';
import { makeReplacer } from '../studio/js/io.js';
import { normalizeDescription } from '../studio/js/components/scene-form.js';
import { rewriteInboundRefs } from '../studio/js/components/npc-form.js';
import { ACTION_TYPES } from '../studio/js/contracts.js';
import { ACTIONS } from '../src/core/config.js';

// ── contracts.js stays in sync with the engine (audit 4.1) ──────────────────

test('contracts ACTION_TYPES matches the engine core registrations exactly', () => {
  const code = ['../src/systems/actions.js', '../src/systems/dialogue.js']
    .map(p => readFileSync(new URL(p, import.meta.url), 'utf8'))
    .join('\n');
  // Core systems register via ACTIONS.X constants; resolve through the map.
  // Plugin registrations (string literals outside src/systems) are out of
  // scope — Studio discovers those at workspace load.
  const registered = new Set();
  for (const m of code.matchAll(/registerAction\(\s*ACTIONS\.([A-Z_]+)/g)) registered.add(ACTIONS[m[1]]);
  for (const m of code.matchAll(/registerAction\(\s*['"]([^'"]+)['"]/g)) registered.add(m[1]);
  assert.deepEqual(new Set(ACTION_TYPES.map(([t]) => t)), registered);
});

// ── normalizeDescription (audit 3.1) ────────────────────────────────────────

test('normalizeDescription wraps a plain string', () => {
  assert.deepEqual(normalizeDescription('Hello'), [{ text: 'Hello' }]);
});

test('normalizeDescription converts string array entries to objects', () => {
  assert.deepEqual(
    normalizeDescription(['First', { text: 'Second', condition: { flag: 'f', value: true } }]),
    [{ text: 'First' }, { text: 'Second', condition: { flag: 'f', value: true } }]
  );
});

test('normalizeDescription yields an empty array for missing input', () => {
  assert.deepEqual(normalizeDescription(undefined), []);
  assert.deepEqual(normalizeDescription(null), []);
});

// ── makeReplacer (audit 4.3/4.4) ─────────────────────────────────────────────

function serialize(fileKey, data) {
  return JSON.parse(JSON.stringify(data, makeReplacer(fileKey)));
}

test('makeReplacer strips dead keys from every file type', () => {
  const data = { disposition: 'x', droppedLoot: [], npcName: 'Guard', _studioLayout: {}, keep: 1 };
  assert.deepEqual(serialize('scenes:s', data), { keep: 1 });
});

test('makeReplacer strips optional empty arrays but keeps options', () => {
  const data = { actions: [], onFailure: [], items: [], skills: [], displays: [], carriedItems: [], options: [] };
  assert.deepEqual(serialize('scenes:s', data), { options: [] });
});

test('makeReplacer keeps non-empty arrays', () => {
  const data = { actions: [{ type: 'navigate' }] };
  assert.deepEqual(serialize('scenes:s', data), data);
});

test('makeReplacer keeps a dead-key name when it is nested, not top-level', () => {
  // Dead keys are stripped only at the top level; a nested field that happens
  // to share the name is real data and must survive the save.
  const data = { keep: 1, nested: { disposition: 'real', x: 2 } };
  assert.deepEqual(serialize('npcs:guard', data), { keep: 1, nested: { disposition: 'real', x: 2 } });
});

test('makeReplacer strips empty objects from NPC files only', () => {
  const data = { attributes: {}, equipment: {}, conversations: {} };
  assert.deepEqual(serialize('npcs:guard', data), {});
  // rules nests attributes/equipment under playerDefaults and the engine
  // clones them unguarded — they must survive there even when empty.
  assert.deepEqual(serialize('__rules', { playerDefaults: data }), { playerDefaults: data });
});

test('makeReplacer keeps non-empty NPC objects', () => {
  const data = { attributes: { healthPoints: 5 } };
  assert.deepEqual(serialize('npcs:guard', data), data);
});

// ── pack / unpack (audit §6: mirrors the engine compare() shorthand) ─────────

test('unpack treats a bare number as at_least', () => {
  assert.deepEqual(unpack(5), { op: 'at_least', val: 5 });
});

test('unpack reads {op: N} objects', () => {
  assert.deepEqual(unpack({ less_than: 3 }), { op: 'less_than', val: 3 });
  assert.deepEqual(unpack({ is: 0 }), { op: 'is', val: 0 });
});

test('unpack defaults null to at_least 0', () => {
  assert.deepEqual(unpack(null), { op: 'at_least', val: 0 });
});

test('pack writes at_least as the bare-number shorthand', () => {
  assert.equal(pack('at_least', 7), 7);
});

test('pack writes other operators as {op: val}', () => {
  assert.deepEqual(pack('more_than', 2), { more_than: 2 });
});

test('pack/unpack round-trip', () => {
  for (const raw of [4, { at_most: 1 }, { is: 9 }]) {
    const { op, val } = unpack(raw);
    assert.deepEqual(pack(op, val), raw);
  }
});

// ── detectType ───────────────────────────────────────────────────────────────

test('detectType recognizes combinators and leaf types', () => {
  assert.equal(detectType({ and: [] }, []), 'and');
  assert.equal(detectType({ or: [] }, []), 'or');
  assert.equal(detectType({ not: { flag: 'f' } }, []), 'not');
  assert.equal(detectType({ flag: 'f', value: true }, []), 'flag');
  assert.equal(detectType({ item: 'sword' }, []), 'item');
  assert.equal(detectType({ gold: 10 }, []), 'gold');
  assert.equal(detectType({ level: 2 }, []), 'level');
  assert.equal(detectType({ mission: 'm', status: 'active' }, []), 'mission');
});

test('detectType recognizes custom attributes from the given list', () => {
  assert.equal(detectType({ perception: { at_least: 2 } }, ['perception']), 'attribute');
  // unknown key without a matching attribute falls back to flag
  assert.equal(detectType({ perception: 2 }, []), 'flag');
});

test('detectType falls back to flag for empty or non-object input', () => {
  assert.equal(detectType({}, []), 'flag');
  assert.equal(detectType(null, []), 'flag');
});

// ── autoLayout (BFS columns) ─────────────────────────────────────────────────

const goTo = node => ({ responses: [{ actions: [{ type: 'goToConversation', node }] }] });

test('autoLayout places start in the first column and BFS levels after it', () => {
  const convs = { start: goTo('next'), next: { responses: [] } };
  const pos = autoLayout(convs);
  assert.deepEqual(pos.start, { x: 40, y: 40 });
  assert.equal(pos.next.x > pos.start.x, true);
  assert.equal(pos.next.y, 40);
});

test('autoLayout puts unreachable nodes in a trailing column', () => {
  const convs = { start: goTo('next'), next: { responses: [] }, orphan: { responses: [] } };
  const pos = autoLayout(convs);
  assert.equal(pos.orphan.x > pos.next.x, true);
});

test('autoLayout roots at the first node when there is no start', () => {
  const convs = { intro: goTo('end'), end: { responses: [] } };
  const pos = autoLayout(convs);
  assert.deepEqual(pos.intro, { x: 40, y: 40 });
});

test('autoLayout handles cycles without infinite looping', () => {
  const convs = { start: goTo('loop'), loop: goTo('start') };
  const pos = autoLayout(convs);
  assert.equal(Object.keys(pos).length, 2);
});

// ── rewriteInboundRefs (audit M8: node rename must not leave dangling refs) ───

test('rewriteInboundRefs repoints node-level, response, and onFailure references', () => {
  const conversations = {
    start: {
      npcText: 'Hi',
      actions: [{ type: 'goToConversation', node: 'old' }],
      responses: [
        { text: 'A', actions: [{ type: 'goToConversation', node: 'old' }] },
        { text: 'B', onFailure: [{ type: 'goToConversation', node: 'old' }], actions: [{ type: 'leave' }] },
        { text: 'C', actions: [{ type: 'goToConversation', node: 'other' }] },
      ],
    },
    old: { npcText: 'Renamed me' },
  };

  rewriteInboundRefs(conversations, 'old', 'new');

  assert.equal(conversations.start.actions[0].node, 'new');
  assert.equal(conversations.start.responses[0].actions[0].node, 'new');
  assert.equal(conversations.start.responses[1].onFailure[0].node, 'new');
  assert.equal(conversations.start.responses[2].actions[0].node, 'other'); // unrelated ref untouched
});

// ── Guided-creation helpers ───────────────────────────────────────────────────

test('slugify: display names become snake_case ids', async () => {
  const { slugify } = await import('../studio/js/utils.js');
  assert.equal(slugify('The Old Mill'), 'the_old_mill');
  assert.equal(slugify("Mira the Miller's Loft!"), 'mira_the_miller_s_loft');
  assert.equal(slugify('  --  '), '');
});

test('uniqueId: suffixes until free', async () => {
  const { uniqueId } = await import('../studio/js/utils.js');
  const taken = new Set(['mill', 'mill_2']);
  assert.equal(uniqueId('mill', id => taken.has(id)), 'mill_3');
  assert.equal(uniqueId('barn', id => taken.has(id)), 'barn');
  assert.equal(uniqueId('', () => false), 'entry');
});

test('detectChoiceKind: pipelines classify as go/talk/custom', async () => {
  const { detectChoiceKind } = await import('../studio/js/components/scene-form.js');
  assert.equal(detectChoiceKind({ actions: [{ type: 'navigate', destination: 'x' }] }), 'go');
  assert.equal(detectChoiceKind({ actions: [{ type: 'dialogue', npc: 'x' }] }), 'talk');
  assert.equal(detectChoiceKind({ actions: [] }), 'custom');
  assert.equal(detectChoiceKind({ actions: [{ type: 'navigate' }, { type: 'set_flag' }] }), 'custom');
  assert.equal(detectChoiceKind({}), 'custom');
});
