import { MAX_D20_ROLL, LOG } from '../core/config.js';
import { attributeLabel, formatSigned } from '../core/utils.js';
import { roll } from './dice.js';

// A roll beating the DC by the critical margin is a critical; one missing it
// by up to the partial margin is a partial. Both tiers exist only when authored.
const DEFAULT_CRITICAL_MARGIN = 5;
const DEFAULT_PARTIAL_MARGIN = 3;

const TIER_LOG_KEYS = {
  critical: 'actions.skillCritical',
  success:  'actions.skillSuccess',
  partial:  'actions.skillPartial',
  failure:  'actions.skillFail',
};

// "1d20: 17 + 1 Perception", or "1d20: 17" at a zero modifier.
export function rollBreakdown(base, mod, label) {
  if (!mod) return `1d20: ${base}`;
  return `1d20: ${base} ${mod < 0 ? '-' : '+'} ${Math.abs(mod)} ${label}`;
}

// attributeLabel bound to the engine.
export function skillLabel(engine, skillId) {
  return attributeLabel(engine.t, skillId);
}

// Authored text as a string, or an array walked per use so repeats escalate,
// clamped to the last entry. Behind retryText, tier text, and resultText.
export function pickVariant(text, n) {
  if (!Array.isArray(text)) return text;
  return text[Math.min(n, text.length - 1)];
}

// After the first attempt, retryText takes over from text.
export function resolveRetryText(opt, attempts) {
  if (!attempts || !opt.retryText) return opt.text;
  return pickVariant(opt.retryText, attempts - 1);
}

// The tier table from either authoring shape: the legacy actions/onFailure
// pair or the outcomes object, which wins where both define a tier. Entries
// are { margin?, text?, actions }; critical and partial only when authored.
export function normalizeOutcomes(check) {
  const o = check.outcomes || {};
  const successActions = o.success?.actions ?? check.actions ?? [];
  const normalized = {
    success: { text: o.success?.text, actions: successActions },
    failure: { text: o.failure?.text, actions: o.failure?.actions ?? check.onFailure ?? [] },
  };
  if (o.critical) {
    normalized.critical = {
      margin: o.critical.margin ?? DEFAULT_CRITICAL_MARGIN,
      text: o.critical.text,
      // The best roll must never do less than a plain success.
      actions: o.critical.actions?.length ? o.critical.actions : successActions,
    };
  }
  if (o.partial) {
    normalized.partial = {
      margin: o.partial.margin ?? DEFAULT_PARTIAL_MARGIN,
      text: o.partial.text,
      actions: o.partial.actions ?? [],
    };
  }
  return normalized;
}

// margin is roll minus DC; >= 0 passed.
export function pickTier(margin, outcomes) {
  if (margin >= 0) {
    if (outcomes.critical && margin >= outcomes.critical.margin) return 'critical';
    return 'success';
  }
  if (outcomes.partial && margin >= -outcomes.partial.margin) return 'partial';
  return 'failure';
}

// Rolls d20 + the skill modifier against dc, picks the tier, and logs the
// roll line plus the tier's authored text. success covers critical too.
export function performSkillCheck(engine, skillId, dc, outcomes = null, attempts = 0) {
  const tiers = outcomes ?? { success: { actions: [] }, failure: { actions: [] } };
  const mod = engine.state.getPlayer().attributes[skillId] ?? 0;
  const base = roll(1, MAX_D20_ROLL);
  const rolled = base + mod;
  const margin = rolled - dc;
  const tier = pickTier(margin, tiers);
  const success = tier === 'critical' || tier === 'success';
  engine.log(
    LOG.SYSTEM,
    engine.t(TIER_LOG_KEYS[tier], {
      roll: rolled, dc, skill: skillLabel(engine, skillId),
      breakdown: rollBreakdown(base, mod, skillLabel(engine, skillId)),
    }),
    success ? 'loot' : 'system'
  );
  const tierText = pickVariant(tiers[tier]?.text, attempts);
  if (tierText) engine.log(LOG.NARRATOR, tierText);
  return { rolled, mod, margin, tier, success };
}

