import { GOLD_ITEM_ID, ITEM_TYPES, TIMER_SAFE_ACTIONS, HAND_SLOT_KIND } from './config.js';
import { ICON_NAMES } from './icons.js';
import { isResourcePool } from './utils.js';

// Load-time validation of the game data: pure functions returning
// { group, message } issues, which the engine prints grouped per entity.

// What an NPC needs to fight without crashing combat.
const COMBAT_NPC_ATTRIBUTES = ['healthPoints', 'armorClass', 'actionPoints'];

// A custom attribute named like a condition leaf would be mis-resolved.
const RESERVED_CONDITION_KEYS = new Set([
  'and', 'or', 'not', 'flag', 'value', 'item', 'count', 'gold', 'level', 'mission', 'status',
  'stage', 'stageReached', 'time', 'day', 'segment', 'story', 'chapter',
]);

const OUTCOME_TIERS = new Set(['critical', 'success', 'partial', 'failure']);

// The defaultCosts kinds the engine charges.
const TIME_COST_KINDS = new Set(['navigate', 'skillAttempt', 'fullRest']);

// carriedItems to { item, amount } (null: unlimited) in place, so every
// consumer sees one shape; the string shorthand is authoring convenience.
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

// knownActionTypes are the registered action names; carriedItems must be
// normalized already.
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
  validateEquipmentSlots(ctx);
  validateNpcs(ctx);
  validateItems(ctx);
  validateMissions(ctx);
  validateRules(ctx);

  return issues;
}

// not_started is never a transition target.
const TRIGGER_STATUSES = new Set(['active', 'complete', 'failed']);

// A known mission, and exactly one of a valid status or a known stage.
function validateQuestTrigger(ctx, group, trigger, where) {
  const mission = ctx.missions[trigger.mission];
  if (!trigger.mission)
    ctx.add(group, `${where}: missing "mission"`);
  else if (!mission)
    ctx.add(group, `${where}: unknown mission "${trigger.mission}"`);
  if (!trigger.status && !trigger.stage)
    ctx.add(group, `${where}: needs a "status" or a "stage" — nothing to transition to`);
  if (trigger.status && trigger.stage)
    ctx.add(group, `${where}: has both "status" and "stage" — a trigger does one transition; use two triggers`);
  if (trigger.status && !TRIGGER_STATUSES.has(trigger.status))
    ctx.add(group, `${where}: unknown status "${trigger.status}" (${[...TRIGGER_STATUSES].join(', ')})`);
  if (trigger.stage && mission && !(mission.stages ?? []).some(s => s.id === trigger.stage))
    ctx.add(group, `${where}: unknown stage "${trigger.stage}" on mission "${trigger.mission}"`);
}

function validateMissions(ctx) {
  for (const [mId, mission] of Object.entries(ctx.missions ?? {})) {
    const group = `Mission "${mId}"`;
    if (mission.stages === undefined) continue;
    if (!Array.isArray(mission.stages) || !mission.stages.length) {
      ctx.add(group, 'stages must be a non-empty array — omit it entirely for a stageless mission');
      continue;
    }
    const seen = new Set();
    mission.stages.forEach((stage, i) => {
      const where = `stage #${i + 1}`;
      if (!stage.id) ctx.add(group, `${where}: missing "id"`);
      else if (seen.has(stage.id)) ctx.add(group, `${where}: duplicate stage id "${stage.id}"`);
      seen.add(stage.id);
      if (!stage.description)
        ctx.add(group, `${where}: missing "description" — the quest log and stage-advance line have nothing to show`);
      validateCondition(ctx, group, stage.advanceWhen, `${where} advanceWhen`);
    });
  }
}

// Guarded, so a malformed declaration reports once instead of throwing everywhere.
function declaredSlotList(rules) {
  const slots = rules?.playerDefaults?.equipmentSlots;
  return Array.isArray(slots) ? slots.filter(slot => slot && typeof slot.id === 'string') : [];
}

