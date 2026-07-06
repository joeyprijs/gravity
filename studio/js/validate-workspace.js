// Validate the current in-memory workspace the same way the engine validates
// loaded data, plus Studio's extra dialogue-"start"-node check. Shared by the
// toolbar Validate button and the live-preview status strip.
import { store } from './store.js';
import { ACTION_TYPES } from './contracts.js';
import { validateGameData, normalizeCarriedItems } from '../../src/core/validate.js';

function collectType(prefix) {
  const out = {};
  for (const [key, value] of Object.entries(store.files)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

/** @returns {Array<{group: string, message: string}>} validation issues. */
export function gatherIssues() {
  // NPCs are cloned because the engine's carriedItems normalization rewrites
  // them in place — validation must not touch the editor's data.
  const npcs = structuredClone(collectType('npcs:'));
  normalizeCarriedItems(npcs);
  const data = {
    items: collectType('items:'),
    npcs,
    scenes: collectType('scenes:'),
    missions: collectType('missions:'),
    tables: collectType('tables:'),
    rules: store.files['__rules'] ?? {},
    locale: store.locale,
  };
  const knownActionTypes = new Set([...ACTION_TYPES.map(([t]) => t), ...store.actionTypes]);
  const issues = validateGameData(data, knownActionTypes);

  // Studio extra: the engine hardwires dialogue to open at the "start" node.
  for (const [id, npc] of Object.entries(npcs)) {
    const convs = npc.conversations ?? {};
    if (Object.keys(convs).length > 0 && !convs.start) {
      issues.push({
        group: `NPC "${id}"`,
        message: 'has conversations but no "start" node — the engine opens dialogue at "start"',
      });
    }
  }
  return issues;
}
