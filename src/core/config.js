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

// Item IDs for fallback weapons used in combat when no weapon is equipped.
// These items are defined in data/items/ like all other items.
export const UNARMED_STRIKE_ID = 'unarmed_strike';
export const ENEMY_CLAW_ID    = 'enemy_claw';

// CSS class names referenced from JavaScript. Centralised here so that renaming
// a class only requires a change in this file, not a grep across all JS files.
// Dynamic variant suffixes (e.g. scene__log--${variant}) are built by
// appending to the base constant: `${CSS.SCENE_LOG}--${variant}`.
export const CSS = {
  // Scene / narrative
  SCENE:                  'scene',
  SCENE_NEW:              'scene--new',
  SCENE_COMBAT:           'scene--combat',
  SCENE_DIALOGUE:         'scene--dialogue',
  SCENE_MERCHANT:         'scene--merchant',
  SCENE_DESCRIPTION:      'scene__description',
  SCENE_TITLE:            'scene__title',
  SCENE_TITLE_GAME_OVER:  'scene__title--game-over',
  SCENE_BODY:             'scene__body',
  SCENE_LOG:              'scene__log',
  SCENE_OPTIONS_COMBAT:   'scene__options--combat',
  SCENE_OPTIONS_MERCHANT: 'scene__options--merchant',
  SCENE_OPTIONS_GRID:     'scene__options--grid',

  // Tabs (ui.js setup)
  TABS_BTN:               'tabs__btn',
  TABS_BTN_ACTIVE:        'tabs__btn--active',
  TABS_CONTENT:           'tabs__content',
  TABS_CONTENT_ACTIVE:    'tabs__content--active',

  // Buttons
  OPTION_BTN:                   'option-btn',
  OPTION_BTN_REQ:               'option-btn__req-text',
  OPTION_BTN_REQ_SELL:          'option-btn__req-text--sell',
  OPTIONS_GROUP:                'options-group',
  OPTIONS_GROUP_LABEL:          'options-group__label',
  OPTIONS_GROUP_BUTTONS:        'options-group__buttons',
  OPTIONS_GROUP_BUTTONS_SINGLE: 'options-group__buttons--single',
  BTN:                    'button',
  BTN_GLASS:              'btn--glass',
  BTN_ITEM:               'btn--item',
  BTN_DEPOSIT:            'btn--deposit',

  // Item lists
  ITEM_LIST:              'item-list',
  ITEM_LIST_TITLE:        'item-list__title',
  ITEM_LIST_ITEMS:        'item-list__items',
  ITEM_LIST_ITEM:         'item-list__item',
  ITEM_LIST_ITEM_DONE:    'item-list__item--completed',
  ITEM_DESCRIPTION:       'item__description',
  ITEM_TITLE:             'item__title',
  ITEM_TYPE:              'item__type',
  ITEM_STATS:             'item__stats',
  ITEM_ACTIONS:           'item__actions',

  // Museum
  MUSEUM_SECTION:         'museum__section',
  MUSEUM_HEADING:         'museum__heading',
  MUSEUM_DONE_BTN:        'museum__done-btn',
  MUSEUM_ITEM_LIST:       'museum-item-list',

  // Map
  MAP_NODE:               'map-node',
  MAP_NODE_CURRENT:       'map-node--current',
  MAP_NODE_LABEL:         'map-node__label',
  MINIMAP_CANVAS:         'minimap__canvas',
  FULLMAP_INNER:          'fullmap-overlay__inner',

  // Layout
  GLASS_PANEL:            'glass-panel',

  // Char creation
  CC_PANEL:               'char-creation__panel',
  CC_TITLE:               'char-creation__title',
  CC_SECTION:             'char-creation__section',
  CC_LABEL:               'char-creation__label',
  CC_NAME_INPUT:          'char-creation__name-input',
  CC_POINTS:              'char-creation__points-remaining',
  CC_STAT_ROW:            'char-creation__stat-row',
  CC_STAT_INFO:           'char-creation__stat-info',
  CC_STAT_LABEL:          'char-creation__stat-label',
  CC_STAT_DESC:           'char-creation__stat-desc',
  CC_STAT_CONTROLS:       'char-creation__stat-controls',
  CC_STAT_BTN:            'char-creation__stat-btn',
  CC_STAT_VALUE:          'char-creation__stat-value',
  CC_ACTIONS:             'char-creation__actions',
  CC_CONFIRM_BTN:         'char-creation__confirm-btn',
  CC_LOAD_BTN:            'char-creation__load-btn',
};

