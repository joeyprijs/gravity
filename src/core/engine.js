import { gameState } from "./state.js";
import { CombatSystem } from "../systems/combat.js";
import { DialogueSystem } from "../systems/dialogue.js";
import { QuestSystem } from "../systems/quests.js";
import { NarrativeLog } from "../systems/narrative.js";
import { UIManager } from "../ui/ui.js";
import { SceneRenderer } from "../systems/scene.js";
import { DEFAULT_WORLD_MAP_SIZE, LOG, TIMER_SAFE_ACTIONS } from "./config.js";
import { resolveLanguage } from "./i18n.js";
import { normalizeCarriedItems, normalizeRules, validateGameData } from "./validate.js";
import { registerBuiltinActions } from "../systems/actions.js";
import { parseDamage } from "../systems/dice.js";
import { getDay, getSegment } from "../systems/time.js";
import { CharCreationScreen } from "../screens/char-creation.js";
import curatorPlugin from "../plugins/curator.js";

// The locale file loaded before anything else, and the fallback when the
// manifest declares no locale for the resolved language.
const DEFAULT_LOCALE_PATH = 'data/locales.json';

// RPGEngine is the central orchestrator. It owns all subsystems, loads game
// data from JSON, and exposes a thin delegate API so subsystems can call each
// other without importing each other directly (avoiding circular deps).
class RPGEngine {
  constructor(previewBundle = null) {
    // When running inside Studio's live-preview iframe, game data is injected
    // as an in-memory bundle instead of being fetched from disk. null in normal play.
    this._previewBundle = previewBundle;

    // Populated by loadData(). Kept as an empty shell here so subsystems
    // constructed below can safely reference this.engine.data without null checks.
    this.data = { items: {}, npcs: {}, scenes: {}, missions: {}, tables: {}, regions: {}, worldMapSize: DEFAULT_WORLD_MAP_SIZE, locale: {}, rules: null, flags: {} };

    // Active language code. Resolved properly in loadData() once the manifest's
    // declared locales are known; 'en' until then.
    this.language = 'en';

    this._actionRegistry = new Map();
    this._descriptionHooks = new Map();
    this._sceneDecorators = [];
    this._events = new Map();

    this.narrative = new NarrativeLog(this.t.bind(this));
    this.combatSystem = new CombatSystem(this);
    this.dialogueSystem = new DialogueSystem(this);
    this.questSystem = new QuestSystem(this);
    this.ui = new UIManager(this);
    this.scene = new SceneRenderer(this);

    this.init();
  }

  async init() {
    this.isGameStart = true;
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

    // Initialise state from rules, then register missions and flags on it.
    gameState.init(this.data.rules, this.data.items);
    gameState.registerMissions(this.data.missions);
    gameState.registerSceneFlags(this.data.flags);

    // Studio preview deep-link: start on the scene being edited if it exists.
    if (this._previewStartScene && this.data.scenes[this._previewStartScene]) {
      gameState.setCurrentSceneId(this._previewStartScene);
    }

    this.ui.setup();
    // Every state change triggers a full UI update. Subsystems mutate state
    // and the reactive UI re-renders — no manual refresh calls needed.
    gameState.subscribe((_state, hint) => this.ui.update(hint));

    if (!gameState.getPlayer().name) {
      // New game — show character creation before revealing the main UI.
      new CharCreationScreen(() => this._startGame(), this.t.bind(this), this.data.tables.names?.entries || [], this.data.rules);
    } else {
      this._startGame();
    }
  }

  _startGame() {
    document.getElementById('game-container').hidden = false;
    document.getElementById('char-creation').hidden = true;
    this.ui.update();
    this.renderScene(gameState.getCurrentSceneId());
  }

