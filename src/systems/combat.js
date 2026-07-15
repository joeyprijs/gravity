import { gameState } from "../core/state.js";
import { buildSceneDescription, apEconomyRules } from "../core/utils.js";
import { MAX_D20_ROLL, CSS, LOG, WEAPON_SLOTS, ENEMY_CLAW_ID } from "../core/config.js";
import { roll, parseDamage } from "./dice.js";
import { rollBreakdown, skillLabel } from "./skill-checks.js";
import { CombatRenderer } from "../ui/combat-ui.js";

/**
 * CombatSystem manages the full lifecycle of a turn-based combat encounter.
 * 
 * Flow:
 * 1. startCombat() rolls initiative for all combatants and constructs a sorted round timeline.
 * 2. High-initiative enemies act immediately during the "before" phase.
 * 3. The player acts, spending Action Points (AP) on attacks or item usage.
 * 4. Ending the player's turn triggers low-initiative enemies during the "after" phase.
 * 5. Player AP is restored, and high-initiative enemies trigger the next round.
 * 6. Health points are checked after every attack to resolve Victory or Defeat.
 */
export class CombatSystem {
  /**
   * Constructs the CombatSystem.
   * Registers a state listener for player AP spending to drive enemy turns dynamically.
   * 
   * @param {object} engine - The central RPGEngine coordination instance.
   */
  constructor(engine) {
    this.engine = engine;
    this.inCombat = false;
    this.isGameOver = false;
    this.enemies = [];

    // originOption captures the scene option action that triggered this encounter.
    // On victory, the option's onVictory actions array is executed as a pipeline.
    this.originOption = null;
    this.playerInit = 0;
    // AP spent since the player's turn began — measured against
    // rules.apEconomy.maxPerTurn (see remainingTurnBudget).
    this.apSpentThisTurn = 0;
    this.renderer = new CombatRenderer(this);

    // Event listener: triggers whenever the player spends AP inside combat.
    // When the turn budget runs out (AP exhausted, or the maxPerTurn cap is
    // reached), the turn automatically hands off to enemies.
    this.engine.on('player:apSpent', ({ remaining, amount }) => {
      if (!this.inCombat) return;
      this.apSpentThisTurn += amount ?? 0;
      if (remaining <= 0 || this.remainingTurnBudget() <= 0) {
        this.enemyTurn('after');
      } else {
        this.renderer.render(); // Update interface to reflect depleted AP
      }
    });
  }

  /**
   * Initializes a combat encounter, rolls initiatives, and launches the first round.
   * 
   * @param {string[]} enemyIds - Array of NPC identifiers to fight (e.g. ["goblin_guard"]).
   * @param {object} originOption - The action pipeline node that triggered this combat.
   */
  startCombat(enemyIds, originOption) {
    // Clone enemy templates from the loaded data registry to prevent mutating
    // the static base files during battles (avoids leaking damaged health states).
    const enemyDataList = enemyIds.map(id => {
      const data = this.engine.data.npcs[id];
      if (!data) { 
        console.warn(`[Gravity] startCombat: unknown enemy template ID "${id}"`); 
        return null; 
      }
      const clone = JSON.parse(JSON.stringify(data));
      clone.id = id;
      return clone;
    }).filter(Boolean);

    if (!enemyDataList.length) return;

    this.engine.resetScene();
    this.inCombat = true;
    this.isGameOver = false;
    this.enemies = enemyDataList;
    this.originOption = originOption;

    // AP at the combat boundary is governed by rules.apEconomy: classic games
    // (the default) begin fully charged; a persistent economy carries the
    // pool in, topped up to the minPerTurn floor so the player can always act.
    const eco = apEconomyRules(this.engine.data.rules);
    const player = gameState.getPlayer();
    if (eco.refillOnCombatStart) {
      gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);
    } else if (player.resources.ap.current < eco.minPerTurn) {
      gameState.modifyPlayerStat('ap', eco.minPerTurn - player.resources.ap.current);
    }
    this.apSpentThisTurn = 0;

    const names = this.enemies.map(e => e.name).join(' & ');

