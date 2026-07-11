// Studio's single home for the engine's data-format enums (audit 4.1).
// Studio is served from the repo root, so browser-safe engine modules can be
// imported directly — GOLD_ITEM_ID comes straight from the engine. The lists
// below are still hand-maintained; when the engine grows an action type, item
// type, or equipment slot, update it here and every form picks it up.

export { GOLD_ITEM_ID } from '../../src/core/config.js';

/** The engine's core action registry (src/systems/actions.js + dialogue.js).
 *  Plugin-registered actions are discovered at workspace load by the
 *  registerAction() source scan (see io.js / store.actionTypes). */
export const ACTION_TYPES = [
  ['navigate',          'Navigate to Scene'],
  ['set_flag',          'Set Flag'],
  ['loot',              'Loot (Item / XP)'],
  ['combat',            'Start Combat'],
  ['dialogue',          'Start Dialogue'],
  ['heal',              'Heal Player'],
  ['modify_ap',         'Modify AP'],
  ['modify_resource',   'Modify Resource'],
  ['full_rest',         'Full Rest'],
  ['return',            'Return'],
  ['log',               'Log Message'],
  ['questTrigger',      'Quest Trigger'],
  ['manage_chest',      'Manage Chest'],
  ['advance_time',      'Advance Time'],
  ['set_timer',         'Set Timer'],
  ['cancel_timer',      'Cancel Timer'],
  ['goToConversation',  'Go To Conversation'],
  ['trade',             'Open Trade'],
  ['leave',             'Leave Dialogue'],
  ['makeFriendly',      'Make NPC Friendly'],
];

/** Item types (item.schema.json / rules.itemTypeOrder). */
export const ITEM_TYPES = ['Weapon', 'Spell', 'Armor', 'Consumable', 'Flavour'];

/** Equipment slot names (rules.playerDefaults.equipment / NPC equipment). */
export const EQUIPMENT_SLOTS = ['Head', 'Amulet', 'Torso', 'Left Hand', 'Right Hand', 'Legs'];
