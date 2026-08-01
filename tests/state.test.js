import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../src/core/state.js';

// Minimal rules that mirror the key values from rules.json.
// State must be init'd before each test since gameState is a singleton.
const TEST_RULES = {
  playerDefaults: {
    name: '',
    level: 1,
    xp: 0,
    resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
    attributes: { ac: 10, initiative: 0 },
    inventory: [
      { item: 'rusty_sword',    amount: 1 },
      { item: 'flames',         amount: 1 },
      { item: 'healing_potion', amount: 2 },
    ],
    equipment: {},
  },
  customAttributes: [],
  startingScene: null,
  xpPerLevel: 100,
  levelUpHpBonus: 5,
};

// Shortcuts to avoid repeating player.resources.hp.current etc. throughout tests.
const hp    = () => gameState.getPlayer().resources.hp.current;
const maxHp = () => gameState.getPlayer().resources.hp.max;
const ap    = () => gameState.getPlayer().resources.ap.current;
const maxAp = () => gameState.getPlayer().resources.ap.max;

beforeEach(() => gameState.init(TEST_RULES));

test('addXP: level increases at threshold, carries surplus', () => {
  // Level 1 threshold = 1 × 100 = 100 XP
  gameState.addXP(150);
  const player = gameState.getPlayer();
  assert.equal(player.level, 2);
  assert.equal(player.xp, 50);
});

test('addXP: multiple level increases in one call', () => {
  // 350 XP: lvl1→2 costs 100, lvl2→3 costs 200, 50 left over
  gameState.addXP(350);
  const player = gameState.getPlayer();
  assert.equal(player.level, 3);
  assert.equal(player.xp, 50);
});

test('addXP: level-up increases maxHp', () => {
  const before = maxHp();
  gameState.addXP(100);
  assert.equal(maxHp(), before + 5);
});

test('modifyPlayerStat: hp clamps to [0, max] in both directions', () => {
  gameState.modifyPlayerStat('hp', 1000);
  assert.equal(hp(), maxHp());
  gameState.modifyPlayerStat('hp', -1000);
  assert.equal(hp(), 0);
});

test('modifyPlayerStat: a declared custom resource is modifiable by name and clamped', () => {
  gameState.init({ ...TEST_RULES, playerDefaults: {
    ...TEST_RULES.playerDefaults,
    resources: { ...TEST_RULES.playerDefaults.resources, luckPoints: { current: 3, max: 3 } },
  }});
  const luck = () => gameState.getPlayer().resources.luckPoints.current;
  gameState.modifyPlayerStat('luckPoints', -1);
  assert.equal(luck(), 2);
  gameState.modifyPlayerStat('luckPoints', -10);
  assert.equal(luck(), 0);            // clamps to 0
  gameState.modifyPlayerStat('luckPoints', 99);
  assert.equal(luck(), 3);            // clamps to max
});

test('addToInventory: stacks existing item', () => {
  // rusty_sword starts at 1
  gameState.addToInventory('rusty_sword', 2);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword');
  assert.equal(entry.amount, 3);
});

test('addToInventory: adds new item as new entry', () => {
  gameState.addToInventory('gold_coin', 5);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'gold_coin');
  assert.ok(entry, 'Expected gold_coin to be in inventory');
  assert.equal(entry.amount, 5);
});

test('removeFromInventory: decrements amount', () => {
  // healing_potion starts at 2
  gameState.removeFromInventory('healing_potion', 1);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(entry.amount, 1);
});

test('addToInventory: an item database gates ids — unknown rejected, known accepted', () => {
  gameState.init(TEST_RULES, { rusty_sword: { name: 'Rusty Sword' } });
  assert.equal(gameState.addToInventory('no_such_item'), false);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'no_such_item'), undefined);
  assert.equal(gameState.addToInventory('rusty_sword'), true);
  assert.equal(gameState.getPlayer().inventory.find(i => i.item === 'rusty_sword').amount, 2);
});

