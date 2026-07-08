import { GOLD_ITEM_ID, TIMER_SAFE_ACTIONS } from "./config.js";

// Load-time validation of all game data. Pure functions over the loaded data
// object — no DOM, no engine — so authors get fail-fast feedback on boot and
// the checks are testable in plain Node.
//
// validateGameData() returns a flat list of { group, message } issues; the
// engine groups them per source entity when printing (see engine._validateData).

// Attributes an NPC needs to participate in combat without crashing it.
const COMBAT_NPC_ATTRIBUTES = ['healthPoints', 'armorClass', 'actionPoints'];

// Words a condition leaf already uses structurally. A custom attribute sharing
// one of these names is indistinguishable from the built-in leaf (e.g. a
// `{ "gold": 5 }` condition), so the engine — and the Studio condition editor —
// would mis-resolve it. Reserved to prevent that ambiguity.
const RESERVED_CONDITION_KEYS = new Set([
  'and', 'or', 'not', 'flag', 'value', 'item', 'count', 'gold', 'level', 'mission', 'status',
  'time', 'day', 'segment', 'luck',
]);

// The outcome tier names a check's `outcomes` object may define.
const OUTCOME_TIERS = new Set(['critical', 'success', 'partial', 'failure']);

// The defaultCosts kinds the engine charges (see systems/time.js).
const TIME_COST_KINDS = new Set(['navigate', 'skillAttempt', 'fullRest']);

// Whether the game opted into the luck resource.
function hasLuck(rules) {
  return !!rules?.playerDefaults?.resources?.luck;
}

/**
 * Normalizes every NPC's carriedItems to the object form
 * { item: string, amount: number|null } (amount null = unlimited stock).
 * Data files may use the string shorthand (see npc.schema.json); the engine
 * normalizes once at load so every consumer sees a single shape. Runs before
 * validateGameData, which assumes the normalized form. Mutates in place.
 *
 * @param {Object<string, object>} npcs - The loaded NPC database.
 */
export function normalizeCarriedItems(npcs) {
  for (const npc of Object.values(npcs || {})) {
    if (!npc.carriedItems) continue;
    npc.carriedItems = npc.carriedItems.map(entry =>
      typeof entry === 'string'
        ? { item: entry, amount: null }
        : { item: entry.item, amount: entry.amount ?? null }
    );
  }
}

