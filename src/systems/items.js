import { LOG } from '../core/config.js';
import { equipmentAttributeBonuses, itemSlotKind, slotsOfKind, slotLabel } from '../core/utils.js';
import { parseDamage } from './dice.js';

// Item lifecycle logic: using consumables, equipping and unequipping gear.
// The engine exposes thin delegates (engine.useItem / equipItem / unequipItem)
// so UI code needs no knowledge of this module.

// Consumable stat effect: applies one die-notation-or-number attribute to the
// named stat/resource and logs the given locale key. Returns true if applied.
function applyStatEffect(engine, itemData, value, stat, msgKey, extraParams = {}) {
  if (!value) return false;
  let amount = value;
  let rollSuffix = '';
  if (typeof amount === 'string') {
    const result = parseDamage(amount);
    rollSuffix = engine.t('player.rollSuffix', { dice: amount, roll: result.string });
    amount = result.total;
  }
  engine.state.modifyPlayerStat(stat, amount);
  // The user's act, in their voice — the yield rides along in the parens
  // (see STYLE.md, the narrative log's two voices). Signed here so a
  // harmful consumable reads "(-2 HP)", not "(+-2 HP)".
  const signed = amount >= 0 ? `+${amount}` : `${amount}`;
  engine.log(LOG.PLAYER, engine.t(msgKey, { name: itemData.name, amount: signed, rollSuffix, ...extraParams }), 'choice');
  return true;
}

// Consumable effects, keyed by the item attribute that declares them. Each
// receives that attribute's value and returns true when it applied — applying
// any of them consumes the item. A new consumable effect is a table entry
// here, not another branch in useItem (mirroring the action registry).
const CONSUMABLE_EFFECTS = {
  healingAmount: (engine, itemData, value) =>
    applyStatEffect(engine, itemData, value, 'hp', 'player.usedItem'),
};

/**
 * True when an item declares something useItem can actually do — a consumable
 * effect or a teleport. The inventory reads it to decide whether an item's card
 * is a control: a Special item that declares no use (a plain story key) is a
 * card you can only read.
 *
 * @param {object|null} itemData - The item definition from data/items.
 * @returns {boolean}
 */
export function itemHasUse(itemData) {
  if (itemData?.story) return true;
  const attrs = itemData?.attributes;
  if (!attrs) return false;
  return !!attrs.teleportScene || Object.keys(CONSUMABLE_EFFECTS).some(attr => attrs[attr]);
}

/**
 * Reading a story book: the [Player] act, then the narrator retells every
 * chapter the player has heard, in the story's AUTHORED order — the granted
 * list only answers "which", so a chapter heard out of sequence still lands
 * where the life put it. The book stores no text of its own: it is a view
 * over the granted state, always exactly as current as the listening. Books
 * never consume, so a long story can be reread forever.
 *
 * Exported because reading doesn't care where the book stands: useItem reads
 * it from the pack, and the curator's case inspection reads it on exhibit
 * (via the engine.readStory delegate) — same replay, no inventory involved.
 *
 * @param {object} engine - The RPGEngine instance.
 * @param {object} itemData - A story book's item definition (story required).
 */
export function readStory(engine, itemData) {
  const openLine = engine.log(LOG.PLAYER, engine.t('player.readBook', { name: itemData.name }), 'choice');
  const granted = engine.state.getStoryChapters(itemData.id);
  const heard = itemData.story.chapters.filter(ch => granted.includes(ch.id));
  if (!heard.length) {
    engine.log(LOG.NARRATOR, engine.t('story.emptyBook'));
  } else {
    heard.forEach(ch => engine.log(LOG.NARRATOR, ch.text));
  }
  // A retelling is read from its beginning — land the log on the opening
  // line, not at the bottom of a story that may run pages.
  engine.scrollNarrativeToEntry?.(openLine);
}

// Teleport items are reusable — they never consume. Returns false when the
// use must abort entirely (teleporting mid-combat), so no AP is charged.
function teleport(engine, itemData) {
  if (engine.inCombat) {
    engine.log(LOG.SYSTEM, engine.t('player.noCombatTeleport'));
    return false;
  }
  const curScene = engine.state.getCurrentSceneId();
  if (curScene !== itemData.attributes.teleportScene) {
    engine.state.setReturnSceneId(curScene);
    engine.log(LOG.PLAYER, engine.t('player.teleported', { name: itemData.name }), 'choice');
    engine.renderScene(itemData.attributes.teleportScene);
  } else {
    engine.log(LOG.SYSTEM, engine.t('player.alreadyHere'));
  }
  return true;
}

/**
 * Uses an inventory item: applies its consumable effects (or teleport),
 * spends its AP cost, and refreshes the scene options when appropriate.
 *
 * @param {object} engine - The RPGEngine instance.
 * @param {string} itemId - The item to use.
 */