// Without a `hand` slot the game has no way to fight.
function validateEquipmentSlots(ctx) {
  const group = 'Rules';
  const slots = ctx.rules?.playerDefaults?.equipmentSlots;
  if (!Array.isArray(slots) || !slots.length) {
    ctx.add(group, 'playerDefaults.equipmentSlots must be a non-empty array of { id, kind } — the player has nowhere to equip anything');
    return;
  }
  const seen = new Set();
  for (const slot of slots) {
    if (!slot || typeof slot.id !== 'string' || !slot.id)
      { ctx.add(group, `equipmentSlots: every slot needs a string id (got ${JSON.stringify(slot)})`); continue; }
    if (typeof slot.kind !== 'string' || !slot.kind)
      ctx.add(group, `equipmentSlots "${slot.id}": missing kind — items target a kind, so a slot without one can never be filled`);
    if (seen.has(slot.id)) ctx.add(group, `equipmentSlots: duplicate slot id "${slot.id}"`);
    seen.add(slot.id);
    if (!ctx.locale?.ui?.equipmentSlots?.[slot.id])
      ctx.add(group, `equipmentSlots "${slot.id}": missing locale entry at ui.equipmentSlots.${slot.id}`);
  }
  if (!slots.some(slot => slot?.kind === HAND_SLOT_KIND))
    ctx.add(group, `equipmentSlots: no slot of kind "${HAND_SLOT_KIND}" — weapons and spells would have nowhere to go and combat could never render an attack`);
  for (const kind of new Set(slots.map(slot => slot?.kind).filter(Boolean))) {
    if (!ctx.locale?.itemStats?.slotKinds?.[kind])
      ctx.add(group, `equipmentSlots: missing locale entry at itemStats.slotKinds.${kind} — item cards would print the raw kind id`);
  }
}

// Every typo here fails silently in play: an unequippable item, a slot that
// does not exist, an attack at +0, a bonus that never applies.
function validateItems(ctx) {
  // An item names a slot kind, not a slot.
  const declaredKinds = new Set(declaredSlotList(ctx.rules).map(slot => slot.kind));
  for (const [id, item] of Object.entries(ctx.items ?? {})) {
    const group = `Item "${id}"`;
    if (item.type !== undefined && !ITEM_TYPES.has(item.type))
      ctx.add(group, `type "${item.type}" is not a known item type (${[...ITEM_TYPES].join(', ')})`);
    if (item.slot !== undefined && declaredKinds.size && !declaredKinds.has(item.slot))
      ctx.add(group, `slot "${item.slot}" is not a declared equipment slot kind (playerDefaults.equipmentSlots kinds: ${[...declaredKinds].join(', ') || 'none'})`);
    const attackAttr = item.attributes?.attackAttribute;
    if (attackAttr && !ctx.knownSkills.has(attackAttr))
      ctx.add(group, `attributes.attackAttribute "${attackAttr}" is not a declared attribute (playerDefaults.attributes or customAttributes)`);
    const damageAttr = item.attributes?.damageAttribute;
    if (damageAttr && !ctx.knownSkills.has(damageAttr))
      ctx.add(group, `attributes.damageAttribute "${damageAttr}" is not a declared attribute (playerDefaults.attributes or customAttributes)`);
    const targets = item.attributes?.targets;
    if (targets !== undefined && targets !== 'all' && !(Number.isInteger(targets) && targets >= 2))
      ctx.add(group, `attributes.targets must be "all" or an integer >= 2 (got ${JSON.stringify(targets)})`);
    const uses = item.attributes?.uses;
    if (uses !== undefined) {
      if (!Number.isInteger(uses?.max) || uses.max < 1)
        ctx.add(group, `attributes.uses.max must be a positive integer (got ${JSON.stringify(uses?.max)})`);
      if (uses?.refresh !== undefined && uses.refresh !== 'short_rest' && uses.refresh !== 'full_rest')
        ctx.add(group, `attributes.uses.refresh must be "short_rest" or "full_rest" (got ${JSON.stringify(uses.refresh)})`);
    }
    for (const key of Object.keys(item.attributes?.attributeBonuses ?? {})) {
      if (!ctx.knownSkills.has(key))
        ctx.add(group, `attributeBonuses key "${key}" is not a declared attribute (playerDefaults.attributes or customAttributes)`);
    }
    // A bad grant drops out of the attack list without a word.
    const granted = item.attributes?.grantsSpells;
    if (granted !== undefined && !Array.isArray(granted))
      ctx.add(group, `attributes.grantsSpells must be an array of item ids (got ${JSON.stringify(granted)})`);
    for (const spellId of (Array.isArray(granted) ? granted : [])) {
      if (!ctx.items[spellId])
        ctx.add(group, `attributes.grantsSpells → unknown item "${spellId}"`);
      else if (ctx.items[spellId].type !== 'Spell')
        ctx.add(group, `attributes.grantsSpells → "${spellId}" is type "${ctx.items[spellId].type}", not "Spell" — only a Spell can be granted`);
    }
    validateStory(ctx, group, item);
  }
}