  // Returns the manifest object so init() can read manifest.plugins.
  async loadData() {
    // Studio live-preview: render the in-memory bundle the parent window
    // injected instead of fetching from disk, so unsaved edits show immediately.
    if (this._previewBundle) return this._loadFromBundle(this._previewBundle);

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

      const loadCategory = async (categoryObj) => {
        const results = {};
        const keys = Object.keys(categoryObj);
        const loadedData = await Promise.all(
          keys.map(key =>
            fetch(categoryObj[key], { cache: 'no-cache' })
              .then(r => r.json())
              .catch(err => { console.warn(`[Gravity] Failed to load "${key}": ${err.message}`); return null; })
          )
        );
        keys.forEach((key, i) => { if (loadedData[i] !== null) results[key] = loadedData[i]; });
        return results;
      };

      const [items, npcs, scenes, missions, tables, flags, rules] = await Promise.all([
        loadCategory(manifest.items),
        loadCategory(manifest.npcs),
        loadCategory(manifest.scenes),
        loadCategory(manifest.missions),
        manifest.tables ? loadCategory(manifest.tables) : Promise.resolve({}),
        manifest.flags
          ? (typeof manifest.flags === 'string'
            ? fetch(manifest.flags, { cache: 'no-cache' }).then(r => r.json()).catch(() => ({}))
            : Promise.all(
                Object.values(manifest.flags).map(url =>
                  fetch(url, { cache: 'no-cache' }).then(r => r.json()).catch(err => { console.warn(`[Gravity] Failed to load flags from "${url}": ${err.message}`); return {}; })
                )
              ).then(results => Object.assign({}, ...results))
          )
          : Promise.resolve({}),
        manifest.rules ? fetch(manifest.rules, { cache: 'no-cache' }).then(r => r.json()).catch(() => null) : Promise.resolve(null)
      ]);

      // Normalize once at load so consumers (merchant store, validation) only
      // ever see carriedItems in its { item, amount } object form — and luck
      // knobs under rules.luck.
      normalizeCarriedItems(npcs);
      normalizeRules(rules);

      this.data = { items, npcs, scenes, missions, tables, regions: manifest.regions || {}, worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE, locale: this.data.locale, rules, flags };

      // Note: registerMissions and registerSceneFlags are called by init()
      // after gameState.init(rules) — they must NOT be called here. Data
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
   * Loads game data from an in-memory bundle (Studio live-preview) instead of
   * fetching from disk. The bundle mirrors the loaded-data shape: category maps
   * keyed by id, plus the manifest for regions/worldMapSize/plugins/locales.
   * Mirrors the assembly the fetch path does in the try-block above.
   *
   * @param {object} bundle - { manifest, rules, locale, items, npcs, scenes, missions, tables, flags }
   * @returns {object} The manifest, so init() can read manifest.plugins.
   */
  _loadFromBundle(bundle) {
    const manifest = bundle.manifest || {};
    // Optional deep-link: boot straight to the scene the author is editing.
    this._previewStartScene = bundle.preview?.startScene || null;
    this.language = resolveLanguage(
      Object.keys(manifest.locales || {}),
      navigator.languages || [navigator.language],
      manifest.defaultLanguage || 'en'
    );
    this.data.locale = bundle.locale || {};
    const npcs = bundle.npcs || {};
    // Same normalization the fetch path applies so the merchant store and
    // validation only ever see carriedItems in { item, amount } form.
    normalizeCarriedItems(npcs);
    const rules = bundle.rules || null;
    normalizeRules(rules);
    // Skip character creation in preview so authors land straight on their
    // content: give the player a placeholder name when the rules leave it blank,
    // which satisfies init()'s new-game gate. The bundle is a postMessage copy,
    // so this never mutates Studio's data.
    if (rules?.playerDefaults && !rules.playerDefaults.name) rules.playerDefaults.name = 'Preview';
    this.data = {
      items: bundle.items || {},
      npcs,
      scenes: bundle.scenes || {},
      missions: bundle.missions || {},
      tables: bundle.tables || {},
      regions: manifest.regions || {},
      worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE,
      locale: this.data.locale,
      rules,
      flags: bundle.flags || {},
    };
    return manifest;
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

  // --- Item action methods ---
  // These are called by UIManager buttons. They own the AP-cost check and
  // combat-refresh logic so the UI layer stays free of game logic.

  useItem(itemId) {
    if (this.isGameOver) return;
    const itemData = this.data.items[itemId];
    if (!itemData) return;

    if (gameState.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return;

    const apCost = itemData.actionPoints ?? 0;
    if (this.inCombat && gameState.getPlayer().resources.ap.current < apCost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost: apCost }));
      return;
    }

    // Apply effect BEFORE spending AP so the log order is always:
    // "used potion" → (AP spent) → enemy turn fires.
    // Luck and healing are independent effects (an item may carry both);
    // the consumable is removed once, after every effect has applied.
    const restoresLuck = itemData.attributes?.luckAmount || itemData.attributes?.luckMaxBonus;
    if (restoresLuck) {
      // Luck consumables (a four-leaf clover, a Potion of Fortune). A missing
      // luck resource makes both stat calls no-ops, so guard to avoid
      // consuming the item for nothing.
      if (!gameState.getPlayer().resources?.luck) {
        console.warn(`[Gravity] useItem: "${itemId}" restores luck but this game has no luck resource`);
        return;
      }
      const maxBonus = itemData.attributes.luckMaxBonus ?? 0;
      const amount = itemData.attributes.luckAmount ?? 0;
      if (maxBonus) gameState.modifyPlayerStat('maxLuck', maxBonus);
      if (amount) gameState.modifyPlayerStat('luck', amount);
      this.log(LOG.SYSTEM, this.t('player.usedLuckItem', { name: itemData.name, amount, maxBonus }), 'loot');
    }
    if (itemData.attributes?.healingAmount) {
      let amount = itemData.attributes.healingAmount;
      let rollSuffix = "";
      if (typeof amount === 'string') {
        const result = parseDamage(amount);
        amount = result.total;
        rollSuffix = this.t('player.rollSuffix', { roll: result.string });
      }
      gameState.modifyPlayerStat('hp', amount);
      this.log(LOG.SYSTEM, this.t('player.usedItem', { name: itemData.name, amount, rollSuffix }), 'loot');
    }
    if (restoresLuck || itemData.attributes?.healingAmount) {
      gameState.removeFromInventory(itemId, 1);
    } else if (itemData.attributes?.teleportScene) {
      if (this.inCombat) {
        this.log(LOG.SYSTEM, this.t('player.noCombatTeleport'));
        return;
      }
      const curScene = gameState.getCurrentSceneId();
      if (curScene !== itemData.attributes.teleportScene) {
        gameState.setReturnSceneId(curScene);
        this.log(LOG.SYSTEM, this.t('player.teleported', { name: itemData.name }));
        this.renderScene(itemData.attributes.teleportScene);
      } else {
        this.log(LOG.SYSTEM, this.t('player.alreadyHere'));
      }
    }

    this._spendAP(apCost);
  }