test('addToInventory: mutation carries the silent flag so observers can tell gains from internal moves', () => {
  const seen = [];
  gameState.onMutation((method, info) => { if (method === 'addToInventory') seen.push(info); });
  gameState.addToInventory('rusty_sword', 1);                  // a gain
  gameState.addToInventory('rusty_sword', 1, { silent: true }); // an internal move
  assert.equal(seen.length, 2);
  assert.equal(seen[0].silent, false);
  assert.equal(seen[1].silent, true);
});

test('mutation hooks fire before listener notification, so hook-derived state is in the notified render', () => {
  const order = [];
  gameState.onMutation((method) => { if (method === 'addToInventory') order.push('hook'); });
  gameState.subscribe(() => order.push('listener'));
  gameState.addToInventory('rusty_sword', 1);
  assert.deepEqual(order, ['hook', 'listener']);
});

test('removeFromInventory: removes entry when amount hits 0', () => {
  // healing_potion starts at 2, remove both
  gameState.removeFromInventory('healing_potion', 2);
  const entry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(entry, undefined);
});

test('amendLog extends the newest choice entry, past narrator lines, never across a scene', () => {
  gameState.amendLog(' (+2 HP)'); // empty log — no-op
  gameState.appendLog({ type: 'Player', message: 'Eat a Snack', variant: 'choice' });
  gameState.appendLog({ type: 'Narrator', message: 'Day 2: Night.', variant: 'system' });
  gameState.amendLog(' (+2 HP)');
  assert.equal(gameState.getLog().at(-2).message, 'Eat a Snack (+2 HP)');
  assert.equal(gameState.getLog().at(-1).message, 'Day 2: Night.');
  // A scene boundary seals the block: the choice behind it is out of reach.
  gameState.appendLog({ type: 'scene', title: 'Kitchen', desc: 'd' });
  gameState.amendLog(' (+2 HP)');
  assert.equal(gameState.getLog().at(-3).message, 'Eat a Snack (+2 HP)');
});

test('appendLog caps at 200 entries, trimming the oldest', () => {
  for (let i = 0; i < 250; i++) {
    gameState.appendLog({ type: 'test', message: `msg${i}` });
  }
  assert.ok(gameState.getLog().length <= 200, `Expected ≤200 entries, got ${gameState.getLog().length}`);
  assert.equal(gameState.getLog().at(-1).message, 'msg249');
});

test('getFlag: missing flag returns false', () => {
  assert.equal(gameState.getFlag('no_such_flag'), false);
});

test('getFlag: stored falsy non-boolean value is preserved (not coerced to false)', () => {
  gameState.setFlag('count', 0);
  assert.equal(gameState.getFlag('count'), 0);
  assert.notEqual(gameState.getFlag('count'), false);
});

test('registerSceneFlags: does not overwrite flags already set in state', () => {
  gameState.setFlag('door_open', true);
  gameState.registerSceneFlags({ door_open: false });
  assert.equal(gameState.getFlag('door_open'), true);
});

test('reset: re-applies registered scene flags to their initial values', () => {
  gameState.registerSceneFlags({ door_open: false });
  gameState.setFlag('door_open', true);
  gameState.reset();
  assert.equal(gameState.getFlag('door_open'), false);
});

test('setMissionStatus: emits a mutation so observers can react to quest changes', () => {
  const seen = [];
  gameState.onMutation((method, info) => { if (method === 'setMissionStatus') seen.push(info); });
  gameState.setMissionStatus('test_mission', 'active');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { missionId: 'test_mission', status: 'active' });
});

test('getMissionStatus: unregistered mission returns not_started', () => {
  assert.equal(gameState.getMissionStatus('unknown_mission'), 'not_started');
});

test('equipItem: fails and returns false if item is not in inventory', () => {
  const success = gameState.equipItem('Right Hand', 'no_such_item');
  assert.equal(success, false);
  assert.equal(gameState.getPlayer().equipment['Right Hand'], undefined);
});

