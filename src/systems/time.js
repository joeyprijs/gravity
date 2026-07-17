// Pure time math for the world clock.
//
// The clock itself is a single monotonic tick counter in state
// (StateManager.advanceTime). Everything here — days, day segments, "ticks
// until morning" — is presentation derived from rules.time, never stored:
//
//   "time": {
//     "ticksPerDay": 24,
//     "startTick": 8,
//     "segments": [ { "id": "morning", "from": 6 }, … ],
//     "defaultCosts": { "navigate": 1, "skillAttempt": 1, "fullRest": 8 }
//   }
//
// Like dice.js, this module is DOM- and engine-free so it runs directly in
// node:test.

/**
 * The tick-of-day for an absolute tick count (0 … ticksPerDay-1).
 * @param {number} ticks - Absolute ticks elapsed since the game started.
 * @param {object} timeRules - rules.time (needs ticksPerDay; startTick optional).
 * @returns {number|null} Null when timeRules can't derive days.
 */
export function getTickOfDay(ticks, timeRules) {
  if (!timeRules?.ticksPerDay || timeRules.ticksPerDay <= 0) return null;
  const start = timeRules.startTick ?? 0;
  return (ticks + start) % timeRules.ticksPerDay;
}

/**
 * The 1-based day number for an absolute tick count.
 * @param {number} ticks - Absolute ticks elapsed since the game started.
 * @param {object} timeRules - rules.time.
 * @returns {number|null} Null when timeRules can't derive days.
 */
export function getDay(ticks, timeRules) {
  if (!timeRules?.ticksPerDay || timeRules.ticksPerDay <= 0) return null;
  const start = timeRules.startTick ?? 0;
  return Math.floor((ticks + start) / timeRules.ticksPerDay) + 1;
}

// getSegment runs on every UI update, but rules.time.segments is static after
// load — cache the sorted copy per segments array (weakly, so a swapped rules
// object never serves a stale ordering).
const sortedSegmentsCache = new WeakMap();

function sortedSegments(segments) {
  let sorted = sortedSegmentsCache.get(segments);
  if (!sorted) {
    sorted = [...segments].sort((a, b) => a.from - b.from);
    sortedSegmentsCache.set(segments, sorted);
  }
  return sorted;
}

/**
 * The id of the day segment an absolute tick count falls into. A tick-of-day
 * before the earliest segment's `from` belongs to the latest segment (it
 * carries over midnight — e.g. "night" running from 22 through to 6).
 * @param {number} ticks - Absolute ticks elapsed since the game started.
 * @param {object} timeRules - rules.time (needs ticksPerDay and segments).
 * @returns {string|null} The segment id, or null when segments aren't configured.
 */
export function getSegment(ticks, timeRules) {
  const tickOfDay = getTickOfDay(ticks, timeRules);
  if (tickOfDay === null || !timeRules.segments?.length) return null;
  const sorted = sortedSegments(timeRules.segments);
  let current = sorted[sorted.length - 1]; // pre-dawn wraps to the last segment
  for (const seg of sorted) {
    if (tickOfDay >= seg.from) current = seg;
  }
  return current.id;
}

/**
 * How many ticks until the NEXT start of the given segment. Never returns 0:
 * asked during the segment itself (or exactly at its start), the answer is the
 * next day's occurrence — "sleep until morning" in the morning sleeps a full day.
 * @param {number} ticks - Absolute ticks elapsed since the game started.
 * @param {object} timeRules - rules.time (needs ticksPerDay and segments).
 * @param {string} segmentId - The segment id to advance to.
 * @returns {number|null} Ticks to advance, or null when it can't be derived.
 */
export function ticksUntilSegment(ticks, timeRules, segmentId) {
  const tickOfDay = getTickOfDay(ticks, timeRules);
  if (tickOfDay === null) return null;
  const seg = timeRules.segments?.find(s => s.id === segmentId);
  if (!seg) return null;
  const delta = (seg.from - tickOfDay + timeRules.ticksPerDay) % timeRules.ticksPerDay;
  return delta === 0 ? timeRules.ticksPerDay : delta;
}

/**
 * Resolves the time cost of a player action: an explicit `timeCost` on the
 * option/skill/response always wins; otherwise the kind's default from
 * rules.time.defaultCosts applies; otherwise the action is free. Without
 * rules.time the whole system stays dormant and only explicit costs charge.
 * @param {number|undefined} explicitCost - The authored timeCost field.
 * @param {string|null} kind - defaultCosts key ('navigate', 'skillAttempt', 'fullRest'), or null for none.
 * @param {object|null} rules - The full rules object (reads rules.time.defaultCosts).
 * @returns {number}
 */
export function resolveTimeCost(explicitCost, kind, rules) {
  if (explicitCost !== undefined) return explicitCost;
  if (!kind) return 0;
  return rules?.time?.defaultCosts?.[kind] ?? 0;
}