/**
 * Validates all loaded game data and returns the issues found.
 *
 * @param {object} data - The engine's data object ({ items, npcs, scenes, missions, tables, rules, locale }).
 *   NPC carriedItems must already be normalized (see normalizeCarriedItems).
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

// Recursively checks a condition tree for unknown item and mission references
// and for time/luck leaves used without their backing configuration.
function validateCondition(ctx, group, condition, where) {
  if (!condition) return;
  if (condition.and) { condition.and.forEach(c => validateCondition(ctx, group, c, where)); return; }
  if (condition.or)  { condition.or.forEach(c => validateCondition(ctx, group, c, where)); return; }
  if (condition.not) { validateCondition(ctx, group, condition.not, where); return; }
  if ('item' in condition && !ctx.items[condition.item])
    ctx.add(group, `${where}: condition references unknown item "${condition.item}"`);
  if ('mission' in condition && !ctx.missions[condition.mission])
    ctx.add(group, `${where}: condition references unknown mission "${condition.mission}"`);
  if ('day' in condition && !(ctx.rules?.time?.ticksPerDay > 0))
    ctx.add(group, `${where}: condition uses "day" but rules.time.ticksPerDay is not configured — it always evaluates false`);
  if ('segment' in condition) {
    const segments = ctx.rules?.time?.segments;
    if (!segments?.length)
      ctx.add(group, `${where}: condition uses "segment" but rules.time.segments is not configured — it always evaluates false`);
    else if (!segments.some(s => s.id === condition.segment))
      ctx.add(group, `${where}: condition references unknown segment "${condition.segment}"`);
  }
  if ('luck' in condition && !hasLuck(ctx.rules))
    ctx.add(group, `${where}: condition uses "luck" but rules.playerDefaults.resources has no luck — it evaluates against 0`);
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
    if (action.type === 'advance_time' && action.until
        && !ctx.rules?.time?.segments?.some(s => s.id === action.until))
      ctx.add(group, `${where}: advance_time → unknown segment "${action.until}" (check rules.time.segments)`);
    if (action.type === 'set_timer') {
      if (!action.id)
        ctx.add(group, `${where}: set_timer needs an "id"`);
      for (const inner of (action.actions || [])) {
        if (!TIMER_SAFE_ACTIONS.has(inner.type))
          ctx.add(group, `${where}: set_timer "${action.id}" → "${inner.type}" is not allowed in timer pipelines (quiet actions only: ${[...TIMER_SAFE_ACTIONS].join(', ')})`);
      }
      validateActions(ctx, group, action.actions, `${where}: set_timer "${action.id}"`);
    }
    if (action.type === 'restore_luck' && !hasLuck(ctx.rules))
      ctx.add(group, `${where}: restore_luck without a luck resource in rules.playerDefaults.resources is a no-op`);
  }
}

// Validates the check-flavor fields shared by scene skill options and dialogue
// responses: luck gambles, outcome tiers, one-shot markers, attempt budgets.
function validateCheck(ctx, group, check, where) {
  if (check.luckCheck && check.skillCheck)
    ctx.add(group, `${where}: has both luckCheck and skillCheck — pick one`);
  if (check.luckCheck && check.dc)
    ctx.add(group, `${where}: luckCheck takes no DC — the player's own luck is the difficulty`);
  if (check.luckCheck && (check.items || []).length)
    ctx.add(group, `${where}: luckCheck with item drops — the discovery flow never runs on a luck gamble, so the items are unreachable`);
  if (check.luckCheck && !hasLuck(ctx.rules))
    ctx.add(group, `${where}: luckCheck requires a luck resource in rules.playerDefaults.resources`);
  if ('increment' in check || (check.items || []).some(l => 'increment' in l))
    ctx.add(group, `${where}: "increment" (DC escalation) was removed — use maxAttempts, resolveOnce, retry luck costs, or time pressure instead`);
  if (check.resolveOnce && check.maxAttempts)
    ctx.add(group, `${where}: resolveOnce makes maxAttempts redundant (one roll IS the budget)`);
  if (check.onExhausted && !check.maxAttempts)
    ctx.add(group, `${where}: onExhausted never runs without maxAttempts`);
  if (check.maxAttempts && !check.onExhausted && !check.resolveOnce)
    ctx.add(group, `${where}: maxAttempts without onExhausted — the check silently disappears when the budget runs out; consider an authored way out`);
  if (check.outcomes) {
    for (const tierName of Object.keys(check.outcomes)) {
      if (!OUTCOME_TIERS.has(tierName))
        ctx.add(group, `${where}: unknown outcomes tier "${tierName}" (critical, success, partial, failure)`);
    }
    if (check.outcomes.success?.actions && check.actions)
      ctx.add(group, `${where}: both "actions" and outcomes.success.actions — outcomes wins; drop one`);
    if (check.outcomes.failure?.actions && check.onFailure)
      ctx.add(group, `${where}: both "onFailure" and outcomes.failure.actions — outcomes wins; drop one`);
    for (const [tierName, tier] of Object.entries(check.outcomes)) {
      if (tier && typeof tier === 'object')
        validateActions(ctx, group, tier.actions, `${where}: outcomes.${tierName}`);
    }
  }
  validateActions(ctx, group, check.onExhausted, `${where}: onExhausted`);
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
      validateCheck(ctx, group, skill, where);
      validateActions(ctx, group, skill.actions, where);
      validateActions(ctx, group, skill.onFailure, `${where}: onFailure`);
      for (const item of (skill.items || [])) {
        if (item.table && !ctx.tables[item.table])
          ctx.add(group, `${where} references unknown table "${item.table}"`);
        if (item.item && !isKnownItem(ctx, item.item))
          ctx.add(group, `${where} references unknown item "${item.item}"`);
      }
    }

    for (const [i, pc] of (scene.passiveChecks || []).entries()) {
      const where = `passiveCheck #${i + 1}`;
      if (!pc.flag) ctx.add(group, `${where}: missing "flag" — the result has nowhere to go`);
      if (!pc.skillCheck) ctx.add(group, `${where}: missing "skillCheck"`);
      else validateSkillCheck(ctx, group, pc.skillCheck, where);
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
      if (!ctx.items[entry.item]) ctx.add(group, `carriedItems → unknown item "${entry.item}"`);
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
        validateCheck(ctx, group, res, resWhere);
        validateActions(ctx, group, res.actions, resWhere);
        validateActions(ctx, group, res.onFailure, `${resWhere}: onFailure`);
        validateConversationNodeRefs(ctx, group, npc, res.actions, resWhere);
        validateConversationNodeRefs(ctx, group, npc, res.onFailure, resWhere);
        validateConversationNodeRefs(ctx, group, npc, res.onExhausted, resWhere);
        for (const tier of Object.values(res.outcomes || {})) {
          if (tier && typeof tier === 'object')
            validateConversationNodeRefs(ctx, group, npc, tier.actions, resWhere);
        }
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

  // xpPerLevel scales the level-up threshold; a missing or non-positive value
  // makes the threshold 0 and hangs addXP in an infinite loop on the first XP gain.
  if (rules && !(rules.xpPerLevel > 0))
    ctx.add(group, `xpPerLevel must be a positive number (got ${rules.xpPerLevel}) — required for level-up math`);

  for (const role of ['player', 'enemy']) {
    const fallback = rules?.fallbackWeapons?.[role];
    if (fallback && !items[fallback])
      ctx.add(group, `missing required fallback item "${fallback}" — add to data/items/ and index.json`);
  }

  for (const attr of (rules?.customAttributes || [])) {
    if (RESERVED_CONDITION_KEYS.has(attr.id))
      ctx.add(group, `customAttributes "${attr.id}": name is reserved — it collides with a built-in condition leaf and cannot be used as an attribute id`);
    if (!locale?.actions?.skillBadge?.[attr.id])
      ctx.add(group, `customAttributes "${attr.id}": missing locale entry at actions.skillBadge.${attr.id}`);
  }

  for (const stat of (rules?.charCreation?.stats || [])) {
    if (!locale?.charCreation?.stats?.[stat.localeKey])
      ctx.add(group, `charCreation.stats "${stat.id}": missing locale entry at charCreation.stats.${stat.localeKey}`);
  }

  // Time configuration sanity — the clock itself always works; days, segments
  // and default costs only make sense when their config is coherent.
  const time = rules?.time;
  if (time) {
    const hasDayLength = time.ticksPerDay > 0;
    if (!hasDayLength && (time.segments?.length || time.startTick !== undefined))
      ctx.add(group, 'time: segments/startTick need a positive ticksPerDay');
    // startTick is the tick-of-day the game starts at; outside [0, ticksPerDay)
    // the day/segment modulo math produces negative or off-by-a-day results.
    if (hasDayLength && time.startTick !== undefined
        && (typeof time.startTick !== 'number' || time.startTick < 0 || time.startTick >= time.ticksPerDay))
      ctx.add(group, `time.startTick (${time.startTick}) must be a number within [0, ${time.ticksPerDay - 1}]`);
    for (const seg of (time.segments || [])) {
      if (!seg.id || typeof seg.from !== 'number') {
        ctx.add(group, 'time.segments: every segment needs an "id" and a numeric "from"');
        continue;
      }
      if (hasDayLength && (seg.from < 0 || seg.from >= time.ticksPerDay))
        ctx.add(group, `time.segments "${seg.id}": "from" (${seg.from}) must be within [0, ${time.ticksPerDay - 1}]`);
      if (!locale?.time?.segments?.[seg.id])
        ctx.add(group, `time.segments "${seg.id}": missing locale entry at time.segments.${seg.id}`);
    }
    for (const [kind, cost] of Object.entries(time.defaultCosts || {})) {
      if (!TIME_COST_KINDS.has(kind))
        ctx.add(group, `time.defaultCosts: unknown kind "${kind}" (${[...TIME_COST_KINDS].join(', ')})`);
      else if (typeof cost !== 'number' || cost < 0)
        ctx.add(group, `time.defaultCosts.${kind}: must be a non-negative number`);
    }
  }

  // Luck knobs configured without the luck resource silently do nothing —
  // that mismatch is always an authoring mistake.
  if (rules && !hasLuck(rules)) {
    for (const knob of ['skillRetryLuckCost', 'combatLuck', 'fullRestLuckRestore', 'combatLuckMinDamage']) {
      if (rules[knob])
        ctx.add(group, `${knob} is set but rules.playerDefaults.resources has no luck resource — it will do nothing`);
    }
  }
  if (rules?.combatLuckMinDamage && !rules.combatLuck)
    ctx.add(group, 'combatLuckMinDamage is set but combatLuck is off — it will do nothing');
}
