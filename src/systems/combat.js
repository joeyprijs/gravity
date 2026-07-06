import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel } from "../core/utils.js";
import { MAX_D20_ROLL, EL, CSS, LOG, WEAPON_SLOTS, ENEMY_CLAW_ID } from "../core/config.js";
import { roll, parseDamage } from "./dice.js";

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
    this.renderer = new CombatRenderer(this);

    // Event listener: triggers whenever the player spends AP inside combat.
    // If the player exhausts their Action Points, the turn automatically hands off to enemies.
    this.engine.on('player:apSpent', ({ remaining }) => {
      if (!this.inCombat) return;
      if (remaining <= 0) {
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

    // Restore player AP to maximum at the start of combat so they begin fully charged
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);

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
    this.playerInit = roll(1, MAX_D20_ROLL) + (player.attributes.initiative ?? 0);
    let highestEnemyInit = -Infinity;
    
    this.enemies.forEach(e => {
      e.initiativeRoll = roll(1, MAX_D20_ROLL) + (e.attributes.initiative ?? 0);
      if (e.initiativeRoll > highestEnemyInit) highestEnemyInit = e.initiativeRoll;
    });

    this.anyEnemyGoesFirst = highestEnemyInit > this.playerInit;

    // Build the visual round ordering log entry for the player's reference
    const enemyRolls = this.enemies
      .map(e => this.engine.t('combat.initiativeEnemy', { name: e.name, roll: e.initiativeRoll }))
      .join(', ');
    
    const allCombatants = [
      { name: this.engine.t('combat.initiativeYou'), roll: this.playerInit },
      ...this.enemies.map(e => ({ name: e.name, roll: e.initiativeRoll ?? 0 }))
    ].sort((a, b) => b.roll - a.roll);

    const turnOrder = allCombatants.map(c => c.name).join(' → ');
    this.engine.log(LOG.COMBAT, this.engine.t('combat.initiative', { playerRoll: this.playerInit, enemyRolls, turnOrder }), 'combat');

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
    const hitModifier = weapon.bonusHitChance ?? 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + hitModifier;
    const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

    // D&D AC Check: Attack roll must equal or exceed target Armor Class to connect
    if (hitRoll >= targetEnemy.attributes.armorClass) {
      const dmgResult = parseDamage(weapon.attributes.damageRoll);
      targetEnemy.attributes.healthPoints -= dmgResult.total;
      
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackHit', {
        weapon: weapon.name, roll: hitRoll, mod: modStr,
        ac: targetEnemy.attributes.armorClass, damage: dmgResult.total, 
        dice: weapon.attributes.damageRoll, rollStr: dmgResult.string
      }), 'damage');

      // Check if target is defeated
      if (targetEnemy.attributes.healthPoints <= 0) {
        if (this.enemies.every(e => e.attributes.healthPoints <= 0)) {
          this.endCombat(true);
          return; // Early return to prevent spending AP on a battle already won
        }
        this.engine.log(LOG.COMBAT, this.engine.t('combat.enemyDefeated', { name: targetEnemy.name }), 'loot');
      }
    } else {
      // Missed attack logging
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
        weapon: weapon.name, roll: hitRoll, mod: modStr, ac: targetEnemy.attributes.armorClass
      }), 'damage');
    }

    // Spend the weapon's AP cost, triggering interface updates or enemy phases
    this.engine._spendAP(weapon.actionPoints);
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
            
        let summary = this.engine.t('combat.enemyAttack', { name: enemy.name, weapon: eWeapon.name, times, parts: parts.join(', ') });
        
        summary += ' ' + (result.hits > 0
          ? this.engine.t('combat.playerTakesDamage', { damage: result.totalDamage, dice: eWeapon.attributes.damageRoll, rolls: result.damageRolls.join(' and ') })
          : this.engine.t('combat.playerTakesNoDamage'));
          
        this.engine.log(enemy.name, summary, 'damage');
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
      // 1. Fully charge the player's AP pool for the new round.
      gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);
      
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
    if (!eWeapon.actionPoints) {
      return { attackCount: 0, hits: 0, misses: 0, totalDamage: 0, hitRolls: [], missRolls: [], damageRolls: [] };
    }

    const player = gameState.getPlayer();
    let attackCount = 0, hits = 0, misses = 0, totalDamage = 0;
    const hitRolls = [], missRolls = [], damageRolls = [];

    // Iterative attack loops checking that resources and targets remain active
    while (eAP >= eWeapon.actionPoints && player.resources.hp.current > 0 && enemy.attributes.healthPoints > 0) {
      eAP -= eWeapon.actionPoints;
      attackCount++;

      const hitModifier = eWeapon.bonusHitChance ?? 0;
      const baseRoll = roll(1, MAX_D20_ROLL);
      const hitRoll = baseRoll + hitModifier;
      const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

      // D&D AC Check: Attack roll must meet or exceed player Armor Class
      if (hitRoll >= player.attributes.ac) {
        hits++;
        hitRolls.push(`${hitRoll} (1d20${modStr})`);
        
        const dmgResult = parseDamage(eWeapon.attributes.damageRoll);
        totalDamage += dmgResult.total;
        damageRolls.push(dmgResult.string);
        
        // Mutate player health points inside standard state management
        gameState.modifyPlayerStat('hp', -dmgResult.total);
      } else {
        misses++;
        missRolls.push(`${hitRoll} (1d20${modStr})`);
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

      // Restore player AP back to max capacity after battle
      const player = gameState.getPlayer();
      gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);

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

/**
 * CombatRenderer owns all DOM manipulation and controls injection for the combat UI.
 * Highly decoupled — holds no state and reads directly from the CombatSystem on render.
 */
class CombatRenderer {
  /**
   * Constructs the CombatRenderer.
   * 
   * @param {object} combatSystem - The parent CombatSystem instance.
   */
  constructor(combatSystem) {
    this.cs = combatSystem;
  }

  /**
   * Gathers all available attacks for the player based on their equipped hand items.
   * Falls back to rules.fallbackWeapons.player (Unarmed Strike) if hands are empty.
   * 
   * @returns {object[]} Array of Weapon/Spell item configuration schemas.
   */
  getAvailableAttacks() {
    const player = gameState.getPlayer();
    const attacks = [];

    let hasWeapon = false;
    WEAPON_SLOTS.forEach(slot => {
      const itemId = player.equipment[slot];
      if (itemId && this.cs.engine.data.items[itemId]) {
        const item = this.cs.engine.data.items[itemId];
        if (item.type === 'Weapon' || item.type === 'Spell') {
          attacks.push(item);
          hasWeapon = true;
        }
      }
    });

    // Unarmed fallback execution
    if (!hasWeapon) {
      const fallbackId = this.cs.engine.data.rules?.fallbackWeapons?.player;
      const unarmed = fallbackId ? this.cs.engine.data.items[fallbackId] : null;
      if (unarmed) attacks.push(unarmed);
    }
    return attacks;
  }

  /**
   * Renders the Game Over scenario inside the narrative log and wires standard restart triggers.
   */
  renderGameOver() {
    this.cs.engine.openScene();
    const desc = buildSceneDescription(
      this.cs.engine.t('combat.gameOverTitle'),
      this.cs.engine.t('combat.gameOverBody'),
      this.cs.engine.t.bind(this.cs.engine)
    );
    desc.querySelector('h2').classList.add(CSS.SCENE_TITLE_GAME_OVER);
    this.cs.engine.currentSceneEl.appendChild(desc);

    // Clear panel areas to focus strictly on recovery controls
    const { container } = resetOptionsPanel();

    const loadBtn = buildOptionButton(this.cs.engine.t('combat.loadLastSave'));
    loadBtn.onclick = () => document.getElementById(EL.BTN_LOAD).click();
    container.appendChild(loadBtn);

    const restartBtn = buildOptionButton(this.cs.engine.t('combat.restartGame'));
    restartBtn.onclick = () => document.getElementById(EL.BTN_RESTART).click();
    container.appendChild(restartBtn);

    // Disable sidebar actions to prevent post-death items activation
    document.querySelectorAll(`.${CSS.BTN_ITEM}`).forEach(btn => { btn.disabled = true; });
  }

  /**
   * Rebuilds the action options panels to render attack, items, and end-turn buttons.
   */
  render() {
    const livingEnemies = this.cs.enemies.filter(e => e.attributes.healthPoints > 0);

    const { panel, container, skillsContainer } = resetOptionsPanel(this.cs.engine.t('ui.locationCombat'));

    const attacks = this.getAvailableAttacks();

    // End Turn button placed at the top of options for fast accessibility
    const endBtn = buildOptionButton(this.cs.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.cs.enemyTurn('after');
    container.appendChild(endBtn);

    // Render individual combat sections for each active opponent
    livingEnemies.forEach(target => {
      const section = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING,
        this.cs.engine.t('combat.enemyStats', { name: target.name, hp: target.attributes.healthPoints, ac: target.attributes.armorClass })
      ));
      
      attacks.forEach(att => {
        const btn = createElement('button', [CSS.BTN, CSS.OPTION_BTN, CSS.OPTION_BTN_STACKED]);
        btn.appendChild(createElement('span', '', this.cs.engine.t('combat.attackTarget', { name: att.name })));
        btn.appendChild(createElement('span', CSS.OPTION_BTN_BADGE, this.cs.engine.t('combat.apCost', { cost: att.actionPoints })));
        
        // Disable attack controls if the player lacks sufficient AP
        if (gameState.getPlayer().resources.ap.current < att.actionPoints) {
          btn.disabled = true;
        }
        btn.onclick = () => this.cs.playerAttack(att, target);
        section.appendChild(btn);
      });
      panel.insertBefore(section, skillsContainer);
    });
  }
}
