import { buildSceneDescription, handSlots } from '../core/utils.js';
import { MAX_D20_ROLL, CSS, LOG, ENEMY_CLAW_ID } from '../core/config.js';
import { roll, parseDamage } from './dice.js';
import { rollBreakdown, skillLabel } from './skill-checks.js';
import { formatList, isOne } from '../core/i18n.js';
import { CombatRenderer } from '../ui/combat-ui.js';

// CombatSystem manages the full lifecycle of a turn-based encounter:
//
// 1. startCombat() rolls initiative for every combatant.
// 2. Enemies that out-rolled the player act first (the "before" phase).
// 3. The player acts, spending Action Points on attacks or item use.
// 4. Ending the player's turn triggers the slower enemies (the "after" phase).
// 5. The round closes: AP recharges to full, and fast enemies open the next
//    round.
// 6. HP is checked after every attack to resolve victory or defeat.
export class CombatSystem {
  constructor(engine) {
    this.engine = engine;
    this.enemies = [];

    // originOption captures the scene option action that triggered this encounter.
    // On victory, the option's onVictory actions array is executed as a pipeline.
    this.originOption = null;
    this.playerInit = 0;
    this.renderer = new CombatRenderer(this);
  }

  // Whether a combat encounter is active / ended in defeat — facades over the
  // engine's mode machine, which is the single source of truth.
  get inCombat()   { return this.engine.inCombat; }
  get isGameOver() { return this.engine.isGameOver; }

  /**
   * Called by engine._spendAP after every combat AP spend. Hands the turn to
   * the enemies once the player's AP is exhausted; otherwise refreshes the
   * combat controls.
   */
  notePlayerSpentAP() {
    if (!this.inCombat) return;
    if (this.engine.state.getPlayer().resources.ap.current <= 0) {
      this.enemyTurn('after');
    } else {
      this.renderer.render(); // reflect the depleted AP on the attack buttons
    }
  }

  /**
   * Initializes a combat encounter, rolls initiatives, and launches the first round.
   *
   * @param {string[]} enemyIds - Array of NPC identifiers to fight (e.g. ["goblin_guard"]).
   * @param {object} originOption - The action pipeline node that triggered this combat.
   * @param {{fromSceneEntry?: boolean}} [opts] - `fromSceneEntry` marks an
   *   `autoAttack` ambush, where the scene description just framed the
   *   encounter and the enemy's own description would repeat it.
   */
  startCombat(enemyIds, originOption, { fromSceneEntry = false } = {}) {
    // Clone enemy templates so battles never mutate the loaded base data.
    const enemyDataList = enemyIds.map(id => {
      const data = this.engine.data.npcs[id];
      if (!data) {
        console.warn(`[Gravity] startCombat: unknown enemy template ID "${id}"`);
        return null;
      }
      const clone = structuredClone(data);
      clone.id = id;
      return clone;
    }).filter(Boolean);

    if (!enemyDataList.length) return;

    this.engine.resetScene();
    this.engine.setMode('combat');
    this.enemies = enemyDataList;
    this.originOption = originOption;

    // AP is a per-combat tactical budget: the player always begins a fight
    // fully charged.
    this.engine.state.modifyPlayerStat('ap', 'full');
    const player = this.engine.state.getPlayer();

    // List grammar comes from Intl, not code (see _narrateEnemyResult).
    const names = formatList(this.engine.language, this.enemies.map(e => e.name));

    this.engine.openScene(CSS.SCENE_COMBAT);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(
        this.engine.t('combat.fightingTitle', { names }),
        // A solo enemy introduces itself at the top of the fight — but only
        // when nothing else framed the encounter. On an ambush the scene
        // description a heartbeat earlier already narrated this instant;
        // whoever framed it owns the prose.
        !fromSceneEntry && this.enemies.length === 1 ? (this.enemies[0].description || null) : null,
        this.engine.t.bind(this.engine)
      )
    );

    this.engine.log(LOG.COMBAT, this.engine.t('combat.started', { names }), 'combat');

    // Initiative: 1d20 + flat modifier; higher acts earlier, ties keep order.
    const initLabel = this.engine.t('combat.initiativeLabel');
    const playerInitBase = roll(1, MAX_D20_ROLL);
    const playerInitMod = player.attributes.initiative ?? 0;
    this.playerInit = playerInitBase + playerInitMod;
    const playerBreakdown = rollBreakdown(playerInitBase, playerInitMod, initLabel);
    let highestEnemyInit = -Infinity;