// HTML element IDs — single source of truth for every getElementById call in JS.
export const EL = {
  // Narrative / scene
  SCENE_NARRATIVE:         'scene-narrative',
  SCENE_OPTIONS:           'scene-options',
  SCENE_LOCATION_REMINDER: 'scene-location-reminder',

  // Toolbar buttons & file input
  BTN_SAVE:                'btn-save',
  BTN_LOAD:                'btn-load',
  BTN_RESTART:             'btn-restart',
  FILE_UPLOAD:             'file-upload',

  // Stat display
  STAT_NAME:               'stat-name',
  STAT_LEVEL:              'stat-level',
  STAT_HP:                 'stat-hp',
  STAT_AP:                 'stat-ap',
  STAT_AC:                 'stat-ac',
  STAT_INITIATIVE:         'stat-initiative',
  STAT_GOLD:               'stat-gold',
  XP_BAR:                  'xp-bar',

  // Character creation overlay
  CHAR_CREATION:           'char-creation',

  // Sidebar tabs
  TAB_PLAYER:              'player-tab',
  TAB_INVENTORY:           'inventory-tab',
  TAB_EQUIPMENT:           'equipment-tab',
  TAB_QUESTS:              'quests-tab',
  TAB_SETTINGS:            'settings-tab',

  // Map
  MINIMAP:                 'minimap',
  MINIMAP_CANVAS:          'minimap-canvas',
  FULLMAP_OVERLAY:         'fullmap-overlay',
  FULLMAP_CANVAS:          'fullmap-canvas',
  FULLMAP_TITLE:           'fullmap-title',
  FULLMAP_CLOSE:           'fullmap-close',
};

// Log type labels — the [Label] prefix shown in every narrative log entry.
export const LOG = {
  SYSTEM: 'System',
  PLAYER: 'Player',
  COMBAT: 'Combat',
  QUEST:  'Quest',
};

// System messages shared across multiple modules. Keeping them here ensures
// that e.g. the load-filter in state.js and the log call in ui.js always match.
export const MSG = {
  GAME_LOADED:        'Game Loaded from Disk.',
  GAME_LOAD_FAILED:   'Failed to parse save file.',
  GAME_DATA_ERROR:    'Error loading game data.',
};

// Starting stats and inventory for a new player.
// 'name' starts empty — the character creation screen prompts the player for it.
export const PLAYER_DEFAULTS = {
  name: "",
  level: 1,
  xp: 0,
  hp: 10,
  maxHp: 10,
  ap: 3,
  maxAp: 3,
  ac: BASE_AC,
  initiative: 0,
  baseAcBonus: 0,
  gold: 0,
  inventory: [
    { item: "rusty_sword", amount: 1 },
    { item: "flames", amount: 1 },
    { item: "healing_potion", amount: 2 }
  ],
  equipment: {
    "Head": null,
    "Amulet": null,
    "Torso": null,
    "Left Hand": null,
    "Right Hand": null,
    "Legs": null
  }
};

// Character creation configuration.
// pointBudget: total stat points the player can spend at character creation.
// stats: each entry defines one allocatable stat.
//   id:            key in PLAYER_DEFAULTS to modify
//   label:         display name shown in the UI
//   description:   tooltip / helper text
//   bonusPerPoint: how much each spent point adds to the stat
//   min:           minimum points allocatable (always 0)
// To add more stats (e.g. initiative, base AC, backgrounds) later, just extend
// this array — the character creation screen renders it dynamically.
export const CHAR_CREATION = {
  pointBudget: 2,
  stats: [
    { id: 'maxHp', label: 'Max HP', description: '+2 HP per point', bonusPerPoint: 2, min: 0 },
    { id: 'baseAcBonus', label: 'AC', description: '+1 AC per point', bonusPerPoint: 1, min: 0 },
  ]
};

// Canonical names for all built-in scene option actions.
// Used by actions.js at registration time and by _validateData() for dev warnings.
export const ACTIONS = {
  LOOT:            'loot',
  COMBAT:          'combat',
  DIALOGUE:        'dialogue',
  REST:            'rest',
  RETURN_TO_WORLD: 'return_to_world',
  FULL_REST:       'full_rest',
  EAT_SNACK:       'eat_snack',
  MANAGE_CHEST:    'manage_chest',
};
