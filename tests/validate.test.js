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
        equipment: { right_hand: 'sword' },
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
      playerDefaults: {
        attributes: { ac: 10 },
        equipmentSlots: [
          { id: 'head', kind: 'head' },
          { id: 'left_hand', kind: 'hand' },
          { id: 'right_hand', kind: 'hand' },
          { id: 'left_ring', kind: 'ring' },
          { id: 'right_ring', kind: 'ring' },
        ],
      },
      customAttributes: [{ id: 'perception', default: 0 }],
      fallbackWeapons: { player: 'sword', enemy: 'sword' },
    },
    locale: {
      actions: { skillBadge: { perception: 'PER {dc}' }, skillBadgeFree: { perception: 'Perception' }, skillBadgeDc: 'DC {dc}' },
      ui: { equipmentSlots: { head: 'Head', left_hand: 'Left Hand', right_hand: 'Right Hand', left_ring: 'Left Ring', right_ring: 'Right Ring' } },
      itemStats: { slotKinds: { head: 'Head', hand: 'Hand', ring: 'Ring' } },
    },
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

test('flags a farmable gift node, per route in — a guard one step up is not enough', () => {
  // Node actions re-run on every visit, so a second way back into a node that
  // hands over an item is a second copy of it. The guard has to sit on the
  // responses that reach the node: gating the route *into* the response's own
  // node covers only that path, which is how Halda's token got duplicated.
  const data = makeToolkitData();
  data.npcs.elder.conversations.gift = {
    npcText: 'Take this.',
    actions: [
      { type: 'loot', item: 'potion' },
      { type: 'set_flag', flag: 'gifted', value: true },
    ],
    responses: [{ text: 'Thanks.', actions: [{ type: 'leave' }] }],
  };
  data.npcs.elder.conversations.more.responses.push(
    { text: 'Anything for me?', actions: [{ type: 'goToConversation', node: 'gift' }] });

  assert.ok(issuesFor(data).some(m => m.includes('reaches gift node "gift" ungated')));

  // Gated on a flag the gift node's own actions set: clean.
  const gated = makeToolkitData();
  gated.npcs.elder.conversations.gift = data.npcs.elder.conversations.gift;
  gated.npcs.elder.conversations.more.responses.push({
    text: 'Anything for me?',
    condition: { not: { flag: 'gifted', value: true } },
    actions: [{ type: 'goToConversation', node: 'gift' }],
  });
  assert.ok(!issuesFor(gated).some(m => m.includes('ungated')));

  // A second route in must carry its own guard — the whole point.
  const twoRoutes = makeToolkitData();
  twoRoutes.npcs.elder.conversations.gift = data.npcs.elder.conversations.gift;
  twoRoutes.npcs.elder.conversations.more.responses.push({
    text: 'Anything for me?',
    condition: { not: { flag: 'gifted', value: true } },
    actions: [{ type: 'goToConversation', node: 'gift' }],
  });
  twoRoutes.npcs.elder.conversations.start.responses.push(
    { text: 'Back again.', actions: [{ type: 'goToConversation', node: 'gift' }] });
  assert.ok(issuesFor(twoRoutes).some(m => m.includes('response "Back again." reaches gift node "gift" ungated')));

  // A gift on the start node has no response to gate: saying hello displays it,
  // so it hands the item over on every conversation and the per-route check
  // above would never see it.
  const onStart = makeToolkitData();
  onStart.npcs.elder.conversations.start.actions = [{ type: 'loot', item: 'potion' }];
  assert.ok(issuesFor(onStart).some(m => m.includes('every time the player talks to this NPC')));

  // Paying gold out is not a gift.
  const payment = makeToolkitData();
  payment.npcs.elder.conversations.gift = {
    npcText: 'Five coins.',
    actions: [{ type: 'loot', item: 'gold', amount: -5 }],
    responses: [{ text: 'Done.', actions: [{ type: 'leave' }] }],
  };
  payment.npcs.elder.conversations.more.responses.push(
    { text: 'A room, please.', actions: [{ type: 'goToConversation', node: 'gift' }] });
  assert.ok(!issuesFor(payment).some(m => m.includes('ungated')));
});

