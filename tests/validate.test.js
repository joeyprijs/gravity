import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCarriedItems, validateGameData } from '../src/core/validate.js';

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
    locale: { actions: { skillBadge: { perception: 'PER {dc}' }, skillBadgeFree: { perception: 'Perception' }, skillBadgeDc: 'DC {dc}' } },
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

// ── Engagement-toolkit validations (outcomes, time, timers, passive) ──────────

const TOOLKIT_ACTIONS = new Set([...KNOWN_ACTIONS, 'advance_time', 'set_timer', 'cancel_timer', 'log']);

// Extends the clean fixture with time configuration so the toolkit checks
// have their backing config; tests then break specific pieces.
function makeToolkitData() {
  const data = makeCleanData();
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

test('flags luckCheck as a removed mechanic', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills.push({ text: 'Gamble', luckCheck: true });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('"luckCheck" (the 2d6 Test-Your-Luck gamble) was removed')));
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

test('flags the removed luck subsystem rules keys and the restore_luck action', () => {
  const data = makeToolkitData();
  data.rules.luck = { retryCost: 1 };
  data.rules.combatLuck = true;
  data.rules.playerDefaults.resources = { luck: { current: 7, max: 9 } };
  data.scenes.cave.options.push({ text: 'Pray', actions: [{ type: 'restore_luck', amount: 1 }] });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('rules.luck belongs to the removed 2d6 luck subsystem')));
  assert.ok(messages.some(m => m.includes('rules.combatLuck belongs to the removed 2d6 luck subsystem')));
  assert.ok(messages.some(m => m.includes('playerDefaults.resources.luck belongs to the removed 2d6 luck subsystem')));
  assert.ok(messages.some(m => m.includes('"restore_luck" was removed')));
});


test('flags a farmable check: success loots but nothing retires it', () => {
  const data = makeToolkitData();
  data.scenes.cave.skills.push({
    text: 'Dig', skillCheck: 'perception', dc: 12,
    outcomes: { success: { actions: [{ type: 'loot', item: 'potion' }] } },
  });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('can be re-rolled for duplicates')));

  // Self-gated version passes: success sets the flag the condition requires false.
  const gated = makeToolkitData();
  gated.scenes.cave.skills.push({
    text: 'Dig', skillCheck: 'perception', dc: 12,
    condition: { and: [{ flag: 'dug', value: false }] },
    outcomes: { success: { actions: [
      { type: 'set_flag', flag: 'dug', value: true },
      { type: 'loot', item: 'potion' },
    ] } },
  });
  assert.ok(!issuesFor(gated).some(m => m.includes('can be re-rolled for duplicates')));

  // resolveOnce also passes.
  const once = makeToolkitData();
  once.scenes.cave.skills.push({
    text: 'Dig', skillCheck: 'perception', dc: 12, resolveOnce: true,
    outcomes: { success: { actions: [{ type: 'loot', item: 'potion' }] } },
  });
  assert.ok(!issuesFor(once).some(m => m.includes('can be re-rolled for duplicates')));
});

test('skillRetry: flags an undeclared resource, bad cost, and negative restRestore', () => {
  const data = makeToolkitData();
  data.rules.skillRetry = { resource: 'luckPoints', cost: 0, restRestore: -1 };
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('skillRetry.resource "luckPoints" is not a declared')));
  assert.ok(messages.some(m => m.includes('skillRetry.cost must be a positive number')));
  assert.ok(messages.some(m => m.includes('skillRetry.restRestore must be a non-negative number')));
});

test('skillRetry + headerResources: clean when the resource is declared with a label', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.resources = { luckPoints: { current: 3, max: 3 } };
  data.rules.skillRetry = { resource: 'luckPoints', cost: 1, restRestore: 3 };
  data.rules.headerResources = ['luckPoints'];
  data.locale.ui = { resources: { luckPoints: 'Luck' } };
  data.locale.actions.badgeRetryCost = 'Retry: {cost} {resource}';
  const messages = issuesFor(data);
  assert.ok(!messages.some(m => m.includes('skillRetry')));
  assert.ok(!messages.some(m => m.includes('headerResources')));
});

test('flags missing skillBadgeDc, missing badgeRetryCost, and a tabs list without an options widget', () => {
  const data = makeToolkitData();
  delete data.locale.actions.skillBadgeDc;
  data.rules.playerDefaults.resources = { luckPoints: { current: 3, max: 3 } };
  data.rules.skillRetry = { resource: 'luckPoints', cost: 1 };
  data.locale.ui = { resources: { luckPoints: 'Luck' } };
  data.rules.tabs = [{ id: 'inventory-tab', localeKey: 'ui.tabInventory' }];
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('missing locale entry at actions.skillBadgeDc')));
  assert.ok(messages.some(m => m.includes('missing locale entry at actions.badgeRetryCost')));
  assert.ok(messages.some(m => m.includes('no tab with widget "options"')));
});

test('headerResources: flags an undeclared resource and a missing label', () => {
  const data = makeToolkitData();
  data.rules.headerResources = ['luckPoints'];
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('headerResources "luckPoints" is not a declared')));
  assert.ok(messages.some(m => m.includes('missing locale entry at ui.resources.luckPoints')));
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

