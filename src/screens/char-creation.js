import { CHAR_CREATION, CSS, PLAYER_DEFAULTS, EL } from "../core/config.js";
import { gameState } from "../core/state.js";

// CharCreationScreen manages the pre-game character creation overlay.
// It lets the player enter a name and distribute a small point budget across
// the stats defined in CHAR_CREATION.stats (see config.js).
//
// When the player confirms, the chosen bonuses are applied to the game state
// and the overlay is hidden so the main game can start.
//
// To add more allocatable stats, backgrounds, feats, etc. in the future:
//   - Extend CHAR_CREATION.stats in config.js
//   - No changes to this file are needed — the UI renders dynamically.
export class CharCreationScreen {
  // onComplete: called when the player confirms character creation.
  // The "Load Save" button triggers the shared #file-upload input; its change
  // event is handled by UIManager which reveals the game and applies the save.
  constructor(onComplete) {
    this.onComplete = onComplete;
    this.overlay = document.getElementById(EL.CHAR_CREATION);
    // Track how many points have been spent on each stat
    this.spent = Object.fromEntries(CHAR_CREATION.stats.map(s => [s.id, 0]));
    this._render();
  }

  get pointsRemaining() {
    const used = Object.values(this.spent).reduce((a, b) => a + b, 0);
    return CHAR_CREATION.pointBudget - used;
  }

  _render() {
    this.overlay.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = `${CSS.CC_PANEL} ${CSS.GLASS_PANEL}`;

    // Title
    const title = document.createElement('h1');
    title.className = CSS.CC_TITLE;
    title.textContent = 'Create Your Character';
    panel.appendChild(title);

    // Name input
    const nameSection = document.createElement('div');
    nameSection.className = CSS.CC_SECTION;
    const nameLabel = document.createElement('label');
    nameLabel.className = CSS.CC_LABEL;
    nameLabel.textContent = 'Character Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = CSS.CC_NAME_INPUT;
    nameInput.placeholder = 'Enter your name…';
    nameInput.maxLength = 32;
    nameInput.autocomplete = 'off';
    nameInput.addEventListener('input', () => this._updateConfirmBtn());
    nameSection.appendChild(nameLabel);
    nameSection.appendChild(nameInput);
    panel.appendChild(nameSection);
    this.nameInput = nameInput;

    // Stat allocation
    const statsSection = document.createElement('div');
    statsSection.className = CSS.CC_SECTION;
    const statsTitle = document.createElement('div');
    statsTitle.className = CSS.CC_LABEL;
    statsTitle.textContent = `Stat Points`;
    statsSection.appendChild(statsTitle);

    this.pointsEl = document.createElement('span');
    this.pointsEl.className = CSS.CC_POINTS;
    this._updatePointsDisplay();
    statsTitle.appendChild(this.pointsEl);

    CHAR_CREATION.stats.forEach(stat => {
      const row = document.createElement('div');
      row.className = CSS.CC_STAT_ROW;

      const info = document.createElement('div');
      info.className = CSS.CC_STAT_INFO;
      const statLabel = document.createElement('span');
      statLabel.className = CSS.CC_STAT_LABEL;
      statLabel.textContent = stat.label;
      const statDesc = document.createElement('span');
      statDesc.className = CSS.CC_STAT_DESC;
      statDesc.textContent = stat.description;
      info.appendChild(statLabel);
      info.appendChild(statDesc);

      const controls = document.createElement('div');
      controls.className = CSS.CC_STAT_CONTROLS;

      const decrementBtn = document.createElement('button');
      decrementBtn.className = `${CSS.BTN} ${CSS.CC_STAT_BTN}`;
      decrementBtn.textContent = '−';
      decrementBtn.onclick = () => {
        if (this.spent[stat.id] > stat.min) {
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
      statsSection.appendChild(row);

      // Store refs for external updates
      stat._decrementBtn = decrementBtn;
      stat._incrementBtn = incrementBtn;
      stat._valueEl = valueEl;

      this._updateStatRow(stat, valueEl, decrementBtn, incrementBtn);
    });

    panel.appendChild(statsSection);

    // Actions row
    const actions = document.createElement('div');
    actions.className = CSS.CC_ACTIONS;

    // Confirm button
    this.confirmBtn = document.createElement('button');
    this.confirmBtn.className = `${CSS.BTN} ${CSS.OPTION_BTN} ${CSS.CC_CONFIRM_BTN}`;
    this.confirmBtn.textContent = 'Begin Adventure';
    this.confirmBtn.disabled = true;
    this.confirmBtn.onclick = () => this._confirm();
    actions.appendChild(this.confirmBtn);

    // Load save button — lets returning players skip char creation
    const loadBtn = document.createElement('button');
    loadBtn.className = `${CSS.BTN} ${CSS.BTN_GLASS} ${CSS.CC_LOAD_BTN}`;
    loadBtn.textContent = 'Load Save';
    loadBtn.onclick = () => document.getElementById(EL.FILE_UPLOAD).click();
    actions.appendChild(loadBtn);

    panel.appendChild(actions);
    this.overlay.appendChild(panel);
  }

  _setStatValueText(el, stat) {
    const base = PLAYER_DEFAULTS[stat.id];
    const bonus = this.spent[stat.id] * stat.bonusPerPoint;
    el.textContent = bonus > 0 ? `${base} + ${bonus}` : `${base}`;
  }

  _updateStatRow(stat, valueEl, decrementBtn, incrementBtn) {
    this._setStatValueText(valueEl, stat);
    decrementBtn.disabled = this.spent[stat.id] <= stat.min;
    incrementBtn.disabled = this.pointsRemaining <= 0;
  }

  _updatePointsDisplay() {
    const remaining = this.pointsRemaining;
    this.pointsEl.textContent = ` — ${remaining} point${remaining !== 1 ? 's' : ''} remaining`;
  }

  _updateConfirmBtn() {
    this.confirmBtn.disabled = !this.nameInput.value.trim();
    // Also refresh all increment buttons since points may have changed
    CHAR_CREATION.stats.forEach(stat => {
      if (stat._incrementBtn) stat._incrementBtn.disabled = this.pointsRemaining <= 0;
    });
  }

  _confirm() {
    const name = this.nameInput.value.trim();
    if (!name) return;

    const player = gameState.getPlayer();
    player.name = name;

    // Apply stat bonuses — update both current value and the max
    CHAR_CREATION.stats.forEach(stat => {
      const bonus = this.spent[stat.id] * stat.bonusPerPoint;
      if (bonus > 0) {
        player[stat.id] += bonus;
        // For HP: also set current hp to the new max so the player starts at full health
        if (stat.id === 'maxHp') player.hp = player.maxHp;
      }
    });

    this.overlay.hidden = true;
    this.onComplete();
  }
}
