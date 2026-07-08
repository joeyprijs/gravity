import { gameState } from "../core/state.js";
import { MAX_D20_ROLL, LOG } from "../core/config.js";
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
export function performSkillCheck(engine, skillId, dc, outcomes = null) {
  const tiers = outcomes ?? { success: { actions: [] }, failure: { actions: [] } };
  const mod = gameState.getPlayer().attributes[skillId] ?? 0;
  const rolled = roll(1, MAX_D20_ROLL) + mod;
  const margin = rolled - dc;
  const tier = pickTier(margin, tiers);
  const success = tier === 'critical' || tier === 'success';
  engine.log(
    LOG.SYSTEM,
    engine.t(TIER_LOG_KEYS[tier], { roll: rolled, mod, dc, skill: skillId }),
    success ? 'loot' : 'system'
  );
  const tierText = tiers[tier]?.text;
  if (tierText) engine.log(LOG.NARRATOR, tierText);
  return { rolled, mod, margin, tier, success };
}

// ── Luck ─────────────────────────────────────────────────────────────────────
// Fighting-Fantasy-style "Test Your Luck": roll 2d6 at or under your current
// luck to be lucky, then lose 1 luck REGARDLESS of the outcome. Luck is a
// depleting, rarely-restored resource — every test is a real spend.

// P(2d6 <= n) as a whole percentage, indexed by n (clamped to [0, 12]).
const TWO_D6_AT_MOST = [0, 0, 3, 8, 17, 28, 42, 58, 72, 83, 92, 97, 100];

/**
 * Whether the game has opted into the luck resource
 * (rules.playerDefaults.resources.luck).
 * @returns {boolean}
 */
export function luckEnabled() {
  return !!gameState.getPlayer()?.resources?.luck;
}

/**
 * The player's odds of being lucky on a 2d6-roll-under test, as a whole
 * percentage. Shown on gamble buttons so testing your luck is an informed
 * decision, not a slot machine.
 * @param {number} luck - Current luck value.
 * @returns {number} 0–100.
 */
export function luckOdds(luck) {
  return TWO_D6_AT_MOST[Math.max(0, Math.min(12, luck))];
}

/**
 * Performs a Test Your Luck: rolls 2d6 against the player's current luck,
 * logs the outcome, then reduces luck by 1 regardless. In a game without the
 * luck resource this warns and resolves as unlucky.
 * @param {object} engine - The RPGEngine instance (used for logging/locale).
 * @returns {{rolled: number, luck: number, lucky: boolean}}
 */
export function performLuckCheck(engine) {
  if (!luckEnabled()) {
    console.warn('[Gravity] performLuckCheck: no luck resource in rules.playerDefaults — resolving as unlucky');
    return { rolled: 0, luck: 0, lucky: false };
  }
  const luck = gameState.getPlayer().resources.luck.current;
  const rolled = roll(1, 6) + roll(1, 6);
  const lucky = rolled <= luck;
  engine.log(
    LOG.SYSTEM,
    engine.t(lucky ? 'actions.luckSuccess' : 'actions.luckFail', { roll: rolled, luck }),
    lucky ? 'loot' : 'system'
  );
  gameState.modifyPlayerStat('luck', -1);
  return { rolled, luck, lucky };
}

/**
 * The luck cost of RETRYING a failed skill check (first attempts are always
 * free). 0 — the default — disables the mechanic entirely.
 * @param {object|null} rules - The loaded rules object.
 * @returns {number}
 */
export function retryLuckCost(rules) {
  return luckEnabled() ? (rules?.skillRetryLuckCost ?? 0) : 0;
}

/**
 * Builds the badge for a skill-check button/response: the DC plus the
 * player's current modifier, resolved through the locale (a badge string
 * without a {mod} placeholder simply doesn't show it).
 * @param {object} engine - The RPGEngine instance (used for locale).
 * @param {string} skillId - Attribute ID the check rolls.
 * @param {number} dc - Difficulty class shown on the badge.
 * @returns {string}
 */
export function skillBadge(engine, skillId, dc) {
  const mod = gameState.getPlayer().attributes[skillId] ?? 0;
  return engine.t(`actions.skillBadge.${skillId}`, { dc, mod: formatMod(mod) });
}

/**
 * Retry-costs-luck gate (rules.skillRetryLuckCost): the first attempt at a
 * check is free; each retry spends luck. `blocked` means the player can't
 * afford the retry — callers render the button disabled, like unmet item
 * requirements. cost 0 (the default) disables the mechanic.
 * @param {object} engine - The RPGEngine instance (reads data.rules).
 * @param {number} attempts - Attempts made so far.
 * @returns {{cost: number, blocked: boolean}}
 */
export function retryGate(engine, attempts) {
  const cost = retryLuckCost(engine.data.rules);
  if (!attempts || cost <= 0) return { cost: 0, blocked: false };
  return { cost, blocked: gameState.getPlayer().resources.luck.current < cost };
}

/**
 * Applies a retry gate to a check badge: appends the luck cost when the retry
 * charges one. Returns the (possibly rewritten) badge text.
 * @param {object} engine - The RPGEngine instance (used for locale).
 * @param {{cost: number}} gate - Result of retryGate().
 * @param {string} badge - The base badge text.
 * @returns {string}
 */
export function applyRetryGate(engine, gate, badge) {
  if (gate.cost <= 0) return badge;
  return engine.t('actions.badgeWithLuckCost', { badge, cost: gate.cost });
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
