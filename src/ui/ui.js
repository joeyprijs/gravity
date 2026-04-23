import { gameState } from "../core/state.js";
import { clearElement, getByPath } from "../core/utils.js";
import { EL, CSS, LOG } from "../core/config.js";
import { MapManager } from "../world/map.js";
import { MuseumUI } from "../world/museum.js";
import { QuestUI } from "./quest-ui.js";
import { InventoryUI } from "./inventory-ui.js";

export class UIManager {
  constructor(engine) {
    this.engine = engine;
    this.map = new MapManager(engine);
    this.museum = new MuseumUI(engine);
    this.questUI = new QuestUI(engine);
    this.inventoryUI = new InventoryUI(engine);
  }

  setup() {
    this._buildTabs();
    this.map.setup();

    // Save
    document.getElementById(EL.BTN_SAVE).addEventListener('click', () => {
      if (this.engine.inCombat) {
        this.engine.log(LOG.SYSTEM, this.engine.t('player.noCombatSave'));
        return;
      }
      if (gameState.downloadSave()) this.engine.log(LOG.SYSTEM, this.engine.t('system.saved'));
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
          // Decode the base64+UTF-8 encoding written by state.js downloadSave().
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

  update(hint) {
    const player = gameState.getPlayer();

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

  // Applies a parsed save object and restores the game to its saved state.
  // Called both from the in-game Load button and from the char creation screen.
  _applyLoadedSave(data) {
    // Ensure the game UI is visible (handles the case where this is called
    // from the char creation screen before the main game has been shown).
    const charCreation = document.getElementById(EL.CHAR_CREATION);
    if (charCreation) charCreation.hidden = true;
    document.getElementById('game-container').hidden = false;

    gameState.loadFromObject(data);
    this.engine.isGameStart = true;
    clearElement(EL.SCENE_NARRATIVE);
    this.engine.currentSceneEl = null;
    this.engine.resetScene();
    this.engine.log(LOG.SYSTEM, this.engine.t('system.loaded'), 'system', false);
    const lastDesc = this.engine.narrative.restore(gameState.getLog());
    this.engine.restoreScene(gameState.getCurrentSceneId(), lastDesc);
  }

  renderMuseumChestUI() {
    this.museum.render();
  }
}