// Chapters are uniquely id'd { id, text }; story and type Book come as a pair.
function validateStory(ctx, group, item) {
  if (item.story === undefined) {
    if (item.type === 'Book')
      ctx.add(group, 'is type "Book" but declares no story — there is nothing to read in it');
    return;
  }
  const chapters = item.story?.chapters;
  if (!Array.isArray(chapters) || !chapters.length) {
    ctx.add(group, 'story.chapters must be a non-empty array of { id, text }');
    return;
  }
  const seen = new Set();
  chapters.forEach((ch, i) => {
    const where = `story chapter #${i + 1}`;
    if (!ch?.id) ctx.add(group, `${where}: missing "id"`);
    else if (seen.has(ch.id)) ctx.add(group, `${where}: duplicate chapter id "${ch.id}"`);
    if (ch?.id) seen.add(ch.id);
    if (!ch?.text) ctx.add(group, `${where}: missing "text" — reading the book would print nothing for it`);
  });
  if (item.type !== 'Book')
    ctx.add(group, `declares a story but is type "${item.type}" — make it "Book" so its card reads from the pack`);
}

// playerDefaults.attributes plus customAttributes.
function collectKnownSkills(rules) {
  return new Set([
    ...Object.keys(rules?.playerDefaults?.attributes ?? {}),
    ...(rules?.customAttributes ?? []).map(a => a.id),
  ]);
}

function isKnownItem(ctx, itemId) {
  return itemId === GOLD_ITEM_ID || !!ctx.items[itemId];
}