test('flags an interior scene with no map geometry, by scene flag or by region', () => {
  // A building is drawn from its rooms' geometry. One with none can never be
  // placed, and the map silently omits it — so the validator has to say it.
  const data = makeToolkitData();
  data.scenes.hut = { title: 'Hut', interior: true };
  assert.ok(issuesFor(data).some(m => m.includes('marked interior but has no mapDefinitions')));

  const viaRegion = makeToolkitData();
  viaRegion.regions = { keep: { name: 'The Keep', interior: true } };
  viaRegion.scenes.hall = { title: 'Hall', region: 'keep' };
  assert.ok(issuesFor(viaRegion).some(m => m.includes('marked interior (region "keep") but has no mapDefinitions')));

  // With geometry, or not interior at all: clean.
  const placed = makeToolkitData();
  placed.scenes.hut = { title: 'Hut', interior: true, mapDefinitions: { top: 0, left: 0, width: 10, height: 10 } };
  assert.ok(!issuesFor(placed).some(m => m.includes('no mapDefinitions')));
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
  data.rules.headerResources = [{ id: 'luckPoints', icon: 'star' }];
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

test('headerResources: flags an undeclared resource, a missing label, and an unknown icon', () => {
  const data = makeToolkitData();
  data.rules.headerResources = [{ id: 'luckPoints', icon: 'horseshoe' }];
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('headerResources "luckPoints" is not a declared')));
  assert.ok(messages.some(m => m.includes('missing locale entry at ui.resources.luckPoints')));
  assert.ok(messages.some(m => m.includes('icon "horseshoe" is not a known icon')));
});

test('icons: flags a bare headerResources id, an unknown tab icon, and an unknown skill icon', () => {
  const data = makeToolkitData();
  data.rules.headerResources = ['luckPoints'];
  data.rules.tabs = [
    { id: 'ghost-tab', localeKey: 'ui.tabMap', icon: 'ghost' },
    { id: 'options-tab', localeKey: 'ui.tabOptions', widget: 'options' },
  ];
  data.rules.customAttributes[0].icon = 'third-eye';
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('headerResources entries are { "id", "icon" } objects')));
  assert.ok(messages.some(m => m.includes('tabs "ghost-tab": icon "ghost" is not a known icon')));
  assert.ok(messages.some(m => m.includes('customAttributes "perception": icon "third-eye" is not a known icon')));
});

