import { attrRowHtml, clearElement, createElement, createSectionToggles, escapeHtml, getByPath } from "../core/utils.js";
import { EL, CSS, LOG } from "../core/config.js";
import { getDay, getSegment } from "../systems/time.js";
import { skillLabel } from "../systems/skill-checks.js";
import { MapManager } from "../world/map.js";
import { ChestUI } from "./chest-ui.js";
import { QuestUI } from "./quest-ui.js";
import { InventoryUI } from "./inventory-ui.js";

// Group key for the sheet's in-memory section collapse state — a per-session
// UI preference reset on reload, not saved (see createSectionToggles).
const SHEET_SECTION_GROUP = 'sheet';

// A data-stat-bind span for an innerHTML template — the stats update loop
// (see update()) fills every bound span on each stats change. Shared by the
// sheet's character section and the scene top bar.
const bindSpan = (path) => `<span data-stat-bind="${path}"></span>`;

export class UIManager {
  constructor(engine) {
    this.engine = engine;
    this.map = new MapManager(engine);
    this.questUI = new QuestUI(engine);
    this.inventoryUI = new InventoryUI(engine);

    // Ids of entries added since the player last acknowledged the tab, so the
    // list can dot which item/quest is new (see _setupTabNotifier). Cleared
    // when the player leaves the tab.
    this._newItems = new Set();
    this._newQuests = new Set();

    // The built-in tab widgets. Registered on the engine so plugins share the
    // same mechanism for contributing whole sidebar tabs (rules.tabs[].widget).
    engine.registerTabWidget('map', (panel, ui) => ui._buildMapWidget(panel));
    engine.registerTabWidget('options', (panel, ui) => ui._buildOptionsWidget(panel));
    engine.registerTabWidget('attributes', (panel, ui) => ui._buildSheetWidget(panel));
  }

