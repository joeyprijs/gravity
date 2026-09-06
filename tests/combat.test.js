import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CombatSystem } from '../src/systems/combat.js';
import { splashTargets, CombatRenderer } from '../src/ui/combat-ui.js';
import { gameState } from '../src/core/state.js';
import { ENEMY_CLAW_ID } from '../src/core/config.js';
import { makeRules, SLOTS, paramEchoT } from './helpers.js';

const TEST_RULES = makeRules({ playerDefaults: { equipmentSlots: SLOTS } });

// Shortcuts to avoid repeating player.resources.* throughout tests.
const hp    = () => gameState.getPlayer().resources.hp.current;
const maxHp = () => gameState.getPlayer().resources.hp.max;
const ap    = () => gameState.getPlayer().resources.ap.current;

// Minimal engine mock — satisfies CombatSystem constructor and all methods under test.
// No DOM calls originate from the methods under test (renderer is overridden below).
function makeMockEngine(items = {}) {
  const engine = {
    data: { items, npcs: {}, rules: { playerDefaults: { equipmentSlots: SLOTS } } },
    state: gameState,
    t: (key) => key,
    log: () => {},
    scene: { reset: () => {} },
    openScene: () => {},
    currentSceneEl: { appendChild: () => {} },
    renderScene: () => {},
    // Mode machine — mirrors the real engine's facades over this.mode.
    mode: 'scene',
    setMode(mode) { this.mode = mode; },
    get inCombat()   { return this.mode === 'combat'; },
    get isGameOver() { return this.mode === 'gameover'; },
    snapshotNavigation() {
      const sceneId = gameState.getCurrentSceneId();
      const mode = this.mode;
      return () => gameState.getCurrentSceneId() !== sceneId || this.mode !== mode;
    },
    // Minimal runActions: handles set_flag so onVictory pipelines work in tests.
    runActions(actions) {
      for (const a of (actions || [])) {
        if (a.type === 'set_flag') gameState.setFlag(a.flag, a.value);
      }
    },
  };
  return engine;
}

// Minimal weapon fixture.
function makeWeapon({ actionPoints = 1, damageRoll = '1d6', ac = 0, attackAttribute } = {}) {
  return { name: 'Test Sword', type: 'Weapon', attributes: { actionPoints, damageRoll, attackAttribute } };
}

// Minimal enemy fixture. healthPoints > 0 so the loop doesn't skip it.
function makeEnemy({ hp = 50, ac = 5, ap = 3, initRoll = 0 } = {}) {
  return {
    name: 'Test Enemy',
    attributes: { healthPoints: hp, armorClass: ac, actionPoints: ap },
    equipment: {},
    initiativeRoll: initRoll,
  };
}

// Build a CombatSystem with mocked renderer so no DOM is touched.
function makeCS(items = {}) {
  const engine = makeMockEngine(items);
  const cs = new CombatSystem(engine);
  cs.renderer = { render: () => {}, renderGameOver: () => {} };
  // Mirrors engine.js _spendAP: spend, then hand the spend to the combat system.
  engine._spendAP = (cost) => {
    gameState.modifyPlayerStat('ap', -cost);
    cs.notePlayerSpentAP();
    return true;
  };
  return cs;
}

// Dice are mocked through Math.random: 0 rolls 1 on every die, 0.9999 rolls
// the max (20 on a d20). The player's AC is 10.
beforeEach(() => {
  gameState.init(TEST_RULES);
});
afterEach(() => mock.restoreAll());

// ─── _resolveEnemyWeapon ─────────────────────────────────────────────────────

test('_resolveEnemyWeapon: falls back to ENEMY_CLAW_ID when no weapon equipped', () => {
  const claw = makeWeapon({ damageRoll: '1d4' });
  const cs = makeCS({ [ENEMY_CLAW_ID]: claw });
  const enemy = makeEnemy();
  assert.equal(cs._resolveEnemyWeapon(enemy), claw);
});

test('_resolveEnemyWeapon: returns the weapon in a hand slot', () => {
  const sword = makeWeapon();
  const cs = makeCS({ sword });
  const enemy = makeEnemy();
  enemy.equipment = { right_hand: 'sword' };
  assert.equal(cs._resolveEnemyWeapon(enemy), sword);
});

// ─── _resolveEnemyAttacks ────────────────────────────────────────────────────

