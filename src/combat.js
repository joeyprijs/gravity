import { gameState } from "./state.js";
import { createElement, clearElement, buildSceneDescription, buildOptionButton } from "./utils.js";
import { MAX_D20_ROLL, UNARMED_STRIKE_ID, ENEMY_CLAW_ID, EL, CSS, LOG } from "./config.js";

// CombatSystem manages the full lifecycle of a turn-based combat encounter:
// initiative roll, player/enemy turns, AP tracking, and victory/defeat resolution.
export class CombatSystem {
  constructor(engine) {
    this.engine = engine;
    this.inCombat = false;
    this.enemy = null;
    // originOption is the scene option that triggered this combat. On victory,
    // its requiredState flag is flipped so the fight option disappears.
    this.originOption = null;

    this.engine.on('player:apSpent', ({ remaining }) => {
      if (!this.inCombat) return;
      if (remaining <= 0) {
        this.enemyTurn();
      } else {
        this.renderCombatUI();
      }
    });
  }

  startCombat(enemyId, originOption) {
    const enemyData = this.engine.data.npcs[enemyId];
    if (!enemyData) { console.warn(`[Gravity] startCombat: unknown enemy "${enemyId}"`); return; }

    this.engine.scene.reset();
    this.inCombat = true;
    // Deep clone so we can mutate HP without touching the source data
    this.enemy = JSON.parse(JSON.stringify(enemyData));
    this.enemy.id = enemyId;
    this.originOption = originOption;

    // Restore player AP to full at the start of every combat encounter
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', player.maxAp - player.ap);

    this.engine.openScene(CSS.SCENE_COMBAT);
    this.engine.currentSceneEl.appendChild(
      buildSceneDescription(
        this.engine.t('combat.fightingTitle', { name: this.enemy.name }),
        this.enemy.description || null
      )
    );

    this.engine.log(LOG.COMBAT, this.engine.t('combat.started', { name: this.enemy.name }), 'combat');

    // Roll initiative
    const playerInit = Math.ceil(Math.random() * MAX_D20_ROLL) + (player.initiative || 0);
    const enemyInit  = Math.ceil(Math.random() * MAX_D20_ROLL) + (this.enemy.attributes.initiative || 0);
    this.enemyGoesFirst = enemyInit > playerInit;
    const goesFirst = this.enemyGoesFirst
      ? this.engine.t('combat.enemyGoesFirst', { name: this.enemy.name })
      : this.engine.t('combat.youGoFirst');
    this.engine.log(LOG.COMBAT, this.engine.t('combat.initiative', { playerRoll: playerInit, name: this.enemy.name, enemyRoll: enemyInit, goesFirst }), 'combat');

    this.renderCombatUI();
    if (this.enemyGoesFirst) this.enemyTurn();
  }

  renderCombatUI() {
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = this.engine.t('ui.locationCombat', { name: this.enemy.name });

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    const statsBar = createElement('div', CSS.COMBAT_STATS_BAR, `<strong>${this.engine.t('combat.enemyStats', { hp: this.enemy.attributes.healthPoints, ac: this.enemy.attributes.armorClass })}</strong>`);
    container.appendChild(statsBar);

    const attacks = this.getAvailableAttacks();

    attacks.forEach(att => {
      const btn = buildOptionButton(
        this.engine.t('combat.attackWith', { name: att.name }),
        this.engine.t('combat.apCost', { cost: att.actionPoints })
      );
      if (gameState.getPlayer().ap < att.actionPoints) btn.disabled = true;
      btn.onclick = () => this.playerAttack(att);
      container.appendChild(btn);
    });

    // End turn button
    const endBtn = buildOptionButton(this.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.enemyTurn();
    container.appendChild(endBtn);
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
      attacks.push(this.engine.data.items[UNARMED_STRIKE_ID]);
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
    // Legacy "min-max" range syntax (e.g. "1-4"). Must be checked before the
    // dice regex because it also contains a hyphen.
    if (dmgString.includes('-') && !dmgString.includes('d')) {
      const [min, max] = dmgString.split('-').map(Number);
      return { total: this.roll(min, max), string: dmgString };
    }

    // Standard dice notation: NdF[+/-M] (e.g. "2d6+3")
    const regex = /^(\d+)d(\d+)([\+\-]\d+)?$/;
    const match = dmgString.match(regex);

    if (!match) return { total: 1, string: "1" };

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

    let rollStr = `[${rollResults.join('+')}]`;
    if (modifier > 0) rollStr += `+${modifier}`;
    else if (modifier < 0) rollStr += `${modifier}`;

    return { total: grandTotal, string: rollStr };
  }

  playerAttack(weapon) {
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', -weapon.actionPoints);

    // Attack roll 1-20 + modifier
    const hitModifier = weapon.bonusHitChance || 0;
    const baseRoll = this.roll(1, MAX_D20_ROLL);
    const hitRoll = baseRoll + hitModifier;
    const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

    if (hitRoll >= this.enemy.attributes.armorClass) {
      const dmgResult = this.parseDamage(weapon.attributes.damageRoll);
      this.enemy.attributes.healthPoints -= dmgResult.total;
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackHit', {
        weapon: weapon.name, roll: baseRoll, mod: modStr,
        ac: this.enemy.attributes.armorClass, damage: dmgResult.total, rollStr: dmgResult.string
      }), 'damage');

