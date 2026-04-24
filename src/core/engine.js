import { gameState } from "./state.js";
import { CombatSystem } from "../systems/combat.js";
import { DialogueSystem } from "../systems/dialogue.js";
import { QuestSystem } from "../systems/quests.js";
import { NarrativeLog } from "../systems/narrative.js";
import { UIManager } from "../ui/ui.js";
import { SceneRenderer } from "../systems/scene.js";
import { DEFAULT_WORLD_MAP_SIZE, LOG } from "./config.js";
import { registerBuiltinActions } from "../systems/actions.js";
import { parseDamage } from "../systems/dice.js";
import { CharCreationScreen } from "../screens/char-creation.js";

// RPGEngine is the central orchestrator. It owns all subsystems, loads game
// data from JSON, and exposes a thin delegate API so subsystems can call each
// other without importing each other directly (avoiding circular deps).
class RPGEngine {
  constructor() {
    // Populated by loadData(). Kept as an empty shell here so subsystems
    // constructed below can safely reference this.engine.data without null checks.
    this.data = { items: {}, npcs: {}, scenes: {}, missions: {}, tables: {}, regions: {}, worldMapSize: DEFAULT_WORLD_MAP_SIZE, locale: {}, rules: null, flags: {} };

    this._actionRegistry = new Map();
    this._descriptionHooks = new Map();
    this._events = new Map();

    this.narrative = new NarrativeLog();
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
        manifest.plugins.map(url =>
          import(url)
            .then(m => m.default?.(this))
            .catch(e => console.warn(`[Gravity] Plugin failed: ${url}`, e))
        )
      );
    }

    // Initialise state from rules, then register missions and flags on it.
    gameState.init(this.data.rules);
    gameState.registerMissions(this.data.missions);
    gameState.registerSceneFlags(this.data.flags);

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
    // Load locale first — must be available before the try-catch below so
    // error messages can still be translated if game data fails to load.
    this.data.locale = await fetch('data/locales.json').then(r => r.json()).catch(() => ({}));

    try {
      const manifestRes = await fetch('data/index.json');
      const manifest = await manifestRes.json();

      const loadCategory = async (categoryObj) => {
        const results = {};
        const keys = Object.keys(categoryObj);
        const loadedData = await Promise.all(
          keys.map(key =>
            fetch(categoryObj[key])
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
            ? fetch(manifest.flags).then(r => r.json()).catch(() => ({}))
            : Promise.all(
                Object.values(manifest.flags).map(url =>
                  fetch(url).then(r => r.json()).catch(err => { console.warn(`[Gravity] Failed to load flags from "${url}": ${err.message}`); return {}; })
                )
              ).then(results => Object.assign({}, ...results))
          )
          : Promise.resolve({}),
        manifest.rules ? fetch(manifest.rules).then(r => r.json()).catch(() => null) : Promise.resolve(null)
      ]);

      this.data = { items, npcs, scenes, missions, tables, regions: manifest.regions || {}, worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE, locale: this.data.locale, rules, flags };

      // Note: registerMissions and registerSceneFlags are called by init()
      // after gameState.init(rules) — they must NOT be called here.
      this._validateData();
      return manifest;
    } catch (e) {
      console.error("Failed to load game data:", e);
      this.log(LOG.SYSTEM, this.t('system.dataError'));
      return null;
    }
  }

  // Looks up a locale string by dot-separated key and substitutes {param} placeholders.
  // Falls back to the key itself if the string is not found, so missing translations
  // are visible but don't crash the game.
  t(key, params = {}) {
    const parts = key.split('.');
    let str = this.data.locale;
    for (const p of parts) str = str?.[p];
    if (typeof str !== 'string') return key;
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
  }

  // Recursively checks a condition tree for unknown item IDs.
  _validateCondition(condition, context, items, warn) {
    if (!condition) return;
    if (condition.and) { condition.and.forEach(c => this._validateCondition(c, context, items, warn)); return; }
    if (condition.or)  { condition.or.forEach(c => this._validateCondition(c, context, items, warn)); return; }
    if (condition.not) { this._validateCondition(condition.not, context, items, warn); return; }
    if ('item' in condition && !items[condition.item])
      warn(`${context}: condition references unknown item "${condition.item}"`);
    if ('mission' in condition && !this.data.missions[condition.mission])
      warn(`${context}: condition references unknown mission "${condition.mission}"`);
  }

  // Validates cross-references in game data after load and warns about broken links.
  // Developer tooling only — logs to console, no in-game effect.
  _validateData() {
    const { items, npcs, scenes, rules } = this.data;
    const warn = (msg) => console.warn(`[Gravity] ${msg}`);

    for (const [tableId, table] of Object.entries(this.data.tables || {})) {
      for (const entry of (table.entries || [])) {
        if (entry.item && entry.item !== 'gold' && !items[entry.item])
          warn(`Table "${tableId}": entry references unknown item "${entry.item}"`);
      }
    }

    for (const [sceneId, scene] of Object.entries(scenes)) {
      for (const skill of (scene.skills || [])) {
        if (skill.condition)
          this._validateCondition(skill.condition, `Scene "${sceneId}": skill "${skill.text}"`, items, warn);
        for (const item of (skill.items || [])) {
          if (item.table && !this.data.tables[item.table])
            warn(`Scene "${sceneId}": skill "${skill.text}" references unknown table "${item.table}"`);
        }
      }
      for (const opt of (scene.options || [])) {
        if (opt.condition)
          this._validateCondition(opt.condition, `Scene "${sceneId}": option "${opt.text}"`, items, warn);
        if (opt.requirements?.item && !items[opt.requirements.item])
          warn(`Scene "${sceneId}": option "${opt.text}" requires unknown item "${opt.requirements.item}"`);
        for (const action of (opt.actions || [])) {
          if (!this._actionRegistry.has(action.type))
            warn(`Scene "${sceneId}": option "${opt.text}" has unknown action type "${action.type}"`);
          if (action.type === 'navigate' && action.destination && !scenes[action.destination])
            warn(`Scene "${sceneId}": navigate → unknown destination "${action.destination}"`);
          if (action.type === 'loot' && action.item && action.item !== 'gold' && !items[action.item])
            warn(`Scene "${sceneId}": loot → unknown item "${action.item}"`);
          if (action.type === 'dialogue' && action.npc && !npcs[action.npc])
            warn(`Scene "${sceneId}": dialogue → unknown NPC "${action.npc}"`);
          if (action.type === 'combat') {
            const ids = action.enemies || [];
            ids.forEach(id => { if (!npcs[id]) warn(`Scene "${sceneId}": combat → unknown enemy "${id}"`); });
            for (const va of (action.onVictory || [])) {
              if (va.type === 'navigate' && va.destination && !scenes[va.destination])
                warn(`Scene "${sceneId}": combat.onVictory → unknown destination "${va.destination}"`);
              if (va.type === 'loot' && va.item && va.item !== 'gold' && !items[va.item])
                warn(`Scene "${sceneId}": combat.onVictory → unknown item "${va.item}"`);
            }
          }
        }
      }
      if (scene.autoAttack) {
        const ids = scene.autoAttack.enemies || [];
        ids.forEach(id => { if (!npcs[id]) warn(`Scene "${sceneId}": autoAttack → unknown enemy "${id}"`); });
        for (const va of (scene.autoAttack.onVictory || [])) {
          if (va.type === 'navigate' && va.destination && !scenes[va.destination])
            warn(`Scene "${sceneId}": autoAttack.onVictory → unknown destination "${va.destination}"`);
          if (va.type === 'loot' && va.item && va.item !== 'gold' && !items[va.item])
            warn(`Scene "${sceneId}": autoAttack.onVictory → unknown item "${va.item}"`);
        }
      }
    }

    for (const [npcId, npc] of Object.entries(npcs)) {
      for (const entry of (npc.carriedItems || [])) {
        const itemId = typeof entry === 'string' ? entry : entry.item;
        if (!items[itemId]) warn(`NPC "${npcId}": carriedItems → unknown item "${itemId}"`);
      }
      for (const [slot, itemId] of Object.entries(npc.equipment || {}))
        if (itemId && !items[itemId]) warn(`NPC "${npcId}": equipment[${slot}] → unknown item "${itemId}"`);
    }

    const playerFallback = rules?.fallbackWeapons?.player;
    const enemyFallback  = rules?.fallbackWeapons?.enemy;
    if (playerFallback && !items[playerFallback])
      warn(`Missing required fallback item "${playerFallback}" — add to data/items/ and index.json`);
    if (enemyFallback && !items[enemyFallback])
      warn(`Missing required fallback item "${enemyFallback}" — add to data/items/ and index.json`);

    for (const attr of (rules?.customAttributes || [])) {
      if (!this.data.locale?.actions?.skillBadge?.[attr.id])
        warn(`customAttributes "${attr.id}": missing locale entry at actions.skillBadge.${attr.id}`);
    }

    for (const stat of (rules?.charCreation?.stats || [])) {
      if (!this.data.locale?.charCreation?.stats?.[stat.localeKey])
        warn(`charCreation.stats "${stat.id}": missing locale entry at charCreation.stats.${stat.localeKey}`);
    }
  }

  // --- Item action methods ---
  // These are called by UIManager buttons. They own the AP-cost check and
  // combat-refresh logic so the UI layer stays free of game logic.

  useItem(itemId) {
    if (this.isGameOver) return;
    const itemData = this.data.items[itemId];
    if (!itemData) return;

    const apCost = itemData.actionPoints || 0;
    if (this.inCombat && gameState.getPlayer().resources.ap.current < apCost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost: apCost }));
      return;
    }

    // Apply effect BEFORE spending AP so the log order is always:
    // "used potion" → (AP spent) → enemy turn fires.
    if (itemData.attributes?.healingAmount) {
      let amount = itemData.attributes.healingAmount;
      let rollSuffix = "";
      if (typeof amount === 'string') {
        const result = parseDamage(amount);
        amount = result.total;
        rollSuffix = ` (Roll: ${result.string})`;
      }
      gameState.modifyPlayerStat('hp', amount);
      this.log(LOG.SYSTEM, this.t('player.usedItem', { name: itemData.name, amount, rollSuffix }), 'loot');
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

    const apCost = itemData.actionPoints || 0;
    if (this.inCombat && gameState.getPlayer().resources.ap.current < apCost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost: apCost }));
      return;
    }

    const oldItemId = gameState.getPlayer().equipment[targetSlot];
    const oldBonus = (oldItemId && this.data.items[oldItemId]?.attributes?.armorClassBonus) || 0;
    const newBonus = itemData.attributes?.armorClassBonus || 0;
    gameState.equipItem(targetSlot, itemId);
    if (newBonus - oldBonus !== 0) gameState.modifyPlayerStat('ac', newBonus - oldBonus);
    this.log(LOG.PLAYER, this.t('player.equipped', { name: itemData.name, slot: targetSlot }));
    this._spendAP(apCost);
  }

  unequipItem(slot) {
    if (this.isGameOver) return;
    const unequipCost = this.data.rules?.unequipApCost ?? 1;
    if (this.inCombat && gameState.getPlayer().resources.ap.current < unequipCost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost: unequipCost }));
      return;
    }
    const itemId = gameState.getPlayer().equipment[slot];
    const itemName = itemId ? (this.data.items[itemId]?.name || itemId) : slot;
    const bonus = (itemId && this.data.items[itemId]?.attributes?.armorClassBonus) || 0;
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
  // Runs an action pipeline through the registered action handlers.
  // Shared by SceneRenderer, CombatSystem, and any plugin that needs it.
  runActions(actions) {
    for (const action of (actions || [])) {
      const handler = this.getActionHandler(action.type);
      if (handler) handler(action, this);
      else console.warn(`[Gravity] runActions: no handler for action type "${action.type}"`);
    }
  }

  renderScene(sceneId) {
    this.dialogueSystem.storeOpen = false;
    this.dialogueSystem.currentNPC = null;
    this.dialogueSystem.currentNPCId = null;
    return this.scene.render(sceneId);
  }
  restoreScene(sceneId, lastDesc) { return this.scene.restoreFromSave(sceneId, lastDesc); }
  resetScene()                   { return this.scene.reset(); }
  handleQuestTrigger(trigger, state) { return this.questSystem.handleTrigger(trigger, state); }
  scrollNarrativeToBottom() { return this.narrative.scrollToBottom(); }

  // --- Event system ---
  // Minimal pub/sub. Subsystems subscribe in their constructors; emitters need
  // no knowledge of who is listening. Use for cross-system notifications where
  // a direct call would create unwanted coupling.

  on(event, handler) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(handler);
  }

  off(event, handler) {
    const handlers = this._events.get(event);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  emit(event, data) {
    const handlers = this._events.get(event);
    if (!handlers) return;
    // Snapshot handlers before iterating so a handler that calls off() on itself
    // during emit doesn't cause the next handler to be skipped via splice mutation.
    [...handlers].forEach(h => h(data));
  }

  registerAction(name, handlerFn) {
    if (this._actionRegistry.has(name)) {
      console.warn(`[Gravity] registerAction: "${name}" already registered — overwriting`);
    }
    this._actionRegistry.set(name, handlerFn);
  }

  getActionHandler(name) {
    return this._actionRegistry.get(name) || null;
  }

  registerDescriptionHook(name, fn) {
    this._descriptionHooks.set(name, fn);
  }

  getDescriptionHook(name) {
    return this._descriptionHooks.get(name) || null;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gameEngine = new RPGEngine();
});
