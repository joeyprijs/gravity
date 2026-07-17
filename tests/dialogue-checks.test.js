import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { DialogueSystem } from '../src/systems/dialogue.js';
import { CHECK_KEYS } from '../src/core/config.js';

// Characterization tests for the checked-response onclick flow (gate → spend →
// roll → tier → record/exhaust → re-render). Deterministic without mocking
// dice: dc 25 cannot be met by 1d20+0 (guaranteed failure), dc 1 is always met
// (guaranteed success; no critical tier is authored, so the tier is 'success').

// Fake DOM with a persistent per-id element registry, so the containers
// renderDialogue fills can be inspected and their buttons clicked.
const byId = new Map();

function makeFakeEl(tag = 'div') {
  let children = [];
  return {
    tagName: tag.toUpperCase(),
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    get children() { return children; },
    set children(v) { children = v; },
    appendChild(c) { children.push(c); return c; },
    append() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    set innerHTML(_v) { children = []; },
    get innerHTML() { return ''; },
  };
}

globalThis.document = {
  createElement: (tag) => makeFakeEl(tag),
  getElementById: (id) => {
    if (!byId.has(id)) byId.set(id, makeFakeEl());
    return byId.get(id);
  },
};

const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: {
      hp: { current: 10, max: 10 },
      ap: { current: 3, max: 3 },
      luckPoints: { current: 1, max: 3 },
      gold: 50,
    },
    attributes: { ac: 10, initiative: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: 'town_square',
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// Builds an engine mock (real action registry) plus a DialogueSystem running
// the REAL renderDialogue, an NPC whose start node has the given responses,
// and a recorder for re-render calls.
function makeHarness(responses, { rules = TEST_RULES } = {}) {
  const registry = new Map();
  const calls = { logs: [], renderedScenes: [], actions: [], time: 0 };
  const engine = {
    data: {
      npcs: { talker: { name: 'Talker', conversations: { start: { npcText: 'Hello.', responses } } } },
      items: {},
      rules,
    },
    state: gameState,
    t: (key) => key,
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    registerAction: (name, fn) => registry.set(name, fn),
    getActionHandler: (name) => registry.get(name) || null,
    renderScene: (sceneId) => calls.renderedScenes.push(sceneId),
    resetScene: () => {},
    handleQuestTrigger: () => {},
    advanceTime: (n) => { calls.time += n; },
    scrollNarrativeToBottom: () => {},
    openScene: () => {},
    currentSceneEl: makeFakeEl(),
    mode: 'scene',
    setMode(mode) { this.mode = mode; },
  };
  const ds = new DialogueSystem(engine);
  engine.registerAction('spy', (action) => calls.actions.push(action.tag ?? 'spy'));

  const rerenders = [];
  const orig = ds.renderDialogue.bind(ds);
  ds.renderDialogue = (...args) => { rerenders.push(args); return orig(...args); };

  return { ds, engine, calls, rerenders };
}

// The buttons appended to a container by the last render (skips the location
// reminder and section headings — buttons are what carry an onclick).
const buttonsIn = (id) => byId.get(id).children.filter(c => typeof c.onclick === 'function');
const plainButtons = () => buttonsIn('scene-options');
const checkButtons = () => buttonsIn('scene-options-skills');

beforeEach(() => {
  byId.clear();
  gameState.init(TEST_RULES);
});

// ── failure path ──────────────────────────────────────────────────────────────

test('failed check: records an attempt, runs failure actions, re-renders options-only', () => {
  const { ds, calls, rerenders } = makeHarness([{
    text: 'Persuade', skillCheck: 'charm', dc: 25,
    onFailure: [{ type: 'spy', tag: 'failed' }],
  }]);
  ds.startDialogue('talker');
  assert.equal(checkButtons().length, 1);

  checkButtons()[0].onclick();

  const dcState = gameState.getCheckState(CHECK_KEYS.dialogueDc('talker'));
  assert.equal(dcState.tries_charm_start_0, 1, 'one attempt recorded');
  assert.deepEqual(calls.actions, ['failed'], 'failure pipeline ran');
  assert.deepEqual(rerenders.at(-1), ['start', null, true], 're-rendered options-only');
  assert.equal(checkButtons().length, 1, 'check is still offered after a plain failure');
});

test('maxAttempts exhaustion: retires the response for the conversation and runs onExhausted', () => {
  const { ds, calls } = makeHarness([{
    text: 'Persuade', skillCheck: 'charm', dc: 25, maxAttempts: 1,
    onExhausted: [{ type: 'spy', tag: 'exhausted' }],
  }]);
  ds.startDialogue('talker');
  checkButtons()[0].onclick();

  const dcState = gameState.getCheckState(CHECK_KEYS.dialogueDc('talker'));
  assert.equal(dcState.resolved_charm_start_0, true, 'retired in the per-conversation map');
  assert.deepEqual(calls.actions, ['exhausted']);
  assert.equal(checkButtons().length, 0, 'exhausted check no longer offered');

  // Exhaustion is per-conversation: re-talking resets it.
  ds.startDialogue('talker');
  assert.equal(checkButtons().length, 1, 'patience resets on re-talk');
});

// ── success path ──────────────────────────────────────────────────────────────

test('success: runs the success pipeline and re-renders when nothing navigated', () => {
  const { ds, calls, rerenders } = makeHarness([{
    text: 'Persuade', skillCheck: 'charm', dc: 1,
    actions: [{ type: 'spy', tag: 'won' }],
  }]);
  ds.startDialogue('talker');
  checkButtons()[0].onclick();

  assert.deepEqual(calls.actions, ['won']);
  assert.deepEqual(rerenders.at(-1), ['start', null, true]);
});

test('resolveOnce success: permanently retires the response across conversations', () => {
  const { ds } = makeHarness([{
    text: 'Persuade', skillCheck: 'charm', dc: 1, resolveOnce: true,
    actions: [{ type: 'spy' }],
  }]);
  ds.startDialogue('talker');
  checkButtons()[0].onclick();

  const resolved = gameState.getCheckState(CHECK_KEYS.dialogueResolved('talker'));
  assert.equal(resolved.resolved_charm_start_0, true);
  assert.equal(checkButtons().length, 0);

  ds.startDialogue('talker');
  assert.equal(checkButtons().length, 0, 'resolveOnce survives a re-talk');
});

test('success via a navigating action skips the options-only re-render', () => {
  const { ds, rerenders, calls } = makeHarness([{
    text: 'Farewell', skillCheck: 'charm', dc: 1,
    actions: [{ type: 'leave' }],
  }]);
  ds.startDialogue('talker');
  gameState.setCurrentSceneId('town_square');
  const before = rerenders.length;
  checkButtons()[0].onclick();

  assert.deepEqual(calls.renderedScenes, ['town_square'], 'leave rendered the scene');
  assert.equal(rerenders.length, before, 'no options-only re-render after navigation');
});

// ── gates ─────────────────────────────────────────────────────────────────────

test('AP gate: skillAttemptCost charges rolled checks and blocks unaffordable retries', () => {
  const rules = { ...TEST_RULES, apEconomy: { skillAttemptCost: 2 } };
  const { ds } = makeHarness([{ text: 'Persuade', skillCheck: 'charm', dc: 25 }], { rules });
  ds.startDialogue('talker');

  checkButtons()[0].onclick();
  assert.equal(gameState.getPlayer().resources.ap.current, 1, 'attempt spent 2 AP');
  assert.equal(checkButtons()[0].disabled, true, '1 AP left < cost 2 — button disabled');
});

test('retry gate: first attempt free, retry spends the configured resource', () => {
  const rules = { ...TEST_RULES, skillRetry: { resource: 'luckPoints', cost: 1 } };
  const { ds } = makeHarness([{ text: 'Persuade', skillCheck: 'charm', dc: 25 }], { rules });
  ds.startDialogue('talker');

  checkButtons()[0].onclick();
  assert.equal(gameState.getPlayer().resources.luckPoints.current, 1, 'first attempt is free');

  checkButtons()[0].onclick();
  assert.equal(gameState.getPlayer().resources.luckPoints.current, 0, 'retry spent 1');

  assert.equal(checkButtons()[0].disabled, true, 'no currency left — retry blocked');
});

test('plain response with an explicit apCost spends it and runs its actions', () => {
  const { ds, calls } = makeHarness([{
    text: 'Chat', apCost: 1, actions: [{ type: 'spy', tag: 'chatted' }],
  }]);
  ds.startDialogue('talker');

  // Plain responses land in the main options container.
  plainButtons()[0].onclick();
  assert.equal(gameState.getPlayer().resources.ap.current, 2);
  assert.deepEqual(calls.actions, ['chatted']);
});

test('timeCost on a checked response advances the clock after the roll', () => {
  const { ds, calls } = makeHarness([{
    text: 'Persuade', skillCheck: 'charm', dc: 25, timeCost: 3,
  }]);
  ds.startDialogue('talker');
  checkButtons()[0].onclick();
  assert.equal(calls.time, 3);
});
