import { gameState } from "./state.js";
import { CombatSystem } from "../systems/combat.js";
import { DialogueSystem } from "../systems/dialogue.js";
import { QuestSystem } from "../systems/quests.js";
import { NarrativeLog } from "../systems/narrative.js";
import { UIManager } from "../ui/ui.js";
import { SceneRenderer } from "../systems/scene.js";
import { DEFAULT_WORLD_MAP_SIZE, LOG, TIMER_SAFE_ACTIONS } from "./config.js";
import { resolveLanguage } from "./i18n.js";
import { normalizeCarriedItems, validateGameData } from "./validate.js";
import { registerBuiltinActions } from "../systems/actions.js";
import * as items from "../systems/items.js";
import { getDay, getSegment } from "../systems/time.js";
import { CharCreationScreen } from "../screens/char-creation.js";
import curatorPlugin from "../plugins/curator.js";

// The locale file loaded before anything else, and the fallback when the
// manifest declares no locale for the resolved language.
const DEFAULT_LOCALE_PATH = 'data/locales.json';

// RPGEngine is the central orchestrator. It owns all subsystems, loads game
// data from JSON, and exposes a thin delegate API so subsystems can call each
// other without importing each other directly (avoiding circular deps).
export class RPGEngine {
  constructor() {
    // The engine owns the state manager; subsystems reach it via
    // this.engine.state instead of importing the module singleton, so their
    // state dependency is visible and injectable.
    this.state = gameState;

    // Populated by loadData(). Kept as an empty shell here so subsystems
    // constructed below can safely reference this.engine.data without null checks.
    this.data = { items: {}, npcs: {}, scenes: {}, missions: {}, tables: {}, regions: {}, worldMapSize: DEFAULT_WORLD_MAP_SIZE, locale: {}, rules: null, flags: {} };

    // Active language code. Resolved properly in loadData() once the manifest's
    // declared locales are known; 'en' until then.
    this.language = 'en';

    // The engine's exclusive UI mode — which surface owns the options panel:
    // 'scene' | 'combat' | 'dialogue' | 'store' | 'customUI' | 'gameover'.
    // All transitions go through setMode(); subsystems read it through the
    // inCombat/inDialogue/inCustomUI/isGameOver facades below, so the mode
    // can never smear across per-subsystem booleans.
    this.mode = 'scene';

    this._actionRegistry = new Map();
    this._descriptionHooks = new Map();
    this._sceneDecorators = [];
    this._sheetRows = [];
    this._tabWidgets = new Map();
    this._events = new Map();

    this.narrative = new NarrativeLog(this.t.bind(this), this.state);
    this.combatSystem = new CombatSystem(this);
    this.dialogueSystem = new DialogueSystem(this);
    this.questSystem = new QuestSystem(this);
    this.ui = new UIManager(this);
    this.scene = new SceneRenderer(this);

    this.init();
  }

  async init() {
    registerBuiltinActions(this);
    const manifest = await this.loadData();

    // Load plugins before initialising state so they can register migrations.
    if (manifest?.plugins?.length) {
      await Promise.all(
        manifest.plugins.map(async pluginConfig => {
          const isObject = typeof pluginConfig === 'object';
          const url = isObject ? pluginConfig.src : pluginConfig;
          const id = isObject ? pluginConfig.id : null;
          const locales = isObject ? pluginConfig.locales : null;

          // Load locales first if declared in manifest. Plugins that don't
          // ship the active language fall back to their English file.
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

          // The curator ships with the engine and is statically imported so it
          // works without dynamic import() (e.g. on the file:// protocol).
          // Match it precisely — by id (object form) or an exact path tail —
          // rather than a loose substring that could match an unrelated URL.
          const isBuiltInCurator = id === 'curator'
            || url === 'curator.js' || url.endsWith('/curator.js');
          if (isBuiltInCurator) {
            try {
              curatorPlugin(this);
              return;
            } catch (e) {
              console.warn(`[Gravity] Static plugin fallback failed for ${url}`, e);
            }
          }

          // Trust boundary: a plugin URL from the manifest is dynamically
          // imported and runs with full engine access. Only load manifests and
          // plugins you trust — treat third-party game packs as untrusted code.
          const absoluteUrl = new URL(url, document.baseURI).href;
          try {
            const m = await import(absoluteUrl);
            m.default?.(this);
          } catch (e) {
            console.warn(`[Gravity] Plugin failed: ${absoluteUrl}`, e);
          }
        })
      );
    }

    this._validateData();

    // Initialize state from rules, then register missions and flags on it.
    this.state.init(this.data.rules, this.data.items);
    this.state.registerMissions(this.data.missions);
    this.state.registerSceneFlags(this.data.flags);

    this.ui.setup();
    // Every state change triggers a full UI update. Subsystems mutate state
    // and the reactive UI re-renders — no manual refresh calls needed.
    this.state.subscribe((_state, hint) => this.ui.update(hint));

    if (!this.state.getPlayer().name) {
      // New game — show character creation before revealing the main UI.
      new CharCreationScreen(() => this._startGame(), this.t.bind(this), this.data.tables.names?.entries || [], this.data.rules, this.state);
    } else {
      this._startGame();
    }
  }