      if (this.enemy.attributes.healthPoints <= 0) {
        this.endCombat(true);
        return;
      }
    } else {
      this.engine.log(LOG.PLAYER, this.engine.t('combat.attackMiss', {
        weapon: weapon.name, roll: baseRoll, mod: modStr, ac: this.enemy.attributes.armorClass
      }), 'damage');
    }

    if (player.ap > 0) {
      this.renderCombatUI();
    } else {
      this.enemyTurn();
    }
  }

  enemyTurn() {
    if (!this.inCombat) return;

    const player = gameState.getPlayer();
    const eWeapon = this._resolveEnemyWeapon();
    if (!eWeapon) { console.warn('[Gravity] enemyTurn: no weapon resolved, ending combat'); this.endCombat(false); return; }
    const result = this._resolveEnemyAttacks(eWeapon, this.enemy.attributes.actionPoints);

    if (result.attackCount > 0) {
      const parts = [];
      if (result.hits > 0) parts.push(this.engine.t('combat.enemyAttackHits', { count: result.hits, s: result.hits > 1 ? 's' : '', rolls: result.hitRolls.join(' and ') }));
      if (result.misses > 0) parts.push(this.engine.t('combat.enemyAttackMisses', { count: result.misses, es: result.misses > 1 ? 'es' : '', rolls: result.missRolls.join(' and ') }));

      let summary = this.engine.t('combat.enemyAttack', { weapon: eWeapon.name, count: result.attackCount, s: result.attackCount > 1 ? 's' : '', parts: parts.join(', ') });
      summary += ' ' + (result.hits > 0
        ? this.engine.t('combat.playerTakesDamage', { damage: result.totalDamage, rolls: result.damageRolls.join(' and ') })
        : this.engine.t('combat.playerTakesNoDamage'));
      this.engine.log(LOG.COMBAT, summary, 'damage');
    }

    if (player.hp <= 0) {
      this.endCombat(false);
      return;
    }

    // Reset player AP for next round
    gameState.modifyPlayerStat('ap', player.maxAp - player.ap);
    this.renderCombatUI();
  }

  // Returns the weapon this enemy attacks with — equipped Right Hand item, or
  // the default claw fallback if nothing is equipped. Returns null if neither
  // is available (data loading failure).
  _resolveEnemyWeapon() {
    const equipped = this.enemy.equipment?.['Right Hand'];
    const item = equipped ? this.engine.data.items[equipped] : null;
    return item || this.engine.data.items[ENEMY_CLAW_ID] || null;
  }

  // Executes all enemy attacks for one turn and returns a roll summary.
  // Mutates player HP via gameState. Does not log — enemyTurn() owns the narrative.
  _resolveEnemyAttacks(eWeapon, eAP) {
    const player = gameState.getPlayer();
    let attackCount = 0, hits = 0, misses = 0, totalDamage = 0;
    const hitRolls = [], missRolls = [], damageRolls = [];

    while (eAP >= eWeapon.actionPoints && player.hp > 0 && this.enemy.attributes.healthPoints > 0) {
      eAP -= eWeapon.actionPoints;
      attackCount++;

      const hitModifier = eWeapon.bonusHitChance || 0;
      const baseRoll = this.roll(1, MAX_D20_ROLL);
      const hitRoll = baseRoll + hitModifier;
      const modStr = hitModifier !== 0 ? (hitModifier > 0 ? `+${hitModifier}` : hitModifier) : "";

      if (hitRoll >= player.ac) {
        hits++;
        hitRolls.push(`[${baseRoll}]${modStr}`);
        const dmgResult = this.parseDamage(eWeapon.attributes.damageRoll);
        totalDamage += dmgResult.total;
        damageRolls.push(dmgResult.string);
        gameState.modifyPlayerStat('hp', -dmgResult.total);
      } else {
        misses++;
        missRolls.push(`[${baseRoll}]${modStr}`);
      }
      if (player.hp <= 0) break;
    }

    return { attackCount, hits, misses, totalDamage, hitRolls, missRolls, damageRolls };
  }

  endCombat(isVictory) {
    this.inCombat = false;
    if (isVictory) {
      this.engine.log(LOG.SYSTEM, this.engine.t('combat.victory', { name: this.enemy.name }), 'loot');

      // Loot
      if (this.enemy.droppedLoot) {
        this.enemy.droppedLoot.forEach(l => {
          if (l.item === 'gold') {
            gameState.modifyPlayerStat('gold', l.amount);
            this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundGold', { amount: l.amount }), 'loot');
          } else {
            gameState.addToInventory(l.item, l.amount || 1);
            this.engine.log(LOG.SYSTEM, this.engine.t('loot.foundItem', { name: this.engine.data.items[l.item]?.name || l.item }), 'loot');
          }
        });
      }
      // XP reward
      if (this.enemy.attributes.xpReward) {
        gameState.addXP(this.enemy.attributes.xpReward);
        this.engine.log(LOG.SYSTEM, this.engine.t('loot.xpGained', { amount: this.enemy.attributes.xpReward }), 'loot');
      }

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
