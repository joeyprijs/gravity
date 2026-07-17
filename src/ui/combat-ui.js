import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel, itemStatLines } from "../core/utils.js";
import { EL, CSS, WEAPON_SLOTS } from "../core/config.js";

/**
 * CombatRenderer owns all DOM manipulation and controls injection for the combat UI.
 * Highly decoupled — holds no state and reads directly from the CombatSystem on render.
 */
export class CombatRenderer {
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
      const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
      section.appendChild(createElement('div', CSS.SECTION_HEADING,
        this.cs.engine.t('combat.enemyStats', { name: target.name, hp: target.attributes.healthPoints, ac: target.attributes.armorClass })
      ));
      
      attacks.forEach(att => {
        const btn = buildOptionButton(
          this.cs.engine.t('combat.attackTarget', { name: att.name }),
          itemStatLines(this.cs.engine.t.bind(this.cs.engine), att, this.cs.engine.state.getPlayer().attributes));
        
        // Disable attack controls that exceed the remaining turn budget
        // (current AP, capped by rules.apEconomy.maxPerTurn).
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
