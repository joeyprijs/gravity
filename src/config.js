// Maximum value of a d20 roll — used for hit chance and initiative rolls
export const MAX_D20_ROLL = 20;

// Fraction of an item's value that merchants pay when the player sells — 0.5 = 50%
export const MERCHANT_SELL_RATIO = 0.5;

// Starting armor class before any equipment bonuses are applied
export const BASE_AC = 10;

// Determines the display order of items in the inventory panel — lower number = higher up
export const ITEM_TYPE_ORDER = {
  "Weapon": 1,
  "Spell": 2,
  "Armor": 3,
  "Consumable": 4,
  "Flavour": 5
};

// Action points spent to unequip an item (applies during combat only)
export const UNEQUIP_AP_COST = 1;

// HP restored when using a rest point (scene action: "rest")
export const REST_HEAL_AMOUNT = 10;

// HP restored when eating a snack in the kitchen (scene action: "eat_snack")
export const SNACK_HEAL_AMOUNT = 2;

// Max HP gained per level-up
export const LEVELUP_HP_BONUS = 5;

// XP required to level up, multiplied by the player's current level
// e.g. level 1 needs 100 XP, level 2 needs 200 XP, etc.
export const XP_PER_LEVEL = 100;

// The scene ID loaded when starting a new game
export const STARTING_SCENE = "dungeon_start";

// Fallback scene used by the "return_to_world" action when no returnSceneId
// has been stored in state (e.g. player hasn't used a teleport item yet)
export const RETURN_WORLD_FALLBACK_SCENE = "dungeon_start";

// Default world canvas dimensions used when worldMapSize is absent from index.json
export const DEFAULT_WORLD_MAP_SIZE = { width: 3000, height: 2000 };

// CSS fallback background applied to map nodes that have no background defined
// in their mapDefinitions. Must stay in sync with the --glass-bg CSS variable.
export const MAP_NODE_DEFAULT_BG = 'var(--glass-bg)';

// Size of the minimap HUD in pixels (square)
export const MINIMAP_SIZE = 200;

// Fallback weapon used when the player has nothing equipped
export const UNARMED_STRIKE = {
  name: "Unarmed Strike",
  actionPoints: 1,
  attributes: { damageRoll: "1-2" }
};

// Fallback weapon used for enemies that have no weapon equipped
export const ENEMY_CLAW = {
  name: "claws",
  actionPoints: 2,
  attributes: { damageRoll: "1-3" }
};

// HTML element IDs referenced from more than one source file.
// Single-file IDs (e.g. stat bars, tab panels) stay as inline literals in
// their respective files — centralising every ID would be over-engineering.
export const EL = {
  SCENE_NARRATIVE:         'scene-narrative',
  SCENE_OPTIONS:           'scene-options',
  SCENE_LOCATION_REMINDER: 'scene-location-reminder',
  BTN_LOAD:                'btn-load',
  BTN_RESTART:             'btn-restart',
};

// System messages shared across multiple modules. Keeping them here ensures
// that e.g. the load-filter in state.js and the log call in ui.js always match.
export const MSG = {
  GAME_LOADED:        'Game Loaded from Disk.',
  GAME_LOAD_FAILED:   'Failed to parse save file.',
  GAME_DATA_ERROR:    'Error loading game data.',
};

// Starting stats and inventory for a new player
export const PLAYER_DEFAULTS = {
  level: 1,
  xp: 0,
  hp: 10,
  maxHp: 10,
  ap: 3,
  maxAp: 3,
  ac: BASE_AC,
  initiative: 0,
  gold: 0,
  inventory: [
    { item: "rusty_sword", amount: 1 },
    { item: "flames", amount: 1 },
    { item: "healing_potion", amount: 2 }
  ],
  equipment: {
    "Head": null,
    "Torso": null,
    "Legs": null,
    "Left Hand": null,
    "Right Hand": null
  }
};
