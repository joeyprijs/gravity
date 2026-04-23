import { gameState } from "../core/state.js";
import { LOG, ACTIONS, CSS } from "../core/config.js";

// Built-in action handlers for the scene option action pipeline.
// Each handler receives (action, engine) — the action object from the pipeline
// (e.g. { type: "loot", item: "sword", amount: 1 }) and the engine reference.
//
// Handlers are responsible only for their side-effect; navigation is a separate
// "navigate" action in the pipeline. Log output can be suppressed or overridden
// by setting action.log = false (silent) or action.log = "custom message".
//
// Register additional actions at runtime: window.gameEngine.registerAction(name, fn)

function handleLoot(action, engine) {
  gameState.addToInventory(action.item, action.amount || 1);
  if (action.log !== false) {
    const msg = typeof action.log === 'string'
      ? action.log
      : engine.t('loot.receivedItem', { name: engine.data.items[action.item]?.name || action.item });
    engine.log(LOG.SYSTEM, msg, 'loot');
  }
  if (action.xpReward) {
    gameState.addXP(action.xpReward);
    engine.log(LOG.SYSTEM, engine.t('loot.xpGained', { amount: action.xpReward }), 'loot');
  }
}

function handleCombat(action, engine) {
  const allEnemies = action.enemies || (action.enemy ? [action.enemy] : []);
  const enemies = allEnemies.filter(id => !gameState.getFlag(`friendly_${id}`));
  if (enemies.length === 0) {
    engine.log(LOG.SYSTEM, engine.t('combat.avoided'), 'system');
    return;
  }
  // action carries optional on-victory .setFlag and .destination for endCombat
  engine.combatSystem.startCombat(enemies, action);
}

function handleDialogue(action, engine) {
  engine.dialogueSystem.startDialogue(action.npc);
}

function handleReturn(_action, engine) {
  const fallback = engine.data.rules?.startingScene || null;
  engine.renderScene(gameState.getReturnSceneId() || fallback);
}

function handleFullRest(action, engine) {
  const p = gameState.getPlayer();
  gameState.modifyPlayerStat('hp', p.resources.hp.max - p.resources.hp.current);
  gameState.modifyPlayerStat('ap', p.resources.ap.max - p.resources.ap.current);
  if (action.log !== false) {
    const msg = typeof action.log === 'string' ? action.log : engine.t('actions.fullRest');
    engine.log(LOG.SYSTEM, msg);
  }
  if (action.destination) engine.renderScene(action.destination);
}

function handleHeal(action, engine) {
  const amount = action.amount ?? engine.data.rules?.snackHealAmount ?? 2;
  gameState.modifyPlayerStat('hp', amount);
  if (action.log !== false) {
    const msg = typeof action.log === 'string' ? action.log : engine.t('actions.heal', { amount });
    engine.log(LOG.SYSTEM, msg, 'loot');
  }
}

function handleManageChest(_action, engine) {
  engine.ui.renderMuseumChestUI();
}

// --- Pipeline utility actions ---

function handleNavigate(action, engine) {
  engine.renderScene(action.destination);
}

function handleSetFlag(action) {
  gameState.setFlag(action.flag, action.value);
}

function handleLog(action, engine) {
  engine.log(LOG.SYSTEM, action.message || '');
}

// --- Description hook ---

function museumChestContentsHook(engine) {
  const chest = gameState.getMuseumChest();
  if (chest && chest.length > 0) {
    const nameList = chest.map(b => {
      const name = engine.data.items[b.item]?.name || b.item;
      return b.amount > 1 ? `${name} (x${b.amount})` : name;
    }).join(", ");
    const names = `<span class="${CSS.MUSEUM_ITEM_LIST}">${nameList}</span>`;
    return `<br><br>${engine.t('actions.museumDisplayedWithin', { names })}`;
  }
  return `<br><br>${engine.t('actions.museumRoomEmpty')}`;
}

export function registerBuiltinActions(engine) {
  engine.registerAction(ACTIONS.LOOT,            handleLoot);
  engine.registerAction(ACTIONS.COMBAT,          handleCombat);
  engine.registerAction(ACTIONS.DIALOGUE,        handleDialogue);
  engine.registerAction(ACTIONS.RETURN,          handleReturn);
  engine.registerAction(ACTIONS.FULL_REST,       handleFullRest);
  engine.registerAction(ACTIONS.HEAL,            handleHeal);
  engine.registerAction(ACTIONS.MANAGE_CHEST,    handleManageChest);
  engine.registerAction(ACTIONS.NAVIGATE,        handleNavigate);
  engine.registerAction(ACTIONS.SET_FLAG,        handleSetFlag);
  engine.registerAction(ACTIONS.LOG,             handleLog);
  engine.registerDescriptionHook('museumChestContents', museumChestContentsHook);
}
