import { LOG } from '../core/config.js';
import { equipmentAttributeBonuses, formatSigned, itemSlotKind, slotsOfKind, slotLabel } from '../core/utils.js';
import { parseDamage } from './dice.js';

// Using consumables, equipping and unequipping gear. The UI reaches these
// through the engine's delegates.

// An authored amount is a number or dice notation; the suffix is the roll
// for the log line, empty for a flat number.
export function rollAmount(engine, value) {
  if (typeof value !== 'string') return { amount: value, rollSuffix: '' };
  const result = parseDamage(value);
  return { amount: result.total, rollSuffix: engine.t('player.rollSuffix', { dice: value, roll: result.string }) };
}

// Applies one authored amount to a stat and logs it. True if applied.
function applyStatEffect(engine, itemData, value, stat, msgKey) {
  if (!value) return false;
  const { amount, rollSuffix } = rollAmount(engine, value);
  engine.state.modifyPlayerStat(stat, amount);
  // The act in the player's voice, the yield in the parens (STYLE.md).
  engine.log(LOG.PLAYER, engine.t(msgKey, { name: itemData.name, amount: formatSigned(amount), rollSuffix }), 'choice');
  return true;
}

// Consumable effects by the attribute that declares them; applying any of
// them consumes the item. A new effect is an entry here, not a branch in useItem.
const CONSUMABLE_EFFECTS = {
  healingAmount: (engine, itemData, value) =>
    applyStatEffect(engine, itemData, value, 'hp', 'player.usedItem'),
};

// Whether useItem can do anything with the item; a Special item without a
// use is a card you can only read.
export function itemHasUse(itemData) {
  if (itemData?.story) return true;
  const attrs = itemData?.attributes;
  if (!attrs) return false;
  return !!attrs.teleportScene || Object.keys(CONSUMABLE_EFFECTS).some(attr => attrs[attr]);
}

// The narrator retells every chapter heard, in authored order: the book is a
// view over the granted state and never consumes. Exported because the
// curator reads an exhibited book the same way, with no inventory involved.
export function readStory(engine, itemData) {
  const openLine = engine.log(LOG.PLAYER, engine.t('player.readBook', { name: itemData.name }), 'choice');
  const granted = engine.state.getStoryChapters(itemData.id);
  const heard = itemData.story.chapters.filter(ch => granted.includes(ch.id));
  if (!heard.length) {
    engine.log(LOG.NARRATOR, engine.t('story.emptyBook'));
  } else {
    heard.forEach(ch => engine.log(LOG.NARRATOR, ch.text));
  }
  // Land the log on the opening line, not at the foot of a long story.
  engine.scrollNarrativeToEntry?.(openLine);
}

// Never consumes. False when the use aborts (mid-combat), so no AP is charged.
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

export function useItem(engine, itemId) {
  if (engine.isGameOver) return;
  const itemData = engine.data.items[itemId];
  if (!itemData) return;
  if (engine.state.countPlayerItem(itemId, { includeEquipped: false }) <= 0) return;

  const apCost = itemData.attributes?.actionPoints ?? 0;
  // The effect applies before the spend, so this mirrors _spendAP's guard.
  if (engine.inCombat && engine.combatSystem.remainingTurnBudget() < apCost) {
    engine.log(LOG.SYSTEM, engine.t('player.notEnoughAP', { cost: apCost }));
    return;
  }

  // Effects before the spend, so the use logs before the enemy turn fires.
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

  // A use can change what the scene affords; other panels refresh themselves.
  if (!engine.inCombat && !engine.inDialogue && !engine.inCustomUI) {
    const scene = engine.data.scenes[engine.state.getCurrentSceneId()];
    if (scene) engine.scene.renderOptions(scene);
  }
}

// Among the slots of the item's kind: an empty one first, else the one
// holding the same type (a new sword replaces the sword), else the first.
// Undefined when the item wears nowhere.
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

// The item names a slot kind; pickSlot chooses the slot.
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

  // The outgoing and incoming bonuses as one delta.
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
  engine.log(LOG.PLAYER, engine.t('player.equipped', { name: itemData.name, slot: slotLabel(engine.t, targetSlot) }), 'choice');
  engine._spendAP(apCost);
}

// Spends rules.unequipApCost.
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
  engine.log(LOG.PLAYER, engine.t('player.unequipped', { name: itemName, slot: slotLabel(engine.t, slot) }), 'choice');
  engine._spendAP(unequipCost);
}
