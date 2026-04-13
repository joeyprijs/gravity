import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CombatSystem } from '../src/systems/combat.js';
import { gameState } from '../src/core/state.js';
import { ENEMY_CLAW_ID } from '../src/core/config.js';

// Minimal engine mock — satisfies CombatSystem constructor and all methods under test.
// No DOM calls originate from the methods under test (renderer is overridden below).
function makeMockEngine(items = {}) {
  return {
    data: { items, npcs: {} },
    t: (key) => key,
    log: () => {},
    emit: () => {},
    on: () => {},
    scene: { reset: () => {} },
    openScene: () => {},
    currentSceneEl: { appendChild: () => {} },
    renderScene: () => {},
  };
}

// Minimal weapon fixture.
function makeWeapon({ actionPoints = 1, damageRoll = '1d6', bonusHitChance = 0, ac = 0 } = {}) {
  return { name: 'Test Sword', type: 'Weapon', actionPoints, attributes: { damageRoll }, bonusHitChance };
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
  cs.renderer = { render: () => {} };
  return cs;
}

beforeEach(() => {
  gameState.reset();
});

// ─── _resolveEnemyWeapon ─────────────────────────────────────────────────────

test('_resolveEnemyWeapon: returns equipped Right Hand item', () => {
  const sword = makeWeapon();
  const cs = makeCS({ sword });
  const enemy = makeEnemy();
  enemy.equipment = { 'Right Hand': 'sword' };
  assert.equal(cs._resolveEnemyWeapon(enemy), sword);
});

test('_resolveEnemyWeapon: falls back to ENEMY_CLAW_ID when no weapon equipped', () => {
  const claw = makeWeapon({ damageRoll: '1d4' });
  const cs = makeCS({ [ENEMY_CLAW_ID]: claw });
  const enemy = makeEnemy();
  assert.equal(cs._resolveEnemyWeapon(enemy), claw);
});

test('_resolveEnemyWeapon: returns null when no weapon and no claw in data', () => {
  const cs = makeCS({});
  const enemy = makeEnemy();
  assert.equal(cs._resolveEnemyWeapon(enemy), null);
});

// ─── _resolveEnemyAttacks ────────────────────────────────────────────────────

test('_resolveEnemyAttacks: all misses when roll cannot beat player AC', () => {
  // BASE_AC = 10. Math.random=0 → roll(1,20)=1. 1 < 10 → miss.
  const orig = Math.random;
  Math.random = () => 0;

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const enemy = makeEnemy({ ap: 3 });
  const result = cs._resolveEnemyAttacks(weapon, 3, enemy);

  assert.equal(result.attackCount, 3);
  assert.equal(result.hits, 0);
  assert.equal(result.misses, 3);
  assert.equal(result.totalDamage, 0);
  assert.equal(gameState.getPlayer().hp, gameState.getPlayer().maxHp); // unchanged

  Math.random = orig;
});

test('_resolveEnemyAttacks: all hits when roll beats player AC', () => {
  // Math.random=0.9999 → roll(1,20)=20. 20 >= 10 → hit.
  const orig = Math.random;
  Math.random = () => 0.9999;

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const enemy = makeEnemy({ ap: 2 });
  const playerHpBefore = gameState.getPlayer().hp;
  const result = cs._resolveEnemyAttacks(weapon, 2, enemy);

  assert.equal(result.attackCount, 2);
  assert.equal(result.hits, 2);
  assert.equal(result.misses, 0);
  assert.ok(result.totalDamage > 0);
  assert.ok(gameState.getPlayer().hp < playerHpBefore);

  Math.random = orig;
});

test('_resolveEnemyAttacks: attackCount matches AP budget', () => {
  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 2 });
  const enemy = makeEnemy();
  const result = cs._resolveEnemyAttacks(weapon, 4, enemy); // 4 AP / 2 cost = 2 attacks
  assert.equal(result.attackCount, 2);
});

test('_resolveEnemyAttacks: zero attacks when eAP below weapon cost', () => {
  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 3 });
  const enemy = makeEnemy();
  const result = cs._resolveEnemyAttacks(weapon, 2, enemy); // 2 AP < 3 cost
  assert.deepEqual(result, { attackCount: 0, hits: 0, misses: 0, totalDamage: 0, hitRolls: [], missRolls: [], damageRolls: [] });
});

test('_resolveEnemyAttacks: stops early when player HP reaches 0', () => {
  // Always hit, player has 1 HP and weapon does guaranteed damage
  const orig = Math.random;
  Math.random = () => 0.9999; // always roll 20, always hit

  gameState.modifyPlayerStat('hp', -(gameState.getPlayer().maxHp - 1)); // set HP to 1

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const enemy = makeEnemy({ ap: 5 });
  const result = cs._resolveEnemyAttacks(weapon, 5, enemy);

  // Loop should have stopped after player HP hit 0 — far fewer than 5 attacks
  assert.ok(result.attackCount < 5, `Expected early stop, got ${result.attackCount} attacks`);
  assert.equal(gameState.getPlayer().hp, 0);

  Math.random = orig;
});

test('_resolveEnemyAttacks: bonusHitChance is reflected in hitRolls string', () => {
  const orig = Math.random;
  Math.random = () => 0.9999;

  const cs = makeCS();
  const weapon = makeWeapon({ actionPoints: 1, bonusHitChance: 2 });
  const enemy = makeEnemy();
  const result = cs._resolveEnemyAttacks(weapon, 1, enemy);

  // Roll = 20, modifier = +2, so string should contain "+2"
  assert.ok(result.hitRolls[0].includes('+2'), `Expected "+2" in "${result.hitRolls[0]}"`);

  Math.random = orig;
});

