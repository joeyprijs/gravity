export const MAX_D20_ROLL = 20;

// The reserved item id for currency: loot of it changes gold, not the pack.
export const GOLD_ITEM_ID = 'gold';

// The engine's dynamic flag keys, built here so a typo cannot mint a new flag.
// Scalar world state that authored conditions may read.
export const FLAG_KEYS = {
  passiveDone:   (sceneId, index) => `passive_done_${sceneId}_${index}`,
  merchantStock: (npcId, itemId)  => `merchant_stock_${npcId}_${itemId}`,
  tradeDiscount: (npcId)          => `trade_discount_${npcId}`,
  xpAwarded:     (sceneId)        => `xp_awarded_${sceneId}`,
};

// The state.checkState keys: object-valued check bookkeeping that conditions
// never read, kept out of the flag namespace.
export const CHECK_KEYS = {
  skillDc:          (skillId, sceneId) => `skill_dc_${skillId}_${sceneId}`,
  dialogueDc:       (npcId)            => `dialogue_dc_${npcId}`,
  dialogueResolved: (npcId)            => `dialogue_resolved_${npcId}`,
};

// Every CSS class JS refers to. Variant suffixes append to the base:
// `${CSS.SCENE_LOG}--${variant}`.
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
  // Section container and heading, shared by every panel
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

  // Cards: the one block for every titled box (see buildCard in core/utils.js)
  CARD:                   'card',
  CARD_TITLE:             'card__title',
  CARD_BODY:              'card__body',
  CARD_STATS:             'card__stats',
  CARD_DIRECTED:          'card--directed',
  OPTION_DIRECTION:       'option-direction',
  CARD_STAT_LABEL:        'card__stat-label',
  CARD_STAT_VALUE:        'card__stat-value',
  CARD_LIST:              'card-list',
  CARD_DONE:              'card--completed',
  CARD_NEW:               'card--new',

  // Collapsible section headings (inventory & sheet panels)
  SECTION_TOGGLE:           'section-toggle',
  SECTION_TOGGLE_COLLAPSED: 'section-toggle--collapsed',
  SECTION_TOGGLE_LABEL:     'section-toggle__label',
  SECTION_TOGGLE_COUNT:     'section-toggle__count',
  SECTION_TOGGLE_NOTIFY:    'section-toggle--notify',

  // Map
  MAP_NODE:               'map-node',
  MAP_NODE_CURRENT:       'map-node--current',
  MAP_NODE_PEEK:          'map-node--peek',
  MAP_NODE_BUILDING:      'map-node--building',
  MAP_NODE_LABEL:         'map-node__label',
  MAP_DOOR:               'map-door',
  MAP_DOOR_VERTICAL:      'map-door--vertical',
  MINIMAP_CANVAS:         'minimap__canvas',
  FULLMAP_INNER:          'fullmap-overlay__inner',

  // The shared cursor-following hover tooltip (minimap boxes, tab icons)
  CURSOR_TOOLTIP:         'cursor-tooltip',

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

// Every element id JS looks up.
export const EL = {
  // Narrative / scene
  SCENE_PANEL:             'scene-panel',
  SCENE_NARRATIVE:         'scene-narrative',
  SCENE_OPTIONS_PANEL:     'scene-options-panel',
  SCENE_OPTIONS:           'scene-options',
  SCENE_OPTIONS_TALK:      'scene-options-conversations',
  SCENE_OPTIONS_ACTIONS:   'scene-options-actions',
  SCENE_OPTIONS_SKILLS:    'scene-options-skills',
  SCENE_LOCATION_REMINDER: 'scene-location-reminder',

  // Toolbar buttons & file input
  BTN_SAVE:                'btn-save',
  BTN_LOAD:                'btn-load',
  BTN_RESTART:             'btn-restart',
  FILE_UPLOAD:             'file-upload',

  // Audio controls (options tab)
  AUDIO_MUTE:              'audio-mute',
  AUDIO_AMBIENCE_VOL:      'audio-ambience-volume',

  // The game shell and the character creation overlay that precedes it
  GAME_CONTAINER:          'game-container',
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

// Timers fire from inside advanceTime, mid-flow, so their pipelines are
// limited to quiet actions: state and logs, never navigation or combat.
export const TIMER_SAFE_ACTIONS = new Set(['set_flag', 'log', 'questTrigger', 'cancel_timer', 'set_timer']);

// COMPLETE and FAILED are terminal.
export const MISSION_STATUS = {
  NOT_STARTED: 'not_started',
  ACTIVE:      'active',
  COMPLETE:    'complete',
  FAILED:      'failed',
};

// The [Label] prefixes of the narrative log.
export const LOG = {
  SYSTEM:   'System',
  PLAYER:   'Player',
  COMBAT:   'Combat',
  QUEST:    'Quest',
  NARRATOR: 'Narrator',
};

// When the manifest has no worldMapSize.
export const DEFAULT_WORLD_MAP_SIZE = { width: 3000, height: 2000 };

// For map nodes without a background of their own.
export const MAP_NODE_DEFAULT_BG = 'var(--panel-bg)';

// The minimap square, in pixels.
export const MINIMAP_SIZE = 200;

// Around the map's bounding box, so scaled rooms keep a margin.
export const MAP_PADDING = 40;

// The one slot kind the engine depends on: combat reads attacks from it.
export const HAND_SLOT_KIND = 'hand';

// The item types the engine branches on; an omitted type is Flavour. A test
// cross-checks the enum in schemas/item.schema.json.
export const ITEM_TYPES = new Set(['Weapon', 'Spell', 'Armor', 'Consumable', 'Book', 'Special', 'Flavour']);

// What an unarmed enemy swings with, unless rules.fallbackWeapons.enemy says otherwise.
export const ENEMY_CLAW_ID = 'enemy_claw';

