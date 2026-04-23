// Maximum value of a d20 roll — used for hit chance and initiative rolls
export const MAX_D20_ROLL = 20;

// Canonical names for all built-in scene option actions.
// Used by actions.js at registration time and by _validateData() for dev warnings.
export const ACTIONS = {
  LOOT:            'loot',
  COMBAT:          'combat',
  DIALOGUE:        'dialogue',
  RETURN:          'return',
  FULL_REST:       'full_rest',
  HEAL:            'heal',
  NAVIGATE:        'navigate',
  SET_FLAG:        'set_flag',
  LOG:             'log',
};

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
  SCENE_OPTIONS:          'scene__options',
  SCENE_OPTIONS_SECTION:  'scene__options--section',
  SCENE_SECTION_HEADING:  'scene__section-heading',

  // Tabs (ui.js setup)
  TABS_BTN:               'tabs__btn',
  TABS_BTN_ACTIVE:        'tabs__btn--active',
  TABS_PANEL:             'tabs__panel',

  // Buttons
  OPTION_BTN:             'option-btn',
  OPTION_BTN_STACKED:     'option-btn--stacked',
  OPTION_BTN_BADGE:       'option-btn__badge',
  BTN:                    'button',
  BTN_ITEM:               'btn--item',

  // Item lists
  ITEM_LIST_ITEMS:        'item-list__items',
  ITEM_LIST_ITEM:         'item-list__item',
  ITEM_LIST_ITEM_DONE:    'item-list__item--completed',
  ITEM_DESCRIPTION:       'item__description',
  ITEM_TITLE:             'item__title',
  ITEM_TYPE:              'item__type',
  ITEM_STATS:             'item__stats',
  ITEM_ACTIONS:           'item__actions',

  // Museum
  MUSEUM_ITEM_LIST:       'museum-item-list',

  // Map
  MAP_NODE:               'map-node',
  MAP_NODE_CURRENT:       'map-node--current',
  MAP_NODE_LABEL:         'map-node__label',
  MINIMAP_CANVAS:         'minimap__canvas',
  FULLMAP_INNER:          'fullmap-overlay__inner',

  // Layout
  PANEL:                  'panel',

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
  SCENE_OPTIONS_PANEL:     'scene-options-panel',
  SCENE_OPTIONS:           'scene-options',
  SCENE_OPTIONS_SKILLS:    'scene-options-skills',
  SCENE_LOCATION_REMINDER: 'scene-location-reminder',

  // Toolbar buttons & file input
  BTN_SAVE:                'btn-save',
  BTN_LOAD:                'btn-load',
  BTN_RESTART:             'btn-restart',
  FILE_UPLOAD:             'file-upload',

  // Character creation overlay
  CHAR_CREATION:           'char-creation',

  // Sidebar tabs
  PLAYER_PANEL:            'player-panel',
  TAB_INVENTORY:           'inventory-tab',
  TAB_QUESTS:              'quests-tab',

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

// Default world canvas dimensions used when worldMapSize is absent from index.json
export const DEFAULT_WORLD_MAP_SIZE = { width: 3000, height: 2000 };

// CSS fallback background applied to map nodes that have no background defined
// in their mapDefinitions. Must stay in sync with the --panel-bg CSS variable.
export const MAP_NODE_DEFAULT_BG = 'var(--panel-bg)';

// Size of the minimap HUD in pixels (square)
export const MINIMAP_SIZE = 200;