// Unknown references, and time leaves without their rules.time backing.
function validateCondition(ctx, group, condition, where) {
  if (!condition) return;
  if (condition.and) { condition.and.forEach(c => validateCondition(ctx, group, c, where)); return; }
  if (condition.or)  { condition.or.forEach(c => validateCondition(ctx, group, c, where)); return; }
  if (condition.not) { validateCondition(ctx, group, condition.not, where); return; }
  if ('item' in condition && !ctx.items[condition.item])
    ctx.add(group, `${where}: condition references unknown item "${condition.item}"`);
  if ('mission' in condition) {
    const mission = ctx.missions[condition.mission];
    if (!mission)
      ctx.add(group, `${where}: condition references unknown mission "${condition.mission}"`);
    const stageRef = condition.stage ?? condition.stageReached;
    if (stageRef !== undefined && mission && !(mission.stages ?? []).some(s => s.id === stageRef))
      ctx.add(group, `${where}: condition references unknown stage "${stageRef}" on mission "${condition.mission}"`);
    if ('stage' in condition && 'status' in condition)
      ctx.add(group, `${where}: condition has both "stage" and "status" — "stage" already implies active; the "status" is ignored`);
  }
  if ('story' in condition) {
    const storyItem = ctx.items[condition.story];
    if (!storyItem?.story)
      ctx.add(group, `${where}: condition references "${condition.story}", which is not a story book item`);
    else if (!condition.chapter)
      ctx.add(group, `${where}: story condition needs a "chapter" — the chapter id to test for`);
    else if (!(storyItem.story.chapters ?? []).some(ch => ch.id === condition.chapter))
      ctx.add(group, `${where}: condition references unknown chapter "${condition.chapter}" on story "${condition.story}"`);
  }
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

// An enemy missing combat attributes crashes the fight.
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

// npc, when given, is the conversation the pipeline runs inside.
function validateActions(ctx, group, actions, where, npc = null) {
  for (const action of (actions || [])) {
    if (!ctx.knownActionTypes.has(action.type))
      ctx.add(group, `${where}: unknown action type "${action.type}"`);
    if (npc && action.type === 'goToConversation' && !npc.conversations?.[action.node])
      ctx.add(group, `${where}: goToConversation → unknown node "${action.node}"`);
    if (action.type === 'navigate' && action.destination && !ctx.scenes[action.destination])
      ctx.add(group, `${where}: navigate → unknown destination "${action.destination}"`);
    if (action.type === 'loot' && action.item && !isKnownItem(ctx, action.item))
      ctx.add(group, `${where}: loot → unknown item "${action.item}"`);
    if (action.type === 'dialogue' && action.npc && !ctx.npcs[action.npc])
      ctx.add(group, `${where}: dialogue → unknown NPC "${action.npc}"`);
    if (action.type === 'questTrigger')
      validateQuestTrigger(ctx, group, action, `${where}: questTrigger`);
    if (action.type === 'grant_chapter') {
      const storyItem = ctx.items[action.item];
      if (!storyItem)
        ctx.add(group, `${where}: grant_chapter → unknown item "${action.item}"`);
      else if (!storyItem.story)
        ctx.add(group, `${where}: grant_chapter → "${action.item}" declares no story`);
      // No chapter is the grant-everything form; only a wrong one is a mistake.
      else if (action.chapter !== undefined && !(storyItem.story.chapters ?? []).some(ch => ch.id === action.chapter))
        ctx.add(group, `${where}: grant_chapter → unknown chapter "${action.chapter}" on "${action.item}"`);
    }
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
  }
}

// The flags a condition requires false: the shape of a self-gating check.
function collectFalseFlagGates(condition, out = new Set()) {
  if (!condition) return out;
  (condition.and || []).forEach(c => collectFalseFlagGates(c, out));
  (condition.or || []).forEach(c => collectFalseFlagGates(c, out));
  if (condition.not && 'flag' in condition.not && condition.not.value === true)
    out.add(condition.not.flag);
  if ('flag' in condition && condition.value === false) out.add(condition.flag);
  return out;
}

// A looting success that never retires its check can be re-rolled for
// duplicates; resolveOnce or a self-set flag gate retires it.
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

// The check fields shared by scene skills and dialogue responses.
function validateCheck(ctx, group, check, where, npc = null) {
  validateCondition(ctx, group, check.condition, where);
  validateActions(ctx, group, check.actions, where, npc);
  validateActions(ctx, group, check.onFailure, `${where}: onFailure`, npc);
  warnIfSuccessFarmable(ctx, group, check, where);
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
        validateActions(ctx, group, tier.actions, `${where}: outcomes.${tierName}`, npc);
    }
  }
  validateActions(ctx, group, check.onExhausted, `${where}: onExhausted`, npc);
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

    if (scene.questTrigger)
      validateQuestTrigger(ctx, group, scene.questTrigger, 'questTrigger');

    // A building is drawn from its rooms' geometry; without it the scene reads
    // as placed and never appears.
    const interiorRegion = ctx.regions?.[scene.region]?.interior;
    if ((scene.interior || interiorRegion) && !scene.mapDefinitions)
      ctx.add(group, `marked interior${scene.interior ? '' : ` (region "${scene.region}")`} but has no mapDefinitions — a building is drawn from its rooms' geometry, so it can never appear on the map`);

    for (const skill of (scene.skills || [])) {
      const where = `skill "${skill.text}"`;
      validateSkillCheck(ctx, group, skill.skillCheck, where);
      validateCheck(ctx, group, skill, where);
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

    // Keyed by slot id, like the player's map; a typo fights bare-handed.
    const declaredIds = new Set(declaredSlotList(ctx.rules).map(slot => slot.id));
    for (const [slot, itemId] of Object.entries(npc.equipment || {})) {
      if (itemId && !ctx.items[itemId]) ctx.add(group, `equipment[${slot}] → unknown item "${itemId}"`);
      if (declaredIds.size && !declaredIds.has(slot))
        ctx.add(group, `equipment["${slot}"] is not a declared equipment slot (playerDefaults.equipmentSlots ids: ${[...declaredIds].join(', ')})`);
    }

    // A weapon's attribute the NPC lacks attacks at +0. Equipped weapons plus
    // the fallback claw.
    if (npc.attributes?.healthPoints !== undefined) {
      const wielded = Object.values(npc.equipment || {}).filter(Boolean);
      if (!wielded.length && ctx.rules?.fallbackWeapons?.enemy) wielded.push(ctx.rules.fallbackWeapons.enemy);
      for (const itemId of wielded) {
        for (const field of ['attackAttribute', 'damageAttribute']) {
          const attr = ctx.items[itemId]?.attributes?.[field];
          if (attr && npc.attributes[attr] === undefined)
            ctx.add(group, `wields "${itemId}" (${field} "${attr}") but declares no ${attr} attribute — its attacks roll +0; add "${attr}" to the NPC's attributes`);
        }
      }
    }

    warnIfGiftFarmable(ctx, group, npc);

    for (const [nodeId, node] of Object.entries(npc.conversations || {})) {
      const where = `conversation node "${nodeId}"`;
      validateActions(ctx, group, node.actions, where, npc);

      for (const res of (node.responses || [])) {
        const resWhere = `${where}, response "${res.text}"`;
        if (res.skillCheck && res.dc > 0) validateSkillCheck(ctx, group, res.skillCheck, resWhere);
        validateCheck(ctx, group, res, resWhere, npc);
      }
    }
  }
}