test('icons: a known name on a tab, a header resource, and a skill is clean', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.resources = { luckPoints: { current: 3, max: 3 } };
  data.rules.headerResources = [{ id: 'luckPoints', icon: 'star' }];
  data.rules.customAttributes[0].icon = 'eye';
  data.locale.ui = { resources: { luckPoints: 'Luck' } };
  const messages = issuesFor(data);
  assert.ok(!messages.some(m => m.includes('is not a known icon')));
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

test('warns when every weapon and spell costs 0 AP', () => {
  const data = makeToolkitData();
  data.items.stick = { name: 'Stick', type: 'Weapon', attributes: { actionPoints: 0 } };
  assert.ok(issuesFor(data).some(m => m.includes('combat turns will never end automatically')));
});

test('levelUpHpBonus: optional, but a malformed value is flagged', () => {
  const clean = makeToolkitData();
  delete clean.rules.levelUpHpBonus;
  assert.ok(!issuesFor(clean).some(m => m.includes('levelUpHpBonus')), 'omitting it is a valid choice');

  const bad = makeToolkitData();
  bad.rules.levelUpHpBonus = '5';
  assert.ok(issuesFor(bad).some(m => m.includes('levelUpHpBonus must be a number')));
});

test('shortRest: pool must be a declared resource, never hp/ap; heal sanity-checked', () => {
  const ok = makeToolkitData();
  ok.rules.playerDefaults.resources = { shortRests: { current: 3, max: 3 } };
  ok.rules.shortRest = { resource: 'shortRests', heal: '1d8' };
  assert.ok(!issuesFor(ok).some(m => m.includes('shortRest')), 'a well-formed config passes');

  const undeclared = makeToolkitData();
  undeclared.rules.shortRest = { resource: 'shortRests' };
  assert.ok(issuesFor(undeclared).some(m => m.includes('not a declared { current, max } resource')));

  const spendsAp = makeToolkitData();
  spendsAp.rules.shortRest = { resource: 'ap' };
  assert.ok(issuesFor(spendsAp).some(m => m.includes('shortRest.resource cannot be "ap"')));

  const badHeal = makeToolkitData();
  badHeal.rules.playerDefaults.resources = { shortRests: { current: 3, max: 3 } };
  badHeal.rules.shortRest = { resource: 'shortRests', heal: -2 };
  assert.ok(issuesFor(badHeal).some(m => m.includes('shortRest.heal')));
});

test('flags bad levelUp.statPoints, customAttributes max, and item attribute references', () => {
  const data = makeToolkitData();
  data.rules.levelUp = { statPoints: -1 };
  data.rules.customAttributes.push({ id: 'grit', default: 3, max: 1 });
  data.locale.actions.skillBadge.grit = 'Grit {dc}';
  data.locale.actions.skillBadgeFree.grit = 'Grit';
  data.items.wand = { name: 'Wand', type: 'Spell', attributes: { attackAttribute: 'sorcery', damageAttribute: 'willpower' } };
  data.items.ring = { name: 'Ring', type: 'Armor', attributes: { attributeBonuses: { agility: 1 } } };
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('levelUp.statPoints must be a non-negative integer')));
  assert.ok(messages.some(m => m.includes('"grit": max must be a number')));
  assert.ok(messages.some(m => m.includes('attackAttribute "sorcery" is not a declared attribute')));
  assert.ok(messages.some(m => m.includes('damageAttribute "willpower" is not a declared attribute')));
  assert.ok(messages.some(m => m.includes('attributeBonuses key "agility" is not a declared attribute')));

  // targets: "all" and a cap >= 2 pass; anything else is flagged.
  const badTargets = makeToolkitData();
  badTargets.items.bomb = { name: 'Bomb', type: 'Weapon', attributes: { targets: 1 } };
  badTargets.items.storm = { name: 'Storm', type: 'Spell', attributes: { targets: 'everyone' } };
  badTargets.items.burst = { name: 'Burst', type: 'Spell', attributes: { targets: 3 } };
  badTargets.items.quake = { name: 'Quake', type: 'Spell', attributes: { targets: 'all' } };
  const targetIssues = issuesFor(badTargets).filter(m => m.includes('targets must be "all" or an integer >= 2'));
  assert.ok(targetIssues.some(m => m.includes('(got 1)')));
  assert.ok(targetIssues.some(m => m.includes('(got "everyone")')));
  assert.equal(targetIssues.length, 2, 'the valid cap and "all" pass');
});

test('flags a combat NPC whose weapon attackAttribute is missing from its stat block', () => {
  const data = makeToolkitData();
  data.items.wand = { name: 'Wand', type: 'Spell', attributes: { attackAttribute: 'perception', damageAttribute: 'charisma' } };
  data.npcs.goblin.equipment = { right_hand: 'wand' };
  assert.ok(issuesFor(data).some(m => m.includes('(attackAttribute "perception") but declares no perception attribute')));
  assert.ok(issuesFor(data).some(m => m.includes('(damageAttribute "charisma") but declares no charisma attribute')));

  // Declaring the attributes clears the warnings.
  data.npcs.goblin.attributes.perception = 2;
  data.npcs.goblin.attributes.charisma = 1;
  assert.ok(!issuesFor(data).some(m => m.includes('declares no perception attribute')));
  assert.ok(!issuesFor(data).some(m => m.includes('declares no charisma attribute')));
});

