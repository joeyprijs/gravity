import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { QuestSystem } from '../src/systems/quests.js';
import { MISSION_STATUS } from '../src/core/config.js';

// Staged-quest invariants: one-way advancement, observed advanceWhen
// conditions (including the met-the-quest-giver-late instant chain), terminal
// complete/failed, and reward accounting.

// xpPerLevel is set high so reward XP stays additive — no level-up math in
// the assertions.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  xpPerLevel: 10000,
  levelUpHpBonus: 0,
};

// A Bron-shaped mission: collect two of an item, then report back.
const makeShardMission = () => ({
  fetch_quest: {
    name: 'Fetch',
    description: 'Collect the things.',
    stages: [
      { id: 'collect', description: 'Collect 2 shards.', advanceWhen: { item: 'shard', count: 2 }, rewards: { xp: 25 } },
      { id: 'report', description: 'Report back.' },
    ],
    missionRewards: { xp: 75, gold: 50 },
  },
});

function makeQuestSystem(missions) {
  const logs = [];
  const engine = {
    data: { missions },
    state: gameState,
    t: (key, params = {}) => [key, params.name, params.description].filter(Boolean).join('|'),
    log: (type, message, variant) => logs.push({ type, message, variant }),
    on: () => {}, // scene:entered — not exercised headless
  };
  gameState.registerMissions(missions);
  return { qs: new QuestSystem(engine), logs };
}

beforeEach(() => {
  // Each QuestSystem subscribes a mutation hook on the module singleton;
  // start every test with a clean bus so hooks from prior tests (bound to
  // prior mission data) can't advance this test's state.
  gameState._mutationHooks = [];
  gameState.init(TEST_RULES);
});

test('stageless missions keep the old contract: activate once, complete is terminal', () => {
  const missions = { escape: { name: 'Escape', description: 'Get out.', missionRewards: { xp: 100, gold: 50 } } };
  const { qs, logs } = makeQuestSystem(missions);

  assert.equal(qs.handleTrigger({ mission: 'escape', status: 'active' }), true);
  assert.equal(gameState.getMissionStatus('escape'), MISSION_STATUS.ACTIVE);
  // Re-activation is a no-op (no duplicate started log).
  assert.equal(qs.handleTrigger({ mission: 'escape', status: 'active' }), false);
  assert.equal(logs.filter(l => l.message.startsWith('quest.started')).length, 1);

  assert.equal(qs.handleTrigger({ mission: 'escape', status: 'complete' }), true);
  assert.equal(gameState.getPlayer().xp, 100);
  assert.equal(gameState.getPlayer().resources.gold, 50);
  // Terminal: nothing moves a completed mission, and rewards never re-grant.
  assert.equal(qs.handleTrigger({ mission: 'escape', status: 'complete' }), false);
  assert.equal(qs.handleTrigger({ mission: 'escape', status: 'active' }), false);
  assert.equal(gameState.getPlayer().xp, 100);
});

test('activation starts on the first stage and logs the quest description', () => {
  const { qs, logs } = makeQuestSystem(makeShardMission());
  qs.handleTrigger({ mission: 'fetch_quest', status: 'active' });
  assert.equal(gameState.getMissionStage('fetch_quest'), 'collect');
  assert.ok(logs.some(l => l.message === 'quest.started|Fetch|Collect the things.'));
});

test('advanceWhen satisfied at activation chains instantly (quest-giver met late)', () => {
  const { qs } = makeQuestSystem(makeShardMission());
  gameState.addToInventory('shard', 2);
  qs.handleTrigger({ mission: 'fetch_quest', status: 'active' });
  assert.equal(gameState.getMissionStage('fetch_quest'), 'report');
  assert.equal(gameState.getPlayer().xp, 25, 'the collect stage completed and paid out');
});

test('advanceWhen is observed on mutations, and advancement never regresses', () => {
  const { qs, logs } = makeQuestSystem(makeShardMission());
  qs.handleTrigger({ mission: 'fetch_quest', status: 'active' });

  gameState.addToInventory('shard', 1);
  assert.equal(gameState.getMissionStage('fetch_quest'), 'collect', 'one of two is not enough');
  gameState.addToInventory('shard', 1);
  assert.equal(gameState.getMissionStage('fetch_quest'), 'report');
  assert.ok(logs.some(l => l.message === 'quest.stageAdvanced|Fetch|Report back.'));

  // Recorded, not continuously required: losing the shards changes nothing.
  gameState.removeFromInventory('shard', 2);
  assert.equal(gameState.getMissionStage('fetch_quest'), 'report');
  assert.equal(gameState.getPlayer().xp, 25, 'stage rewards granted exactly once');
});

