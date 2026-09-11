import { gameState } from './state.js';
import { CombatSystem } from '../systems/combat.js';
import { DialogueSystem } from '../systems/dialogue.js';
import { QuestSystem } from '../systems/quests.js';
import { NarrativeLog } from '../systems/narrative.js';
import { UIManager } from '../ui/ui.js';
import { SceneRenderer } from '../systems/scene.js';
import { AudioSystem } from '../systems/audio.js';
import { DEFAULT_WORLD_MAP_SIZE, EL, LOG, TIMER_SAFE_ACTIONS } from './config.js';
import { resolveLanguage, translateOr } from './i18n.js';
import { getByPath } from './utils.js';
import { normalizeCarriedItems, validateGameData } from './validate.js';
import { registerBuiltinActions } from '../systems/actions.js';
import * as items from '../systems/items.js';
import { getDay, getSegment } from '../systems/time.js';
import { CharCreationScreen } from '../screens/char-creation.js';
import curatorPlugin from '../plugins/curator.js';

// Plugins bundled with the engine, so they load without dynamic import() (the
// file:// protocol). The manifest declares them like any other plugin; an id
// found here runs the bundled module instead. A Map, so a plugin named after
// an Object.prototype key cannot match.
const BUILT_IN_PLUGINS = new Map([['curator', curatorPlugin]]);

// Loaded before anything else; the fallback when the manifest has no locale
// for the resolved language.
const DEFAULT_LOCALE_PATH = 'data/locales.json';

// The orchestrator: owns the subsystems, loads the game data, and exposes the
// delegate API through which subsystems reach each other without importing
// each other.
export class RPGEngine {
  constructor() {
    // Bound once, so subsystems hand t to helpers as it is.
    this.t = this.t.bind(this);
    // Subsystems reach state as engine.state, never the module singleton.
    this.state = gameState;

    // An empty shell until loadData(), so subsystems need no null checks.
    this.data = {
      items: {}, npcs: {}, scenes: {}, missions: {}, tables: {}, regions: {},
      worldMapSize: DEFAULT_WORLD_MAP_SIZE, minimapRadius: null,
      locale: {}, rules: null, flags: {},
    };

    // Resolved in loadData() once the manifest's locales are known.
    this.language = 'en';

    // Which surface owns the options panel: 'scene' | 'combat' | 'dialogue' |
    // 'store' | 'customUI' | 'gameover'. Written only through setMode(), read
    // through the facades below.
    this.mode = 'scene';

    this._actionRegistry = new Map();
    this.sceneDecorators = [];
    this.sheetRows = [];
    this._validators = [];
    this._pluginConfigs = {};
    this._tabWidgets = new Map();
    this._events = new Map();
    // Reported by _validateData: a dead plugin's data gets no checks.
    this._failedPlugins = [];

    this.narrative = new NarrativeLog(this.t, this.state);
    this.combatSystem = new CombatSystem(this);
    this.dialogueSystem = new DialogueSystem(this);
    this.questSystem = new QuestSystem(this);
    this.ui = new UIManager(this);
    this.scene = new SceneRenderer(this);
    this.audio = new AudioSystem(this);

    this.init();
  }

  async init() {
    registerBuiltinActions(this);
    const manifest = await this.loadData();

    // Plugins load before state.init so they can register migrations.
    if (manifest?.plugins?.length) {
      await Promise.all(
        manifest.plugins.map(async pluginConfig => {
          const { src: url, id, locales } = pluginConfig;

          // Stashed before the module runs, so pluginConfig(id) works at load.
          if (id) this._pluginConfigs[id] = pluginConfig.config || {};

          // A plugin without the active language falls back to its English file.
          if (id && locales) {
            const localePath = locales[this.language] || locales.en;
            if (localePath) {
              try {
                const res = await fetch(localePath, { cache: 'no-cache' });
                const localeData = await res.json();
                if (!this.data.locale.plugin) this.data.locale.plugin = {};
                this.data.locale.plugin[id] = localeData;
              } catch (e) {
                console.warn(`[Gravity] Failed to load plugin locales for ${id} from ${localePath}`, e);
              }
            }
          }

          const builtin = BUILT_IN_PLUGINS.get(id);
          if (builtin) {
            try {
              builtin(this);
              return;
            } catch (e) {
              console.warn(`[Gravity] Static plugin fallback failed for ${url}`, e);
            }
          }

          // Trust boundary: a manifest plugin runs with full engine access.
          const absoluteUrl = new URL(url, document.baseURI).href;
          try {
            const m = await import(absoluteUrl);
            m.default?.(this);
          } catch (e) {
            console.warn(`[Gravity] Plugin failed: ${absoluteUrl}`, e);
            this._failedPlugins.push(url);
          }
        })
      );
    }

    this._validateData();

    this.state.init(this.data.rules, this.data.items);
    this.state.registerMissions(this.data.missions);
    this.state.registerSceneFlags(this.data.flags);

    this.ui.setup();
    // Every state change triggers a full UI update. Subsystems mutate state
    // and the reactive UI re-renders — no manual refresh calls needed.
    this.state.subscribe((_state, hint) => this.ui.update(hint));

    if (!this.state.getPlayer().name) {
      // New game — show character creation before revealing the main UI.
      new CharCreationScreen(() => this._startGame(), this.t, this.data.tables.names?.entries || [], this.data.rules, this.state);
    } else {
      this._startGame();
    }
  }