test('flags an unknown item type and a slot kind no slot declares', () => {
  const data = makeToolkitData();
  data.items.gizmo = { name: 'Gizmo', type: 'Widget' };            // unknown type
  data.items.hat = { name: 'Hat', type: 'Armor', slot: 'face' };   // no slot of that kind
  data.items.helm = { name: 'Helm', type: 'Armor', slot: 'head' }; // declared — clean
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('type "Widget" is not a known item type')));
  assert.ok(messages.some(m => m.includes('slot "face" is not a declared equipment slot kind')));
  assert.ok(!messages.some(m => m.includes('slot "head"')));       // a declared kind is clean
});

test('item type and slot: valid values and omitted fields pass', () => {
  const data = makeToolkitData();
  data.items.blade = { name: 'Blade', type: 'Weapon' };  // the type implies the hand kind
  data.items.trinket = { name: 'Trinket' };              // no type, no slot — a Flavour keepsake
  const messages = issuesFor(data);
  assert.ok(!messages.some(m => m.includes('is not a known item type')));
  assert.ok(!messages.some(m => m.includes('is not a declared equipment slot')));
});

test('equipmentSlots: flags a missing list, a duplicate id, and no hand to fight with', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.equipmentSlots = [
    { id: 'head', kind: 'head' },
    { id: 'head', kind: 'head' },
    { id: 'trinket' },
  ];
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('duplicate slot id "head"')));
  assert.ok(messages.some(m => m.includes('"trinket": missing kind')));
  assert.ok(messages.some(m => m.includes('no slot of kind "hand"')),
    'a game with nowhere to hold a weapon can never render an attack');

  delete data.rules.playerDefaults.equipmentSlots;
  assert.ok(issuesFor(data).some(m => m.includes('equipmentSlots must be a non-empty array')));
});

test('equipmentSlots: flags a slot or kind the locale cannot name', () => {
  const data = makeToolkitData();
  data.rules.playerDefaults.equipmentSlots.push({ id: 'tail', kind: 'tail' });
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('missing locale entry at ui.equipmentSlots.tail')));
  assert.ok(messages.some(m => m.includes('missing locale entry at itemStats.slotKinds.tail')));
});

test('NPC equipment names a slot id, not a kind', () => {
  const data = makeToolkitData();
  data.npcs.goblin.equipment = { hand: 'sword' };  // the kind, not one of its slots
  assert.ok(issuesFor(data).some(m => m.includes('equipment["hand"] is not a declared equipment slot')));
});

test('grantsSpells: flags an unknown id and a grant that is not a Spell', () => {
  const data = makeToolkitData();
  data.items.bolt = { name: 'Bolt', type: 'Spell', attributes: { damageRoll: '1d6', actionPoints: 1 } };
  data.items.rope = { name: 'Rope', type: 'Special' };
  data.items.circlet = { name: 'Circlet', type: 'Armor', attributes: { grantsSpells: ['bolt', 'ghost', 'rope'] } };
  const messages = issuesFor(data);
  assert.ok(messages.some(m => m.includes('grantsSpells → unknown item "ghost"')));
  assert.ok(messages.some(m => m.includes('grantsSpells → "rope" is type "Special", not "Spell"')));
  assert.ok(!messages.some(m => m.includes('"bolt"')), 'a real Spell is clean');
});

test('missions: flags duplicate stage ids, missing fields, and bad advanceWhen references', () => {
  const data = makeCleanData();
  data.missions.escape.stages = [
    { id: 'a', description: 'A.', advanceWhen: { item: 'ghost' } },
    { id: 'a', description: 'B.' },
    { description: 'C.' },
  ];
  const issues = validate(data);
  assert.ok(issues.some(i => i.group === 'Mission "escape"' && i.message.includes('duplicate stage id "a"')));
  assert.ok(issues.some(i => i.message.includes('unknown item "ghost"')));
  assert.ok(issues.some(i => i.message.includes('stage #3: missing "id"')));
});

