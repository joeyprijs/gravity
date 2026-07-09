import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCarriedItems, normalizeRules, validateGameData } from '../src/core/validate.js';

const KNOWN_ACTIONS = new Set(['loot', 'combat', 'navigate', 'set_flag', 'dialogue', 'goToConversation', 'leave']);

// Minimal but complete data set that validates cleanly. Tests clone and break it.
function makeCleanData() {
  return {
    items: {
      sword: { name: 'Sword' },
      potion: { name: 'Potion' },
    },
    npcs: {
      goblin: {
        name: 'Goblin',
        attributes: { healthPoints: 5, armorClass: 7, actionPoints: 2 },
        equipment: { 'Right Hand': 'sword' },
        carriedItems: ['potion'],
      },
      elder: {
        name: 'Elder',
        conversations: {
          start: {
            npcText: 'Hello.',
            responses: [
              { text: 'Bye.', actions: [{ type: 'leave' }] },
              { text: 'Tell me more.', actions: [{ type: 'goToConversation', node: 'more' }] },
            ],
          },
          more: { npcText: 'More.', responses: [{ text: 'Bye.', actions: [{ type: 'leave' }] }] },
        },
      },
    },
    scenes: {
      cave: {
        title: 'Cave',
        options: [
          {
            text: 'Fight',
            condition: { item: 'sword' },
            actions: [{ type: 'combat', enemies: ['goblin'], onVictory: [{ type: 'navigate', destination: 'exit' }] }],
          },
        ],
        skills: [
          { text: 'Search', skillCheck: 'perception', items: [{ item: 'potion', dc: 10 }, { table: 'loot', dc: 12 }] },
        ],
      },
      exit: { title: 'Exit', options: [] },
    },
    missions: { escape: { title: 'Escape' } },
    tables: { loot: { entries: [{ item: 'potion' }, { item: 'gold', amount: 5 }] } },
    rules: {
      xpPerLevel: 100,
      playerDefaults: { attributes: { ac: 10 } },
      customAttributes: [{ id: 'perception', default: 0 }],
      fallbackWeapons: { player: 'sword', enemy: 'sword' },
    },
    locale: { actions: { skillBadge: { perception: 'PER {dc}' }, skillBadgeFree: { perception: 'Perception' } } },
  };
}

function validate(data) {
  // Mirror the engine's load order: carriedItems are normalized before validation.
  normalizeCarriedItems(data.npcs);
  return validateGameData(data, KNOWN_ACTIONS);
}

test('normalizeCarriedItems: string shorthand becomes { item, amount: null }', () => {
  const npcs = { vendor: { carriedItems: ['potion', { item: 'sword', amount: 2 }, { item: 'rope' }] } };
  normalizeCarriedItems(npcs);
  assert.deepEqual(npcs.vendor.carriedItems, [
    { item: 'potion', amount: null },
    { item: 'sword', amount: 2 },
    { item: 'rope', amount: null },
  ]);
});

test('normalizeCarriedItems: NPCs without carriedItems are untouched', () => {
  const npcs = { hermit: { name: 'Hermit' } };
  normalizeCarriedItems(npcs);
  assert.deepEqual(npcs.hermit, { name: 'Hermit' });
});

test('clean data produces no issues', () => {
  assert.deepEqual(validate(makeCleanData()), []);
});

test('flags unknown item references in tables, loot actions, and skill items', () => {
  const data = makeCleanData();
  data.tables.loot.entries.push({ item: 'ghost' });
  data.scenes.cave.skills[0].items[0].item = 'ghost2';
  const issues = validate(data);
  assert.equal(issues.length, 2);
  assert.match(issues[0].message, /unknown item "ghost"/);
  assert.equal(issues[0].group, 'Table "loot"');
});

test('flags unknown action types and navigate destinations', () => {
  const data = makeCleanData();
  data.scenes.cave.options[0].actions.push({ type: 'explode' }, { type: 'navigate', destination: 'nowhere' });
  const issues = validate(data);
  assert.ok(issues.some(i => i.message.includes('unknown action type "explode"')));
  assert.ok(issues.some(i => i.message.includes('unknown destination "nowhere"')));
});