  _startGame() {
    document.getElementById(EL.GAME_CONTAINER).hidden = false;
    document.getElementById(EL.CHAR_CREATION).hidden = true;
    this.ui.update();
    this.renderScene(this.state.getCurrentSceneId());
  }

  // Returns the manifest, for init() to read its plugins.
  async loadData() {
    // The default locale first, so a data-load failure can still be translated.
    this.data.locale = await fetch(DEFAULT_LOCALE_PATH, { cache: 'no-cache' }).then(r => r.json()).catch(() => ({}));

    try {
      const manifestRes = await fetch('data/index.json', { cache: 'no-cache' });
      const manifest = await manifestRes.json();

      // The default locale is already loaded; re-fetch only a different file.
      this.language = resolveLanguage(
        Object.keys(manifest.locales || {}),
        navigator.languages || [navigator.language],
        manifest.defaultLanguage || 'en'
      );
      const localePath = manifest.locales?.[this.language];
      if (localePath && localePath !== DEFAULT_LOCALE_PATH) {
        this.data.locale = await fetch(localePath, { cache: 'no-cache' }).then(r => r.json()).catch(err => {
          console.warn(`[Gravity] Failed to load locale "${this.language}" from ${localePath} — using the default locale`, err);
          return this.data.locale;
        });
      }

      const fetchJson = (url, fallback) =>
        fetch(url, { cache: 'no-cache' }).then(r => r.json()).catch(err => {
          console.warn(`[Gravity] Failed to load "${url}": ${err.message}`);
          return fallback;
        });

      // A manifest category may take two shapes:
      // - an object map of id → file path (one fetch per entry — the demo),
      // - a bundle path (string): one JSON object holding id → definition.
      // Bundles keep a large game (thousands of scenes) to a handful of
      // requests at boot; scripts/generate-manifest.js maintains the map form.
      const loadCategory = async (category) => {
        if (!category) return {};
        if (typeof category === 'string') return fetchJson(category, {});
        const results = {};
        const keys = Object.keys(category);
        const loadedData = await Promise.all(keys.map(key => fetchJson(category[key], null)));
        keys.forEach((key, i) => { if (loadedData[i] !== null) results[key] = loadedData[i]; });
        return results;
      };

      const [items, npcs, scenes, missions, tables, flags, rules] = await Promise.all([
        loadCategory(manifest.items),
        loadCategory(manifest.npcs),
        loadCategory(manifest.scenes),
        loadCategory(manifest.missions),
        loadCategory(manifest.tables),
        // Flags differ from the categories above: each fetched file is itself
        // a flag map, and the maps merge into one namespace.
        manifest.flags
          ? (typeof manifest.flags === 'string'
            ? fetchJson(manifest.flags, {})
            : Promise.all(Object.values(manifest.flags).map(url => fetchJson(url, {})))
                .then(results => Object.assign({}, ...results))
          )
          : Promise.resolve({}),
        manifest.rules ? fetchJson(manifest.rules, null) : Promise.resolve(null)
      ]);

      // Normalize once at load so consumers (merchant store, validation) only
      // ever see carriedItems in its { item, amount } object form.
      normalizeCarriedItems(npcs);

      // Stamp each item definition with its manifest id, so consumers handed
      // a bare definition (the combat attack list) can key per-item state
      // (player.itemUses) without a reverse lookup.
      Object.entries(items).forEach(([id, item]) => { item.id = id; });

      this.data = {
        items, npcs, scenes, missions, tables,
        regions: manifest.regions || {},
        worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE,
        minimapRadius: manifest.minimapRadius ?? null,
        locale: this.data.locale, rules, flags,
      };

      return manifest;
    } catch (e) {
      console.error('Failed to load game data:', e);
      this.log(LOG.SYSTEM, this.t('system.dataError'));
      return null;
    }
  }

