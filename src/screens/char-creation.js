import { CSS, EL } from '../core/config.js';
import { createElement, getByPath } from '../core/utils.js';

// The pre-game overlay: a name, and a point budget spread over
// rules.charCreation.stats.
export class CharCreationScreen {
  // The Load Save button clicks the shared file input, which UIManager handles.
  constructor(onComplete, t, names = [], rules = {}, state = null) {
    this.onComplete = onComplete;
    this.t = t;
    this.names = names;
    this.rules = rules;
    this.state = state;
    this.overlay = document.getElementById(EL.CHAR_CREATION);

    const stats = rules.charCreation?.stats ?? [];
    this.spent = Object.fromEntries(stats.map(s => [s.id, 0]));
    // Kept here so the rules objects stay free of DOM references.
    this._incrementBtns = new Map();
    this._render();
  }

  get pointsRemaining() {
    const used = Object.values(this.spent).reduce((a, b) => a + b, 0);
    return (this.rules.charCreation?.pointBudget ?? 0) - used;
  }

  _render() {
    this.overlay.replaceChildren();

    const panel = createElement('div', [CSS.CC_PANEL, CSS.PANEL]);
    panel.append(
      createElement('h1', CSS.CC_TITLE, this.t('charCreation.title')),
      this._buildNameSection(),
      this._buildStatsSection(),
      this._buildActionsRow(),
    );

    this.overlay.appendChild(panel);
  }

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

  _buildStatRow(stat) {
    const info = createElement('div', CSS.CC_STAT_INFO);
    info.append(
      // localeKey, because stat.id is a dotted path.
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

  _buildActionsRow() {
    const actions = createElement('div', CSS.CC_ACTIONS);

    this.confirmBtn = createElement('button', [CSS.BTN, CSS.CC_CONFIRM_BTN], this.t('charCreation.confirmBtn'));
    this.confirmBtn.onclick = () => this._confirm();
    this._updateConfirmBtn();

    const loadBtn = createElement('button', [CSS.BTN, CSS.CC_LOAD_BTN], this.t('charCreation.loadSaveBtn'));
    loadBtn.onclick = () => document.getElementById(EL.FILE_UPLOAD).click();

    actions.append(this.confirmBtn, loadBtn);
    return actions;
  }

  _updateStatRow(stat, valueEl, decrementBtn, incrementBtn) {
    // stat.id is a dotted path (e.g. 'resources.hp.max') into playerDefaults.
    const base = getByPath(this.rules.playerDefaults, stat.id) ?? 0;
    const bonus = this.spent[stat.id] * stat.bonusPerPoint;
    valueEl.textContent = bonus > 0 ? `${base} + ${bonus}` : `${base}`;
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
    for (const btn of this._incrementBtns.values()) {
      btn.disabled = this.pointsRemaining <= 0;
    }
  }

  _confirm() {
    const name = this.nameInput.value.trim();
    if (!name) return;

    // One mutation; StateManager owns the point-buy semantics.
    const stats = this.rules.charCreation?.stats ?? [];
    this.state.applyCharCreation(name, stats.map(stat => ({
      id: stat.id,
      bonus: this.spent[stat.id] * stat.bonusPerPoint,
    })));

    this.overlay.hidden = true;
    this.onComplete();
  }
}