test('flags enemies that are missing combat attributes', () => {
  const data = makeCleanData();
  delete data.npcs.goblin.attributes.healthPoints;
  delete data.npcs.goblin.attributes.armorClass;
  const issues = validate(data);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /enemy "goblin" is missing combat attributes: healthPoints, armorClass/);
});

test('flags unknown enemies in combat and autoAttack', () => {
  const data = makeCleanData();
  data.scenes.cave.options[0].actions[0].enemies.push('dragon');
  data.scenes.exit.autoAttack = { enemies: ['wraith'] };
  const issues = validate(data);
  assert.ok(issues.some(i => i.message.includes('unknown enemy "dragon"')));
  assert.ok(issues.some(i => i.group === 'Scene "exit"' && i.message.includes('unknown enemy "wraith"')));
});

test('flags skillCheck names not declared in rules', () => {
  const data = makeCleanData();
  data.scenes.cave.skills[0].skillCheck = 'luck';
  const issues = validate(data);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /unknown skillCheck "luck"/);
});

test('flags unknown items and missions in condition trees', () => {
  const data = makeCleanData();
  data.scenes.cave.options[0].condition = {
    and: [{ item: 'ghost' }, { not: { mission: 'no_such_mission' } }],
  };
  const issues = validate(data);
  assert.equal(issues.length, 2);
  assert.match(issues[0].message, /unknown item "ghost"/);
  assert.match(issues[1].message, /unknown mission "no_such_mission"/);
});

test('flags broken goToConversation node references', () => {
  const data = makeCleanData();
  data.npcs.elder.conversations.start.responses[1].actions[0].node = 'missing_node';
  const issues = validate(data);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].group, 'NPC "elder"');
  assert.match(issues[0].message, /goToConversation → unknown node "missing_node"/);
});

test('flags missing fallback weapons and locale entries', () => {
  const data = makeCleanData();
  data.rules.fallbackWeapons.enemy = 'claw';
  data.locale.actions.skillBadge = {};
  const issues = validate(data);
  assert.equal(issues.length, 2);
  assert.ok(issues.every(i => i.group === 'Rules'));
  assert.match(issues[0].message, /fallback item "claw"/);
  assert.match(issues[1].message, /missing locale entry at actions.skillBadge.perception/);
});

test('handles empty data without throwing', () => {
  const issues = validateGameData(
    { items: {}, npcs: {}, scenes: {}, missions: {}, tables: {}, rules: null, locale: {} },
    new Set()
  );
  assert.deepEqual(issues, []);
});

test('flags a custom attribute id that collides with a reserved condition keyword', () => {
  const data = makeCleanData();
  data.rules.customAttributes.push({ id: 'gold', default: 0 });
  data.locale.actions.skillBadge.gold = 'GOLD {dc}';
  const issues = validate(data);
  assert.ok(issues.some(i => i.group === 'Rules' && /reserved/.test(i.message)));
});

test('flags a missing or non-positive xpPerLevel', () => {
  const data = makeCleanData();
  data.rules.xpPerLevel = 0;
  const issues = validate(data);
  assert.ok(issues.some(i => /xpPerLevel must be a positive number/.test(i.message)));
});

// ── Engagement-toolkit validations (outcomes, luck, time, timers, passive) ────

const TOOLKIT_ACTIONS = new Set([...KNOWN_ACTIONS, 'advance_time', 'set_timer', 'cancel_timer', 'start_clock', 'advance_clock', 'cancel_clock', 'restore_luck', 'log']);

// Extends the clean fixture with luck + time configuration so the new checks
// have their backing config; tests then break specific pieces.
function makeToolkitData() {
  const data = makeCleanData();
  data.rules.playerDefaults.resources = { luck: { current: 7, max: 9 } };
  data.rules.time = {
    ticksPerDay: 24,
    startTick: 8,
    segments: [{ id: 'morning', from: 6 }, { id: 'night', from: 22 }],
    defaultCosts: { navigate: 1 },
  };
  data.locale.time = { segments: { morning: 'Morning', night: 'Night' } };
  return data;
}

function issuesFor(data) {
  normalizeCarriedItems(data.npcs);
  return validateGameData(data, TOOLKIT_ACTIONS).map(i => i.message);
}

test('toolkit fixture validates cleanly', () => {
  assert.deepEqual(issuesFor(makeToolkitData()), []);
});