  // A locale string by dotted key with {param} substitution; the key itself
  // when missing, so a gap shows on screen instead of crashing.
  t(key, params = {}) {
    const str = getByPath(this.data.locale, key);
    if (typeof str !== 'string') return key;
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
  }

  // Prints the data issues to the console, grouped per entity. After plugin
  // loading, so plugin action types and validators are known.
  _validateData() {
    const issues = validateGameData(this.data, new Set(this._actionRegistry.keys()));
    const add = (group, message) => issues.push({ group, message });
    for (const validator of this._validators) {
      try { validator(this.data, { add }); }
      catch (e) { console.warn('[Gravity] a plugin validator threw', e); }
    }
    // A plugin that failed to import registered nothing, so this report is
    // blind to everything it owns.
    for (const url of this._failedPlugins) {
      add(`Plugin "${url}"`, 'failed to load — none of its actions, validators, or UI registered, and data it owns gets no checks; fix the manifest src or remove the entry');
    }
    if (!issues.length) return;

    const byGroup = new Map();
    for (const { group, message } of issues) {
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(message);
    }

    console.warn(`[Gravity] Data validation found ${issues.length} issue(s):`);
    for (const [group, messages] of byGroup) {
      console.groupCollapsed(`[Gravity] ${group} — ${messages.length} issue(s)`);
      messages.forEach(m => console.warn(m));
      console.groupEnd();
    }
  }

  // Item actions (delegates into systems/items.js)

  useItem(itemId)          { return items.useItem(this, itemId); }
  equipItem(itemId)        { return items.equipItem(this, itemId); }
  unequipItem(slot)        { return items.unequipItem(this, slot); }
  // Unlike useItem this needs no possession, so an exhibited book stays readable.
  readStory(itemId)        {
    const itemData = this.data.items[itemId];
    if (itemData?.story) items.readStory(this, itemData);
  }

