// Maximum value of a d20 roll — used for hit chance and initiative rolls
export const MAX_D20_ROLL = 20;

// The reserved item ID representing currency. Loot tables and loot actions
// using this ID modify the player's gold resource instead of the inventory.
export const GOLD_ITEM_ID = 'gold';

// Builders for the dynamic state-flag keys used by the engine and built-in
// plugins. Centralized so each key format is defined exactly once — an inline
// typo'd key would silently create a brand-new flag. These are scalar world
// state: authored conditions may read them (e.g. gating on a sold-out stock).
export const FLAG_KEYS = {
  passiveDone:   (sceneId, index) => `passive_done_${sceneId}_${index}`,
  merchantStock: (npcId, itemId)  => `merchant_stock_${npcId}_${itemId}`,
  tradeDiscount: (npcId)          => `trade_discount_${npcId}`,
  friendly:      (npcId)          => `friendly_${npcId}`,
  xpAwarded:     (sceneId)        => `xp_awarded_${sceneId}`,
};

// Builders for the keys in state.checkState — the engine-private skill-check
// bookkeeping maps (attempt counts, resolution markers, discovery progress).
// A separate namespace from flags: these are object-valued internals that
// conditions never read, and keeping them out of state.flags keeps the flag
// namespace a clean, author-facing key→scalar map.
export const CHECK_KEYS = {
  skillDc:          (skillId, sceneId) => `skill_dc_${skillId}_${sceneId}`,
  dialogueDc:       (npcId)            => `dialogue_dc_${npcId}`,
  dialogueResolved: (npcId)            => `dialogue_resolved_${npcId}`,
};

// Canonical names for all built-in scene option actions.
// Used by actions.js at registration time and by _validateData() for dev warnings.
export const ACTIONS = {
  LOOT:            'loot',
  COMBAT:          'combat',
  DIALOGUE:        'dialogue',
  RETURN:          'return',
  FULL_REST:       'full_rest',
  HEAL:            'heal',
  MODIFY_RESOURCE: 'modify_resource',
  NAVIGATE:        'navigate',
  SET_FLAG:        'set_flag',
  LOG:             'log',
  MANAGE_CHEST:    'manage_chest',
  ADVANCE_TIME:    'advance_time',
  SET_TIMER:       'set_timer',
  CANCEL_TIMER:    'cancel_timer',

  // Dialogue actions — registered by DialogueSystem (see dialogue.js). They
  // live in the same registry as the actions above; the camelCase names match
  // the strings used in NPC conversation JSON.
  GO_TO_CONVERSATION: 'goToConversation',
  TRADE:              'trade',
  LEAVE:              'leave',
  MAKE_FRIENDLY:      'makeFriendly',
  QUEST_TRIGGER:      'questTrigger',
};

// CSS class names referenced from JavaScript. Centralized here so that renaming
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
  SCENE_BODY_TEXT:        'scene__body-text',
  SCENE_LOG:              'scene__log',
  SCENE_LOG_PREFIX:       'scene__log-prefix',
  // Generic section container and heading — used by the scene options panel,
  // the player tabs (inventory/quests/sheet/map), and the chest/merchant/
  // curator panels.
  PANEL_SECTION:          'panel-section',
  PANEL_SECTION_DYNAMIC:  'panel-section--dynamic',
  SECTION_HEADING:        'section-heading',

  // Tabs (ui.js setup)
  TABS_BTN:               'tabs__btn',
  TABS_BTN_ACTIVE:        'tabs__btn--active',
  TABS_BTN_NOTIFY:        'tabs__btn--notify',
  TABS_PANEL:             'tabs__panel',

  // Buttons
  BTN:                    'button',
  BTN_ITEM:               'btn--item',

  // Cards — THE standard block for every titled box in the UI: scene options,
  // skill checks, dialogue responses, combat attacks, inventory items, quests,
  // chest rows, exhibits. One DOM shape + class vocabulary (see buildCard in
  // core/utils.js), restyled in one place (the .card block in styles.css).
  CARD:                   'card',
  CARD_TITLE:             'card__title',
  CARD_BODY:              'card__body',
  CARD_STATS:             'card__stats',
  CARD_ACTIONS:           'card__actions',
  CARD_LIST:              'card-list',
  CARD_DONE:              'card--completed',
  CARD_NEW:               'card--new',

  // Collapsible section headings (inventory & sheet panels)
  SECTION_TOGGLE:           'section-toggle',
  SECTION_TOGGLE_COLLAPSED: 'section-toggle--collapsed',
  SECTION_TOGGLE_LABEL:     'section-toggle__label',
  SECTION_TOGGLE_COUNT:     'section-toggle__count',

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
  CC_STAT_GRID:           'char-creation__stat-grid',
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
  SCENE_PANEL:             'scene-panel',
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

// Action types a timer pipeline may contain. Timers fire from inside
// advanceTime — potentially mid-option, mid-rest, or right before a combat
// starts — so they are restricted to "quiet" actions that only change state
// and log. The world reacts through flags, which already flow into scene
// re-renders, option visibility, and dialogue gating naturally.
export const TIMER_SAFE_ACTIONS = new Set(['set_flag', 'log', 'questTrigger', 'cancel_timer', 'set_timer']);

// Canonical mission status values — used by QuestSystem, StateManager, QuestUI, and conditions.
export const MISSION_STATUS = {
  NOT_STARTED: 'not_started',
  ACTIVE:      'active',
  COMPLETE:    'complete',
};

// Log type labels — the [Label] prefix shown in every narrative log entry.
export const LOG = {
  SYSTEM:   'System',
  PLAYER:   'Player',
  COMBAT:   'Combat',
  QUEST:    'Quest',
  NARRATOR: 'Narrator',
};

// Default world canvas dimensions used when worldMapSize is absent from index.json
export const DEFAULT_WORLD_MAP_SIZE = { width: 3000, height: 2000 };

// CSS fallback background applied to map nodes that have no background defined
// in their mapDefinitions. Must stay in sync with the --panel-bg CSS variable.
export const MAP_NODE_DEFAULT_BG = 'var(--panel-bg)';

// Size of the minimap HUD in pixels (square)
export const MINIMAP_SIZE = 200;

// Pixel buffer around the map bounding box so scaled rooms keep clean margins
export const MAP_PADDING = 40;

// Equipment slots that can hold weapons/spells. Used by combat and inventory UI
// to identify attackable items without hardcoding slot names in logic code.
export const WEAPON_SLOTS = ['Left Hand', 'Right Hand'];

// The item `type` vocabulary the engine branches on (equip flow, combat,
// inventory grouping). Data may omit type (treated as Flavour); a declared
// type outside this set is an authoring typo — validateGameData flags it.
// Keep in sync with the enum in schemas/item.schema.json (a test cross-checks).
export const ITEM_TYPES = new Set(['Weapon', 'Spell', 'Armor', 'Consumable', 'Flavour']);

// Fallback item ID used when an enemy has no weapon equipped. Must match an
// entry in data/items/ and data/index.json. Overridable via rules.fallbackWeapons.enemy.
export const ENEMY_CLAW_ID = 'enemy_claw';