// ─── playerAttack ────────────────────────────────────────────────────────────

test('playerAttack: hit reduces enemy HP and costs AP', () => {
  // Roll 20 always hits (AC=5 enemy). Damage = parseDamage('1d6') with Math.random=0.9999 → 6.
  const orig = Math.random;
  Math.random = () => 0.9999;

  const cs = makeCS();
  cs.inCombat = true;
  const enemy = makeEnemy({ hp: 100, ac: 5 });
  cs.enemies = [enemy];

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d6' });
  const apBefore = gameState.getPlayer().ap;

  cs.playerAttack(weapon, enemy);

  assert.ok(enemy.attributes.healthPoints < 100, 'Enemy HP should be reduced on hit');
  assert.equal(gameState.getPlayer().ap, apBefore - 1, 'AP should be spent');

  Math.random = orig;
});

test('playerAttack: miss leaves enemy HP unchanged, still costs AP', () => {
  // Roll 1 never hits AC=100 enemy
  const orig = Math.random;
  Math.random = () => 0;

  const cs = makeCS();
  cs.inCombat = true;
  const enemy = makeEnemy({ hp: 50, ac: 100 });
  cs.enemies = [enemy];

  const weapon = makeWeapon({ actionPoints: 1 });
  const apBefore = gameState.getPlayer().ap;

  cs.playerAttack(weapon, enemy);

  assert.equal(enemy.attributes.healthPoints, 50, 'Enemy HP should not change on miss');
  assert.equal(gameState.getPlayer().ap, apBefore - 1, 'AP should still be spent on miss');

  Math.random = orig;
});

test('playerAttack: calls endCombat when last enemy is defeated', () => {
  const orig = Math.random;
  Math.random = () => 0.9999; // always hit

  const cs = makeCS();
  cs.inCombat = true;
  const enemy = makeEnemy({ hp: 1, ac: 1 }); // 1 HP, dies on first hit
  cs.enemies = [enemy];

  let endCombatCalled = false;
  cs.endCombat = (isVictory) => { endCombatCalled = true; assert.equal(isVictory, true); };

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.playerAttack(weapon, enemy);

  assert.ok(endCombatCalled, 'endCombat should be called when last enemy dies');

  Math.random = orig;
});

// ─── enemyTurn ───────────────────────────────────────────────────────────────

test('enemyTurn: phase "after" — enemy with lower init than player attacks', () => {
  const orig = Math.random;
  Math.random = () => 0.9999; // always hit

  const cs = makeCS();
  cs.inCombat = true;
  cs.playerInit = 15;

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.engine.data.items[ENEMY_CLAW_ID] = weapon;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 5 }); // initRoll(5) <= playerInit(15)
  cs.enemies = [enemy];

  const hpBefore = gameState.getPlayer().hp;
  cs.enemyTurn('after');

  assert.ok(gameState.getPlayer().hp < hpBefore, 'Enemy should attack player in "after" phase');

  Math.random = orig;
});

test('enemyTurn: phase "after" — enemy with higher init than player does NOT attack', () => {
  const cs = makeCS();
  cs.inCombat = true;
  cs.playerInit = 5;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 15 }); // initRoll(15) > playerInit(5)
  cs.enemies = [enemy];

  const hpBefore = gameState.getPlayer().hp;
  cs.enemyTurn('after');

  assert.equal(gameState.getPlayer().hp, hpBefore, 'High-init enemy should not act in "after" phase');
});

test('enemyTurn: phase "before" — enemy with higher init than player attacks', () => {
  const orig = Math.random;
  Math.random = () => 0.9999;

  const cs = makeCS();
  cs.inCombat = true;
  cs.playerInit = 5;

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.engine.data.items[ENEMY_CLAW_ID] = weapon;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 15 }); // initRoll(15) > playerInit(5)
  cs.enemies = [enemy];

  const hpBefore = gameState.getPlayer().hp;
  cs.enemyTurn('before');

  assert.ok(gameState.getPlayer().hp < hpBefore, 'High-init enemy should attack in "before" phase');

  Math.random = orig;
});

test('enemyTurn: dead enemy is skipped even if phase matches', () => {
  const cs = makeCS();
  cs.inCombat = true;
  cs.playerInit = 15;

  const enemy = makeEnemy({ hp: 0, ac: 1, ap: 3, initRoll: 5 }); // dead
  cs.enemies = [enemy];

  const hpBefore = gameState.getPlayer().hp;
  cs.enemyTurn('after');

  assert.equal(gameState.getPlayer().hp, hpBefore, 'Dead enemy should not attack');
});

test('enemyTurn: calls endCombat(false) when player HP hits 0', () => {
  const orig = Math.random;
  Math.random = () => 0.9999;

  // Set player HP to 1 so one hit kills them
  gameState.modifyPlayerStat('hp', -(gameState.getPlayer().maxHp - 1));

  const cs = makeCS();
  cs.inCombat = true;
  cs.playerInit = 15;

  const weapon = makeWeapon({ actionPoints: 1, damageRoll: '1d4' });
  cs.engine.data.items[ENEMY_CLAW_ID] = weapon;

  const enemy = makeEnemy({ hp: 10, ac: 1, ap: 1, initRoll: 5 });
  cs.enemies = [enemy];

  let endCombatArg = null;
  cs.endCombat = (isVictory) => { endCombatArg = isVictory; };

  cs.enemyTurn('after');

  assert.equal(endCombatArg, false, 'endCombat(false) should be called when player dies');

  Math.random = orig;
});
