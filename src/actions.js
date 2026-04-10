import { gameState } from "./state.js";
import { REST_HEAL_AMOUNT, SNACK_HEAL_AMOUNT, RETURN_WORLD_FALLBACK_SCENE, LOG, ACTIONS } from "./config.js";

// Built-in action handlers for scene option buttons.
// Each handler receives (opt, engine) — the full option object from scene JSON
// and the engine reference, giving access to all subsystems and APIs.
// Register additional actions at runtime: window.gameEngine.registerAction(name, fn)

function handleLoot(opt, engine) {
  const param = opt.actionDetails || {};
  gameState.addToInventory(param.item, param.amount || 1);
  engine.log(LOG.SYSTEM, engine.t('loot.receivedItem', { name: engine.data.items[param.item]?.name || param.item }), 'loot');
  if (param.xpReward) {
    gameState.addXP(param.xpReward);
    engine.log(LOG.SYSTEM, engine.t('loot.xpGained', { amount: param.xpReward }), 'loot');
  }
  if (param.hideAfter && opt.requiredState) {
    gameState.setFlag(opt.requiredState.flag, !opt.requiredState.value);
  }
  engine.renderScene(opt.destination || gameState.getCurrentSceneId());
}

function handleCombat(opt, engine) {
  const enemies = opt.actionDetails?.enemies
    || (opt.actionDetails?.enemy ? [opt.actionDetails.enemy] : []);
  engine.combatSystem.startCombat(enemies, opt);
}

function handleDialogue(opt, engine) {
  engine.dialogueSystem.startDialogue(opt.actionDetails?.npc);
}

function handleRest(opt, engine) {
  gameState.modifyPlayerStat('hp', opt.actionDetails?.heal || REST_HEAL_AMOUNT);
  engine.log(LOG.SYSTEM, engine.t('actions.rested'));
  if (opt.actionDetails?.hideAfter && opt.requiredState) {
    gameState.setFlag(opt.requiredState.flag, !opt.requiredState.value);
  }
  engine.renderScene(opt.destination || gameState.getCurrentSceneId());
}

function handleReturnToWorld(opt, engine) {
  engine.renderScene(gameState.getReturnSceneId() || RETURN_WORLD_FALLBACK_SCENE);
}

function handleFullRest(opt, engine) {
  const p = gameState.getPlayer();
  gameState.modifyPlayerStat('hp', p.maxHp - p.hp);
  gameState.modifyPlayerStat('ap', p.maxAp - p.ap);
  engine.log(LOG.SYSTEM, engine.t('actions.fullRest'));
  if (opt.destination) engine.renderScene(opt.destination);
}

function handleEatSnack(opt, engine) {
  gameState.modifyPlayerStat('hp', SNACK_HEAL_AMOUNT);
  engine.log(LOG.SYSTEM, engine.t('actions.eatSnack', { amount: SNACK_HEAL_AMOUNT }), 'loot');
  if (opt.destination) engine.renderScene(opt.destination);
}

function handleManageChest(opt, engine) {
  engine.ui.renderMuseumChestUI();
}

export function registerBuiltinActions(engine) {
  engine.registerAction(ACTIONS.LOOT,            handleLoot);
  engine.registerAction(ACTIONS.COMBAT,          handleCombat);
  engine.registerAction(ACTIONS.DIALOGUE,        handleDialogue);
  engine.registerAction(ACTIONS.REST,            handleRest);
  engine.registerAction(ACTIONS.RETURN_TO_WORLD, handleReturnToWorld);
  engine.registerAction(ACTIONS.FULL_REST,       handleFullRest);
  engine.registerAction(ACTIONS.EAT_SNACK,       handleEatSnack);
  engine.registerAction(ACTIONS.MANAGE_CHEST,    handleManageChest);
}
