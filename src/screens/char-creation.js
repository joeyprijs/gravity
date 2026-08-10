import { CSS, EL } from '../core/config.js';
import { createElement, getByPath } from '../core/utils.js';

// CharCreationScreen manages the pre-game character creation overlay.
// It lets the player enter a name and distribute a small point budget across
// the stats defined in rules.charCreation.stats (see data/rules.json).
//
// When the player confirms, the chosen bonuses are applied to the game state
// and the overlay is hidden so the main game can start.
//
// To add more allocatable stats, change rules.json charCreation.stats —
// no changes to this file are needed.
export class CharCreationScreen {
  // onComplete: called when the player confirms character creation.
  // The "Load Save" button triggers the shared #file-upload input; its change
  // event is handled by UIManager which reveals the game and applies the save.
  constructor(onComplete, t, names = [], rules = {}, state = null) {
    this.onComplete = onComplete;
    this.t = t;
    this.names = names;
    this.rules = rules;
    this.state = state;
    this.overlay = document.getElementById(EL.CHAR_CREATION);

    const stats = rules.charCreation?.stats ?? [];
    // Track how many points have been spent on each stat
    this.spent = Object.fromEntries(stats.map(s => [s.id, 0]));
    // Increment buttons per stat ID — kept here so the rules config objects
    // stay free of DOM references.
    this._incrementBtns = new Map();
    this._render();
  }

  get pointsRemaining() {
    const used = Object.values(this.spent).reduce((a, b) => a + b, 0);
    return (this.rules.charCreation?.pointBudget ?? 0) - used;
  }

  _render() {
    this.overlay.innerHTML = '';

    const panel = createElement('div', [CSS.CC_PANEL, CSS.PANEL]);
    panel.append(
      createElement('h1', CSS.CC_TITLE, this.t('charCreation.title')),
      this._buildNameSection(),
      this._buildStatsSection(),
      this._buildActionsRow(),
    );

    this.overlay.appendChild(panel);
  }

  // Name input with a random suggestion from the names table.
  _buildNameSection() {
    const section = createElement('div', CSS.CC_SECTION);
    const label = createElement('label', CSS.CC_LABEL, this.t('charCreation.nameLabel'));

    const input = createElement('input', CSS.CC_NAME_INPUT);
    Object.assign(input, {
      type: 'text',
      placeholder: this.t('charCreation.namePlaceholder'),
      maxLength: 32,
      autocomplete: 'off',
    });
    input.addEventListener('input', () => this._updateConfirmBtn());
    if (this.names.length) input.value = this.names[Math.floor(Math.random() * this.names.length)];

    section.append(label, input);
    this.nameInput = input;
    return section;
  }

  // Point-allocation section: the remaining-points counter plus one row per
  // stat declared in rules.charCreation.stats.
  _buildStatsSection() {
    const section = createElement('div', CSS.CC_SECTION);
    const title = createElement('div', CSS.CC_LABEL, this.t('charCreation.statPoints'));

    this.pointsEl = createElement('span', CSS.CC_POINTS);
    this._updatePointsDisplay();
    title.appendChild(this.pointsEl);

    const grid = createElement('div', CSS.CC_STAT_GRID);
    const stats = this.rules.charCreation?.stats ?? [];
    stats.forEach(stat => grid.appendChild(this._buildStatRow(stat)));

    section.append(title, grid);
    return section;
  }

  // One stat row: label + description on the left, −/value/+ controls on the right.
  _buildStatRow(stat) {
    const info = createElement('div', CSS.CC_STAT_INFO);
    info.append(
      // Use localeKey for locale lookup (avoids dot-path traversal issues)
      createElement('span', CSS.CC_STAT_LABEL, this.t(`charCreation.stats.${stat.localeKey}.label`)),
      createElement('span', CSS.CC_STAT_DESC, this.t(`charCreation.stats.${stat.localeKey}.description`)),
    );

    const valueEl = createElement('span', CSS.CC_STAT_VALUE);
    const decrementBtn = createElement('button', [CSS.BTN, CSS.CC_STAT_BTN], '−');
    const incrementBtn = createElement('button', [CSS.BTN, CSS.CC_STAT_BTN], '+');

    const spend = (delta) => {
      this.spent[stat.id] += delta;
      this._updateStatRow(stat, valueEl, decrementBtn, incrementBtn);
      this._updatePointsDisplay();
      this._updateConfirmBtn();
    };
    decrementBtn.onclick = () => { if (this.spent[stat.id] > 0) spend(-1); };
    incrementBtn.onclick = () => { if (this.pointsRemaining > 0) spend(1); };

    const controls = createElement('div', CSS.CC_STAT_CONTROLS);
    controls.append(decrementBtn, valueEl, incrementBtn);

    const row = createElement('div', CSS.CC_STAT_ROW);
    row.append(info, controls);

    this._incrementBtns.set(stat.id, incrementBtn);
    this._updateStatRow(stat, valueEl, decrementBtn, incrementBtn);
    return row;
  }

  // Confirm + Load Save buttons.
  _buildActionsRow() {
    const actions = createElement('div', CSS.CC_ACTIONS);

    this.confirmBtn = createElement('button', [CSS.BTN, CSS.CC_CONFIRM_BTN], this.t('charCreation.confirmBtn'));
    this.confirmBtn.onclick = () => this._confirm();
    this._updateConfirmBtn();

    // Load save button — lets returning players skip char creation
    const loadBtn = createElement('button', [CSS.BTN, CSS.CC_LOAD_BTN], this.t('charCreation.loadSaveBtn'));
    loadBtn.onclick = () => document.getElementById(EL.FILE_UPLOAD).click();

    actions.append(this.confirmBtn, loadBtn);
    return actions;
  }

  _setStatValueText(el, stat) {
    // stat.id is a dotted path (e.g. 'resources.hp.max') — use getByPath to resolve
    const base = getByPath(this.rules.playerDefaults, stat.id) ?? 0;
    const bonus = this.spent[stat.id] * stat.bonusPerPoint;
    el.textContent = bonus > 0 ? `${base} + ${bonus}` : `${base}`;
  }

  _updateStatRow(stat, valueEl, decrementBtn, incrementBtn) {
    this._setStatValueText(valueEl, stat);
    decrementBtn.disabled = this.spent[stat.id] <= 0;
    incrementBtn.disabled = this.pointsRemaining <= 0;
  }

  _updatePointsDisplay() {
    const remaining = this.pointsRemaining;
    this.pointsEl.textContent = remaining === 1
      ? this.t('charCreation.pointsRemainingOne')
      : this.t('charCreation.pointsRemainingMany', { remaining });
  }

  _updateConfirmBtn() {
    this.confirmBtn.disabled = !this.nameInput.value.trim();
    // Also refresh all increment buttons since points may have changed
    for (const btn of this._incrementBtns.values()) {
      btn.disabled = this.pointsRemaining <= 0;
    }
  }

  _confirm() {
    const name = this.nameInput.value.trim();
    if (!name) return;

    // One sanctioned mutation — StateManager owns the point-buy semantics
    // (raising a resource cap raises the resource itself; see applyCharCreation).
    const stats = this.rules.charCreation?.stats ?? [];
    this.state.applyCharCreation(name, stats.map(stat => ({
      id: stat.id,
      bonus: this.spent[stat.id] * stat.bonusPerPoint,
    })));

    this.overlay.hidden = true;
    this.onComplete();
  }
}
