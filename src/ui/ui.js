import { gameState } from "../core/state.js";
import { clearElement, createElement, getByPath } from "../core/utils.js";
import { EL, CSS, LOG } from "../core/config.js";
import { getDay, getSegment } from "../systems/time.js";
import { MapManager } from "../world/map.js";
import { ChestUI } from "./chest-ui.js";
import { QuestUI } from "./quest-ui.js";
import { InventoryUI } from "./inventory-ui.js";

export class UIManager {
  constructor(engine) {
    this.engine = engine;
    this.map = new MapManager(engine);
    this.questUI = new QuestUI(engine);
    this.inventoryUI = new InventoryUI(engine);
  }

  setup() {
    this._buildTabs();
    this._buildTimeChip();
    this._buildLuckChip();
    this.map.setup();

    // Save
    document.getElementById(EL.BTN_SAVE).addEventListener('click', () => {
      if (this.engine.inCombat) {
        this.engine.log(LOG.SYSTEM, this.engine.t('player.noCombatSave'));
        return;
      }
      this._downloadSave(gameState.getSaveString());
      this.engine.log(LOG.SYSTEM, this.engine.t('system.saved'));
    });

    // Load
    const fileInput = document.getElementById(EL.FILE_UPLOAD);
    document.getElementById(EL.BTN_LOAD).addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          let raw = ev.target.result;
          // Decode the base64+UTF-8 encoding written by gameState.getSaveString().
          // TextDecoder is the modern replacement for the deprecated escape() approach.
          try {
            const binary = atob(raw);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            raw = new TextDecoder().decode(bytes);
          } catch (_) {}
          const data = JSON.parse(raw);
          this._applyLoadedSave(data);
        } catch (err) {
          console.error(err);
          this.engine.log(LOG.SYSTEM, this.engine.t('system.loadFailed'));
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Restart
    document.getElementById(EL.BTN_RESTART).addEventListener('click', () => {
      gameState.reset();
      window.location.reload();
    });
  }