test('depositToChest: clamps to actual inventory amount', () => {
  // healing_potion starts at 2
  gameState.depositToChest('chest1', 'healing_potion', 5);
  // Should only deposit 2
  const chest = gameState.getChest('chest1');
  assert.equal(chest.find(i => i.item === 'healing_potion').amount, 2);
  // Inventory should have 0
  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(invEntry, undefined);
});

test('withdrawFromChest: clamps to actual chest amount', () => {
  // Deposit 2 first
  gameState.depositToChest('chest1', 'healing_potion', 2);
  // Withdraw 5
  gameState.withdrawFromChest('chest1', 'healing_potion', 5);
  // Should only withdraw 2
  const chest = gameState.getChest('chest1');
  assert.equal(chest.length, 0);
  const invEntry = gameState.getPlayer().inventory.find(i => i.item === 'healing_potion');
  assert.equal(invEntry.amount, 2);
});

test('placeItemInDisplay: fails if item is not in inventory', () => {
  gameState.addDisplayToScene('museum', { id: 'pedestal', name: 'Pedestal' });
  const success = gameState.placeItemInDisplay('museum', 'pedestal', 'no_such_item');
  assert.equal(success, false);
  const displays = gameState.getDisplaysForScene('museum');
  assert.equal(displays[0].item, null);
});

test('countPlayerItem: correctly counts and filters equipped vs unequipped items', () => {
  // Reset and initialize with starting items
  gameState.init(TEST_RULES);

  // 'healing_potion' starts with amount: 2 in inventory, none equipped
  assert.equal(gameState.countPlayerItem('healing_potion'), 2);
  assert.equal(gameState.countPlayerItem('healing_potion', { includeEquipped: false }), 2);

  // Equip 'rusty_sword' (starts at 1 in inventory)
  gameState.equipItem('Right Hand', 'rusty_sword');

  // Total count should still be 1 (equipped)
  assert.equal(gameState.countPlayerItem('rusty_sword'), 1);
  // Unequipped inventory count should be 0
  assert.equal(gameState.countPlayerItem('rusty_sword', { includeEquipped: false }), 0);

  // Add another 'rusty_sword' to inventory
  gameState.addToInventory('rusty_sword', 1);

  // Total count should now be 2 (1 equipped, 1 in inventory)
  assert.equal(gameState.countPlayerItem('rusty_sword'), 2);
  // Unequipped inventory count should be 1
  assert.equal(gameState.countPlayerItem('rusty_sword', { includeEquipped: false }), 1);

  // Check non-existent item
  assert.equal(gameState.countPlayerItem('unknown_item'), 0);
  assert.equal(gameState.countPlayerItem('unknown_item', { includeEquipped: false }), 0);
});

test('loadFromObject: rejects malformed saves and returns false', () => {
  assert.equal(gameState.loadFromObject(null), false);
  assert.equal(gameState.loadFromObject({}), false);
  assert.equal(gameState.loadFromObject({ player: null, log: [] }), false);
  assert.equal(gameState.loadFromObject({ player: {}, log: 'not-an-array' }), false);
});

test('loadFromObject: applies a valid save and migrates an old one forward', () => {
  const ok = gameState.loadFromObject({ player: {}, log: [] }); // no saveVersion → migrates from 0
  assert.equal(ok, true);
  assert.equal(gameState.getPlayer().name, ''); // migration 1 added player.name
  assert.equal(gameState.state.saveVersion, 5); // brought up to the current version
  assert.deepEqual(gameState.state.time, { ticks: 0 }); // migration 4 seeded the clock
  assert.deepEqual(gameState.state.timers, []);
});

test('migrate v5: bare mission status strings become { status } objects, stages preserved on round-trip', () => {
  const ok = gameState.loadFromObject({
    saveVersion: 4, player: { name: 'x' }, log: [],
    missions: { escape: 'active', intro: 'complete' },
  });
  assert.equal(ok, true);
  assert.equal(gameState.getMissionStatus('escape'), 'active');
  assert.equal(gameState.getMissionStatus('intro'), 'complete');
  assert.deepEqual(gameState.state.missions.escape, { status: 'active' });

  // A current save with stage progress survives a reload untouched.
  gameState.setMissionStage('escape', 'find_key');
  const again = JSON.parse(JSON.stringify(gameState.state));
  gameState.loadFromObject(again);
  assert.deepEqual(gameState.state.missions.escape, { status: 'active', stage: 'find_key' });
});

