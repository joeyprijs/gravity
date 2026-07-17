import { buildSceneDescription, apEconomyRules } from "../core/utils.js";
import { MAX_D20_ROLL, CSS, LOG, WEAPON_SLOTS, ENEMY_CLAW_ID } from "../core/config.js";
import { roll, parseDamage } from "./dice.js";
import { rollBreakdown, skillLabel } from "./skill-checks.js";
import { formatList, isOne } from "../core/i18n.js";
import { CombatRenderer } from "../ui/combat-ui.js";

// CombatSystem manages the full lifecycle of a turn-based encounter:
//
// 1. startCombat() rolls initiative for every combatant.
// 2. Enemies that out-rolled the player act first (the "before" phase).
// 3. The player acts, spending Action Points on attacks or item use.
// 4. Ending the player's turn triggers the slower enemies (the "after" phase).
// 5. The round closes: AP recharges per rules.apEconomy, and fast enemies
//    open the next round.
// 6. HP is checked after every attack to resolve victory or defeat.
export class CombatSystem {
  constructor(engine) {
    this.engine = engine;
    this.enemies = [];

    // originOption captures the scene option action that triggered this encounter.
    // On victory, the option's onVictory actions array is executed as a pipeline.
    this.originOption = null;
    this.playerInit = 0;
    // AP spent since the player's turn began — measured against
    // rules.apEconomy.maxPerTurn (see remainingTurnBudget).
    this.apSpentThisTurn = 0;
    this.renderer = new CombatRenderer(this);
  }

  // Whether a combat encounter is active / ended in defeat — facades over the
  // engine's mode machine, which is the single source of truth.
  get inCombat()   { return this.engine.inCombat; }
  get isGameOver() { return this.engine.isGameOver; }

  /**
   * Called by engine._spendAP after every combat AP spend. Tracks the turn
   * budget and hands the turn to the enemies when it runs out (AP exhausted,
   * or the maxPerTurn cap reached); otherwise refreshes the combat controls.
   *
   * @param {number} amount - AP just spent.
   */
  notePlayerSpentAP(amount) {
    if (!this.inCombat) return;
    this.apSpentThisTurn += amount ?? 0;
    const remaining = this.engine.state.getPlayer().resources.ap.current;
    if (remaining <= 0 || this.remainingTurnBudget() <= 0) {
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
   */
  startCombat(enemyIds, originOption) {
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

    // AP at the combat boundary is governed by rules.apEconomy: classic games
    // (the default) begin fully charged; a persistent economy carries the
    // pool in, topped up to the minPerTurn floor so the player can always act.
    const eco = apEconomyRules(this.engine.data.rules);
    const player = this.engine.state.getPlayer();
    if (eco.refillOnCombatStart) {
      this.engine.state.modifyPlayerStat('ap', 'full');
    } else if (player.resources.ap.current < eco.minPerTurn) {
      this.engine.state.modifyPlayerStat('ap', eco.minPerTurn - player.resources.ap.current);
    }
    this.apSpentThisTurn = 0;

    const names = this.enemies.map(e => e.name).join(' & ');

    this.engine.openScene(CSS.SCENE_COMBAT);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(
        this.engine.t('combat.fightingTitle', { names }),
        this.enemies.length === 1 ? (this.enemies[0].description || null) : null,
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

    if (this.anyEnemyGoesFirst) {
      this.enemyTurn('before');
    }
  }

  /**
   * Executes a player attack using an equipped weapon/spell against a target enemy.
   *
   * @param {object} weapon - The item object being used (Weapon/Spell type).
   * @param {object} targetEnemy - The cloned NPC object being attacked.
   */
  playerAttack(weapon, targetEnemy) {
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
      const dmgResult = parseDamage(weapon.attributes.damageRoll);
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
      this.engine._spendAP(weapon.attributes?.actionPoints ?? 0);
      return;
    }

    this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
      weapon: weapon.name, roll: hitRoll, breakdown, ac: targetEnemy.attributes.armorClass
    }), 'damage');

    this.engine._spendAP(weapon.attributes?.actionPoints ?? 0);
  }

  /**
   * AP the player may still spend this turn: current AP, further capped by
   * rules.apEconomy.maxPerTurn (0 = uncapped). The engine's _spendAP checks
   * this before any combat action and the renderer disables attacks that
   * exceed it, so an oversized persistent pool can't inflate a single turn.
   * @returns {number}
   */
  remainingTurnBudget() {
    const ap = this.engine.state.getPlayer().resources.ap.current;
    const { maxPerTurn } = apEconomyRules(this.engine.data.rules);
    if (maxPerTurn > 0) return Math.min(ap, Math.max(0, maxPerTurn - this.apSpentThisTurn));
    return ap;
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

  // Round boundary: recharge the player's AP pool per rules.apEconomy
  // (classic: full refill), top up to the minPerTurn floor, and open a fresh
  // turn budget.
  _refillRoundAp() {
    const eco = apEconomyRules(this.engine.data.rules);
    const player = this.engine.state.getPlayer();
    if (eco.refillPerRound === 'full') {
      this.engine.state.modifyPlayerStat('ap', 'full');
    } else if (eco.refillPerRound > 0) {
      this.engine.state.modifyPlayerStat('ap', eco.refillPerRound);
    }
    if (player.resources.ap.current < eco.minPerTurn) {
      this.engine.state.modifyPlayerStat('ap', eco.minPerTurn - player.resources.ap.current);
    }
    this.apSpentThisTurn = 0;
  }

  // The weapon an enemy attacks with: their Right Hand item, falling back to
  // rules.fallbackWeapons.enemy (the core claw by default). Null when neither
  // resolves to a loaded item.
  _resolveEnemyWeapon(enemy) {
    const equipped = enemy.equipment?.[WEAPON_SLOTS[1]]; // Right Hand
    const item = equipped ? this.engine.data.items[equipped] : null;
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

        const dmgResult = parseDamage(eWeapon.attributes.damageRoll);
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
      const names = this.enemies.map(e => e.name).join(' & ');

      // Award XP from defeated enemies, folded into the victory line — one
      // event, one message. addXP carries surplus across level-ups, so a
      // single summed call matches the per-enemy awards it replaces.
      const totalXp = this.enemies.reduce((sum, e) => sum + (e.attributes.xpReward || 0), 0);
      if (totalXp > 0) this.engine.state.addXP(totalXp);
      this.engine.log(LOG.SYSTEM, this.engine.t(totalXp > 0 ? 'combat.victoryXp' : 'combat.victory', { names, xp: totalXp }), 'loot');

      // Classic games restore AP to max at the combat boundary; a persistent
      // economy (refillOnCombatStart: false) carries the spent pool out.
      if (apEconomyRules(this.engine.data.rules).refillOnCombatStart) {
        this.engine.state.modifyPlayerStat('ap', 'full');
      }

      const didNavigate = this.engine.snapshotNavigation();
      this.engine.runActions(this.originOption?.onVictory || []);

      // If the victory pipeline did not trigger scene navigation (or open a
      // dialogue, custom UI, or new combat), force re-render options. The
      // re-render skips the scene's autoAttack — without that, victory on an
      // auto-attack scene would instantly restart the same encounter.
      if (!didNavigate()) this.engine.renderScene(this.engine.state.getCurrentSceneId(), { skipAutoAttack: true });

    } else {
      this.renderer.renderGameOver();
    }
  }
}