// One rolled attempt, shared by scene checks and dialogue responses: roll,
// tier, time charge, resolveOnce, the tier's pipeline, attempt bookkeeping,
// exhaustion, re-render. The caller owns everything before the roll.
//
// attemptKey / resolvedKey are the check-state maps for attempts and
// retirement (dialogue keeps them apart so exhaustion resets on re-talk);
// entryKey is this check's key in them. didNavigate says whether a pipeline
// moved the player; rerenderSuccess defaults to rerender.
export function runCheckAttempt(engine, check, {
  attemptKey, resolvedKey = attemptKey, entryKey,
  runActions, didNavigate, chargeTime,
  rerender, rerenderSuccess = rerender,
}) {
  const attempts = getAttempts(engine.state, attemptKey, entryKey);
  const outcomes = normalizeOutcomes(check);
  const { tier, success } = performSkillCheck(engine, check.skillCheck, check.dc, outcomes, attempts);
  chargeTime?.();
  if (check.resolveOnce) markResolved(engine.state, resolvedKey, entryKey);

  if (success) {
    runActions(outcomes[tier].actions);
  } else {
    // A partial runs its pipeline but still counts as an attempt.
    const count = recordAttempt(engine.state, attemptKey, entryKey);
    runActions(outcomes[tier].actions);
    if (!check.resolveOnce && check.maxAttempts && count >= check.maxAttempts) {
      markResolved(engine.state, attemptKey, entryKey);
      if (check.onExhausted?.length) runActions(check.onExhausted);
    }
  }
  if (!didNavigate()) (success ? rerenderSuccess : rerender)();
  return { tier, success };
}

// A check button's gate, display text, and badge lines, shared by the three
// check surfaces. dc is what the badge advertises.
export function checkPresentation(engine, check, attempts, dc = check.dc) {
  const gate = retryGate(engine, attempts);
  return {
    gate,
    displayText: resolveRetryText(check, attempts),
    badge: applyRetryGate(engine, gate, skillBadge(engine, check.skillCheck, dc)),
    blocked: gate.blocked,
  };
}

// The skill's badge (with the modifier, where the locale shows it) and the DC.
export function skillBadge(engine, skillId, dc) {
  const mod = engine.state.getPlayer().attributes[skillId] ?? 0;
  return [
    engine.t(`actions.skillBadge.${skillId}`, { dc, mod: formatSigned(mod) }),
    engine.t('actions.skillBadgeDc', { dc }),
  ];
}

// rules.skillRetry { resource, cost }, or null when retries are free.
export function retryCost(rules) {
  const r = rules?.skillRetry;
  return r?.resource && r.cost > 0 ? { resource: r.resource, amount: r.cost } : null;
}

// What a retry costs and whether the player can afford it; the first attempt
// is always free.
export function retryGate(engine, attempts) {
  const policy = retryCost(engine.data.rules);
  if (!attempts || !policy) return { cost: 0, blocked: false };
  const have = engine.state.getPlayer().resources?.[policy.resource]?.current ?? 0;
  return { cost: policy.amount, resource: policy.resource, blocked: have < policy.amount };
}

const badgeLines = (badge) => Array.isArray(badge) ? badge : badge ? [badge] : [];

// Appends the retry cost line when a retry charges one.
export function applyRetryGate(engine, gate, badge) {
  if (gate.cost <= 0) return badge;
  const label = engine.t(`ui.resources.${gate.resource}`);
  return [...badgeLines(badge), engine.t('actions.badgeRetryCost', { cost: gate.cost, resource: label })];
}

// Deducts the cost and logs the balance left; a free gate is a no-op.
export function spendRetryCost(engine, gate) {
  if (gate.cost <= 0) return;
  engine.state.modifyPlayerStat(gate.resource, -gate.cost);
  const remaining = engine.state.getPlayer().resources?.[gate.resource]?.current ?? 0;
  const label = engine.t(`ui.resources.${gate.resource}`);
  engine.log(LOG.SYSTEM, engine.t('actions.retrySpent', {
    cost: gate.cost, resource: label, remaining,
  }), 'system');
}

// Attempt counts live under `tries_<entryKey>` in the check-state map and
// reset on re-entry; resolution markers (below) persist.
export function getAttempts(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  return map[`tries_${entryKey}`] || 0;
}

// Returns the updated count.
export function recordAttempt(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  const next = (map[`tries_${entryKey}`] || 0) + 1;
  map[`tries_${entryKey}`] = next;
  state.setCheckState(checkKey, map);
  return next;
}

// A rolled resolveOnce check, or an exhausted maxAttempts budget.
export function isResolved(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  return !!map[`resolved_${entryKey}`];
}

export function markResolved(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  map[`resolved_${entryKey}`] = true;
  state.setCheckState(checkKey, map);
}

// Clears the attempt counters, including the discovery entries' tries, and
// keeps resolution markers and found items.
export function resetAttempts(state, checkKey) {
  const map = state.getCheckState(checkKey);
  if (!map || typeof map !== 'object') return;
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith('tries_') || key === 'tries') {
      delete map[key];
      changed = true;
    }
    if (key.startsWith('disc_') && map[key]?.tries !== undefined) {
      delete map[key].tries;
      changed = true;
    }
  }
  if (changed) state.setCheckState(checkKey, map);
}