test('apEconomy: flags bad values and the no-recovery configuration', () => {
  const data = makeToolkitData();
  data.rules.apEconomy = { refillPerRound: -1, restRestore: 'lots', minPerTurn: -2 };
  let messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('apEconomy.refillPerRound must be')));
  assert.ok(messages.some(m => m.includes('apEconomy.restRestore must be')));
  assert.ok(messages.some(m => m.includes('apEconomy.minPerTurn must be')));

  // Stranding is per-fight: no per-round income and no floor warns even with
  // out-of-combat recovery left at its defaults.
  data.rules.apEconomy = { refillPerRound: 0 };
  messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('refillPerRound 0 with no minPerTurn floor')));

  data.rules.apEconomy = { refillPerRound: 0, minPerTurn: 1 };
  messages = issuesFor(data);
  assert.ok(!messages.some(m => m.includes('refillPerRound 0 with no minPerTurn floor')));
});

test('apEconomy: warns when maxPerTurn is below every weapon cost', () => {
  const data = makeToolkitData();
  data.items.sword = { name: 'Sword', type: 'Weapon', attributes: { actionPoints: 3 } };
  data.rules.apEconomy = { maxPerTurn: 2 };
  assert.ok(issuesFor(data).some(m => m.includes('below every weapon/spell AP cost')));
});

test('warns when every weapon and spell costs 0 AP', () => {
  const data = makeToolkitData();
  data.items.stick = { name: 'Stick', type: 'Weapon', attributes: { actionPoints: 0 } };
  assert.ok(issuesFor(data).some(m => m.includes('combat turns will never end automatically')));
});

test('modify_resource: flags a missing or undeclared resource; declared is clean', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.resources = { hp: { current: 10, max: 10 }, luckPoints: { current: 3, max: 3 } };
  data.scenes.cave.options.push(
    { text: 'Pray', actions: [{ type: 'modify_resource', amount: 1 }] },
    { text: 'Tithe', actions: [{ type: 'modify_resource', resource: 'gold', amount: -5 }] },
    { text: 'Wish', actions: [{ type: 'modify_resource', resource: 'luckPoints', amount: 1 }] },
  );
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('modify_resource needs a "resource"')));
  assert.ok(messages.some(m => m.includes('resource "gold" is not a declared')));
  assert.ok(!messages.some(m => m.includes('"luckPoints" is not a declared')));
});

test('flags bad levelUp.statPoints, customAttributes max, and item attribute references', () => {
  const data = makeToolkitData();
  data.rules.levelUp = { statPoints: -1 };
  data.rules.customAttributes.push({ id: 'grit', default: 3, max: 1 });
  data.locale.actions.skillBadge.grit = 'Grit {dc}';
  data.locale.actions.skillBadgeFree.grit = 'Grit';
  data.items.wand = { name: 'Wand', type: 'Spell', attributes: { attackAttribute: 'sorcery' } };
  data.items.oldWand = { name: 'Old Wand', type: 'Spell', attackAttribute: 'perception' };
  data.items.ring = { name: 'Ring', type: 'Armor', attributes: { attributeBonuses: { agility: 1 } } };
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('levelUp.statPoints must be a non-negative integer')));
  assert.ok(messages.some(m => m.includes('"grit": max must be a number')));
  assert.ok(messages.some(m => m.includes('attackAttribute "sorcery" is not a declared attribute')));
  assert.ok(messages.some(m => m.includes('attackAttribute moved into the attributes object')));
  assert.ok(messages.some(m => m.includes('attributeBonuses key "agility" is not a declared attribute')));
});

test('flags a combat NPC whose weapon attackAttribute is missing from its stat block', () => {
  const data = makeToolkitData();
  data.items.wand = { name: 'Wand', type: 'Spell', attributes: { attackAttribute: 'perception' } };
  data.npcs.goblin.equipment = { 'Right Hand': 'wand' };
  assert.ok(issuesFor(data).some(m => m.includes('declares no perception attribute')));

  // Declaring the attribute clears the warning.
  data.npcs.goblin.attributes.perception = 2;
  assert.ok(!issuesFor(data).some(m => m.includes('declares no perception attribute')));
});

test('flags fractional levelUp.statPoints', () => {
  const data = makeToolkitData();
  data.rules.levelUp = { statPoints: 0.5 };
  assert.ok(issuesFor(data).some(m => m.includes('levelUp.statPoints must be a non-negative integer')));
});

test('flags an unknown item type and an undeclared equipment slot', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.equipment = { 'Head': null, 'Right Hand': null };
  data.items.gizmo = { name: 'Gizmo', type: 'Widget' };            // unknown type
  data.items.hat = { name: 'Hat', type: 'Armor', slot: 'Face' };   // undeclared slot
  data.items.helm = { name: 'Helm', type: 'Armor', slot: 'Head' }; // declared — clean
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('type "Widget" is not a known item type')));
  assert.ok(messages.some(m => m.includes('slot "Face" is not a declared equipment slot')));
  assert.ok(!messages.some(m => m.includes('slot "Head"')));       // a declared slot is clean
});

test('item type and slot: valid values and omitted fields pass', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.equipment = { 'Right Hand': null };
  data.items.blade = { name: 'Blade', type: 'Weapon', slot: 'Right Hand' };
  data.items.trinket = { name: 'Trinket' };  // no type, no slot — a Flavour keepsake
  const messages = issuesFor(data);
  assert.ok(!messages.some(m => m.includes('is not a known item type')));
  assert.ok(!messages.some(m => m.includes('is not a declared equipment slot')));
});
