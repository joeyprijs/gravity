import { createElement, buildSceneDescription, buildOptionButton, resetOptionsPanel, itemStatLines } from "../core/utils.js";
import { EL, CSS, WEAPON_SLOTS } from "../core/config.js";

// The enemies a capped multi-target attack (targets: N) catches around a
// primary target: a window of up to N on the living-enemies line (authored
// encounter order), positioned as centered on the primary as the line's ends
// allow. The attacked enemy is always inside; its neighbours fill the rest.
// Pure list math, engine-free, so it runs directly in node:test.
export function splashTargets(living, primary, cap) {
  if (cap >= living.length) return living;
  const idx = living.indexOf(primary);
  const start = Math.max(0, Math.min(idx - Math.floor((cap - 1) / 2), living.length - cap));
  return living.slice(start, start + cap);
}

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
    const fieldWide = attacks.filter(att => att.attributes?.targets === 'all');
    const perEnemy = attacks.filter(att => att.attributes?.targets !== 'all');

    // End Turn sits first so the most-reached-for control never moves as
    // enemy sections come and go.
    const endBtn = buildOptionButton(this.cs.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.cs.enemyTurn('after');
    container.appendChild(endBtn);

    // An all-enemies attack takes no target, so it renders once, in its own
    // section above the enemy list.
    if (fieldWide.length) {
      const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
      section.appendChild(createElement('div', CSS.SECTION_HEADING, this.cs.engine.t('combat.allEnemiesHeading')));
      fieldWide.forEach(att => {
        section.appendChild(this._attackButton(att, () => this.cs.playerAttackMulti(att)));
      });
      panel.insertBefore(section, skillsContainer);
    }

    // A capped attack (targets: N) reads like any other: one button under
    // each enemy. The click centers the blast there — splashTargets adds
    // the neighbours — so choosing whom to attack still matters.
    livingEnemies.forEach(target => {
      const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
      section.appendChild(createElement('div', CSS.SECTION_HEADING,
        this.cs.engine.t('combat.enemyStats', { name: target.name, hp: target.attributes.healthPoints, ac: target.attributes.armorClass })
      ));

      perEnemy.forEach(att => {
        const cap = att.attributes?.targets;
        section.appendChild(this._attackButton(att, cap
          ? () => this.cs.playerAttackMulti(att, splashTargets(
              this.cs.enemies.filter(e => e.attributes.healthPoints > 0), target, cap))
          : () => this.cs.playerAttack(att, target)));
      });
      panel.insertBefore(section, skillsContainer);
    });
  }

  // One attack button: label, the item's stat lines, disabled when the
  // player's remaining AP can't cover it or a rest-limited item is spent.
  _attackButton(att, onClick) {
    const uses = this.cs.engine.state.getItemUses(att.id);
    const btn = buildOptionButton(
      this.cs.engine.t('combat.attackTarget', { name: att.name }),
      itemStatLines(this.cs.engine.t.bind(this.cs.engine), att, this.cs.engine.state.getPlayer().attributes, uses));
    if (this.cs.remainingTurnBudget() < (att.attributes?.actionPoints ?? 0)
        || (uses && uses.current < 1)) {
      btn.disabled = true;
    }
    btn.onclick = onClick;
    return btn;
  }
}