test('flags the removed increment field on checks and discovery items', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills[0].items[0].increment = 2;
  data.npcs.elder.conversations.start.responses[0].skillCheck = 'perception';
  data.npcs.elder.conversations.start.responses[0].dc = 10;
  data.npcs.elder.conversations.start.responses[0].increment = 1;
  const messages = issuesFor(data);
  assert.equal(messages.filter(m => m.includes('"increment" (DC escalation) was removed')).length, 2);
});

test('flags luckCheck conflicts and luckCheck without the luck resource', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills.push({ text: 'Gamble', luckCheck: true, skillCheck: 'perception', dc: 5 });
  let messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('both luckCheck and skillCheck')));
  assert.ok(messages.some(m => m.includes('luckCheck takes no DC')));

  const noLuck = makeToolkitData();
  delete noLuck.rules.playerDefaults.resources;
  noLuck.scenes.cave.skills.push({ text: 'Gamble', luckCheck: true });
  messages = issuesFor(noLuck);
  assert.ok(messages.some(m => m.includes('luckCheck requires a luck resource')));
});

test('flags luckCheck with item drops — the discovery flow never runs', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills.push({ text: 'Gamble', luckCheck: true, items: [{ item: 'sword', dc: 10 }] });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('luckCheck with item drops')));

  // An empty leftover items array (Studio initializes one) is fine.
  const clean = makeToolkitData();
  clean.scenes.cave.skills.push({ text: 'Gamble', luckCheck: true, items: [] });
  assert.ok(!issuesFor(clean).some(m => m.includes('luckCheck with item drops')));
});

test('flags a startTick outside [0, ticksPerDay)', () => {
  for (const bad of [-1, 24, 'noon']) {
    const data = makeToolkitData();
    data.rules.time.startTick = bad;
    assert.ok(issuesFor(data).some(m => m.includes('time.startTick')), `startTick ${bad} should be flagged`);
  }
  const edge = makeToolkitData();
  edge.rules.time.startTick = 23;
  assert.ok(!issuesFor(edge).some(m => m.includes('time.startTick')));
});

test('flags unknown outcome tiers and double-defined tier pipelines', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills.push({
    text: 'Climb', skillCheck: 'perception', dc: 10,
    actions: [{ type: 'set_flag', flag: 'x', value: true }],
    outcomes: { fumble: {}, success: { actions: [{ type: 'set_flag', flag: 'y', value: true }] } },
  });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('unknown outcomes tier "fumble"')));
  assert.ok(messages.some(m => m.includes('both "actions" and outcomes.success.actions')));
});

test('flags redundant or inert attempt-budget combinations', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills.push(
    { text: 'A', skillCheck: 'perception', dc: 10, resolveOnce: true, maxAttempts: 3 },
    { text: 'B', skillCheck: 'perception', dc: 10, onExhausted: [{ type: 'set_flag', flag: 'x', value: true }] },
    { text: 'C', skillCheck: 'perception', dc: 10, maxAttempts: 2 },
  );
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('resolveOnce makes maxAttempts redundant')));
  assert.ok(messages.some(m => m.includes('onExhausted never runs without maxAttempts')));
  assert.ok(messages.some(m => m.includes('maxAttempts without onExhausted')));
});

test('clocks: flags unsafe onFilled actions, missing fields, and never-started references', () => {
  const data = makeToolkitData();
  data.scenes.cave.options.push({
    text: 'Start',
    actions: [{
      type: 'start_clock', id: 'hunt', segments: 3,
      onFilled: [{ type: 'combat', enemies: ['goblin'] }],
    }],
  });
  data.scenes.cave.options.push({ text: 'Tick', actions: [{ type: 'advance_clock', id: 'hunt' }] });
  data.scenes.cave.options.push({ text: 'Ghost', actions: [{ type: 'advance_clock', id: 'never_started' }] });
  data.scenes.cave.options.push({ text: 'Bad', actions: [{ type: 'start_clock', segments: 0 }] });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('"combat" is not allowed in onFilled')));
  assert.ok(messages.some(m => m.includes('start_clock needs an "id"')));
  assert.ok(messages.some(m => m.includes('needs a positive "segments"')));
  assert.ok(messages.some(m => m.includes('clock "never_started" is advanced or checked')));
  assert.ok(!messages.some(m => m.includes('clock "hunt" is advanced or checked')), 'started clock should not be flagged');
});

