# Gravity

[![CI](https://github.com/joeyprijs/gravity/actions/workflows/test.yml/badge.svg)](https://github.com/joeyprijs/gravity/actions/workflows/test.yml)
[![License: Unlicense](https://img.shields.io/badge/License-Unlicense-blue.svg)](LICENSE)
[![Dependencies: None](https://img.shields.io/badge/Dependencies-Zero-success.svg)](#quick-start)
[![Platform: Browser](https://img.shields.io/badge/Platform-Browser--Native-cyan.svg)](#quick-start)

A browser-native, zero-dependency, data-driven text RPG engine. Define your entire world — scenes, branching dialogue, characters, quests, items, rules, and maps — in JSON, with no scripting required.

**[Play the Live Demo](https://joeyprijs.github.io/gravity/)**

---

> [!NOTE]
> **🤖 100% AI-Generated Codebase**
> This entire codebase — the engine, the reactive state manager, the world map, the plugin system, the test suites, and every refactor since — was researched, architected, written, documented, and reviewed by Artificial Intelligence (**Claude** and **Gemini**). A human served as the Project Manager, providing direction and structural reviews, but did not write a single line of the code. It is released as completely free and unencumbered public domain code.

---

## Table of Contents

- [What You Get](#what-you-get)
- [Quick Start](#quick-start)
- [How a Game Works](#how-a-game-works)
- [Adding Content](#adding-content)
- [Authoring Reference](#authoring-reference)
  - [Rules — `data/rules.json`](#rules--datarulesjson)
  - [Conditions (Logic Gates)](#conditions-logic-gates)
  - [Scenes](#scenes)
  - [NPCs & Enemies](#npcs--enemies)
  - [Items](#items)
  - [Loot Tables, Flags, Missions](#loot-tables-flags-missions)
- [The Player UI](#the-player-ui)
- [Validation](#validation)
- [Plugin API](#plugin-api)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Testing](#testing)
- [License](#license)

---

## What You Get

*   **Zero-Dependency Vanilla JS** — Runs natively in any modern browser via ES Modules. No bundlers, no compilers, no `npm install`.
*   **Data-Driven Everything** — Scenes, items, enemies, dialogue, quests, rules, even the sidebar tabs are static JSON. Authoring a game requires no JavaScript.
*   **One Resolution Mechanic** — d20 + attribute modifier vs DC, everywhere: scene checks, dialogue persuasion, combat attacks. No parallel dice systems.
*   **Outcome-Tiered Skill Checks** — Margin-based tiers (critical / success / partial / failure), one-shot fail-forward gambles, attempt budgets with authored exhaustion routes, passive checks, retry costs, and free narrative beats. Full authoring guide: [`docs/CHECKS.md`](docs/CHECKS.md).
*   **Turn-Based Combat** — Initiative order, HP / Armor Class / Action Point budgets, multi-enemy encounters, auto-combat scene entries, and a configurable AP economy (`rules.apEconomy`).
*   **Character Progression** — Point-buy character creation, XP levels that bank spendable stat points, weapons governed by a wielder attribute (`attackAttribute`), and equipment that raises any attribute (`attributeBonuses`).
*   **Branching Dialogue & Merchants** — Conversation trees with skill-checked responses, item and quest rewards, and stateful merchant stock with per-NPC pricing.
*   **A World Clock (opt-in)** — Player actions advance a deterministic tick counter; days and named segments derive from rules, timers fire quiet action pipelines, and conditions can read `time` / `day` / `segment`. No wall clock, fully save-safe.
*   **Interactive World Map** — A scaled minimap in the sidebar plus a full-screen scrollable coordinate map centered on the player.
*   **Localisation** — Every player-facing string resolves through locale files; the engine matches the browser's language, and list/plural grammar goes through `Intl`, never through code.
*   **Load-Time Validation** — The engine validates all game data on boot and prints authoring mistakes (dangling IDs, missing locale keys, unreachable UI) to the console, grouped per entity.
*   **Versioned Saves with Migrations** — Saves are Base64-encoded state snapshots downloaded as files; a guarded migration chain (core + plugin) keeps older saves playable on newer engine versions.
*   **A Generated Manifest** — Content files register themselves: drop a JSON file in `data/`, run one script, done. CI fails if the manifest drifts from the data tree.

The shipped demo under `data/` is a deliberate kitchen sink — it exercises every feature above and doubles as the reference for all of them.

---

## Quick Start

No compile, build, or install steps. ES Modules need an HTTP origin, so serve the directory with any static server:

```bash
# Option A: Python
python3 -m http.server 3000

# Option B: Node
npx serve .
```

*   **Play:** open `http://localhost:3000`.
*   **Test:** `npm test` — Node's native test runner, no dependencies, 350+ tests.
*   **UI smoke test:** open `http://localhost:3000/tests/smoke.html` — boots the real game and drives the UI through its assertions; the tab title reports `SMOKE: PASS/FAIL`.

---

## How a Game Works

The engine runs on a unidirectional loop of three ideas:

```
[ Conditions (Gates) ] ➔ show/hide ➔ [ Options & Scenes ] ➔ trigger ➔ [ Actions (Mutations) ] ➔ write ➔ [ Flags & State ] ➔ feed [ Conditions ]
```

*   **Flags (State):** persisted key→value facts about what the player has done (`door_unlocked: true`).
*   **Conditions (Gates):** logic trees over flags, items, gold, level, attributes, quests, and time that show or hide options, dialogue paths, and description variants.
*   **Actions (Mutations):** ordered pipelines executed when a choice lands — loot, combat, navigation, flag writes, timers.

Everything else — checks, combat, dialogue, the clock — is built from these three. For boot flow, module boundaries, state contracts, and the full plugin surface, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Adding Content

Content files live under `data/` and the manifest (`data/index.json`) indexes them. **You never edit the manifest's file maps by hand:**

```bash
# 1. Drop a new file into the data tree
$EDITOR data/items/moon_pendant.json

# 2. Normalize formatting and regenerate the manifest
node scripts/format-data.js
node scripts/generate-manifest.js
```

Data files use canonical expanded JSON — one property per line, nothing inlined — so authored content reads as blocks. `format-data.js` rewrites any file into that form (it never changes content, only whitespace), and CI checks both scripts' output.

Each entry's key is the file's top-level `"id"` field when present, otherwise its filename stem (`moon_pendant`). Scenes declare explicit ids (their keys carry region prefixes, like `home_kitchen`). CI runs `generate-manifest.js --check`, so a stale manifest fails the build instead of shipping.

Hand-authored manifest fields — `rules`, `locales`, `plugins`, `regions`, `worldMapSize` — are preserved untouched by the generator.

**Scaling note:** each category also accepts a *bundle* (a single JSON file, or an array of them, holding many `id → definition` entries), so a game with thousands of scenes boots in a handful of requests instead of one per file. The demo uses the per-file form because it diffs better.

---

## Authoring Reference

The shipped demo exercises every feature and is the best reference; JSON Schemas for items, scenes, and NPCs live in [`schemas/`](schemas/). The shapes below are the essentials.

### Rules — `data/rules.json`

Player defaults, attributes, progression, economy, and the UI tabs:

```json
{
  "startingScene": "dungeon_start",
  "xpPerLevel": 100,
  "levelUpHpBonus": 5,
  "levelUp": {
    "statPoints": 1
  },
  "merchantSellRatio": 0.5,
  "fallbackWeapons": {
    "player": "unarmed_strike",
    "enemy": "enemy_claw"
  },
  "playerDefaults": {
    "name": "",
    "level": 1,
    "xp": 0,
    "resources": {
      "hp": {
        "current": 10,
        "max": 10
      },
      "ap": {
        "current": 3,
        "max": 3
      },
      "gold": 0,
      "luckPoints": {
        "current": 3,
        "max": 3
      }
    },
    "attributes": {
      "ac": 10,
      "initiative": 0
    },
    "inventory": [],
    "equipment": {
      "Head": null,
      "Torso": null,
      "Left Hand": null,
      "Right Hand": null
    }
  },
  "customAttributes": [
    {
      "id": "perception",
      "default": 0,
      "max": 5
    },
    {
      "id": "stealth",
      "default": 0,
      "max": 5
    }
  ],
  "charCreation": {
    "pointBudget": 3,
    "stats": [
      {
        "id": "resources.hp.max",
        "localeKey": "maxHp",
        "bonusPerPoint": 2,
        "min": 0
      },
      {
        "id": "attributes.perception",
        "localeKey": "perception",
        "bonusPerPoint": 1,
        "min": 0
      }
    ]
  },
  "tabs": [
    {
      "id": "attributes-tab",
      "localeKey": "ui.tabAttributes",
      "widget": "attributes",
      "default": true
    },
    {
      "id": "inventory-tab",
      "localeKey": "ui.tabInventory"
    },
    {
      "id": "quests-tab",
      "localeKey": "ui.tabQuests"
    },
    {
      "id": "map-tab",
      "localeKey": "ui.tabMap",
      "widget": "map"
    },
    {
      "id": "options-tab",
      "localeKey": "ui.tabOptions",
      "widget": "options"
    }
  ],
  "skillRetry": {
    "resource": "luckPoints",
    "cost": 1,
    "restRestore": 3
  },
  "headerResources": [
    "luckPoints"
  ]
}
```

Notes:

*   `customAttributes` become skills: rollable in checks, readable in conditions, point-buyable at creation, and (with `levelUp.statPoints`) improvable on level-up from the Sheet, capped by `max`.
*   `skillRetry` makes retrying a failed check cost a resource; `headerResources` surfaces custom resources in the status bar and the Sheet. Both optional — see [`docs/CHECKS.md`](docs/CHECKS.md).
*   `rules.time` (opt-in) enables the world clock, and `rules.apEconomy` tunes AP refill/spend behavior; both are documented in [`docs/CHECKS.md`](docs/CHECKS.md).

### Conditions (Logic Gates)

Boolean trees usable on options, dialogue responses, description variants, and auto-combat. Combinators `and` / `or` / `not` nest arbitrarily:

```json
{
  "and": [
    {
      "flag": "guard_distracted",
      "value": true
    },
    {
      "not": {
        "flag": "defeated_goblin_guard",
        "value": true
      }
    }
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

A location: conditional description blocks, options, skill checks, and map placement. The top-level `id` is the scene's manifest key:

```json
{
  "id": "dungeon_cellar",
  "title": "Cellar room",
  "region": "dungeon",
  "mapDefinitions": {
    "top": 245,
    "left": 175,
    "width": 50,
    "height": 60
  },
  "description": [
    {
      "text": "The wooden door stands wide open to the north.",
      "condition": {
        "flag": "door_unlocked",
        "value": true
      }
    },
    {
      "text": "A heavy wooden door stands locked to the north."
    }
  ],
  "options": [
    {
      "text": "Unlock the door",
      "log": "You slide the key into the lock and turn it.",
      "condition": {
        "flag": "door_unlocked",
        "value": false
      },
      "requirements": {
        "item": "cellar_key"
      },
      "actions": [
        {
          "type": "set_flag",
          "flag": "door_unlocked",
          "value": true
        },
        {
          "type": "navigate",
          "destination": "dungeon_corridor"
        }
      ]
    }
  ],
  "skills": [
    {
      "text": "Look Around",
      "retryText": "Search the cellar again.",
      "skillCheck": "perception",
      "maxAttempts": 4,
      "onExhausted": [
        {
          "type": "set_flag",
          "flag": "search_exhausted",
          "value": true
        }
      ],
      "items": [
        {
          "item": "cellar_key",
          "amount": 1,
          "dc": 10
        },
        {
          "table": "basic_loot",
          "dc": 14,
          "itemDrops": 2
        }
      ]
    },
    {
      "text": "Climb the crumbling wall",
      "skillCheck": "stealth",
      "dc": 14,
      "resolveOnce": true,
      "outcomes": {
        "critical": {
          "margin": 5,
          "text": "You scale it without a sound."
        },
        "success": {
          "actions": [
            {
              "type": "navigate",
              "destination": "dungeon_corridor"
            }
          ]
        },
        "partial": {
          "margin": 3,
          "text": "You make it — barely.",
          "actions": [
            {
              "type": "heal",
              "amount": -2
            }
          ]
        },
        "failure": {
          "actions": [
            {
              "type": "combat",
              "enemies": [
                "goblin_guard"
              ]
            }
          ]
        }
      }
    }
  ],
  "passiveChecks": [
    {
      "skillCheck": "perception",
      "dc": 13,
      "flag": "noticed_glint",
      "text": "Something catches the light."
    }
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
  "carriedItems": [
    {
      "item": "healing_potion",
      "amount": 3
    }
  ],
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
  "conversations": {
    "start": {
      "npcText": "Stop right there! Who goes there?",
      "responses": [
        {
          "text": "[Persuade] I mean no harm.",
          "skillCheck": "charisma",
          "dc": 12,
          "resolveOnce": true,
          "outcomes": {
            "success": {
              "actions": [
                {
                  "type": "goToConversation",
                  "node": "friendly"
                }
              ]
            },
            "failure": {
              "actions": [
                {
                  "type": "goToConversation",
                  "node": "hostile"
                }
              ]
            }
          }
        },
        {
          "text": "[Attack] Prepare to fight!",
          "actions": [
            {
              "type": "leave"
            },
            {
              "type": "combat",
              "enemies": [
                "goblin_guard"
              ]
            }
          ]
        }
      ]
    },
    "friendly": {
      "npcText": "Fine. Let's see what you have.",
      "responses": [
        {
          "text": "Let's trade.",
          "actions": [
            {
              "type": "trade"
            }
          ]
        }
      ]
    },
    "hostile": {
      "npcText": "Die, human!",
      "actions": [
        {
          "type": "combat",
          "enemies": [
            "goblin_guard"
          ]
        }
      ]
    }
  }
}
```

Loot does not live on NPCs — drops are authored on the combat action's `onVictory` pipeline, keeping NPC definitions reusable across encounters.

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
*   Consumable effects are independent and combinable: `healingAmount` (number or dice notation), `apRestore`, and `modifyResource` (any declared resource) consume the item; `teleportScene` makes a reusable travel item.

### Loot Tables, Flags, Missions

**Loot tables** are probability-weighted drops — `dropWeight` is relative likelihood (default 1), not carry weight:

```json
{
  "entries": [
    {
      "item": "gold",
      "amount": 10,
      "dropWeight": 5
    },
    {
      "item": "healing_potion",
      "dropWeight": 2
    },
    {
      "item": "rusty_sword",
      "dropWeight": 1
    }
  ]
}
```

**Flags** are declared per area under `data/flags/` and merged into one flat namespace at boot:

```json
{
  "door_unlocked": false,
  "defeated_goblin_guard": false
}
```

**Missions** are simple definitions started via `questTrigger` (on scenes or dialogue) and completed through the quest system's lifecycle:

```json
{
  "name": "Escape the Dungeon",
  "description": "Find a way out of the underground complex and reach the surface.",
  "missionRewards": {
    "xp": 100,
    "gold": 50
  }
}
```

---

## The Player UI

The game renders as three panels, each with one job:

*   **Left — the player.** Tabs generated from `rules.tabs`: the character **Sheet** (stats and skills as collapsible sections), **Inventory**, **Quests**, **Map**, and **Options** (save / load / restart).
*   **Center — the story.** The narrative log, with a pinned status bar showing HP / AC / AP / Gold, any `headerResources`, and the world clock.
*   **Right — the interactions.** The current scene's options, skill checks, dialogue responses, or combat controls. Exactly one surface owns this panel at a time — the engine's mode machine guarantees it.

Tabs are data-driven: each entry names a locale key and optionally a `widget` (`attributes`, `map`, `options` — or one a plugin registered). **The save/load/restart buttons only exist inside an `options` widget tab** — omit it and players cannot save (the validator warns).

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
    "locales": {
      "en": "./src/plugins/curator/locales/en.json"
    }
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

  // Plugin-owned save data — serialized with the save, migration-friendly
  const saved = engine.state.pluginState('myplugin');
  saved.timesTeleported ??= 0;
}
```

Further extension points — whole sidebar tabs (`registerTabWidget`), scene decorators, description hooks, engine events, state-mutation observers, custom stat handlers, and save migrations — are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The shipped curator plugin (museum displays + a derived reputation stat) is the reference implementation.

---

## Architecture at a Glance

```
gravity/
├── index.html               # The game's single HTML entry point
├── css/styles.css           # All styling, one file
├── src/
│   ├── core/
│   │   ├── engine.js        # Orchestrator: boot, mode machine, registries, delegate API
│   │   ├── state.js         # StateManager (engine-owned): reactive state, saves, migrations
│   │   ├── config.js        # CSS/element registries, action names, flag/check key builders
│   │   ├── i18n.js          # Language resolution + Intl list/plural formatting (pure)
│   │   ├── validate.js      # Load-time game-data validation (pure)
│   │   └── utils.js         # DOM builders (cards, rows, toggles) & shared helpers
│   ├── systems/
│   │   ├── scene.js         # Scene rendering, options, item discovery
│   │   ├── combat.js        # Turn-based combat (renderer in ui/combat-ui.js)
│   │   ├── dialogue.js      # Conversation trees & merchant trade
│   │   ├── items.js         # Item use / equip / unequip (consumable-effect table)
│   │   ├── skill-checks.js  # d20 checks, outcome tiers, the shared attempt machine
│   │   ├── condition.js     # Condition AST evaluator (pure)
│   │   ├── dice.js          # roll(), NdF±M damage parsing, weighted tables (pure)
│   │   ├── time.js          # World-clock ticks, segments, timers (pure)
│   │   ├── actions.js       # Built-in action pipeline handlers
│   │   ├── quests.js        # Mission lifecycle
│   │   └── narrative.js     # The chronological story log
│   ├── ui/                  # UIManager (tab widgets, sheet, top bar, save/load) + panels
│   ├── world/map.js         # Minimap + full-screen world map
│   ├── screens/char-creation.js
│   └── plugins/curator.js   # Reference plugin (museum curation & reputation)
├── scripts/generate-manifest.js  # Regenerates data/index.json from the data tree
├── tests/                   # Node unit tests (npm test) + smoke.html (browser UI test)
├── schemas/                 # JSON Schemas for items, scenes, and NPCs
└── data/                    # The shipped demo game: scenes, items, NPCs, rules, locales
```

The deeper tour — boot flow, the mode machine, state contracts, events, hooks, localisation, and testing policy — lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Testing

*   **`npm test`** — 350+ synchronous unit tests on Node's native runner: state and saves, combat math, the condition AST, dice, checks and their attempt machine, scene and dialogue logic, the world clock, the validator, the curator plugin, and a data-integrity suite over the shipped demo.
*   **`tests/smoke.html`** — a zero-dependency browser smoke test that boots the real game and drives the UI like a player: character creation, tabs, the sheet, the top bar, inventory markup invariants, and a live skill check.
*   **CI** — GitHub Actions runs the test suite and verifies the manifest is in sync with the data tree on every push and pull request.

---

## License

This is free and unencumbered software released into the public domain. For details, see [LICENSE](LICENSE).
