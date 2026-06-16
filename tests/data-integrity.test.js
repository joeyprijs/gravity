import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateGameData, normalizeCarriedItems } from '../src/core/validate.js';
import { ACTIONS } from '../src/core/config.js';

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
