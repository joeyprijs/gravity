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
// `{ "gold": 5 }` condition), so the engine would mis-resolve it. Reserved to
// prevent that ambiguity.
const RESERVED_CONDITION_KEYS = new Set([
  'and', 'or', 'not', 'flag', 'value', 'item', 'count', 'gold', 'level', 'mission', 'status',
  'time', 'day', 'segment',
]);

// The removed 2d6 Test-Your-Luck subsystem's authoring surface. Luck is a
// plain custom attribute now (d20 + luck vs DC, like every other check);
// these fields are flagged so old data gets a pointer instead of silence.
const REMOVED_LUCK_RULE_KEYS = [
  'luck', 'combatLuck', 'combatLuckMinDamage', 'skillRetryLuckCost', 'fullRestLuckRestore',
];

// The outcome tier names a check's `outcomes` object may define.
const OUTCOME_TIERS = new Set(['critical', 'success', 'partial', 'failure']);

// The defaultCosts kinds the engine charges (see systems/time.js).
const TIME_COST_KINDS = new Set(['navigate', 'skillAttempt', 'fullRest']);

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
  validateItems(ctx);
  validateRules(ctx);

  return issues;
}

// Items: attribute references must name declared attributes (playerDefaults
// attributes or customAttributes) — a typo'd attackAttribute silently rolls
// +0 and a typo'd attributeBonuses key silently does nothing on equip.
function validateItems(ctx) {
  for (const [id, item] of Object.entries(ctx.items ?? {})) {
    const group = `Item "${id}"`;
    const attackAttr = item.attributes?.attackAttribute;
    if (attackAttr && !ctx.knownSkills.has(attackAttr))
      ctx.add(group, `attributes.attackAttribute "${attackAttr}" is not a declared attribute (playerDefaults.attributes or customAttributes)`);
    if (item.attackAttribute !== undefined)
      ctx.add(group, 'attackAttribute moved into the attributes object — write attributes.attackAttribute');
    if (item.actionPoints !== undefined)
      ctx.add(group, 'actionPoints moved into the attributes object — write attributes.actionPoints');
    if (item.reputation !== undefined)
      ctx.add(group, 'reputation moved into the attributes object — write attributes.reputation');
    if (item.bonusHitChance !== undefined)
      ctx.add(group, 'bonusHitChance was removed — accuracy comes from the wielder\'s attackAttribute; model an accurate weapon as attributeBonuses on the governing attribute');
    for (const key of Object.keys(item.attributes?.attributeBonuses ?? {})) {
      if (!ctx.knownSkills.has(key))
        ctx.add(group, `attributeBonuses key "${key}" is not a declared attribute (playerDefaults.attributes or customAttributes)`);
    }
  }
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
// and for time leaves used without their backing configuration.
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
    if (action.type === 'restore_luck')
      ctx.add(group, `${where}: "restore_luck" was removed with the 2d6 luck subsystem — model luck as a custom attribute instead`);
    if (action.type === 'modify_resource') {
      const res = ctx.rules?.playerDefaults?.resources?.[action.resource];
      if (!action.resource)
        ctx.add(group, `${where}: modify_resource needs a "resource" — the currency it moves`);
      else if (!(res && typeof res === 'object' && 'current' in res))
        ctx.add(group, `${where}: modify_resource resource "${action.resource}" is not a declared { current, max } resource in playerDefaults.resources`);
    }
  }
}

// Collects the flags a condition tree requires to be false — the shape of a
// self-gating check ("success sets flag X; the check requires X false").
function collectFalseFlagGates(condition, out = new Set()) {
  if (!condition) return out;
  (condition.and || []).forEach(c => collectFalseFlagGates(c, out));
  (condition.or || []).forEach(c => collectFalseFlagGates(c, out));
  if (condition.not && 'flag' in condition.not && condition.not.value === true)
    out.add(condition.not.flag);
  if ('flag' in condition && condition.value === false) out.add(condition.flag);
  return out;
}

