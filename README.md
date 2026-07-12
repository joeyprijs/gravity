# Gravity

[![License: Unlicense](https://img.shields.io/badge/License-Unlicense-blue.svg)](LICENSE)
[![Dependencies: None](https://img.shields.io/badge/Dependencies-Zero-success.svg)](#tech-stack)
[![Platform: Browser](https://img.shields.io/badge/Platform-Browser--Native-cyan.svg)](#running-locally)
[![Tests: Node Native](https://img.shields.io/badge/Tests-Node--Native-emerald.svg)](#running-locally)

A browser-native, zero-dependency, data-driven text RPG engine. Define your entire world — scenes, branching dialogue, characters, quests, items, rules, and maps — in JSON, with no scripting required.

**[Play the Live Demo](https://joeyprijs.github.io/gravity/)**

---

> [!NOTE]
> **🤖 100% AI-Generated Codebase**
> This entire codebase (the browser-based text RPG engine, the reactive state manager, the full-screen world map, and all companion unit tests) was fully researched, architected, written, documented, and optimized by Artificial Intelligence (specifically **Claude** and **Gemini**). A human served as the Project Manager, providing direction and structural reviews, but did not write a single line of the code. It is released as completely free and unencumbered public domain code.

---

## Table of Contents

- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [Core Concepts](#core-concepts)
- [The Player UI](#the-player-ui)
- [Content Authoring Reference](#content-authoring-reference)
  - [Manifest — `data/index.json`](#manifest--dataindexjson)
  - [Rules — `data/rules.json`](#rules--datarulesjson)
  - [Flags — `data/flags/`](#flags--dataflags)
  - [Conditions (Logic Gates)](#conditions-logic-gates)
  - [Scenes](#scenes)
  - [NPCs & Enemies](#npcs--enemies)
  - [Items](#items)
  - [Loot Tables](#loot-tables)
  - [Missions & Quests](#missions--quests)
- [Validation](#validation)
- [Plugin API](#plugin-api)
- [Further Documentation](#further-documentation)
- [License](#license)

---

## Core Features

*   **Zero-Dependency Vanilla JS** — Runs natively in any modern browser via ES Modules. No bundlers, no compilers, no npm install.
*   **Data-Driven Everything** — Scenes, items, enemies, dialogue, quests, rules, even the sidebar tabs are defined in static JSON. Authoring a game requires no JavaScript.
*   **One Resolution Mechanic** — d20 + attribute modifier vs DC, everywhere: scene checks, dialogue persuasion, combat attacks. No parallel dice systems.
*   **Outcome-Tiered Skill Checks** — Margin-based tiers (critical / success / partial / failure), one-shot fail-forward gambles, attempt budgets with authored exhaustion routes, passive checks, retry costs, and free narrative beats. The full authoring guide is [`docs/CHECKS.md`](docs/CHECKS.md).
*   **Turn-Based Combat** — Initiative order, HP / Armor Class / Action Point budgets, multi-enemy encounters, auto-combat scene entries, and a configurable AP economy (`rules.apEconomy`).
*   **Character Progression** — Pre-game point-buy character creation, XP levels that bank spendable stat points, weapons governed by a wielder attribute (`attackAttribute`), and equipment that raises any attribute (`attributeBonuses`).
*   **Branching Dialogue & Merchants** — Conversation trees with skill-checked responses, item and quest rewards, and stateful merchant stock with per-NPC pricing.
*   **A World Clock (opt-in)** — Player actions advance a deterministic tick counter; days and named segments derive from rules, timers fire quiet action pipelines, and conditions can read `time` / `day` / `segment`. No wall clock, fully save-safe.
*   **Interactive World Map** — A scaled minimap in the sidebar tab plus a full-screen scrollable coordinate map centered on the player.
*   **Localisation** — Every player-facing string resolves through locale files; games can ship multiple languages and the engine matches the browser's preference.
*   **Load-Time Validation** — The engine validates all game data on boot and prints authoring mistakes (dangling IDs, missing locale keys, unreachable UI) to the console, grouped per entity.
*   **Robust Save Migration** — Saves are versioned, Base64-encoded state snapshots downloaded as files; a migration chain keeps older saves playable on newer engine versions.

---

## Tech Stack

| Component | Choice |
| :--- | :--- |
| **Language** | Vanilla JavaScript (ES Modules) |
| **Markup & Layout** | HTML5 |
| **Styles** | Plain CSS3 (custom properties) |
| **Testing** | Node.js native test runner (`node --test`) |

---

## Project Structure

```
gravity/
├── index.html               # The game's single HTML entry point
├── css/
│   └── styles.css           # All styling, one file
├── src/
│   ├── core/
│   │   ├── engine.js        # Orchestrator: boot, registries, delegate API, event bus
│   │   ├── state.js         # Reactive StateManager singleton + save/load & migrations
│   │   ├── config.js        # CSS/element registries, action names, flag key builders
│   │   ├── i18n.js          # Browser-language resolution for manifest locales
│   │   ├── validate.js      # Load-time game-data validation
│   │   └── utils.js         # DOM builders (cards, rows, toggles) & shared helpers
│   ├── systems/
│   │   ├── scene.js         # Scene rendering, options, item discovery
│   │   ├── combat.js        # Turn-based combat + its renderer
│   │   ├── dialogue.js      # Conversation trees & merchant trade
│   │   ├── skill-checks.js  # d20 checks, outcome tiers, attempt bookkeeping (pure)
│   │   ├── condition.js     # Condition AST evaluator (pure)
│   │   ├── dice.js          # roll() and NdF±M damage parsing (pure)
│   │   ├── time.js          # World-clock ticks, segments, timers
│   │   ├── actions.js       # Built-in action pipeline handlers
│   │   ├── quests.js        # Mission lifecycle
│   │   └── narrative.js     # The chronological story log
│   ├── ui/
│   │   ├── ui.js            # UIManager: tab construction, sheet, top bar, save/load
│   │   ├── inventory-ui.js  # Inventory & equipped sections
│   │   ├── quest-ui.js      # Active & completed quest panels
│   │   └── chest-ui.js      # Chest deposit/withdraw panel
│   ├── world/
│   │   └── map.js           # Minimap + full-screen world map
│   ├── screens/
│   │   └── char-creation.js # Pre-game point-buy screen
│   └── plugins/
│       ├── curator.js       # Museum curation & reputation (reference plugin)
│       └── curator/locales/ # Plugin locale files
├── tests/                   # Node unit tests, one suite per module (npm test)
├── schemas/                 # JSON Schemas for items, scenes, and NPCs
└── data/                    # The shipped demo game: scenes, items, NPCs, rules, locales
```

---

## Running Locally

No compile, build, or install steps. ES Modules need an HTTP origin, so serve the directory with any static server:

```bash
# Option A: Python
python3 -m http.server 3000

# Option B: Node
npx serve .
```

*   **Play:** open `http://localhost:3000`.
*   **Test:** `npm test` (runs Node's native test runner; no dependencies).

---

## Core Concepts

The engine runs on a unidirectional loop of three ideas:

```
[ Conditions (Gates) ] ➔ show/hide ➔ [ Options & Scenes ] ➔ trigger ➔ [ Actions (Mutations) ] ➔ write ➔ [ Flags & State ] ➔ feed [ Conditions ]
```

*   **Flags (State):** persisted key-value facts about what the player has done (`door_unlocked: true`).
*   **Conditions (Gates):** logic trees over flags, items, gold, level, attributes, quests, and time that show or hide options, dialogue paths, and description variants.
*   **Actions (Mutations):** ordered pipelines executed when a choice lands — loot, combat, navigation, flag writes, timers.

For boot flow, module boundaries, state contracts, events, and the full plugin surface, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The Player UI

The game renders as three panels, each with one job:

*   **Left — the player.** Tabs generated from `rules.tabs`: the character **Sheet** (stats and skills as collapsible sections), **Inventory**, **Quests**, **Map**, and **Options** (save / load / restart).
*   **Center — the story.** The narrative log, with a pinned status bar on top showing HP / AC / AP / Gold, any `headerResources`, and the world clock.
*   **Right — the interactions.** The current scene's options, skill checks, dialogue responses, or combat controls.

Tabs are data-driven: each entry names a locale key and optionally a `widget` (`attributes`, `map`, or `options`). **The save/load/restart buttons only exist inside an `options` widget tab** — omit it and players cannot save (the validator warns).

---

## Content Authoring Reference

The shipped demo under `data/` exercises every feature and is the best reference; the shapes below are the essentials.

### Manifest — `data/index.json`

The central registry. Every asset a game uses must be listed here:

```json
{
  "worldMapSize": { "width": 3000, "height": 2000 },
  "rules": "data/rules.json",
  "flags":    { "dungeon":        "data/flags/dungeon.json" },
  "scenes":   { "dungeon_start":  "data/scenes/dungeon/start.json" },
  "items":    { "rusty_sword":    "data/items/rusty_sword.json" },
  "npcs":     { "goblin_guard":   "data/npcs/goblin_guard.json" },
  "missions": { "escape_dungeon": "data/missions/escape_dungeon.json" },
  "tables":   { "basic_loot":     "data/tables/basic_loot.json" }
}
```

It may also declare `locales` + `defaultLanguage` (localisation) and `plugins` (see [Plugin API](#plugin-api)).

### Rules — `data/rules.json`

Player defaults, attributes, progression, economy, and the UI tabs:

```json
{
  "startingScene": "dungeon_start",
  "xpPerLevel": 100,
  "levelUpHpBonus": 5,
  "levelUp": { "statPoints": 1 },
  "merchantSellRatio": 0.5,
  "fallbackWeapons": { "player": "unarmed_strike", "enemy": "enemy_claw" },

  "playerDefaults": {
    "name": "", "level": 1, "xp": 0,
    "resources": {
      "hp": { "current": 10, "max": 10 },
      "ap": { "current": 3, "max": 3 },
      "gold": 0,
      "luckPoints": { "current": 3, "max": 3 }
    },
    "attributes": { "ac": 10, "initiative": 0 },
    "inventory": [],
    "equipment": { "Head": null, "Torso": null, "Left Hand": null, "Right Hand": null }
  },

  "customAttributes": [
    { "id": "perception", "default": 0, "max": 5 },
    { "id": "stealth",    "default": 0, "max": 5 }
  ],

  "charCreation": {
    "pointBudget": 3,
    "stats": [
      { "id": "resources.hp.max",     "localeKey": "maxHp",      "bonusPerPoint": 2, "min": 0 },
      { "id": "attributes.perception", "localeKey": "perception", "bonusPerPoint": 1, "min": 0 }
    ]
  },

  "tabs": [
    { "id": "attributes-tab", "localeKey": "ui.tabAttributes", "widget": "attributes", "default": true },
    { "id": "inventory-tab",  "localeKey": "ui.tabInventory" },
    { "id": "quests-tab",     "localeKey": "ui.tabQuests" },
    { "id": "map-tab",        "localeKey": "ui.tabMap",     "widget": "map" },
    { "id": "options-tab",    "localeKey": "ui.tabOptions", "widget": "options" }
  ],

  "skillRetry": { "resource": "luckPoints", "cost": 1, "restRestore": 3 },
  "headerResources": ["luckPoints"]
}
```

Notes:

*   `customAttributes` become skills: rollable in checks, readable in conditions, point-buyable at creation, and (with `levelUp.statPoints`) improvable on level-up from the Sheet, capped by `max`.
*   `skillRetry` makes retrying a failed check cost a resource; `headerResources` surfaces custom resources in the status bar and the Sheet. Both optional — see [`docs/CHECKS.md`](docs/CHECKS.md).
*   `rules.time` (opt-in) enables the world clock, and `rules.apEconomy` tunes AP refill/spend behavior; both are documented in [`docs/CHECKS.md`](docs/CHECKS.md).

### Flags — `data/flags/`

Declared per area, merged into one flat namespace at boot:

```json
{
  "door_unlocked": false,
  "defeated_goblin_guard": false
}
```

### Conditions (Logic Gates)

Boolean trees usable on options, dialogue responses, description variants, and auto-combat. Combinators `and` / `or` / `not` nest arbitrarily:

```json
{
  "and": [
    { "flag": "guard_distracted", "value": true },
    { "not": { "flag": "defeated_goblin_guard", "value": true } }
  ]
}
```

Leaf shapes:

| Shape | Meaning |
|---|---|
| `{ "flag": "name", "value": true }` | Flag equals value |
| `{ "item": "id", "count": 2 }` | Inventory holds ≥ count (count optional) |
| `{ "gold": 50 }` / `{ "gold": { "less_than": 10 } }` | Gold comparison |
| `{ "level": 3 }` | Player level |
| `{ "mission": "id", "status": "active" }` | Quest status (`not_started` / `active` / `complete`) |
| `{ "stealth": 2 }` | Any declared attribute threshold |
| `{ "time": { "at_least": 120 } }` | Elapsed world-clock ticks |
| `{ "day": { "at_least": 3 } }` / `{ "segment": "night" }` | Derived day / segment (requires `rules.time`) |

Numeric leaves accept a bare number (*at least*) or an operator object: `at_least`, `more_than`, `at_most`, `less_than`, `is`.

### Scenes

A location: conditional description blocks, options, skill checks, and map placement:

```json
{
  "title": "Cellar room",
  "region": "dungeon",
  "mapDefinitions": { "top": 245, "left": 175, "width": 50, "height": 60 },
  "description": [
    { "text": "The wooden door stands wide open to the north.",
      "condition": { "flag": "door_unlocked", "value": true } },
    { "text": "A heavy wooden door stands locked to the north." }
  ],
  "options": [
    {
      "text": "Unlock the door",
      "log": "You slide the key into the lock and turn it.",
      "condition": { "flag": "door_unlocked", "value": false },
      "requirements": { "item": "cellar_key" },
      "actions": [
        { "type": "set_flag", "flag": "door_unlocked", "value": true },
        { "type": "navigate", "destination": "dungeon_corridor" }
      ]
    }
  ],
  "skills": [
    {
      "text": "Look Around",
      "retryText": "Search the cellar again.",
      "skillCheck": "perception",
      "maxAttempts": 4,
      "onExhausted": [ { "type": "set_flag", "flag": "search_exhausted", "value": true } ],
      "items": [
        { "item": "cellar_key", "amount": 1, "dc": 10 },
        { "table": "basic_loot", "dc": 14, "itemDrops": 2 }
      ]
    },
    {
      "text": "Climb the crumbling wall",
      "skillCheck": "stealth",
      "dc": 14,
      "resolveOnce": true,
      "outcomes": {
        "critical": { "margin": 5, "text": "You scale it without a sound." },
        "success":  { "actions": [ { "type": "navigate", "destination": "dungeon_corridor" } ] },
        "partial":  { "margin": 3, "text": "You make it — barely.", "actions": [ { "type": "heal", "amount": -2 } ] },
        "failure":  { "actions": [ { "type": "combat", "enemies": ["goblin_guard"] } ] }
      }
    }
  ],
  "passiveChecks": [
    { "skillCheck": "perception", "dc": 13, "flag": "noticed_glint", "text": "Something catches the light." }
  ]
}
```

Checks resolve through margin-based **outcome tiers** (`critical` / `success` / `partial` / `failure`) with `resolveOnce` one-shots, `maxAttempts` budgets, retry costs, and time costs — the full guide is [`docs/CHECKS.md`](docs/CHECKS.md).

### NPCs & Enemies

One shape covers monsters, conversation partners, and merchants:

```json
{
  "name": "Goblin Guard",
  "description": "A snarling creature wearing rusted scale armor.",
  "isMerchant": true,
  "carriedItems": [ { "item": "healing_potion", "amount": 3 } ],
  "attributes": {
    "healthPoints": 8, "armorClass": 8, "actionPoints": 3,
    "initiative": 1, "xpReward": 50
  },
  "equipment": { "Right Hand": "rusty_sword" },
  "conversations": {
    "start": {
      "npcText": "Stop right there! Who goes there?",
      "responses": [
        {
          "text": "[Persuade] I mean no harm.",
          "skillCheck": "charisma", "dc": 12, "resolveOnce": true,
          "outcomes": {
            "success": { "actions": [ { "type": "goToConversation", "node": "friendly" } ] },
            "failure": { "actions": [ { "type": "goToConversation", "node": "hostile" } ] }
          }
        },
        { "text": "[Attack] Prepare to fight!",
          "actions": [ { "type": "leave" }, { "type": "combat", "enemies": ["goblin_guard"] } ] }
      ]
    },
    "friendly": {
      "npcText": "Fine. Let's see what you have.",
      "responses": [ { "text": "Let's trade.", "actions": [ { "type": "trade" } ] } ]
    },
    "hostile": {
      "npcText": "Die, human!",
      "actions": [ { "type": "combat", "enemies": ["goblin_guard"] } ]
    }
  }
}
```

Loot does not live on NPCs — drops are authored on the combat action's `onVictory` pipeline, keeping NPC definitions reusable.

### Items

Weapons, spells, armor, and consumables. All mechanical stats live inside `attributes`:

```json
{
  "name": "Rusty Sword",
  "type": "Weapon",
  "slot": "Right Hand",
  "description": "An old, chipped blade. Better than nothing.",
  "value": 5,
  "attributes": {
    "damageRoll": "1d6",
    "attackAttribute": "strength",
    "actionPoints": 1
  }
}
```

*   `attackAttribute` names the attribute whose modifier the wielder adds to attack rolls — accuracy belongs to the character, not the weapon.
*   Armor and relics use `attributes.attributeBonuses` (e.g. `{ "perception": 1 }`) and/or `armorClassBonus` to raise attributes while worn.
*   Consumables use `attributes.healingAmount` (dice notation) or `attributes.teleportScene`.

### Loot Tables

Probability-weighted drops. `dropWeight` is relative likelihood (default 1), not carry weight:

```json
{
  "entries": [
    { "item": "gold", "amount": 10, "dropWeight": 5 },
    { "item": "healing_potion", "dropWeight": 2 },
    { "item": "rusty_sword", "dropWeight": 1 }
  ]
}
```

### Missions & Quests

```json
{
  "name": "Escape the Dungeon",
  "description": "Find a way out of the underground complex and reach the surface.",
  "missionRewards": { "xp": 100, "gold": 50 }
}
```

Missions are started via `questTrigger` (on scenes or dialogue) and complete through the quest system's lifecycle events.

---

## Validation

On every boot the engine validates the loaded game data and prints issues to the console, grouped per entity — dangling item/scene/NPC/table references, unknown action types and skill names, enemies missing combat attributes, missing locale keys, deprecated authoring shapes, and UI-reachability problems (like a `tabs` list without an `options` widget, which would leave players unable to save). Validation never blocks the game; it is fail-fast feedback for authors. The same checks are unit-tested, and a data-integrity suite runs them against the shipped demo on every `npm test`.

---

## Plugin API

Plugins are trusted ES modules declared in the manifest, loaded at boot with full engine access:

```json
"plugins": [
  {
    "id": "curator",
    "src": "./src/plugins/curator.js",
    "locales": { "en": "./src/plugins/curator/locales/en.json" }
  }
]
```

The default export receives the engine instance:

```javascript
export default function (engine) {
  // A custom action usable in any JSON action pipeline
  engine.registerAction('teleport_home', (action, engine) => {
    engine.log('System', engine.t('plugin.myplugin.whoosh'), 'loot');
    engine.renderScene('home_bedroom');
  });

  // A custom stat row on the character sheet
  engine.registerSheetRow({ label: engine.t('plugin.myplugin.karma'), bind: 'attributes.karma' });
}
```

Further extension points — scene decorators, description hooks, engine events, state-mutation observers, custom stat handlers, and save migrations — are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The shipped curator plugin (museum displays + a derived reputation stat) is the reference implementation.

---

## Further Documentation

*   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — boot flow, module graph, state contracts, events, hooks, the full plugin surface, localisation, and testing policy.
*   [`docs/CHECKS.md`](docs/CHECKS.md) — the authoring guide for skill checks, outcome tiers, attempt budgets, retry currency, and the world clock.

---

## License

This is free and unencumbered software released into the public domain. For details, see [LICENSE](LICENSE).
