import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';
import { registerBuiltinActions } from '../src/systems/actions.js';
import { ACTIONS, FLAG_KEYS } from '../src/core/config.js';

// Minimal rules required by gameState.init() — mirrors the key values from rules.json.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0 },
    inventory: [],
    equipment: {},
  },
  customAttributes: [],
  startingScene: 'start_scene',
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

const TEST_ITEMS = {
  healing_potion: { name: 'Healing Potion' },
};

// Shortcuts to avoid repeating player.resources.* throughout tests.
const gold = () => gameState.getPlayer().resources.gold;
const hp   = () => gameState.getPlayer().resources.hp.current;
const ap   = () => gameState.getPlayer().resources.ap.current;

// Minimal engine mock: collects registered handlers in a Map (like the real
// action registry) and records every outbound call so tests can assert on them.
// t() echoes the locale key, so log assertions compare against keys directly.
function makeEngine({ rules = TEST_RULES, items = TEST_ITEMS } = {}) {
  const registry = new Map();
  const calls = { logs: [], renderedScenes: [], combat: [], dialogue: [], chests: [], customUI: [] };
  const engine = {
    data: { items, rules },
    t: (key) => key,
    log: (type, message, variant) => calls.logs.push({ type, message, variant }),
    registerAction: (name, fn) => registry.set(name, fn),
    combatSystem: { startCombat: (enemies, action) => calls.combat.push({ enemies, action }) },
    dialogueSystem: { startDialogue: (npcId) => calls.dialogue.push(npcId) },
    renderScene: (sceneId) => calls.renderedScenes.push(sceneId),
    setCustomUIOpen: (open) => calls.customUI.push(open),
    ui: { renderChestUI: (chestId) => calls.chests.push(chestId) },
  };
  registerBuiltinActions(engine);
  // Dispatch helper mirroring engine.runActions for a single action.
  const run = (action) => registry.get(action.type)(action, engine);
  return { engine, registry, calls, run };
}

beforeEach(() => gameState.init(TEST_RULES));

// ── loot ──────────────────────────────────────────────────────────────────────

test('loot: gold goes to the gold resource, not the inventory', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'gold', amount: 25 });
  assert.equal(gold(), 25);
  assert.equal(gameState.getPlayer().inventory.length, 0);
  assert.equal(calls.logs[0].message, 'loot.foundGold');
});

test('loot: received gold uses the received locale key', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'gold', amount: 5, received: true });
  assert.equal(calls.logs[0].message, 'loot.receivedGold');
});

test('loot: item is added to the inventory with default amount 1', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion' });
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(entry.amount, 1);
  assert.equal(calls.logs[0].message, 'loot.foundItem');
});

test('loot: received item uses the received locale key', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion', received: true });
  assert.equal(calls.logs[0].message, 'loot.receivedItem');
});

test('loot: log false suppresses the log line, item still awarded', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion', log: false });
  assert.equal(calls.logs.length, 0);
  assert.ok(gameState.getPlayer().inventory.find(i => i.item === 'healing_potion'));
});

test('loot: a string log overrides the default message', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'gold', amount: 1, log: 'You pry the coin loose.' });
  assert.equal(calls.logs[0].message, 'You pry the coin loose.');
});

test('loot: xpReward awards XP and logs it', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOOT, item: 'healing_potion', xpReward: 30 });
  assert.equal(gameState.getPlayer().xp, 30);
  assert.equal(calls.logs.at(-1).message, 'loot.xpGained');
});

// ── combat ────────────────────────────────────────────────────────────────────

test('combat: starts combat with the listed enemies and passes the action through', () => {
  const { run, calls } = makeEngine();
  const action = { type: ACTIONS.COMBAT, enemies: ['goblin_grunt'], setFlag: 'won' };
  run(action);
  assert.deepEqual(calls.combat[0].enemies, ['goblin_grunt']);
  assert.equal(calls.combat[0].action, action);
});

test('combat: befriended enemies are filtered out', () => {
  const { run, calls } = makeEngine();
  gameState.setFlag(FLAG_KEYS.friendly('goblin_guard'), true);
  run({ type: ACTIONS.COMBAT, enemies: ['goblin_guard', 'goblin_grunt'] });
  assert.deepEqual(calls.combat[0].enemies, ['goblin_grunt']);
});

test('combat: avoided entirely when every enemy is friendly', () => {
  const { run, calls } = makeEngine();
  gameState.setFlag(FLAG_KEYS.friendly('goblin_guard'), true);
  run({ type: ACTIONS.COMBAT, enemies: ['goblin_guard'] });
  assert.equal(calls.combat.length, 0);
  assert.equal(calls.logs[0].message, 'combat.avoided');
});

// ── dialogue / navigate / return ──────────────────────────────────────────────

test('dialogue: starts a dialogue with the given NPC', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.DIALOGUE, npc: 'dwarf_innkeeper' });
  assert.deepEqual(calls.dialogue, ['dwarf_innkeeper']);
});

test('navigate: renders the destination scene', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.NAVIGATE, destination: 'dungeon_corridor' });
  assert.deepEqual(calls.renderedScenes, ['dungeon_corridor']);
});

test('return: renders the stored return scene', () => {
  const { run, calls } = makeEngine();
  gameState.setReturnSceneId('dungeon_start');
  run({ type: ACTIONS.RETURN });
  assert.deepEqual(calls.renderedScenes, ['dungeon_start']);
});

