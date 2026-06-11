import { gameState } from "../core/state.js";
import { LOG, ACTIONS, FLAG_KEYS, GOLD_ITEM_ID } from "../core/config.js";

// Built-in action handlers for the scene option action pipeline.
// Each handler receives (action, engine) — the action object from the pipeline
// (e.g. { type: "loot", item: "sword", amount: 1 }) and the engine reference.
//
// Handlers are responsible only for their side-effect; navigation is a separate
// "navigate" action in the pipeline. Log output can be suppressed or overridden
// by setting action.log = false (silent) or action.log = "custom message".
//
// Register additional actions at runtime: window.gameEngine.registerAction(name, fn)

// action.received distinguishes how the loot reached the player: false/absent
// means it was found (searched, dropped by an enemy), true means it was handed
// over (an NPC gift or reward). It only selects the log message's locale key.
function handleLoot(action, engine) {
  const amount = action.amount ?? 1;
  if (action.item === GOLD_ITEM_ID) {
    gameState.modifyPlayerStat('gold', amount);
    if (action.log !== false) {
      const key = action.received ? 'loot.receivedGold' : 'loot.foundGold';
      const msg = typeof action.log === 'string' ? action.log : engine.t(key, { amount });
      engine.log(LOG.SYSTEM, msg, 'loot');
    }
  } else {
    gameState.addToInventory(action.item, amount);
    if (action.log !== false) {
      const key = action.received ? 'loot.receivedItem' : 'loot.foundItem';
      const msg = typeof action.log === 'string'
        ? action.log
        : engine.t(key, { name: engine.data.items[action.item]?.name || action.item });
      engine.log(LOG.SYSTEM, msg, 'loot');
    }
  }
  if (action.xpReward) {
    gameState.addXP(action.xpReward);
    engine.log(LOG.SYSTEM, engine.t('loot.xpGained', { amount: action.xpReward }), 'loot');
  }
}

function handleCombat(action, engine) {
  const allEnemies = action.enemies || [];
  const enemies = allEnemies.filter(id => !gameState.getFlag(FLAG_KEYS.friendly(id)));
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
}

function handleHeal(action, engine) {
  const amount = action.amount ?? engine.data.rules?.snackHealAmount ?? 2;
  gameState.modifyPlayerStat('hp', amount);
  if (action.log !== false) {
    const msg = typeof action.log === 'string' ? action.log : engine.t('actions.heal', { amount });
    engine.log(LOG.SYSTEM, msg, 'loot');
  }
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

function handleManageChest(action, engine) {
  engine.setCustomUIOpen(true);
  engine.ui.renderChestUI(action.chest);
}

export function registerBuiltinActions(engine) {
  engine.registerAction(ACTIONS.LOOT,            handleLoot);
  engine.registerAction(ACTIONS.COMBAT,          handleCombat);
  engine.registerAction(ACTIONS.DIALOGUE,        handleDialogue);
  engine.registerAction(ACTIONS.RETURN,          handleReturn);
  engine.registerAction(ACTIONS.FULL_REST,       handleFullRest);
  engine.registerAction(ACTIONS.HEAL,            handleHeal);
  engine.registerAction(ACTIONS.NAVIGATE,        handleNavigate);
  engine.registerAction(ACTIONS.SET_FLAG,        handleSetFlag);
  engine.registerAction(ACTIONS.LOG,             handleLog);
  engine.registerAction(ACTIONS.MANAGE_CHEST,    handleManageChest);
}
