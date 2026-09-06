// Pure dice math: rolls, damage-notation parsing, and weighted tables.
// Like condition.js and time.js, this module is DOM- and engine-free so it
// runs directly in node:test.

// A random integer in [min, max], both inclusive.
export function roll(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Picks a random entry from a weighted table, or null for a missing/empty
// table. Each entry may carry an optional `dropWeight` (relative likelihood,
// defaults to 1) — higher means more common, not item carry weight.
export function rollTable(table) {
  if (!table?.entries?.length) return null;
  const totalWeight = table.entries.reduce((sum, e) => sum + (e.dropWeight ?? 1), 0);
  let r = Math.random() * totalWeight;
  for (const entry of table.entries) {
    r -= (entry.dropWeight ?? 1);
    if (r <= 0) return entry;
  }
  return table.entries[table.entries.length - 1];
}

// Rolls a damage notation — standard NdF[+/-M] ("1d6", "2d4+2", "1d8-1") or
// the legacy range syntax ("1-4") — returning the total (clamped to >= 0) and
// a breakdown string of the individual dice ("4+3+2", "3-1").
export function parseDamage(dmgString) {
  if (!dmgString) return { total: 1, string: '1' };

  // Legacy range syntax (e.g., "1-4"). Evaluated first because the standard
  // dice regex does not parse bare hyphens without a 'd' designator.
  if (dmgString.includes('-') && !dmgString.includes('d')) {
    const parts = dmgString.split('-').map(Number);
    const [a, b] = parts;
    // Reject malformed ranges ("1-2-3", "-3", "1-") that would otherwise roll
    // NaN and silently corrupt combat math.
    if (parts.length !== 2 || !Number.isFinite(a) || !Number.isFinite(b)) {
      console.warn(`[Gravity] parseDamage: malformed range "${dmgString}". Defaulting to a flat roll of 1.`);
      return { total: 1, string: '1' };
    }
    // min/max so a descending declaration ("4-1") still rolls a valid range.
    return { total: roll(Math.min(a, b), Math.max(a, b)), string: dmgString };
  }

  const regex = /^(\d+)d(\d+)([\+\-]\d+)?$/;
  const match = dmgString.match(regex);

  if (!match) {
    console.warn(`[Gravity] parseDamage: unrecognized dice format "${dmgString}". Defaulting to a flat roll of 1.`);
    return { total: 1, string: '1' };
  }

  const numDice = parseInt(match[1], 10);
  const diceFaces = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  let totalRoll = 0;
  const rollResults = [];
  for (let i = 0; i < numDice; i++) {
    const r = roll(1, diceFaces);
    totalRoll += r;
    rollResults.push(r);
  }

  // Clamped to >= 0 — negative damage would heal the target.
  const grandTotal = Math.max(0, totalRoll + modifier);

  let rollStr = rollResults.join('+');
  if (modifier > 0) {
    rollStr += `+${modifier}`;
  } else if (modifier < 0) {
    rollStr += `${modifier}`; // Modifier string already carries its own minus sign
  }

  return { total: grandTotal, string: rollStr };
}