test('return: falls back to rules.startingScene when no return scene is stored', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.RETURN });
  assert.deepEqual(calls.renderedScenes, ['start_scene']);
});

// ── full_rest / heal ──────────────────────────────────────────────────────────

test('full_rest: restores hp and ap to their maximums', () => {
  const { run } = makeEngine();
  gameState.modifyPlayerStat('hp', -6);
  gameState.modifyPlayerStat('ap', -2);
  run({ type: ACTIONS.FULL_REST });
  assert.equal(hp(), gameState.getPlayer().resources.hp.max);
  assert.equal(ap(), gameState.getPlayer().resources.ap.max);
});

test('heal: explicit amount takes precedence', () => {
  const { run } = makeEngine();
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.HEAL, amount: 4 });
  assert.equal(hp(), 6);
});

test('heal: falls back to rules.snackHealAmount', () => {
  const { run } = makeEngine({ rules: { ...TEST_RULES, snackHealAmount: 3 } });
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.HEAL });
  assert.equal(hp(), 5);
});

test('heal: defaults to 2 when rules define no snackHealAmount', () => {
  const { run } = makeEngine({ rules: null });
  gameState.modifyPlayerStat('hp', -8);
  run({ type: ACTIONS.HEAL });
  assert.equal(hp(), 4);
});

// ── pipeline utilities ────────────────────────────────────────────────────────

test('set_flag: writes the flag value', () => {
  const { run } = makeEngine();
  run({ type: ACTIONS.SET_FLAG, flag: 'gate_open', value: true });
  assert.equal(gameState.getFlag('gate_open'), true);
});

test('log: emits the given message', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.LOG, message: 'The walls tremble.' });
  assert.equal(calls.logs[0].message, 'The walls tremble.');
});

test('manage_chest: opens the custom UI and renders the chest', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.MANAGE_CHEST, chest: 'museum' });
  assert.deepEqual(calls.customUI, [true]);
  assert.deepEqual(calls.chests, ['museum']);
});

test('registerBuiltinActions registers every built-in action type', () => {
  const { registry } = makeEngine();
  for (const type of [ACTIONS.LOOT, ACTIONS.COMBAT, ACTIONS.DIALOGUE, ACTIONS.RETURN,
                      ACTIONS.FULL_REST, ACTIONS.HEAL, ACTIONS.NAVIGATE, ACTIONS.SET_FLAG,
                      ACTIONS.LOG, ACTIONS.MANAGE_CHEST]) {
    assert.ok(registry.has(type), `expected "${type}" to be registered`);
  }
});

// ── modify_ap / AP economy ────────────────────────────────────────────────────

test('modify_ap: a fixed amount is clamped to max; default/full refills the pool', () => {
  const { run, calls } = makeEngine();
  gameState.modifyPlayerStat('ap', -3); // 0/3
  run({ type: ACTIONS.MODIFY_AP, amount: 2 });
  assert.equal(ap(), 2);
  assert.equal(calls.logs[0].message, 'actions.restoreAp');

  run({ type: ACTIONS.MODIFY_AP, amount: 99 });
  assert.equal(ap(), 3); // clamped

  gameState.modifyPlayerStat('ap', -3);
  run({ type: ACTIONS.MODIFY_AP }); // amount omitted → full
  assert.equal(ap(), 3);
});

test('modify_ap: a negative amount drains, clamped at 0, and logs the drain key', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.MODIFY_AP, amount: -2 });
  assert.equal(ap(), 1);
  assert.equal(calls.logs[0].message, 'actions.drainAp');

  run({ type: ACTIONS.MODIFY_AP, amount: -99 });
  assert.equal(ap(), 0); // clamped at empty
});

test('modify_ap: a no-op (already full or already empty) stays silent', () => {
  const { run, calls } = makeEngine();
  run({ type: ACTIONS.MODIFY_AP, amount: 'full' }); // already at max
  run({ type: ACTIONS.MODIFY_AP, amount: 2 });      // still at max
  gameState.modifyPlayerStat('ap', -3);
  run({ type: ACTIONS.MODIFY_AP, amount: -2 });     // already empty
  assert.equal(calls.logs.length, 0);
  assert.equal(ap(), 0);
});

test('full_rest: apEconomy.restRestore limits AP recovery while HP still fills', () => {
  const rules = { ...TEST_RULES, apEconomy: { restRestore: 1 } };
  const { run } = makeEngine({ rules });
  gameState.modifyPlayerStat('hp', -5);
  gameState.modifyPlayerStat('ap', -3);
  run({ type: ACTIONS.FULL_REST });
  assert.equal(hp(), 10);
  assert.equal(ap(), 1);
});

test('full_rest: restRestore 0 leaves AP untouched; default restores fully', () => {
  const zero = { ...TEST_RULES, apEconomy: { restRestore: 0 } };
  const { run } = makeEngine({ rules: zero });
  gameState.modifyPlayerStat('ap', -2);
  run({ type: ACTIONS.FULL_REST });
  assert.equal(ap(), 1);

  const { run: runDefault } = makeEngine();
  run({ type: ACTIONS.FULL_REST }); // still the zero-restore engine
  assert.equal(ap(), 1);
  runDefault({ type: ACTIONS.FULL_REST }); // classic default: full refill
  assert.equal(ap(), 3);
});
