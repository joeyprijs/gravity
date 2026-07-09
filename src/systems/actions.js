import { gameState } from "../core/state.js";
import { LOG, ACTIONS, FLAG_KEYS, GOLD_ITEM_ID } from "../core/config.js";
import { ticksUntilSegment } from "./time.js";

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
  // A good night's sleep can trickle luck back (rules.luck.restRestore,
  // default 0) — the natural counterweight when retries spend luck.
  const luckRestore = engine.data.rules?.luck?.restRestore ?? 0;
  if (luckRestore > 0 && p.resources.luck) {
    gameState.modifyPlayerStat('luck', luckRestore);
  }
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

// --- Time actions ---

// { type: "advance_time", amount: 8 } — advance the clock by a fixed amount.
// { type: "advance_time", until: "morning" } — sleep to the next segment start
// (requires rules.time segments; a missing segment is a warning no-op).
function handleAdvanceTime(action, engine) {
  let amount = action.amount ?? 0;
  if (action.until) {
    const derived = ticksUntilSegment(gameState.getTicks(), engine.data.rules?.time, action.until);
    if (derived === null) {
      console.warn(`[Gravity] advance_time: cannot resolve "until": "${action.until}" — check rules.time.segments`);
      return;
    }
    amount = derived;
  }
  engine.advanceTime(amount);
  if (typeof action.log === 'string') engine.log(LOG.SYSTEM, action.log);
}

// { type: "set_timer", id, afterTicks: 12, actions: [...] } — when the clock
// passes the deadline, the (quiet-only) pipeline runs. atTick sets an
// absolute deadline instead. Re-arming an id replaces the previous timer.
function handleSetTimer(action) {
  if (!action.id) {
    console.warn('[Gravity] set_timer: missing "id" — ignored');
    return;
  }
  const deadline = action.atTick ?? (gameState.getTicks() + (action.afterTicks ?? 0));
  gameState.setTimer({ id: action.id, deadline, actions: action.actions || [] });
}

function handleCancelTimer(action) {
  gameState.cancelTimer(action.id);
}

// --- Luck actions ---

// { type: "restore_luck", amount: 2 } — the mirror of heal for the luck
// resource. Clamped to max; a no-op in games without a luck resource.
function handleRestoreLuck(action, engine) {
  const before = gameState.getPlayer().resources?.luck?.current;
  gameState.modifyPlayerStat('luck', action.amount ?? 1);
  // Log the actual gain, not the requested amount — clamping at max (or a
  // missing luck resource) means nothing was restored, so nothing is said.
  const gained = (gameState.getPlayer().resources?.luck?.current ?? 0) - (before ?? 0);
  if (action.log !== false && gained > 0) {
    const msg = typeof action.log === 'string' ? action.log : engine.t('actions.luckRestored', { amount: gained });
    engine.log(LOG.SYSTEM, msg, 'loot');
  }
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
  engine.registerAction(ACTIONS.ADVANCE_TIME,    handleAdvanceTime);
  engine.registerAction(ACTIONS.SET_TIMER,       handleSetTimer);
  engine.registerAction(ACTIONS.CANCEL_TIMER,    handleCancelTimer);
  engine.registerAction(ACTIONS.RESTORE_LUCK,    handleRestoreLuck);
}