export function useItem(engine, itemId) {
  if (engine.isGameOver) return;
  const itemData = engine.data.items[itemId];
  if (!itemData) return;
  if (engine.state.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return;

  const apCost = itemData.attributes?.actionPoints ?? 0;
  // The precheck mirrors _spendAP's turn-budget guard exactly — the effect
  // applies before the spend, so the two must never disagree.
  if (engine.inCombat && engine.combatSystem.remainingTurnBudget() < apCost) {
    engine.log(LOG.SYSTEM, engine.t('player.notEnoughAP', { cost: apCost }));
    return;
  }

  // Apply effects BEFORE spending AP so the log order is always:
  // "used potion" → (AP spent) → enemy turn fires. Effects are independent —
  // an item may carry any mix of them.
  const consumed = Object.entries(CONSUMABLE_EFFECTS)
    .map(([attr, apply]) => apply(engine, itemData, itemData.attributes?.[attr]))
    .some(Boolean);
  if (consumed) {
    engine.state.removeFromInventory(itemId, 1);
  } else if (itemData.attributes?.teleportScene) {
    if (!teleport(engine, itemData)) return;
  } else if (itemData.story) {
    readStory(engine, itemData);
  }

  engine._spendAP(apCost);

  // Out of combat, consuming an item can change what the scene affords
  // (AP-gated checks, condition-gated options) — rebuild the options so
  // buttons don't go stale. In combat/dialogue/custom UI the owning panel
  // refreshes itself.
  if (!engine.inCombat && !engine.inDialogue && !engine.inCustomUI) {
    const scene = engine.data.scenes[engine.state.getCurrentSceneId()];
    if (scene) engine.scene.renderOptions(scene);
  }
}

/**
 * The slot an item goes into, among the declared slots of the kind it asks
 * for: an empty one first (in declaration order), otherwise the one holding
 * the same item type — a new weapon replaces the weapon, a new spell the
 * spell, a third ring the first ring — so the pick is always readable off the
 * equipped section. The first slot of the kind when the types don't decide.
 *
 * A kind with a single slot (head, body) reduces to that slot; a kind with
 * two (hand, ring) is what makes this more than a lookup.
 *
 * @param {object} engine - The RPGEngine instance.
 * @param {object} itemData - The item being equipped.
 * @returns {string|undefined} A slot id, or undefined when the item wears
 *   nowhere or names a kind this game declares no slot for.
 */
function pickSlot(engine, itemData) {
  const kind = itemSlotKind(itemData);
  if (!kind) return undefined;
  const slots = slotsOfKind(engine.data.rules, kind);
  const equipment = engine.state.getPlayer().equipment;
  const empty = slots.find(slot => !equipment[slot]);
  if (empty) return empty;
  const sameType = slots.find(slot => engine.data.items[equipment[slot]]?.type === itemData.type);
  return sameType ?? slots[0];
}

/**
 * Equips an item, swapping the worn attribute bonuses as one delta and
 * spending the item's AP cost. Which slot it lands in is the engine's call:
 * the item names a slot *kind* and pickSlot chooses the instance.
 *
 * @param {object} engine - The RPGEngine instance.
 * @param {string} itemId - The item to equip.
 */
export function equipItem(engine, itemId) {
  if (engine.isGameOver) return;
  const itemData = engine.data.items[itemId];
  if (!itemData) return;
  const targetSlot = pickSlot(engine, itemData);
  if (!targetSlot) return;

  if (engine.state.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return;

  const apCost = itemData.attributes?.actionPoints ?? 0;
  if (engine.inCombat && engine.combatSystem.remainingTurnBudget() < apCost) {
    engine.log(LOG.SYSTEM, engine.t('player.notEnoughAP', { cost: apCost }));
    return;
  }

  // Swap the worn attribute bonuses (attributeBonuses + armorClassBonus):
  // remove the outgoing item's, apply the incoming item's, as one delta.
  const oldItemId = engine.state.getPlayer().equipment[targetSlot];
  const oldBonuses = equipmentAttributeBonuses(oldItemId ? engine.data.items[oldItemId] : null);
  const newBonuses = equipmentAttributeBonuses(itemData);
  const success = engine.state.equipItem(targetSlot, itemId);
  if (!success) return;
  const deltas = {};
  for (const key of new Set([...Object.keys(oldBonuses), ...Object.keys(newBonuses)])) {
    deltas[key] = (newBonuses[key] ?? 0) - (oldBonuses[key] ?? 0);
  }
  engine.state.modifyPlayerStats(deltas);
  // The user's act, in their voice — the engine-picked hand rides along in
  // the parens (see STYLE.md, the narrative log's two voices).
  engine.log(LOG.PLAYER, engine.t('player.equipped', { name: itemData.name, slot: slotLabel(engine.t.bind(engine), targetSlot) }), 'choice');
  engine._spendAP(apCost);
}

/**
 * Unequips a slot back into the inventory, removing the item's worn attribute
 * bonuses and spending rules.unequipApCost.
 *
 * @param {object} engine - The RPGEngine instance.
 * @param {string} slot - The equipment slot to clear.
 */
export function unequipItem(engine, slot) {
  if (engine.isGameOver) return;
  const itemId = engine.state.getPlayer().equipment[slot];
  if (!itemId) return;
  const unequipCost = engine.data.rules?.unequipApCost ?? 1;
  if (engine.inCombat && engine.combatSystem.remainingTurnBudget() < unequipCost) {
    engine.log(LOG.SYSTEM, engine.t('player.notEnoughAP', { cost: unequipCost }));
    return;
  }
  const itemName = engine.data.items[itemId]?.name || itemId;
  const bonuses = equipmentAttributeBonuses(engine.data.items[itemId]);
  engine.state.equipItem(slot, null);
  engine.state.modifyPlayerStats(Object.fromEntries(
    Object.entries(bonuses).map(([key, bonus]) => [key, -bonus])
  ));
  engine.log(LOG.PLAYER, engine.t('player.unequipped', { name: itemName, slot: slotLabel(engine.t.bind(engine), slot) }), 'choice');
  engine._spendAP(unequipCost);
}
