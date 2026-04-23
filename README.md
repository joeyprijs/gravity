# Gravity

A browser-based text RPG engine. Define your world entirely in JSON — scenes, characters, quests, skills, and rules — with zero JavaScript required for content authoring.

**[Play the live demo](https://joeyprijs.github.io/gravity/)**

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [Content Authoring Reference](#content-authoring-reference)
  - [Manifest — `data/index.json`](#manifest--dataindexjson)
  - [Rules — `data/rules.json`](#rules--datarulesjon)
  - [Flags — `data/flags.json`](#flags--dataflagsjson)
  - [Scenes](#scenes)
  - [Actions](#actions)
  - [Loot Tables](#loot-tables)
  - [Items](#items)
  - [NPCs](#npcs)
  - [Missions](#missions)
  - [Locales — `data/locales.json`](#locales--datalocalesjson)
  - [The Flag & State System](#the-flag--state-system)
- [Custom Actions](#custom-actions)

---

## Features

- **Data-driven design** — all game content (scenes, items, NPCs, quests, rules) is JSON; no JS required to build a game
- **Custom skill system** — define any number of skills as plugins in `rules.json`; use them in scene skill checks with no code changes
- **Branching scenes** — conditional descriptions, gated options, one-time events, and auto-combat all driven by a flag/state system
- **Action pipeline** — each scene option runs a sequence of composable actions (loot, combat, dialogue, navigate, heal, set_flag, and more)
- **D&D-style combat** — turn-based, uses HP, AC, AP, Initiative, and Level/XP; supports multi-enemy encounters and auto-attack on entry
- **Character creation** — point-buy stat allocation before the game starts; stats are data-driven from `rules.json`
- **Inventory & equipment** — weapons, armor, spells, consumables, and flavour items; slot-based equipment with AP cost
- **Quest log** — missions triggered by scenes or NPC dialogue; tracked through a `not_started → active → complete` lifecycle
- **World map** — minimap HUD and full scrollable world map; scenes opt into the map via `mapDefinitions`
- **NPC dialogue & merchants** — branching conversation trees with skill checks, item rewards, and trade with optional discounts
- **Save / Load** — base64-encoded JSON saves; versioned schema with forward migration so old saves always load
- **Plugin API** — register custom actions at runtime via `window.gameEngine.registerAction()`

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | Vanilla JavaScript (ES modules) |
| Markup | HTML5 |
| Styling | Plain CSS (custom properties) |
| Build | None — runs directly in the browser |
| Dependencies | None |

---

## Project Structure

```
gravity/
├── index.html
├── css/
│   └── styles.css
├── src/
│   ├── core/
│   │   ├── engine.js        # Central orchestrator — loads data, wires subsystems
│   │   ├── state.js         # Game state, save/load, schema migration
│   │   ├── config.js        # Shared constants (CSS classes, element IDs, action names)
│   │   └── utils.js         # DOM helpers
│   ├── systems/
│   │   ├── actions.js       # Built-in action handlers
│   │   ├── combat.js        # Turn-based combat
│   │   ├── condition.js     # Condition tree evaluator
│   │   ├── dialogue.js      # NPC conversations and merchant UI
│   │   ├── dice.js          # roll() and parseDamage()
│   │   ├── narrative.js     # Narrative log
│   │   ├── quests.js        # Quest state and trigger processing
│   │   └── scene.js         # Scene rendering and navigation
│   ├── ui/
│   │   ├── ui.js            # Tabs, stat bar, save/load wiring
│   │   ├── inventory-ui.js  # Inventory and equipment panel
│   │   └── quest-ui.js      # Quest log panel
│   ├── world/
│   │   ├── map.js           # Minimap HUD and full world map
│   │   └── museum.js        # Museum chest UI
│   └── screens/
│       └── char-creation.js # Character creation screen
├── tests/
│   ├── combat.test.js
│   ├── condition.test.js
│   ├── char-creation.test.js
│   ├── dice.test.js
│   └── state.test.js
└── data/
    ├── index.json           # Manifest — all file paths and regions
    ├── rules.json           # Game rules — player defaults, skills, char creation, tabs
    ├── flags.json           # Initial flag values
    ├── locales.json         # All player-visible strings
    ├── scenes/              # Scene definitions (grouped by region)
    ├── items/               # Item definitions
    ├── npcs/                # NPC and enemy definitions
    ├── missions/            # Quest definitions
    └── tables/              # Loot tables
```

---

## Running Locally

No build step required. Serve the directory to avoid ES module CORS restrictions:

```bash
npx serve .
# or
python3 -m http.server
```

Then open `http://localhost:3000` (or whichever port your server uses).

**Running tests:**

```bash
npm test
```

Uses Node's built-in test runner (Node 18+). No `npm install` needed.

Open the browser console while authoring — the engine validates all cross-references on startup and logs warnings for broken IDs (unknown scene destinations, missing item/NPC references, invalid equipment slots).

---

## Content Authoring Reference

All game content is defined in JSON files under `data/`. Nothing needs recompiling — fix the JSON and refresh.

---

### Manifest — `data/index.json`

The central registry. Every data file must be listed here before the engine can use it.

```json
{
  "worldMapSize": { "width": 3000, "height": 2000 },
  "rules":   "data/rules.json",
  "flags":   "data/flags.json",
  "plugins": [],
  "regions": {
    "dungeon":     { "name": "The Dungeon" },
    "player_home": { "name": "Player Home" }
  },
  "scenes": {
    "dungeon_start": "data/scenes/dungeon/start.json"
  },
  "items": {
    "rusty_sword": "data/items/rusty_sword.json"
  },
  "npcs": {
    "goblin_guard": "data/npcs/goblin_guard.json"
  },
  "missions": {
    "escape_dungeon": "data/missions/escape_dungeon.json"
  },
  "tables": {
    "basic_loot": "data/tables/basic_loot.json"
  }
}
```

| Field | Description |
|---|---|
| `worldMapSize` | World canvas dimensions in px (default: 3000×2000) |
| `rules` | Path to `rules.json` |
| `flags` | Path to `flags.json` |
| `plugins` | Array of JS module URLs loaded as plugins (see [Custom Actions](#custom-actions)) |
| `regions` | Map of region keys to `{ "name": "..." }` — shown on the world map |
| `scenes` | Map of scene IDs to file paths |
| `items` | Map of item IDs to file paths |
| `npcs` | Map of NPC/enemy IDs to file paths |
| `missions` | Map of mission IDs to file paths |
| `tables` | Map of loot table IDs to file paths |

---

### Rules — `data/rules.json`

Central configuration for the game's mechanics. No JS needed to change these.

```json
{
  "startingScene":    "dungeon_start",
  "snackHealAmount":  2,
  "restHealAmount":   10,
  "levelUpHpBonus":   5,
  "xpPerLevel":       100,
  "fallbackWeapons": {
    "player": "unarmed_strike",
    "enemy":  "enemy_claw"
  },
  "playerDefaults": {
    "name": "",
    "level": 1,
    "xp": 0,
    "resources": {
      "hp":   { "current": 10, "max": 10 },
      "ap":   { "current": 3,  "max": 3  },
      "gold": 0
    },
    "attributes": {
      "ac": 10,
      "initiative": 0
    },
    "inventory": [],
    "equipment": {
      "Head": null, "Amulet": null, "Torso": null,
      "Left Hand": null, "Right Hand": null, "Legs": null
    }
  },
  "customAttributes": [
    { "id": "perception", "default": 0 },
    { "id": "charisma",   "default": 0 },
    { "id": "stealth",    "default": 0 }
  ],
  "charCreation": {
    "pointBudget": 3,
    "stats": [
      { "id": "resources.hp.max",      "localeKey": "maxHp",      "bonusPerPoint": 2, "min": 0 },
      { "id": "attributes.perception", "localeKey": "perception", "bonusPerPoint": 1, "min": 0 }
    ]
  },
  "tabs": [
    { "id": "inventory-tab",  "localeKey": "ui.tabInventory",  "default": true },
    { "id": "quests-tab",     "localeKey": "ui.tabQuests" },
    { "id": "attributes-tab", "localeKey": "ui.tabAttributes", "widget": "attributes" },
    { "id": "map-tab",        "localeKey": "ui.tabMap",        "widget": "map" }
  ]
}
```

#### `customAttributes`

Skills/attributes beyond the core stats (AC, initiative). Each entry is automatically:
- Added to every new player's `attributes` object
- Displayed in the Skills tab
- Available as a `skillCheck` target in scenes

```json
{ "id": "stealth", "default": 0 }
```

To add a new skill, add an entry here and a `localeKey` entry in `locales.json` under `charCreation.stats` and `actions.skillBadge`. No JS changes needed.

#### `charCreation.stats`

Controls which stats appear in the character creation point-buy screen. `id` is a dot-path into the player object (e.g. `"attributes.perception"`).

#### `tabs`

Defines the sidebar tabs. `widget: "attributes"` renders the custom skills panel; `widget: "map"` renders the minimap. Additional plain tabs can be added but require a custom renderer.

---

### Flags — `data/flags.json`

Declares all game-level flags and their initial values.

```json
{
  "door_unlocked":         false,
  "defeated_goblin_guard": false,
  "goblins_pacified":      false
}
```

Every flag referenced in a `condition` or `set_flag` action should be declared here. Undeclared flags default to `false`. The engine never overwrites existing save-file values on load, so changing an initial value only affects new games.

---

### Scenes

Each scene is a location the player can visit. It has a description, options, and optional skill checks.

#### Field reference

| Field | Type | Description |
|---|---|---|
| `title` / `name` | String | Display name (heading and map label). `title` takes precedence. |
| `region` | String | Region key from `index.json`. Required to appear on the map. |
| `description` | String or Array | Scene body text. See [Conditional descriptions](#conditional-descriptions). |
| `descriptionHook` | String | Appends dynamic content after the description. Supported: `"museumChestContents"`. |
| `mapDefinitions` | Object | Registers the scene on the world map (see below). |
| `questTrigger` | Object | Triggers a mission status change on entry: `{ "mission": "id", "status": "active" }`. |
| `xpReward` | Number | XP awarded on the player's first visit to this scene. |
| `autoAttack` | Object | Starts combat automatically on entry (see [Auto-combat](#auto-combat)). |
| `options` | Array | Standard choice buttons. See [Options](#options). |
| `skills` | Array | Skill-check buttons. See [Skills](#skills). |

**`mapDefinitions`:**

| Field | Description |
|---|---|
| `top`, `left` | Position on the world canvas (px) |
| `width`, `height` | Size of the map block (px) |
| `background` | CSS color for the block (e.g. `"rgba(30, 30, 50, 0.9)"`) |

#### Conditional descriptions

`description` can be an array to show different text depending on game state. The first entry whose `condition` matches is shown; an entry without `condition` is the fallback.

```json
"description": [
  {
    "text": "The door stands wide open.",
    "condition": { "flag": "door_unlocked", "value": true }
  },
  {
    "text": "A heavy door stands locked to the north."
  }
]
```

#### Options

Standard choices rendered as buttons. Each option runs an **actions pipeline** — an ordered array of actions executed in sequence.

```json
{
  "text": "Unlock the door",
  "condition":    { "flag": "door_unlocked", "value": false },
  "requirements": { "item": "cellar_key" },
  "actions": [
    { "type": "set_flag",  "flag": "door_unlocked", "value": true },
    { "type": "navigate",  "destination": "dungeon_corridor" }
  ]
}
```

| Field | Description |
|---|---|
| `text` | Button label. |
| `condition` | [Condition tree](#conditions) — option is hidden when not met. |
| `requirements.item` | Item ID that must be in inventory. Option is shown but disabled if missing. |
| `actions` | Array of actions to execute in order. See [Actions](#actions). |

#### Skills

Skill checks are rendered in a separate panel below standard options. They roll `1d20 + attribute` against a DC.

```json
{
  "text": "Slip past the goblins undetected.",
  "skillCheck": "stealth",
  "dc": 14,
  "increment": 2,
  "setFlag":     { "flag": "goblins_snuck_past", "value": true },
  "destination": "dungeon_chamber",
  "condition": { "flag": "goblins_pacified", "value": false }
}
```

Any custom attribute defined in `rules.customAttributes` can be used as a `skillCheck`. The corresponding `actions.skillBadge.<id>` locale key must exist for the badge text to render (see [Locales](#locales--datalocalesjson)).

**Pass/fail mode** — single DC, escalates on failure:

| Field | Description |
|---|---|
| `skillCheck` | Attribute ID to roll against (e.g. `"stealth"`, `"charisma"`, `"perception"`). |
| `dc` | Difficulty class. Player must roll ≥ DC to succeed. |
| `increment` | Added to DC on each failure. |
| `setFlag` | Flag to set on success. |
| `destination` | Scene to navigate to on success. |
| `condition` | Condition tree to show/hide this skill option. |
| `npcName` | Name shown in the success/failure log message. |

**Item-discovery mode** — finds items across multiple rolls (use `items` instead of `dc`):

```json
{
  "text": "Look Around",
  "skillCheck": "perception",
  "items": [
    { "item": "cellar_key",  "amount": 1, "dc": 10, "increment": 1 },
    { "table": "basic_loot", "dc": 14,    "increment": 2, "itemDrops": 2 }
  ]
}
```

Each item in the array has its own DC. Already-found items are removed; unfound DCs escalate per failure. Use `"table"` to draw from a [Loot Table](#loot-tables) instead of a fixed item.

| Field | Description |
|---|---|
| `item` | Fixed item ID to award on a successful roll. |
| `table` | Loot table ID — draws a random item on success. |
| `amount` | Quantity (default: 1). For fixed items. |
| `itemDrops` | Number of draws from the table (default: 1). |
| `dc` | DC for this specific item. |
| `increment` | DC increase per failed roll. |

#### Auto-combat

`autoAttack` starts a combat encounter immediately when the player enters the scene (if the condition passes).

```json
"autoAttack": {
  "enemies":   ["lost_wanderer"],
  "setFlag":   { "flag": "wanderer_defeated", "value": true },
  "destination": "dungeon_hallway",
  "condition": { "flag": "wanderer_defeated", "value": false }
}
```

| Field | Description |
|---|---|
| `enemies` | Array of NPC IDs to fight. |
| `setFlag` | Flag set on victory. |
| `destination` | Scene to navigate to on victory. |
| `condition` | If present, combat only starts when this evaluates to `true`. |

#### Conditions

The `condition` field supports a full boolean tree. Used on options, skills, descriptions, and dialogue responses.

```json
{
  "and": [
    { "flag": "guard_distracted", "value": true },
    { "not": { "flag": "defeated_goblin_guard", "value": true } }
  ]
}
```

**Leaf types:**

| Shape | Meaning |
|---|---|
| `{ "flag": "name", "value": true }` | Flag equals value |
| `{ "item": "item_id" }` | Player has item in inventory |
| `{ "level": 3 }` | Player level ≥ value |
| `{ "charisma": 2 }` | Player charisma ≥ value |
| `{ "gold": 50 }` | Player gold ≥ value |
| `{ "mission": "id", "status": "complete" }` | Mission is in the given status |

**Combinators:** `and` (all must pass), `or` (any must pass), `not` (inverts child).

> Note: only `charisma` is supported as a custom attribute in conditions. Other custom attributes (e.g. `stealth`) cannot currently be used as condition leaf types.

---

### Actions

Each option's `actions` array is a pipeline of steps executed in order. An action that triggers navigation (e.g. `navigate`, `combat`) ends the pipeline.

---

#### `loot` — give the player an item

```json
{ "type": "loot", "item": "healing_potion", "amount": 2, "xpReward": 10 }
```

| Field | Description |
|---|---|
| `item` | Item ID to add to inventory. |
| `amount` | Quantity (default: 1). |
| `xpReward` | XP to award alongside the item. |

---

#### `combat` — start a combat encounter

```json
{ "type": "combat", "enemies": ["goblin_guard", "goblin_grunt"], "setFlag": { "flag": "defeated_goblin_guard", "value": true } }
```

| Field | Description |
|---|---|
| `enemies` | Array of NPC IDs. |
| `setFlag` | Applied **only on victory**, not when the option is clicked. |
| `destination` | Scene to navigate to on victory. |

---

#### `dialogue` — start an NPC conversation

```json
{ "type": "dialogue", "npc": "mysterious_stranger" }
```

---

#### `navigate` — go to a scene

```json
{ "type": "navigate", "destination": "dungeon_hallway" }
```

---

#### `heal` — restore HP

```json
{ "type": "heal", "amount": 5 }
```

`amount` defaults to `rules.snackHealAmount`. Capped at the player's max HP.

---

#### `full_rest` — fully restore HP and AP

```json
{ "type": "full_rest" }
```

Restores the player to full HP and AP. Optionally add `"destination"` to navigate after.

---

#### `return` — return to previous location

```json
{ "type": "return" }
```

Navigates to the scene stored as the player's `returnSceneId` (set automatically when a consumable with `teleportScene` is used). Falls back to `rules.startingScene`.

---

#### `set_flag` — set a flag

```json
{ "type": "set_flag", "flag": "chest_looted", "value": true }
```

Runs as part of the action pipeline. To make an option disappear after use, combine with a `condition` on the option:

```json
{
  "text": "Search the chest",
  "condition": { "flag": "chest_looted", "value": false },
  "actions": [
    { "type": "set_flag",  "flag": "chest_looted", "value": true },
    { "type": "loot",      "item": "cellar_key" }
  ]
}
```

---

#### `log` — print a message

```json
{ "type": "log", "message": "The runes glow faintly." }
```

---

#### `manage_chest` — open the museum chest UI

```json
{ "type": "manage_chest" }
```

Opens the deposit/withdraw interface for the museum trophy chest.

---

### Loot Tables

Loot tables define a pool of items drawn from randomly. Used by the `"table"` field in skill check item-discovery mode.

```json
{
  "entries": [
    { "item": "gold",           "amount": 3  },
    { "item": "gold",           "amount": 50 },
    { "item": "healing_potion" },
    { "item": "simple_dagger"  }
  ]
}
```

Each entry is picked with equal probability. Use `"gold"` as the item ID to award currency.

---

### Items

Items live in `data/items/`. The key used in `index.json` is the item's ID everywhere in the game.

#### Field reference

| Field | Description |
|---|---|
| `name` | Display name. |
| `type` | Category: `Weapon`, `Spell`, `Armor`, `Consumable`, or `Flavour`. |
| `description` | Flavour text shown in inventory. |
| `value` | Gold value. Sell price = `floor(value × merchantSellRatio)`. Items without `value` cannot be sold. |
| `slot` | Equipment slot. Required for Weapon, Spell, Armor. E.g. `"Right Hand"`, `"Torso"`. |
| `actionPoints` | AP cost to equip during combat (default: 0). |
| `bonusHitChance` | Flat modifier added to attack rolls (Weapon/Spell). |
| `attributes` | Type-specific properties (see below). |

#### Item types

**`Weapon`** — melee or ranged, equipped in a hand slot.
```json
{ "name": "Rusty Sword", "type": "Weapon", "slot": "Right Hand", "actionPoints": 2,
  "attributes": { "damageRoll": "1d6" } }
```

**`Spell`** — magic attack, identical to Weapon in combat.
```json
{ "name": "Flames", "type": "Spell", "slot": "Left Hand", "bonusHitChance": 2,
  "attributes": { "damageRoll": "1d4+1" } }
```

**`Armor`** — improves Armor Class.
```json
{ "name": "Leather Armor", "type": "Armor", "slot": "Torso",
  "attributes": { "armorClassBonus": 2 } }
```

**`Consumable`** — single-use, activated from inventory.
```json
{ "name": "Healing Potion", "type": "Consumable",
  "attributes": { "healingAmount": "1d8+2" } }
```

| `attributes` field | Description |
|---|---|
| `healingAmount` | HP restored (dice notation or flat number). |
| `teleportScene` | Scene to navigate to on use. Sets `returnSceneId` so `return` can bring the player back. Cannot be used in combat. |

**`Flavour`** — story items with no mechanical effect.

---

### NPCs

NPCs serve as enemies (combat) or dialogue characters (conversations/merchants), or both.

#### Common fields

| Field | Description |
|---|---|
| `name` | Display name. |
| `attributes.healthPoints` | Starting HP (required for combat). |
| `attributes.armorClass` | AC — attacks must beat this to hit (required for combat). |
| `attributes.actionPoints` | AP per turn (required for combat). |
| `attributes.initiative` | Flat bonus to initiative roll. |
| `attributes.xpReward` | XP awarded to the player on defeat. |

#### Enemy fields

```json
{
  "name": "Goblin Guard",
  "attributes": { "healthPoints": 8, "armorClass": 8, "actionPoints": 3, "initiative": 1, "xpReward": 50 },
  "equipment": { "Right Hand": "rusty_sword" },
  "droppedLoot": [
    { "item": "gold", "amount": 10 },
    { "item": "healing_potion", "amount": 1 }
  ]
}
```

`droppedLoot` is given to the player on victory. Use `"gold"` as the item ID to award currency directly.

#### Dialogue NPC / Merchant fields

```json
{
  "name": "Mysterious Stranger",
  "isMerchant": true,
  "carriedItems": [
    { "item": "healing_potion", "amount": 3 }
  ],
  "storeExitText": "Safe travels.",
  "conversations": {
    "start": {
      "npcText": "Greetings, traveler.",
      "responses": [
        { "text": "Let's trade.",     "actions": [{ "type": "trade" }] },
        { "text": "I must be going.", "actions": [{ "type": "leave" }] }
      ]
    }
  }
}
```

| Field | Description |
|---|---|
| `isMerchant` | Enables the buy/sell UI. |
| `carriedItems` | Items the merchant sells. Each entry: `{ "item": "id", "amount": N }`. Unlimited stock if `amount` is omitted. |
| `storeExitText` | Farewell line when the player leaves the store. |
| `conversations` | Dialogue tree. Entry point is always `"start"`. |

**Conversation node fields:**

| Field | Description |
|---|---|
| `npcText` | What the NPC says. |
| `actions` | Actions executed when this node is reached (e.g. `loot`, `set_flag`). |
| `questTrigger` | `{ "mission": "id", "status": "active" }` — triggers a quest. |
| `responses` | Array of player reply options. |

**Response fields:**

| Field | Description |
|---|---|
| `text` | Button label. |
| `actions` | Actions executed when this response is chosen. Use `{ "type": "goToConversation", "node": "id" }` to advance the tree, `{ "type": "leave" }` to exit, `{ "type": "trade" }` to open the merchant UI. |
| `condition` | [Condition tree](#conditions) — hides this response when not met. |
| `skillCheck` | Attribute ID for a skill check on this response. |
| `dc` / `increment` | DC and escalation for the skill check. |
| `makeFriendly` | On success, sets `friendly_<npcId>` so combat options filter out this NPC. |
| `tradeDiscount` | Percentage discount applied when this response opens the store. |
| `persistDiscount` | Saves the discount to the save file for all future visits. |

---

### Missions

```json
{
  "name": "Escape the Dungeon",
  "description": "Find a way out of this wretched dungeon.",
  "missionRewards": { "xp": 100, "gold": 20 }
}
```

Status lifecycle: `not_started` → `active` → `complete`. Transitions are one-way.

Triggered by a scene's `questTrigger` or a dialogue node/response's `questTrigger`.

---

### Locales — `data/locales.json`

All player-visible strings live here. Edit values freely; keep keys and `{placeholder}` tokens intact.

To support a new custom skill, add entries in two places:

```json
"charCreation": {
  "stats": {
    "stealth": { "label": "Stealth", "description": "+1 Stealth per point" }
  }
},
"actions": {
  "skillBadge": {
    "stealth": "DC {dc}, Skill: Stealth"
  }
}
```

---

### The Flag & State System

Flags are the engine's core persistence mechanism. They drive conditional descriptions, option visibility, one-time events, and combat outcomes.

All game flags should be declared in `data/flags.json` with their initial value. Undeclared flags default to `false`.

#### System-managed flags

The engine sets these automatically — no need to declare them in `flags.json`.

| Pattern | Set when | Value |
|---|---|---|
| `xp_awarded_{sceneId}` | First visit to a scene with `xpReward` | `true` |
| `friendly_{npcId}` | Successful `makeFriendly` dialogue response | `true` |
| `trade_discount_{npcId}` | Response with `persistDiscount: true` | Discount % |
| `skill_dc_{skill}_{sceneId}` | Runtime state for skill check progress | Object |

---

## Custom Actions

Register custom action types at runtime using the plugin API. Create a JS module and list it in `index.json` under `plugins`:

```js
// data/plugins/my-plugin.js
export default function(engine) {
  engine.registerAction('grant_xp', (action, engine) => {
    gameState.addXP(action.amount);
    engine.log('System', `Gained ${action.amount} XP.`);
  });
}
```

```json
// data/index.json
{ "plugins": ["data/plugins/my-plugin.js"] }
```

Use the action in any scene:

```json
{ "type": "grant_xp", "amount": 50 }
```

The handler receives the full action object (all fields from the JSON) and the engine instance (`engine.log`, `engine.t`, `engine.renderScene`, `engine.data`, etc.). Navigation is not automatic — call `engine.renderScene(action.destination)` explicitly, or add a `navigate` action in the pipeline after your custom action.
