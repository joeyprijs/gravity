import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import {
  normalizeOutcomes, pickTier, performSkillCheck, formatMod, resolveRetryText,
  getAttempts, recordAttempt, isResolved, markResolved, resetAttempts,
  rollBreakdown, skillLabel,
} from '../src/systems/skill-checks.js';

const TEST_RULES = {
  playerDefaults: {
    name: '', level: 1, xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, perception: 2 },
    inventory: [], equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

function makeEngine() {
  const logs = [];
  return { engine: { t: (key) => key, log: (type, message, variant) => logs.push({ type, message, variant }) }, logs };
}

beforeEach(() => gameState.init(TEST_RULES));
afterEach(() => mock.restoreAll());

// ── normalizeOutcomes ─────────────────────────────────────────────────────────

test('normalizeOutcomes: legacy actions/onFailure become the success/failure tiers', () => {
  const success = [{ type: 'navigate' }];
  const failure = [{ type: 'combat' }];
  const tiers = normalizeOutcomes({ actions: success, onFailure: failure });
  assert.deepEqual(tiers.success.actions, success);
  assert.deepEqual(tiers.failure.actions, failure);
  assert.equal(tiers.critical, undefined);
  assert.equal(tiers.partial, undefined);
});

test('normalizeOutcomes: outcomes win over legacy fields, defaults apply to margins', () => {
  const tiers = normalizeOutcomes({
    actions: [{ type: 'a' }],
    outcomes: {
      success: { text: 'yes', actions: [{ type: 'b' }] },
      critical: { text: 'wow' },
      partial: { margin: 2, actions: [{ type: 'c' }] },
    },
  });
  assert.deepEqual(tiers.success.actions, [{ type: 'b' }]);
  assert.equal(tiers.success.text, 'yes');
  assert.equal(tiers.critical.margin, 5);                  // default
  assert.deepEqual(tiers.critical.actions, [{ type: 'b' }]); // falls back to success
  assert.equal(tiers.partial.margin, 2);
  assert.deepEqual(tiers.failure.actions, []);
});

test('normalizeOutcomes: a critical tier never does less than a plain success', () => {
  // Narration-only critical (no actions key) — runs the success pipeline.
  let tiers = normalizeOutcomes({ actions: [{ type: 'a' }], outcomes: { critical: { text: 'wow' } } });
  assert.deepEqual(tiers.critical.actions, [{ type: 'a' }]);

  // Studio authors an empty pipeline — still falls back.
  tiers = normalizeOutcomes({ actions: [{ type: 'a' }], outcomes: { critical: { actions: [] } } });
  assert.deepEqual(tiers.critical.actions, [{ type: 'a' }]);

  // An authored critical pipeline wins.
  tiers = normalizeOutcomes({ actions: [{ type: 'a' }], outcomes: { critical: { actions: [{ type: 'c' }] } } });
  assert.deepEqual(tiers.critical.actions, [{ type: 'c' }]);
});

test('normalizeOutcomes: outcomes tiers without actions fall back to legacy pipelines', () => {
  const tiers = normalizeOutcomes({
    actions: [{ type: 'a' }],
    onFailure: [{ type: 'f' }],
    outcomes: { success: { text: 'flavor only' }, failure: { text: 'ouch' } },
  });
  assert.deepEqual(tiers.success.actions, [{ type: 'a' }]);
  assert.deepEqual(tiers.failure.actions, [{ type: 'f' }]);
});

// ── pickTier ──────────────────────────────────────────────────────────────────

test('pickTier: plain checks split on margin 0', () => {
  const tiers = normalizeOutcomes({});
  assert.equal(pickTier(0, tiers), 'success');
  assert.equal(pickTier(-1, tiers), 'failure');
  assert.equal(pickTier(10, tiers), 'success');  // no critical tier authored
  assert.equal(pickTier(-2, tiers), 'failure');  // no partial tier authored
});

test('pickTier: authored critical and partial claim their margins', () => {
  const tiers = normalizeOutcomes({ outcomes: { critical: {}, partial: {} } });
  assert.equal(pickTier(5, tiers), 'critical');
  assert.equal(pickTier(4, tiers), 'success');
  assert.equal(pickTier(-1, tiers), 'partial');
  assert.equal(pickTier(-3, tiers), 'partial');
  assert.equal(pickTier(-4, tiers), 'failure');
});

// ── performSkillCheck ─────────────────────────────────────────────────────────

test('performSkillCheck: rolls d20 + modifier against the DC and logs the tier', () => {
  const { engine, logs } = makeEngine();
  mock.method(Math, 'random', () => 0.5); // roll(1,20) = 11, +2 perception = 13
  const result = performSkillCheck(engine, 'perception', 12);
  assert.deepEqual(
    { rolled: result.rolled, mod: result.mod, margin: result.margin, tier: result.tier, success: result.success },
    { rolled: 13, mod: 2, margin: 1, tier: 'success', success: true }
  );
  assert.equal(logs[0].message, 'actions.skillSuccess');
});

test('performSkillCheck: partial tier logs its key and authored text as narration', () => {
  const { engine, logs } = makeEngine();
  const tiers = normalizeOutcomes({ outcomes: { partial: { margin: 3, text: 'So close…' } } });
  mock.method(Math, 'random', () => 0.5); // 11 + 2 = 13 vs DC 15 → margin -2 → partial
  const result = performSkillCheck(engine, 'perception', 15, tiers);
  assert.equal(result.tier, 'partial');
  assert.equal(result.success, false);
  assert.equal(logs[0].message, 'actions.skillPartial');
  assert.equal(logs[1].message, 'So close…');
});

test('performSkillCheck: critical tier counts as success', () => {
  const { engine, logs } = makeEngine();
  const tiers = normalizeOutcomes({ outcomes: { critical: {} } });
  mock.method(Math, 'random', () => 0.99); // 20 + 2 = 22 vs DC 10 → margin 12
  const result = performSkillCheck(engine, 'perception', 10, tiers);
  assert.equal(result.tier, 'critical');
  assert.equal(result.success, true);
  assert.equal(logs[0].message, 'actions.skillCritical');
});

test('performSkillCheck: unknown skill rolls with modifier 0', () => {
  const { engine } = makeEngine();
  mock.method(Math, 'random', () => 0.5);
  const result = performSkillCheck(engine, 'nonexistent', 12);
  assert.equal(result.mod, 0);
  assert.equal(result.rolled, 11);
});

// ── Attempt / resolution bookkeeping ─────────────────────────────────────────

test('attempts: recordAttempt counts per entry; resetAttempts clears counters only', () => {
  assert.equal(getAttempts('map', 0), 0);
  assert.equal(recordAttempt('map', 0), 1);
  assert.equal(recordAttempt('map', 0), 2);
  recordAttempt('map', 1);
  markResolved('map', 1);

  resetAttempts('map');
  assert.equal(getAttempts('map', 0), 0);
  assert.equal(getAttempts('map', 1), 0);
  assert.equal(isResolved('map', 1), true); // resolution survives the reset
});

test('resetAttempts: also clears the discovery-style top-level tries counter', () => {
  gameState.setFlag('disc', { found: [true, false], tries: 3, resolved: true });
  resetAttempts('disc');
  assert.deepEqual(gameState.getFlag('disc'), { found: [true, false], resolved: true });
});

test('resetAttempts: non-object flag values are left alone', () => {
  gameState.setFlag('bool_flag', true);
  resetAttempts('bool_flag');
  assert.equal(gameState.getFlag('bool_flag'), true);
});

// ── Small helpers ─────────────────────────────────────────────────────────────

test('formatMod: always signed', () => {
  assert.equal(formatMod(2), '+2');
  assert.equal(formatMod(0), '+0');
  assert.equal(formatMod(-1), '-1');
});

test('resolveRetryText: walks the variants per attempt and clamps to the last', () => {
  const opt = { text: 'Try', retryText: ['Again', 'Once more'] };
  assert.equal(resolveRetryText(opt, 0), 'Try');
  assert.equal(resolveRetryText(opt, 1), 'Again');
  assert.equal(resolveRetryText(opt, 2), 'Once more');
  assert.equal(resolveRetryText(opt, 9), 'Once more');
  assert.equal(resolveRetryText({ text: 'Try', retryText: 'Retry' }, 3), 'Retry');
  assert.equal(resolveRetryText({ text: 'Try' }, 3), 'Try');
});

test('rollBreakdown: formats breakdown strings correctly', () => {
  assert.equal(rollBreakdown(15, 0, 'Perception'), '1d20: 15');
  assert.equal(rollBreakdown(12, 3, 'Stealth'), '1d20: 12 + 3 Stealth');
  assert.equal(rollBreakdown(10, -2, 'Weakness'), '1d20: 10 - 2 Weakness');
});

test('skillLabel: resolves localized name or falls back to capitalized id', () => {
  const engineWithTranslation = { t: (key) => key === 'actions.skillBadgeFree.perception' ? 'Perception Skill' : key };
  const engineWithoutTranslation = { t: (key) => key };

  assert.equal(skillLabel(engineWithTranslation, 'perception'), 'Perception Skill');
  assert.equal(skillLabel(engineWithoutTranslation, 'stealth'), 'Stealth');
});

test('performSkillCheck: passes breakdown parameters to translation engine', () => {
  const loggedParams = [];
  const engine = {
    t: (key, params) => {
      loggedParams.push(params);
      return key;
    },
    log: () => {}
  };
  mock.method(Math, 'random', () => 0.5); // roll(1,20) = 11, +2 perception = 13
  performSkillCheck(engine, 'perception', 12);

  assert.equal(loggedParams.length, 2);
  assert.equal(loggedParams[0], undefined);
  assert.equal(loggedParams[1].roll, 13);
  assert.equal(loggedParams[1].dc, 12);
  assert.equal(loggedParams[1].skill, 'perception');
  assert.equal(loggedParams[1].breakdown, '1d20: 11 + 2 Perception');
});