    this.enemies.forEach(e => {
      const base = roll(1, MAX_D20_ROLL);
      const mod = e.attributes.initiative ?? 0;
      e.initiativeRoll = base + mod;
      e.initiativeBreakdown = rollBreakdown(base, mod, initLabel);
      if (e.initiativeRoll > highestEnemyInit) highestEnemyInit = e.initiativeRoll;
    });

    this.anyEnemyGoesFirst = highestEnemyInit > this.playerInit;

    const enemyRolls = this.enemies
      .map(e => this.engine.t('combat.initiativeEnemy', { name: e.name, roll: e.initiativeRoll, breakdown: e.initiativeBreakdown }))
      .join(', ');

    const allCombatants = [
      { name: this.engine.t('combat.initiativeYou'), roll: this.playerInit },
      ...this.enemies.map(e => ({ name: e.name, roll: e.initiativeRoll ?? 0 }))
    ].sort((a, b) => b.roll - a.roll);

    const turnOrder = allCombatants.map(c => c.name).join(' → ');
    this.engine.log(LOG.COMBAT, this.engine.t('combat.initiative', { playerRoll: this.playerInit, playerBreakdown, enemyRolls }), 'combat');
    this.engine.log(LOG.COMBAT, this.engine.t('combat.turnOrder', { turnOrder }), 'combat');

    this.renderer.render();