test('_resolveEnemyAttacks: all misses when roll cannot beat player AC', () => {
  mock.method(Math, 'random', () => 0);

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const enemy = makeEnemy({ ap: 3 });
  const result = cs._resolveEnemyAttacks(weapon, 3, enemy);

  assert.equal(result.attackCount, 3);
  assert.equal(result.hits, 0);
  assert.equal(result.misses, 3);
  assert.equal(result.totalDamage, 0);
  assert.equal(hp(), maxHp());
});

test('_resolveEnemyAttacks: all hits when roll beats player AC', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const enemy = makeEnemy({ ap: 2 });
  const playerHpBefore = hp();
  const result = cs._resolveEnemyAttacks(weapon, 2, enemy);

  assert.equal(result.attackCount, 2);
  assert.equal(result.hits, 2);
  assert.equal(result.misses, 0);
  assert.ok(result.totalDamage > 0);
  assert.ok(hp() < playerHpBefore);
});

test('_resolveEnemyAttacks: stops early when player HP reaches 0', () => {
  mock.method(Math, 'random', () => 0.9999);

  gameState.modifyPlayerStat('hp', -(maxHp() - 1)); // set HP to 1

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const enemy = makeEnemy({ ap: 5 });
  const result = cs._resolveEnemyAttacks(weapon, 5, enemy);

  // Loop should have stopped after player HP hit 0 — far fewer than 5 attacks
  assert.ok(result.attackCount < 5, `Expected early stop, got ${result.attackCount} attacks`);
  assert.equal(hp(), 0);
});

test('_resolveEnemyAttacks: attribute-less weapons roll a bare d20 vs player AC', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.t = paramEchoT;
  const result = cs._resolveEnemyAttacks(makeWeapon({ actionPoints: 1 }), 1, makeEnemy());

  assert.match(result.hitRolls[0], /enemyAttackRoll/);
  assert.match(result.hitRolls[0], /"roll":20/);
  assert.match(result.hitRolls[0], /"breakdown":"1d20: 20"/);
  assert.match(result.hitRolls[0], /"ac":10/);
});

// ─── playerAttack ────────────────────────────────────────────────────────────

test('playerAttack: hit reduces enemy HP and costs AP', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const enemy = makeEnemy({ hp: 100, ac: 5 });
  cs.enemies = [enemy];

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const apBefore = ap();

  cs.playerAttack(weapon, enemy);

  assert.ok(enemy.attributes.healthPoints < 100, 'Enemy HP should be reduced on hit');
  assert.equal(ap(), apBefore - 1, 'AP should be spent');
});

test('playerAttack: miss leaves enemy HP unchanged, still costs AP', () => {
  mock.method(Math, 'random', () => 0);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const enemy = makeEnemy({ hp: 50, ac: 100 });
  cs.enemies = [enemy];

  const weapon = makeWeapon({ actionPoints: 1 });
  const apBefore = ap();

  cs.playerAttack(weapon, enemy);

  assert.equal(enemy.attributes.healthPoints, 50, 'Enemy HP should not change on miss');
  assert.equal(ap(), apBefore - 1, 'AP should still be spent on miss');
});

test('playerAttack: an attack the turn budget cannot afford resolves nothing', () => {
  // The renderer disables unaffordable buttons, but the precheck must hold on
  // its own — damage lands before the spend, and the two must never disagree.
  mock.method(Math, 'random', () => 0.9999); // would always hit if the attack ran

  const cs = makeCS();
  cs.engine.setMode('combat');
  const enemy = makeEnemy({ hp: 50, ac: 5 });
  cs.enemies = [enemy];

  gameState.modifyPlayerStat('ap', -3); // drain the pool to 0
  cs.playerAttack(makeWeapon({ actionPoints: 2 }), enemy);

  assert.equal(enemy.attributes.healthPoints, 50, 'no damage may land on a refused spend');
  assert.equal(ap(), 0);
});

test('playerAttack: calls endCombat when last enemy is defeated', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const enemy = makeEnemy({ hp: 1, ac: 1 }); // 1 HP, dies on first hit
  cs.enemies = [enemy];

  let endCombatCalled = false;
  cs.endCombat = (isVictory) => { endCombatCalled = true; assert.equal(isVictory, true); };

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.playerAttack(weapon, enemy);

  assert.ok(endCombatCalled, 'endCombat should be called when last enemy dies');
});

