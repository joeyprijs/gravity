import { gameState } from "../core/state.js";
import { clearElement } from "../core/utils.js";
import { XP_PER_LEVEL, EL, CSS, LOG } from "../core/config.js";
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
    // Tab switching
    document.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(b => b.classList.remove(CSS.TABS_BTN_ACTIVE));
        document.querySelectorAll(`.${CSS.TABS_CONTENT}`).forEach(c => c.classList.remove(CSS.TABS_CONTENT_ACTIVE));
        e.target.classList.add(CSS.TABS_BTN_ACTIVE);
        document.getElementById(e.target.dataset.tab).classList.add(CSS.TABS_CONTENT_ACTIVE);
      });
    });

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

    this.map.setup();
    this.engine.narrative.setupScrollObserver();
  }

  update() {
    const player = gameState.getPlayer();

    // Stats
    const t = this.engine.t.bind(this.engine);
    document.getElementById(EL.STAT_NAME).innerText = player.name || '';
    document.getElementById(EL.STAT_LEVEL).innerText = t('stats.level', { value: player.level });
    document.getElementById(EL.STAT_HP).innerText = t('stats.hp', { current: player.hp, max: player.maxHp });
    document.getElementById(EL.STAT_AP).innerText = t('stats.ap', { current: player.ap, max: player.maxAp });
    document.getElementById(EL.STAT_AC).innerText = t('stats.ac', { value: player.ac });
    document.getElementById(EL.STAT_INITIATIVE).innerText = t('stats.initiative', { value: player.initiative });
    document.getElementById(EL.STAT_GOLD).innerText = t('stats.gold', { value: player.gold });

    // XP bar
    const xpPerc = (player.xp / (player.level * XP_PER_LEVEL)) * 100;
    document.getElementById(EL.XP_BAR).style.width = `${xpPerc}%`;

    this.inventoryUI.renderInventory(player);
    this.inventoryUI.renderEquipment(player);
    this.questUI.render();
    this.map.renderMinimap();

    this.bindItemActions();
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
    this.engine.scene.reset();
    this.engine.recalculateAC();
    this.engine.log(LOG.SYSTEM, this.engine.t('system.loaded'), 'system', false);
    const lastDesc = this.engine.narrative.restore(gameState.getLog());
    this.engine.restoreScene(gameState.getCurrentSceneId(), lastDesc);
  }

  renderMuseumChestUI() {
    this.museum.render();
  }
}
