import { GOLD_ITEM_ID } from "./config.js";

// Load-time validation of all game data. Pure functions over the loaded data
// object — no DOM, no engine — so authors get fail-fast feedback on boot and
// the checks are testable in plain Node.
//
// validateGameData() returns a flat list of { group, message } issues; the
// engine groups them per source entity when printing (see engine._validateData).

// Attributes an NPC needs to participate in combat without crashing it.
const COMBAT_NPC_ATTRIBUTES = ['healthPoints', 'armorClass', 'actionPoints'];

/**
 * Validates all loaded game data and returns the issues found.
 *
 * @param {object} data - The engine's data object ({ items, npcs, scenes, missions, tables, rules, locale }).
 * @param {Set<string>} knownActionTypes - Registered action type names (engine._actionRegistry keys).
 * @returns {{group: string, message: string}[]} One entry per issue; empty when the data is clean.
 */
export function validateGameData(data, knownActionTypes) {
  const issues = [];
  const ctx = {
    ...data,
    knownActionTypes,
    knownSkills: collectKnownSkills(data.rules),
    add: (group, message) => issues.push({ group, message }),
  };

  validateTables(ctx);
  validateScenes(ctx);
  validateNpcs(ctx);
  validateRules(ctx);

  return issues;
}

// The set of attribute names a skillCheck may reference: the player's base
// attributes from rules plus every declared custom attribute.
function collectKnownSkills(rules) {
  return new Set([
    ...Object.keys(rules?.playerDefaults?.attributes ?? {}),
    ...(rules?.customAttributes ?? []).map(a => a.id),
  ]);
}

function isKnownItem(ctx, itemId) {
  return itemId === GOLD_ITEM_ID || !!ctx.items[itemId];
}

// Recursively checks a condition tree for unknown item and mission references.
function validateCondition(ctx, group, condition, where) {
  if (!condition) return;
  if (condition.and) { condition.and.forEach(c => validateCondition(ctx, group, c, where)); return; }
  if (condition.or)  { condition.or.forEach(c => validateCondition(ctx, group, c, where)); return; }
  if (condition.not) { validateCondition(ctx, group, condition.not, where); return; }
  if ('item' in condition && !ctx.items[condition.item])
    ctx.add(group, `${where}: condition references unknown item "${condition.item}"`);
  if ('mission' in condition && !ctx.missions[condition.mission])
    ctx.add(group, `${where}: condition references unknown mission "${condition.mission}"`);
}

function validateSkillCheck(ctx, group, skillCheck, where) {
  if (skillCheck && !ctx.knownSkills.has(skillCheck))
    ctx.add(group, `${where}: unknown skillCheck "${skillCheck}" — checks roll with modifier 0; declare it in rules.customAttributes or playerDefaults.attributes`);
}

// Checks the NPCs referenced as enemies: they must exist and carry the
// attributes combat reads, otherwise the encounter crashes mid-fight.
function validateEnemyList(ctx, group, enemyIds, where) {
  for (const id of (enemyIds || [])) {
    const npc = ctx.npcs[id];
    if (!npc) {
      ctx.add(group, `${where} → unknown enemy "${id}"`);
      continue;
    }
    const missing = COMBAT_NPC_ATTRIBUTES.filter(attr => npc.attributes?.[attr] == null);
    if (missing.length)
      ctx.add(group, `${where} → enemy "${id}" is missing combat attributes: ${missing.join(', ')}`);
  }
}

// Validates a scene-option action pipeline (also used for onVictory pipelines).
function validateActions(ctx, group, actions, where) {
  for (const action of (actions || [])) {
    if (!ctx.knownActionTypes.has(action.type))
      ctx.add(group, `${where}: unknown action type "${action.type}"`);
    if (action.type === 'navigate' && action.destination && !ctx.scenes[action.destination])
      ctx.add(group, `${where}: navigate → unknown destination "${action.destination}"`);
    if (action.type === 'loot' && action.item && !isKnownItem(ctx, action.item))
      ctx.add(group, `${where}: loot → unknown item "${action.item}"`);
    if (action.type === 'dialogue' && action.npc && !ctx.npcs[action.npc])
      ctx.add(group, `${where}: dialogue → unknown NPC "${action.npc}"`);
    if (action.type === 'combat') {
      validateEnemyList(ctx, group, action.enemies, `${where}: combat`);
      validateActions(ctx, group, action.onVictory, `${where}: combat.onVictory`);
    }
  }
}