// ─── rest-limited uses (attributes.uses) ─────────────────────────────────────

test('playerAttack: a rest-limited spell spends one use per cast, hit or miss, and refuses when spent', () => {
  let roll = 0.9999; // hits AC 5
  mock.method(Math, 'random', () => roll);

  const spell = {
    id: 'test_fireball', name: 'Test Fireball', type: 'Spell',
    attributes: { actionPoints: 1, damageRoll: '1d6', uses: { max: 2, refresh: 'full_rest' } },
  };
  const items = { test_fireball: spell };
  gameState.init(TEST_RULES, items);
  const cs = makeCS(items);
  cs.engine.setMode('combat');
  const enemy = makeEnemy({ hp: 100, ac: 5 });
  cs.enemies = [enemy];

  cs.playerAttack(spell, enemy);
  assert.deepEqual(gameState.getItemUses('test_fireball'), { current: 1, max: 2, refresh: 'full_rest' });

  roll = 0; // the second cast misses — the use is spent regardless
  cs.playerAttack(spell, enemy);
  assert.deepEqual(gameState.getItemUses('test_fireball'), { current: 0, max: 2, refresh: 'full_rest' });

  // Spent: the cast resolves nothing — no damage, no AP, no negative uses.
  roll = 0.9999;
  const hpBefore = enemy.attributes.healthPoints;
  const apBefore = ap();
  cs.playerAttack(spell, enemy);
  assert.equal(enemy.attributes.healthPoints, hpBefore, 'no damage may land on a refused cast');
  assert.equal(ap(), apBefore, 'no AP spends on a refused cast');
  assert.deepEqual(gameState.getItemUses('test_fireball'), { current: 0, max: 2, refresh: 'full_rest' });
});

// ─── playerAttackMulti (targets: "all") ────────────────────────────────────────

// Minimal AoE weapon fixture — one cast strikes every living enemy.
function makeAoeWeapon({ actionPoints = 3, damageRoll = '1d6', attackAttribute, damageAttribute } = {}) {
  return { name: 'Test Blast', type: 'Spell', attributes: { actionPoints, damageRoll, attackAttribute, damageAttribute, targets: 'all' } };
}

test('playerAttackMulti: one roll catches every enemy it meets and misses the rest', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const caught = makeEnemy({ hp: 100, ac: 5 });
  const missed = makeEnemy({ hp: 100, ac: 100 });
  cs.enemies = [caught, missed];

  cs.playerAttackMulti(makeAoeWeapon());

  assert.ok(caught.attributes.healthPoints < 100, 'the roll meets AC 5 — damage lands');
  assert.equal(missed.attributes.healthPoints, 100, 'the same roll cannot meet AC 100');
});

test('playerAttackMulti: each caught enemy takes its own damage roll', () => {
  // One d20 (max), then two independent d6s: 6 for the first enemy, 1 for
  // the second — distinct deltas prove per-target dice.
  const rolls = [0.9999, 0.9999, 0];
  mock.method(Math, 'random', () => rolls.shift() ?? 0);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const first = makeEnemy({ hp: 100, ac: 5 });
  const second = makeEnemy({ hp: 100, ac: 5 });
  cs.enemies = [first, second];

  cs.playerAttackMulti(makeAoeWeapon());

  assert.equal(first.attributes.healthPoints, 94);
  assert.equal(second.attributes.healthPoints, 99);
});

test('playerAttackMulti: spends the AP cost once, not per enemy', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy({ hp: 100, ac: 5 }), makeEnemy({ hp: 100, ac: 5 })];
  const apBefore = ap();

  cs.playerAttackMulti(makeAoeWeapon({ actionPoints: 1 }));

  assert.equal(ap(), apBefore - 1);
});

test('playerAttackMulti: calls endCombat once when the cast fells every enemy', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy({ hp: 1, ac: 1 }), makeEnemy({ hp: 1, ac: 1 })];

  let endCombatCalls = 0;
  cs.endCombat = (isVictory) => { endCombatCalls++; assert.equal(isVictory, true); };

  cs.playerAttackMulti(makeAoeWeapon());

  assert.equal(endCombatCalls, 1);
});

