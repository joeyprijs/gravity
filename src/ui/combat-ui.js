import { buildPanelSection, buildSceneDescription, buildOptionButton, resetOptionsPanel, itemStatLines, handSlots } from '../core/utils.js';
import { EL, CSS } from '../core/config.js';

// The window of up to cap enemies a capped attack catches around its target,
// as centred on it as the line's ends allow. Pure, for node:test.
export function splashTargets(living, primary, cap) {
  if (cap >= living.length) return living;
  const idx = living.indexOf(primary);
  const start = Math.max(0, Math.min(idx - Math.floor((cap - 1) / 2), living.length - cap));
  return living.slice(start, start + cap);
}

// The combat controls and the game-over screen. No state of its own: every
// render reads the CombatSystem live.
export class CombatRenderer {
  constructor(combatSystem) {
    this.cs = combatSystem;
  }

  // The Weapons and Spells in hand, or the unarmed fallback, plus the spells
  // worn gear grants.
  getAvailableAttacks() {
    const { equipment } = this.cs.engine.state.getPlayer();
    const items = this.cs.engine.data.items;

    const held = handSlots(this.cs.engine.data.rules)
      .map(slot => items[equipment[slot]])
      .filter(item => item?.type === 'Weapon' || item?.type === 'Spell');
    const attacks = held.length
      ? held
      : [items[this.cs.engine.data.rules?.fallbackWeapons?.player]].filter(Boolean);

    // A spell already in hand is not offered twice: one pool, one control.
    const granted = Object.values(equipment)
      .flatMap(itemId => items[itemId]?.attributes?.grantsSpells ?? [])
      .map(spellId => items[spellId])
      .filter(item => item?.type === 'Spell');

    return [...new Set([...attacks, ...granted])];
  }

  renderGameOver() {
    this.cs.engine.openScene();
    const desc = buildSceneDescription(
      this.cs.engine.t('combat.gameOverTitle'),
      this.cs.engine.t('combat.gameOverBody'),
      this.cs.engine.t
    );
    desc.querySelector('h2').classList.add(CSS.SCENE_TITLE_GAME_OVER);
    this.cs.engine.currentSceneEl.appendChild(desc);

    const { container } = resetOptionsPanel();

    // Delegates to the options-tab buttons; no dead button when they are absent.
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

    // Dead characters do not drink potions.
    document.querySelectorAll(`.${CSS.BTN_ITEM}`).forEach(btn => { btn.disabled = true; });
  }

  render() {
    const livingEnemies = this.cs.enemies.filter(e => e.attributes.healthPoints > 0);

    const { panel, container, skillsContainer } = resetOptionsPanel(this.cs.engine.t('ui.locationCombat'));

    const attacks = this.getAvailableAttacks();
    const fieldWide = attacks.filter(att => att.attributes?.targets === 'all');
    const perEnemy = attacks.filter(att => att.attributes?.targets !== 'all');

    // First, so the most-reached-for control never moves.
    const endBtn = buildOptionButton(this.cs.engine.t('combat.endTurn'));
    endBtn.onclick = () => this.cs.enemyTurn('after');
    container.appendChild(endBtn);

    // An all-enemies attack takes no target, so it renders once.
    if (fieldWide.length) {
      const section = buildPanelSection(this.cs.engine.t('combat.allEnemiesHeading'));
      fieldWide.forEach(att => {
        section.appendChild(this._attackButton(att, () => this.cs.playerAttackMulti(att)));
      });
      panel.insertBefore(section, skillsContainer);
    }

    // A capped attack centres its blast on the enemy clicked.
    livingEnemies.forEach(target => {
      const section = buildPanelSection(
        this.cs.engine.t('combat.enemyStats', { name: target.name, hp: target.attributes.healthPoints, ac: target.attributes.armorClass }));

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

  // Disabled when AP cannot cover it or the item's uses are spent.
  _attackButton(att, onClick) {
    const uses = this.cs.engine.state.getItemUses(att.id);
    const btn = buildOptionButton(
      this.cs.engine.t('combat.attackTarget', { name: att.name }),
      itemStatLines(this.cs.engine.t, att, this.cs.engine.state.getPlayer().attributes, uses,
        this.cs.engine.data.items));
    if (this.cs.remainingTurnBudget() < (att.attributes?.actionPoints ?? 0)
        || (uses && uses.current < 1)) {
      btn.disabled = true;
    }
    btn.onclick = onClick;
    return btn;
  }
}
