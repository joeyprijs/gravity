import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { DialogueSystem } from '../src/systems/dialogue.js';
import { ACTIONS, CHECK_KEYS, FLAG_KEYS } from '../src/core/config.js';

// Minimal DOM stand-in — just enough for the real renderDialogue to run
// headless (createElement/buildSceneDescription/resetOptionsPanel).
const fakeEl = () => ({
  classList: { add() {} },
  children: [],
  appendChild(child) { this.children.push(child); return child; },
  setAttribute() {},
  removeAttribute() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});
globalThis.document = { createElement: fakeEl, getElementById: fakeEl };

// Minimal rules required by gameState.init() — mirrors the key values from rules.json.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 50 },
    attributes: { ac: 10, initiative: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: 'town_square',
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

const TEST_NPCS = {
  talker: {
    name: 'Talker',
    conversations: { start: { npcText: 'Hello.', responses: [] } },
  },
  quiet_merchant: {
    name: 'Quiet Merchant',
    isMerchant: true,
    carriedItems: [{ item: 'healing_potion', amount: 3 }],
  },
};

// Minimal engine mock with a real action-registry Map, so DialogueSystem's own
// action registrations and _runActions dispatch work exactly as in the engine.
function makeEngine({ npcs = TEST_NPCS, items = {}, rules = TEST_RULES } = {}) {
  const registry = new Map();
  const calls = { logs: [], renderedScenes: [], resetScene: 0, questTriggers: [] };
  const engine = {
    data: { npcs, items, rules },
    state: gameState,
    t: (key) => key,
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    registerAction: (name, fn) => registry.set(name, fn),
    getActionHandler: (name) => registry.get(name) || null,
    renderScene: (sceneId) => calls.renderedScenes.push(sceneId),
    resetScene: () => calls.resetScene++,
    handleQuestTrigger: (action) => calls.questTriggers.push(action),
    scrollNarrativeToBottom: () => {},
    openScene: () => {},
    currentSceneEl: { appendChild: () => {} },
    mode: 'scene',
    setMode(mode) { this.mode = mode; },
  };
  return { engine, registry, calls };
}

// Builds a DialogueSystem with its DOM-rendering methods stubbed out, so the
// dialogue/store flow logic can run headlessly.
function makeDS(engineOpts) {
  const { engine, registry, calls } = makeEngine(engineOpts);
  const ds = new DialogueSystem(engine);
  ds.renderDialogue = mock.fn();
  ds.renderDialogueFallback = mock.fn();
  ds.renderStore = mock.fn();
  return { ds, engine, registry, calls };
}

beforeEach(() => gameState.init(TEST_RULES));
afterEach(() => mock.restoreAll());

// ── startDialogue ─────────────────────────────────────────────────────────────

test('startDialogue: unknown NPC warns and leaves no active dialogue', () => {
  const warn = mock.method(console, 'warn', () => {});
  const { ds } = makeDS();
  ds.startDialogue('no_such_npc');
  assert.equal(ds.currentNPC, null);
  assert.equal(warn.mock.callCount(), 1);
});

test('startDialogue: NPC with conversations starts at the "start" node', () => {
  const { ds, calls } = makeDS();
  ds.startDialogue('talker');
  assert.equal(ds.currentNPCId, 'talker');
  assert.equal(ds.currentNPC, TEST_NPCS.talker);
  assert.equal(calls.resetScene, 1);
  assert.deepEqual(ds.renderDialogue.mock.calls[0].arguments, ['start']);
});

test('startDialogue: clears the NPC\'s escalated conversation DCs', () => {
  const { ds } = makeDS();
  gameState.setCheckState(CHECK_KEYS.dialogueDc('talker'), { charm_start_0: 14 });
  ds.startDialogue('talker');
  assert.deepEqual(gameState.getCheckState(CHECK_KEYS.dialogueDc('talker')), {});
});

test('startDialogue: NPC without conversations renders the fallback greeting', () => {
  const { ds } = makeDS();
  ds.startDialogue('quiet_merchant');
  assert.equal(ds.renderDialogueFallback.mock.callCount(), 1);
  assert.equal(ds.renderDialogue.mock.callCount(), 0);
});

test('startDialogue: resets store state from a previous conversation', () => {
  const { ds, engine } = makeDS();
  engine.setMode('store');
  ds.activeDiscount = 0.25;
  ds.startDialogue('talker');
  assert.equal(engine.mode, 'dialogue');
  assert.equal(ds.activeDiscount, 0);
});

// ── registered dialogue actions ───────────────────────────────────────────────

test('constructor registers the dialogue actions on the engine registry', () => {
  const { registry } = makeDS();
  for (const type of [ACTIONS.GO_TO_CONVERSATION, ACTIONS.TRADE, ACTIONS.LEAVE,
                      ACTIONS.MAKE_FRIENDLY, ACTIONS.QUEST_TRIGGER]) {
    assert.ok(registry.has(type), `expected "${type}" to be registered`);
  }
});

test('goToConversation: renders the target node during a dialogue', () => {
  const { ds, registry, engine } = makeDS();
  ds.startDialogue('talker');
  registry.get(ACTIONS.GO_TO_CONVERSATION)({ type: ACTIONS.GO_TO_CONVERSATION, node: 'rumors' }, engine);
  assert.deepEqual(ds.renderDialogue.mock.calls.at(-1).arguments, ['rumors']);
});

test('conversation-bound actions are ignored outside an active dialogue', () => {
  const warn = mock.method(console, 'warn', () => {});
  const { ds, registry, engine } = makeDS();
  registry.get(ACTIONS.GO_TO_CONVERSATION)({ type: ACTIONS.GO_TO_CONVERSATION, node: 'rumors' }, engine);
  assert.equal(ds.renderDialogue.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 1);
});

test('leave: renders the current scene', () => {
  const { registry, engine, calls } = makeDS();
  gameState.setCurrentSceneId('town_square');
  registry.get(ACTIONS.LEAVE)({ type: ACTIONS.LEAVE }, engine);
  assert.deepEqual(calls.renderedScenes, ['town_square']);
});

test('makeFriendly: sets the friendly flag for the active NPC', () => {
  const { ds, registry, engine } = makeDS();
  ds.startDialogue('talker');
  registry.get(ACTIONS.MAKE_FRIENDLY)({ type: ACTIONS.MAKE_FRIENDLY }, engine);
  assert.equal(gameState.getFlag(FLAG_KEYS.friendly('talker')), true);
});

test('questTrigger: forwards the action to the engine', () => {
  const { registry, engine, calls } = makeDS();
  const action = { type: ACTIONS.QUEST_TRIGGER, mission: 'escape_dungeon' };
  registry.get(ACTIONS.QUEST_TRIGGER)(action, engine);
  assert.deepEqual(calls.questTriggers, [action]);
});

test('trade: numeric discount percentage becomes a ratio and opens the store', () => {
  const { ds, registry, engine } = makeDS();
  ds.startDialogue('talker');
  registry.get(ACTIONS.TRADE)({ type: ACTIONS.TRADE, tradeDiscount: 20 }, engine);
  assert.equal(ds.activeDiscount, 0.2);
  assert.equal(ds.renderStore.mock.callCount(), 1);
});

test('trade: string discount percentage is parsed', () => {
  const { ds, registry, engine } = makeDS();
  ds.startDialogue('talker');
  registry.get(ACTIONS.TRADE)({ type: ACTIONS.TRADE, tradeDiscount: '25' }, engine);
  assert.equal(ds.activeDiscount, 0.25);
});

test('trade: persistDiscount stores the percentage in a flag', () => {
  const { ds, registry, engine } = makeDS();
  ds.startDialogue('talker');
  registry.get(ACTIONS.TRADE)({ type: ACTIONS.TRADE, tradeDiscount: 20, persistDiscount: true }, engine);
  assert.equal(gameState.getFlag(FLAG_KEYS.tradeDiscount('talker')), 20);
});

test('trade: no discount leaves the ratio at zero and persists nothing', () => {
  const { ds, registry, engine } = makeDS();
  ds.startDialogue('talker');
  registry.get(ACTIONS.TRADE)({ type: ACTIONS.TRADE, persistDiscount: true }, engine);
  assert.equal(ds.activeDiscount, 0);
  assert.equal(gameState.getFlag(FLAG_KEYS.tradeDiscount('talker')), false);
});

// ── _runActions ───────────────────────────────────────────────────────────────

test('_runActions: reports navigation for dialogue-nav action types', () => {
  const { ds, engine } = makeDS();
  ds.startDialogue('talker');
  assert.equal(ds._runActions([{ type: ACTIONS.GO_TO_CONVERSATION, node: 'x' }]), true);
});

test('_runActions: reports navigation when a handler closes the dialogue', () => {
  const { ds, engine } = makeDS();
  ds.startDialogue('talker');
  engine.registerAction('warp_home', () => { ds.currentNPC = null; });
  assert.equal(ds._runActions([{ type: 'warp_home' }]), true);
});

test('_runActions: plain side-effect actions do not count as navigation', () => {
  const { ds, engine } = makeDS();
  ds.startDialogue('talker');
  engine.registerAction('noop', () => {});
  assert.equal(ds._runActions([{ type: 'noop' }]), false);
});

test('_runActions: unknown action types warn and are skipped', () => {
  const warn = mock.method(console, 'warn', () => {});
  const { ds } = makeDS();
  ds.startDialogue('talker');
  assert.equal(ds._runActions([{ type: 'definitely_not_registered' }]), false);
  assert.equal(warn.mock.callCount(), 1);
});

// ── merchant stock ────────────────────────────────────────────────────────────

test('_getStock: null npcAmount means unlimited stock', () => {
  const { ds } = makeDS();
  ds.startDialogue('quiet_merchant');
  assert.equal(ds._getStock('healing_potion', null), null);
});

test('_getStock: falls back to the NPC-configured amount when nothing was sold yet', () => {
  const { ds } = makeDS();
  ds.startDialogue('quiet_merchant');
  assert.equal(ds._getStock('healing_potion', 3), 3);
});

test('_getStock: reads the remaining stock from the merchant flag', () => {
  const { ds } = makeDS();
  ds.startDialogue('quiet_merchant');
  gameState.setFlag(FLAG_KEYS.merchantStock('quiet_merchant', 'healing_potion'), 1);
  assert.equal(ds._getStock('healing_potion', 3), 1);
});

test('_getStock: a sold-out stock of 0 is preserved, not reset', () => {
  const { ds } = makeDS();
  ds.startDialogue('quiet_merchant');
  gameState.setFlag(FLAG_KEYS.merchantStock('quiet_merchant', 'healing_potion'), 0);
  assert.equal(ds._getStock('healing_potion', 3), 0);
});

// ── renderDialogue: overrideText (store exit) ─────────────────────────────────

test('renderDialogue: overrideText re-shows the node without re-running its actions', () => {
  const npcs = {
    gifter: {
      name: 'Gifter',
      conversations: { start: { npcText: 'Take this, friend.', actions: [{ type: 'give_gift' }], responses: [] } },
    },
  };
  const { engine } = makeEngine({ npcs });
  let gifts = 0;
  engine.registerAction('give_gift', () => gifts++);
  const ds = new DialogueSystem(engine); // real renderDialogue — not the makeDS stub

  ds.startDialogue('gifter');
  assert.equal(gifts, 1, 'entering the node runs its actions once');

  ds.renderDialogue('start', 'Come again!'); // the store-exit path
  assert.equal(gifts, 1, 'an overrideText re-show must not re-run the pipeline');
});
