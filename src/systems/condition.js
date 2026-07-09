/**
 * Abstract Syntax Tree (AST) Condition Evaluator for Gravity.
 * Compiles and evaluates nested logical condition maps against the game state
 * to determine option visibilities, dialogue gates, and description variants.
 * 
 * Supported Leaf Node Types:
 * - flag: Boolean states (e.g. `{ "flag": "door_unlocked", "value": true }`)
 * - item: Inventory presence (e.g. `{ "item": "cellar_key", "count": 1 }`)
 * - gold: Resource metrics (e.g. `{ "gold": { "less_than": 50 } }`)
 * - level: Character status (e.g. `{ "level": 3 }`)
 * - mission: Quest states (e.g. `{ "mission": "escape", "status": "active" }`)
 * - time: Absolute elapsed ticks (e.g. `{ "time": { "at_least": 120 } }`)
 * - day: 1-based day number (e.g. `{ "day": { "at_least": 3 } }`) — needs rules.time
 * - segment: Current day segment (e.g. `{ "segment": "night" }`) — needs rules.time
 * - customAttributes: Dynamic skill values (e.g. `{ "stealth": { "more_than": 2 } }`)
 *
 * Supported Tree Combinators:
 * - and: Returns true if every child evaluation passes.
 * - or: Returns true if at least one child evaluation passes.
 * - not: Inverts the evaluation of its child.
 */

import { getDay, getSegment } from "./time.js";

/**
 * Compares an actual numeric state value against a defined comparison rule.
 * Supports bare numbers (defaults to at_least / >=) or explicit comparison objects.
 * 
 * @param {number} actual - The live, current player statistic value.
 * @param {number|object} operand - The comparison target. Can be a raw number (defaulting to >=)
 *                                  or an operator object:
 *                                  - { at_least: N }  (actual >= N)
 *                                  - { more_than: N } (actual > N)
 *                                  - { at_most: N }   (actual <= N)
 *                                  - { less_than: N } (actual < N)
 *                                  - { is: N }        (actual === N)
 * @returns {boolean} True if the mathematical comparison holds.
 */
function compare(actual, operand) {
  // Bare number comparison defaults to "greater than or equal to" (>=) standard D&D gates.
  if (typeof operand === 'number') return actual >= operand;
  
  // Explicit conditional object matching
  if ('at_least'  in operand) return actual >= operand.at_least;
  if ('more_than' in operand) return actual >  operand.more_than;
  if ('at_most'   in operand) return actual <= operand.at_most;
  if ('less_than' in operand) return actual <  operand.less_than;
  if ('is'        in operand) return actual === operand.is;
  
  return false;
}

/**
 * Recursively evaluates a nested condition tree against a live StateManager instance.
 * Evaluates recursively to handle infinitely nested combinator brackets.
 * 
 * @param {object|null} condition - The conditional JSON node to evaluate.
 * @param {object} gameState - The global, reactive StateManager instance.
 * @returns {boolean} True if the evaluation passes; false otherwise.
 */
export function evaluateCondition(condition, gameState) {
  // Empty/absent conditions are treated as unrestricted logic gates and always return true.
  if (!condition) return true;

  // ── 1. Recursive Combinators ──────────────────────────────────────────────
  
  // AND: Every child condition must evaluate to true
  if (condition.and) {
    return condition.and.every(c => evaluateCondition(c, gameState));
  }
  
  // OR: At least one child condition must evaluate to true
  if (condition.or) {
    return condition.or.some(c => evaluateCondition(c, gameState));
  }
  
  // NOT: Invert the result of the child condition
  if (condition.not) {
    return !evaluateCondition(condition.not, gameState);
  }

  // ── 2. Leaf Nodes (Concrete Checks) ───────────────────────────────────────
  
  // FLAG Leaf: Evaluates if a key-value flag in persistent memory matches exactly
  if ('flag' in condition) {
    return gameState.getFlag(condition.flag) === condition.value;
  }
  
  // MISSION Leaf: Evaluates if a quest status equals a target state (active/complete/not_started)
  if ('mission' in condition) {
    return gameState.getMissionStatus(condition.mission) === condition.status;
  }

  const player = gameState.getPlayer();
  const attrs = player.attributes ?? {};

  // TIME Leaves: absolute elapsed ticks; derived day number and day segment.
  // Day and segment need rules.time (ticksPerDay / segments) — without that
  // config the leaf evaluates false (validateGameData warns at load).
  // A custom attribute sharing one of these names predates the leaf — the
  // attribute keeps its original semantics via the attributes fallthrough
  // below (validateGameData flags the collision).
  if ('time' in condition && !('time' in attrs)) {
    return compare(gameState.getTicks?.() ?? 0, condition.time);
  }
  if ('day' in condition && !('day' in attrs)) {
    const day = getDay(gameState.getTicks?.() ?? 0, gameState.getRules?.()?.time);
    return day === null ? false : compare(day, condition.day);
  }
  if ('segment' in condition && !('segment' in attrs)) {
    return getSegment(gameState.getTicks?.() ?? 0, gameState.getRules?.()?.time) === condition.segment;
  }

  // ITEM Leaf: Evaluates if the player possesses the item, checking quantities if "count" is specified.
  // Checks both the unequipped inventory and equipped slots.
  if ('item' in condition) {
    const totalCount = gameState.countPlayerItem(condition.item);
    return condition.count ? totalCount >= condition.count : totalCount > 0;
  }

  // Core character resources: evaluated via the general compare helper
  if ('level' in condition) {
    return compare(player.level, condition.level);
  }
  
  if ('gold' in condition) {
    return compare(player.resources.gold, condition.gold);
  }

  // Custom attributes (e.g., perception, stealth, charisma) loaded dynamically
  // from rules.json. This lets the author create custom checks without writing code.
  for (const key of Object.keys(attrs)) {
    if (key in condition) {
      return compare(attrs[key], condition[key]);
    }
  }

  // Unhandled condition shapes log developer warnings in development context.
  console.warn('[Gravity] evaluateCondition: unrecognized conditional syntax tree node:', condition);
  return false;
}
