import { attrRowHtml, collapseAllSections, createElement, createSectionToggles, escapeHtml, getByPath, hideCursorTooltip, isResourcePool, showCursorTooltip } from '../core/utils.js';
import { EL, CSS, LOG } from '../core/config.js';
import { iconHtml } from '../core/icons.js';
import { decodeSave } from '../core/save.js';
import { getDay, getSegment } from '../systems/time.js';
import { skillLabel } from '../systems/skill-checks.js';
import { MapManager } from '../world/map.js';
import { ChestUI } from './chest-ui.js';
import { QuestUI } from './quest-ui.js';
import { InventoryUI } from './inventory-ui.js';

// The sheet's group key for createSectionToggles.
const SHEET_SECTION_GROUP = 'sheet';

// How long the pointer rests on a dotted card before the dot counts as seen;
// a sweep or a scroll past it does not.
const NEW_DOT_DWELL_MS = 250;

// A span update() fills on every stats change.
const bindSpan = (path) => `<span data-stat-bind="${path}"></span>`;

export class UIManager {
  constructor(engine) {
    this.engine = engine;
    this.map = new MapManager(engine);
    this.questUI = new QuestUI(engine);
    this.inventoryUI = new InventoryUI(engine);

    // Entries added since the player last saw the tab, for the "new" dots.
    this._newItems = new Set();
    this._newQuests = new Set();

    // Registered on the engine so plugins contribute tabs the same way.
    engine.registerTabWidget('map', (panel, ui) => ui._buildMapWidget(panel));
    engine.registerTabWidget('options', (panel, ui) => ui._buildOptionsWidget(panel));
    engine.registerTabWidget('attributes', (panel, ui) => ui._buildSheetWidget(panel));
  }

