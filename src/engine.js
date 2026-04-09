import { gameState } from "./state.js";
import { CombatSystem } from "./combat.js";
import { DialogueSystem } from "./dialogue.js";
import { QuestSystem } from "./quests.js";
import { NarrativeLog } from "./narrative.js";
import { UIManager } from "./ui.js";
import { SceneRenderer } from "./scene.js";
import { BASE_AC, UNEQUIP_AP_COST, DEFAULT_WORLD_MAP_SIZE, MSG } from "./config.js";

// RPGEngine is the central orchestrator. It owns all subsystems, loads game
// data from JSON, and exposes a thin delegate API so subsystems can call each
// other without importing each other directly (avoiding circular deps).
class RPGEngine {
  constructor() {
    // Populated by loadData(). Kept as an empty shell here so subsystems
    // constructed below can safely reference this.engine.data without null checks.
    this.data = { items: {}, npcs: {}, scenes: {}, missions: {}, regions: {}, worldMapSize: DEFAULT_WORLD_MAP_SIZE };

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

      this.data = { items, npcs, scenes, missions, regions: manifest.regions || {}, worldMapSize: manifest.worldMapSize || DEFAULT_WORLD_MAP_SIZE };

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
    } catch (e) {
      console.error("Failed to load game data:", e);
      this.log("System", MSG.GAME_DATA_ERROR);
    }
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

  // --- Item action methods ---
  // These are called by UIManager buttons. They own the AP-cost check and
  // combat-refresh logic so the UI layer stays free of game logic.

  useItem(itemId) {
    const itemData = this.data.items[itemId];
    if (!itemData) return;

    if (!this._spendAP(itemData.actionPoints || 0)) return;

    if (itemData.attributes?.healingAmount) {
      let amount = itemData.attributes.healingAmount;
      let rollStr = "";
      if (typeof amount === 'string') {
        const result = this.combatSystem.parseDamage(amount);
        amount = result.total;
        rollStr = `(Roll: ${result.string})`;
      }
      gameState.modifyPlayerStat('hp', amount);
      this.log("System", `You used ${itemData.name} and recovered ${amount} HP. ${rollStr}`, 'loot');
      gameState.removeFromInventory(itemId, 1);
    } else if (itemData.attributes?.teleportScene) {
      if (this.combatSystem.inCombat) {
        this.log("System", "Cannot use teleport items during combat!");
        return;
      }
      const curScene = gameState.getCurrentSceneId();
      if (curScene !== itemData.attributes.teleportScene) {
        gameState.setReturnSceneId(curScene);
        this.log("System", `You gripped the ${itemData.name} and vanished into thin air...`);
        this.renderScene(itemData.attributes.teleportScene);
      } else {
        this.log("System", "You are already here.");
      }
    }

    this._refreshCombatIfActive();
  }

  equipItem(slot, itemId) {
    const itemData = this.data.items[itemId];
    const targetSlot = slot || itemData?.slot;
    if (!itemData || !targetSlot) return;

    if (!this._spendAP(itemData.actionPoints || 0)) return;

    gameState.equipItem(targetSlot, itemId);
    this.recalculateAC();
    this.log("player", `Equipped ${itemData.name} to ${targetSlot}.`);
    this._refreshCombatIfActive();
  }

  unequipItem(slot) {
    if (!this._spendAP(UNEQUIP_AP_COST)) return;
    gameState.equipItem(slot, null);
    this.recalculateAC();
    this.log("player", `Unequipped item from ${slot}.`);
    this._refreshCombatIfActive();
  }

  // Deducts AP in combat. Returns false (blocking the action) if insufficient.
  _spendAP(cost) {
    if (!this.combatSystem.inCombat) return true;
    const player = gameState.getPlayer();
    if (player.ap < cost) {
      this.log("System", `Not enough AP! Need ${cost}.`);
      return false;
    }
    gameState.modifyPlayerStat('ap', -cost);
    return true;
  }

  // After spending AP in combat, refresh the combat UI and hand off to the
  // enemy if the player has run out of actions.
  _refreshCombatIfActive() {
    if (!this.combatSystem.inCombat) return;
    this.combatSystem.renderCombatUI();
    if (gameState.getPlayer().ap <= 0) this.combatSystem.enemyTurn();
  }

  // --- Delegate API ---
  // Subsystems (combat, dialogue, quests) call these on `this.engine`.
  // They forward to the appropriate module so subsystems need no knowledge
  // of the internal structure.

  get isGameStart() { return this.narrative.isGameStart; }
  set isGameStart(v) { this.narrative.isGameStart = v; }

  get currentSceneEl() { return this.narrative.currentSceneEl; }
  set currentSceneEl(v) { this.narrative.currentSceneEl = v; }

  openScene(modifier) { return this.narrative.openScene(modifier); }
  log(type, message, variant, persist) { return this.narrative.log(type, message, variant, persist); }
  renderScene(sceneId) { return this.scene.render(sceneId); }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gameEngine = new RPGEngine();
});
