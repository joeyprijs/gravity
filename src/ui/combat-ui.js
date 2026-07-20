import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel, itemStatLines } from "../core/utils.js";
import { EL, CSS, WEAPON_SLOTS } from "../core/config.js";

// CombatRenderer owns the combat UI: the attack/end-turn controls and the
// game-over screen. It holds no state of its own — every render reads live
// from the CombatSystem, so a re-render can never show stale HP or AP.
export class CombatRenderer {
  constructor(combatSystem) {
    this.cs = combatSystem;
  }

  /**
   * The attacks the player can make: the Weapon/Spell items in their hand
   * slots, or rules.fallbackWeapons.player (unarmed) when both are empty.
   *
   * @returns {object[]} Item definitions, in slot order.
   */
  getAvailableAttacks() {
    const player = this.cs.engine.state.getPlayer();
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

  // Renders the game-over screen: the death notice in the narrative log and
  // the recovery controls in the options panel.
  renderGameOver() {
    this.cs.engine.openScene();
    const desc = buildSceneDescription(
      this.cs.engine.t('combat.gameOverTitle'),
      this.cs.engine.t('combat.gameOverBody'),
      this.cs.engine.t.bind(this.cs.engine)
    );
    desc.querySelector('h2').classList.add(CSS.SCENE_TITLE_GAME_OVER);
    this.cs.engine.currentSceneEl.appendChild(desc);

    const { container } = resetOptionsPanel();

    // The recovery controls delegate to the options-tab buttons, which only
    // exist when rules.tabs includes an 'options' widget — skip a control
    // whose target is missing rather than render a dead button.
    const loadTarget = document.getElementById(EL.BTN_LOAD);
    if (loadTarget) {
      const loadBtn = buildOptionButton(this.cs.engine.t('combat.loadLastSave'));
      loadBtn.onclick = () => loadTarget.click();
      container.appendChild(loadBtn);
    }

    const restartTarget = document.getElementById(EL.BTN_RESTART);
    if (restartTarget) {
      const restartBtn = buildOptionButton(this.cs.engine.t('combat.restartGame'));
      restartBtn.onclick = () => restartTarget.click();
      container.appendChild(restartBtn);
    }

    // Dead characters don't drink potions — the sidebar item buttons go dark.
    document.querySelectorAll(`.${CSS.BTN_ITEM}`).forEach(btn => { btn.disabled = true; });
  }

  // Rebuilds the combat controls: End Turn on top, then one section per
  // living enemy with an attack button for each available weapon.
  render() {
    const livingEnemies = this.cs.enemies.filter(e => e.attributes.healthPoints > 0);

    const { panel, container, skillsContainer } = resetOptionsPanel(this.cs.engine.t('ui.locationCombat'));

    const attacks = this.getAvailableAttacks();

    // End Turn sits first so the most-reached-for control never moves as
    // enemy sections come and go.
    const endBtn = buildOptionButton(this.cs.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.cs.enemyTurn('after');
    container.appendChild(endBtn);

    livingEnemies.forEach(target => {
      const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
      section.appendChild(createElement('div', CSS.SECTION_HEADING,
        this.cs.engine.t('combat.enemyStats', { name: target.name, hp: target.attributes.healthPoints, ac: target.attributes.armorClass })
      ));

      attacks.forEach(att => {
        const btn = buildOptionButton(
          this.cs.engine.t('combat.attackTarget', { name: att.name }),
          itemStatLines(this.cs.engine.t.bind(this.cs.engine), att, this.cs.engine.state.getPlayer().attributes));

        // Attacks the player's remaining AP can't cover render disabled.
        if (this.cs.remainingTurnBudget() < (att.attributes?.actionPoints ?? 0)) {
          btn.disabled = true;
        }
        btn.onclick = () => this.cs.playerAttack(att, target);
        section.appendChild(btn);
      });
      panel.insertBefore(section, skillsContainer);
    });
  }
}