  setup() {
    this._buildTabs();
    this._buildTopBar();
    this._setupTabNotifier();
    this.map.setup();

    // Keyboard play: the arrow keys move focus through the panel's options and
    // Enter is the browser's own button activation, so every gate stays where
    // it is.
    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? '')) return;
      if (!document.getElementById(EL.FULLMAP_OVERLAY).hidden) return;
      const key = e.key.toLowerCase();

      if (key === 'arrowdown' || key === 'arrowup') {
        const options = [...document.querySelectorAll(
          `#${EL.SCENE_OPTIONS_PANEL} button.${CSS.CARD}:not(:disabled)`
        )];
        if (!options.length) return;
        e.preventDefault();   // the cursor moves; the page must not scroll
        const at = options.indexOf(document.activeElement);
        // Unfocused, down enters at the top and up at the bottom; both wrap.
        const next = key === 'arrowdown' ? at + 1 : (at < 0 ? -1 : at - 1);
        options[(next + options.length) % options.length].focus();
      }
    });

    // The peek: hovering or focusing an option lights its destination on the
    // minimap. Whichever input moved last owns the light and the other is the
    // fallback, so a hand parked on the panel cannot pin it while the cursor
    // steps past. The recompute waits a microtask: Chrome fires focusout for
    // a removed button mid-rebuild, when the old hovered neighbour is still in
    // the DOM. A click clears outright, because Safari gives buttons no focus.
    const optionsPanel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
    let hovered = null;
    let pointerLast = false;
    const repeek = () => queueMicrotask(() => {
      if (!hovered?.isConnected) hovered = null;
      const focused = optionsPanel.contains(document.activeElement) ? document.activeElement : null;
      const lead = pointerLast ? hovered : focused;
      this.map.setPeek((lead ?? hovered ?? focused)?.dataset.destination ?? null);
    });
    optionsPanel.addEventListener('mouseover', (e) => {
      hovered = e.target.closest('button');
      pointerLast = true;
      repeek();
    });
    optionsPanel.addEventListener('mouseout', (e) => {
      hovered = optionsPanel.contains(e.relatedTarget) ? e.relatedTarget.closest('button') : null;
      pointerLast = true;
      repeek();
    });
    ['focusin', 'focusout'].forEach(type => optionsPanel.addEventListener(type, () => {
      pointerLast = false;
      repeek();
    }));
    optionsPanel.addEventListener('click', () => this.map.setPeek(null), true);

    // One delegated listener for every item card, present and future. Which
    // slot a piece equips into is the engine's call, not the card's.
    const panel = document.getElementById(EL.PLAYER_PANEL);
    panel.addEventListener('click', (e) => {
      const card = e.target.closest(`.${CSS.BTN_ITEM}`);
      if (!card || card.disabled) return;
      const { action, item: itemId, slot } = card.dataset;
      if (action === 'consume') this.engine.useItem(itemId);
      else if (action === 'equip') this.engine.equipItem(itemId);
      else if (action === 'unequip') this.engine.unequipItem(slot);
    });

    // Resting the pointer on a dotted card spends its dot. The dwell keeps a
    // sweep, or cards scrolling under a parked cursor, from spending dots the
    // player never looked at. The new-set is updated too, or the next render
    // paints the dot back. mouseover/mouseout bubble, so one listener each.
    let dwell = null;   // { card, timer } — the card being looked at, if any
    panel.addEventListener('mouseover', (e) => {
      const card = e.target.closest(`.${CSS.CARD_NEW}`);
      if (!card) return;
      if (dwell?.card === card) return;   // moving within the same card — keep counting
      clearTimeout(dwell?.timer);
      dwell = {
        card,
        timer: setTimeout(() => {
          dwell = null;
          // A re-render mid-dwell detaches the card without a mouseout; the
          // replacement starts a fresh dwell.
          if (!card.isConnected) return;
          card.classList.remove(CSS.CARD_NEW);
          this._newItems.delete(card.dataset.item);
          this._newQuests.delete(card.dataset.mission);
        }, NEW_DOT_DWELL_MS),
      };
    });
    panel.addEventListener('mouseout', (e) => {
      if (!dwell) return;
      // Moving between a card's own children isn't leaving it.
      if (e.relatedTarget && dwell.card.contains(e.relatedTarget)) return;
      clearTimeout(dwell.timer);
      dwell = null;
    });

    // The options widget's buttons; absent in a game without that tab.
    document.getElementById(EL.BTN_SAVE)?.addEventListener('click', () => {
      if (this.engine.inCombat) {
        this.engine.log(LOG.SYSTEM, this.engine.t('player.noCombatSave'));
        return;
      }
      this._downloadSave(this.engine.state.getSaveString());
      this.engine.log(LOG.SYSTEM, this.engine.t('system.saved'));
    });

    const fileInput = document.getElementById(EL.FILE_UPLOAD);
    document.getElementById(EL.BTN_LOAD)?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          this._applyLoadedSave(decodeSave(ev.target.result));
        } catch (err) {
          console.error(err);
          this.engine.log(LOG.SYSTEM, this.engine.t('system.loadFailed'));
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById(EL.BTN_RESTART)?.addEventListener('click', () => {
      this.engine.state.reset();
      window.location.reload();
    });

    document.getElementById(EL.AUDIO_MUTE)?.addEventListener('change', (e) => {
      this.engine.audio.setMuted(e.target.checked);
    });
    document.getElementById(EL.AUDIO_AMBIENCE_VOL)?.addEventListener('input', (e) => {
      this.engine.audio.setVolume('ambience', e.target.value / 100);
    });
  }

  // Builds the tab buttons and panels from rules.tabs.
  _buildTabs() {
    const rules = this.engine.data.rules;
    if (!rules?.tabs) return;

    const nav = document.querySelector('.tabs__nav');
    const playerPanel = document.getElementById(EL.PLAYER_PANEL);

    playerPanel.querySelectorAll(`.${CSS.TABS_PANEL}`).forEach(p => p.remove());

    // The notifier dots the sheet tab; the tab switch redraws the map tab.
    const tabIdOf = (widget) => rules.tabs.find(t => t.widget === widget)?.id ?? null;
    this._sheetTabId = tabIdOf('attributes');
    const mapTabId = tabIdOf('map');

    rules.tabs.forEach(tab => {
      const btn = createElement('button', [CSS.BTN, CSS.TABS_BTN, tab.default && CSS.TABS_BTN_ACTIVE]);
      btn.dataset.tab = tab.id;
      // With an icon the label survives as screen-reader text, which the hover
      // tooltip reads back out.
      const label = this.engine.t(tab.localeKey);
      btn.innerHTML = tab.icon
        ? `${iconHtml(tab.icon)}<span class="visually-hidden">${escapeHtml(label)}</span>`
        : escapeHtml(label);
      nav.appendChild(btn);

      const panel = createElement('div', CSS.TABS_PANEL);
      panel.id = tab.id;
      if (!tab.default) panel.hidden = true;

      // Widget-less tabs (inventory, quests) are rendered by their own classes.
      if (tab.widget) {
        const build = this.engine.getTabWidget(tab.widget);
        if (build) build(panel, this);
        else console.warn(`[Gravity] tabs: no widget registered for "${tab.widget}"`);
      }

      playerPanel.appendChild(panel);
    });

    // Only icon-only buttons carry a screen-reader label to read back.
    nav.addEventListener('mousemove', (e) => {
      const label = e.target.closest(`.${CSS.TABS_BTN}`)
        ?.querySelector('.visually-hidden')?.textContent;
      if (label) showCursorTooltip(label, e);
      else hideCursorTooltip();
    });
    nav.addEventListener('mouseleave', () => hideCursorTooltip());

    nav.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        // currentTarget, not target: a click can land on the button's icon.
        const clicked = e.currentTarget;
        const opened = clicked.dataset.tab;
        const departing = nav.querySelector(`.${CSS.TABS_BTN_ACTIVE}`)?.dataset.tab;
        // Leaving a tab acknowledges it, dot and entries alike.
        if (departing && departing !== opened) this._acknowledgeTabEntries(departing);
        // A tab is entered as headings only; before the re-render below, so
        // the opened panel wires itself collapsed.
        if (departing !== opened) collapseAllSections();

        nav.querySelectorAll(`.${CSS.TABS_BTN}`).forEach(b => b.classList.remove(CSS.TABS_BTN_ACTIVE));
        document.querySelectorAll(`#${EL.PLAYER_PANEL} .${CSS.TABS_PANEL}`).forEach(c => { c.hidden = true; });
        clicked.classList.add(CSS.TABS_BTN_ACTIVE);
        // Per-entry dots stay until the player leaves.
        clicked.classList.remove(CSS.TABS_BTN_NOTIFY);
        document.getElementById(opened).hidden = false;

        // Leaving cleared the set without a re-render; the open re-renders.
        const player = this.engine.state.getPlayer();
        if (opened === EL.TAB_INVENTORY) this.inventoryUI.renderInventory(player, this._newItems);
        else if (opened === EL.TAB_QUESTS) this.questUI.render(this._newQuests);
        if (opened === mapTabId) {
          this.map.invalidateMinimap();
          this.map.renderMinimap();
        }
      });
    });
  }

  // Dots an inactive tab, and its new entries, when something is added to it:
  // an item, a quest step, a bankable stat point. Only what the player cannot
  // see; top-bar stats are already in view. In memory only.
  _setupTabNotifier() {
    let prevStatPoints = this.engine.state.getPlayer()?.statPoints ?? 0;
    const dot = (tabId) => {
      if (!tabId) return;
      const btn = document.querySelector(`.${CSS.TABS_BTN}[data-tab="${tabId}"]`);
      if (btn && !btn.classList.contains(CSS.TABS_BTN_ACTIVE)) btn.classList.add(CSS.TABS_BTN_NOTIFY);
    };

    this.engine.state.onMutation((method, info) => {
      const player = this.engine.state.getPlayer();
      // A fresh state starts clean; a load must not light up every tab.
      if (method === 'init' || method === 'loadFromObject' || method === 'reset') {
        document.querySelectorAll(`.${CSS.TABS_BTN}.${CSS.TABS_BTN_NOTIFY}`)
          .forEach(b => b.classList.remove(CSS.TABS_BTN_NOTIFY));
        this._newItems.clear();
        this._newQuests.clear();
        prevStatPoints = player?.statPoints ?? 0;
        return;
      }

      // Mutations emit before they notify, so the sets are in place for the
      // render this mutation triggers.
      if (method === 'addToInventory' && !info.silent) { this._newItems.add(info.itemId); dot(EL.TAB_INVENTORY); }
      if (method === 'setMissionStatus' || method === 'setMissionStage') { this._newQuests.add(info.missionId); dot(EL.TAB_QUESTS); }

      // The one sheet change worth a dot: the spend button is easy to miss.
      const sp = player?.statPoints ?? 0;
      if (sp > prevStatPoints) dot(this._sheetTabId);
      prevStatPoints = sp;
    });
  }

  // The tab was open, so its notification is spent; the next open renders clean.
  _acknowledgeTabEntries(tabId) {
    document.querySelector(`.${CSS.TABS_BTN}[data-tab="${tabId}"]`)?.classList.remove(CSS.TABS_BTN_NOTIFY);
    if (tabId === EL.TAB_INVENTORY) this._newItems.clear();
    else if (tabId === EL.TAB_QUESTS) this._newQuests.clear();
  }

  // The minimap structure MapManager.setup() wires up.
  _buildMapWidget(panel) {
    panel.innerHTML = `<div class="${CSS.PANEL_SECTION}"><div class="minimap" id="${EL.MINIMAP}" hidden><div class="${CSS.MINIMAP_CANVAS}" id="${EL.MINIMAP_CANVAS}"></div></div></div>`;
  }

  // The handlers bind in setup(), right after the tabs are built.
  _buildOptionsWidget(panel) {
    const audio = this.engine.audio.settings;
    panel.innerHTML = `<div class="${CSS.PANEL_SECTION}">
      <div class="options-actions">
        <button class="${CSS.BTN}" id="${EL.BTN_SAVE}">${escapeHtml(this.engine.t('ui.btnSave'))}</button>
        <button class="${CSS.BTN}" id="${EL.BTN_LOAD}">${escapeHtml(this.engine.t('ui.btnLoad'))}</button>
        <button class="${CSS.BTN}" id="${EL.BTN_RESTART}">${escapeHtml(this.engine.t('ui.btnRestart'))}</button>
      </div>
    </div>
    <div class="${CSS.PANEL_SECTION}">
      <div class="${CSS.SECTION_HEADING}">${escapeHtml(this.engine.t('ui.audioHeading'))}</div>
      <div class="settings-options">
        <label class="settings-options__row">
          <span>${escapeHtml(this.engine.t('ui.audioMute'))}</span>
          <input type="checkbox" id="${EL.AUDIO_MUTE}"${audio.muted ? ' checked' : ''}>
        </label>
        <label class="settings-options__row">
          <span>${escapeHtml(this.engine.t('ui.audioAmbience'))}</span>
          <input type="range" id="${EL.AUDIO_AMBIENCE_VOL}" min="0" max="100" value="${Math.round(audio.ambienceVolume * 100)}">
        </label>
      </div>
    </div>`;
  }

  // The character sheet: an identity line, then the character section (the
  // top bar's stats plus initiative), then the skills. With levelUp.statPoints
  // configured, rows grow a spend button shown while points are banked.
  _buildSheetWidget(panel) {
    const rules = this.engine.data.rules;
    const canSpend = (rules.levelUp?.statPoints ?? 0) > 0;
    // Level-up point-buy covers the same stats as character creation.
    const creationIds = new Set((rules.charCreation?.stats ?? []).map(s => s.id));
    // Every row ends in the same fixed-width slot, so values share one right
    // edge whether or not a button trails them. The slots hide with the buttons.
    const slot = (inner = '') => canSpend ? `<span class="attr-list__slot" hidden>${inner}</span>` : '';
    const spendBtnHtml = (target, spendable = creationIds.has(target)) => canSpend && spendable
      ? `<button class="${CSS.BTN} attr-list__spend" data-spend-attr="${escapeHtml(target)}" title="${escapeHtml(this.engine.t('ui.spendStatPoint'))}" hidden>+</button>`
      : '';
    // Grouped combat, pools, wealth, with the same icons as the top bar.
    const characterRows = [
      attrRowHtml({ icon: 'heart', label: this.engine.t('ui.sheetHp'), valueHtml: `${bindSpan('resources.hp.current')}/${bindSpan('resources.hp.max')}`, trailingHtml: slot(spendBtnHtml('resources.hp.max')) }),
      attrRowHtml({ icon: 'shield', label: this.engine.t('ui.sheetAc'), valueHtml: bindSpan('attributes.ac'), trailingHtml: slot(spendBtnHtml('attributes.ac')) }),
      attrRowHtml({ icon: 'bolt', label: this.engine.t('ui.statInitiative'), valueHtml: bindSpan('attributes.initiative'), trailingHtml: slot(spendBtnHtml('attributes.initiative')) }),
      attrRowHtml({ icon: 'sword', label: this.engine.t('ui.sheetAp'), valueHtml: `${bindSpan('resources.ap.current')}/${bindSpan('resources.ap.max')}`, trailingHtml: slot() }),
      ...this._headerResourceEntries().map(entry => attrRowHtml({ ...entry, trailingHtml: slot() })),
      attrRowHtml({ icon: 'coin', label: this.engine.t('ui.statGold'), valueHtml: bindSpan('resources.gold'), trailingHtml: slot() }),
      ...this.engine.sheetRows.map(row => attrRowHtml({ icon: row.icon, label: row.label, valueHtml: bindSpan(row.bind), trailingHtml: slot() })),
    ].join('');
    const items = (rules.customAttributes ?? []).map(attr => attrRowHtml({
      icon: attr.icon,
      label: skillLabel(this.engine, attr.id),
      valueHtml: bindSpan(`attributes.${escapeHtml(attr.id)}`),
      trailingHtml: slot(spendBtnHtml(attr.id, true)),
    })).join('');
    const sectionHeading = (key, labelText) =>
      `<button class="${CSS.SECTION_HEADING} ${CSS.SECTION_TOGGLE}" data-section="${key}">
        <span class="${CSS.SECTION_TOGGLE_LABEL}">${escapeHtml(labelText)}</span>
      </button>`;
    // The identity and banked-points lines sit outside the collapsible
    // bodies, so a player with points to spend always sees the cue.
    panel.innerHTML = `
    <div class="attr-list__identity">
      <span class="attr-list__identity-name" data-stat-bind="name"></span>
      <span class="attr-list__identity-level">${escapeHtml(this.engine.t('ui.statLevel'))} <span data-stat-bind="level"></span></span>
    </div>${canSpend ? `
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
        // Mid-combat the stats update skips rebuilds; the attack buttons show
        // hit modifiers, so refresh them here.
        if (this.engine.state.spendStatPoint(attrId) && this.engine.inCombat) {
          this.engine.combatSystem.renderer.render();
        }
      });
    }
  }

  _bindSheetToggles(panel) {
    const toggles = [...panel.querySelectorAll(`.${CSS.SECTION_TOGGLE}`)];
    const sections = createSectionToggles(SHEET_SECTION_GROUP);
    toggles.forEach(btn => {
      const key = btn.dataset.section;
      sections.wire(btn, panel.querySelector(`[data-section-body="${key}"]`), key);
    });
  }

  // The bar above the narrative: stats on the left, the clock on the right
  // (only with rules.time.ticksPerDay).
  _buildTopBar() {
    const scenePanel = document.getElementById(EL.SCENE_PANEL);
    if (!scenePanel) return;
    const bar = createElement('div', 'scene__topbar');

    const stats = createElement('div', 'scene__topbar-stats');
    // Too narrow for labels: the icon stands in, the label is screen-reader
    // text and the cursor tooltip the tab icons and minimap boxes use.
    const stat = (icon, label, valueHtml) => {
      const item = createElement('span', 'scene__topbar-stat');
      item.dataset.label = label;
      item.innerHTML = `${iconHtml(icon)}<span class="visually-hidden">${escapeHtml(label)}: </span>`
        + `<span class="scene__topbar-stat-value">${valueHtml}</span>`;
      return item;
    };
    stats.addEventListener('mousemove', (e) => {
      const label = e.target.closest('.scene__topbar-stat')?.dataset.label;
      if (label) showCursorTooltip(label, e);
      else hideCursorTooltip();
    });
    stats.addEventListener('mouseleave', () => hideCursorTooltip());
    stats.append(
      stat('heart', this.engine.t('ui.sheetHp'), `${bindSpan('resources.hp.current')}/${bindSpan('resources.hp.max')}`),
      stat('shield', this.engine.t('ui.sheetAc'), bindSpan('attributes.ac')),
      stat('sword', this.engine.t('ui.sheetAp'), `${bindSpan('resources.ap.current')}/${bindSpan('resources.ap.max')}`),
      ...this._headerResourceEntries().map(({ icon, label, valueHtml }) => stat(icon, label, valueHtml)),
      stat('coin', this.engine.t('ui.statGold'), bindSpan('resources.gold')),
    );
    bar.appendChild(stats);

    if (this.engine.data.rules?.time?.ticksPerDay) {
      this._timeBarEl = createElement('div', 'scene__topbar-time');
      bar.appendChild(this._timeBarEl);
    }

    scenePanel.prepend(bar);
    this._updateTimeBar();
  }

  // The rules.headerResources rows, shared by the sheet and the top bar.
  _headerResourceEntries() {
    const player = this.engine.state.getPlayer();
    return (this.engine.data.rules?.headerResources || [])
      .filter(({ id }) => isResourcePool(player.resources?.[id]))
      .map(({ id, icon }) => ({
        icon,
        label: this.engine.t(`ui.resources.${id}`),
        valueHtml: `${bindSpan(`resources.${id}.current`)}/${bindSpan(`resources.${id}.max`)}`,
      }));
  }

  // "Day 1: Morning", or "Day 1" without named segments.
  _updateTimeBar() {
    if (!this._timeBarEl) return;
    const timeRules = this.engine.data.rules.time;
    const ticks = this.engine.state.getTicks();
    const dayText = this.engine.t('ui.timeChipDay', { day: getDay(ticks, timeRules) });
    const segment = getSegment(ticks, timeRules);
    this._timeBarEl.textContent = segment ? `${dayText}: ${this.engine.t(`time.segments.${segment}`)}` : dayText;
  }

  // The spend controls show while points are banked; a button disables at
  // its attribute's cap.
  _updateStatPointControls(player) {
    const pointsRow = document.querySelector('.attr-list__points');
    if (!pointsRow) return;
    const points = player.statPoints ?? 0;
    pointsRow.hidden = points <= 0;
    document.querySelectorAll('.attr-list__slot').forEach(s => { s.hidden = points <= 0; });
    const caps = new Map((this.engine.data.rules?.customAttributes ?? []).map(a => [a.id, a.max]));
    document.querySelectorAll('[data-spend-attr]').forEach(btn => {
      const max = caps.get(btn.dataset.spendAttr);
      btn.hidden = points <= 0;
      // Base values, worn gear excluded, like spendStatPoint.
      btn.disabled = max !== undefined && this.engine.state.playerBaseAttribute(btn.dataset.spendAttr) >= max;
    });
  }

  update(hint) {
    const player = this.engine.state.getPlayer();

    if (!hint || hint === 'stats' || hint === 'time') this._updateTimeBar();

    if (!hint || hint === 'stats') {
      document.querySelectorAll('[data-stat-bind]').forEach(el => {
        el.textContent = getByPath(player, el.dataset.statBind) ?? '';
      });
      this._updateStatPointControls(player);
    }

    // Item cards show live modifiers, so stat changes re-render the inventory
    // too, except mid-combat where every AP tick would rebuild the panel.
    if (!hint || hint === 'inventory' || (hint === 'stats' && !this.engine.inCombat)) {
      this.inventoryUI.renderInventory(player, this._newItems);
    }

    if (!hint || hint === 'quests') this.questUI.render(this._newQuests);

    if (!hint || hint === 'map') this.map.renderMinimap();
  }

  // A timestamped file download.
  _downloadSave(encoded) {
    const url = URL.createObjectURL(new Blob([encoded], { type: 'application/json' }));

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `_${pad(now.getHours())}${pad(now.getMinutes())}`;

    const link = createElement('a');
    link.href = url;
    link.download = `Gravity_${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // From the Load button and from the character creation screen.
  _applyLoadedSave(data) {
    // A bad file leaves the current screen intact.
    if (!this.engine.state.loadFromObject(data)) {
      this.engine.log(LOG.SYSTEM, this.engine.t('system.loadFailed'));
      return false;
    }

    // Whatever was in progress (a fight, a Game Over) is over.
    this.engine.setMode('scene');

    // A load from the character screen has not shown the game yet.
    document.getElementById(EL.CHAR_CREATION).hidden = true;
    document.getElementById(EL.GAME_CONTAINER).hidden = false;

    document.getElementById(EL.SCENE_NARRATIVE).replaceChildren();
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
