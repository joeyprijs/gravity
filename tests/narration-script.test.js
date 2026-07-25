import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSceneLines, collectSharedLines, assignClips, slugify, pathSegment, looksGenerated, CLIP_EXT } from '../scripts/generate-narration-script.js';

// A scene carrying every prose shape the extractor has to cope with, plus the
// button labels it must leave alone.
const SCENE = {
  id: 'test_scene',
  region: 'testland',
  description: [
    { text: 'The door is open.', condition: { flag: 'door_open', value: true } },
    { text: 'The door is shut.', narration: 'audio/narration/testland/scene__shut.wav' },
  ],
  passiveChecks: [
    { skillCheck: 'perception', dc: 12, flag: 'noticed', text: 'Something glints.' },
  ],
  options: [
    {
      text: 'Pull the lever',
      actions: [
        { type: 'set_flag', flag: 'pulled', value: true },
        { type: 'loot', item: 'key', log: 'A key drops into your palm.', narration: 'audio/narration/testland/scene__lever.wav' },
        { type: 'heal', amount: 2, log: false },
        { type: 'set_timer', id: 't', afterTicks: 4, actions: [{ type: 'log', message: 'A horn sounds far off.' }] },
      ],
    },
    { text: 'Leave', actions: [{ type: 'navigate', destination: 'elsewhere' }] },
  ],
  skills: [
    {
      text: 'Force the hatch',
      retryText: 'Try the hatch again.',
      skillCheck: 'strength',
      dc: 12,
      outcomes: {
        success: { text: 'The hatch gives.', actions: [{ type: 'loot', item: 'rope', log: 'A coil of rope.' }] },
        failure: { text: ['It holds.', 'It holds again.'] },
      },
      onExhausted: [{ type: 'log', message: 'The hatch has beaten you.' }],
    },
    { text: 'Taste the stew', skillCheck: 'luck', resultText: ['Needs salt.', 'Still needs salt.'] },
  ],
};

const lines = collectSceneLines(SCENE);
const byPath = (jsonPath) => lines.find(l => l.jsonPath === jsonPath);

test('collects both description variants with their conditions and wired clips', () => {
  assert.equal(byPath('description[0].text').text, 'The door is open.');
  assert.match(byPath('description[0].text').label, /door_open = true/);
  assert.equal(byPath('description[0].text').narration, null);
  assert.equal(byPath('description[1].text').narration, 'audio/narration/testland/scene__shut.wav');
  assert.match(byPath('description[1].text').label, /default/);
});

test('collects a plain-string description and the scene-level clip', () => {
  const [line] = collectSceneLines({ description: 'A quiet room.', narration: 'audio/narration/x/room.wav' });
  assert.equal(line.jsonPath, 'description');
  assert.equal(line.narration, 'audio/narration/x/room.wav');
});

test('collects passive check text', () => {
  assert.equal(byPath('passiveChecks[0].text').text, 'Something glints.');
  assert.equal(byPath('passiveChecks[0].text').kind, 'passive');
});

test('collects outcome text in both string and per-attempt array form', () => {
  assert.equal(byPath('skills[0].outcomes.success.text').text, 'The hatch gives.');
  assert.equal(byPath('skills[0].outcomes.failure.text[0]').text, 'It holds.');
  assert.match(byPath('skills[0].outcomes.failure.text[1]').label, /attempt 2/);
});

test('collects narrative-check resultText arrays', () => {
  assert.equal(byPath('skills[1].resultText[0]').text, 'Needs salt.');
  assert.equal(byPath('skills[1].resultText[1]').text, 'Still needs salt.');
});

test('collects action log text at every nesting depth, with its wired clip', () => {
  assert.equal(byPath('options[0].actions[1].log').text, 'A key drops into your palm.');
  assert.equal(byPath('options[0].actions[1].log').narration, 'audio/narration/testland/scene__lever.wav');
  // A timer's pipeline, an outcome's actions, and an exhaustion route all nest.
  assert.equal(byPath('options[0].actions[3].actions[0].message').text, 'A horn sounds far off.');
  assert.equal(byPath('skills[0].outcomes.success.actions[0].log').text, 'A coil of rope.');
  assert.equal(byPath('skills[0].onExhausted[0].message').text, 'The hatch has beaten you.');
});

test('never collects button labels or a silenced log', () => {
  const texts = lines.map(l => l.text);
  for (const label of ['Pull the lever', 'Leave', 'Force the hatch', 'Try the hatch again.', 'Taste the stew']) {
    assert.ok(!texts.includes(label), `button label "${label}" must not be narrated`);
  }
  // { "log": false } silences the default message — there is nothing to read.
  assert.equal(byPath('options[0].actions[2].log'), undefined);
});

