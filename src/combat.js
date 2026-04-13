import { gameState } from "./state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton, applyOptionsLayout } from "./utils.js";
import { MAX_D20_ROLL, UNARMED_STRIKE_ID, ENEMY_CLAW_ID, EL, CSS, LOG } from "./config.js";

// CombatSystem manages the full lifecycle of a turn-based combat encounter:
// initiative roll, player/enemy turns, AP tracking, and victory/defeat resolution.
export class CombatSystem {
  constructor(engine) {
    this.engine = engine;
    this.inCombat = false;
    this.enemies = [];
    // originOption is the scene option that triggered this combat. On victory,
    // its requiredState flag is flipped so the fight option disappears.
    this.originOption = null;

    this.playerInit = 0;

    this.engine.on('player:apSpent', ({ remaining }) => {
      if (!this.inCombat) return;
      if (remaining <= 0) {
        this.enemyTurn('after');
      } else {
        this.renderCombatUI();
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

    this.engine.scene.reset();
    this.inCombat = true;
    this.enemies = enemyDataList;
    this.originOption = originOption;

    // Restore player AP to full at the start of every combat encounter
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', player.maxAp - player.ap);

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
    this.playerInit = this.roll(1, MAX_D20_ROLL) + (player.initiative || 0);
    let highestEnemyInit = 0;
    this.enemies.forEach(e => {
      e.initiativeRoll = this.roll(1, MAX_D20_ROLL) + (e.attributes.initiative || 0);
      if (e.initiativeRoll > highestEnemyInit) highestEnemyInit = e.initiativeRoll;
    });
    this.enemyGoesFirst = highestEnemyInit > this.playerInit;
    const enemyRolls = this.enemies
      .map(e => this.engine.t('combat.initiativeEnemy', { name: e.name, roll: e.initiativeRoll }))
      .join(', ');
    const allCombatants = [
      { name: this.engine.t('combat.initiativeYou'), roll: this.playerInit },
      ...this.enemies.map(e => ({ name: e.name, roll: e.initiativeRoll || 0 }))
    ].sort((a, b) => b.roll - a.roll);
    const turnOrder = allCombatants.map(c => c.name).join(' → ');
    this.engine.log(LOG.COMBAT, this.engine.t('combat.initiative', { playerRoll: this.playerInit, enemyRolls, turnOrder }), 'combat');

    this.renderCombatUI();
    if (this.enemyGoesFirst) this.enemyTurn('before');
  }

  renderCombatUI() {
    const livingEnemies = this.enemies.filter(e => e.attributes.healthPoints > 0);

    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = this.engine.t('ui.locationCombat', { name: livingEnemies.map(e => e.name).join(' & ') });

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    // Stats bar: one entry per living enemy.
    // innerHTML is safe here — e.name comes from authored NPC JSON, hp/ac are numbers.
    const statsBar = createElement('div', CSS.COMBAT_STATS_BAR);
    statsBar.innerHTML = `<strong>${livingEnemies.map(e =>
      this.engine.t('combat.enemyStats', { name: e.name, hp: e.attributes.healthPoints, ac: e.attributes.armorClass })
    ).join('<br />')}</strong>`;
    container.appendChild(statsBar);

    const attacks = this.getAvailableAttacks();

    // One button per (living enemy × weapon). With multiple enemies, buttons are
    // grouped per enemy under a labelled section so attacks don't intermingle.
    livingEnemies.forEach(target => {
      let btnContainer = container;

      if (livingEnemies.length > 1) {
        const group = createElement('div', CSS.OPTIONS_GROUP);
        const label = createElement('div', CSS.OPTIONS_GROUP_LABEL, target.name);
        const btns = createElement('div', CSS.OPTIONS_GROUP_BUTTONS);
        if (attacks.length === 1) btns.classList.add(CSS.OPTIONS_GROUP_BUTTONS_SINGLE);
        group.appendChild(label);
        group.appendChild(btns);
        container.appendChild(group);
        btnContainer = btns;
      }

      attacks.forEach(att => {
        const btn = buildOptionButton(
          this.engine.t('combat.attackTarget', { name: att.name, target: target.name }),
          this.engine.t('combat.apCost', { cost: att.actionPoints })
        );
        if (gameState.getPlayer().ap < att.actionPoints) btn.disabled = true;
        btn.onclick = () => this.playerAttack(att, target);
        btnContainer.appendChild(btn);
      });
    });

    // End turn button
    const endBtn = buildOptionButton(this.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.enemyTurn('after');
    container.appendChild(endBtn);

    applyOptionsLayout(container);
  }

  getAvailableAttacks() {
    const player = gameState.getPlayer();
    const attacks = [];

    let hasWeapon = false;
    ['Left Hand', 'Right Hand'].forEach(slot => {
      const itemId = player.equipment[slot];
      if (itemId && this.engine.data.items[itemId]) {
        const item = this.engine.data.items[itemId];
        if (item.type === 'Weapon' || item.type === 'Spell') {
          attacks.push(item);
          hasWeapon = true;
        }
      }
    });

    if (!hasWeapon) {
      const unarmed = this.engine.data.items[UNARMED_STRIKE_ID];
      if (unarmed) attacks.push(unarmed);
    }
    return attacks;
  }

  roll(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Parses a damage string and returns { total, string } where string is a
  // human-readable roll breakdown for the combat log.
  //
  // Supported formats:
  //   "1d6"    — roll one six-sided die
  //   "2d4+2"  — roll two d4s and add 2
  //   "1d8-1"  — roll one d8 and subtract 1
  //   "1-4"    — legacy range syntax (kept for backwards compatibility)
  //
  // Returns { total: 1, string: "1" } as a safe fallback for unrecognised input.
  parseDamage(dmgString) {
    if (!dmgString) return { total: 1, string: "1" };

    // Legacy "min-max" range syntax (e.g. "1-4"). Must be checked before the
    // dice regex because it also contains a hyphen.
    if (dmgString.includes('-') && !dmgString.includes('d')) {
      const [a, b] = dmgString.split('-').map(Number);
      return { total: this.roll(Math.min(a, b), Math.max(a, b)), string: dmgString };
    }

    // Standard dice notation: NdF[+/-M] (e.g. "2d6+3")
    const regex = /^(\d+)d(\d+)([\+\-]\d+)?$/;
    const match = dmgString.match(regex);

    if (!match) {
      console.warn(`[Gravity] parseDamage: unrecognised format "${dmgString}", defaulting to 1`);
      return { total: 1, string: "1" };
    }

    const numDice = parseInt(match[1]);
    const diceFaces = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;

    let totalRoll = 0;
    let rollResults = [];

    for (let i = 0; i < numDice; i++) {
      const r = this.roll(1, diceFaces);
      totalRoll += r;
      rollResults.push(r);
    }

    // Clamp to 0 so negative modifiers never produce negative damage
    const grandTotal = Math.max(0, totalRoll + modifier);

    let rollStr = rollResults.join('+');
    if (modifier > 0) rollStr += `+${modifier}`;
    else if (modifier < 0) rollStr += `${modifier}`;

    return { total: grandTotal, string: rollStr };
  }

  playerAttack(weapon, targetEnemy) {
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', -weapon.actionPoints);

    // Attack roll 1-20 + modifier
    const hitModifier = weapon.bonusHitChance || 0;
    const baseRoll = this.roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + hitModifier;
    const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

    if (hitRoll >= targetEnemy.attributes.armorClass) {
      const dmgResult = this.parseDamage(weapon.attributes.damageRoll);
      targetEnemy.attributes.healthPoints -= dmgResult.total;
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackHit', {
        weapon: weapon.name, roll: hitRoll, mod: modStr,
        ac: targetEnemy.attributes.armorClass, damage: dmgResult.total, dice: weapon.attributes.damageRoll, rollStr: dmgResult.string
      }), 'damage');

      if (targetEnemy.attributes.healthPoints <= 0) {
        this.engine.log(LOG.COMBAT, this.engine.t('combat.enemyDefeated', { name: targetEnemy.name }), 'loot');
        if (this.enemies.every(e => e.attributes.healthPoints <= 0)) {
          this.endCombat(true);
          return;
        }
      }
    } else {
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
        weapon: weapon.name, roll: hitRoll, mod: modStr, ac: targetEnemy.attributes.armorClass
      }), 'damage');
    }