function validateTables(ctx) {
  for (const [tableId, table] of Object.entries(ctx.tables || {})) {
    for (const entry of (table.entries || [])) {
      if (entry.item && !isKnownItem(ctx, entry.item))
        ctx.add(`Table "${tableId}"`, `entry references unknown item "${entry.item}"`);
    }
  }
}

function validateScenes(ctx) {
  for (const [sceneId, scene] of Object.entries(ctx.scenes)) {
    const group = `Scene "${sceneId}"`;

    for (const skill of (scene.skills || [])) {
      const where = `skill "${skill.text}"`;
      validateCondition(ctx, group, skill.condition, where);
      validateSkillCheck(ctx, group, skill.skillCheck, where);
      for (const item of (skill.items || [])) {
        if (item.table && !ctx.tables[item.table])
          ctx.add(group, `${where} references unknown table "${item.table}"`);
        if (item.item && !isKnownItem(ctx, item.item))
          ctx.add(group, `${where} references unknown item "${item.item}"`);
      }
    }

    for (const opt of (scene.options || [])) {
      const where = `option "${opt.text}"`;
      validateCondition(ctx, group, opt.condition, where);
      if (opt.requirements?.item && !ctx.items[opt.requirements.item])
        ctx.add(group, `${where} requires unknown item "${opt.requirements.item}"`);
      validateActions(ctx, group, opt.actions, where);
    }

    if (scene.autoAttack) {
      validateEnemyList(ctx, group, scene.autoAttack.enemies, 'autoAttack');
      validateActions(ctx, group, scene.autoAttack.onVictory, 'autoAttack.onVictory');
    }
  }
}

function validateNpcs(ctx) {
  for (const [npcId, npc] of Object.entries(ctx.npcs)) {
    const group = `NPC "${npcId}"`;

    for (const entry of (npc.carriedItems || [])) {
      const itemId = typeof entry === 'string' ? entry : entry.item;
      if (!ctx.items[itemId]) ctx.add(group, `carriedItems → unknown item "${itemId}"`);
    }

    for (const [slot, itemId] of Object.entries(npc.equipment || {})) {
      if (itemId && !ctx.items[itemId]) ctx.add(group, `equipment[${slot}] → unknown item "${itemId}"`);
    }

    for (const [nodeId, node] of Object.entries(npc.conversations || {})) {
      const where = `conversation node "${nodeId}"`;
      validateActions(ctx, group, node.actions, where);
      validateConversationNodeRefs(ctx, group, npc, node.actions, where);

      for (const res of (node.responses || [])) {
        const resWhere = `${where}, response "${res.text}"`;
        validateCondition(ctx, group, res.condition, resWhere);
        if (res.skillCheck && res.dc > 0) validateSkillCheck(ctx, group, res.skillCheck, resWhere);
        validateActions(ctx, group, res.actions, resWhere);
        validateConversationNodeRefs(ctx, group, npc, res.actions, resWhere);
        validateConversationNodeRefs(ctx, group, npc, res.onFailure, resWhere);
      }
    }
  }
}

function validateConversationNodeRefs(ctx, group, npc, actions, where) {
  for (const action of (actions || [])) {
    if (action.type === 'goToConversation' && !npc.conversations?.[action.node])
      ctx.add(group, `${where}: goToConversation → unknown node "${action.node}"`);
  }
}

function validateRules(ctx) {
  const { rules, items, locale } = ctx;
  const group = 'Rules';

  for (const role of ['player', 'enemy']) {
    const fallback = rules?.fallbackWeapons?.[role];
    if (fallback && !items[fallback])
      ctx.add(group, `missing required fallback item "${fallback}" — add to data/items/ and index.json`);
  }

  for (const attr of (rules?.customAttributes || [])) {
    if (!locale?.actions?.skillBadge?.[attr.id])
      ctx.add(group, `customAttributes "${attr.id}": missing locale entry at actions.skillBadge.${attr.id}`);
  }

  for (const stat of (rules?.charCreation?.stats || [])) {
    if (!locale?.charCreation?.stats?.[stat.localeKey])
      ctx.add(group, `charCreation.stats "${stat.id}": missing locale entry at charCreation.stats.${stat.localeKey}`);
  }
}
