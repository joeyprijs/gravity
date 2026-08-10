import { LOG, ACTIONS, GOLD_ITEM_ID } from "../core/config.js";
import { parseDamage } from "./dice.js";
import { ticksUntilSegment } from "./time.js";

// Built-in action handlers for the scene option action pipeline.
// Each handler receives (action, engine) — the action object from the pipeline
// (e.g. { type: "loot", item: "sword", amount: 1 }) and the engine reference.
//
// Handlers are responsible only for their side-effect; navigation is a separate
// "navigate" action in the pipeline. Log output can be suppressed or overridden
// by setting action.log = false (silent) or action.log = "custom message".
// Override strings resolve through engine.t(), so a locale key keeps the prose
// translatable; a string that isn't a key logs as-is (the one-off allowance).
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
      const msg = typeof action.log === 'string' ? engine.t(action.log) : engine.t(key, { amount });
      engine.log(LOG.SYSTEM, msg, 'loot');
    }
  } else {
    engine.state.addToInventory(action.item, amount);
    if (action.log !== false) {
      const key = action.received ? 'loot.receivedItem' : 'loot.foundItem';
      const msg = typeof action.log === 'string'
        ? engine.t(action.log)
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
  // The action's onVictory pipeline (if any) runs on the win — the whole
  // action is passed through as originOption for endCombat to read it from.
  engine.combatSystem.startCombat(action.enemies || [], action);
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
  // And the short-rest pool, D&D-style: short rests spend it out in the
  // world, only a full rest brings it back (see handleShortRest).
  const shortRest = engine.data.rules?.shortRest;
  if (shortRest?.resource) engine.state.modifyPlayerStat(shortRest.resource, 'full');
  // Rest-limited item uses (attributes.uses) all come back with a night's
  // sleep, whichever rest they refresh on.
  engine.state.refreshItemUses('full_rest');
  if (action.log !== false) {
    // A string override is authored prose — the world's answer, narrated. The
    // default is the act's yield, amended onto the [Player] option line that
    // ran this pipeline (see STYLE.md, the narrative log's two voices).
    if (typeof action.log === 'string') engine.log(LOG.SYSTEM, engine.t(action.log));
    else {
      const yieldLine = engine.t('actions.fullRest');
      if (!engine.amendLog(yieldLine)) engine.log(LOG.PLAYER, yieldLine, 'choice');
    }
  }
}

// { type: "short_rest" } — one draw on the short-rest pool: heals
// rules.shortRest.heal (dice notation or a flat number) and spends one use of
// rules.shortRest.resource. The pool only refills on a full rest (see
// handleFullRest), so each draw spends something real — the D&D Hit Dice
// rhythm. Where resting is on offer is the scene author's call: a scene
// option built on this action renders with the pool's state as its stat
// lines and disables at an empty pool, and the guard here mirrors that for
// pipelines that slip past.
function handleShortRest(action, engine) {
  const config = engine.data.rules?.shortRest;
  if (!config?.resource) {
    console.warn('[Gravity] short_rest: no rules.shortRest.resource configured — skipped');
    return;
  }
  const pool = engine.state.getPlayer().resources?.[config.resource];
  if (!(pool && typeof pool === 'object' && 'current' in pool)) {
    console.warn(`[Gravity] short_rest: "${config.resource}" is not a declared { current, max } resource — skipped`);
    return;
  }
  if (pool.current < 1) {
    engine.log(LOG.SYSTEM, engine.t('actions.shortRestExhausted'));
    return;
  }

  let amount = config.heal ?? 1;
  let rollSuffix = '';
  if (typeof amount === 'string') {
    const result = parseDamage(amount);
    rollSuffix = engine.t('player.rollSuffix', { dice: amount, roll: result.string });
    amount = result.total;
  }
  engine.state.modifyPlayerStat('hp', amount);
  engine.state.modifyPlayerStat(config.resource, -1);
  // A breather also brings back the item uses that refresh on a short rest.
  engine.state.refreshItemUses('short_rest');

  if (action.log !== false) {
    // Same split as full_rest: authored prose narrates; the default yield
    // amends the act's line, roll and all: "Short Rest (+6 HP, 1d8: 6)".
    if (typeof action.log === 'string') engine.log(LOG.SYSTEM, engine.t(action.log));
    else {
      const yieldLine = engine.t('actions.heal', { amount: `+${amount}`, rollSuffix });
      if (!engine.amendLog(yieldLine)) engine.log(LOG.PLAYER, yieldLine, 'choice');
    }
  }
}

function handleHeal(action, engine) {
  const amount = action.amount ?? engine.data.rules?.snackHealAmount ?? 2;
  engine.state.modifyPlayerStat('hp', amount);
  if (action.log !== false) {
    // Same split as full_rest: authored prose narrates, the default yield
    // amends the act's line. Signed so a harmful heal reads "(-2 HP)".
    if (typeof action.log === 'string') engine.log(LOG.SYSTEM, engine.t(action.log), 'loot');
    else {
      const yieldLine = engine.t('actions.heal', { amount: amount >= 0 ? `+${amount}` : `${amount}`, rollSuffix: '' });
      if (!engine.amendLog(yieldLine)) engine.log(LOG.PLAYER, yieldLine, 'choice');
    }
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
  engine.log(LOG.SYSTEM, action.message ? engine.t(action.message) : '');
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
  if (typeof action.log === 'string') engine.log(LOG.SYSTEM, engine.t(action.log));
}

// { type: "set_timer", id, afterTicks: 12, actions: [...] } — when the clock
// passes the deadline, the (quiet-only) pipeline runs. Re-arming an id
// replaces the previous timer.
function handleSetTimer(action, engine) {
  if (!action.id) {
    console.warn('[Gravity] set_timer: missing "id" — ignored');
    return;
  }
  const deadline = engine.state.getTicks() + (action.afterTicks ?? 0);
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
  engine.registerAction(ACTIONS.SHORT_REST,      handleShortRest);
  engine.registerAction(ACTIONS.HEAL,            handleHeal);
  engine.registerAction(ACTIONS.NAVIGATE,        handleNavigate);
  engine.registerAction(ACTIONS.SET_FLAG,        handleSetFlag);
  engine.registerAction(ACTIONS.LOG,             handleLog);
  engine.registerAction(ACTIONS.MANAGE_CHEST,    handleManageChest);
  engine.registerAction(ACTIONS.ADVANCE_TIME,    handleAdvanceTime);
  engine.registerAction(ACTIONS.SET_TIMER,       handleSetTimer);
  engine.registerAction(ACTIONS.CANCEL_TIMER,    handleCancelTimer);
}