test('splashTargets: a window on the enemy line, centered where the ends allow', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'];
  const line = [a, b, c, d, e];

  // Mid-line: the target sits in the middle of the window.
  assert.deepEqual(splashTargets(line, c, 3), [b, c, d]);
  // At the ends the window clamps instead of wrapping — a blast on the
  // front never catches the back rank.
  assert.deepEqual(splashTargets(line, a, 3), [a, b, c]);
  assert.deepEqual(splashTargets(line, e, 3), [c, d, e]);
  // An even cap leans forward: the target plus the next in line.
  assert.deepEqual(splashTargets(line, c, 2), [c, d]);
  // A cap covering everyone is everyone, whatever was clicked.
  assert.deepEqual(splashTargets(line, b, 5), line);
  assert.deepEqual(splashTargets(line, b, 9), line);
});

test('playerAttackMulti: an explicit target list burns only the chosen', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const first = makeEnemy({ hp: 100, ac: 5 });
  const spared = makeEnemy({ hp: 100, ac: 5 });
  const third = makeEnemy({ hp: 100, ac: 5 });
  cs.enemies = [first, spared, third];

  const weapon = makeAoeWeapon();
  weapon.attributes.targets = 3;
  cs.playerAttackMulti(weapon, [first, third]);

  assert.ok(first.attributes.healthPoints < 100);
  assert.equal(spared.attributes.healthPoints, 100, 'an unaimed enemy is untouched');
  assert.ok(third.attributes.healthPoints < 100);
});

test('playerAttackMulti: a dead enemy is not a target', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  const dead = makeEnemy({ hp: 0, ac: 1 });
  const living = makeEnemy({ hp: 100, ac: 1 });
  cs.enemies = [dead, living];

  cs.playerAttackMulti(makeAoeWeapon());

  assert.equal(dead.attributes.healthPoints, 0, 'the fallen take no further damage');
  assert.ok(living.attributes.healthPoints < 100);
});

// ─── damageAttribute ─────────────────────────────────────────────────────────

test('playerAttack: the weapon\'s damageAttribute joins the damage total and breakdown', () => {
  mock.method(Math, 'random', () => 0.9999);

  gameState.init(makeRules({ playerDefaults: { equipmentSlots: SLOTS, attributes: { ac: 10, initiative: 0, intelligence: 3 } } }));
  const cs = makeCS();
  cs.engine.t = paramEchoT;
  cs.engine.setMode('combat');
  const enemy = makeEnemy({ hp: 100, ac: 5 });
  cs.enemies = [enemy];

  const logged = [];
  cs.engine.log = (type, message) => logged.push(message);
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  weapon.attributes.damageAttribute = 'intelligence';
  cs.playerAttack(weapon, enemy);

  assert.equal(enemy.attributes.healthPoints, 91); // 6 + 3 Intelligence
  assert.match(logged[1], /"damage":9/);
  assert.match(logged[1], /6 \+ 3 Intelligence/);
});

test('_resolveEnemyAttacks: the enemy\'s own attribute powers the weapon\'s damageAttribute', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  weapon.attributes.damageAttribute = 'strength';
  const enemy = makeEnemy();
  enemy.attributes.strength = 2;
  const result = cs._resolveEnemyAttacks(weapon, 1, enemy);

  assert.equal(result.totalDamage, 8); // 6 + 2 Strength
});

test('_rollDamage: a negative attribute cannot heal the target', () => {
  mock.method(Math, 'random', () => 0); // 1d6 → 1

  const cs = makeCS();
  const weapon = makeWeapon({ damageRoll: '1d6' });
  weapon.attributes.damageAttribute = 'strength';
  const result = cs._rollDamage(weapon, { strength: -5 });

  assert.equal(result.total, 0); // clamped, not -4
});

// ─── enemyTurn ───────────────────────────────────────────────────────────────

test('enemyTurn: phase "after" — enemy with lower init than player attacks', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.playerInit = 15;

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.engine.data.items[ENEMY_CLAW_ID] = weapon;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 5 }); // initRoll(5) <= playerInit(15)
  cs.enemies = [enemy];

  const hpBefore = hp();
  cs.enemyTurn('after');

  assert.ok(hp() < hpBefore, 'Enemy should attack player in "after" phase');
});

test('enemyTurn: phase "after" — enemy with higher init than player does NOT attack', () => {
  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.playerInit = 5;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 15 }); // initRoll(15) > playerInit(5)
  cs.enemies = [enemy];

  const hpBefore = hp();
  cs.enemyTurn('after');

  assert.equal(hp(), hpBefore, 'High-init enemy should not act in "after" phase');
});