// A node whose actions give an item re-runs them every time it is shown, so
// every response that reaches it must be gated on a flag the node sets.
function warnIfGiftFarmable(ctx, group, npc) {
  const conversations = npc.conversations || {};

  for (const [nodeId, node] of Object.entries(conversations)) {
    const actions = node.actions || [];
    const gives = actions.some(a => a.type === 'loot' && (a.amount ?? 1) > 0);
    if (!gives) continue;

    // The only flags that can retire this node.
    const ownGates = new Set(actions
      .filter(a => a.type === 'set_flag' && a.value === true)
      .map(a => a.flag));

    // The start node has no response to gate.
    if (nodeId === 'start')
      ctx.add(group, `conversation node "start" hands over loot, and opening the conversation displays it — so it runs again every time the player talks to this NPC. Move the gift to a node reached by a response, and gate that response on a flag the gift node sets.`);

    for (const [fromId, from] of Object.entries(conversations)) {
      for (const res of (from.responses || [])) {
        const leadsHere = (res.actions || [])
          .some(a => a.type === 'goToConversation' && a.node === nodeId);
        if (!leadsHere) continue;

        const guarded = [...collectFalseFlagGates(res.condition)].some(f => ownGates.has(f));
        if (!guarded)
          ctx.add(group, `conversation node "${fromId}", response "${res.text}" reaches gift node "${nodeId}" ungated — its loot runs again on every visit. Gate the response on a flag the gift node's own actions set (condition { "not": { "flag": X, "value": true } } + set_flag X in "${nodeId}").`);
      }
    }
  }
}

