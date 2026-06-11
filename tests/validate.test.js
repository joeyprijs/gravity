import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGameData } from '../src/core/validate.js';

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
      playerDefaults: { attributes: { ac: 10 } },
      customAttributes: [{ id: 'perception', default: 0 }],
      fallbackWeapons: { player: 'sword', enemy: 'sword' },
    },
    locale: { actions: { skillBadge: { perception: 'PER {dc}' } } },
  };
}

function validate(data) {
  return validateGameData(data, KNOWN_ACTIONS);
}

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
