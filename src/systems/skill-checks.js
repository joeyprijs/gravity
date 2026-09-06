import { MAX_D20_ROLL, LOG } from '../core/config.js';
import { attributeLabel } from '../core/utils.js';
import { roll } from './dice.js';

// Default tier margins. A roll beating the DC by criticalMargin or more lands
// on the critical tier; a roll missing the DC by up to partialMargin lands on
// the partial tier. Both tiers only exist when the author defines them.
const DEFAULT_CRITICAL_MARGIN = 5;
const DEFAULT_PARTIAL_MARGIN = 3;

// The locale key logged for each outcome tier's roll line.
const TIER_LOG_KEYS = {
  critical: 'actions.skillCritical',
  success:  'actions.skillSuccess',
  partial:  'actions.skillPartial',
  failure:  'actions.skillFail',
};

// Formats a modifier for display on badges and log lines ("+2", "-1", "+0").
function formatMod(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

// Formats a displayed d20 roll naming the modifier's source (skill or weapon
// name), so the math is legible in the log: "1d20: 17 + 1 Perception". A zero
// modifier renders as just "1d20: 17". Callers append "= {total}" where the sum
// isn't shown nearby.
export function rollBreakdown(base, mod, label) {
  if (!mod) return `1d20: ${base}`;
  return `1d20: ${base} ${mod < 0 ? '-' : '+'} ${Math.abs(mod)} ${label}`;
}

// The localized display name of a skill (actions.skillBadgeFree.<id>), falling
// back to the capitalized id when the locale has no entry. The engine-flavored
// wrapper over utils.attributeLabel.
export function skillLabel(engine, skillId) {
  return attributeLabel((key) => engine.t(key), skillId);
}

// Resolves authored text that may be a single string (shown every time) or an
// array walked per use so repeats escalate ("Nothing." → "Still nothing." →
// …), clamping to the last entry; n is uses so far (0 picks the first entry).
// The shared shape behind retryText, tier text, and narrative resultText.
export function pickVariant(text, n) {
  if (!Array.isArray(text)) return text;
  return text[Math.min(n, text.length - 1)];
}

// Resolves the display/log text for a check that has been attempted before.
// Once at least one attempt has been made, an optional `retryText` takes over:
// a string, or an array walked per attempt (clamping to the last entry).
export function resolveRetryText(opt, attempts) {
  if (!attempts || !opt.retryText) return opt.text;
  return pickVariant(opt.retryText, attempts - 1);
}

// Builds the canonical outcome-tier table for a check from either authoring
// shape. Legacy fields (`actions` = success pipeline, `onFailure` = failure
// pipeline) and the newer `outcomes` object may be mixed freely; when both
// define the same tier's actions, `outcomes` wins. Tier entries have the shape
// { margin?, text?, actions }; `critical` and `partial` exist only when authored.
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
      // A critical without its own pipeline (common for narration-only crits)
      // falls back to the success actions — the best roll must never do less
      // than a plain success.
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

// Picks the outcome tier for a roll margin (roll total minus DC; >= 0 passed)
// against a normalized tier table.
export function pickTier(margin, outcomes) {
  if (margin >= 0) {
    if (outcomes.critical && margin >= outcomes.critical.margin) return 'critical';
    return 'success';
  }
  if (outcomes.partial && margin >= -outcomes.partial.margin) return 'partial';
  return 'failure';
}

// Rolls 1d20 + the player's skillId modifier against dc, maps the margin
// against the normalized tier table (a plain success/failure table when
// omitted), and logs the roll line. When the landed tier carries authored
// `text`, it is logged as narration. `success` is true for the critical and
// success tiers.
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
  // Tier narration may be an array walked per attempt so repeated failures
  // escalate; a plain string shows every time.
  const tierText = pickVariant(tiers[tier]?.text, attempts);
  if (tierText) engine.log(LOG.NARRATOR, tierText);
  return { rolled, mod, margin, tier, success };
}

/**
 * Runs one rolled check attempt — the machine shared by scene skill options
 * and dialogue responses: roll → tier → time charge → resolveOnce → tier
 * pipeline → attempt bookkeeping → exhaustion → re-render. The caller owns
 * everything BEFORE the roll (gates, spends, choice log) and describes its
 * surface through the io callbacks.
 *
 * (Item-discovery checks are a different machine — a one-roll race against
 * per-item DCs with loot awards — and keep their own resolution in
 * SceneRenderer._resolveDiscovery; they share checkPresentation only.)
 *
 * io keys:
 *   attemptKey / resolvedKey — the flag maps holding attempt counts and
 *     resolveOnce retirement; resolvedKey defaults to attemptKey. Dialogue
 *     keeps them separate so exhaustion resets on re-talk while resolveOnce
 *     survives across conversations. entryKey is this check's key in them.
 *   didNavigate — whether any pipeline run so far moved the player (scene
 *     change, combat, dialogue, custom UI, game over).
 *   chargeTime — called right after the roll, so time reads as its consequence.
 *   rerender / rerenderSuccess — after a non-navigating failure / success;
 *     rerenderSuccess defaults to rerender. Scenes re-render fully so
 *     description variants react to flags the success set.
 */
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
    // Partial and failure tiers both count as an attempt: partial is
    // fail-forward (its pipeline still runs), but the check has not passed.
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

