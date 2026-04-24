import { gameState } from "../core/state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "../core/utils.js";
import { MAX_D20_ROLL, EL, CSS, LOG, WEAPON_SLOTS, ENEMY_CLAW_ID } from "../core/config.js";
import { roll, parseDamage } from "./dice.js";

// CombatSystem manages the full lifecycle of a turn-based combat encounter:
// initiative roll, player/enemy turns, AP tracking, and victory/defeat resolution.
export class CombatSystem {
  constructor(engine) {
    this.engine = engine;
    this.inCombat = false;
    this.isGameOver = false;
    this.enemies = [];
    // originOption is the action object that triggered this combat.
    // Its onVictory array is executed as an action pipeline on victory.
    this.originOption = null;

    this.playerInit = 0;
    this.renderer = new CombatRenderer(this);

    this.engine.on('player:apSpent', ({ remaining }) => {
      if (!this.inCombat) return;
      if (remaining <= 0) {
        this.enemyTurn('after');
      } else {
        this.renderer.render();
      }
    });
  }

  startCombat(enemyIds, originOption) {
    const enemyDataList = enemyIds.map(id => {
      const data = this.engine.data.npcs[id];
      if (!data) { console.warn(`[Gravity] startCombat: unknown enemy "${id}"`); return null; }
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

    // Restore player AP to full at the start of every combat encounter
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);

    const names = this.enemies.map(e => e.name).join(' & ');

    this.engine.openScene(CSS.SCENE_COMBAT);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(
        this.engine.t('combat.fightingTitle', { names }),
        this.enemies.length === 1 ? (this.enemies[0].description || null) : null
      )
    );

    this.engine.log(LOG.COMBAT, this.engine.t('combat.started', { names }), 'combat');

    // Each enemy rolls initiative separately; enemies who beat the player go before the player,
    // enemies the player beats go after. playerInit is stored for phase filtering each round.
    this.playerInit = roll(1, MAX_D20_ROLL) + (player.attributes.initiative || 0);
    let highestEnemyInit = 0;
    this.enemies.forEach(e => {
      e.initiativeRoll = roll(1, MAX_D20_ROLL) + (e.attributes.initiative || 0);
      if (e.initiativeRoll > highestEnemyInit) highestEnemyInit = e.initiativeRoll;
    });
    this.anyEnemyGoesFirst = highestEnemyInit > this.playerInit;
    const enemyRolls = this.enemies
      .map(e => this.engine.t('combat.initiativeEnemy', { name: e.name, roll: e.initiativeRoll }))
      .join(', ');
    const allCombatants = [
      { name: this.engine.t('combat.initiativeYou'), roll: this.playerInit },
      ...this.enemies.map(e => ({ name: e.name, roll: e.initiativeRoll || 0 }))
    ].sort((a, b) => b.roll - a.roll);
    const turnOrder = allCombatants.map(c => c.name).join(' → ');
    this.engine.log(LOG.COMBAT, this.engine.t('combat.initiative', { playerRoll: this.playerInit, enemyRolls, turnOrder }), 'combat');

    this.renderer.render();
    if (this.anyEnemyGoesFirst) this.enemyTurn('before');
  }

