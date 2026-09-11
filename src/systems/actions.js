import { LOG, GOLD_ITEM_ID } from '../core/config.js';
import { formatSigned, isResourcePool } from '../core/utils.js';
import { rollAmount } from './items.js';
import { ticksUntilSegment } from './time.js';

// The built-in action handlers, each (action, engine). A handler owns one side
// effect; navigation is its own action. action.log = false silences the
// default line, a string replaces it (a locale key, or prose as-is).

// action.received picks the "handed over" line over the "found" one.
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
  // endCombat reads the onVictory pipeline off the action.
  engine.combatSystem.startCombat(action.enemies || [], action);
}

function handleDialogue(action, engine) {
  engine.dialogueSystem.startDialogue(action.npc);
}

function handleReturn(_action, engine) {
  const fallback = engine.data.rules?.startingScene || null;
  engine.renderScene(engine.state.getReturnSceneId() || fallback);
}

// A string override is the world's answer; the default yield is amended onto
// the [Player] line that ran the pipeline (STYLE.md, the two voices).
function logYield(engine, action, yieldLine, overrideVariant = 'system') {
  if (action.log === false) return;
  if (typeof action.log === 'string') engine.log(LOG.SYSTEM, engine.t(action.log), overrideVariant);
  else if (!engine.amendLog(yieldLine)) engine.log(LOG.PLAYER, yieldLine, 'choice');
}

function handleFullRest(action, engine) {
  engine.state.modifyPlayerStat('hp', 'full');
  // A night also refills the retry currency (rules.skillRetry.restRestore).
  const retry = engine.data.rules?.skillRetry;
  if (retry?.resource && retry.restRestore > 0) {
    engine.state.modifyPlayerStat(retry.resource, retry.restRestore);
  }
  // And the short-rest pool, which only a full rest brings back.
  const shortRest = engine.data.rules?.shortRest;
  if (shortRest?.resource) engine.state.modifyPlayerStat(shortRest.resource, 'full');
  // And every rest-limited item use, whichever rest it refreshes on.
  engine.state.refreshItemUses('full_rest');
  logYield(engine, action, engine.t('actions.fullRest'));
}

// One draw on the short-rest pool: heals rules.shortRest.heal and spends one
// use of rules.shortRest.resource, which only a full rest refills. The scene
// option disables at an empty pool; the guard here covers pipelines that slip past.
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
  engine.state.refreshItemUses('short_rest');
  logYield(engine, action, engine.t('actions.heal', { amount: `+${amount}`, rollSuffix }));
}

function handleHeal(action, engine) {
  const amount = action.amount ?? engine.data.rules?.snackHealAmount ?? 2;
  engine.state.modifyPlayerStat('hp', amount);
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

// Records a heard chapter of a story book; the first chapter puts the book in
// the pack. Re-granting is a silent no-op. Without `chapter` every chapter is
// granted at once: a book found in the world arrives written, and logs as a find.
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

// `amount` ticks, or `until` the next start of a segment (a warning no-op
// for an unknown one).
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

// { id, afterTicks, actions }: the quiet-only pipeline runs when the clock
// passes the deadline. Re-arming an id replaces the timer.
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