    // Transition the narrative timeline into combat mode
    this.engine.openScene(CSS.SCENE_COMBAT);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(
        this.engine.t('combat.fightingTitle', { names }),
        this.enemies.length === 1 ? (this.enemies[0].description || null) : null,
        this.engine.t.bind(this.engine)
      )
    );

    this.engine.log(LOG.COMBAT, this.engine.t('combat.started', { names }), 'combat');

    // ── Initiative Calculations ─────────────────────────────────────────────
    // Rolled as: 1d20 + flat initiative modifier.
    // Ties are sorted alphabetically or index-wise. Higher values act earlier.
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

    // Build the visual round ordering log entry for the player's reference
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

    // Trigger high-initiative enemies to act BEFORE the player has their first turn
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
    const attrMod = attrId ? (gameState.getPlayer().attributes[attrId] ?? 0) : 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + attrMod;
    const breakdown = rollBreakdown(baseRoll, attrMod, attrId ? skillLabel(this.engine, attrId) : '');

    // D&D AC Check: Attack roll must equal or exceed target Armor Class to connect
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

    // Missed attack logging
    this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
      weapon: weapon.name, roll: hitRoll, breakdown, ac: targetEnemy.attributes.armorClass
    }), 'damage');

    // Spend the weapon's AP cost, triggering interface updates or enemy phases
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
    const ap = gameState.getPlayer().resources.ap.current;
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

    const player = gameState.getPlayer();

    // Sort living enemies by initiative roll descending so fast enemies attack first
    const allLiving = this.enemies
      .filter(e => e.attributes.healthPoints > 0)
      .sort((a, b) => (b.initiativeRoll ?? 0) - (a.initiativeRoll ?? 0));

    // Filter which enemies are allowed to act in the current phase
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

      if (result.attackCount > 0) {
        const parts = [];
        if (result.hits > 0) {
          parts.push(this.engine.t('combat.enemyAttackHits', { count: result.hits, s: result.hits > 1 ? 's' : '', rolls: result.hitRolls.join(' and ') }));
        }
        if (result.misses > 0) {
          parts.push(this.engine.t('combat.enemyAttackMisses', { count: result.misses, es: result.misses > 1 ? 'es' : '', rolls: result.missRolls.join(' and ') }));
        }

        const times = result.attackCount === 1
          ? this.engine.t('combat.attackOnce')
          : result.attackCount === 2
            ? this.engine.t('combat.attackTwice')
            : this.engine.t('combat.attackMany', { count: result.attackCount });
            
        this.engine.log(enemy.name, this.engine.t('combat.enemyAttack', { name: enemy.name, weapon: eWeapon.name, times, parts: parts.join(', ') }), 'damage');

        // The damage result is its own log entry: same source, so it groups
        // under the attack line with a breathing gap instead of a repeated label.
        this.engine.log(enemy.name, result.hits > 0
          ? this.engine.t('combat.playerTakesDamage', { damage: result.totalDamage, dice: eWeapon.attributes.damageRoll, rolls: result.damageRolls.join(' and ') })
          : this.engine.t('combat.playerTakesNoDamage'), 'damage');
      }

      // Check if the player fell in battle
      if (player.resources.hp.current <= 0) {
        this.endCombat(false);
        return;
      }
    }

    // ── Phase Hand-off Logic ────────────────────────────────────────────────
    if (phase === 'before') {
      // High-initiative enemies have finished. The round now opens for the player.
      this.renderer.render();
    } else {
      // Low-initiative enemies have finished, ending the round.
      // 1. Recharge the player's AP pool per rules.apEconomy (classic: full
      //    refill), top up to the minPerTurn floor, and open a fresh turn budget.
      const eco = apEconomyRules(this.engine.data.rules);
      if (eco.refillPerRound === 'full') {
        gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);
      } else if (eco.refillPerRound > 0) {
        gameState.modifyPlayerStat('ap', eco.refillPerRound);
      }
      if (player.resources.ap.current < eco.minPerTurn) {
        gameState.modifyPlayerStat('ap', eco.minPerTurn - player.resources.ap.current);
      }
      this.apSpentThisTurn = 0;

      // 2. Check if high-initiative enemies act at the beginning of the next round.
      const hasBeforeEnemies = this.enemies.some(e => e.attributes.healthPoints > 0 && (e.initiativeRoll ?? 0) > this.playerInit);
      if (hasBeforeEnemies) {
        this.enemyTurn('before');
      } else {
        this.renderer.render(); // Transition directly back to player controls
      }
    }
  }

  /**
   * Resolves which weapon an enemy attacks with.
   * Returns the item in their Right Hand slot, falling back to rules.fallbackWeapons.enemy
   * or the core claw fallback.
   * 
   * @private
   * @param {object} enemy - The NPC database entity object.
   * @returns {object|null} The resolved weapon configuration, or null if loading fails.
   */
  _resolveEnemyWeapon(enemy) {
    const equipped = enemy.equipment?.[WEAPON_SLOTS[1]]; // Right Hand
    const item = equipped ? this.engine.data.items[equipped] : null;
    const fallbackId = this.engine.data.rules?.fallbackWeapons?.enemy ?? ENEMY_CLAW_ID;
    return item || this.engine.data.items[fallbackId] || null;
  }

  /**
   * Simulates a single enemy's turn attacks based on their Action Point budget.
   * Attacks repeatedly until their AP is exhausted, or the player/enemy drops.
   * 
   * @private
   * @param {object} eWeapon - The weapon being swung/cast.
   * @param {number} eAP - The enemy's active AP pool for this round.
   * @param {object} enemy - The attacking NPC entity object.
   * @returns {object} A combat simulation results package containing:
   *   - attackCount, hits, misses, totalDamage, and breakdowns of rolls.
   */
  _resolveEnemyAttacks(eWeapon, eAP, enemy) {
    if (!eWeapon.attributes?.actionPoints) {
      return { attackCount: 0, hits: 0, misses: 0, totalDamage: 0, hitRolls: [], missRolls: [], damageRolls: [] };
    }

    const player = gameState.getPlayer();
    let attackCount = 0, hits = 0, misses = 0, totalDamage = 0;
    const hitRolls = [], missRolls = [], damageRolls = [];

    // Iterative attack loops checking that resources and targets remain active
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

      // D&D AC Check: Attack roll must meet or exceed player Armor Class
      if (hitRoll >= player.attributes.ac) {
        hits++;
        hitRolls.push(this.engine.t('combat.enemyAttackRoll', { roll: hitRoll, breakdown, ac: player.attributes.ac }));
        
        const dmgResult = parseDamage(eWeapon.attributes.damageRoll);
        totalDamage += dmgResult.total;
        damageRolls.push(dmgResult.string);
        
        // Mutate player health points inside standard state management
        gameState.modifyPlayerStat('hp', -dmgResult.total);
      } else {
        misses++;
        missRolls.push(this.engine.t('combat.enemyAttackRoll', { roll: hitRoll, breakdown, ac: player.attributes.ac }));
      }
      if (player.resources.hp.current <= 0) break;
    }

    return { attackCount, hits, misses, totalDamage, hitRolls, missRolls, damageRolls };
  }

  /**
   * Finalizes combat. Wipes listeners, resets AP, and resolves rewards or Game Over screens.
   * 
   * @param {boolean} isVictory - True if all enemies were defeated; false if the player died.
   */
  endCombat(isVictory) {
    this.inCombat = false;
    if (!isVictory) this.isGameOver = true;
    
    if (isVictory) {
      const names = this.enemies.map(e => e.name).join(' & ');

      // Award XP from defeated enemies, folded into the victory line — one
      // event, one message. addXP carries surplus across level-ups, so a
      // single summed call matches the per-enemy awards it replaces.
      const totalXp = this.enemies.reduce((sum, e) => sum + (e.attributes.xpReward || 0), 0);
      if (totalXp > 0) gameState.addXP(totalXp);
      this.engine.log(LOG.SYSTEM, this.engine.t(totalXp > 0 ? 'combat.victoryXp' : 'combat.victory', { names, xp: totalXp }), 'loot');

      // Classic games restore AP to max at the combat boundary; a persistent
      // economy (refillOnCombatStart: false) carries the spent pool out.
      if (apEconomyRules(this.engine.data.rules).refillOnCombatStart) {
        const player = gameState.getPlayer();
        gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);
      }

      // Execute onVictory action pipeline
      const sceneIdBefore = gameState.getCurrentSceneId();
      this.engine.runActions(this.originOption?.onVictory || []);

      // If the victory pipeline did not trigger scene navigation (or open a
      // dialogue, custom UI, or new combat), force re-render options. The
      // re-render skips the scene's autoAttack — without that, victory on an
      // auto-attack scene would instantly restart the same encounter.
      const didNavigate = gameState.getCurrentSceneId() !== sceneIdBefore ||
        this.engine.inCombat || this.engine.inDialogue || this.engine.inCustomUI;
      if (!didNavigate) this.engine.renderScene(gameState.getCurrentSceneId(), { skipAutoAttack: true });

    } else {
      this.renderer.renderGameOver();
    }
  }
}