test('flags unsafe actions inside timer pipelines and missing timer ids', () => {
  const data = makeToolkitData();
  data.scenes.cave.options.push({
    text: 'Arm',
    actions: [
      { type: 'set_timer', id: 'alarm', afterTicks: 5, actions: [{ type: 'combat', enemies: ['goblin'] }] },
      { type: 'set_timer', afterTicks: 5, actions: [] },
    ],
  });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('not allowed in timer pipelines')));
  assert.ok(messages.some(m => m.includes('set_timer needs an "id"')));
});

test('flags advance_time to an unknown segment', () => {
  const data = makeToolkitData();
  data.scenes.cave.options.push({ text: 'Nap', actions: [{ type: 'advance_time', until: 'dusk' }] });
  assert.ok(issuesFor(data).some(m => m.includes('unknown segment "dusk"')));
});

test('flags day/segment conditions without time config and unknown segments', () => {
  const data = makeToolkitData();
  data.scenes.cave.options.push({ text: 'X', condition: { segment: 'dusk' }, actions: [] });
  assert.ok(issuesFor(data).some(m => m.includes('unknown segment "dusk"')));

  const noTime = makeToolkitData();
  delete noTime.rules.time;
  noTime.scenes.cave.options.push({ text: 'X', condition: { day: { at_least: 2 } }, actions: [] });
  noTime.scenes.cave.options.push({ text: 'Y', condition: { segment: 'morning' }, actions: [] });
  const messages = issuesFor(noTime);
  assert.ok(messages.some(m => m.includes('uses "day" but rules.time.ticksPerDay')));
  assert.ok(messages.some(m => m.includes('uses "segment" but rules.time.segments')));
});

test('flags luck knobs and restore_luck in games without the luck resource', () => {
  const data = makeToolkitData();
  delete data.rules.playerDefaults.resources;
  data.rules.luck = { retryCost: 1, combat: true };
  data.scenes.cave.options.push({ text: 'Pray', actions: [{ type: 'restore_luck', amount: 1 }] });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('luck.retryCost is set but')));
  assert.ok(messages.some(m => m.includes('luck.combat is set but')));
  assert.ok(messages.some(m => m.includes('restore_luck without a luck resource')));
});

test('normalizeRules folds legacy luck knobs under rules.luck; validator flags the old keys', () => {
  const rules = { skillRetryLuckCost: 2, combatLuck: true, luck: { retryCost: 5 } };
  normalizeRules(rules);
  assert.equal(rules.luck.retryCost, 5);   // existing nested value wins
  assert.equal(rules.luck.combat, true);   // legacy value adopted

  const data = makeToolkitData();
  data.rules.combatLuck = true;
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('"combatLuck" moved to rules.luck.combat')));
});

test('flags malformed time config: bad segments, ranges, costs, locale entries', () => {
  const data = makeToolkitData();
  data.rules.time.segments.push({ id: 'ghost', from: 99 });
  data.rules.time.defaultCosts.teleport = 1;
  data.rules.time.defaultCosts.navigate = -1;
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('"from" (99) must be within')));
  assert.ok(messages.some(m => m.includes('missing locale entry at time.segments.ghost')));
  assert.ok(messages.some(m => m.includes('unknown kind "teleport"')));
  assert.ok(messages.some(m => m.includes('defaultCosts.navigate: must be a non-negative number')));
});

test('flags passive checks without a flag or skillCheck', () => {
  const data = makeToolkitData();
  data.scenes.cave.passiveChecks = [
    { skillCheck: 'perception', dc: 10 },
    { dc: 10, flag: 'noticed' },
  ];
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('missing "flag"')));
  assert.ok(messages.some(m => m.includes('missing "skillCheck"')));
});

test('reserved condition keys now include the time and luck leaves', () => {
  const data = makeToolkitData();
  data.rules.customAttributes.push({ id: 'segment', default: 0 });
  data.locale.actions.skillBadge.segment = 'SEG {dc}';
  assert.ok(issuesFor(data).some(m => m.includes('"segment": name is reserved')));
});