test('enemyTurn: phase "before" — enemy with higher init than player attacks', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.playerInit = 5;

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.engine.data.items[ENEMY_CLAW_ID] = weapon;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 15 }); // initRoll(15) > playerInit(5)
  cs.enemies = [enemy];

  const hpBefore = hp();
  cs.enemyTurn('before');

  assert.ok(hp() < hpBefore, 'High-init enemy should attack in "before" phase');
});

test('enemyTurn: dead enemy is skipped even if phase matches', () => {
  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.playerInit = 15;

  const enemy = makeEnemy({ hp: 0, ac: 1, ap: 3, initRoll: 5 }); // dead
  cs.enemies = [enemy];

  const hpBefore = hp();
  cs.enemyTurn('after');

  assert.equal(hp(), hpBefore, 'Dead enemy should not attack');
});

// ─── endCombat ───────────────────────────────────────────────────────────────

test('endCombat: runs onVictory action pipeline on victory', () => {
  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy({ hp: 0 })]; // already defeated
  cs.originOption = { onVictory: [{ type: 'set_flag', flag: 'boss_defeated', value: true }] };

  gameState.setFlag('boss_defeated', false);
  cs.endCombat(true);

  assert.equal(gameState.getFlag('boss_defeated'), true, 'onVictory actions should run after winning');
});

test('endCombat: defeat transitions the mode machine to gameover', () => {
  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy()];
  cs.originOption = {};

  cs.endCombat(false);

  assert.equal(cs.inCombat, false);
  assert.equal(cs.engine.mode, 'gameover');
});

test('enemyTurn: calls endCombat(false) when player HP hits 0', () => {
  mock.method(Math, 'random', () => 0.9999);

  gameState.modifyPlayerStat('hp', -(maxHp() - 1));

  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.playerInit = 15;

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.engine.data.items[ENEMY_CLAW_ID] = weapon;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 5 });
  cs.enemies = [enemy];

  let endCombatArg = null;
  cs.endCombat = (isVictory) => { endCombatArg = isVictory; };

  cs.enemyTurn('after');

  assert.equal(endCombatArg, false, 'endCombat(false) should be called when player dies');
});

// ─── endCombat: victory re-render ────────────────────────────────────────────

test('endCombat: victory re-render skips the scene autoAttack', () => {
  const cs = makeCS();
  const rendered = [];
  cs.engine.renderScene = (sceneId, opts) => rendered.push({ sceneId, opts });
  gameState.setCurrentSceneId('corridor');
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy({ hp: 0 })];
  cs.originOption = { onVictory: [] };

  cs.endCombat(true);

  assert.equal(cs.inCombat, false);
  // heard it on the way in; only combat's reset of the description cache
  // makes the block (and without this, its audio) repeat.
  assert.deepEqual(rendered, [{ sceneId: 'corridor', opts: { skipAutoAttack: true } }]);
});

test('endCombat: no re-render when onVictory opened a dialogue', () => {
  const cs = makeCS();
  let rendered = 0;
  cs.engine.renderScene = () => rendered++;
  cs.engine.runActions = () => { cs.engine.setMode('dialogue'); };
  gameState.setCurrentSceneId('corridor');
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy({ hp: 0 })];
  cs.originOption = { onVictory: [{ type: 'dialogue', npc: 'stranger' }] };

  cs.endCombat(true);

  assert.equal(rendered, 0);
});

// ─── AP (per-combat tactical budget) ─────────────────────────────────────────

test('round end recharges the AP pool to full', () => {
  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.enemies = [];
  gameState.modifyPlayerStat('ap', -2);
  cs.enemyTurn('after');
  assert.equal(ap(), 3);
});

test('endCombat victory restores AP to max at the boundary', () => {
  const cs = makeCS();
  cs.engine.setMode('combat');
  cs.enemies = [makeEnemy({ hp: 0 })];
  gameState.modifyPlayerStat('ap', -2);
  cs.endCombat(true);
  assert.equal(ap(), 3);
});

// ─── attackAttribute ─────────────────────────────────────────────────────────