    // Let the apSpent handler decide renderCombatUI vs enemyTurn — consistent
    // with how item/equip AP costs are handled during combat.
    if (this.inCombat) this.engine.emit('player:apSpent', { remaining: player.ap });
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

        const times = result.attackCount === 1 ? 'once' : result.attackCount === 2 ? 'twice' : `${result.attackCount} times`;
        let summary = this.engine.t('combat.enemyAttack', { name: enemy.name, weapon: eWeapon.name, times, parts: parts.join(', ') });
        summary += ' ' + (result.hits > 0
          ? this.engine.t('combat.playerTakesDamage', { damage: result.totalDamage, dice: eWeapon.attributes.damageRoll, rolls: result.damageRolls.join(' and ') })
          : this.engine.t('combat.playerTakesNoDamage'));
        this.engine.log(LOG.COMBAT, summary, 'damage');
      }

      if (player.hp <= 0) {
        this.endCombat(false);
        return;
      }
    }

    if (phase === 'before') {
      // High-initiative enemies done — player acts next
      this.renderCombatUI();
    } else {
      // Low-initiative enemies done — start next round
      gameState.modifyPlayerStat('ap', player.maxAp - player.ap);
      const hasBeforeEnemies = this.enemies.some(e => e.attributes.healthPoints > 0 && (e.initiativeRoll || 0) > this.playerInit);
      if (hasBeforeEnemies) {
        this.enemyTurn('before');
      } else {
        this.renderCombatUI();
      }
    }
  }

  // Returns the weapon this enemy attacks with — equipped Right Hand item, or
  // the default claw fallback if nothing is equipped. Returns null if neither
  // is available (data loading failure).
  _resolveEnemyWeapon(enemy) {
    const equipped = enemy.equipment?.['Right Hand'];
    const item = equipped ? this.engine.data.items[equipped] : null;
    return item || this.engine.data.items[ENEMY_CLAW_ID] || null;
  }

  // Executes all enemy attacks for one turn and returns a roll summary.
  // Mutates player HP via gameState. Does not log — enemyTurn() owns the narrative.
  _resolveEnemyAttacks(eWeapon, eAP, enemy) {
    if (!eWeapon.actionPoints) return { attackCount: 0, hits: 0, misses: 0, totalDamage: 0, hitRolls: [], missRolls: [], damageRolls: [] };

    const player = gameState.getPlayer();
    let attackCount = 0, hits = 0, misses = 0, totalDamage = 0;
    const hitRolls = [], missRolls = [], damageRolls = [];

    while (eAP >= eWeapon.actionPoints && player.hp > 0 && enemy.attributes.healthPoints > 0) {
      eAP -= eWeapon.actionPoints;
      attackCount++;

      const hitModifier = eWeapon.bonusHitChance || 0;
      const baseRoll = this.roll(1, MAX_D20_ROLL);
      const hitRoll = baseRoll + hitModifier;
      const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

      if (hitRoll >= player.ac) {
        hits++;
        hitRolls.push(`${hitRoll} (1d20${modStr})`);
        const dmgResult = this.parseDamage(eWeapon.attributes.damageRoll);
        totalDamage += dmgResult.total;
        damageRolls.push(dmgResult.string);
        gameState.modifyPlayerStat('hp', -dmgResult.total);
      } else {
        misses++;
        missRolls.push(`${hitRoll} (1d20${modStr})`);
      }
      if (player.hp <= 0) break;
    }

    return { attackCount, hits, misses, totalDamage, hitRolls, missRolls, damageRolls };
  }

  endCombat(isVictory) {
    this.inCombat = false;
    if (isVictory) {
      const names = this.enemies.map(e => e.name).join(' & ');
      this.engine.log(LOG.SYSTEM, this.engine.t('combat.victory', { names }), 'loot');

      // Aggregate loot and XP from all enemies
      this.enemies.forEach(enemy => {
        if (enemy.droppedLoot) {
          enemy.droppedLoot.forEach(l => {
            if (l.item === 'gold') {
              gameState.modifyPlayerStat('gold', l.amount);
              this.engine.log(LOG.SYSTEM, `${enemy.name}: ${this.engine.t('loot.foundGold', { amount: l.amount })}`, 'loot');
            } else {
              gameState.addToInventory(l.item, l.amount || 1);
              this.engine.log(LOG.SYSTEM, `${enemy.name}: ${this.engine.t('loot.foundItem', { name: this.engine.data.items[l.item]?.name || l.item })}`, 'loot');
            }
          });
        }
        if (enemy.attributes.xpReward) {
          gameState.addXP(enemy.attributes.xpReward);
          this.engine.log(LOG.SYSTEM, `${enemy.name}: ${this.engine.t('loot.xpGained', { amount: enemy.attributes.xpReward })}`, 'loot');
        }
      });

      // Flag flip
      if (this.originOption && this.originOption.requiredState) {
        gameState.setFlag(this.originOption.requiredState.flag, !this.originOption.requiredState.value);
      }

      // Reset AP after combat
      const player = gameState.getPlayer();
      gameState.modifyPlayerStat('ap', player.maxAp - player.ap);

      // Return to scene
      if (this.originOption.destination) {
        this.engine.renderScene(this.originOption.destination);
      } else {
        this.engine.renderScene(gameState.getCurrentSceneId());
      }

    } else {
      this.engine.openScene();
      const desc = buildSceneDescription(
        this.engine.t('combat.gameOverTitle'),
        this.engine.t('combat.gameOverBody')
      );
      desc.querySelector('h2').classList.add(CSS.SCENE_TITLE_GAME_OVER);
      this.engine.currentSceneEl.appendChild(desc);

      const container = document.getElementById(EL.SCENE_OPTIONS);
      clearElement(container);
      const loadBtn = buildOptionButton(this.engine.t('combat.loadLastSave'));
      loadBtn.onclick = () => document.getElementById(EL.BTN_LOAD).click();
      container.appendChild(loadBtn);

      const restartBtn = buildOptionButton(this.engine.t('combat.restartGame'));
      restartBtn.onclick = () => document.getElementById(EL.BTN_RESTART).click();
      container.appendChild(restartBtn);
    }
  }
}
