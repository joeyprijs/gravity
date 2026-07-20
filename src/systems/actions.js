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
    engine.state.modifyPlayerStat('gold', amount);
    if (action.log !== false) {
      const key = action.received ? 'loot.receivedGold' : 'loot.foundGold';
      const msg = typeof action.log === 'string' ? action.log : engine.t(key, { amount });
      engine.log(LOG.SYSTEM, msg, 'loot');
    }
  } else {
    engine.state.addToInventory(action.item, amount);
    if (action.log !== false) {
      const key = action.received ? 'loot.receivedItem' : 'loot.foundItem';
      const msg = typeof action.log === 'string'
        ? action.log
        : engine.t(key, { name: engine.data.items[action.item]?.name || action.item });
      engine.log(LOG.SYSTEM, msg, 'loot');
    }
  }
  if (action.xpReward) {
    engine.state.addXP(action.xpReward);
    engine.log(LOG.SYSTEM, engine.t('loot.xpGained', { amount: action.xpReward }), 'loot');
  }
}

function handleCombat(action, engine) {
  const allEnemies = action.enemies || [];
  const enemies = allEnemies.filter(id => !engine.state.getFlag(FLAG_KEYS.friendly(id)));
  if (enemies.length === 0) {
    engine.log(LOG.SYSTEM, engine.t('combat.avoided'), 'system');
    return;
  }
  // The action's onVictory pipeline (if any) runs on the win — the whole
  // action is passed through as originOption for endCombat to read it from.
  engine.combatSystem.startCombat(enemies, action);
}

function handleDialogue(action, engine) {
  engine.dialogueSystem.startDialogue(action.npc);
}

function handleReturn(_action, engine) {
  const fallback = engine.data.rules?.startingScene || null;
  engine.renderScene(engine.state.getReturnSceneId() || fallback);
}

function handleFullRest(action, engine) {
  engine.state.modifyPlayerStat('hp', 'full');
  // A night's rest also refills the retry currency (rules.skillRetry.restRestore,
  // clamped to max) — the cozy counterweight to spending do-overs while out.
  const retry = engine.data.rules?.skillRetry;
  if (retry?.resource && retry.restRestore > 0) {
    engine.state.modifyPlayerStat(retry.resource, retry.restRestore);
  }
  if (action.log !== false) {
    const msg = typeof action.log === 'string' ? action.log : engine.t('actions.fullRest');
    engine.log(LOG.SYSTEM, msg);
  }
}

// Clamped delta for a { current, max } resource: 'full' (or omitted) tops it
// up; a number moves it within [0, max]. Returns the amount actually applied.
function resourceDelta(res, amount) {
  return amount === undefined || amount === 'full'
    ? res.max - res.current
    : Math.max(Math.min(amount, res.max - res.current), -res.current);
}

// Moves any declared { current, max } resource in either direction —
// { type: "modify_resource", resource: "luckPoints", amount: 1 }, negative
// drains, "full" (also the default) tops it up. The authoring valve for
// custom currencies (Luck Points, favor, ...).
function handleModifyResource(action, engine) {
  const res = engine.state.getPlayer().resources[action.resource];
  if (!res || typeof res !== 'object') {
    console.warn(`[Gravity] modify_resource: "${action.resource}" is not a declared { current, max } resource — skipped`);
    return;
  }
  const amount = resourceDelta(res, action.amount);
  if (amount === 0) return;
  engine.state.modifyPlayerStat(action.resource, amount);
  if (action.log !== false) {
    const labelKey = `ui.resources.${action.resource}`;
    const label = engine.t(labelKey) !== labelKey ? engine.t(labelKey) : action.resource;
    const msg = typeof action.log === 'string'
      ? action.log
      : engine.t(amount < 0 ? 'actions.resourceLoss' : 'actions.resourceGain', { amount: Math.abs(amount), resource: label });
    engine.log(LOG.SYSTEM, msg, amount < 0 ? 'system' : 'loot');
  }
}

function handleHeal(action, engine) {
  const amount = action.amount ?? engine.data.rules?.snackHealAmount ?? 2;
  engine.state.modifyPlayerStat('hp', amount);
  if (action.log !== false) {
    const msg = typeof action.log === 'string' ? action.log : engine.t('actions.heal', { amount });
    engine.log(LOG.SYSTEM, msg, 'loot');
  }
}

// ── Pipeline utility actions ──────────────────────────────────────────────

function handleNavigate(action, engine) {
  engine.renderScene(action.destination);
}

function handleSetFlag(action, engine) {
  engine.state.setFlag(action.flag, action.value);
}

function handleLog(action, engine) {
  engine.log(LOG.SYSTEM, action.message || '');
}

function handleManageChest(action, engine) {
  engine.setCustomUIOpen(true);
  engine.ui.renderChestUI(action.chest);
}

// ── Time actions ──────────────────────────────────────────────────────────

// { type: "advance_time", amount: 8 } — advance the clock by a fixed amount.
// { type: "advance_time", until: "morning" } — sleep to the next segment start
// (requires rules.time segments; a missing segment is a warning no-op).
function handleAdvanceTime(action, engine) {
  let amount = action.amount ?? 0;
  if (action.until) {
    const derived = ticksUntilSegment(engine.state.getTicks(), engine.data.rules?.time, action.until);
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
function handleSetTimer(action, engine) {
  if (!action.id) {
    console.warn('[Gravity] set_timer: missing "id" — ignored');
    return;
  }
  const deadline = action.atTick ?? (engine.state.getTicks() + (action.afterTicks ?? 0));
  engine.state.setTimer({ id: action.id, deadline, actions: action.actions || [] });
}

function handleCancelTimer(action, engine) {
  engine.state.cancelTimer(action.id);
}

export function registerBuiltinActions(engine) {
  engine.registerAction(ACTIONS.LOOT,            handleLoot);
  engine.registerAction(ACTIONS.COMBAT,          handleCombat);
  engine.registerAction(ACTIONS.DIALOGUE,        handleDialogue);
  engine.registerAction(ACTIONS.RETURN,          handleReturn);
  engine.registerAction(ACTIONS.FULL_REST,       handleFullRest);
  engine.registerAction(ACTIONS.HEAL,            handleHeal);
  engine.registerAction(ACTIONS.MODIFY_RESOURCE, handleModifyResource);
  engine.registerAction(ACTIONS.NAVIGATE,        handleNavigate);
  engine.registerAction(ACTIONS.SET_FLAG,        handleSetFlag);
  engine.registerAction(ACTIONS.LOG,             handleLog);
  engine.registerAction(ACTIONS.MANAGE_CHEST,    handleManageChest);
  engine.registerAction(ACTIONS.ADVANCE_TIME,    handleAdvanceTime);
  engine.registerAction(ACTIONS.SET_TIMER,       handleSetTimer);
  engine.registerAction(ACTIONS.CANCEL_TIMER,    handleCancelTimer);
}