test('a flag write satisfies advanceWhen (setFlag reaches the mutation bus)', () => {
  const missions = {
    m: {
      name: 'M', description: 'd',
      stages: [
        { id: 'a', description: 'a.', advanceWhen: { flag: 'done', value: true } },
        { id: 'b', description: 'b.' },
      ],
    },
  };
  const { qs } = makeQuestSystem(missions);
  qs.handleTrigger({ mission: 'm', status: 'active' });
  gameState.setFlag('done', true);
  assert.equal(gameState.getMissionStage('m'), 'b');
});

test('advancing past the final stage completes the mission, stacking stage and mission rewards', () => {
  const missions = {
    m: {
      name: 'M', description: 'd',
      stages: [{ id: 'only', description: 'o.', advanceWhen: { item: 'gem' }, rewards: { xp: 10 } }],
      missionRewards: { xp: 40 },
    },
  };
  const { qs } = makeQuestSystem(missions);
  qs.handleTrigger({ mission: 'm', status: 'active' });
  gameState.addToInventory('gem', 1);
  assert.equal(gameState.getMissionStatus('m'), MISSION_STATUS.COMPLETE);
  assert.equal(gameState.getPlayer().xp, 50, 'final stage rewards + mission rewards');
  // Terminal: further acquisitions re-grant nothing.
  gameState.addToInventory('gem', 1);
  assert.equal(gameState.getPlayer().xp, 50);
});

test('explicit stage jumps are forward-only; the stage left pays out, skipped stages do not', () => {
  const missions = {
    m: {
      name: 'M', description: 'd',
      stages: [
        { id: 'one', description: '1.', rewards: { gold: 5 } },
        { id: 'two', description: '2.', rewards: { gold: 7 } },
        { id: 'three', description: '3.' },
      ],
    },
  };
  const { qs } = makeQuestSystem(missions);
  qs.handleTrigger({ mission: 'm', status: 'active' });

  assert.equal(qs.handleTrigger({ mission: 'm', stage: 'three' }), true);
  assert.equal(gameState.getMissionStage('m'), 'three');
  assert.equal(gameState.getPlayer().resources.gold, 5, 'stage one completed, stage two skipped');

  // Backward (and same-stage) jumps are no-ops — re-running a pipeline never regresses.
  assert.equal(qs.handleTrigger({ mission: 'm', stage: 'one' }), false);
  assert.equal(qs.handleTrigger({ mission: 'm', stage: 'three' }), false);
  assert.equal(gameState.getMissionStage('m'), 'three');
});

test('failed is terminal and only reachable from active', () => {
  const { qs, logs } = makeQuestSystem(makeShardMission());

  // A mission that never started cannot fail.
  assert.equal(qs.handleTrigger({ mission: 'fetch_quest', status: 'failed' }), false);
  assert.equal(gameState.getMissionStatus('fetch_quest'), MISSION_STATUS.NOT_STARTED);

  qs.handleTrigger({ mission: 'fetch_quest', status: 'active' });
  assert.equal(qs.handleTrigger({ mission: 'fetch_quest', status: 'failed' }), true);
  assert.equal(gameState.getMissionStatus('fetch_quest'), MISSION_STATUS.FAILED);
  assert.ok(logs.some(l => l.message === 'quest.failed|Fetch'));

  // Terminal: no revival, no completion, no advancement — and satisfying the
  // objective after failing grants nothing.
  assert.equal(qs.handleTrigger({ mission: 'fetch_quest', status: 'active' }), false);
  assert.equal(qs.handleTrigger({ mission: 'fetch_quest', status: 'complete' }), false);
  gameState.addToInventory('shard', 2);
  assert.equal(gameState.getMissionStatus('fetch_quest'), MISSION_STATUS.FAILED);
  assert.equal(gameState.getPlayer().xp, 0);
});

test('completing from a mid stage pays that stage plus mission rewards, skipped stages nothing', () => {
  const { qs } = makeQuestSystem(makeShardMission());
  qs.handleTrigger({ mission: 'fetch_quest', status: 'active' });
  // An authored shortcut completes the quest while still on 'collect'.
  qs.handleTrigger({ mission: 'fetch_quest', status: 'complete' });
  assert.equal(gameState.getMissionStatus('fetch_quest'), MISSION_STATUS.COMPLETE);
  assert.equal(gameState.getPlayer().xp, 100, 'collect stage (25) + mission (75)');
  assert.equal(gameState.getPlayer().resources.gold, 50);
});
