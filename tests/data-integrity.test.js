import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { validateGameData, normalizeCarriedItems } from '../src/core/validate.js';
import { ACTIONS, ITEM_TYPES } from '../src/core/config.js';
import { layoutMuseum } from '../src/plugins/curator.js';

// Integration coverage for the *shipped* example game. The unit tests in
// validate.test.js exercise synthetic fixtures; these load the real data/
// directory the same way the engine does, so reference drift (a dangling item,
// a dead field, a scene that no longer matches its schema) fails CI instead of
// shipping silently.

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const index = readJson('../data/index.json');
const rules = readJson(`../${index.rules}`);
const localePath = index.locales?.[index.defaultLanguage ?? 'en'] ?? 'data/locales.json';
const locale = readJson(`../${localePath}`);

function loadMap(map) {
  const out = {};
  for (const [id, path] of Object.entries(map ?? {})) out[id] = readJson(`../${path}`);
  return out;
}

const data = {
  items: loadMap(index.items),
  npcs: loadMap(index.npcs),
  scenes: loadMap(index.scenes),
  missions: loadMap(index.missions),
  tables: loadMap(index.tables),
  regions: index.regions,
  rules,
  locale,
};

test('the shipped example game validates with zero issues', () => {
  normalizeCarriedItems(data.npcs);
  // Object.values(ACTIONS) mirrors the engine's built-in + dialogue + curator
  // action registry — every action the example data is allowed to reference.
  const issues = validateGameData(data, new Set(Object.values(ACTIONS)));
  assert.deepEqual(issues, [], `example data has validation issues:\n${issues.map(i => `  ${i.group}: ${i.message}`).join('\n')}`);
});

// ── Top-level JSON Schema conformance ────────────────────────────────────────
// A focused, dependency-free check that the shipped data does not drift from
// the published schemas at the top level: no unexpected keys (additionalProperties:
// false) and all required keys present (including anyOf-of-required). This is
// what would have caught the inline `id` fields and the name/title mismatch.

function topLevelSchemaIssues(schema, obj) {
  const issues = [];
  const props = new Set(Object.keys(schema.properties ?? {}));
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!props.has(key)) issues.push(`unexpected top-level key "${key}"`);
    }
  }
  for (const req of schema.required ?? []) {
    if (!(req in obj)) issues.push(`missing required key "${req}"`);
  }
  if (Array.isArray(schema.anyOf)) {
    const satisfied = schema.anyOf.some(branch => (branch.required ?? []).every(r => r in obj));
    if (!satisfied) issues.push('satisfies none of the anyOf required key sets');
  }
  return issues;
}

const itemSchema = readJson('../schemas/item.schema.json');
const sceneSchema = readJson('../schemas/scene.schema.json');
const npcSchema = readJson('../schemas/npc.schema.json');

test('every shipped item conforms to item.schema.json at the top level', () => {
  for (const [id, item] of Object.entries(data.items)) {
    assert.deepEqual(topLevelSchemaIssues(itemSchema, item), [], `item "${id}"`);
  }
});

test('every shipped scene conforms to scene.schema.json at the top level', () => {
  for (const [id, scene] of Object.entries(data.scenes)) {
    assert.deepEqual(topLevelSchemaIssues(sceneSchema, scene), [], `scene "${id}"`);
  }
});

test('every shipped NPC conforms to npc.schema.json at the top level', () => {
  for (const [id, npc] of Object.entries(data.npcs)) {
    assert.deepEqual(topLevelSchemaIssues(npcSchema, npc), [], `npc "${id}"`);
  }
});

const missionSchema = readJson('../schemas/mission.schema.json');

test('every shipped mission conforms to mission.schema.json at the top level', () => {
  for (const [id, mission] of Object.entries(data.missions)) {
    assert.deepEqual(topLevelSchemaIssues(missionSchema, mission), [], `mission "${id}"`);
  }
});

// ── Audio assets ─────────────────────────────────────────────────────────────
// Clips are recorded by hand and referenced by path, and a missing file is only
// a console warning at runtime — so a typo would ship as silence. Collect every
// `ambience`/`narration` path in the data (scene-level, description variants,
// and anywhere inside an action pipeline) and assert the file is on disk.

