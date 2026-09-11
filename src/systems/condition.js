// Gates options, responses, description variants, and auto-combat. Leaves:
//   flag:      { "flag": "door_unlocked", "value": true }
//   item:      { "item": "cellar_key", "count": 1 }
//   gold:      { "gold": { "less_than": 50 } }
//   level:     { "level": 3 }
//   mission:   { "mission": "escape", "status": "active" }
//              { "mission": "escape", "stage": "find_key" }         exactly here (implies active)
//              { "mission": "escape", "stageReached": "find_key" }  at or past, by authored stage order
//   time:      { "time": { "at_least": 120 } }        absolute elapsed ticks
//   day:       { "day": { "at_least": 3 } }           needs rules.time
//   segment:   { "segment": "night" }                 needs rules.time
//   story:     { "story": "gertas_story", "chapter": "the_dance" }  chapter heard
//   attribute: { "stealth": { "more_than": 2 } }      any declared attribute
//
// `and`/`or` (arrays) and `not` (one child) nest arbitrarily. DOM- and
// engine-free.

import { MISSION_STATUS } from '../core/config.js';
import { getDay, getSegment } from './time.js';

// A bare number means at-least; else one of at_least, more_than, at_most,
// less_than, is.
function compare(actual, operand) {
  if (typeof operand === 'number') return actual >= operand;

  if ('at_least'  in operand) return actual >= operand.at_least;
  if ('more_than' in operand) return actual >  operand.more_than;
  if ('at_most'   in operand) return actual <= operand.at_most;
  if ('less_than' in operand) return actual <  operand.less_than;
  if ('is'        in operand) return actual === operand.is;

  console.warn('[Gravity] evaluateCondition: unrecognized comparison operator:', operand);
  return false;
}

// An absent condition passes.
export function evaluateCondition(condition, state) {
  if (!condition) return true;

  if (condition.and) return condition.and.every(c => evaluateCondition(c, state));
  if (condition.or) return condition.or.some(c => evaluateCondition(c, state));
  if (condition.not) return !evaluateCondition(condition.not, state);

  if ('flag' in condition) return state.getFlag(condition.flag) === condition.value;

  if ('mission' in condition) {
    // stage: the exact current stage of an active mission. stageReached: at
    // or past, by authored order, and still true after the mission ends.
    if ('stage' in condition) {
      return state.getMissionStatus(condition.mission) === MISSION_STATUS.ACTIVE
        && state.getMissionStage(condition.mission) === condition.stage;
    }
    if ('stageReached' in condition) {
      const target = state.missionStageIndex(condition.mission, condition.stageReached);
      const current = state.missionStageIndex(condition.mission, state.getMissionStage(condition.mission));
      return target >= 0 && current >= target;
    }
    return state.getMissionStatus(condition.mission) === condition.status;
  }

  // Gating on a heard chapter never disagrees with what the book shows.
  if ('story' in condition) {
    return state.hasStoryChapter(condition.story, condition.chapter);
  }

  const player = state.getPlayer();
  const attrs = player.attributes ?? {};

  // day and segment need rules.time, else false. A custom attribute sharing
  // one of these names keeps its meaning through the fallthrough below.
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

  // Worn items count, so equipping a key cannot lock a door.
  if ('item' in condition) {
    const totalCount = state.countPlayerItem(condition.item);
    return condition.count ? totalCount >= condition.count : totalCount > 0;
  }

  if ('level' in condition) return compare(player.level, condition.level);
  if ('gold' in condition) return compare(player.resources.gold, condition.gold);

  // Any declared attribute is a leaf by name.
  for (const key of Object.keys(condition)) {
    if (key in attrs) return compare(attrs[key], condition[key]);
  }

  console.warn('[Gravity] evaluateCondition: unrecognized condition node:', condition);
  return false;
}
