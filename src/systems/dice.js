/**
 * Pure dice mathematics module for Gravity.
 * This file is completely independent of the DOM, state manager, and engine core,
 * allowing it to be imported directly and run synchronously inside unit test runners.
 */

/**
 * Generates a pseudo-random integer between min and max (both inclusive).
 * Uses Math.random() for standard gaming probability distributions.
 * 
 * @param {number} min - The lower bound (inclusive).
 * @param {number} max - The upper bound (inclusive).
 * @returns {number} A random integer within [min, max].
 */
export function roll(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Parses dynamic damage notations and rolls the appropriate physical dice.
 * Supports standard table-top RPG notation (e.g., "1d6", "2d4+2", "1d8-1") 
 * and fallback range syntax (e.g., "1-4").
 * 
 * @param {string} dmgString - The mathematical notation to evaluate.
 * @returns {{total: number, string: string}} An object containing:
 *   - total: The grand sum of all dice rolls + modifiers (clamped to >= 0).
 *   - string: A human-readable breakdown of individual die rolls (e.g., "4+3+2" or "3-1").
 */
export function parseDamage(dmgString) {
  // Safe default fallback in case of null/empty/undefined parameters
  if (!dmgString) return { total: 1, string: "1" };

  // Legacy range syntax (e.g., "1-4"). Evaluated first because the standard
  // dice regex does not parse bare hyphens without a 'd' designator.
  if (dmgString.includes('-') && !dmgString.includes('d')) {
    const parts = dmgString.split('-').map(Number);
    const [a, b] = parts;
    // Reject malformed ranges ("1-2-3", "-3", "1-") that would otherwise roll
    // NaN and silently corrupt combat math.
    if (parts.length !== 2 || !Number.isFinite(a) || !Number.isFinite(b)) {
      console.warn(`[Gravity] parseDamage: malformed range "${dmgString}". Defaulting to a flat roll of 1.`);
      return { total: 1, string: "1" };
    }
    // Sort parameters dynamically to handle descending declarations (e.g., "4-1") safely
    const actualMin = Math.min(a, b);
    const actualMax = Math.max(a, b);
    const rolledValue = roll(actualMin, actualMax);
    return { total: rolledValue, string: dmgString };
  }

  // Standard dice notation regex: NdF[+/-M] (e.g. "2d6+3", "1d20-2")
  // Group 1 (\d+): Number of dice to roll (N)
  // Group 2 (\d+): Number of faces on each die (F)
  // Group 3 ([\+\-]\d+): Optional positive or negative flat modifier (M)
  const regex = /^(\d+)d(\d+)([\+\-]\d+)?$/;
  const match = dmgString.match(regex);

  if (!match) {
    console.warn(`[Gravity] parseDamage: unrecognized dice format "${dmgString}". Defaulting to a flat roll of 1.`);
    return { total: 1, string: "1" };
  }

  const numDice = parseInt(match[1], 10);
  const diceFaces = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  let totalRoll = 0;
  const rollResults = [];

  // Iterative dice roll simulator accumulating results and storing breakdowns
  for (let i = 0; i < numDice; i++) {
    const r = roll(1, diceFaces);
    totalRoll += r;
    rollResults.push(r);
  }

  // Clamped damage calculation to prevent negative values (which would heal the target)
  const grandTotal = Math.max(0, totalRoll + modifier);

  // Compile a highly detailed breakdown string for the combat logging timeline
  let rollStr = rollResults.join('+');
  if (modifier > 0) {
    rollStr += `+${modifier}`;
  } else if (modifier < 0) {
    rollStr += `${modifier}`; // Modifier string already carries its own minus sign
  }

  return { total: grandTotal, string: rollStr };
}
