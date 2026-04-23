// Evaluates a condition tree against the current game state.
// Used by SceneRenderer to show/hide options and description variants.
//
// Leaf types:
//   { "flag": "name", "value": true }               — flag equals value
//   { "item": "item_id" }                           — player has item in inventory
//   { "item": "item_id", "count": 3 }              — player has >= 3 of item
//   { "gold": 50 }                                  — player gold >= 50 (shorthand for gte)
//   { "gold": { "less_than": 10 } }                — supports at_least/more_than/at_most/less_than/is
//   { "level": 3 }                                  — player level >= 3
//   { "stealth": 2 }                               — any player attribute >= 2 (shorthand for at_least)
//   { "stealth": { "more_than": 1 } }              — attribute with explicit operator
//   { "mission": "id", "status": "complete" }       — mission is in the given status
//
// Combinators:
//   { "and": [ ...conditions ] }
//   { "or":  [ ...conditions ] }
//   { "not": condition }

// Compares actual against operand. Bare number = >=. Object = explicit operator.
function compare(actual, operand) {
  if (typeof operand === 'number') return actual >= operand;
  if ('at_least'  in operand) return actual >= operand.at_least;
  if ('more_than' in operand) return actual >  operand.more_than;
  if ('at_most'   in operand) return actual <= operand.at_most;
  if ('less_than' in operand) return actual <  operand.less_than;
  if ('is'        in operand) return actual === operand.is;
  return false;
}

export function evaluateCondition(condition, gameState) {
  if (!condition) return true;

  // Combinators
  if (condition.and) return condition.and.every(c => evaluateCondition(c, gameState));
  if (condition.or)  return condition.or.some(c => evaluateCondition(c, gameState));
  if (condition.not) return !evaluateCondition(condition.not, gameState);

  // Leaf types
  if ('flag' in condition)    return gameState.getFlag(condition.flag) === condition.value;
  if ('mission' in condition) return gameState.getMissionStatus(condition.mission) === condition.status;

  if ('item' in condition) {
    const entry = gameState.getPlayer().inventory.find(i => i.item === condition.item);
    if (!entry) return false;
    return condition.count ? entry.amount >= condition.count : true;
  }

  const player = gameState.getPlayer();
  if ('level' in condition) return compare(player.level, condition.level);
  if ('gold'  in condition) return compare(player.resources.gold, condition.gold);

  const attrs = player.attributes ?? {};
  for (const key of Object.keys(attrs)) {
    if (key in condition) return compare(attrs[key], condition[key]);
  }

  console.warn('[Gravity] evaluateCondition: unrecognised condition shape', condition);
  return true;
}

// Converts a legacy requiredState object to a condition node so callers
// can always work with the unified condition format.
export function fromRequiredState(requiredState) {
  if (!requiredState) return null;
  return { flag: requiredState.flag, value: requiredState.value };
}
