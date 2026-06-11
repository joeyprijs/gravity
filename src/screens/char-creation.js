import { CSS, EL } from "../core/config.js";
import { gameState } from "../core/state.js";
import { getByPath, setByPath } from "../core/utils.js";

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
  constructor(onComplete, t, names = [], rules = {}) {
    this.onComplete = onComplete;
    this.t = t;
    this.names = names;
    this.rules = rules;
    this.overlay = document.getElementById(EL.CHAR_CREATION);
    const stats = rules.charCreation?.stats || [];
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

    const panel = document.createElement('div');
    panel.className = `${CSS.CC_PANEL} ${CSS.PANEL}`;

    const title = document.createElement('h1');
    title.className = CSS.CC_TITLE;
    title.textContent = this.t('charCreation.title');
    panel.appendChild(title);

    panel.appendChild(this._buildNameSection());
    panel.appendChild(this._buildStatsSection());
    panel.appendChild(this._buildActionsRow());

    this.overlay.appendChild(panel);
  }

  // Name input with a random suggestion from the names table.
  _buildNameSection() {
    const nameSection = document.createElement('div');
    nameSection.className = CSS.CC_SECTION;
    const nameLabel = document.createElement('label');
    nameLabel.className = CSS.CC_LABEL;
    nameLabel.textContent = this.t('charCreation.nameLabel');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = CSS.CC_NAME_INPUT;
    nameInput.placeholder = this.t('charCreation.namePlaceholder');
    nameInput.maxLength = 32;
    nameInput.autocomplete = 'off';
    nameInput.addEventListener('input', () => this._updateConfirmBtn());
    if (this.names.length) {
      nameInput.value = this.names[Math.floor(Math.random() * this.names.length)];
    }
    nameSection.appendChild(nameLabel);
    nameSection.appendChild(nameInput);
    this.nameInput = nameInput;
    return nameSection;
  }

  // Point-allocation section: the remaining-points counter plus one row per
  // stat declared in rules.charCreation.stats.
  _buildStatsSection() {
    const statsSection = document.createElement('div');
    statsSection.className = CSS.CC_SECTION;
    const statsTitle = document.createElement('div');
    statsTitle.className = CSS.CC_LABEL;
    statsTitle.textContent = this.t('charCreation.statPoints');
    statsSection.appendChild(statsTitle);

    this.pointsEl = document.createElement('span');
    this.pointsEl.className = CSS.CC_POINTS;
    this._updatePointsDisplay();
    statsTitle.appendChild(this.pointsEl);

    const stats = this.rules.charCreation?.stats || [];
    stats.forEach(stat => statsSection.appendChild(this._buildStatRow(stat)));
    return statsSection;
  }

  // One stat row: label + description on the left, −/value/+ controls on the right.
  _buildStatRow(stat) {
    const row = document.createElement('div');
    row.className = CSS.CC_STAT_ROW;

    const info = document.createElement('div');
    info.className = CSS.CC_STAT_INFO;
    const statLabel = document.createElement('span');
    statLabel.className = CSS.CC_STAT_LABEL;
    // Use localeKey for locale lookup (avoids dot-path traversal issues)
    statLabel.textContent = this.t(`charCreation.stats.${stat.localeKey}.label`);
    const statDesc = document.createElement('span');
    statDesc.className = CSS.CC_STAT_DESC;
    statDesc.textContent = this.t(`charCreation.stats.${stat.localeKey}.description`);
    info.appendChild(statLabel);
    info.appendChild(statDesc);

    const controls = document.createElement('div');
    controls.className = CSS.CC_STAT_CONTROLS;

    const decrementBtn = document.createElement('button');
    decrementBtn.className = `${CSS.BTN} ${CSS.CC_STAT_BTN}`;
    decrementBtn.textContent = '−';
    decrementBtn.onclick = () => {
      if (this.spent[stat.id] > (stat.min ?? 0)) {
        this.spent[stat.id]--;
        this._updateStatRow(stat, valueEl, decrementBtn, incrementBtn);
        this._updatePointsDisplay();
        this._updateConfirmBtn();
      }
    };

    const valueEl = document.createElement('span');
    valueEl.className = CSS.CC_STAT_VALUE;
    this._setStatValueText(valueEl, stat);

    const incrementBtn = document.createElement('button');
    incrementBtn.className = `${CSS.BTN} ${CSS.CC_STAT_BTN}`;
    incrementBtn.textContent = '+';
    incrementBtn.onclick = () => {
      if (this.pointsRemaining > 0) {
        this.spent[stat.id]++;
        this._updateStatRow(stat, valueEl, decrementBtn, incrementBtn);
        this._updatePointsDisplay();
        this._updateConfirmBtn();
      }
    };

    controls.appendChild(decrementBtn);
    controls.appendChild(valueEl);
    controls.appendChild(incrementBtn);
    row.appendChild(info);
    row.appendChild(controls);

    this._incrementBtns.set(stat.id, incrementBtn);

    this._updateStatRow(stat, valueEl, decrementBtn, incrementBtn);
    return row;
  }

  // Confirm + Load Save buttons.
  _buildActionsRow() {
    const actions = document.createElement('div');
    actions.className = CSS.CC_ACTIONS;

    this.confirmBtn = document.createElement('button');
    this.confirmBtn.className = `${CSS.BTN} ${CSS.CC_CONFIRM_BTN}`;
    this.confirmBtn.textContent = this.t('charCreation.confirmBtn');
    this.confirmBtn.onclick = () => this._confirm();
    this._updateConfirmBtn();
    actions.appendChild(this.confirmBtn);

    // Load save button — lets returning players skip char creation
    const loadBtn = document.createElement('button');
    loadBtn.className = `${CSS.BTN} ${CSS.CC_LOAD_BTN}`;
    loadBtn.textContent = this.t('charCreation.loadSaveBtn');
    loadBtn.onclick = () => document.getElementById(EL.FILE_UPLOAD).click();
    actions.appendChild(loadBtn);

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
    decrementBtn.disabled = this.spent[stat.id] <= (stat.min ?? 0);
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

    const player = gameState.getPlayer();
    player.name = name;

    // Apply stat bonuses using dotted paths (e.g. 'resources.hp.max')
    const stats = this.rules.charCreation?.stats || [];
    stats.forEach(stat => {
      const bonus = this.spent[stat.id] * stat.bonusPerPoint;
      if (bonus > 0) {
        const current = getByPath(player, stat.id) ?? 0;
        setByPath(player, stat.id, current + bonus);
        // For maxHp: also update current hp so the player starts at full health
        if (stat.id === 'resources.hp.max') {
          player.resources.hp.current = player.resources.hp.max;
        }
      }
    });

    this.overlay.hidden = true;
    this.onComplete();
  }
}
