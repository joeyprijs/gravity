import { gameState } from "../core/state.js";
import { MAX_D20_ROLL, LOG } from "../core/config.js";
import { roll } from "./dice.js";

/**
 * Rolls a d20 skill check for the player and logs the outcome.
 * Looks up the player's attribute modifier for skillId, rolls 1d20 + mod,
 * and compares the total against the DC.
 * @param {object} engine - The RPGEngine instance (used for logging/locale).
 * @param {string} skillId - Attribute ID to check (e.g. "perception").
 * @param {number} dc - Difficulty class the roll must meet or exceed.
 * @returns {{rolled: number, mod: number, success: boolean}}
 */
export function performSkillCheck(engine, skillId, dc) {
  const mod = gameState.getPlayer().attributes[skillId] || 0;
  const rolled = roll(1, MAX_D20_ROLL) + mod;
  const success = rolled >= dc;
  engine.log(
    LOG.SYSTEM,
    engine.t(success ? 'actions.skillSuccess' : 'actions.skillFail', { roll: rolled, mod, dc, skill: skillId }),
    success ? 'loot' : 'system'
  );
  return { rolled, mod, success };
}

/**
 * Reads the escalated DC for one check inside a flag-backed DC map, falling
 * back to the base DC when no failures have been recorded yet.
 * @param {string} flagKey - The state flag holding the DC map.
 * @param {string|number} entryKey - Key of the specific check inside the map.
 * @param {number} baseDc - The check's base difficulty from game data.
 * @returns {number}
 */
export function getEscalatedDc(flagKey, entryKey, baseDc) {
  const state = gameState.getFlag(flagKey) || {};
  return state[entryKey] ?? baseDc;
}

/**
 * Records a failed attempt by raising the stored DC for one check by
 * `increment`, so repeat attempts get progressively harder.
 * @param {string} flagKey - The state flag holding the DC map.
 * @param {string|number} entryKey - Key of the specific check inside the map.
 * @param {number} currentDc - The DC that was just attempted.
 * @param {number} [increment=1] - Escalation points to add.
 */
export function escalateDc(flagKey, entryKey, currentDc, increment = 1) {
  const state = gameState.getFlag(flagKey) || {};
  state[entryKey] = currentDc + increment;
  gameState.setFlag(flagKey, state);
}