  // Reads rules.tabs and generates tab nav buttons + panel divs inside #player-panel.
  // Buttons are appended to the existing <nav class="tabs__nav">.
  // Panel divs are appended directly to #player-panel.
  // Map tab panels get their minimap inner structure injected automatically.
  _buildTabs() {
    const rules = this.engine.data.rules;
    if (!rules?.tabs) return;

    const nav = document.querySelector('.tabs__nav');
    const playerPanel = document.getElementById(EL.PLAYER_PANEL);

    // Remove any pre-existing tab panels so the HTML can be left empty
    playerPanel.querySelectorAll(`.${CSS.TABS_PANEL}`).forEach(p => p.remove());

    rules.tabs.forEach(tab => {
      // Nav button
      const btn = document.createElement('button');
      const classes = [CSS.BTN, CSS.TABS_BTN];
      if (tab.default) classes.push(CSS.TABS_BTN_ACTIVE);
      btn.className = classes.join(' ');
      btn.dataset.tab = tab.id;
      btn.textContent = this.engine.t(tab.localeKey);
      nav.appendChild(btn);

      // Panel div
      const panel = document.createElement('div');
      panel.className = CSS.TABS_PANEL;
      panel.id = tab.id;
      if (!tab.default) panel.hidden = true;

      // Map widget: inject minimap structure so MapManager.setup() can find it
      if (tab.widget === 'map') {
        panel.innerHTML = `<div class="scene__options"><div class="minimap" id="minimap" title="Click to open full map" hidden><div class="minimap__canvas" id="minimap-canvas"></div></div></div>`;
      }

      // Attributes widget: render custom attributes as stat cards
      if (tab.widget === 'attributes') {
        const items = (rules.customAttributes ?? []).map(attr =>
          `<div class="stat-item">
            <span class="stat-item__label">${attr.id.toUpperCase()}</span>
            <span class="stat-item__value" data-stat-bind="attributes.${attr.id}"></span>
          </div>`
        ).join('');
        panel.innerHTML = `<div class="scene__options"><div class="stat-group">${items}</div></div>`;
      }

      playerPanel.appendChild(panel);
    });

    // Tab switching
    nav.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        nav.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(b => b.classList.remove(CSS.TABS_BTN_ACTIVE));
        document.querySelectorAll(`#${EL.PLAYER_PANEL} .${CSS.TABS_PANEL}`).forEach(c => { c.hidden = true; });
        e.target.classList.add(CSS.TABS_BTN_ACTIVE);
        document.getElementById(e.target.dataset.tab).hidden = false;
        if (e.target.dataset.tab === 'map-tab') {
          this.map.invalidateMinimap();
          this.map.renderMinimap();
        }
      });
    });
  }

  // Injects the world-clock chip into the header stats bar. Only present when
  // the game opts into a readable clock via rules.time.ticksPerDay — a game
  // without time config keeps today's HUD untouched.
  _buildTimeChip() {
    if (!this.engine.data.rules?.time?.ticksPerDay) return;
    const statsBar = document.getElementById(EL.PLAYER_BASIC_STATS);
    if (!statsBar) return;
    const group = createElement('div', 'stat-group');
    const item = createElement('div', 'stat-item stat-item--time');
    this._timeChipValue = createElement('span', 'stat-item__value');
    item.appendChild(this._timeChipValue);
    group.appendChild(item);
    statsBar.appendChild(group);
    this._updateTimeChip();
  }

  _updateTimeChip() {
    if (!this._timeChipValue) return;
    const timeRules = this.engine.data.rules?.time;
    const ticks = gameState.getTicks();
    const day = getDay(ticks, timeRules);
    const segment = getSegment(ticks, timeRules);
    this._timeChipValue.textContent = segment
      ? this.engine.t('ui.timeChipSegment', { day, segment: this.engine.t(`time.segments.${segment}`) })
      : this.engine.t('ui.timeChipDay', { day });
  }

  // Injects the luck chip into the header stats bar when the game opts into
  // the luck resource (rules.playerDefaults.resources.luck). The data-stat-bind
  // spans ride the existing stats update loop — no bespoke refresh needed.
  _buildLuckChip() {
    if (!this.engine.data.rules?.playerDefaults?.resources?.luck) return;
    const statsBar = document.getElementById(EL.PLAYER_BASIC_STATS);
    if (!statsBar) return;
    const group = createElement('div', 'stat-group');
    const item = createElement('div', 'stat-item stat-item--luck');
    item.appendChild(createElement('span', 'stat-item__label', this.engine.t('ui.luckLabel')));
    const value = createElement('span', 'stat-item__value');
    const current = createElement('span');
    current.dataset.statBind = 'resources.luck.current';
    const max = createElement('span');
    max.dataset.statBind = 'resources.luck.max';
    value.append(current, '/', max);
    item.appendChild(value);
    group.appendChild(item);
    statsBar.appendChild(group);
  }

  update(hint) {
    const player = gameState.getPlayer();

    if (!hint || hint === 'stats' || hint === 'time') {
      this._updateTimeChip();
    }

    if (!hint || hint === 'stats') {
      document.querySelectorAll('[data-stat-bind]').forEach(el => {
        el.textContent = getByPath(player, el.dataset.statBind) ?? '';
      });
    }

    if (!hint || hint === 'inventory') {
      this.inventoryUI.renderInventory(player);
      this.bindItemActions();
    }

    if (!hint || hint === 'quests') {
      this.questUI.render();
    }

    if (!hint || hint === 'map') {
      this.map.renderMinimap();
    }
  }

  // Buttons call engine game-logic methods — UI layer owns no game logic here.
  bindItemActions() {
    document.querySelectorAll(`.${CSS.BTN_ITEM}`).forEach(btn => {
      // Use onclick so re-binding on every update() replaces previous handlers
      // instead of stacking duplicates.
      btn.onclick = (e) => {
        const { action, item: itemId, slot } = e.target.dataset;
        if (action === "consume") this.engine.useItem(itemId);
        else if (action === "equip") this.engine.equipItem(slot, itemId);
        else if (action === "unequip") this.engine.unequipItem(slot);
      };
    });
  }

  // Offers an encoded save string (from gameState.getSaveString()) as a
  // timestamped file download. Counterpart of the load path above.
  _downloadSave(encoded) {
    const blob = new Blob([encoded], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const h = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    const name = `Gravity_${y}${m}${d}_${h}${min}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Applies a parsed save object and restores the game to its saved state.
  // Called both from the in-game Load button and from the char creation screen.
  _applyLoadedSave(data) {
    // Reject a malformed save before touching the UI, so a bad file leaves the
    // current screen intact instead of showing a half-loaded game.
    if (!gameState.loadFromObject(data)) {
      this.engine.log(LOG.SYSTEM, this.engine.t('system.loadFailed'));
      return false;
    }

    // The loaded save replaces all state, so any combat (or game-over screen)
    // in progress is over. Without this reset, isGameOver keeps blocking item
    // use after "Load Last Save", and a mid-combat load leaves inCombat stuck
    // true, which blocks all scene rendering.
    this.engine.combatSystem.inCombat = false;
    this.engine.combatSystem.isGameOver = false;

    // Ensure the game UI is visible (handles the case where this is called
    // from the char creation screen before the main game has been shown).
    const charCreation = document.getElementById(EL.CHAR_CREATION);
    if (charCreation) charCreation.hidden = true;
    document.getElementById('game-container').hidden = false;

    this.engine.isGameStart = true;
    clearElement(EL.SCENE_NARRATIVE);
    this.engine.currentSceneEl = null;
    this.engine.resetScene();
    this.engine.log(LOG.SYSTEM, this.engine.t('system.loaded'), 'system', false);
    const lastDesc = this.engine.narrative.restore(gameState.getLog());
    this.engine.restoreScene(gameState.getCurrentSceneId(), lastDesc);
    return true;
  }

  renderChestUI(chestId) {
    new ChestUI(this.engine, chestId).render();
  }
}