test('getMissionStage: falls back to the first declared stage for started missions without one', () => {
  // A save from before this mission gained stages: active, no stage recorded.
  gameState.registerMissions({ escape: { name: 'E', description: 'd', stages: [{ id: 'first', description: '1' }, { id: 'second', description: '2' }] } });
  gameState.setMissionStatus('escape', 'active');
  assert.equal(gameState.getMissionStage('escape'), 'first');
  assert.equal(gameState.getMissionStage('unknown_mission'), null);
  assert.equal(gameState.missionStageIndex('escape', 'second'), 1);
  assert.equal(gameState.missionStageIndex('escape', 'ghost'), -1);
});

test('migrate: leaves a future-versioned save untouched (no backward rewrite)', () => {
  gameState.loadFromObject({ saveVersion: 99, player: { name: 'x' }, log: [] });
  assert.equal(gameState.state.saveVersion, 99);
});

test('addXP: does not hang when xpPerLevel is 0 — banks XP without leveling', () => {
  gameState.init({ ...TEST_RULES, xpPerLevel: 0 });
  gameState.addXP(50);
  const p = gameState.getPlayer();
  assert.equal(p.level, 1);
  assert.equal(p.xp, 50);
});

test('addXP: a missing levelUpHpBonus means no HP growth on level-up — never NaN', () => {
  const { levelUpHpBonus, ...rules } = TEST_RULES;
  gameState.init(rules);
  gameState.addXP(100);
  const p = gameState.getPlayer();
  assert.equal(p.level, 2);
  assert.equal(maxHp(), 10);
  assert.equal(hp(), 10);
});

test("modifyPlayerStat: the 'full' sentinel resolves before handler dispatch", () => {
  // A handler expects numeric deltas; 'full' has no meaning for a derived
  // stat that isn't a { current, max } resource, so it must no-op — never
  // reach the handler as the raw string.
  const received = [];
  gameState.registerStatHandler('favor', (amount) => received.push(amount));
  gameState.modifyPlayerStat('favor', 3);
  gameState.modifyPlayerStat('favor', 'full');
  assert.deepEqual(received, [3]);
});

// ── Level-up stat points (rules.levelUp.statPoints) ───────────────────────────

test('addXP banks stat points per level when rules.levelUp.statPoints is set', () => {
  gameState.init({
    ...TEST_RULES,
    levelUp: { statPoints: 1 },
    customAttributes: [{ id: 'perception', default: 0, max: 2 }],
  });
  gameState.addXP(300); // levels 1→2 (100) and 2→3 (200)
  const p = gameState.getPlayer();
  assert.equal(p.level, 3);
  assert.equal(p.statPoints, 2);
});

test('addXP banks nothing without rules.levelUp (classic behavior)', () => {
  gameState.init(TEST_RULES);
  gameState.addXP(100);
  assert.equal(gameState.getPlayer().statPoints, 0);
});

test('spendStatPoint: raises the attribute, respects the cap and the bank', () => {
  gameState.init({
    ...TEST_RULES,
    levelUp: { statPoints: 1 },
    customAttributes: [{ id: 'perception', default: 0, max: 1 }],
  });
  const p = gameState.getPlayer();

  assert.equal(gameState.spendStatPoint('perception'), false); // no points banked
  gameState.addXP(300); // bank 2
  assert.equal(gameState.spendStatPoint('perception'), true);
  assert.equal(p.attributes.perception, 1);
  assert.equal(p.statPoints, 1);

  assert.equal(gameState.spendStatPoint('perception'), false); // at max
  assert.equal(gameState.spendStatPoint('nonexistent'), false); // unknown attribute
  assert.equal(p.statPoints, 1); // refused spends don't drain the bank
});