  setup() {
    this._buildTabs();
    this._buildTopBar();
    this._setupTabNotifier();
    this.map.setup();

    // One delegated listener covers every inventory item button, present and
    // future — no per-render rebinding. Buttons call engine game-logic
    // methods; the UI layer owns no game logic here.
    document.getElementById(EL.PLAYER_PANEL).addEventListener('click', (e) => {
      const btn = e.target.closest(`.${CSS.BTN_ITEM}`);
      if (!btn || btn.disabled) return;
      const { action, item: itemId, slot } = btn.dataset;
      if (action === 'consume') this.engine.useItem(itemId);
      else if (action === 'equip') this.engine.equipItem(slot, itemId);
      else if (action === 'unequip') this.engine.unequipItem(slot);
    });

    // Save/load/restart buttons live in the options tab (the 'options'
    // widget, built by _buildTabs above) — absent in games without one.
    document.getElementById(EL.BTN_SAVE)?.addEventListener('click', () => {
      if (this.engine.inCombat) {
        this.engine.log(LOG.SYSTEM, this.engine.t('player.noCombatSave'));
        return;
      }
      this._downloadSave(this.engine.state.getSaveString());
      this.engine.log(LOG.SYSTEM, this.engine.t('system.saved'));
    });

    // Load
    const fileInput = document.getElementById(EL.FILE_UPLOAD);
    document.getElementById(EL.BTN_LOAD)?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          let raw = ev.target.result;
          // Decode the base64+UTF-8 encoding written by this.engine.state.getSaveString().
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
    document.getElementById(EL.BTN_RESTART)?.addEventListener('click', () => {
      this.engine.state.reset();
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

    // The sheet lives in the 'attributes' widget tab — remember its id so the
    // notifier can dot it when a level-up point becomes spendable.
    this._sheetTabId = rules.tabs.find(t => t.widget === 'attributes')?.id ?? null;

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

      // A tab with a widget is filled by its registered builder (built-in or
      // plugin — see engine.registerTabWidget). Widget-less tabs (inventory,
      // quests) are rendered into by their own UI classes via the panel id.
      if (tab.widget) {
        const build = this.engine.getTabWidget(tab.widget);
        if (build) build(panel, this);
        else console.warn(`[Gravity] tabs: no widget registered for "${tab.widget}"`);
      }

      playerPanel.appendChild(panel);
    });

    // Tab switching
    nav.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        const opened = e.target.dataset.tab;
        const departing = nav.querySelector(`.${CSS.TABS_BTN_ACTIVE}`)?.dataset.tab;
        // Leaving a tab acknowledges it — clears its tab dot and per-entry dots
        // (covers a dot that appeared while the tab was already on screen).
        if (departing && departing !== opened) this._acknowledgeTabEntries(departing);

        nav.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(b => b.classList.remove(CSS.TABS_BTN_ACTIVE));
        document.querySelectorAll(`#${EL.PLAYER_PANEL} .${CSS.TABS_PANEL}`).forEach(c => { c.hidden = true; });
        e.target.classList.add(CSS.TABS_BTN_ACTIVE);
        // Viewing a tab clears its "something new" tab dot (per-entry dots stay
        // until the player leaves).
        e.target.classList.remove(CSS.TABS_BTN_NOTIFY);
        document.getElementById(opened).hidden = false;

        // Re-render the opened list so its per-entry dots match the current
        // new-set (leaving a tab clears its set while the panel is hidden,
        // without a re-render — see _acknowledgeTabEntries).
        const player = this.engine.state.getPlayer();
        if (opened === EL.TAB_INVENTORY) this.inventoryUI.renderInventory(player, this._newItems);
        else if (opened === EL.TAB_QUESTS) this.questUI.render(this._newQuests);
        if (opened === 'map-tab') {
          this.map.invalidateMinimap();
          this.map.renderMinimap();
        }
      });
    });
  }

  // Dots a tab — and its new entries — when something worth noticing is
  // *added* to its panel: a found/gifted item, a started/advanced quest, a
  // bankable level-up point. The dot shows even on the tab you're viewing, so
  // a gain into a collapsed section still surfaces. Driven by the mutation bus
  // (gains only, never removals/uses). Stats that also live in the scene top
  // bar (HP/AC/AP/gold/luck) are deliberately not signalled here — they're
  // already in view. State is in-memory: opening or leaving the tab clears its
  // dot, and a reload/load starts clean.
  _setupTabNotifier() {
    let prevStatPoints = this.engine.state.getPlayer()?.statPoints ?? 0;
    const dot = (tabId) => {
      if (!tabId) return;
      document.querySelector(`.${CSS.TABS_BTN}[data-tab="${tabId}"]`)?.classList.add(CSS.TABS_BTN_NOTIFY);
    };

    this.engine.state.onMutation((method, info) => {
      const player = this.engine.state.getPlayer();
      // A fresh state (new game, save load, restart) starts with no dots and
      // resyncs the level-up baseline — a load shouldn't light up every tab.
      if (method === 'init' || method === 'loadFromObject' || method === 'reset') {
        document.querySelectorAll(`.${CSS.TABS_BTN}.${CSS.TABS_BTN_NOTIFY}`)
          .forEach(b => b.classList.remove(CSS.TABS_BTN_NOTIFY));
        this._newItems.clear();
        this._newQuests.clear();
        prevStatPoints = player?.statPoints ?? 0;
        return;
      }

      // Mutations emit before their notifyListeners call (see onMutation), so
      // the sets grown here are already in place for the render this same
      // mutation triggers — no catch-up re-render needed.
      if (method === 'addToInventory' && !info.silent) { this._newItems.add(info.itemId); dot(EL.TAB_INVENTORY); }
      if (method === 'setMissionStatus') { this._newQuests.add(info.missionId); dot(EL.TAB_QUESTS); }

      // A level-up bank is the one sheet change worth flagging (the spend
      // button is easy to miss); ordinary stat changes are top-bar-visible.
      const sp = player?.statPoints ?? 0;
      if (sp > prevStatPoints) dot(this._sheetTabId);
      prevStatPoints = sp;
    });
  }

  // Acknowledges a tab the player is leaving: they've had it open, so its
  // notification is spent. Clears the tab-button dot (which may have appeared
  // while the tab was already on screen — the clear-on-open path can't catch
  // that) and its per-entry "new" set. The panel is being hidden, so no
  // re-render is needed; the next open renders it clean.
  _acknowledgeTabEntries(tabId) {
    document.querySelector(`.${CSS.TABS_BTN}[data-tab="${tabId}"]`)?.classList.remove(CSS.TABS_BTN_NOTIFY);
    if (tabId === EL.TAB_INVENTORY) this._newItems.clear();
    else if (tabId === EL.TAB_QUESTS) this._newQuests.clear();
  }

  // Map widget: the minimap structure MapManager.setup() wires up.
  _buildMapWidget(panel) {
    panel.innerHTML = `<div class="${CSS.PANEL_SECTION}"><div class="minimap" id="minimap" title="Click to open full map" hidden><div class="minimap__canvas" id="minimap-canvas"></div></div></div>`;
  }

  // Options widget: the save/load/restart buttons. The click handlers bind in
  // setup() right after the tabs are built.
  _buildOptionsWidget(panel) {
    panel.innerHTML = `<div class="${CSS.PANEL_SECTION}">
      <div class="options-actions">
        <button class="${CSS.BTN}" id="${EL.BTN_SAVE}">${escapeHtml(this.engine.t('ui.btnSave'))}</button>
        <button class="${CSS.BTN}" id="${EL.BTN_LOAD}">${escapeHtml(this.engine.t('ui.btnLoad'))}</button>
        <button class="${CSS.BTN}" id="${EL.BTN_RESTART}">${escapeHtml(this.engine.t('ui.btnRestart'))}</button>
      </div>
    </div>`;
  }

  // Attributes widget: the character sheet. A character section (same stats
  // as the scene top bar, plus name/level/initiative) above the
  // custom-attribute list, both as label/value rows. With
  // rules.levelUp.statPoints configured, each attribute row grows a spend
  // button and a banked-points line, shown only while points are banked
  // (see _updateStatPointControls).
  _buildSheetWidget(panel) {
    const rules = this.engine.data.rules;
    const canSpend = (rules.levelUp?.statPoints ?? 0) > 0;
    // Level-up point-buy covers the same stats as character creation —
    // charCreation.stats entries that aren't skills (HP, AC) grow a spend
    // button on their character row, resolved by this.engine.state.spendStatPoint.
    const creationIds = new Set((rules.charCreation?.stats ?? []).map(s => s.id));
    const spendBtnHtml = (target) => canSpend && creationIds.has(target)
      ? `<button class="${CSS.BTN} attr-list__spend" data-spend-attr="${escapeHtml(target)}" title="${escapeHtml(this.engine.t('ui.spendStatPoint'))}" hidden>+</button>`
      : '';
    // The data-stat-bind spans ride the existing stats update loop.
    // Row order groups by meaning: identity, combat, spendable pools,
    // then wealth/standing (plugin sheetRows land in the last group).
    const characterRows = [
      attrRowHtml(this.engine.t('ui.statName'), bindSpan('name')),
      attrRowHtml(this.engine.t('ui.statLevel'), bindSpan('level')),
      attrRowHtml(this.engine.t('ui.sheetHp'), `${bindSpan('resources.hp.current')}/${bindSpan('resources.hp.max')}`, '', spendBtnHtml('resources.hp.max')),
      attrRowHtml(this.engine.t('ui.sheetAc'), bindSpan('attributes.ac'), '', spendBtnHtml('attributes.ac')),
      attrRowHtml(this.engine.t('ui.statInitiative'), bindSpan('attributes.initiative'), '', spendBtnHtml('attributes.initiative')),
      attrRowHtml(this.engine.t('ui.sheetAp'), `${bindSpan('resources.ap.current')}/${bindSpan('resources.ap.max')}`),
      ...this._headerResourceEntries().map(({ label, valueHtml }) => attrRowHtml(label, valueHtml)),
      attrRowHtml(this.engine.t('ui.statGold'), bindSpan('resources.gold')),
      ...this.engine.sheetRows.map(row => attrRowHtml(row.label, bindSpan(row.bind))),
    ].join('');
    const items = (rules.customAttributes ?? []).map(attr =>
      `<div class="attr-list__row">
        <span class="attr-list__label">${escapeHtml(skillLabel(this.engine, attr.id))}</span>
        <span class="attr-list__value" data-stat-bind="attributes.${escapeHtml(attr.id)}"></span>${canSpend ? `
        <button class="${CSS.BTN} attr-list__spend" data-spend-attr="${escapeHtml(attr.id)}" title="${escapeHtml(this.engine.t('ui.spendStatPoint'))}" hidden>+</button>` : ''}
      </div>`
    ).join('');
    const sectionHeading = (key, labelText) =>
      `<button class="${CSS.SECTION_HEADING} ${CSS.SECTION_TOGGLE}" data-section="${key}">
        <span class="${CSS.SECTION_TOGGLE_LABEL}">${escapeHtml(labelText)}</span>
      </button>`;
    // One panel-section wrapper per section, like the inventory panel —
    // the adjacent-sibling margin is what spaces the sections apart. The
    // banked-points line tops the whole sheet (both sections hold
    // spendable rows) and sits outside the collapsible bodies so a player
    // with points to spend always sees the cue.
    panel.innerHTML = `${canSpend ? `
    <div class="attr-list__points" hidden>${escapeHtml(this.engine.t('ui.statPoints'))} <span data-stat-bind="statPoints"></span></div>` : ''}
    <div class="${CSS.PANEL_SECTION}">
      ${sectionHeading('character', this.engine.t('ui.sheetCharacterTitle'))}
      <div class="attr-list" data-section-body="character">${characterRows}</div>
    </div>
    <div class="${CSS.PANEL_SECTION}">
      ${sectionHeading('skills', this.engine.t('ui.attributesTitle'))}
      <div data-section-body="skills">
      <div class="attr-list">${items}</div>
      </div>
    </div>`;
    this._bindSheetToggles(panel);
    if (canSpend) {
      panel.addEventListener('click', (e) => {
        const attrId = e.target?.dataset?.spendAttr;
        if (!attrId || this.engine.isGameOver) return; // dead characters don't grow
        // Mid-combat the stats update skips panel rebuilds, so refresh the
        // combat controls here — the attack buttons show hit modifiers.
        if (this.engine.state.spendStatPoint(attrId) && this.engine.inCombat) {
          this.engine.combatSystem.renderer.render();
        }
      });
    }
  }

  // Wires the sheet's section headings as collapse toggles — the same
  // shared machinery as the inventory sections (see createSectionToggles).
  _bindSheetToggles(panel) {
    const toggles = [...panel.querySelectorAll(`.${CSS.SECTION_TOGGLE}`)];
    // Sections start expanded (no default-collapsed set); the player can
    // collapse any of them, remembered for the session.
    const sections = createSectionToggles(SHEET_SECTION_GROUP);
    toggles.forEach(btn => {
      const key = btn.dataset.section;
      sections.wire(btn, panel.querySelector(`[data-section-body="${key}"]`), key);
    });
  }

  // Builds the bar pinned to the top of the scene panel: combat-relevant
  // stats on the left (HP/AC/AP plus any rules.headerResources, e.g. luck
  // points), the world clock on the right (only with rules.time.ticksPerDay).
  // It sits above the narrative, which is the panel's scroll container — so
  // the bar stays put while the story scrolls. The data-stat-bind spans ride
  // the stats update loop; the time text is filled by _updateTimeBar.
  _buildTopBar() {
    const scenePanel = document.getElementById(EL.SCENE_PANEL);
    if (!scenePanel) return;
    const bar = createElement('div', 'scene__topbar');

    const stats = createElement('div', 'scene__topbar-stats');
    const stat = (label, valueHtml) => {
      const item = createElement('span', 'scene__topbar-stat');
      item.innerHTML = `${escapeHtml(label)}: <span class="scene__topbar-stat-value">${valueHtml}</span>`;
      return item;
    };
    // Same grouping as the sheet's character section: combat, pools, wealth.
    stats.append(
      stat(this.engine.t('ui.statHp'), `${bindSpan('resources.hp.current')}/${bindSpan('resources.hp.max')}`),
      stat(this.engine.t('ui.statAc'), bindSpan('attributes.ac')),
      stat(this.engine.t('ui.statAp'), `${bindSpan('resources.ap.current')}/${bindSpan('resources.ap.max')}`),
      ...this._headerResourceEntries().map(({ label, valueHtml }) => stat(label, valueHtml)),
      stat(this.engine.t('ui.statGold'), bindSpan('resources.gold')),
    );
    bar.appendChild(stats);

    if (this.engine.data.rules?.time?.ticksPerDay) {
      this._timeBarEl = createElement('div', 'scene__topbar-time');
      bar.appendChild(this._timeBarEl);
    }

    scenePanel.prepend(bar);
    this._updateTimeBar();
  }

  // The rules.headerResources entries that render as a label plus a bound
  // current/max value — shared by the sheet's character section and the
  // scene top bar so the two surfaces can't drift apart.
  // @returns {Array<{label: string, valueHtml: string}>}
  _headerResourceEntries() {
    const player = this.engine.state.getPlayer();
    return (this.engine.data.rules?.headerResources || [])
      .filter(id => { const r = player.resources?.[id]; return r && typeof r === 'object' && 'current' in r; })
      .map(id => ({
        label: this.engine.t(`ui.resources.${id}`),
        valueHtml: `${bindSpan(`resources.${id}.current`)}/${bindSpan(`resources.${id}.max`)}`,
      }));
  }

  // Renders "Day 1: Morning" as one plain string — or just "Day 1" for
  // games whose time config has no named segments. The element is cached by
  // _buildTopBar; this runs on every stats notification.
  _updateTimeBar() {
    if (!this._timeBarEl) return;
    const timeRules = this.engine.data.rules.time;
    const ticks = this.engine.state.getTicks();
    const dayText = this.engine.t('ui.timeChipDay', { day: getDay(ticks, timeRules) });
    const segment = getSegment(ticks, timeRules);
    this._timeBarEl.textContent = segment ? `${dayText}: ${this.engine.t(`time.segments.${segment}`)}` : dayText;
  }

  // Shows the banked stat-point controls while the player has points to
  // spend; a spend button disables at its attribute's cap
  // (customAttributes[].max). No-op for games without rules.levelUp.
  _updateStatPointControls(player) {
    const pointsRow = document.querySelector('.attr-list__points');
    if (!pointsRow) return;
    const points = player.statPoints ?? 0;
    pointsRow.hidden = points <= 0;
    const caps = new Map((this.engine.data.rules?.customAttributes ?? []).map(a => [a.id, a.max]));
    document.querySelectorAll('[data-spend-attr]').forEach(btn => {
      const max = caps.get(btn.dataset.spendAttr);
      btn.hidden = points <= 0;
      // The cap compares base values (worn gear excluded), like spendStatPoint.
      btn.disabled = max !== undefined && this.engine.state.playerBaseAttribute(btn.dataset.spendAttr) >= max;
    });
  }

  update(hint) {
    const player = this.engine.state.getPlayer();

    if (!hint || hint === 'stats' || hint === 'time') {
      this._updateTimeBar();
    }

    if (!hint || hint === 'stats') {
      document.querySelectorAll('[data-stat-bind]').forEach(el => {
        el.textContent = getByPath(player, el.dataset.statBind) ?? '';
      });
      this._updateStatPointControls(player);
    }

    // Item cards show live attribute modifiers (itemStatLines), so stat
    // changes re-render the inventory too — except mid-combat, where stats
    // tick on every AP/HP change and the full panel rebuild would churn for
    // no reason (the combat attack buttons re-render themselves).
    if (!hint || hint === 'inventory' || (hint === 'stats' && !this.engine.inCombat)) {
      this.inventoryUI.renderInventory(player, this._newItems);
    }

    if (!hint || hint === 'quests') {
      this.questUI.render(this._newQuests);
    }

    if (!hint || hint === 'map') {
      this.map.renderMinimap();
    }
  }

  // Offers an encoded save string (from this.engine.state.getSaveString()) as a
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
    if (!this.engine.state.loadFromObject(data)) {
      this.engine.log(LOG.SYSTEM, this.engine.t('system.loadFailed'));
      return false;
    }

    // The loaded save replaces all state, so any combat (or game-over screen)
    // in progress is over. Without this reset, a gameover mode keeps blocking
    // item use after "Load Last Save", and a mid-combat load leaves combat
    // mode stuck, which blocks all scene rendering.
    this.engine.setMode('scene');

    // Ensure the game UI is visible (handles the case where this is called
    // from the char creation screen before the main game has been shown).
    const charCreation = document.getElementById(EL.CHAR_CREATION);
    if (charCreation) charCreation.hidden = true;
    document.getElementById('game-container').hidden = false;

    clearElement(EL.SCENE_NARRATIVE);
    this.engine.currentSceneEl = null;
    this.engine.resetScene();
    const lastDesc = this.engine.narrative.restore(this.engine.state.getLog());
    // Logged after the restored history so it reads as the newest entry.
    this.engine.log(LOG.SYSTEM, this.engine.t('system.loaded'), 'system', false);
    this.engine.restoreScene(this.engine.state.getCurrentSceneId(), lastDesc);
    return true;
  }

  renderChestUI(chestId) {
    new ChestUI(this.engine, chestId).render();
  }
}