// A success that rewards loot but never retires the check is farmable: the
// player re-rolls it for duplicate rewards. A check avoids the warning by
// being resolveOnce, or by gating itself on a flag its own success sets.
function warnIfSuccessFarmable(ctx, group, check, where) {
  if (check.resolveOnce || !(check.dc > 0)) return;
  const successTiers = [check.outcomes?.success, check.outcomes?.critical];
  const legacySuccess = check.actions || [];
  const successActions = successTiers.flatMap(t => t?.actions || []).concat(legacySuccess);
  if (!successActions.some(a => a.type === 'loot')) return;
  const gates = collectFalseFlagGates(check.condition);
  const setsOwnGate = successActions.some(a =>
    a.type === 'set_flag' && a.value === true && gates.has(a.flag));
  if (!setsOwnGate)
    ctx.add(group, `${where}: success loots a reward but nothing retires the check — it can be re-rolled for duplicates. Add resolveOnce, or gate the check on a flag its success sets (condition { "flag": X, "value": false } + success set_flag X).`);
}

// Validates the check-flavor fields shared by scene skill options and dialogue
// responses: outcome tiers, one-shot markers, attempt budgets.
function validateCheck(ctx, group, check, where) {
  warnIfSuccessFarmable(ctx, group, check, where);
  if (check.luckCheck)
    ctx.add(group, `${where}: "luckCheck" (the 2d6 Test-Your-Luck gamble) was removed — use a d20 check against a luck custom attribute ("skillCheck": "luck" with a dc) instead`);
  if ('increment' in check || (check.items || []).some(l => 'increment' in l))
    ctx.add(group, `${where}: "increment" (DC escalation) was removed — use maxAttempts, resolveOnce, or time pressure instead`);
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

    // A combat-capable NPC whose weapon rolls an attackAttribute needs that
    // attribute in its stat block — otherwise it silently attacks at +0.
    // Checks the equipped weapons plus the fallback claw NPCs without
    // weapons swing with.
    if (npc.attributes?.healthPoints !== undefined) {
      const wielded = Object.values(npc.equipment || {}).filter(Boolean);
      if (!wielded.length && ctx.rules?.fallbackWeapons?.enemy) wielded.push(ctx.rules.fallbackWeapons.enemy);
      for (const itemId of wielded) {
        const attr = ctx.items[itemId]?.attributes?.attackAttribute;
        if (attr && npc.attributes[attr] === undefined)
          ctx.add(group, `wields "${itemId}" (attackAttribute "${attr}") but declares no ${attr} attribute — its attacks roll +0; add "${attr}" to the NPC's attributes`);
      }
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
    if (!locale?.actions?.skillBadgeFree?.[attr.id])
      ctx.add(group, `customAttributes "${attr.id}": missing locale entry at actions.skillBadgeFree.${attr.id} — roll breakdowns fall back to the capitalized id`);
    if (attr.max !== undefined && !(typeof attr.max === 'number' && attr.max >= (attr.default ?? 0)))
      ctx.add(group, `customAttributes "${attr.id}": max must be a number ≥ its default`);
  }
  // Skill-check badges always append the shared DC line (see skillBadge).
  if ((rules?.customAttributes || []).length && !locale?.actions?.skillBadgeDc)
    ctx.add(group, 'missing locale entry at actions.skillBadgeDc — skill-check badges render the raw key as their DC line');
  if (rules?.skillRetry?.resource && !locale?.actions?.badgeRetryCost)
    ctx.add(group, 'skillRetry: missing locale entry at actions.badgeRetryCost — retry badges render the raw key');

  // Level-up point buy: statPoints must be a non-negative integer —
  // spendStatPoint's whole-point math breaks on fractional banks.
  if (rules?.levelUp?.statPoints !== undefined && !(Number.isInteger(rules.levelUp.statPoints) && rules.levelUp.statPoints >= 0))
    ctx.add(group, 'levelUp.statPoints must be a non-negative integer');

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

  // The 2d6 luck subsystem was removed — its rules knobs and resource are
  // inert. Point authors at the replacements (a luck custom attribute for
  // rolls; rules.skillRetry for a spend-to-retry currency).
  for (const key of REMOVED_LUCK_RULE_KEYS) {
    if (rules?.[key] !== undefined)
      ctx.add(group, `rules.${key} belongs to the removed 2d6 luck subsystem — model luck as a custom attribute (d20 vs DC), or a retry currency via rules.skillRetry`);
  }
  if (rules?.playerDefaults?.resources?.luck !== undefined)
    ctx.add(group, 'playerDefaults.resources.luck belongs to the removed 2d6 luck subsystem — declare luck in customAttributes, or a retry-currency resource named something else');

  const declaredResources = rules?.playerDefaults?.resources ?? {};
  const isResource = (id) => {
    const r = declaredResources[id];
    return r && typeof r === 'object' && 'current' in r;
  };

  // Retry currency: rules.skillRetry.resource must be a declared { current, max }
  // resource, cost positive, restRestore non-negative.
  const retry = rules?.skillRetry;
  if (retry) {
    if (!retry.resource)
      ctx.add(group, 'skillRetry needs a "resource" — the currency a retry spends');
    else if (!isResource(retry.resource))
      ctx.add(group, `skillRetry.resource "${retry.resource}" is not a declared { current, max } resource in playerDefaults.resources`);
    if (!(retry.cost > 0))
      ctx.add(group, 'skillRetry.cost must be a positive number');
    if (retry.restRestore !== undefined && !(retry.restRestore >= 0))
      ctx.add(group, 'skillRetry.restRestore must be a non-negative number');
  }

  // headerResources render in the scene top bar and the sheet's character
  // section: every id must be a declared resource with a display label.
  for (const id of (rules?.headerResources ?? [])) {
    if (!isResource(id))
      ctx.add(group, `headerResources "${id}" is not a declared { current, max } resource in playerDefaults.resources`);
    if (!locale?.ui?.resources?.[id])
      ctx.add(group, `headerResources "${id}": missing locale entry at ui.resources.${id}`);
  }

  // The save/load/restart buttons only render inside an options-widget tab —
  // a tabs list without one leaves the player unable to save or restart.
  if (rules?.tabs && !rules.tabs.some(t => t?.widget === 'options'))
    ctx.add(group, 'tabs: no tab with widget "options" — the save/load/restart buttons render nowhere');

  // AP economy: value sanity, plus warnings for the two classic foot-guns —
  // a player who can never recover AP, and a turn cap no attack fits under.
  const eco = rules?.apEconomy;
  const attackItems = Object.values(items ?? {}).filter(i => i.type === 'Weapon' || i.type === 'Spell');
  if (eco) {
    const refillLike = (v) => v === undefined || v === 'full' || (typeof v === 'number' && v >= 0);
    if (!refillLike(eco.refillPerRound))
      ctx.add(group, 'apEconomy.refillPerRound must be "full" or a non-negative number');
    if (!refillLike(eco.restRestore))
      ctx.add(group, 'apEconomy.restRestore must be "full" or a non-negative number');
    for (const key of ['minPerTurn', 'maxPerTurn', 'skillAttemptCost']) {
      if (eco[key] !== undefined && !(typeof eco[key] === 'number' && eco[key] >= 0))
        ctx.add(group, `apEconomy.${key} must be a non-negative number`);
    }

    // The stranding hazard is per-fight: with no per-round income and no
    // floor, a player who empties their pool mid-combat can never act again
    // that fight, whatever the out-of-combat recovery valves are.
    if (eco.refillPerRound === 0 && !(eco.minPerTurn > 0))
      ctx.add(group, 'apEconomy: refillPerRound 0 with no minPerTurn floor — a player who empties their AP mid-fight can never act again for the rest of that combat; add a minPerTurn floor or a per-round refill');

    const positiveCosts = attackItems.map(i => i.attributes?.actionPoints ?? 0).filter(c => c > 0);
    if (eco.maxPerTurn > 0 && positiveCosts.length && Math.min(...positiveCosts) > eco.maxPerTurn)
      ctx.add(group, `apEconomy.maxPerTurn ${eco.maxPerTurn} is below every weapon/spell AP cost — the player can never act in combat`);
  }

  // Every weapon/spell at 0 AP means combat turns never end on their own —
  // the End Turn button becomes the only handoff. Usually an authoring slip.
  if (attackItems.length && attackItems.every(i => !(i.attributes?.actionPoints > 0)))
    ctx.add(group, 'every Weapon/Spell has an AP cost of 0 — combat turns will never end automatically (End Turn becomes the only handoff)');
}