  equipItem(slot, itemId) {
    if (this.isGameOver) return;
    const itemData = this.data.items[itemId];
    const targetSlot = slot || itemData?.slot;
    if (!itemData || !targetSlot) return;

    if (gameState.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return;

    const apCost = itemData.actionPoints ?? 0;
    if (this.inCombat && gameState.getPlayer().resources.ap.current < apCost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost: apCost }));
      return;
    }

    const oldItemId = gameState.getPlayer().equipment[targetSlot];
    const oldBonus = (oldItemId && this.data.items[oldItemId]?.attributes?.armorClassBonus) || 0;
    const newBonus = itemData.attributes?.armorClassBonus ?? 0;
    const success = gameState.equipItem(targetSlot, itemId);
    if (!success) return;
    if (newBonus - oldBonus !== 0) gameState.modifyPlayerStat('ac', newBonus - oldBonus);
    this.log(LOG.PLAYER, this.t('player.equipped', { name: itemData.name, slot: targetSlot }));
    this._spendAP(apCost);
  }

  unequipItem(slot) {
    if (this.isGameOver) return;
    const itemId = gameState.getPlayer().equipment[slot];
    if (!itemId) return;
    const unequipCost = this.data.rules?.unequipApCost ?? 1;
    if (this.inCombat && gameState.getPlayer().resources.ap.current < unequipCost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost: unequipCost }));
      return;
    }
    const itemName = this.data.items[itemId]?.name || itemId;
    const bonus = this.data.items[itemId]?.attributes?.armorClassBonus ?? 0;
    gameState.equipItem(slot, null);
    if (bonus !== 0) gameState.modifyPlayerStat('ac', -bonus);
    this.log(LOG.PLAYER, this.t('player.unequipped', { name: itemName, slot }));
    this._spendAP(unequipCost);
  }

  // Deducts AP in combat. Returns false (blocking the action) if insufficient.
  // Emits player:apSpent so CombatSystem can refresh the UI and hand off to
  // the enemy if AP hits zero — engine no longer calls combat methods directly.
  _spendAP(cost) {
    if (!this.inCombat) return true;
    const player = gameState.getPlayer();
    if (player.resources.ap.current < cost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost }));
      return false;
    }
    gameState.modifyPlayerStat('ap', -cost);
    this.emit('player:apSpent', { remaining: gameState.getPlayer().resources.ap.current });
    return true;
  }

  // --- Delegate API ---
  // Subsystems (combat, dialogue, quests) call these on `this.engine`.
  // They forward to the appropriate module so subsystems need no knowledge
  // of the internal structure.

  get inCombat() { return this.combatSystem.inCombat; }
  get isGameOver() { return this.combatSystem.isGameOver; }
  get inDialogue() { return !!this.dialogueSystem.currentNPC; }
  get inCustomUI() { return !!this._customUIOpen; }

  // Marks a custom UI panel (chest, curator dashboard, …) as open or closed.
  // Custom UIs call this when they take over / release the options panel so
  // scene re-render logic knows not to draw options over them.
  setCustomUIOpen(open) { this._customUIOpen = !!open; }

  get isGameStart() { return this.narrative.isGameStart; }
  set isGameStart(v) { this.narrative.isGameStart = v; }

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
    const ticksBefore = gameState.getTicks();
    const fired = gameState.advanceTime(amount);
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
    const ticks = gameState.getTicks();
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
    this.dialogueSystem.storeOpen = false;
    this.dialogueSystem.currentNPC = null;
    this.dialogueSystem.currentNPCId = null;
    return this.scene.render(sceneId, opts);
  }
  restoreScene(sceneId, lastDesc) { return this.scene.restoreFromSave(sceneId, lastDesc); }
  resetScene()                   { return this.scene.reset(); }
  handleQuestTrigger(trigger, state) { return this.questSystem.handleTrigger(trigger, state); }
  scrollNarrativeToBottom() { return this.narrative.scrollToBottom(); }

  // --- Event system ---
  // Minimal pub/sub. Subsystems subscribe in their constructors; emitters need
  // no knowledge of who is listening. Use for cross-system notifications where
  // a direct call would create unwanted coupling.

  /**
   * Subscribes a handler to an engine event. Current events:
   *   'scene:entered'  { sceneId, scene } — a questTrigger scene was entered
   *   'player:apSpent' { remaining }      — the player spent AP in combat
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
}

window.addEventListener('DOMContentLoaded', () => {
  // Studio live-preview mode (index.html?preview=1): don't boot immediately.
  // Announce readiness to the parent window, then boot the engine against the
  // in-memory data bundle it posts back. See studio/js/complex/preview.js.
  // Bundles are accepted only from a same-origin parent (Studio serves the
  // game from its own origin): scene descriptions render via innerHTML, so a
  // foreign page embedding a deployed game must never be able to inject one.
  if (new URLSearchParams(location.search).get('preview') === '1') {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const msg = e.data;
      if (!msg || msg.type !== 'gravity:bundle' || window.gameEngine) return;
      window.gameEngine = new RPGEngine(msg.bundle);
    });
    window.parent.postMessage({ type: 'gravity:preview-ready' }, location.origin);
    return;
  }
  window.gameEngine = new RPGEngine();
});