test('playerAttack: the weapon\'s attackAttribute joins the hit roll and breakdown', () => {
  mock.method(Math, 'random', () => 0.9999);

  gameState.init(makeRules({ playerDefaults: { equipmentSlots: SLOTS, attributes: { ac: 10, initiative: 0, strength: 2 } } }));
  const cs = makeCS();
  cs.engine.t = paramEchoT;
  cs.engine.setMode('combat');
  const enemy = makeEnemy();
  cs.enemies = [enemy];

  cs.playerAttack(makeWeapon({ actionPoints: 1, attackAttribute: 'strength' }), enemy);

  const logged = [];
  // playerAttack logs through engine.log — recapture via a fresh attack with a collector.
  cs.engine.log = (type, message) => logged.push(message);
  cs.playerAttack(makeWeapon({ actionPoints: 1, attackAttribute: 'strength' }), enemy);
  assert.match(logged[0], /"roll":22/);                       // 20 + 2 Strength
  assert.match(logged[0], /1d20: 20 \+ 2 Strength/);
});

test('_resolveEnemyAttacks: the enemy\'s own attribute powers the weapon\'s attackAttribute', () => {
  mock.method(Math, 'random', () => 0.9999);

  const cs = makeCS();
  cs.engine.t = paramEchoT;
  const weapon = makeWeapon({ actionPoints: 1, attackAttribute: 'strength' });
  const enemy = makeEnemy();
  enemy.attributes.strength = 3;
  const result = cs._resolveEnemyAttacks(weapon, 1, enemy);

  assert.match(result.hitRolls[0], /"roll":23/);              // 20 + 3 Strength
  assert.match(result.hitRolls[0], /1d20: 20 \+ 3 Strength/);
});

// ─── getAvailableAttacks ─────────────────────────────────────────────────────

// The attack list is a pure read of equipment + item data, so the renderer
// runs here with no DOM behind it.
function makeRenderer(items, equipment, rules = {}) {
  const cs = makeCS(items);
  cs.engine.data.rules = { ...cs.engine.data.rules, ...rules };
  Object.assign(gameState.getPlayer().equipment, equipment);
  return new CombatRenderer(cs);
}

const FLAMES = { id: 'flames', name: 'Flames', type: 'Spell', attributes: { actionPoints: 2, damageRoll: '2d6' } };
const SWORD  = { id: 'sword', name: 'Sword', type: 'Weapon', attributes: { actionPoints: 1, damageRoll: '1d8' } };
const SHIELD = { id: 'shield', name: 'Shield', type: 'Armor', slot: 'hand', attributes: { armorClassBonus: 2 } };
const CIRCLET = { id: 'circlet', name: 'Circlet', type: 'Armor', slot: 'head', attributes: { grantsSpells: ['flames'] } };

test('getAvailableAttacks: worn gear grants its spell with both hands full', () => {
  const renderer = makeRenderer(
    { flames: FLAMES, sword: SWORD, shield: SHIELD, circlet: CIRCLET },
    { left_hand: 'shield', right_hand: 'sword', head: 'circlet' }
  );
  assert.deepEqual(renderer.getAvailableAttacks(), [SWORD, FLAMES],
    'the held weapon leads, the granted spell follows — no hand needed');
});

test('getAvailableAttacks: the granted spell leaves the list when the item comes off', () => {
  const renderer = makeRenderer(
    { flames: FLAMES, sword: SWORD, circlet: CIRCLET },
    { right_hand: 'sword', head: 'circlet' }
  );
  gameState.getPlayer().equipment.head = null;
  assert.deepEqual(renderer.getAvailableAttacks(), [SWORD]);
});

test('getAvailableAttacks: a spell held and granted at once is one button', () => {
  const renderer = makeRenderer(
    { flames: FLAMES, circlet: CIRCLET },
    { right_hand: 'flames', head: 'circlet' }
  );
  assert.deepEqual(renderer.getAvailableAttacks(), [FLAMES],
    'the charges are the spell\'s, so two sources must not split the pool across two buttons');
});

test('getAvailableAttacks: empty hands keep the unarmed fallback beside the granted spell', () => {
  const unarmed = { id: 'unarmed', name: 'Fists', type: 'Weapon', attributes: { actionPoints: 1, damageRoll: '1d4' } };
  const renderer = makeRenderer(
    { flames: FLAMES, circlet: CIRCLET, unarmed },
    { head: 'circlet' },
    { fallbackWeapons: { player: 'unarmed' } }
  );
  assert.deepEqual(renderer.getAvailableAttacks(), [unarmed, FLAMES]);
});
