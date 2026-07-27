import { LOG, WEAPON_SLOTS } from "../core/config.js";
import { equipmentAttributeBonuses } from "../core/utils.js";
import { parseDamage } from "./dice.js";

// Item lifecycle logic: using consumables, equipping and unequipping gear.
// The engine exposes thin delegates (engine.useItem / equipItem / unequipItem)
// so UI code needs no knowledge of this module.

// Consumable stat effect: applies one die-notation-or-number attribute to the
// named stat/resource and logs the given locale key. Returns true if applied.
function applyStatEffect(engine, itemData, value, stat, msgKey, extraParams = {}) {
  if (!value) return false;
  let amount = value;
  let rollSuffix = "";
  if (typeof amount === 'string') {
    const result = parseDamage(amount);
    rollSuffix = engine.t('player.rollSuffix', { dice: amount, roll: result.string });
    amount = result.total;
  }
  engine.state.modifyPlayerStat(stat, amount);
  engine.log(LOG.SYSTEM, engine.t(msgKey, { name: itemData.name, amount, rollSuffix, ...extraParams }), 'loot');
  return true;
}

// Consumable effects, keyed by the item attribute that declares them. Each
// receives that attribute's value and returns true when it applied — applying
// any of them consumes the item. A new consumable effect is a table entry
// here, not another branch in useItem (mirroring the action registry).
const CONSUMABLE_EFFECTS = {
  healingAmount: (engine, itemData, value) =>
    applyStatEffect(engine, itemData, value, 'hp', 'player.usedItem'),
  apRestore: (engine, itemData, value) =>
    applyStatEffect(engine, itemData, value, 'ap', 'player.usedItemAp'),
  modifyResource: (engine, itemData, mod) => {
    if (!mod?.resource) return false;
    const labelKey = `ui.resources.${mod.resource}`;
    return applyStatEffect(engine, itemData, mod.amount, mod.resource, 'player.usedItemResource', {
      resource: engine.t(labelKey) !== labelKey ? engine.t(labelKey) : mod.resource,
    });
  },
};

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
    engine.log(LOG.SYSTEM, engine.t('player.teleported', { name: itemData.name }));
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

// The item types held in a hand — the same pair combat reads its attacks from.
// A weapon or spell goes to a hand whatever slot it declares (many declare
// none at all), so the type decides, not the item's slot.
const HAND_TYPES = new Set(['Weapon', 'Spell']);

/**
 * The hand a weapon or spell goes into: an empty hand (left before right),
 * otherwise the hand opposite the one filled last — so successive equips
 * alternate left, right, left… The alternation is session memory
 * (engine._lastEquippedHand); after a reload the next equip starts left again.
 *
 * @param {object} engine - The RPGEngine instance.
 * @returns {string} A hand slot name.
 */
function pickHand(engine) {
  const equipment = engine.state.getPlayer().equipment;
  const empty = WEAPON_SLOTS.find(hand => !equipment[hand]);
  if (empty) return empty;
  return engine._lastEquippedHand === WEAPON_SLOTS[0] ? WEAPON_SLOTS[1] : WEAPON_SLOTS[0];
}

/**
 * Equips an item, swapping the worn attribute bonuses as one delta and
 * spending the item's AP cost. The slot is the engine's call: a hand item
 * alternates between the hands (see pickHand), everything else goes to the
 * slot it declares.
 *
 * @param {object} engine - The RPGEngine instance.
 * @param {string} itemId - The item to equip.
 */
export function equipItem(engine, itemId) {
  if (engine.isGameOver) return;
  const itemData = engine.data.items[itemId];
  if (!itemData) return;
  const targetSlot = HAND_TYPES.has(itemData.type) ? pickHand(engine) : itemData.slot;
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
  if (WEAPON_SLOTS.includes(targetSlot)) engine._lastEquippedHand = targetSlot;
  // Narrated: the click on the inventory card is the player's act, this line
  // is what came of it — the same split every other card in the game follows.
  engine.log(LOG.SYSTEM, engine.t('player.equipped', { name: itemData.name, slot: targetSlot }));
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
  engine.log(LOG.SYSTEM, engine.t('player.unequipped', { name: itemName, slot }));
  engine._spendAP(unequipCost);
}