function validateRules(ctx) {
  const { rules, items, locale } = ctx;
  const group = 'Rules';

  // A non-positive xpPerLevel would hang addXP.
  if (rules && !(rules.xpPerLevel > 0))
    ctx.add(group, `xpPerLevel must be a positive number (got ${rules.xpPerLevel}) — required for level-up math`);

  // Optional, but a malformed value is silently 0.
  if (rules?.levelUpHpBonus !== undefined && !Number.isFinite(rules.levelUpHpBonus))
    ctx.add(group, `levelUpHpBonus must be a number (got ${JSON.stringify(rules.levelUpHpBonus)}) — omit it for no HP growth on level-up`);

  // The pool is what a rest spends, so never hp or ap.
  const shortRest = rules?.shortRest;
  if (shortRest !== undefined) {
    const pool = rules?.playerDefaults?.resources?.[shortRest?.resource];
    if (!shortRest?.resource)
      ctx.add(group, 'shortRest needs a "resource" — the { current, max } pool each rest spends one use of');
    else if (shortRest.resource === 'hp' || shortRest.resource === 'ap')
      ctx.add(group, `shortRest.resource cannot be "${shortRest.resource}" — the pool is what a rest spends, not a stat it moves`);
    else if (!isResourcePool(pool))
      ctx.add(group, `shortRest.resource "${shortRest.resource}" is not a declared { current, max } resource in playerDefaults.resources`);
    if (shortRest?.heal !== undefined && typeof shortRest.heal !== 'string' && !(shortRest.heal > 0))
      ctx.add(group, `shortRest.heal must be dice notation ("1d8") or a positive number (got ${JSON.stringify(shortRest.heal)})`);
  }

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
    // Optional, but an unknown name renders nothing.
    if (attr.icon !== undefined && !ICON_NAMES.includes(attr.icon))
      ctx.add(group, `customAttributes "${attr.id}": icon "${attr.icon}" is not a known icon (${ICON_NAMES.join(', ')})`);
  }
  if ((rules?.customAttributes || []).length && !locale?.actions?.skillBadgeDc)
    ctx.add(group, 'missing locale entry at actions.skillBadgeDc — skill-check badges render the raw key as their DC line');
  if (rules?.skillRetry?.resource && !locale?.actions?.badgeRetryCost)
    ctx.add(group, 'skillRetry: missing locale entry at actions.badgeRetryCost — retry badges render the raw key');

  // spendStatPoint's whole-point math breaks on a fractional bank.
  if (rules?.levelUp?.statPoints !== undefined && !(Number.isInteger(rules.levelUp.statPoints) && rules.levelUp.statPoints >= 0))
    ctx.add(group, 'levelUp.statPoints must be a non-negative integer');

  for (const stat of (rules?.charCreation?.stats || [])) {
    if (!locale?.charCreation?.stats?.[stat.localeKey])
      ctx.add(group, `charCreation.stats "${stat.id}": missing locale entry at charCreation.stats.${stat.localeKey}`);
  }

  // The clock always works; days and segments need a coherent config.
  const time = rules?.time;
  if (time) {
    const hasDayLength = time.ticksPerDay > 0;
    if (!hasDayLength && (time.segments?.length || time.startTick !== undefined))
      ctx.add(group, 'time: segments/startTick need a positive ticksPerDay');
    // Outside [0, ticksPerDay) the modulo math goes off by a day.
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

  const declaredResources = rules?.playerDefaults?.resources ?? {};
  const isResource = (id) => isResourcePool(declaredResources[id]);

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

  // The top bar shows no label, so an entry without an icon is a bare number.
  for (const entry of (rules?.headerResources ?? [])) {
    const id = entry?.id;
    if (!id) {
      ctx.add(group, 'headerResources entries are { "id", "icon" } objects, e.g. { "id": "luckPoints", "icon": "star" }');
      continue;
    }
    if (!isResource(id))
      ctx.add(group, `headerResources "${id}" is not a declared { current, max } resource in playerDefaults.resources`);
    if (!locale?.ui?.resources?.[id])
      ctx.add(group, `headerResources "${id}": missing locale entry at ui.resources.${id}`);
    if (!ICON_NAMES.includes(entry.icon))
      ctx.add(group, `headerResources "${id}": icon "${entry.icon}" is not a known icon (${ICON_NAMES.join(', ')})`);
  }

  // The save/load/restart buttons exist only in an options widget tab.
  if (rules?.tabs && !rules.tabs.some(t => t?.widget === 'options'))
    ctx.add(group, 'tabs: no tab with widget "options" — the save/load/restart buttons render nowhere');

  // Optional, but an unknown name renders nothing.
  for (const tab of (rules?.tabs ?? [])) {
    if (tab?.icon !== undefined && !ICON_NAMES.includes(tab.icon))
      ctx.add(group, `tabs "${tab.id}": icon "${tab.icon}" is not a known icon (${ICON_NAMES.join(', ')})`);
  }

  // With every attack at 0 AP, End Turn is the only handoff.
  const attackItems = Object.values(items ?? {}).filter(i => i.type === 'Weapon' || i.type === 'Spell');
  if (attackItems.length && attackItems.every(i => !(i.attributes?.actionPoints > 0)))
    ctx.add(group, 'every Weapon/Spell has an AP cost of 0 — combat turns will never end automatically (End Turn becomes the only handoff)');
}
