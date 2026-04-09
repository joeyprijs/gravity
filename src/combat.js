import { gameState } from "./state.js";
import { createElement, clearElement } from "./utils.js";
import { MAX_D20_ROLL, UNARMED_STRIKE, ENEMY_CLAW, EL } from "./config.js";

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
  }

  startCombat(enemyId, originOption) {
    const enemyData = this.engine.data.npcs[enemyId];
    if (!enemyData) return;

    this.engine.lastRenderedSceneId = null;
    this.inCombat = true;
    // Deep clone so we can mutate HP without touching the source data
    this.enemy = JSON.parse(JSON.stringify(enemyData));
    this.enemy.id = enemyId;
    this.originOption = originOption;

    // Restore player AP to full at the start of every combat encounter
    const player = gameState.getPlayer();
    gameState.modifyPlayerStat('ap', player.maxAp - player.ap);

    this.engine.openScene('combat');
    const desc = createElement('div', 'scene__description');
    desc.innerHTML = `<h2 class="scene__title">Fighting: ${this.enemy.name}</h2>${this.enemy.description ? `<p class="scene__body">${this.enemy.description}</p>` : ''}`;
    this.engine.currentSceneEl.appendChild(desc);

    this.engine.log("Combat", `Combat started with ${this.enemy.name}!`, 'combat');

    // Roll initiative
    const playerInit = Math.ceil(Math.random() * MAX_D20_ROLL) + (player.initiative || 0);
    const enemyInit  = Math.ceil(Math.random() * MAX_D20_ROLL) + (this.enemy.attributes.initiative || 0);
    this.enemyGoesFirst = enemyInit > playerInit;
    this.engine.log("Combat", `Initiative: You rolled ${playerInit} vs ${this.enemy.name} rolled ${enemyInit}. ${this.enemyGoesFirst ? this.enemy.name + ' goes first!' : 'You go first!'}`, 'combat');

    this.renderCombatUI();
    if (this.enemyGoesFirst) this.enemyTurn();
  }

  renderCombatUI() {
    const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);
    if (reminder) reminder.innerText = `Combat: ${this.enemy.name}`;

    const container = document.getElementById(EL.SCENE_OPTIONS);
    clearElement(container);

    const statsBar = createElement('div', 'combat-stats__bar', `<strong>Enemy HP: ${this.enemy.attributes.healthPoints} | AC: ${this.enemy.attributes.armorClass}</strong>`);
    container.appendChild(statsBar);

    const attacks = this.getAvailableAttacks();

    attacks.forEach(att => {
      const btn = createElement('button', 'option-btn', `<span>Attack with ${att.name}</span> <span class="option-btn__req-text">AP: ${att.actionPoints}</span>`);
      if (gameState.getPlayer().ap < att.actionPoints) btn.disabled = true;
      btn.onclick = () => this.playerAttack(att);
      container.appendChild(btn);
    });

    // End turn button
    const endBtn = createElement('button', 'option-btn', `<span>End Turn</span>`);
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
      attacks.push(UNARMED_STRIKE);
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
      this.engine.log("player", `Attack Roll with ${weapon.name}: [${baseRoll}]${modStr} vs AC ${this.enemy.attributes.armorClass}. Hit! You deal ${dmgResult.total} damage! (Roll: ${dmgResult.string})`, 'damage');

      if (this.enemy.attributes.healthPoints <= 0) {
        this.endCombat(true);
        return;
      }
    } else {
      this.engine.log("player", `Attack Roll with ${weapon.name}: [${baseRoll}]${modStr} vs AC ${this.enemy.attributes.armorClass}. Miss!`, 'damage');
    }

    if (player.ap > 0) {
      this.renderCombatUI();
    } else {
      this.enemyTurn();
    }
  }

  enemyTurn() {
    if (!this.inCombat) return;

    let eAP = this.enemy.attributes.actionPoints;
    const player = gameState.getPlayer();

    // Determine enemy weapon
    let eWeapon = ENEMY_CLAW;
    if (this.enemy.equipment && this.enemy.equipment['Right Hand']) {
      const wid = this.enemy.equipment['Right Hand'];
      if (this.engine.data.items[wid]) {
        eWeapon = this.engine.data.items[wid];
      }
    }

    let attackCount = 0;
    let hits = 0;
    let misses = 0;
    let totalDamage = 0;
    let hitRolls = [];
    let missRolls = [];
    let damageRolls = [];

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

    if (attackCount > 0) {
      let parts = [];
      if (hits > 0) parts.push(`${hits} hit${hits > 1 ? 's' : ''} (Roll: ${hitRolls.join(' and ')})`);
      if (misses > 0) parts.push(`${misses} miss${misses > 1 ? 'es' : ''} (Roll: ${missRolls.join(' and ')})`);
      
      let summary = `Attacked with ${eWeapon.name} ${attackCount} time${attackCount > 1 ? 's' : ''}, ${parts.join(', ')}.`;
      if (hits > 0) {
        summary += ` You take ${totalDamage} damage (Roll: ${damageRolls.join(' and ')})!`;
      } else {
        summary += ` You take 0 damage.`;
      }
      this.engine.log(this.enemy.name, summary, 'damage');
    }

    if (player.hp <= 0) {
      this.endCombat(false);
      return;
    }

    // Reset player AP for next round
    gameState.modifyPlayerStat('ap', player.maxAp - player.ap);
    this.renderCombatUI();
  }

  endCombat(isVictory) {
    this.inCombat = false;
    if (isVictory) {
      this.engine.log("System", `You defeated ${this.enemy.name}!`, 'loot');

      // Loot
      if (this.enemy.droppedLoot) {
        this.enemy.droppedLoot.forEach(l => {
          if (l.item === 'gold') {
            gameState.modifyPlayerStat('gold', l.amount);
            this.engine.log("System", `Found ${l.amount} Gold.`, 'loot');
          } else {
            gameState.addToInventory(l.item, l.amount || 1);
            this.engine.log("System", `Found ${this.engine.data.items[l.item]?.name || l.item}.`, 'loot');
          }
        });
      }
      // XP reward
      if (this.enemy.attributes.xpReward) {
        gameState.addXP(this.enemy.attributes.xpReward);
        this.engine.log("System", `+${this.enemy.attributes.xpReward} XP`, 'loot');
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
      const desc = createElement('div', 'scene__description');
      desc.innerHTML = `<h2 class="scene__title scene__title--game-over">Game Over</h2><p class="scene__body">Your adventure ends here.</p>`;
      this.engine.currentSceneEl.appendChild(desc);

      const container = document.getElementById(EL.SCENE_OPTIONS);
      clearElement(container);
      const loadBtn = createElement('button', 'option-btn', `Load Last Save`);
      loadBtn.onclick = () => document.getElementById(EL.BTN_LOAD).click();
      container.appendChild(loadBtn);

      const restartBtn = createElement('button', 'option-btn', `Restart Game`);
      restartBtn.onclick = () => document.getElementById(EL.BTN_RESTART).click();
      container.appendChild(restartBtn);
    }
  }
}
