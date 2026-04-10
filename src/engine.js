import { gameState } from "./state.js";
import { CombatSystem } from "./combat.js";
import { DialogueSystem } from "./dialogue.js";
import { QuestSystem } from "./quests.js";
import { NarrativeLog } from "./narrative.js";
import { UIManager } from "./ui.js";
import { SceneRenderer } from "./scene.js";
import { BASE_AC, UNEQUIP_AP_COST, DEFAULT_WORLD_MAP_SIZE, MSG, LOG, UNARMED_STRIKE_ID, ENEMY_CLAW_ID } from "./config.js";
import { registerBuiltinActions } from "./actions.js";
// MSG is still imported for the state.js log filter (MSG.GAME_LOADED).
// All display strings now come from data/locales.json via this.t().

// RPGEngine is the central orchestrator. It owns all subsystems, loads game
// data from JSON, and exposes a thin delegate API so subsystems can call each
// other without importing each other directly (avoiding circular deps).
class RPGEngine {
  constructor() {
    // Populated by loadData(). Kept as an empty shell here so subsystems
    // constructed below can safely reference this.engine.data without null checks.
    this.data = { items: {}, npcs: {}, scenes: {}, missions: {}, regions: {}, worldMapSize: DEFAULT_WORLD_MAP_SIZE, locale: {} };

    this._actionRegistry = new Map();
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
    await this.loadData();
    this.ui.setup();
    // Every state change triggers a full UI update. Subsystems mutate state
    // and the reactive UI re-renders — no manual refresh calls needed.
    gameState.subscribe(() => this.ui.update());
    this.recalculateAC();
    this.ui.update();
    this.renderScene(gameState.getCurrentSceneId());
  }

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
        const loadedData = await Promise.all(keys.map(key => fetch(categoryObj[key]).then(r => r.json())));
        keys.forEach((key, i) => results[key] = loadedData[i]);
        return results;
      };

      const [items, npcs, scenes, missions] = await Promise.all([
        loadCategory(manifest.items),
        loadCategory(manifest.npcs),
        loadCategory(manifest.scenes),
        loadCategory(manifest.missions)
      ]);

      this.data = { items, npcs, scenes, missions, regions: manifest.regions || {}, worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE, locale: this.data.locale };

      // Auto-register flags declared in scene JSON so state.js needs no manual entries
      const sceneFlags = {};
      Object.values(scenes).forEach(scene => {
        (scene.options || []).forEach(opt => {
          if (opt.requiredState && !(opt.requiredState.flag in sceneFlags)) {
            sceneFlags[opt.requiredState.flag] = opt.requiredState.value;
          }
        });
      });
      gameState.registerMissions(missions);
      gameState.registerSceneFlags(sceneFlags);
      this._validateData();
    } catch (e) {
      console.error("Failed to load game data:", e);
      this.log(LOG.SYSTEM, this.t('system.dataError'));
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

  // Recomputes the player's AC from BASE_AC plus all equipped armor bonuses.
  // Called after every equip/unequip and on save load. Uses forceUpdate() only
  // when the value actually changes to avoid unnecessary re-renders.
  recalculateAC() {
    const player = gameState.getPlayer();
    let newAC = BASE_AC;
    for (const slot in player.equipment) {
      const itemId = player.equipment[slot];
      if (itemId && this.data.items[itemId]?.attributes?.armorClassBonus) {
        newAC += this.data.items[itemId].attributes.armorClassBonus;
      }
    }
    if (player.ac !== newAC) {
      player.ac = newAC;
      gameState.forceUpdate();
    }
  }

  // Validates cross-references in game data after load and warns about broken links.
  // Developer tooling only — logs to console, no in-game effect.
  _validateData() {
    const { items, npcs, scenes } = this.data;
    const warn = (msg) => console.warn(`[Gravity] ${msg}`);

    for (const [sceneId, scene] of Object.entries(scenes)) {
      for (const opt of (scene.options || [])) {
        if (opt.destination && !scenes[opt.destination])
          warn(`Scene "${sceneId}": option "${opt.text}" → unknown destination "${opt.destination}"`);
        if (opt.requirements?.item && !items[opt.requirements.item])
          warn(`Scene "${sceneId}": option "${opt.text}" requires unknown item "${opt.requirements.item}"`);
        if (opt.action && !this._actionRegistry.has(opt.action))
          warn(`Scene "${sceneId}": option "${opt.text}" has unknown action "${opt.action}"`);
        if (opt.action === 'loot' && opt.actionDetails?.item && opt.actionDetails.item !== 'gold' && !items[opt.actionDetails.item])
          warn(`Scene "${sceneId}": loot option → unknown item "${opt.actionDetails.item}"`);
        if (opt.action === 'dialogue' && opt.actionDetails?.npc && !npcs[opt.actionDetails.npc])
          warn(`Scene "${sceneId}": dialogue option → unknown NPC "${opt.actionDetails.npc}"`);
        if (opt.action === 'combat' && opt.actionDetails?.enemy && !npcs[opt.actionDetails.enemy])
          warn(`Scene "${sceneId}": combat option → unknown enemy "${opt.actionDetails.enemy}"`);
      }
    }

    for (const [npcId, npc] of Object.entries(npcs)) {
      for (const itemId of (npc.carriedItems || []))
        if (!items[itemId]) warn(`NPC "${npcId}": carriedItems → unknown item "${itemId}"`);
      for (const loot of (npc.droppedLoot || []))
        if (loot.item !== 'gold' && !items[loot.item]) warn(`NPC "${npcId}": droppedLoot → unknown item "${loot.item}"`);
      for (const [slot, itemId] of Object.entries(npc.equipment || {}))
        if (itemId && !items[itemId]) warn(`NPC "${npcId}": equipment[${slot}] → unknown item "${itemId}"`);
    }

    if (!items[UNARMED_STRIKE_ID])
      warn(`Missing required fallback item "${UNARMED_STRIKE_ID}" — add to data/items/ and index.json`);
    if (!items[ENEMY_CLAW_ID])
      warn(`Missing required fallback item "${ENEMY_CLAW_ID}" — add to data/items/ and index.json`);
  }

  // --- Item action methods ---
  // These are called by UIManager buttons. They own the AP-cost check and
  // combat-refresh logic so the UI layer stays free of game logic.

  useItem(itemId) {
    const itemData = this.data.items[itemId];
    if (!itemData) return;

    if (!this._spendAP(itemData.actionPoints || 0)) return;

    if (itemData.attributes?.healingAmount) {
      let amount = itemData.attributes.healingAmount;
      let rollSuffix = "";
      if (typeof amount === 'string') {
        const result = this.combatSystem.parseDamage(amount);
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
  }

  equipItem(slot, itemId) {
    const itemData = this.data.items[itemId];
    const targetSlot = slot || itemData?.slot;
    if (!itemData || !targetSlot) return;

    if (!this._spendAP(itemData.actionPoints || 0)) return;

    gameState.equipItem(targetSlot, itemId);
    this.recalculateAC();
    this.log(LOG.PLAYER, this.t('player.equipped', { name: itemData.name, slot: targetSlot }));
  }

  unequipItem(slot) {
    if (!this._spendAP(UNEQUIP_AP_COST)) return;
    gameState.equipItem(slot, null);
    this.recalculateAC();
    this.log(LOG.PLAYER, this.t('player.unequipped', { slot }));
  }

  // Deducts AP in combat. Returns false (blocking the action) if insufficient.
  // Emits player:apSpent so CombatSystem can refresh the UI and hand off to
  // the enemy if AP hits zero — engine no longer calls combat methods directly.
  _spendAP(cost) {
    if (!this.inCombat) return true;
    const player = gameState.getPlayer();
    if (player.ap < cost) {
      this.log(LOG.SYSTEM, this.t('player.notEnoughAP', { cost }));
      return false;
    }
    gameState.modifyPlayerStat('ap', -cost);
    this.emit('player:apSpent', { remaining: gameState.getPlayer().ap });
    return true;
  }

  // --- Delegate API ---
  // Subsystems (combat, dialogue, quests) call these on `this.engine`.
  // They forward to the appropriate module so subsystems need no knowledge
  // of the internal structure.

  get inCombat() { return this.combatSystem.inCombat; }

  get isGameStart() { return this.narrative.isGameStart; }
  set isGameStart(v) { this.narrative.isGameStart = v; }

  get currentSceneEl() { return this.narrative.currentSceneEl; }
  set currentSceneEl(v) { this.narrative.currentSceneEl = v; }

  openScene(modifier) { return this.narrative.openScene(modifier); }
  log(type, message, variant, persist) { return this.narrative.log(type, message, variant, persist); }
  renderScene(sceneId) { return this.scene.render(sceneId); }
  restoreScene(sceneId, lastDesc) { return this.scene.restoreFromSave(sceneId, lastDesc); }

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
    handlers.forEach(h => h(data));
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
}

window.addEventListener('DOMContentLoaded', () => {
  window.gameEngine = new RPGEngine();
});
