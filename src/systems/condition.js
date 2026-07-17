// The condition evaluator: gates scene options, dialogue responses,
// description variants, and auto-combat against the game state.
//
// Leaf shapes:
//   flag:      { "flag": "door_unlocked", "value": true }
//   item:      { "item": "cellar_key", "count": 1 }
//   gold:      { "gold": { "less_than": 50 } }
//   level:     { "level": 3 }
//   mission:   { "mission": "escape", "status": "active" }
//   time:      { "time": { "at_least": 120 } }        absolute elapsed ticks
//   day:       { "day": { "at_least": 3 } }           needs rules.time
//   segment:   { "segment": "night" }                 needs rules.time
//   attribute: { "stealth": { "more_than": 2 } }      any declared attribute
//
// Combinators `and` (array), `or` (array), and `not` (single child) nest
// arbitrarily. Like dice.js, this module is DOM- and engine-free.

import { getDay, getSegment } from "./time.js";

/**
 * Compares a live numeric value against a condition operand: a bare number
 * (meaning at-least, the common authoring case) or an operator object —
 * at_least, more_than, at_most, less_than, is.
 *
 * @param {number} actual - The live value from state.
 * @param {number|object} operand - The comparison target.
 * @returns {boolean} True if the comparison holds.
 */
function compare(actual, operand) {
  // A bare number defaults to at-least — the natural "do I qualify?" gate.
  if (typeof operand === 'number') return actual >= operand;

  if ('at_least'  in operand) return actual >= operand.at_least;
  if ('more_than' in operand) return actual >  operand.more_than;
  if ('at_most'   in operand) return actual <= operand.at_most;
  if ('less_than' in operand) return actual <  operand.less_than;
  if ('is'        in operand) return actual === operand.is;

  console.warn('[Gravity] evaluateCondition: unrecognized comparison operator:', operand);
  return false;
}

/**
 * Recursively evaluates a condition tree against a StateManager.
 *
 * @param {object|null} condition - The condition node from game JSON.
 * @param {object} state - The StateManager to evaluate against.
 * @returns {boolean} True when the condition passes (absent conditions always do).
 */
export function evaluateCondition(condition, state) {
  if (!condition) return true;

  // Combinators recurse before any leaf is considered.
  if (condition.and) {
    return condition.and.every(c => evaluateCondition(c, state));
  }
  if (condition.or) {
    return condition.or.some(c => evaluateCondition(c, state));
  }
  if (condition.not) {
    return !evaluateCondition(condition.not, state);
  }

  if ('flag' in condition) {
    return state.getFlag(condition.flag) === condition.value;
  }

  if ('mission' in condition) {
    return state.getMissionStatus(condition.mission) === condition.status;
  }

  const player = state.getPlayer();
  const attrs = player.attributes ?? {};

  // Time leaves: absolute elapsed ticks, derived day number, day segment.
  // Day and segment need rules.time (ticksPerDay / segments) — without that
  // config the leaf evaluates false (validateGameData warns at load).
  // A custom attribute sharing one of these names predates the leaf — the
  // attribute keeps its original semantics via the attributes fallthrough
  // below (validateGameData flags the collision).
  if ('time' in condition && !('time' in attrs)) {
    return compare(state.getTicks?.() ?? 0, condition.time);
  }
  if ('day' in condition && !('day' in attrs)) {
    const day = getDay(state.getTicks?.() ?? 0, state.getRules?.()?.time);
    return day === null ? false : compare(day, condition.day);
  }
  if ('segment' in condition && !('segment' in attrs)) {
    return getSegment(state.getTicks?.() ?? 0, state.getRules?.()?.time) === condition.segment;
  }

  // Item possession counts both unequipped inventory stacks and worn slots,
  // so equipping the cellar key can't lock the player out of the cellar.
  if ('item' in condition) {
    const totalCount = state.countPlayerItem(condition.item);
    return condition.count ? totalCount >= condition.count : totalCount > 0;
  }

  if ('level' in condition) {
    return compare(player.level, condition.level);
  }

  if ('gold' in condition) {
    return compare(player.resources.gold, condition.gold);
  }

  // Any declared attribute (perception, stealth, …) is a leaf by name, so
  // rules.customAttributes gate content without engine changes. Iterate the
  // condition's own keys, not the player's whole attribute map.
  for (const key of Object.keys(condition)) {
    if (key in attrs) {
      return compare(attrs[key], condition[key]);
    }
  }

  console.warn('[Gravity] evaluateCondition: unrecognized condition node:', condition);
  return false;
}