  _startGame() {
    document.getElementById('game-container').hidden = false;
    document.getElementById('char-creation').hidden = true;
    this.ui.update();
    this.renderScene(this.state.getCurrentSceneId());
  }

  // Returns the manifest object so init() can read manifest.plugins.
  async loadData() {
    // Load the default locale first — must be available before the try-catch
    // below so error messages can still be translated if game data fails to load.
    this.data.locale = await fetch(DEFAULT_LOCALE_PATH, { cache: 'no-cache' }).then(r => r.json()).catch(() => ({}));

    try {
      const manifestRes = await fetch('data/index.json', { cache: 'no-cache' });
      const manifest = await manifestRes.json();

      // Resolve the active language from the manifest's declared locale files
      // and the browser's language preferences. The default locale is already
      // loaded as the fallback; re-fetch only for a different locale file.
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

      // A manifest category may take three shapes:
      // - an object map of id → file path (one fetch per entry — the demo),
      // - a bundle path (string): one JSON object holding id → definition,
      // - an array of bundle paths, merged in order.
      // Bundles keep a large game (thousands of scenes) to a handful of
      // requests at boot; scripts/generate-manifest.js maintains the map form.
      const loadCategory = async (category) => {
        if (!category) return {};
        if (typeof category === 'string') return fetchJson(category, {});
        if (Array.isArray(category)) {
          return Object.assign({}, ...await Promise.all(category.map(url => fetchJson(url, {}))));
        }
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

      this.data = { items, npcs, scenes, missions, tables, regions: manifest.regions || {}, worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE, locale: this.data.locale, rules, flags };

      // Note: registerMissions and registerSceneFlags are called by init()
      // after this.state.init(rules) — they must NOT be called here. Data
      // validation also happens in init(), after plugins have registered
      // their action types.
      return manifest;
    } catch (e) {
      console.error("Failed to load game data:", e);
      this.log(LOG.SYSTEM, this.t('system.dataError'));
      return null;
    }
  }

  /**
   * Looks up a locale string by dot-separated key and substitutes {param}
   * placeholders. Falls back to the key itself if the string is not found,
   * so missing translations are visible but don't crash the game.
   *
   * @param {string} key - Dot-separated locale key (e.g. 'dialogue.buyButton').
   * @param {Object<string, *>} [params] - Values for {param} placeholders.
   * @returns {string} The translated string, or the key when missing.
   */
  t(key, params = {}) {
    const parts = key.split('.');
    let str = this.data.locale;
    for (const p of parts) str = str?.[p];
    if (typeof str !== 'string') return key;
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
  }

  // Validates all loaded game data (see core/validate.js) and prints the
  // issues grouped per source entity. Developer tooling only — logs to the
  // console, no in-game effect. Runs after plugin loading so plugin-registered
  // action types are known.
  _validateData() {
    const issues = validateGameData(this.data, new Set(this._actionRegistry.keys()));
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

  // ── Item action methods ─────────────────────────────────────────────────
  // Thin delegates into systems/items.js — the UI buttons call these; the
  // AP-cost checks and effect handling live in that module.

  useItem(itemId)          { return items.useItem(this, itemId); }
  equipItem(slot, itemId)  { return items.equipItem(this, slot, itemId); }
  unequipItem(slot)        { return items.unequipItem(this, slot); }

  // Deducts AP in combat. Returns false (blocking the action) if the cost
  // exceeds the player's remaining AP for the turn. The spend is then handed
  // to CombatSystem explicitly — turn handoff is core control flow, not a
  // notification. Out of combat AP is never spent, so this is a no-op.
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

  // ── Mode machine ────────────────────────────────────────────────────────
  // Exactly one surface owns the options panel at a time (see this.mode).

  /** @param {'scene'|'combat'|'dialogue'|'store'|'customUI'|'gameover'} mode */
  setMode(mode) { this.mode = mode; }

  get inCombat()   { return this.mode === 'combat'; }
  get isGameOver() { return this.mode === 'gameover'; }
  get inDialogue() { return this.mode === 'dialogue' || this.mode === 'store'; }
  get inCustomUI() { return this.mode === 'customUI'; }

  // Marks a custom UI panel (chest, curator dashboard, …) as open or closed.
  // Custom UIs call this when they take over / release the options panel so
  // scene re-render logic knows not to draw options over them.
  setCustomUIOpen(open) { this.setMode(open ? 'customUI' : 'scene'); }

  /**
   * Captures the player's location (scene + mode) and returns a predicate
   * answering "did anything since move the player?" — a scene change, or any
   * mode transition (combat, dialogue, store, custom UI, game over). Callers
   * snapshot before running a pipeline and skip their re-render when it
   * fires: the new surface owns the options panel now.
   *
   * @returns {() => boolean}
   */
  snapshotNavigation() {
    const sceneId = this.state.getCurrentSceneId();
    const mode = this.mode;
    return () => this.state.getCurrentSceneId() !== sceneId || this.mode !== mode;
  }

  // ── Delegate API ────────────────────────────────────────────────────────
  // Subsystems (combat, dialogue, quests) call these on `this.engine`.
  // They forward to the appropriate module so subsystems need no knowledge
  // of the internal structure.

  get currentSceneEl() { return this.narrative.currentSceneEl; }
  set currentSceneEl(v) { this.narrative.currentSceneEl = v; }

  openScene(modifier) { return this.narrative.openScene(modifier); }
  log(type, message, variant, persist) {
    const localeKey = 'log.' + type;
    const label = this.t(localeKey) !== localeKey ? this.t(localeKey) : type;
    return this.narrative.log(label, message, variant, persist);
  }
  /**
   * Runs an action pipeline through the registered action handlers.
   * Shared by SceneRenderer, CombatSystem, DialogueSystem, and plugins.
   *
   * @param {Array<{type: string}>} actions - Action objects executed in order;
   *   each carries its handler-specific params (e.g. { type: 'loot', item, amount }).
   */
  runActions(actions) {
    for (const action of (actions || [])) {
      const handler = this.getActionHandler(action.type);
      if (handler) handler(action, this);
      else console.warn(`[Gravity] runActions: no handler for action type "${action.type}"`);
    }
  }

  /**
   * Advances the world clock and runs the pipelines of any timers that came
   * due. Timer pipelines are restricted to quiet actions (TIMER_SAFE_ACTIONS)
   * — they change the world through flags and logs, never by navigating or
   * starting combat, which sidesteps every mid-flow reentrancy question.
   * Firing is synchronous and deterministic: no wall-clock is involved, so
   * saves replay identically.
   *
   * @param {number} amount - Ticks to advance (non-positive is a no-op).
   */
  advanceTime(amount) {
    const ticksBefore = this.state.getTicks();
    const fired = this.state.advanceTime(amount);
    // Narrate the passage of time before any timer fires, so "It is now
    // night." reads ahead of whatever the night set in motion.
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

  // Logs a line when advancing the clock crossed into a new day or day
  // segment. Silent for games without rules.time (getDay returns null) and
  // for advances that stay within the current segment.
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
    // Combat owns the panel: a pipeline that navigates mid-fight is ignored
    // (matching SceneRenderer.render's own guard) — and must not flip the mode.
    if (this.inCombat) return;
    this.dialogueSystem.close();
    this.setMode('scene');
    return this.scene.render(sceneId, opts);
  }
  restoreScene(sceneId, lastDesc) { return this.scene.restoreFromSave(sceneId, lastDesc); }
  resetScene()                   { return this.scene.reset(); }
  handleQuestTrigger(trigger) { return this.questSystem.handleTrigger(trigger); }
  scrollNarrativeToBottom() { return this.narrative.scrollToBottom(); }

  // ── Event system ────────────────────────────────────────────────────────
  // Minimal pub/sub. Subsystems subscribe in their constructors; emitters need
  // no knowledge of who is listening. Use for cross-system notifications where
  // a direct call would create unwanted coupling.

  /**
   * Subscribes a handler to an engine event. Current events:
   *   'scene:entered'  { sceneId, scene } — a questTrigger scene was entered
   *
   * @param {string} event - Event name.
   * @param {(data: object) => void} handler
   */
  on(event, handler) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(handler);
  }

  /**
   * Unsubscribes a handler previously registered with on().
   *
   * @param {string} event - Event name.
   * @param {(data: object) => void} handler - The same function reference.
   */
  off(event, handler) {
    const handlers = this._events.get(event);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  /**
   * Emits an engine event to all subscribed handlers.
   *
   * @param {string} event - Event name.
   * @param {object} [data] - Payload passed to each handler.
   */
  emit(event, data) {
    const handlers = this._events.get(event);
    if (!handlers) return;
    // Snapshot handlers before iterating so a handler that calls off() on itself
    // during emit doesn't cause the next handler to be skipped via splice mutation.
    [...handlers].forEach(h => h(data));
  }

  /**
   * Registers a handler for an action type so it can be used in scene option,
   * dialogue, and onVictory pipelines. Registering an existing name overwrites
   * it (with a console warning).
   *
   * @param {string} name - The action type string used in game data JSON.
   * @param {(action: object, engine: RPGEngine) => void} handlerFn - Owns only
   *   its side effect; navigation is a separate 'navigate' action.
   */
  registerAction(name, handlerFn) {
    if (this._actionRegistry.has(name)) {
      console.warn(`[Gravity] registerAction: "${name}" already registered — overwriting`);
    }
    this._actionRegistry.set(name, handlerFn);
  }

  /**
   * @param {string} name - The action type string.
   * @returns {((action: object, engine: RPGEngine) => void)|null}
   */
  getActionHandler(name) {
    return this._actionRegistry.get(name) || null;
  }

  /**
   * Registers a named description hook. A scene opts in by declaring
   * "descriptionHook": "name" in its JSON; the hook's return value is
   * appended to that scene's description.
   *
   * @param {string} name - The hook name scenes reference.
   * @param {(engine: RPGEngine) => string} fn - Returns an HTML string.
   */
  registerDescriptionHook(name, fn) {
    this._descriptionHooks.set(name, fn);
  }

  /**
   * @param {string} name - The hook name.
   * @returns {((engine: RPGEngine) => string)|null}
   */
  getDescriptionHook(name) {
    return this._descriptionHooks.get(name) || null;
  }

  /**
   * Registers a scene decorator, invoked for every rendered scene. Plugins use
   * this to inject content into scenes they don't own; the per-scene
   * descriptionHook covers content a scene declares explicitly in its JSON.
   *
   * @param {object} decorator
   * @param {(scene: object, sceneId: string, engine: RPGEngine) => string} [decorator.description]
   *   Returns an HTML string appended to the scene description.
   * @param {(scene: object, optionsContainer: HTMLElement, engine: RPGEngine) => void} [decorator.options]
   *   May append extra option buttons to the options container.
   */
  registerSceneDecorator(decorator) {
    this._sceneDecorators.push(decorator);
  }

  get sceneDecorators() { return this._sceneDecorators; }

  /**
   * Registers a tab widget builder for rules.tabs[].widget. The UI build
   * consults this registry for every tab that declares a widget, so a plugin
   * can contribute a whole sidebar tab (register during plugin load — plugins
   * load before the UI builds).
   *
   * @param {string} name - The widget name tabs reference.
   * @param {(panel: HTMLElement, ui: object) => void} fn - Fills the tab's
   *   panel element; receives the UIManager for shared helpers.
   */
  registerTabWidget(name, fn) {
    this._tabWidgets.set(name, fn);
  }

  /**
   * @param {string} name - The widget name.
   * @returns {((panel: HTMLElement, ui: object) => void)|null}
   */
  getTabWidget(name) {
    return this._tabWidgets.get(name) || null;
  }

  /**
   * Registers an extra row for the sheet tab's character section — the way a
   * plugin surfaces a custom stat (e.g. the curator's reputation). Plugins
   * load before the UI builds, so registered rows render as part of the
   * sheet itself: right after the built-in stats, before the
   * rules.headerResources rows, filled by the same data-stat-bind loop as
   * every other row. No-op for games whose tabs omit the attributes widget.
   *
   * @param {object} row
   * @param {string} row.label - Display label (plain text).
   * @param {string} row.bind - data-stat-bind path on the player (e.g.
   *   'attributes.reputation').
   */
  registerSheetRow(row) {
    this._sheetRows.push(row);
  }

  get sheetRows() { return this._sheetRows; }
}

window.addEventListener('DOMContentLoaded', () => {
  // A harness that constructs the engine itself (see tests/smoke.html) sets
  // GRAVITY_MANUAL_BOOT synchronously at startup — don't boot over it.
  if (!window.GRAVITY_MANUAL_BOOT && !window.gameEngine) window.gameEngine = new RPGEngine();
});