test('loadFromObject: backfills attributes and statPoints a save predates', () => {
  gameState.init({
    ...TEST_RULES,
    levelUp: { statPoints: 1 },
    customAttributes: [{ id: 'strength', default: 0, max: 5 }],
  });
  // A save from before strength/statPoints existed.
  const ok = gameState.loadFromObject({
    saveVersion: 4,
    player: { ...structuredClone(TEST_RULES.playerDefaults), attributes: { ac: 10 } },
    log: [],
  });
  assert.equal(ok, true);
  const p = gameState.getPlayer();
  assert.equal(p.attributes.strength, 0); // seeded from customAttributes
  assert.equal(p.statPoints, 0);          // seeded counter
  gameState.addXP(100);
  assert.equal(gameState.spendStatPoint('strength'), true); // spendable on old saves
  assert.equal(p.attributes.strength, 1);
});

test('spendStatPoint: the cap compares base values, not gear-inflated ones', () => {
  const items = { charm: { name: 'Charm', attributes: { attributeBonuses: { perception: 1 } } } };
  gameState.init({
    ...TEST_RULES,
    levelUp: { statPoints: 1 },
    customAttributes: [{ id: 'perception', default: 0, max: 1 }],
  }, items);
  const p = gameState.getPlayer();
  gameState.addXP(300); // bank 2 points

  // Simulate wearing the charm: equipment slot filled, live value raised.
  p.equipment.Amulet = 'charm';
  p.attributes.perception = 1; // base 0 + worn 1
  assert.equal(gameState.playerBaseAttribute('perception'), 0);
  assert.equal(gameState.spendStatPoint('perception'), true);  // base 0 < cap 1 — gear must not block
  assert.equal(gameState.spendStatPoint('perception'), false); // base now 1 = cap — gear must not extend
});

test('spendStatPoint: charCreation.stats targets apply bonusPerPoint with creation semantics', () => {
  gameState.init({
    ...TEST_RULES,
    levelUp: { statPoints: 1 },
    charCreation: {
      pointBudget: 3,
      stats: [
        { id: 'resources.hp.max', localeKey: 'maxHp', bonusPerPoint: 2, min: 0 },
        { id: 'attributes.ac', localeKey: 'ac', bonusPerPoint: 1, min: 0 },
      ],
    },
  });
  const p = gameState.getPlayer();
  gameState.addXP(300); // two level-ups: banks 2 points, maxHp 10 + 2×5 = 20

  // Raising the HP cap raises current HP by the same amount, like creation.
  assert.equal(gameState.spendStatPoint('resources.hp.max'), true);
  assert.equal(maxHp(), 22);
  assert.equal(hp(), 22);

  assert.equal(gameState.spendStatPoint('attributes.ac'), true);
  assert.equal(p.attributes.ac, 11);

  // A dotted id that char creation doesn't declare is refused (and free).
  assert.equal(gameState.spendStatPoint('resources.ap.max'), false);
  assert.equal(p.statPoints, 0);
});

// ── registerMigration guards ──────────────────────────────────────────────────
// Registered at the END of this file on purpose: a registered plugin migration
// persists on the singleton and would run (and stamp its version) for every
// loadFromObject test that runs after it.

test('registerMigration: requires a plugin id and a positive integer version, rejects duplicates', () => {
  assert.throws(() => gameState.registerMigration(4, () => {}), /plugin id string is required/);
  assert.throws(() => gameState.registerMigration('demo', 0, () => {}), /positive integer/);
  gameState.registerMigration('demo', 1, (data) => { (data.plugins ??= {}).demo = { seeded: true }; });
  assert.throws(() => gameState.registerMigration('demo', 1, () => {}), /already registered/);
});

