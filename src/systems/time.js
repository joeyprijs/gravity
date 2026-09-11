// Pure time math. The clock is one tick counter in state; days, segments,
// and "ticks until morning" derive from rules.time:
//
//   "time": {
//     "ticksPerDay": 24,
//     "startTick": 8,
//     "segments": [ { "id": "morning", "from": 6 }, … ],
//     "defaultCosts": { "navigate": 1, "skillAttempt": 1, "fullRest": 8 }
//   }
//
// The clock helpers return null without a positive ticksPerDay.

// 0 … ticksPerDay-1.
export function getTickOfDay(ticks, timeRules) {
  if (!timeRules?.ticksPerDay || timeRules.ticksPerDay <= 0) return null;
  const start = timeRules.startTick ?? 0;
  return (ticks + start) % timeRules.ticksPerDay;
}

// 1-based.
export function getDay(ticks, timeRules) {
  if (!timeRules?.ticksPerDay || timeRules.ticksPerDay <= 0) return null;
  const start = timeRules.startTick ?? 0;
  return Math.floor((ticks + start) / timeRules.ticksPerDay) + 1;
}

// A tick before the earliest segment's `from` belongs to the latest, which
// carries over midnight.
export function getSegment(ticks, timeRules) {
  const tickOfDay = getTickOfDay(ticks, timeRules);
  if (tickOfDay === null || !timeRules.segments?.length) return null;
  const sorted = [...timeRules.segments].sort((a, b) => a.from - b.from);
  let current = sorted[sorted.length - 1]; // pre-dawn wraps to the last segment
  for (const seg of sorted) {
    if (tickOfDay >= seg.from) current = seg;
  }
  return current.id;
}

// Never 0: asked during the segment, the answer is tomorrow's.
export function ticksUntilSegment(ticks, timeRules, segmentId) {
  const tickOfDay = getTickOfDay(ticks, timeRules);
  if (tickOfDay === null) return null;
  const seg = timeRules.segments?.find(s => s.id === segmentId);
  if (!seg) return null;
  const delta = (seg.from - tickOfDay + timeRules.ticksPerDay) % timeRules.ticksPerDay;
  return delta === 0 ? timeRules.ticksPerDay : delta;
}

// An explicit timeCost wins; else the kind's rules.time.defaultCosts entry;
// else 0.
export function resolveTimeCost(explicitCost, kind, rules) {
  if (explicitCost !== undefined) return explicitCost;
  if (!kind) return 0;
  return rules?.time?.defaultCosts?.[kind] ?? 0;
}