  playerAttack(weapon, targetEnemy) {
    // Attack roll 1-20 + modifier
    const hitModifier = weapon.bonusHitChance || 0;
    const baseRoll = roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + hitModifier;
    const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

    if (hitRoll >= targetEnemy.attributes.armorClass) {
      const dmgResult = parseDamage(weapon.attributes.damageRoll);
      targetEnemy.attributes.healthPoints -= dmgResult.total;
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackHit', {
        weapon: weapon.name, roll: hitRoll, mod: modStr,
        ac: targetEnemy.attributes.armorClass, damage: dmgResult.total, dice: weapon.attributes.damageRoll, rollStr: dmgResult.string
      }), 'damage');

      if (targetEnemy.attributes.healthPoints <= 0) {
        if (this.enemies.every(e => e.attributes.healthPoints <= 0)) {
          this.endCombat(true);
          return; // AP is restored in endCombat — no need to spend first
        }
        this.engine.log(LOG.COMBAT, this.engine.t('combat.enemyDefeated', { name: targetEnemy.name }), 'loot');
      }
    } else {
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
        weapon: weapon.name, roll: hitRoll, mod: modStr, ac: targetEnemy.attributes.armorClass
      }), 'damage');
    }

    // Spend AP via the shared helper — consistent with useItem/equipItem.
    // _spendAP also emits player:apSpent which triggers enemyTurn or UI refresh.
    this.engine._spendAP(weapon.actionPoints);
  }

  // phase='before': enemies who outrolled the player (act before the player each round)
  // phase='after' : enemies the player outrolled (act after the player each round)
  enemyTurn(phase = 'after') {
    if (!this.inCombat) return;

    const player = gameState.getPlayer();
    const allLiving = this.enemies
      .filter(e => e.attributes.healthPoints > 0)
      .sort((a, b) => (b.initiativeRoll || 0) - (a.initiativeRoll || 0));

    const enemiesToAct = phase === 'before'
      ? allLiving.filter(e => (e.initiativeRoll || 0) > this.playerInit)
      : allLiving.filter(e => (e.initiativeRoll || 0) <= this.playerInit);

    for (const enemy of enemiesToAct) {
      const eWeapon = this._resolveEnemyWeapon(enemy);
      if (!eWeapon) { console.warn(`[Gravity] enemyTurn: no weapon resolved for "${enemy.name}", skipping`); continue; }
      const result = this._resolveEnemyAttacks(eWeapon, enemy.attributes.actionPoints, enemy);

      if (result.attackCount > 0) {
        const parts = [];
        if (result.hits > 0) parts.push(this.engine.t('combat.enemyAttackHits', { count: result.hits, s: result.hits > 1 ? 's' : '', rolls: result.hitRolls.join(' and ') }));
        if (result.misses > 0) parts.push(this.engine.t('combat.enemyAttackMisses', { count: result.misses, es: result.misses > 1 ? 'es' : '', rolls: result.missRolls.join(' and ') }));

        const times = result.attackCount === 1
          ? this.engine.t('combat.attackOnce')
          : result.attackCount === 2
            ? this.engine.t('combat.attackTwice')
            : this.engine.t('combat.attackMany', { count: result.attackCount });
        let summary = this.engine.t('combat.enemyAttack', { name: enemy.name, weapon: eWeapon.name, times, parts: parts.join(', ') });
        summary += ' ' + (result.hits > 0
          ? this.engine.t('combat.playerTakesDamage', { damage: result.totalDamage, dice: eWeapon.attributes.damageRoll, rolls: result.damageRolls.join(' and ') })
          : this.engine.t('combat.playerTakesNoDamage'));
        this.engine.log(LOG.COMBAT, summary, 'damage');
      }

      if (player.resources.hp.current <= 0) {
        this.endCombat(false);
        return;
      }
    }

    if (phase === 'before') {
      // High-initiative enemies done — player acts next
      this.renderer.render();
    } else {
      // Low-initiative enemies done — start next round
      gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);
      const hasBeforeEnemies = this.enemies.some(e => e.attributes.healthPoints > 0 && (e.initiativeRoll || 0) > this.playerInit);
      if (hasBeforeEnemies) {
        this.enemyTurn('before');
      } else {
        this.renderer.render();
      }
    }
  }

  // Returns the weapon this enemy attacks with — equipped Right Hand item, or
  // the default claw fallback if nothing is equipped. Returns null if neither
  // is available (data loading failure).
  _resolveEnemyWeapon(enemy) {
    const equipped = enemy.equipment?.[WEAPON_SLOTS[1]]; // Right Hand
    const item = equipped ? this.engine.data.items[equipped] : null;
    const fallbackId = this.engine.data.rules?.fallbackWeapons?.enemy ?? ENEMY_CLAW_ID;
    return item || this.engine.data.items[fallbackId] || null;
  }

  // Executes all enemy attacks for one turn and returns a roll summary.
  // Mutates player HP via gameState. Does not log — enemyTurn() owns the narrative.
  _resolveEnemyAttacks(eWeapon, eAP, enemy) {
    if (!eWeapon.actionPoints) return { attackCount: 0, hits: 0, misses: 0, totalDamage: 0, hitRolls: [], missRolls: [], damageRolls: [] };

    const player = gameState.getPlayer();
    let attackCount = 0, hits = 0, misses = 0, totalDamage = 0;
    const hitRolls = [], missRolls = [], damageRolls = [];

    while (eAP >= eWeapon.actionPoints && player.resources.hp.current > 0 && enemy.attributes.healthPoints > 0) {
      eAP -= eWeapon.actionPoints;
      attackCount++;

      const hitModifier = eWeapon.bonusHitChance || 0;
      const baseRoll = roll(1, MAX_D20_ROLL);
      const hitRoll = baseRoll + hitModifier;
      const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

      if (hitRoll >= player.attributes.ac) {
        hits++;
        hitRolls.push(`${hitRoll} (1d20${modStr})`);
        const dmgResult = parseDamage(eWeapon.attributes.damageRoll);
        totalDamage += dmgResult.total;
        damageRolls.push(dmgResult.string);
        gameState.modifyPlayerStat('hp', -dmgResult.total);
      } else {
        misses++;
        missRolls.push(`${hitRoll} (1d20${modStr})`);
      }
      if (player.resources.hp.current <= 0) break;
    }

    return { attackCount, hits, misses, totalDamage, hitRolls, missRolls, damageRolls };
  }

  endCombat(isVictory) {
    this.inCombat = false;
    if (!isVictory) this.isGameOver = true;
    if (isVictory) {
      const names = this.enemies.map(e => e.name).join(' & ');
      this.engine.log(LOG.SYSTEM, this.engine.t('combat.victory', { names }), 'loot');

      // Award XP from all enemies
      this.enemies.forEach(enemy => {
        if (enemy.attributes.xpReward) {
          gameState.addXP(enemy.attributes.xpReward);
          this.engine.log(LOG.SYSTEM, `${enemy.name}: ${this.engine.t('loot.xpGained', { amount: enemy.attributes.xpReward })}`, 'loot');
        }
      });

      // Reset AP after combat
      const player = gameState.getPlayer();
      gameState.modifyPlayerStat('ap', player.resources.ap.max - player.resources.ap.current);

      // Run onVictory action pipeline
      const sceneIdBefore = gameState.getCurrentSceneId();
      this.engine.runActions(this.originOption?.onVictory || []);
      const didNavigate = gameState.getCurrentSceneId() !== sceneIdBefore;
      if (!didNavigate) this.engine.renderScene(gameState.getCurrentSceneId());

    } else {
      this.renderer.renderGameOver();
    }
  }
}