function collectAudioPaths(node, out = []) {
  if (Array.isArray(node)) node.forEach(child => collectAudioPaths(child, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'ambience' || key === 'narration') && typeof value === 'string') out.push(value);
      else collectAudioPaths(value, out);
    }
  }
  return out;
}

test('every audio path referenced by the shipped data exists on disk', (t) => {
  const paths = collectAudioPaths([index.regions, data.scenes]);
  assert.ok(paths.length > 0, 'expected the example game to reference some audio');
  const onDisk = paths.filter(path => existsSync(new URL(`../${path}`, import.meta.url)));
  // The clips themselves are gitignored, so a fresh clone and CI have none of
  // them and there is nothing to check. All-or-nothing on purpose: once even
  // one clip is present, every path must resolve — which is what catches a
  // typo in the checkout that actually has the audio.
  if (!onDisk.length) return t.skip('no audio clips in this checkout (they are gitignored)');
  for (const path of paths) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `missing audio file "${path}"`);
  }
});

// ── Museum map layout ────────────────────────────────────────────────────────
// The curator derives museum geometry from each wing's slot; the coordinates in
// the scene files are the fallback for running without the plugin. Two sources,
// so they must agree — otherwise the map jumps the moment the plugin loads, and
// nobody would know which of the two they were supposed to edit.

test('the shipped museum scenes are authored where the curator computes them', () => {
  const config = index.plugins.find(p => p.id === 'curator')?.config?.museumLayout;
  assert.ok(config, 'the curator declares a museumLayout');

  const engine = { data: { scenes: structuredClone(data.scenes) }, pluginConfig: () => ({ museumLayout: config }) };
  layoutMuseum(engine);

  const museumScenes = Object.entries(data.scenes)
    .filter(([, s]) => s.museumHall || Number.isInteger(s.museumSlot));
  assert.ok(museumScenes.length >= 3, 'the demo ships a hall and its wings');
  for (const [id, scene] of museumScenes) {
    assert.deepEqual(scene.mapDefinitions, engine.data.scenes[id].mapDefinitions,
      `scene "${id}" is authored at coordinates the curator would move it away from`);
  }
});

// Growth is the point: a museum with more wings than the demo ships must still
// tile without overlaps, and the hall must cover every column.
test('the museum layout stays overlap-free as wings are added', () => {
  const config = index.plugins.find(p => p.id === 'curator').config.museumLayout;
  const scenes = { hall: { museumHall: true } };
  for (let slot = 0; slot < 24; slot++) scenes[`wing${slot}`] = { museumSlot: slot };
  layoutMuseum({ data: { scenes }, pluginConfig: () => ({ museumLayout: config }) });

  const wings = Object.values(scenes).filter(s => Number.isInteger(s.museumSlot));
  const spots = wings.map(s => `${s.mapDefinitions.left},${s.mapDefinitions.top}`);
  assert.equal(new Set(spots).size, wings.length, 'every wing has the map to itself');

  const hall = scenes.hall.mapDefinitions;
  const rightmost = Math.max(...wings.map(s => s.mapDefinitions.left + s.mapDefinitions.width));
  assert.equal(hall.left + hall.width, rightmost, 'the hall reaches the last column');
  assert.ok(rightmost <= index.worldMapSize.width, `24 wings (${rightmost}px) fit the world canvas`);
});

test('config.ITEM_TYPES matches the item.schema.json type enum', () => {
  const schema = readJson('../schemas/item.schema.json');
  const schemaTypes = new Set(schema.properties.type.enum);
  assert.deepEqual(new Set(ITEM_TYPES), schemaTypes,
    'config.ITEM_TYPES and schemas/item.schema.json disagree — update whichever is wrong');
});

test('every item type has a section label, and Special items carry no sell price', () => {
  const items = loadMap(index.items);
  for (const type of ITEM_TYPES) {
    assert.ok(locale.itemTypes?.[type], `itemTypes.${type} has no label — its inventory section would read as a raw key`);
    assert.ok(rules.itemTypeOrder?.[type] !== undefined, `itemTypeOrder.${type} is unset — the section would sort to the end`);
  }
  // A Special item can never be sold, so a "Value: N Gold" line on its card
  // would advertise gold the player has no way to collect.
  for (const [id, item] of Object.entries(items)) {
    if (item.type !== 'Special') continue;
    assert.ok(!item.value, `${id} is Special but declares a value — Special items are unsellable`);
  }
});
