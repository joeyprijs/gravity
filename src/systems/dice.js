// Pure dice math — no DOM, no state, no imports.
// Kept separate so tests can import this module directly without
// loading any part of the engine.

export function roll(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Parses a damage string and returns { total, string } where string is a
// human-readable roll breakdown for the combat log.
//
// Supported formats:
//   "1d6"    — roll one six-sided die
//   "2d4+2"  — roll two d4s and add 2
//   "1d8-1"  — roll one d8 and subtract 1
//   "1-4"    — legacy range syntax (kept for backwards compatibility)
//
// Returns { total: 1, string: "1" } as a safe fallback for unrecognised input.
export function parseDamage(dmgString) {
  if (!dmgString) return { total: 1, string: "1" };

  // Legacy "min-max" range syntax (e.g. "1-4"). Must be checked before the
  // dice regex because it also contains a hyphen.
  if (dmgString.includes('-') && !dmgString.includes('d')) {
    const [a, b] = dmgString.split('-').map(Number);
    return { total: roll(Math.min(a, b), Math.max(a, b)), string: dmgString };
  }

  // Standard dice notation: NdF[+/-M] (e.g. "2d6+3")
  const regex = /^(\d+)d(\d+)([\+\-]\d+)?$/;
  const match = dmgString.match(regex);

  if (!match) {
    console.warn(`[Gravity] parseDamage: unrecognised format "${dmgString}", defaulting to 1`);
    return { total: 1, string: "1" };
  }

  const numDice = parseInt(match[1]);
  const diceFaces = parseInt(match[2]);
  const modifier = match[3] ? parseInt(match[3]) : 0;

  let totalRoll = 0;
  let rollResults = [];

  for (let i = 0; i < numDice; i++) {
    const r = roll(1, diceFaces);
    totalRoll += r;
    rollResults.push(r);
  }

  // Clamp to 0 so negative modifiers never produce negative damage
  const grandTotal = Math.max(0, totalRoll + modifier);

  let rollStr = rollResults.join('+');
  if (modifier > 0) rollStr += `+${modifier}`;
  else if (modifier < 0) rollStr += `${modifier}`;

  return { total: grandTotal, string: rollStr };
}