test('plugin migrations run on their own version line, partitioned from the core counter', () => {
  const ok = gameState.loadFromObject({ player: {}, log: [] }); // v0 save
  assert.equal(ok, true);
  assert.equal(gameState.state.saveVersion, 5);                    // core line untouched by the plugin
  assert.equal(gameState.state.pluginSaveVersions.demo, 1);        // plugin line stamped separately
  assert.deepEqual(gameState.state.plugins.demo, { seeded: true }); // and the migration ran

  // A save already at the plugin's version must not re-run its migration.
  gameState.loadFromObject({
    saveVersion: 4, pluginSaveVersions: { demo: 1 },
    player: {}, plugins: { demo: { seeded: 'already' } }, log: [],
  });
  assert.equal(gameState.state.plugins.demo.seeded, 'already');
});

test('migrate: a pre-partition save stamped 5 by a plugin adopts the core version back', () => {
  // Before the partition, plugin migrations stamped the CORE counter (the
  // curator wrote 5). Such a save's DATA is at core v4 — adoption must land
  // it there (not at SAVE_VERSION) so the v5 mission migration still runs.
  gameState.loadFromObject({
    saveVersion: 5, player: { name: 'x' }, log: [],
    missions: { escape: 'active' }, // pre-v5 string shape proves v5 ran
  });
  assert.equal(gameState.state.saveVersion, 5);
  assert.deepEqual(gameState.state.missions.escape, { status: 'active' }, 'the v5 mission migration ran after adoption');
  assert.equal(gameState.state.pluginSaveVersions.demo, 1); // the plugin line still catches up
});

test('loadFromObject: legacy check bookkeeping moves from flags into checkState', () => {
  // Earlier tests registered scene flags on the singleton; pin them to a
  // known set — loads seed declared flags the save predates (see below).
  gameState.registerSceneFlags({ door_open: false });
  const ok = gameState.loadFromObject({
    saveVersion: 4,
    player: {
      name: 'Old Save', level: 1, xp: 0,
      resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
      attributes: { ac: 10 }, inventory: [], equipment: {},
    },
    flags: {
      cellar_unlocked: true,                                  // authored flag — stays
      merchant_stock_stranger_potion: 2,                      // scalar world state — stays
      skill_dc_perception_dungeon_start: { tries_0: 2 },      // check map — moves
      dialogue_dc_innkeeper: { tries_charm_start_0: 1 },      // check map — moves
      dialogue_resolved_innkeeper: { resolved_charm_start_0: true }, // check map — moves
    },
    missions: {}, chests: {}, displays: {}, visitedScenes: [],
    time: { ticks: 0 }, timers: [], log: [],
  });

  assert.equal(ok, true);
  assert.deepEqual(gameState.state.flags, {
    cellar_unlocked: true,
    merchant_stock_stranger_potion: 2,
    door_open: false,
  }, 'authored and scalar flags stay in the flag namespace; declared scene flags are seeded');
  assert.deepEqual(gameState.getCheckState('skill_dc_perception_dungeon_start'), { tries_0: 2 });
  assert.deepEqual(gameState.getCheckState('dialogue_dc_innkeeper'), { tries_charm_start_0: 1 });
  assert.deepEqual(gameState.getCheckState('dialogue_resolved_innkeeper'), { resolved_charm_start_0: true });

  // Idempotent: re-loading the already-normalized save changes nothing.
  const again = JSON.parse(JSON.stringify(gameState.state));
  gameState.loadFromObject(again);
  assert.deepEqual(gameState.getCheckState('skill_dc_perception_dungeon_start'), { tries_0: 2 });
});

test('loadFromObject: seeds declared scene flags the save predates, never overwriting saved ones', () => {
  // A flag shipped after the player's save, defaulting TRUE — without the
  // backfill getFlag's false fallback would hide whatever it gates.
  gameState.registerSceneFlags({ gate_raised: true, door_open: false });
  gameState.loadFromObject({
    saveVersion: 4, player: { name: 'x' }, log: [],
    flags: { door_open: true }, // the save's own value must win
  });
  assert.equal(gameState.getFlag('gate_raised'), true, 'declared default seeded into the old save');
  assert.equal(gameState.getFlag('door_open'), true, 'saved values are preserved');
});
