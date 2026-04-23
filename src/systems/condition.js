// Evaluates a condition tree against the current game state.
// Used by SceneRenderer to show/hide options and description variants.
//
// Leaf types:
//   { "flag": "name", "value": true }              — flag equals value
//   { "item": "item_id" }                          — player has item in inventory
//   { "stealth": 2 }                              — any player attribute >= value (works for all custom attributes)
//   { "gold": 50 }                                 — player gold >= value
//   { "mission": "id", "status": "complete" }      — mission is in the given status
//
// Combinators:
//   { "and": [ ...conditions ] }
//   { "or":  [ ...conditions ] }
//   { "not": condition }

export function evaluateCondition(condition, gameState) {
  if (!condition) return true;

  // Combinators
  if (condition.and) return condition.and.every(c => evaluateCondition(c, gameState));
  if (condition.or)  return condition.or.some(c => evaluateCondition(c, gameState));
  if (condition.not) return !evaluateCondition(condition.not, gameState);

  // Leaf types
  if ('flag' in condition) return gameState.getFlag(condition.flag) === condition.value;
  if ('item' in condition) return !!gameState.getPlayer().inventory.find(i => i.item === condition.item);
  const player = gameState.getPlayer();
  if ('level' in condition) return player.level >= condition.level;
  if ('gold' in condition)  return player.resources.gold >= condition.gold;
  const attrs = player.attributes ?? {};
  for (const key of Object.keys(attrs)) {
    if (key in condition) return attrs[key] >= condition[key];
  }
  if ('mission' in condition) return gameState.getMissionStatus(condition.mission) === condition.status;

  console.warn('[Gravity] evaluateCondition: unrecognised condition shape', condition);
  return true;
}

// Converts a legacy requiredState object to a condition node so callers
// can always work with the unified condition format.
export function fromRequiredState(requiredState) {
  if (!requiredState) return null;
  return { flag: requiredState.flag, value: requiredState.value };
}