// CombatRenderer owns all DOM manipulation for the combat UI.
// It holds no game state — all data is read from combatSystem on each render call.
class CombatRenderer {
  constructor(combatSystem) {
    this.cs = combatSystem;
  }

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

    if (!hasWeapon) {
      const fallbackId = this.cs.engine.data.rules?.fallbackWeapons?.player;
      const unarmed = fallbackId ? this.cs.engine.data.items[fallbackId] : null;
      if (unarmed) attacks.push(unarmed);
    }
    return attacks;
  }

  renderGameOver() {
    this.cs.engine.openScene();
    const desc = buildSceneDescription(
      this.cs.engine.t('combat.gameOverTitle'),
      this.cs.engine.t('combat.gameOverBody')
    );
    desc.querySelector('h2').classList.add(CSS.SCENE_TITLE_GAME_OVER);
    this.cs.engine.currentSceneEl.appendChild(desc);

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());
    clearElement(skillsContainer);
    skillsContainer.setAttribute('hidden', '');
    clearElement(container);
    if (reminder) container.appendChild(reminder);

    const loadBtn = buildOptionButton(this.cs.engine.t('combat.loadLastSave'));
    loadBtn.onclick = () => document.getElementById(EL.BTN_LOAD).click();
    container.appendChild(loadBtn);

    const restartBtn = buildOptionButton(this.cs.engine.t('combat.restartGame'));
    restartBtn.onclick = () => document.getElementById(EL.BTN_RESTART).click();
    container.appendChild(restartBtn);

    document.querySelectorAll(`.${CSS.BTN_ITEM}`).forEach(btn => { btn.disabled = true; });
  }

  render() {
    const livingEnemies = this.cs.enemies.filter(e => e.attributes.healthPoints > 0);

    const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    const container = document.getElementById(EL.SCENE_OPTIONS);
    const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

    clearElement(container);
    clearElement(skillsContainer);
    skillsContainer.setAttribute('hidden', '');
    panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

    if (reminder) {
      reminder.innerText = this.cs.engine.t('ui.locationCombat');
      container.appendChild(reminder);
    }

    const attacks = this.getAvailableAttacks();

    // End Turn at the top so it's always reachable without scrolling.
    const endBtn = buildOptionButton(this.cs.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.cs.enemyTurn('after');
    container.appendChild(endBtn);

    // Each living enemy gets its own section.
    livingEnemies.forEach(target => {
      const section = createElement('div', [CSS.SCENE_OPTIONS, CSS.SCENE_OPTIONS_SECTION]);
      section.appendChild(createElement('div', CSS.SCENE_SECTION_HEADING,
        this.cs.engine.t('combat.enemyStats', { name: target.name, hp: target.attributes.healthPoints, ac: target.attributes.armorClass })
      ));
      attacks.forEach(att => {
        const btn = createElement('button', [CSS.BTN, CSS.OPTION_BTN, CSS.OPTION_BTN_STACKED]);
        btn.appendChild(createElement('span', '', this.cs.engine.t('combat.attackTarget', { name: att.name })));
        btn.appendChild(createElement('span', CSS.OPTION_BTN_BADGE, this.cs.engine.t('combat.apCost', { cost: att.actionPoints })));
        if (gameState.getPlayer().resources.ap.current < att.actionPoints) btn.disabled = true;
        btn.onclick = () => this.cs.playerAttack(att, target);
        section.appendChild(btn);
      });
      panel.insertBefore(section, skillsContainer);
    });
  }
}