// The presentation bundle for a check button: retry/AP gates, retry-aware
// display text, and the composed badge lines. Shared by scene skill options,
// scene discovery checks, and dialogue responses so the three surfaces can't
// drift. dc is the DC the badge advertises — discovery passes the easiest
// still-hidden item's.
export function checkPresentation(engine, check, attempts, dc = check.dc) {
  const gate = retryGate(engine, attempts);
  return {
    gate,
    displayText: resolveRetryText(check, attempts),
    badge: applyRetryGate(engine, gate, skillBadge(engine, check.skillCheck, dc)),
    blocked: gate.blocked,
  };
}

// Builds the badge lines for a skill-check button/response: the player's
// current modifier (resolved through the locale — a badge string without a
// {mod} placeholder simply doesn't show it), then the DC on its own line.
export function skillBadge(engine, skillId, dc) {
  const mod = engine.state.getPlayer().attributes[skillId] ?? 0;
  return [
    engine.t(`actions.skillBadge.${skillId}`, { dc, mod: formatMod(mod) }),
    engine.t('actions.skillBadgeDc', { dc }),
  ];
}

// The retry policy: retrying a FAILED check spends `cost` of a named resource
// (rules.skillRetry = { resource, cost }). First attempts are always free.
// Absent config or cost 0 makes retries free (null). Games that never
// fail-forward on a scarce currency simply omit it.
export function retryCost(rules) {
  const r = rules?.skillRetry;
  return r?.resource && r.cost > 0 ? { resource: r.resource, amount: r.cost } : null;
}

// The retry gate for a check that has been attempted before: what a retry
// costs and whether the player can afford it. `blocked` means callers render
// the button disabled (like an unmet item requirement). The first attempt
// (attempts === 0) is always free.
export function retryGate(engine, attempts) {
  const policy = retryCost(engine.data.rules);
  if (!attempts || !policy) return { cost: 0, blocked: false };
  const have = engine.state.getPlayer().resources?.[policy.resource]?.current ?? 0;
  return { cost: policy.amount, resource: policy.resource, blocked: have < policy.amount };
}

// Normalizes a badge (null | string | string[]) to an array of lines, so the
// gates below can append their cost lines uniformly.
const badgeLines = (badge) => Array.isArray(badge) ? badge : badge ? [badge] : [];

// Appends the retry cost to a check badge when a retry charges one, as its
// own badge line. The currency's display name comes from
// ui.resources.<resource>. Returns the (possibly extended) badge lines.
export function applyRetryGate(engine, gate, badge) {
  if (gate.cost <= 0) return badge;
  const label = engine.t(`ui.resources.${gate.resource}`);
  return [...badgeLines(badge), engine.t('actions.badgeRetryCost', { cost: gate.cost, resource: label })];
}

// Charges a retry gate: deducts the cost and logs the spend with the balance
// left, so the log shows the attempt wasn't free. A free gate (first attempt,
// or no retry policy) is a no-op.
export function spendRetryCost(engine, gate) {
  if (gate.cost <= 0) return;
  engine.state.modifyPlayerStat(gate.resource, -gate.cost);
  const remaining = engine.state.getPlayer().resources?.[gate.resource]?.current ?? 0;
  const label = engine.t(`ui.resources.${gate.resource}`);
  engine.log(LOG.SYSTEM, engine.t('actions.retrySpent', {
    cost: gate.cost, resource: label, remaining,
  }), 'system');
}

// Reads how many attempts have been recorded for one check. Attempt counts
// live in a flag-backed per-scene (or per-NPC) map (checkKey, see CHECK_KEYS)
// under a `tries_<entryKey>` key, and reset on scene re-entry / dialogue
// restart — unlike resolution markers, which persist (see isResolved).
export function getAttempts(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  return map[`tries_${entryKey}`] || 0;
}

// Records one attempt for a check (same keys as getAttempts); returns the
// updated count.
export function recordAttempt(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  const next = (map[`tries_${entryKey}`] || 0) + 1;
  map[`tries_${entryKey}`] = next;
  state.setCheckState(checkKey, map);
  return next;
}

// Whether a check has been permanently resolved (a resolveOnce check that has
// been rolled, or a maxAttempts check whose budget ran out). Resolution
// markers survive scene re-entry and save/load.
export function isResolved(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  return !!map[`resolved_${entryKey}`];
}

// Permanently retires a check (same keys as isResolved).
export function markResolved(state, checkKey, entryKey) {
  const map = state.getCheckState(checkKey) || {};
  map[`resolved_${entryKey}`] = true;
  state.setCheckState(checkKey, map);
}

// Clears the attempt counters in a flag-backed check-state map while
// preserving resolution markers and discovery progress. Called on scene
// re-entry so retryText wording starts fresh, without reviving checks that
// were permanently resolved. Discovery entries (namespaced `disc_<i>`, plus
// the legacy top-level shape) keep their found/resolved state and only drop
// their tries counter.
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
