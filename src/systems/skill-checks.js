import { gameState } from "../core/state.js";
import { MAX_D20_ROLL, LOG } from "../core/config.js";
import { apEconomyRules } from "../core/utils.js";
import { roll } from "./dice.js";

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

/**
 * Formats a modifier for display on badges and log lines ("+2", "-1", "+0").
 * @param {number} mod
 * @returns {string}
 */
export function formatMod(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/**
 * Formats a displayed d20 roll naming the modifier's source, so the math is
 * legible in the log: "1d20: 17 + 1 Perception". A zero modifier renders as
 * just "1d20: 17". Callers append "= {total}" where the sum isn't shown nearby.
 * @param {number} base - The natural die result.
 * @param {number} mod - The modifier added to it.
 * @param {string} label - Where the modifier comes from (skill name, weapon name).
 * @returns {string}
 */
export function rollBreakdown(base, mod, label) {
  return rollBreakdownParts(base, [{ mod, label }]);
}

/**
 * Multi-modifier variant of rollBreakdown: each part names its own source,
 * zero modifiers are skipped ("1d20: 12 + 2 Strength + 1 Rusty Sword").
 * @param {number} base - The natural die result.
 * @param {Array<{mod: number, label: string}>} parts - Modifiers in display order.
 * @returns {string}
 */
export function rollBreakdownParts(base, parts) {
  let out = `1d20: ${base}`;
  for (const { mod, label } of parts) {
    if (!mod) continue;
    out += ` ${mod < 0 ? '-' : '+'} ${Math.abs(mod)} ${label}`;
  }
  return out;
}

/**
 * The localized display name of a skill (actions.skillBadgeFree.<id>),
 * falling back to the capitalized id when the locale has no entry.
 * @param {object} engine - The RPGEngine instance (used for locale).
 * @param {string} skillId - Attribute ID (e.g. "perception").
 * @returns {string}
 */
export function skillLabel(engine, skillId) {
  const key = `actions.skillBadgeFree.${skillId}`;
  const name = engine.t(key);
  return name !== key ? name : skillId.charAt(0).toUpperCase() + skillId.slice(1);
}

/**
 * Resolves the display/log text for a check that has been attempted before.
 * Once at least one attempt has been made, an optional `retryText` takes over:
 * a string, or an array walked per attempt (clamping to the last entry).
 * @param {object} opt - The skill option or dialogue response.
 * @param {number} attempts - Attempts made so far.
 * @returns {string}
 */
export function resolveRetryText(opt, attempts) {
  if (!attempts || !opt.retryText) return opt.text;
  const variants = Array.isArray(opt.retryText) ? opt.retryText : [opt.retryText];
  return variants[Math.min(attempts - 1, variants.length - 1)];
}

/**
 * Resolves a tier's narration for the current attempt. A tier `text` may be a
 * single string (shown every time) or an array walked per failed attempt so
 * repeated failures escalate ("Nothing." → "Still nothing." → …), clamping to
 * the last entry.
 * @param {string|string[]|undefined} text - The tier's `text` field.
 * @param {number} attempts - Failed attempts before this one (0 on first try).
 * @returns {string|undefined}
 */
export function resolveTierText(text, attempts) {
  if (!Array.isArray(text)) return text;
  return text[Math.min(attempts, text.length - 1)];
}

/**
 * Builds the canonical outcome-tier table for a check from either authoring
 * shape. Legacy fields (`actions` = success pipeline, `onFailure` = failure
 * pipeline) and the newer `outcomes` object may be mixed freely; when both
 * define the same tier's actions, `outcomes` wins.
 *
 * @param {object} check - A scene skill option or dialogue response.
 * @returns {{critical?: object, success: object, partial?: object, failure: object}}
 *   Tier entries of shape { margin?: number, text?: string, actions: object[] }.
 *   `critical` and `partial` are only present when authored.
 */
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

/**
 * Picks the outcome tier for a roll margin against a normalized tier table.
 * @param {number} margin - roll total minus DC (>= 0 means the check passed).
 * @param {object} outcomes - Result of normalizeOutcomes().
 * @returns {'critical'|'success'|'partial'|'failure'}
 */
export function pickTier(margin, outcomes) {
  if (margin >= 0) {
    if (outcomes.critical && margin >= outcomes.critical.margin) return 'critical';
    return 'success';
  }
  if (outcomes.partial && margin >= -outcomes.partial.margin) return 'partial';
  return 'failure';
}

/**
 * Rolls a d20 skill check for the player, resolves its outcome tier, and logs
 * the outcome. Looks up the player's attribute modifier for skillId, rolls
 * 1d20 + mod, and maps the margin against the check's tier table. When the
 * landed tier carries authored `text`, it is logged as narration.
 *
 * @param {object} engine - The RPGEngine instance (used for logging/locale).
 * @param {string} skillId - Attribute ID to check (e.g. "perception").
 * @param {number} dc - Difficulty class the roll must meet or exceed.
 * @param {object} [outcomes] - Normalized tier table (normalizeOutcomes). When
 *   omitted, a plain success/failure table is used.
 * @returns {{rolled: number, mod: number, margin: number, tier: string, success: boolean}}
 *   `success` is true for the critical and success tiers.
 */
export function performSkillCheck(engine, skillId, dc, outcomes = null, attempts = 0) {
  const tiers = outcomes ?? { success: { actions: [] }, failure: { actions: [] } };
  const mod = gameState.getPlayer().attributes[skillId] ?? 0;
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
  const tierText = resolveTierText(tiers[tier]?.text, attempts);
  if (tierText) engine.log(LOG.NARRATOR, tierText);
  return { rolled, mod, margin, tier, success };
}

/**
 * Builds the badge lines for a skill-check button/response: the player's
 * current modifier (resolved through the locale — a badge string without a
 * {mod} placeholder simply doesn't show it), then the DC on its own line.
 * @param {object} engine - The RPGEngine instance (used for locale).
 * @param {string} skillId - Attribute ID the check rolls.
 * @param {number} dc - Difficulty class shown on the badge.
 * @returns {string[]}
 */
export function skillBadge(engine, skillId, dc) {
  const mod = gameState.getPlayer().attributes[skillId] ?? 0;
  return [
    engine.t(`actions.skillBadge.${skillId}`, { dc, mod: formatMod(mod) }),
    engine.t('actions.skillBadgeDc', { dc }),
  ];
}

/**
 * The retry policy: retrying a FAILED check spends `cost` of a named resource
 * (rules.skillRetry = { resource, cost }). First attempts are always free.
 * Absent config or cost 0 makes retries free. Games that never fail-forward
 * on a scarce currency simply omit it.
 * @param {object|null} rules - The loaded rules object.
 * @returns {{resource: string, amount: number}|null}
 */
export function retryCost(rules) {
  const r = rules?.skillRetry;
  return r?.resource && r.cost > 0 ? { resource: r.resource, amount: r.cost } : null;
}

/**
 * The retry gate for a check that has been attempted before: what a retry
 * costs and whether the player can afford it. `blocked` means callers render
 * the button disabled (like an unmet item requirement). The first attempt
 * (attempts === 0) is always free.
 * @param {object} engine - The RPGEngine instance (reads data.rules and state).
 * @param {number} attempts - Attempts made so far.
 * @returns {{cost: number, resource?: string, blocked: boolean}}
 */
export function retryGate(engine, attempts) {
  const policy = retryCost(engine.data.rules);
  if (!attempts || !policy) return { cost: 0, blocked: false };
  const have = gameState.getPlayer().resources?.[policy.resource]?.current ?? 0;
  return { cost: policy.amount, resource: policy.resource, blocked: have < policy.amount };
}

// Normalizes a badge (null | string | string[]) to an array of lines, so the
// gates below can append their cost lines uniformly.
const badgeLines = (badge) => Array.isArray(badge) ? badge : badge ? [badge] : [];

/**
 * Appends the retry cost to a check badge when a retry charges one, as its
 * own badge line. The currency's display name comes from
 * ui.resources.<resource>. Returns the (possibly extended) badge lines.
 * @param {object} engine - The RPGEngine instance (used for locale).
 * @param {{cost: number, resource?: string}} gate - Result of retryGate().
 * @param {?string|string[]} badge - The base badge line(s), or null.
 * @returns {?string|string[]}
 */
export function applyRetryGate(engine, gate, badge) {
  if (gate.cost <= 0) return badge;
  const label = engine.t(`ui.resources.${gate.resource}`);
  return [...badgeLines(badge), engine.t('actions.badgeRetryCost', { cost: gate.cost, resource: label })];
}

/**
 * Charges a retry gate: deducts the cost and logs the spend with the balance
 * left, so the log shows the attempt wasn't free. A free gate (first attempt,
 * or no retry policy) is a no-op.
 * @param {object} engine - The RPGEngine instance (used for locale and log).
 * @param {{cost: number, resource?: string}} gate - Result of retryGate().
 */
export function spendRetryCost(engine, gate) {
  if (gate.cost <= 0) return;
  gameState.modifyPlayerStat(gate.resource, -gate.cost);
  const remaining = gameState.getPlayer().resources?.[gate.resource]?.current ?? 0;
  const label = engine.t(`ui.resources.${gate.resource}`);
  engine.log(LOG.SYSTEM, engine.t('actions.retrySpent', {
    cost: gate.cost, resource: label, remaining,
  }), 'system');
}

/**
 * The AP cost of one rolled skill-check attempt: the option's explicit apCost
 * wins; otherwise rules.apEconomy.skillAttemptCost applies (0 by default —
 * checks are free unless a game opts into an exertion economy). Narrative
 * (roll-free) beats don't use this: they only charge an explicit apCost.
 * @param {object} engine - The RPGEngine instance (reads data.rules).
 * @param {object} opt - The option/response carrying the check.
 * @returns {number}
 */
export function skillApCost(engine, opt) {
  return opt.apCost ?? apEconomyRules(engine.data.rules).skillAttemptCost;
}

/**
 * The AP gate for an attempt that costs AP: what it costs and whether the
 * player can afford it. `blocked` means callers render the button disabled.
 * @param {object} engine - The RPGEngine instance (reads state).
 * @param {number} cost - AP cost of one attempt (see skillApCost).
 * @returns {{cost: number, blocked: boolean}}
 */
export function apGate(engine, cost) {
  if (!(cost > 0)) return { cost: 0, blocked: false };
  return { cost, blocked: (gameState.getPlayer().resources.ap?.current ?? 0) < cost };
}

/**
 * Appends the AP cost to a check badge when the attempt charges one, as its
 * own badge line ("AP: 1"). Without a base badge (a plain dialogue response
 * with an explicit apCost) the AP line stands alone. Returns the (possibly
 * extended) badge lines.
 * @param {object} engine - The RPGEngine instance (used for locale).
 * @param {{cost: number}} gate - Result of apGate().
 * @param {?string|string[]} badge - The base badge line(s), or null.
 * @returns {?string|string[]}
 */
export function applyApGate(engine, gate, badge) {
  if (gate.cost <= 0) return badge;
  return [...badgeLines(badge), engine.t('actions.badgeApCost', { cost: gate.cost })];
}

/**
 * Charges an AP gate. Silent — the header resource bar reflects the spend;
 * unlike retries there's no scarce-currency drama to narrate.
 * @param {{cost: number}} gate - Result of apGate().
 */
export function spendAp(gate) {
  if (gate.cost > 0) gameState.modifyPlayerStat('ap', -gate.cost);
}

/**
 * Reads how many attempts have been recorded for one check. Attempt counts
 * live in a flag-backed per-scene (or per-NPC) map under a `tries_` key, and
 * reset on scene re-entry / dialogue restart — unlike resolution markers,
 * which persist (see isResolved).
 * @param {string} flagKey - The state flag holding the check-state map.
 * @param {string|number} entryKey - Key of the specific check inside the map.
 * @returns {number}
 */
export function getAttempts(flagKey, entryKey) {
  const state = gameState.getFlag(flagKey) || {};
  return state[`tries_${entryKey}`] || 0;
}

/**
 * Records one attempt for a check (see getAttempts).
 * @param {string} flagKey - The state flag holding the check-state map.
 * @param {string|number} entryKey - Key of the specific check inside the map.
 * @returns {number} The updated attempt count.
 */
export function recordAttempt(flagKey, entryKey) {
  const state = gameState.getFlag(flagKey) || {};
  const next = (state[`tries_${entryKey}`] || 0) + 1;
  state[`tries_${entryKey}`] = next;
  gameState.setFlag(flagKey, state);
  return next;
}

/**
 * Whether a check has been permanently resolved (a resolveOnce check that has
 * been rolled, or a maxAttempts check whose budget ran out). Resolution
 * markers survive scene re-entry and save/load.
 * @param {string} flagKey - The state flag holding the check-state map.
 * @param {string|number} entryKey - Key of the specific check inside the map.
 * @returns {boolean}
 */
export function isResolved(flagKey, entryKey) {
  const state = gameState.getFlag(flagKey) || {};
  return !!state[`resolved_${entryKey}`];
}

/**
 * Permanently retires a check (see isResolved).
 * @param {string} flagKey - The state flag holding the check-state map.
 * @param {string|number} entryKey - Key of the specific check inside the map.
 */
export function markResolved(flagKey, entryKey) {
  const state = gameState.getFlag(flagKey) || {};
  state[`resolved_${entryKey}`] = true;
  gameState.setFlag(flagKey, state);
}

/**
 * Clears the attempt counters in a flag-backed check-state map while
 * preserving resolution markers and discovery progress. Called on scene
 * re-entry so retryText wording starts fresh, without reviving checks that
 * were permanently resolved. Discovery entries (namespaced `disc_<i>`, plus
 * the legacy top-level shape) keep their found/resolved state and only drop
 * their tries counter.
 * @param {string} flagKey - The state flag holding the check-state map.
 */
export function resetAttempts(flagKey) {
  const state = gameState.getFlag(flagKey);
  if (!state || typeof state !== 'object') return;
  let changed = false;
  for (const key of Object.keys(state)) {
    if (key.startsWith('tries_') || key === 'tries') {
      delete state[key];
      changed = true;
    }
    if (key.startsWith('disc_') && state[key]?.tries !== undefined) {
      delete state[key].tries;
      changed = true;
    }
  }
  if (changed) gameState.setFlag(flagKey, state);
}