test('questTrigger: validated in scene blocks and action pipelines', () => {
  const data = makeCleanData();
  data.scenes.cave.questTrigger = { mission: 'ghost_quest', status: 'done' };
  data.scenes.exit.options.push({ text: 'Advance', actions: [{ type: 'questTrigger', mission: 'escape', stage: 'ghost_stage' }] });
  normalizeCarriedItems(data.npcs);
  const issues = validateGameData(data, new Set([...KNOWN_ACTIONS, 'questTrigger']));
  assert.ok(issues.some(i => i.message.includes('unknown mission "ghost_quest"')));
  assert.ok(issues.some(i => i.message.includes('unknown status "done"')));
  assert.ok(issues.some(i => i.message.includes('unknown stage "ghost_stage" on mission "escape"')));
});

test('conditions: unknown stage references and stage+status combos are flagged', () => {
  const data = makeCleanData();
  data.missions.escape.stages = [{ id: 'a', description: 'A.' }];
  data.scenes.cave.options[0].condition = { mission: 'escape', stage: 'ghost' };
  data.scenes.exit.options = [{ text: 'x', condition: { mission: 'escape', stage: 'a', status: 'active' }, actions: [] }];
  const issues = validate(data);
  assert.ok(issues.some(i => i.message.includes('unknown stage "ghost" on mission "escape"')));
  assert.ok(issues.some(i => i.message.includes('both "stage" and "status"')));
});

// ── story books ───────────────────────────────────────────────────────────────

test('story books: bad chapter shapes and a mismatched type are flagged', () => {
  const data = makeCleanData();
  data.items.diary = {
    name: 'Diary', type: 'Flavour',
    story: { chapters: [{ id: 'a', text: 'A.' }, { id: 'a' }] },
  };
  const issues = validate(data);
  assert.ok(issues.some(i => i.message.includes('duplicate chapter id "a"')));
  assert.ok(issues.some(i => i.message.includes('missing "text"')));
  assert.ok(issues.some(i => i.message.includes('type "Flavour"')), 'a story must live on a Book');

  data.items.diary = { name: 'Diary', type: 'Book', story: { chapters: [] } };
  assert.ok(validate(data).some(i => i.message.includes('non-empty array')));

  data.items.diary = { name: 'Diary', type: 'Book' };
  assert.ok(validate(data).some(i => i.message.includes('declares no story')), 'a Book must hold a story');
});

test('grant_chapter and story conditions: unknown books and chapters are flagged', () => {
  const data = makeCleanData();
  data.items.diary = { name: 'Diary', type: 'Book', story: { chapters: [{ id: 'a', text: 'A.' }] } };
  data.scenes.cave.options[0].actions = [
    { type: 'grant_chapter', item: 'ghost', chapter: 'a' },
    { type: 'grant_chapter', item: 'sword', chapter: 'a' },
    { type: 'grant_chapter', item: 'diary', chapter: 'ghost' },
    { type: 'grant_chapter', item: 'diary' }, // the grant-everything form — valid
  ];
  data.scenes.exit.options.push(
    { text: 'x', condition: { story: 'sword', chapter: 'a' }, actions: [] },
    { text: 'y', condition: { story: 'diary' }, actions: [] },
  );
  data.npcs.elder.conversations.start.responses[0].condition = { story: 'diary', chapter: 'ghost' };
  normalizeCarriedItems(data.npcs);
  const issues = validateGameData(data, new Set([...KNOWN_ACTIONS, 'grant_chapter']));
  assert.ok(issues.some(i => i.message.includes('grant_chapter → unknown item "ghost"')));
  assert.ok(issues.some(i => i.message.includes('"sword" declares no story')));
  assert.ok(issues.some(i => i.message.includes('grant_chapter → unknown chapter "ghost" on "diary"')));
  assert.ok(!issues.some(i => i.message.includes('"undefined"')),
    'omitting the chapter is the grant-everything form, not a mistake');
  assert.ok(issues.some(i => i.message.includes('not a story book item')));
  assert.ok(issues.some(i => i.message.includes('needs a "chapter"')));
  assert.ok(issues.some(i => i.message.includes('unknown chapter "ghost" on story "diary"')));
});
