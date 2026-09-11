import { LOG, GOLD_ITEM_ID } from '../core/config.js';
import { formatSigned, isResourcePool } from '../core/utils.js';
import { rollAmount } from './items.js';
import { ticksUntilSegment } from './time.js';

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
  const isGold = action.item === GOLD_ITEM_ID;
  if (isGold) engine.state.modifyPlayerStat('gold', amount);
  else engine.state.addToInventory(action.item, amount);

  if (action.log !== false) {
    const key = isGold
      ? (action.received ? 'loot.receivedGold' : 'loot.foundGold')
      : (action.received ? 'loot.receivedItem' : 'loot.foundItem');
    const msg = typeof action.log === 'string'
      ? engine.t(action.log)
      : engine.t(key, { amount, name: engine.data.items[action.item]?.name || action.item });
    engine.log(LOG.SYSTEM, msg, 'loot');
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

// The log tail shared by the restorative actions. A string override is
// authored prose — the world's answer, narrated. The default is the act's
// yield, amended onto the [Player] option line that ran this pipeline (see
// STYLE.md, the narrative log's two voices).
function logYield(engine, action, yieldLine, overrideVariant = 'system') {
  if (action.log === false) return;
  if (typeof action.log === 'string') engine.log(LOG.SYSTEM, engine.t(action.log), overrideVariant);
  else if (!engine.amendLog(yieldLine)) engine.log(LOG.PLAYER, yieldLine, 'choice');
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
  logYield(engine, action, engine.t('actions.fullRest'));
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
  if (!isResourcePool(pool)) {
    console.warn(`[Gravity] short_rest: "${config.resource}" is not a declared { current, max } resource — skipped`);
    return;
  }
  if (pool.current < 1) {
    engine.log(LOG.SYSTEM, engine.t('actions.shortRestExhausted'));
    return;
  }

  const { amount, rollSuffix } = rollAmount(engine, config.heal ?? 1);
  engine.state.modifyPlayerStat('hp', amount);
  engine.state.modifyPlayerStat(config.resource, -1);
  // A breather also brings back the item uses that refresh on a short rest.
  engine.state.refreshItemUses('short_rest');
  // The yield carries the roll: "Short Rest (+6 HP, 1d8: 6)".
  logYield(engine, action, engine.t('actions.heal', { amount: `+${amount}`, rollSuffix }));
}

function handleHeal(action, engine) {
  const amount = action.amount ?? engine.data.rules?.snackHealAmount ?? 2;
  engine.state.modifyPlayerStat('hp', amount);
  // Signed so a harmful heal reads "(-2 HP)".
  logYield(engine, action, engine.t('actions.heal', { amount: formatSigned(amount), rollSuffix: '' }), 'loot');
}

// Pipeline utility actions

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

// { type: "grant_chapter", item: "gertas_story", chapter: "the_dance" } — record
// that the player heard one chapter of the story a book item retells. Granted
// state is written here, at listen time, never derived from anything else.
// The first chapter writes the book: the item lands in the pack the moment
// there is something to put in it. Re-granting is a silent no-op — hearing a
// chapter twice is not an event, so a re-listen never duplicates the log line.
// Omitting `chapter` grants every chapter at once — a book FOUND in the world
// arrives already written, so its default line is the find, not the writing.
function handleGrantChapter(action, engine) {
  const itemData = engine.data.items[action.item];
  const chapters = itemData?.story?.chapters ?? [];
  const wanted = action.chapter === undefined
    ? chapters.map(ch => ch.id)
    : chapters.some(ch => ch.id === action.chapter) ? [action.chapter] : [];
  if (!wanted.length) {
    console.warn(action.chapter === undefined
      ? `[Gravity] grant_chapter: "${action.item}" declares no story — ignored`
      : `[Gravity] grant_chapter: "${action.item}" has no story chapter "${action.chapter}" — ignored`);
    return;
  }
  if (!wanted.filter(id => engine.state.grantStoryChapter(action.item, id)).length) return;
  const owned = engine.state.countPlayerItem(action.item) > 0;
  if (!owned) engine.state.addToInventory(action.item, 1);
  if (action.log !== false) {
    const defaultKey = owned ? 'story.chapterWritten'
      : action.chapter === undefined ? 'story.bookFound' : 'story.bookStarted';
    const msg = typeof action.log === 'string'
      ? engine.t(action.log)
      : engine.t(defaultKey, { name: itemData.name });
    engine.log(LOG.SYSTEM, msg, 'loot');
  }
}

// Time actions

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
  engine.registerAction('loot', handleLoot);
  engine.registerAction('combat', handleCombat);
  engine.registerAction('dialogue', handleDialogue);
  engine.registerAction('return', handleReturn);
  engine.registerAction('full_rest', handleFullRest);
  engine.registerAction('short_rest', handleShortRest);
  engine.registerAction('heal', handleHeal);
  engine.registerAction('navigate', handleNavigate);
  engine.registerAction('set_flag', handleSetFlag);
  engine.registerAction('log', handleLog);
  engine.registerAction('manage_chest', handleManageChest);
  engine.registerAction('grant_chapter', handleGrantChapter);
  engine.registerAction('advance_time', handleAdvanceTime);
  engine.registerAction('set_timer', handleSetTimer);
  engine.registerAction('cancel_timer', handleCancelTimer);
}
