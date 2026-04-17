# Gravity

A browser-based text RPG inspired by classic choose-your-own-adventure games. Navigate branching scenes, fight enemies with D&D-style combat, manage your inventory, track quests, and explore a growing world — all in the browser with zero dependencies.

**[Play the live demo](https://joeyprijs.github.io/gravity/)**

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [Content Authoring Reference](#content-authoring-reference)
  - [Manifest](#manifest--dataindexjson)
  - [Flags](#flags--dataflagsjson)
  - [Scenes](#scenes)
    - [Conditional descriptions](#conditional-descriptions)
    - [Options](#options)
    - [Skills](#skills)
    - [Conditions](#conditions)
  - [Actions](#actions)
    - [loot](#loot--give-the-player-an-item)
    - [combat](#combat--start-a-combat-encounter)
    - [dialogue](#dialogue--start-an-npc-conversation)
    - [rest](#rest--restore-a-fixed-amount-of-hp)
    - [full_rest](#full_rest--fully-restore-hp-and-ap)
    - [return_to_world](#return_to_world--teleport-back-to-the-previous-location)
    - [eat_snack](#eat_snack--restore-a-small-amount-of-hp)
    - [manage_chest](#manage_chest--open-the-museum-chest-ui)
  - [Items](#items)
  - [NPCs](#npcs)
  - [Missions](#missions)
  - [Locales](#locales--datalocalesjson)
  - [The Flag & State System](#the-flag--state-system)

## Features

- **Character creation** — name your character and distribute stat points before your adventure begins; designed to be extended with backgrounds and feats
- **Scene system** — branching narrative driven by JSON scene definitions; choices can require items, check state flags, trigger quests, and more
- **Skill checks** — perception (Look Around) and charisma checks shown in a separate panel; DCs escalate on failure and reset on re-entry
- **D&D-style combat** — turn-based fights using HP, Armor Class, Action Points, Initiative, and Level/XP
- **Inventory & equipment** — collect, equip, and use items across weapons, armor, spells, and consumables
- **Quest log** — missions triggered by scene entry or NPC dialogue, tracked as active or completed
- **World map** — minimap HUD showing your current region, click to open a scrollable full world map
- **Save / Load** — export and import save files to persist progress across sessions; versioned schema with forward-migration

## Tech Stack

| Concern | Choice |
|---|---|
| Language | Vanilla JavaScript (ES modules) |
| Markup | HTML5 |
| Styling | Plain CSS (custom properties, panel-based UI) |
| Build | None — runs directly in the browser |
| Dependencies | None |

## Project Structure

```
gravity/
├── index.html          # Entry point
├── package.json        # Minimal config — "type": "module" + test script (no runtime deps)
├── css/
│   └── styles.css      # All styles
├── src/
│   ├── core/           # Engine fundamentals
│   │   ├── engine.js   # Orchestrator — loads data, wires all systems together
│   │   ├── state.js    # Game state, save/load, and schema migration
│   │   ├── config.js   # Shared constants (CSS classes, element IDs, CHAR_CREATION config)
│   │   └── utils.js    # DOM helpers (createElement, buildOptionButton, etc.)
│   ├── systems/        # Game mechanics
│   │   ├── combat.js   # Turn-based combat — initiative, attacks, AP, victory/defeat
│   │   ├── dialogue.js # NPC conversations and merchant buy/sell interface
│   │   ├── scene.js    # Scene rendering and navigation
│   │   ├── narrative.js# Narrative log — scene descriptions, choices, system messages
│   │   ├── actions.js  # Built-in scene action handlers (loot, rest, dialogue, etc.)
│   │   ├── quests.js   # Quest state management and trigger processing
│   │   ├── condition.js# Condition tree evaluator (and/or/not/flag/item/level/gold)
│   │   └── dice.js     # Pure dice math — roll() and parseDamage(), no dependencies
│   ├── ui/             # UI rendering
│   │   ├── ui.js       # UI coordinator (tabs, save/load, stat bar, item actions)
│   │   ├── inventory-ui.js # Inventory and equipment panel rendering
│   │   └── quest-ui.js # Quest log panel rendering
│   ├── world/          # World / map
│   │   ├── map.js      # Minimap HUD and full world map overlay
│   │   └── museum.js   # Museum chest deposit/withdraw UI
│   └── screens/        # Full-screen overlays
│       └── char-creation.js # Character creation screen (name + stat point allocation)
├── tests/
│   ├── dice.test.js          # Tests for roll() and parseDamage()
│   ├── condition.test.js     # Tests for the condition tree evaluator
│   ├── state.test.js         # Tests for StateManager (XP, inventory, flags, log cap)
│   ├── combat.test.js        # Tests for combat logic (attacks, turns, initiative)
│   └── char-creation.test.js # Tests for char creation (point budget, bonuses, migration)
└── data/
    ├── index.json      # Manifest — regions, world map size, file paths
    ├── flags.json      # All game-level flags with their initial values
    ├── locales.json    # All player-visible strings (UI labels, log messages, button text)
    ├── scenes/         # Scene definitions (grouped by region)
    ├── items/          # Item definitions
    ├── npcs/           # NPC and enemy definitions
    └── missions/       # Quest definitions
```

## Running Locally

No build step required. Open `index.html` directly in a browser, or serve the directory to avoid ES module CORS restrictions:

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

Uses Node's built-in test runner (Node 18+). No `npm install` needed — there are no dependencies.

Open the browser's developer console while authoring — the engine validates all cross-references on startup and logs a warning for any broken IDs (unknown scene destinations, missing item/NPC references, invalid equipment). No reload or build step needed; just fix the JSON and refresh.

---

## Content Authoring Reference

All game content is defined as JSON files in the `data/` directory and hot-loaded at runtime. Nothing needs recompiling. The sections below document every supported field for each data type.

---

### Manifest — `data/index.json`

The central registry. Every data file must be listed here before the engine can use it.

```json
{
  "worldMapSize": { "width": 3000, "height": 2000 },
  "flags": "data/flags.json",
  "regions": {
    "dungeon": { "name": "The Dungeon" },
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
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `worldMapSize.width` | Number | No | World canvas width in px (default: 3000) |
| `worldMapSize.height` | Number | No | World canvas height in px (default: 2000) |
| `flags` | String | No | Path to the flags declaration file (see [Flags](#flags--dataflagsjson)) |
| `regions` | Object | No | Map of region keys to region definitions |
| `regions[key].name` | String | Yes | Human-readable region name shown on the map |
| `scenes` | Object | Yes | Map of scene IDs to file paths |
| `items` | Object | Yes | Map of item IDs to file paths |
| `npcs` | Object | Yes | Map of NPC IDs to file paths |
| `missions` | Object | Yes | Map of mission IDs to file paths |

---

### Flags — `data/flags.json`

Declares all game-level boolean flags and their initial values. The engine registers these on startup so options that depend on flag state are displayed correctly from the very first scene.

```json
{
  "door_unlocked":        false,
  "defeated_goblin_guard": false,
  "goblins_pacified":     false
}
```

Every flag that appears in a `condition`, `setFlag`, or scene `description` array should be listed here. Flags not listed here are implicitly `false` until set. The engine does not overwrite existing save-file values on load, so changing an initial value only affects new games.

---

### Scenes

Scenes are the core unit of the game. Each scene is a location the player can visit, with a description, a set of options, and optional hooks for quests, state, and the world map.

#### Full field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | String | Yes* | Display name of the scene. Used as heading and map label. Use `title` for more dramatic names. |
| `title` | String | Yes* | Alternative to `name`. Takes precedence where both exist. Preferred for story-driven scenes. |
| `region` | String | No | Region key (must match a key in `index.json` `regions`). Required for the scene to appear on the minimap. |
| `description` | String or Array | Yes | Scene body text. Can be a plain string or a conditional array (see below). |
| `descriptionHook` | String | No | Appends dynamic content to the description. Only supported value: `"museumChestContents"` (lists items stored in the museum chest). |
| `mapDefinitions` | Object | No | Registers the scene on the world map. Omit to keep the scene off the map. |
| `mapDefinitions.top` | Number | Yes | Y position on the world canvas (pixels from top). |
| `mapDefinitions.left` | Number | Yes | X position on the world canvas (pixels from left). |
| `mapDefinitions.width` | Number | Yes | Width of the scene block on the map (pixels). |
| `mapDefinitions.height` | Number | Yes | Height of the scene block on the map (pixels). |
| `mapDefinitions.background` | String | Yes | CSS colour for the map block (e.g. `"rgba(30, 30, 50, 0.9)"`). |
| `questTrigger` | Object | No | Triggers a mission status change every time this scene is entered. |
| `questTrigger.mission` | String | Yes | Mission ID to update. |
| `questTrigger.status` | String | Yes | New status: `"active"` or `"complete"`. |
| `xpReward` | Number | No | XP awarded the first time the player visits this scene. Only granted once per save. |
| `options` | Array | No | Standard choices shown to the player. See [Options](#options) below. |
| `skills` | Array | No | Skill-check choices (perception / charisma). See [Skills](#skills) below. |

*One of `name` or `title` is required.

#### Conditional descriptions

`description` can be an array of objects to show different text based on game state. The engine displays the first entry whose `condition` matches; an entry with no `condition` is the fallback.

```json
"description": [
  {
    "text": "The heavy door stands wide open to the north.",
    "condition": { "flag": "door_unlocked", "value": true }
  },
  {
    "text": "You awake in a dimly lit cellar. A heavy wooden door stands locked to the north."
  }
]
```

| Field | Type | Description |
|---|---|---|
| `text` | String | The description text to display. |
| `condition` | Object | Optional condition tree. If omitted, this entry is the fallback. See [Conditions](#conditions). |

#### Options

Each entry in the `options` array renders as a clickable button. Options are for navigation and actions. For perception or charisma checks, use [`skills`](#skills) instead.

```json
{
  "text": "Unlock the door",
  "destination": "dungeon_hallway",
  "requirements": { "item": "cellar_key" },
  "condition": { "flag": "door_unlocked", "value": false },
  "setFlag": { "flag": "door_unlocked", "value": true }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | String | Yes | Button label shown to the player. |
| `destination` | String | No | Scene ID to navigate to after the action resolves. |
| `action` | String | No | Action to execute. See [Actions](#actions) below. |
| `actionDetails` | Object | No | Parameters for the action. Shape depends on `action` type. |
| `requirements.item` | String | No | Item ID that must be in the player's inventory. Option is disabled (greyed out) if the item is missing. |
| `condition` | Object | No | Condition tree. Option is hidden when not met. See [Conditions](#conditions). |
| `setFlag` | Object | No | Sets a flag when this option is chosen, before the action or navigation runs. Shape: `{ "flag": "name", "value": true }`. Not applied for `combat` options (those use `setFlag` only on victory). |

#### Skills

The `skills` array holds options that require a dice roll. They are rendered in a separate panel below the main options and support escalating DCs on failure. DCs reset each time the player re-enters the scene.

**Perception check** (`perceptionCheck: true`) — rolls 1d20 + Perception vs the item's DC. Items not yet found remain available; items already found are removed from the check.

```json
{
  "text": "Look Around",
  "perceptionCheck": true,
  "items": [
    { "item": "cellar_key", "amount": 1, "dc": 10, "increment": 1 }
  ]
}
```

Omit `items` for a flavour-only check that disappears after one use.

**Charisma check** (`charismaCheck: true`) — rolls 1d20 + Charisma vs DC.

```json
{
  "text": "Talk your way past the guard",
  "charismaCheck": true,
  "dc": 15,
  "increment": 2,
  "npcName": "Guard",
  "setFlag": { "flag": "guard_persuaded", "value": true },
  "destination": "dungeon_hallway",
  "condition": { "flag": "guard_persuaded", "value": false }
}
```

| Field | Type | Description |
|---|---|---|
| `perceptionCheck` | Boolean | Triggers a Perception roll. |
| `charismaCheck` | Boolean | Triggers a Charisma (social) roll. |
| `dc` | Number | Difficulty class. The player must roll ≥ DC to succeed. |
| `increment` | Number | DC increase on each failure (makes repeated attempts harder). |
| `npcName` | String | Name shown in the success/failure log message (charisma checks). |
| `items` | Array | Items to search for (perception checks). Each entry: `{ item, amount, dc, increment }`. |
| `setFlag` | Object | Flag to set on success: `{ "flag": "name", "value": true }`. |
| `destination` | String | Scene to navigate to on success (defaults to current scene). |
| `condition` | Object | Condition tree to show/hide this skill option. |

#### Conditions

The `condition` field supports a full boolean tree. It is used on options, skills, dialogue responses, and conditional description entries.

```json
{
  "condition": {
    "and": [
      { "flag": "guard_distracted", "value": true },
      { "not": { "flag": "defeated_goblin_guard", "value": true } }
    ]
  }
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
| `{ "mission": "mission_id", "status": "complete" }` | Mission is in the given status (`"not_started"`, `"active"`, or `"complete"`) |

**Combinators:** `and` (array, all must pass), `or` (array, any must pass), `not` (single child, inverted).

---

### Actions

The `action` field on an option triggers engine behaviour beyond simple navigation. All actions can be combined with `destination` to also navigate after the action resolves.

#### `loot` — Give the player an item

```json
{
  "text": "Search the chest",
  "action": "loot",
  "actionDetails": {
    "item": "cellar_key",
    "amount": 1,
    "xpReward": 10
  },
  "setFlag": { "flag": "chest_searched", "value": true },
  "condition": { "flag": "chest_searched", "value": false }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `item` | String | Yes | Item ID to add to the player's inventory. |
| `amount` | Number | No | Quantity to add (default: 1). |
| `xpReward` | Number | No | XP to award alongside the item. |

To make a loot option disappear after use, add a `setFlag` and a matching `condition` on the option (see example above).

#### `combat` — Start a combat encounter

```json
{
  "text": "Prepare to fight!",
  "action": "combat",
  "actionDetails": { "enemies": ["goblin_guard", "goblin_grunt"] },
  "setFlag": { "flag": "defeated_goblin_guard", "value": true },
  "condition": { "flag": "defeated_goblin_guard", "value": false }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `enemies` | Array | Yes* | List of NPC IDs to fight simultaneously. Each must have `attributes.healthPoints` and `attributes.armorClass`. |
| `enemy` | String | No* | Legacy single-enemy shorthand. Use `enemies` for new content. |

*One of `enemies` or `enemy` is required.

`setFlag` on a combat option is applied **only on victory** — not before the fight starts. Loot and XP are aggregated from all defeated enemies.

#### `dialogue` — Start an NPC conversation

```json
{
  "text": "Talk to the stranger",
  "action": "dialogue",
  "actionDetails": { "npc": "mysterious_stranger" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `npc` | String | Yes | NPC ID. The NPC's `conversations` tree (or merchant UI) is shown. |

#### `rest` — Restore a fixed amount of HP

```json
{
  "text": "Rest here (Restore HP)",
  "action": "rest",
  "actionDetails": { "heal": 10 },
  "setFlag": { "flag": "chamber_rested", "value": true },
  "condition": { "flag": "chamber_rested", "value": false }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `heal` | Number | No | HP to restore (default: 15). Capped at the player's max HP. |

To make the rest option disappear after use, add a `setFlag` and a matching `condition` on the option (see example above).

#### `full_rest` — Fully restore HP and AP

```json
{
  "text": "Sleep (Full Rest)",
  "action": "full_rest"
}
```

No `actionDetails` needed. Restores the player to full HP and full AP. Intended for safe rest locations like a bedroom.

#### `return_to_world` — Teleport back to the previous location

```json
{
  "text": "Return via Teleport",
  "action": "return_to_world",
  "requirements": { "item": "home_rune" }
}
```

No `actionDetails`. Navigates to the scene stored as the player's `returnSceneId` (set automatically when a consumable with `teleportScene` is used). Falls back to `"dungeon_start"` if unset.

#### `eat_snack` — Restore a small amount of HP

```json
{
  "text": "Eat a Snack",
  "action": "eat_snack"
}
```

No `actionDetails`. Restores 5 HP. Intended for kitchen/home scenes.

#### `manage_chest` — Open the museum chest UI

```json
{
  "text": "Manage Museum Chest",
  "action": "manage_chest"
}
```

No `actionDetails`. Opens the deposit/withdraw interface for the museum trophy chest.

---

### Items

Items live in `data/items/`. The file's key in `index.json` is its ID throughout the game.

#### Full field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | String | Yes | Display name shown in inventory and UI. |
| `type` | String | Yes | Category. Controls UI grouping and equip behaviour. See types below. |
| `description` | String | No | Flavour text shown in inventory. |
| `value` | Number | No | Gold value. Used for merchant buy price. Sell price = `floor(value × 0.5)`. Items without `value` (or `value: 0`) cannot be sold. |
| `actionPoints` | Number | No | AP cost to equip this item during combat (default: 0). |
| `slot` | String | No | Equipment slot. Required for Weapon, Spell, and Armor types. Common values: `"Right Hand"`, `"Left Hand"`, `"Torso"`. |
| `bonusHitChance` | Number | No | Flat bonus (or penalty if negative) added to attack rolls. Weapons and spells only. |
| `attributes` | Object | No | Type-specific properties. See per-type details below. |

#### Item types

**`Weapon`** — Melee or ranged weapons equipped in a hand slot.

```json
{
  "name": "Rusty Sword",
  "type": "Weapon",
  "slot": "Right Hand",
  "value": 5,
  "actionPoints": 2,
  "bonusHitChance": 0,
  "attributes": { "damageRoll": "1d6" }
}
```

`attributes.damageRoll` (String, required): Dice notation for damage. Supported formats: `"1d6"`, `"2d4+2"`, `"1d8-1"`.

---

**`Spell`** — Magic attacks, behave identically to weapons in combat.

```json
{
  "name": "Flames",
  "type": "Spell",
  "slot": "Left Hand",
  "value": 30,
  "actionPoints": 2,
  "bonusHitChance": 2,
  "attributes": { "damageRoll": "1d4+1" }
}
```

---

**`Armor`** — Protective gear that improves Armor Class.

```json
{
  "name": "Leather Armor",
  "type": "Armor",
  "slot": "Torso",
  "value": 15,
  "attributes": { "armorClassBonus": 2 }
}
```

`attributes.armorClassBonus` (Number, required): Added to the player's base AC. Multiple pieces of armor stack.

---

**`Consumable`** — Single-use items activated from the inventory.

```json
{
  "name": "Healing Potion",
  "type": "Consumable",
  "value": 10,
  "attributes": { "healingAmount": "1d8+2" }
}
```

| `attributes` field | Type | Description |
|---|---|---|
| `healingAmount` | String or Number | HP restored on use. Dice notation (`"1d8+2"`) or a flat number. |
| `teleportScene` | String | Scene ID to navigate to on use. Cannot be used during combat. Also sets `returnSceneId` so `return_to_world` can bring the player back. |

A consumable can have both `healingAmount` and `teleportScene`.

---

**`Flavour`** — Story items with no mechanical effect. Shown in inventory but cannot be equipped or used.

---

### NPCs

NPCs serve two roles depending on their fields: **enemies** (combat encounters) or **dialogue characters** (conversations and merchants). Both types share the same file format.

#### Common fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | String | Yes | Display name. |
| `description` | String | No | Shown in combat log or dialogue header. |
| `disposition` | String | No | Flavour label (e.g. `"Hostile"`, `"Friendly"`). Not mechanically enforced. |
| `attributes.healthPoints` | Number | Yes (combat) | Starting HP. |
| `attributes.armorClass` | Number | Yes (combat) | AC — attacks must beat this to hit. |
| `attributes.actionPoints` | Number | Yes (combat) | AP available per turn. |
| `attributes.initiative` | Number | No | Flat bonus added to the NPC's initiative roll (1d20 + initiative). |
| `attributes.xpReward` | Number | No | XP awarded to the player on defeating this NPC. |

#### Enemy-specific fields

```json
{
  "name": "Cave Goblin Guard",
  "attributes": {
    "healthPoints": 8,
    "armorClass": 8,
    "actionPoints": 3,
    "initiative": 1,
    "xpReward": 50
  },
  "equipment": {
    "Right Hand": "rusty_sword"
  },
  "droppedLoot": [
    { "item": "gold", "amount": 10 },
    { "item": "healing_potion", "amount": 1 }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `equipment` | Object | Slots the NPC has items equipped in. Keys are slot names, values are item IDs. The NPC uses equipped weapons to attack. |
| `droppedLoot` | Array | Items given to the player on victory. Use `"gold"` as the item ID to award gold directly. |
| `droppedLoot[].item` | String | Item ID, or `"gold"` for currency. |
| `droppedLoot[].amount` | Number | Quantity. |

#### Dialogue NPC / Merchant fields

```json
{
  "name": "Mysterious Stranger",
  "isMerchant": true,
  "carriedItems": [
    "rusty_sword",
    { "item": "healing_potion", "amount": 3 }
  ],
  "storeExitText": "Safe travels.",
  "conversations": {
    "start": {
      "npcText": "Greetings, traveler. Looking to trade?",
      "responses": [
        { "text": "Show me your wares.", "action": "trade" },
        { "text": "Just passing through.", "action": "leave" }
      ]
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `isMerchant` | Boolean | Enables the buy/sell merchant UI. |
| `carriedItems` | Array | Items the merchant sells. Each entry is either a plain item ID string (unlimited stock) or `{ "item": "id", "amount": N }` for limited stock that depletes on purchase. |
| `storeExitText` | String | NPC's farewell line when the player leaves the store (default: `"Come again."`). |
| `conversations` | Object | Dialogue tree. Keys are node IDs, entry point is always `"start"`. |

**Conversation node:**

| Field | Type | Description |
|---|---|---|
| `npcText` | String | What the NPC says when this node is reached. |
| `giveItem` | String | Item ID to give the player when this node is reached. |
| `giveItemAmount` | Number | Quantity to give (default: 1). |
| `setFlag` | Object | Flag to set when this node is reached: `{ "flag": "name", "value": true }`. |
| `questTrigger` | Object | Quest to activate or complete: `{ "mission": "id", "status": "active" }`. |
| `responses` | Array | Player's reply options for this node. |

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `text` | String | Button text for this reply. |
| `goToConversation` | String | Node ID to navigate to next. |
| `action` | String | `"trade"` — opens the merchant UI. `"leave"` — ends dialogue and returns to the scene. |
| `condition` | Object | [Condition tree](#conditions) — hides this response when not met. |
| `charismaCheck` | Boolean | Requires a Charisma roll (1d20 + Charisma ≥ DC) before the response fires. |
| `dc` | Number | Difficulty class for the charisma check. |
| `increment` | Number | DC increase on each failure. |
| `setFlag` | Object | Flag to set when this response is chosen: `{ "flag": "name", "value": true }`. |
| `giveItem` | String | Item ID to give the player when this response is chosen. |
| `giveItemAmount` | Number | Quantity to give (default: 1). |
| `questTrigger` | Object | Quest to activate or complete: `{ "mission": "id", "status": "active" }`. |
| `makeFriendly` | Boolean | On a successful charisma check, sets `friendly_<npcId>` to `true`. Combat options filter out friendly NPCs. |
| `tradeDiscount` | Number | Percentage discount applied to the merchant's prices when this response opens the store (e.g. `10` = 10% off). |
| `persistDiscount` | Boolean | Saves the discount to the player's save file so it applies to all future visits. |

A response fires side effects (`setFlag`, `giveItem`, `questTrigger`) before navigation (`goToConversation` or `action`).

---

### Missions

Missions (quests) live in `data/missions/`. They are triggered by scenes or NPC dialogue and tracked through a one-way status progression.

```json
{
  "name": "Escape the Dungeon",
  "description": "Find a way out of this wretched dungeon.",
  "missionRewards": {
    "xp": 100,
    "gold": 20
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | String | Yes | Quest name shown in the quest log. |
| `description` | String | Yes | Objective text shown when the quest is active. |
| `missionRewards.xp` | Number | No | XP awarded when the mission is completed. |
| `missionRewards.gold` | Number | No | Gold awarded when the mission is completed. |

**Status lifecycle:** `not_started` → `active` → `complete`

Transitions are triggered by a scene's `questTrigger` field or a dialogue node/response's `questTrigger`. The progression is one-way — a completed mission cannot be reactivated.

---

### Locales — `data/locales.json`

All player-visible strings (UI labels, button text, log messages, combat narration) live in `data/locales.json`. Editing this file is the only thing needed to change any text in the game — no JavaScript knowledge required.

The file is organised into namespaces that mirror the engine's subsystems:

```json
{
  "system":      { "saved": "Game Saved to Disk.", ... },
  "charCreation":{ "stats": { "maxHp": { "label": "Health (HP)", "description": "..." }, ... } },
  "stats":       { "hp": "HP: {current}/{max}", ... },
  "ui":          { "inventoryEmpty": "Inventory is empty.", ... },
  "itemTypes":   { "Weapon": "Weapons", "Spell": "Spells", ... },
  "inventory":   { "useButton": "Use", "equipButton": "Equip", ... },
  "loot":        { "receivedItem": "You received {name}!", ... },
  "actions":     { "rested": "You rested and recovered HP.", ... },
  "player":      { "equipped": "Equipped {name} to {slot}.", ... },
  "combat":      { "attackHit": "Attack Roll with {weapon}: ...", ... },
  "dialogue":    { "buyButton": "Buy {name}", ... },
  "quest":       { "completed": "Quest complete: {name}!", ... }
}
```

Strings can include `{placeholder}` tokens. The engine substitutes them at runtime — e.g. `"HP: {current}/{max}"` becomes `"HP: 12/20"`. To translate the game or rebrand the UI, replace the string values while keeping the keys and placeholders intact.

---

### The Flag & State System

Flags are the engine's core mechanism for persistent per-save state. They power conditional descriptions, option visibility, one-time events, and combat outcomes.

#### Declaring flags

All game-level flags live in `data/flags.json` with their initial values:

```json
{
  "door_unlocked":        false,
  "defeated_goblin_guard": false
}
```

The engine registers these on startup. A flag not listed here is implicitly `false` until set. Adding a new flag-gated option requires adding the flag to `flags.json` first so the initial state is predictable across new games and resets.

#### Showing/hiding options with `condition`

An option with a `condition` is only visible when it evaluates to `true`:

```json
{
  "text": "Unlock the door",
  "condition": { "flag": "door_unlocked", "value": false }
}
```

This option disappears once `door_unlocked` becomes `true`. The same `condition` field works on description array entries and dialogue responses.

#### Mutating flags with `setFlag`

Set a flag when an option is chosen:

```json
{
  "text": "Unlock the door",
  "setFlag": { "flag": "door_unlocked", "value": true }
}
```

The flag is set before the scene re-renders, so the updated state is immediately reflected in which options and descriptions are shown.

For `combat` options, `setFlag` is applied **only on victory** (handled inside the combat system after the fight ends), not when the option is clicked.

#### System-managed flags

The engine creates some flags automatically at runtime. These do not need to be listed in `flags.json`.

| Flag pattern | When set | Value |
|---|---|---|
| `xp_awarded_{sceneId}` | First visit to a scene with `xpReward` | `true` |
| `friendly_{npcId}` | Successful `makeFriendly` charisma check in dialogue | `true` |
| `trade_discount_{npcId}` | Response with `persistDiscount: true` opens trade | Discount % |
| `look_around_{sceneId}` | Runtime state for perception check progress | Object |
| `scene_charisma_{sceneId}` | Runtime state for scene-level charisma DC escalation | Object |
| `charisma_dc_{npcId}` | Runtime state for NPC dialogue charisma DC escalation | Object |