    if (this.anyEnemyGoesFirst) this.enemyTurn('before');
  }

  /**
   * Spends one use of a rest-limited weapon/spell (attributes.uses), or
   * refuses when none remain. The spend lands before the attack resolves —
   * the cast is committed hit or miss, and ending combat by the kill can't
   * dodge it. Unlimited items pass through untouched.
   *
   * @param {object} weapon - The item object being used.
   * @returns {boolean} True if the attack may proceed.
   */
  _spendItemUse(weapon) {
    const uses = this.engine.state.getItemUses(weapon.id);
    if (!uses) return true;
    if (uses.current < 1) {
      this.engine.log(LOG.SYSTEM, this.engine.t('player.noUsesLeft', { name: weapon.name }));
      return false;
    }
    this.engine.state.spendItemUse(weapon.id);
    return true;
  }

  /**
   * Executes a player attack using an equipped weapon/spell against a target enemy.
   *
   * @param {object} weapon - The item object being used (Weapon/Spell type).
   * @param {object} targetEnemy - The cloned NPC object being attacked.
   */
  playerAttack(weapon, targetEnemy) {
    // The renderer disables unaffordable attacks, but the damage below lands
    // BEFORE the spend — precheck the turn budget (mirroring items.js's
    // useItem guard) so a call that slipped past the buttons can't resolve an
    // attack the budget can't pay for.
    const apCost = weapon.attributes?.actionPoints ?? 0;
    if (this.remainingTurnBudget() < apCost) {
      this.engine.log(LOG.SYSTEM, this.engine.t('player.notEnoughAP', { cost: apCost }));
      return;
    }
    if (!this._spendItemUse(weapon)) return;

    // Accuracy is the wielder's: d20 + the weapon's governing attribute
    // (attributes.attackAttribute — strength for a sword, intelligence for a
    // spell). Weapons themselves carry no hit bonus; an "accurate blade" is
    // gear with attributeBonuses on the governing attribute.
    const attrId = weapon.attributes?.attackAttribute;
    const attrMod = attrId ? (this.engine.state.getPlayer().attributes[attrId] ?? 0) : 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + attrMod;
    const breakdown = rollBreakdown(baseRoll, attrMod, attrId ? skillLabel(this.engine, attrId) : '');

    if (hitRoll >= targetEnemy.attributes.armorClass) {
      const dmgResult = this._rollDamage(weapon, this.engine.state.getPlayer().attributes);
      targetEnemy.attributes.healthPoints -= dmgResult.total;

      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackHit', {
        weapon: weapon.name, roll: hitRoll, breakdown,
        ac: targetEnemy.attributes.armorClass
      }), 'damage');
      // The damage result is its own log entry (see enemyTurn).
      this.engine.log(LOG.PLAYER, this.engine.t('combat.enemyTakesDamage', {
        target: targetEnemy.name, damage: dmgResult.total,
        dice: weapon.attributes.damageRoll, rollStr: dmgResult.string
      }), 'damage');

      if (this._handleEnemyDefeat(targetEnemy)) return;
      this.engine._spendAP(apCost);
      return;
    }

    this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
      weapon: weapon.name, roll: hitRoll, breakdown, ac: targetEnemy.attributes.armorClass
    }), 'damage');

    this.engine._spendAP(apCost);
  }

  /**
   * Executes a player attack that strikes several enemies with one cast
   * (attributes.targets): one hit roll, compared against each target's AC,
   * with every enemy caught taking its own damage roll.
   *
   * @param {object} weapon - The item object being used (targets: "all" or a cap).
   * @param {object[]|null} [targetEnemies] - The enemies in the blast
   *   (targets: N — splashTargets around the enemy the player attacked).
   *   Null strikes every living enemy (targets: "all").
   */
  playerAttackMulti(weapon, targetEnemies = null) {
    // Same precheck as playerAttack: damage lands before the spend.
    const apCost = weapon.attributes?.actionPoints ?? 0;
    if (this.remainingTurnBudget() < apCost) {
      this.engine.log(LOG.SYSTEM, this.engine.t('player.notEnoughAP', { cost: apCost }));
      return;
    }
    if (!this._spendItemUse(weapon)) return;

    const player = this.engine.state.getPlayer();
    const attrId = weapon.attributes?.attackAttribute;
    const attrMod = attrId ? (player.attributes[attrId] ?? 0) : 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + attrMod;
    const breakdown = rollBreakdown(baseRoll, attrMod, attrId ? skillLabel(this.engine, attrId) : '');

    const living = (targetEnemies ?? this.enemies).filter(e => e.attributes.healthPoints > 0);

    // An aimed cast names its chosen targets; "all" speaks of the field.
    this.engine.log(LOG.PLAYER, targetEnemies
      ? this.engine.t('combat.aoeAttackTargets', {
          weapon: weapon.name, roll: hitRoll, breakdown,
          names: formatList(this.engine.language, living.map(e => e.name))
        })
      : this.engine.t('combat.aoeAttack', {
          weapon: weapon.name, roll: hitRoll, breakdown
        }), 'damage');

    for (const enemy of living) {
      if (hitRoll >= enemy.attributes.armorClass) {
        const dmgResult = this._rollDamage(weapon, player.attributes);
        enemy.attributes.healthPoints -= dmgResult.total;
        this.engine.log(LOG.PLAYER, this.engine.t('combat.aoeHit', {
          target: enemy.name, ac: enemy.attributes.armorClass,
          damage: dmgResult.total, dice: weapon.attributes.damageRoll, rollStr: dmgResult.string
        }), 'damage');
      } else {
        this.engine.log(LOG.PLAYER, this.engine.t('combat.aoeMiss', {
          target: enemy.name, ac: enemy.attributes.armorClass
        }), 'damage');
      }
    }

    // Defeats resolve after every target has taken its share of the one cast.
    for (const enemy of living) {
      if (enemy.attributes.healthPoints <= 0 && this._handleEnemyDefeat(enemy)) return;
    }

    this.engine._spendAP(apCost);
  }

  // One damage roll for a weapon in a wielder's hands: the dice, plus the
  // wielder's damageAttribute when the weapon names one — damage scales with
  // its wielder the same way accuracy does (attackAttribute), player or enemy.
  _rollDamage(weapon, wielderAttributes) {
    const result = parseDamage(weapon.attributes.damageRoll);
    const attrId = weapon.attributes?.damageAttribute;
    const mod = attrId ? (wielderAttributes[attrId] ?? 0) : 0;
    if (!mod) return result;
    return {
      // Clamped like parseDamage — negative damage would heal the target.
      total: Math.max(0, result.total + mod),
      string: `${result.string} ${mod < 0 ? '-' : '+'} ${Math.abs(mod)} ${skillLabel(this.engine, attrId)}`
    };
  }

  /**
   * AP the player may still spend this turn — their current AP. The engine's
   * _spendAP checks this before any combat action and the renderer disables
   * attacks the pool can't afford.
   * @returns {number}
   */
  remainingTurnBudget() {
    return this.engine.state.getPlayer().resources.ap.current;
  }

  // Resolves an enemy's (possible) defeat after damage lands. Returns true
  // when the whole battle ended — callers stop processing.
  _handleEnemyDefeat(targetEnemy) {
    if (targetEnemy.attributes.healthPoints > 0) return false;
    if (this.enemies.every(e => e.attributes.healthPoints <= 0)) {
      this.endCombat(true);
      return true;
    }
    this.engine.log(LOG.COMBAT, this.engine.t('combat.enemyDefeated', { name: targetEnemy.name }), 'loot');
    return false;
  }

  /**
   * Executes enemy attacks in a round-robin phase.
   *
   * Round phases:
   * - 'before': Handles enemies who out-rolled the player's initiative.
   * - 'after' : Handles enemies who rolled lower initiative than the player.
   *
   * @param {'before'|'after'} phase - The initiative grouping acting this turn.
   */
  enemyTurn(phase = 'after') {
    if (!this.inCombat) return;

    const player = this.engine.state.getPlayer();

    const allLiving = this.enemies
      .filter(e => e.attributes.healthPoints > 0)
      .sort((a, b) => (b.initiativeRoll ?? 0) - (a.initiativeRoll ?? 0));

    const enemiesToAct = phase === 'before'
      ? allLiving.filter(e => (e.initiativeRoll ?? 0) > this.playerInit)
      : allLiving.filter(e => (e.initiativeRoll ?? 0) <= this.playerInit);

    for (const enemy of enemiesToAct) {
      const eWeapon = this._resolveEnemyWeapon(enemy);
      if (!eWeapon) {
        console.warn(`[Gravity] enemyTurn: no weapon resolved for "${enemy.name}", skipping.`);
        continue;
      }
      // Same authoring-slip visibility as the missing weapon above: without an
      // AP budget the enemy stands mute every turn with no other hint.
      if (!(enemy.attributes.actionPoints > 0)) {
        console.warn(`[Gravity] enemyTurn: "${enemy.name}" has no attributes.actionPoints — it can never attack.`);
        continue;
      }

      const result = this._resolveEnemyAttacks(eWeapon, enemy.attributes.actionPoints, enemy);
      if (result.attackCount > 0) this._narrateEnemyResult(enemy, eWeapon, result);

      if (player.resources.hp.current <= 0) {
        this.endCombat(false);
        return;
      }
    }

    if (phase === 'before') {
      // High-initiative enemies are done — the round opens for the player.
      this.renderer.render();
    } else {
      // Low-initiative enemies are done — the round ends.
      this._refillRoundAp();

      // High-initiative enemies open the next round before the player acts.
      const hasBeforeEnemies = this.enemies.some(e => e.attributes.healthPoints > 0 && (e.initiativeRoll ?? 0) > this.playerInit);
      if (hasBeforeEnemies) {
        this.enemyTurn('before');
      } else {
        this.renderer.render();
      }
    }
  }

  // Logs one enemy's attack summary and its damage line. The damage result is
  // its own log entry: same source, so it groups under the attack line with a
  // breathing gap instead of a repeated label. Plurals pick a One-variant key
  // and lists join through Intl — no English grammar in code.
  _narrateEnemyResult(enemy, eWeapon, result) {
    const lang = this.engine.language;
    const parts = [];
    if (result.hits > 0) {
      parts.push(this.engine.t(isOne(lang, result.hits) ? 'combat.enemyAttackHitsOne' : 'combat.enemyAttackHits',
        { count: result.hits, rolls: formatList(lang, result.hitRolls) }));
    }
    if (result.misses > 0) {
      parts.push(this.engine.t(isOne(lang, result.misses) ? 'combat.enemyAttackMissesOne' : 'combat.enemyAttackMisses',
        { count: result.misses, rolls: formatList(lang, result.missRolls) }));
    }

    const times = result.attackCount === 1
      ? this.engine.t('combat.attackOnce')
      : result.attackCount === 2
        ? this.engine.t('combat.attackTwice')
        : this.engine.t('combat.attackMany', { count: result.attackCount });

    this.engine.log(enemy.name, this.engine.t('combat.enemyAttack', { name: enemy.name, weapon: eWeapon.name, times, parts: parts.join(', ') }), 'damage');
    this.engine.log(enemy.name, result.hits > 0
      ? this.engine.t('combat.playerTakesDamage', { damage: result.totalDamage, dice: eWeapon.attributes.damageRoll, rolls: formatList(lang, result.damageRolls) })
      : this.engine.t('combat.playerTakesNoDamage'), 'damage');
  }

  // Round boundary: recharge the player's AP pool to full for a fresh turn.
  _refillRoundAp() {
    this.engine.state.modifyPlayerStat('ap', 'full');
  }

  // The weapon an enemy attacks with: the first hand slot of theirs holding a
  // Weapon or Spell, falling back to rules.fallbackWeapons.enemy (the core
  // claw by default). Reading the kind rather than one named hand means an
  // enemy armed in either hand still swings, and an enemy carrying a shield
  // in one hand doesn't try to hit anyone with it. Null when neither resolves
  // to a loaded item.
  _resolveEnemyWeapon(enemy) {
    const item = handSlots(this.engine.data.rules)
      .map(slot => this.engine.data.items[enemy.equipment?.[slot]])
      .find(candidate => candidate?.type === 'Weapon' || candidate?.type === 'Spell');
    const fallbackId = this.engine.data.rules?.fallbackWeapons?.enemy ?? ENEMY_CLAW_ID;
    return item || this.engine.data.items[fallbackId] || null;
  }

  // Resolves one enemy's attacks for the turn: swings until its AP budget
  // can't cover another attack or someone drops. Returns the tallies and
  // roll breakdowns ({ attackCount, hits, misses, totalDamage, hitRolls,
  // missRolls, damageRolls }) for _narrateEnemyResult.
  _resolveEnemyAttacks(eWeapon, eAP, enemy) {
    if (!eWeapon.attributes?.actionPoints) {
      return { attackCount: 0, hits: 0, misses: 0, totalDamage: 0, hitRolls: [], missRolls: [], damageRolls: [] };
    }

    const player = this.engine.state.getPlayer();
    let attackCount = 0, hits = 0, misses = 0, totalDamage = 0;
    const hitRolls = [], missRolls = [], damageRolls = [];

    while (eAP >= eWeapon.attributes.actionPoints && player.resources.hp.current > 0 && enemy.attributes.healthPoints > 0) {
      eAP -= eWeapon.attributes.actionPoints;
      attackCount++;

      // Enemies use their own attribute for the weapon's attackAttribute —
      // an accurate enemy is one with the stat, not one with a special blade.
      const attrId = eWeapon.attributes?.attackAttribute;
      const attrMod = attrId ? (enemy.attributes[attrId] ?? 0) : 0;
      const baseRoll = roll(1, MAX_D20_ROLL);
      const hitRoll = baseRoll + attrMod;
      const breakdown = rollBreakdown(baseRoll, attrMod, attrId ? skillLabel(this.engine, attrId) : '');

      if (hitRoll >= player.attributes.ac) {
        hits++;
        hitRolls.push(this.engine.t('combat.enemyAttackRoll', { roll: hitRoll, breakdown, ac: player.attributes.ac }));

        const dmgResult = this._rollDamage(eWeapon, enemy.attributes);
        totalDamage += dmgResult.total;
        damageRolls.push(dmgResult.string);

        this.engine.state.modifyPlayerStat('hp', -dmgResult.total);
      } else {
        misses++;
        missRolls.push(this.engine.t('combat.enemyAttackRoll', { roll: hitRoll, breakdown, ac: player.attributes.ac }));
      }
      if (player.resources.hp.current <= 0) break;
    }

    return { attackCount, hits, misses, totalDamage, hitRolls, missRolls, damageRolls };
  }

  /**
   * Finalizes combat: resolves rewards and the post-fight re-render on
   * victory, or the game-over screen on defeat.
   *
   * @param {boolean} isVictory - True if all enemies were defeated; false if the player died.
   */
  endCombat(isVictory) {
    this.engine.setMode(isVictory ? 'scene' : 'gameover');

    if (isVictory) {
      const names = formatList(this.engine.language, this.enemies.map(e => e.name));

      // Award XP from defeated enemies, folded into the victory line — one
      // event, one message. addXP carries surplus across level-ups, so a
      // single summed call matches the per-enemy awards it replaces.
      const totalXp = this.enemies.reduce((sum, e) => sum + (e.attributes.xpReward || 0), 0);
      if (totalXp > 0) this.engine.state.addXP(totalXp);
      this.engine.log(LOG.SYSTEM, this.engine.t(totalXp > 0 ? 'combat.victoryXp' : 'combat.victory', { names, xp: totalXp }), 'loot');

      // Restore AP to max at the combat boundary so the out-of-combat sheet
      // reads full and the next fight opens fully charged.
      this.engine.state.modifyPlayerStat('ap', 'full');

      const didNavigate = this.engine.snapshotNavigation();
      this.engine.runActions(this.originOption?.onVictory || []);

      // If the victory pipeline did not trigger scene navigation (or open a
      // dialogue, custom UI, or new combat), force re-render options. The
      // re-render skips the scene's autoAttack — without that, victory on an
      // auto-attack scene would instantly restart the same encounter — and its
      // narration clip, which the player already heard on the way in.
      if (!didNavigate()) this.engine.renderScene(this.engine.state.getCurrentSceneId(), { skipAutoAttack: true, skipNarration: true });

    } else {
      this.renderer.renderGameOver();
    }
  }
}