test('assignClips prefers the wired path and suggests unique names otherwise', () => {
  const assigned = assignClips(lines, 'testland', 'scene');
  const clip = (jsonPath) => assigned.find(l => l.jsonPath === jsonPath).clip;
  // Wired paths win outright.
  assert.equal(clip('description[1].text'), 'audio/narration/testland/scene__shut.wav');
  assert.equal(clip('options[0].actions[1].log'), 'audio/narration/testland/scene__lever.wav');
  // The fallback variant takes the scene's base name; a conditional one is
  // named for its flag.
  assert.equal(clip('description[0].text'), `audio/narration/testland/scene__door_open.${CLIP_EXT}`);
  assert.equal(clip('skills[0].outcomes.success.text'), `audio/narration/testland/scene__force_hatch_success.${CLIP_EXT}`);
  // Per-attempt lines share a slug, so the collision suffix keeps them apart.
  assert.equal(clip('skills[1].resultText[0]'), `audio/narration/testland/scene__taste_stew.${CLIP_EXT}`);
  assert.equal(clip('skills[1].resultText[1]'), `audio/narration/testland/scene__taste_stew_2.${CLIP_EXT}`);
  assert.equal(new Set(assigned.map(l => l.clip)).size, assigned.length, 'every clip path is unique');
});

test('a variant is named from its position in description, not in the line list', () => {
  // The line list is not the description array: anything collected before the
  // descriptions would shift a positional index. Feeding assignClips a list
  // where the variant sits third pins that the name follows `variantIndex`.
  const lines = [
    { jsonPath: 'passiveChecks[0].text', kind: 'passive', slug: 'passive_perception', narration: null },
    { jsonPath: 'skills[0].outcomes.success.text', kind: 'outcome', slug: 'force_hatch_success', narration: null },
    { jsonPath: 'description[1].text', kind: 'description', narration: null, variantIndex: 1,
      condition: { and: [{ flag: 'a', value: true }, { flag: 'b', value: true }] } },
  ];
  const assigned = assignClips(lines, 'testland', 'scene');
  assert.equal(assigned[2].clip, `audio/narration/testland/scene__variant1.${CLIP_EXT}`);
});

test('a wired line reserves no suggested name for the lines after it', () => {
  // The wired clip below would otherwise consume the base name and push the
  // unwired default variant to a needless `_2`.
  const lines = [
    { jsonPath: 'description[0].text', kind: 'description', narration: 'audio/narration/testland/hand_picked.webm', condition: null, variantIndex: 0 },
    { jsonPath: 'description[1].text', kind: 'description', narration: null, condition: null, variantIndex: 1 },
  ];
  const assigned = assignClips(lines, 'testland', 'scene');
  assert.equal(assigned[0].clip, 'audio/narration/testland/hand_picked.webm');
  assert.equal(assigned[1].clip, `audio/narration/testland/scene.${CLIP_EXT}`);
});

test('slugify drops stopwords and punctuation, keeping four words', () => {
  assert.equal(slugify('Take a closer look at the door'), 'take_closer_look_door');
  assert.equal(slugify('Climb toward the shimmer in the ceiling crack.'), 'climb_toward_shimmer_ceiling');
  assert.equal(slugify('!!!'), 'clip');
});

// ── Output-tree safety ──────────────────────────────────────────────────────

test('pathSegment keeps a data-supplied id from escaping the output directory', () => {
  assert.equal(pathSegment('dungeon', 'unsorted'), 'dungeon');
  assert.equal(pathSegment('player_home', 'unsorted'), 'player_home');
  // A region id is authored data; traversal must not survive it.
  assert.equal(pathSegment('../../etc', 'unsorted'), 'etc');
  assert.equal(pathSegment('a/b', 'unsorted'), 'ab');
  // Nothing usable left, or nothing given at all.
  assert.equal(pathSegment('///', 'unsorted'), 'unsorted');
  assert.equal(pathSegment(undefined, 'unsorted'), 'unsorted');
});

test('looksGenerated only claims files this tool wrote', () => {
  assert.ok(looksGenerated('Generated by scripts/generate-narration-script.js — edits here are lost.'));
  // Someone's own note in the output tree is not ours to delete.
  assert.ok(!looksGenerated('my recording plan\n- do the corridor first\n'));
  assert.ok(!looksGenerated(''));
});

// ── Shared locale prose ─────────────────────────────────────────────────────

test('collectSharedLines keeps narrator sentences and drops chrome', () => {
  const shared = collectSharedLines({
    actions: {
      lookAroundFail: 'Nothing reveals itself.',      // prose → kept
      lookAround: 'Look Around',                       // no terminal punctuation
      skillFail: '{skill} check: {roll}, failure.',    // interpolated, unrecordable
    },
    ui: { inventoryEmpty: 'Inventory is empty.' },     // chrome namespace
    combat: { avoided: 'They regard you peacefully.' },
    stats: { hp: '{current}/{max}' },
  });
  assert.deepEqual(shared.map(l => l.key), ['actions.lookAroundFail', 'combat.avoided']);
});