  // Spends AP in combat, or returns false when the turn cannot afford it. The
  // turn handoff is an explicit call, not a notification. Free out of combat.
  _spendAP(cost) {
    if (!this.inCombat) return true;
    if (this.combatSystem.remainingTurnBudget() < cost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost }));
      return false;
    }
    this.state.modifyPlayerStat('ap', -cost);
    this.combatSystem.notePlayerSpentAP();
    return true;
  }

  // Mode machine

  setMode(mode) { this.mode = mode; }

  get inCombat()   { return this.mode === 'combat'; }
  get isGameOver() { return this.mode === 'gameover'; }
  get inDialogue() { return this.mode === 'dialogue' || this.mode === 'store'; }
  get inCustomUI() { return this.mode === 'customUI'; }

  // A custom panel (chest, curator) taking over or releasing the options panel.
  setCustomUIOpen(open) { this.setMode(open ? 'customUI' : 'scene'); }

  // A predicate for "did anything move the player since?": a scene change or
  // a mode transition. Callers snapshot before a pipeline and skip their
  // re-render when it fires, because a new surface owns the panel then.
  snapshotNavigation() {
    const sceneId = this.state.getCurrentSceneId();
    const mode = this.mode;
    return () => this.state.getCurrentSceneId() !== sceneId || this.mode !== mode;
  }

  // Delegate API

  get currentSceneEl() { return this.narrative.currentSceneEl; }
  set currentSceneEl(v) { this.narrative.currentSceneEl = v; }

  openScene(modifier) { return this.narrative.openScene(modifier); }
  log(type, message, variant, persist) {
    return this.narrative.log(translateOr(this.t, `log.${type}`, type), message, variant, persist);
  }
  // False when there is no choice line to amend; the caller logs its own line.
  amendLog(suffix) { return this.narrative.amendLast(suffix); }
  runActions(actions) {
    for (const action of (actions || [])) {
      const handler = this.getActionHandler(action.type);
      if (!handler) {
        console.warn(`[Gravity] runActions: no handler for action type "${action.type}"`);
        continue;
      }
      handler(action, this);
    }
  }

  // Advances the clock and runs the timers that came due. Timer pipelines
  // are limited to quiet actions (TIMER_SAFE_ACTIONS): flags and logs, never
  // navigation or combat, so no mid-flow reentrancy can arise.
  advanceTime(amount) {
    const ticksBefore = this.state.getTicks();
    const fired = this.state.advanceTime(amount);
    // Time passes before any timer fires, so "It is now night." leads.
    this._logTimePassage(ticksBefore);
    for (const timer of fired) {
      const safe = (timer.actions || []).filter(a => {
        if (TIMER_SAFE_ACTIONS.has(a.type)) return true;
        console.warn(`[Gravity] timer "${timer.id}": action type "${a.type}" is not allowed in timer pipelines — skipped`);
        return false;
      });
      this.runActions(safe);
    }
  }

  // A line when the clock crossed into a new day or segment; silent without
  // rules.time.
  _logTimePassage(ticksBefore) {
    const timeRules = this.data.rules?.time;
    const ticks = this.state.getTicks();
    if (ticks === ticksBefore) return;
    const day = getDay(ticks, timeRules);
    const segment = getSegment(ticks, timeRules);
    if (day === null) return;
    const segmentName = segment ? this.t(`time.segments.${segment}`) : null;
    if (day !== getDay(ticksBefore, timeRules)) {
      this.log(LOG.SYSTEM, segmentName
        ? this.t('time.dayBreaks', { day, segment: segmentName })
        : this.t('time.dayBreaksPlain', { day }));
    } else if (segment !== getSegment(ticksBefore, timeRules)) {
      this.log(LOG.SYSTEM, this.t('time.segmentChanges', { segment: segmentName }));
    }
  }

  renderScene(sceneId, opts) {
    // Combat owns the panel: a pipeline that navigates mid-fight is ignored.
    if (this.inCombat) return;
    this.dialogueSystem.close();
    this.setMode('scene');
    return this.scene.render(sceneId, opts);
  }
  restoreScene(sceneId, lastDesc) { return this.scene.restoreFromSave(sceneId, lastDesc); }
  resetScene()                   { return this.scene.reset(); }
  handleQuestTrigger(trigger) { return this.questSystem.handleTrigger(trigger); }
  scrollNarrativeToBottom() { return this.narrative.scrollToBottom(); }
  scrollNarrativeToEntry(entryEl) { return this.narrative.scrollToEntry(entryEl); }

  // Event system

  // Events: 'scene:entered' { sceneId, scene, isEntry, startsCombat }, on every
  // scene render except save restores.
  on(event, handler) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this._events.get(event);
    if (!handlers) return;
    handlers.forEach(h => h(data));
  }

  // handlerFn(action, engine) for a pipeline action type. A handler owns one
  // side effect; navigation is its own 'navigate' action.
  registerAction(name, handlerFn) {
    if (this._actionRegistry.has(name)) {
      console.warn(`[Gravity] registerAction: "${name}" already registered — overwriting`);
    }
    this._actionRegistry.set(name, handlerFn);
  }

  // fn(data, { add }) runs at boot after the core checks; add(group, message)
  // lands in the same report.
  registerValidator(fn) {
    this._validators.push(fn);
  }

  // The `config` of the plugin's manifest entry; {} when none was declared.
  pluginConfig(id) {
    return this._pluginConfigs[id] || {};
  }

  getActionHandler(name) {
    return this._actionRegistry.get(name);
  }

  // Runs on every rendered scene. decorator.description(scene, sceneId,
  // engine) returns HTML appended to the description; decorator.options(scene,
  // container, engine, { conversations, actions }) may append buttons.
  registerSceneDecorator(decorator) {
    this.sceneDecorators.push(decorator);
  }

  // fn(panel, ui) fills the panel of a rules.tabs[] entry naming this widget.
  // Register during plugin load; the UI builds after.
  registerTabWidget(name, fn) {
    this._tabWidgets.set(name, fn);
  }

  getTabWidget(name) {
    return this._tabWidgets.get(name);
  }

  // An extra row at the end of the sheet's character section, for a plugin's
  // stat. row is { label, bind, icon? }; bind is a path on the player.
  registerSheetRow(row) {
    this.sheetRows.push(row);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // A harness that constructs the engine itself (tests/smoke.html) sets
  // GRAVITY_MANUAL_BOOT first.
  if (!window.GRAVITY_MANUAL_BOOT && !window.gameEngine) window.gameEngine = new RPGEngine();
});
