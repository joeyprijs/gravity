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
  - [Actions (Mutations)](#actions-mutations)
  - [Regions, Interiors, and the Map](#regions-interiors-and-the-map)
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
*   **One Resolution Mechanic** — whenever the dice decide success, it's d20 + attribute modifier: against a DC for scene checks, dialogue persuasion, and combat attacks; head-to-head for initiative. Effect sizes — weapon and spell damage, a short rest's healing — are flat numbers or dice notation; they measure an outcome, never decide one.
*   **Outcome-Tiered Skill Checks** — Margin-based tiers (critical / success / partial / failure), one-shot fail-forward gambles, attempt budgets with authored exhaustion routes, passive checks, retry costs, and free narrative beats. Full authoring guide: [`docs/CHECKS.md`](docs/CHECKS.md).
*   **Turn-Based Combat** — Initiative order, HP / Armor Class / Action Point budgets, multi-enemy encounters, and auto-combat scene entries. AP is a per-combat tactical budget: full at the start of every fight and refreshed each round.
*   **Character Progression** — Point-buy character creation, XP levels that bank spendable stat points, weapons governed by a wielder attribute (`attackAttribute`), and equipment that raises any attribute (`attributeBonuses`).
*   **Branching Dialogue & Merchants** — Conversation trees with skill-checked responses, item and quest rewards, and stateful merchant stock with per-NPC pricing.
*   **Staged Quests** — Multi-step missions whose objectives are observed conditions: collect-N stages auto-advance the moment they're satisfied (even retroactively), stages pay their own rewards, progress is forward-only, and failure is a first-class terminal state.
*   **A World Clock (opt-in)** — Player actions advance a deterministic tick counter; days and named segments derive from rules, timers fire quiet action pipelines, and conditions can read `time` / `day` / `segment`. No wall clock, fully save-safe.
*   **Two-Channel Audio (opt-in)** — Looping ambience resolved per region (overridable per scene) plus one-shot narration clips for scene descriptions and action outcomes, with per-channel volume in the Options tab. A game that authors no audio never touches the Web Audio API. Full guide: [`docs/AUDIO.md`](docs/AUDIO.md).
*   **Interactive World Map** — A full-screen scrollable coordinate map, plus a sidebar minimap that frames where you *are*: outdoors, a player-centered viewport onto one continuous world, where every building is a single square and a place appears as soon as it's in sight; inside a building, that building's own rooms as you walk them.
*   **Localisation** — Every player-facing string resolves through locale files; the engine matches the browser's language, and list/plural grammar goes through `Intl`, never through code.
*   **Load-Time Validation** — The engine validates all game data on boot and prints authoring mistakes (dangling IDs, missing locale keys, unreachable UI) to the console, grouped per entity.
*   **Versioned Saves with Migrations** — Saves are Base64-encoded state snapshots downloaded as files; a guarded migration chain (core + plugin) keeps older saves playable on newer engine versions.
*   **A Generated Manifest** — Content files register themselves: drop a JSON file in `data/`, run the format and manifest scripts, done. CI fails if either drifts from the data tree.

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
*   **Test:** `npm test` — Node's native test runner, no dependencies, 300+ tests.
*   **UI smoke test:** `scripts/run-smoke.sh` (headless Chrome, no dependencies), or open `http://localhost:3000/tests/smoke.html` by hand — boots the real game and drives the UI through its assertions; the tab title reports `SMOKE: PASS/FAIL`. Runs in CI.

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

Hand-authored manifest fields — `rules`, `locales`, `defaultLanguage`, `plugins`, `regions`, `worldMapSize` — are preserved untouched by the generator.

**Scaling note:** each category also accepts a *bundle* (a single JSON file holding many `id → definition` entries), so a game with thousands of scenes boots in a handful of requests instead of one per file. The demo uses the per-file form because it diffs better.

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
      "icon": "eye",
      "default": 0,
      "max": 5
    },
    {
      "id": "stealth",
      "icon": "moon",
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
        "bonusPerPoint": 2
      },
      {
        "id": "attributes.perception",
        "localeKey": "perception",
        "bonusPerPoint": 1
      }
    ]
  },
  "tabs": [
    {
      "id": "attributes-tab",
      "localeKey": "ui.tabAttributes",
      "icon": "sheet",
      "widget": "attributes",
      "default": true
    },
    {
      "id": "inventory-tab",
      "localeKey": "ui.tabInventory",
      "icon": "backpack"
    },
    {
      "id": "quests-tab",
      "localeKey": "ui.tabQuests",
      "icon": "trophy"
    },
    {
      "id": "map-tab",
      "localeKey": "ui.tabMap",
      "icon": "map",
      "widget": "map"
    },
    {
      "id": "options-tab",
      "localeKey": "ui.tabOptions",
      "icon": "cog",
      "widget": "options"
    }
  ],
  "skillRetry": {
    "resource": "luckPoints",
    "cost": 1,
    "restRestore": 3
  },
  "headerResources": [
    {
      "id": "luckPoints",
      "icon": "star"
    }
  ]
}
```

Notes:

*   `customAttributes` become skills: rollable in checks, readable in conditions, point-buyable at creation, and (with `levelUp.statPoints`) improvable on level-up from the Sheet, capped by `max`. Each one's `icon` marks its row on the Sheet.
*   `skillRetry` makes retrying a failed check cost a resource; `headerResources` surfaces custom resources in the status bar (as an icon) and the Sheet (as an icon plus a label). Both optional — see [`docs/CHECKS.md`](docs/CHECKS.md).
*   `shortRest` (optional) backs the `short_rest` action with a spendable pool: `{ "resource": "shortRests", "heal": "1d8" }` — each rest heals `heal` and spends one use of the declared `{ current, max }` resource, which only a full rest refills. Scenes offer resting by authoring an option that runs `short_rest` — see [`docs/ACTIONS.md`](docs/ACTIONS.md).
*   `rules.time` (opt-in) enables the world clock; it is documented in [`docs/CHECKS.md`](docs/CHECKS.md).

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
| `{ "mission": "id", "status": "active" }` | Quest status (`not_started` / `active` / `complete` / `failed`) |
| `{ "mission": "id", "stage": "collect" }` | Mission is active and exactly on this stage |
| `{ "mission": "id", "stageReached": "collect" }` | Mission's recorded stage is at or past this one (by authored order; survives completion) |
| `{ "stealth": 2 }` | Any declared attribute threshold |
| `{ "time": { "at_least": 120 } }` | Elapsed world-clock ticks |
| `{ "day": { "at_least": 3 } }` / `{ "segment": "night" }` | Derived day / segment (requires `rules.time`) |

Numeric leaves accept a bare number (*at least*) or an operator object: `at_least`, `more_than`, `at_most`, `less_than`, `is`. The one exception is the item leaf's `count`, which is a bare at-least number only.

### Actions (Mutations)

Actions are the pipeline a chosen option, dialogue response, or `onVictory` runs — an array of `{ "type": ..., ...params }` executed in order. Each handler owns exactly one side effect; navigation is always its own `navigate` action, never a hidden consequence of another. Every action type is validated at boot, so a typo surfaces as a grouped `[Gravity]` warning rather than a silent no-op. The tables below are the catalogue; **[`docs/ACTIONS.md`](docs/ACTIONS.md) is the full parameter reference** — every field's type, default, and behavior.

Available everywhere (scene options, `onVictory`, dialogue responses):

| Action | Parameters | Effect |
|---|---|---|
| `loot` | `item`, `amount?`, `received?`, `xpReward?` | Give an item — or gold, with `"item": "gold"` — to the player. `received: true` reads as "handed over" rather than "found". |
| `combat` | `enemies`, `onVictory?` | Start a fight; `onVictory` runs on win. |
| `dialogue` | `npc` | Open a conversation. |
| `navigate` | `destination` | Move to a scene. |
| `return` | — | Return to the scene the player teleported from, else the starting scene. |
| `heal` | `amount?` | Change HP by `amount` (default `rules.snackHealAmount`; negative damages). |
| `full_rest` | — | Restore HP, the retry currency, and the short-rest pool (AP is a per-combat budget and resets on its own). |
| `short_rest` | — | One draw on the short-rest pool (`rules.shortRest`): heal a little, spend one use; only `full_rest` refills the pool. |
| `set_flag` | `flag`, `value` | Write a flag. |
| `log` | `message` | Print a narrator line. |
| `manage_chest` | `chest` | Open a chest's deposit/withdraw panel. |
| `advance_time` | `amount` **or** `until` | Advance the world clock by ticks, or to the next start of a named segment (needs `rules.time`). |
| `set_timer` | `id`, `afterTicks?`, `actions` | Arm a timer; its pipeline fires at the deadline. Re-arming an `id` replaces it. |
| `cancel_timer` | `id` | Disarm a timer. |

Conversation actions (`goToConversation` and `trade` warn and no-op outside an active dialogue; `questTrigger` also runs from scenes and timers):

| Action | Parameters | Effect |
|---|---|---|
| `goToConversation` | `node` | Render another node of the current conversation. |
| `trade` | `tradeDiscount?`, `persistDiscount?` | Open the merchant store, optionally repriced. |
| `leave` | — | Leave the conversation, back to the scene. |
| `questTrigger` | `mission`, `status` *or* `stage` | Start (`"active"`), complete, or fail a mission — or jump forward to a named stage. `complete` and `failed` are terminal. |

The state-changing actions (`loot`, `heal`, `full_rest`, `short_rest`, `advance_time`) take an optional `log`: `false` silences the default message, a string replaces it (resolved through the locale table first, so a locale key stays translatable; any other string logs as-is). `advance_time` has no default line, so only its string form does anything. Timer pipelines are restricted to *quiet* actions (`set_flag`, `log`, `questTrigger`, `set_timer`, `cancel_timer`) — a timer changes the world through flags, never by navigating or starting combat. Plugins register their own types (the curator plugin adds `manage_exhibits` and `build_wing`) — see the [Plugin API](#plugin-api). Every parameter above is documented in full in [`docs/ACTIONS.md`](docs/ACTIONS.md).

### Regions, Interiors, and the Map

The world is one continuous outdoors, and the only thing the map treats specially is **a place you go inside**. There are no map boundaries between areas: every outdoor scene the player has walked is drawn together, whatever region it belongs to.

A **building** is declared one of two ways:

```json
// One room — the scene marks itself (data/scenes/village/fenwick_cottage.json)
{
  "id": "village_fenwick_cottage",
  "name": "Fenwick Cottage",
  "region": "village",
  "interior": true
}
```

```json
// Several rooms — an interior region groups them (data/index.json)
"regions": {
  "player_home": {
    "name": "Your House",
    "interior": true,
    "mapBackground": "rgba(80, 50, 20, 0.9)"
  },
  "village_store": {
    "name": "Frey's Store",
    "interior": true,
    "mapBackground": "rgba(70, 60, 90, 0.9)"
  }
}
```

Growing a one-room building into a bigger one is that migration and nothing else: drop `interior` from the scene, declare a region carrying the building's name and color, and point both rooms' `region` at it. Frey's Store went from a single shop floor to a shop plus a stockroom that way, with no engine change — from outdoors it is the same one square it always was.

**What the minimap draws.** Inside a building: that building's visited rooms, and nothing else — in a one-room shop, the shop. Outdoors: a **viewport** onto the open world, centered on the player, spanning `minimapRadius` world units in every direction (omit the field and the outdoor map falls back to fitting everything known into the square). Walking scrolls it; the world getting bigger never shrinks what you can read.

**What the player knows about.** Outdoors, a place is on the map once it has been *seen*: everywhere they have walked, plus one step of sight from it — the roads leading off those places, and the buildings whose doors they have stood at. So a cottage is on the map before it is entered, and nothing is ever walked into off a map it wasn't on. Sight stops at that one step: you can see the lane leaving the square, not the cottages along it. Indoors has no such rule — a building's rooms are revealed by walking them, which is what makes exploring one feel like exploring.

A building's square is its whole footprint, entered or not, and buildings paint *under* the world: the square is a bounding box, so it covers ground its rooms don't fill. A building with no door out in the open — the demo's dungeon, reached through the story — is never drawn into the landscape.

The full-screen map knows exactly the same places, drawn at their authored coordinates instead of scaled into a viewport, and shows each in as much detail as the player has earned: a building they have walked shows its rooms, one they have only seen from the road shows as its footprint. So the two views never disagree about what exists — only about how much of it fits on screen.

Rooms tile their building exactly, which would leave a walked building reading as a handful of loose boxes, so a building of **more than one** walked room is gathered in a named outline (`.map-node--building`). That is what says whose kitchen this is, without prefixing every room name. One room needs no outline: it is already named by the room itself.

**What the interactions panel does with it.** Being a building is also a fact about movement, so crossing a threshold is listed apart from walking on. Out in the open, an option that navigates *into* a building goes under **Entrances**; inside one, the ways back out — a navigate to anywhere that isn't this building, or a teleport — go under **Exits**, at the foot of the panel. A move that stays on one side of the threshold is neither: a road between two outdoor places, or a door between two rooms of the same house. Like every other section, this follows from what the option's pipeline does, never from how its label is worded.

A **region** is what remains: an ambience grouping (see [`docs/AUDIO.md`](docs/AUDIO.md)) that a building can also use to gather its rooms.

| Field | Meaning |
|---|---|
| `name` | The area's display name. Labels an `interior` region's square on the map. |
| `ambience` | Looping audio bed for every scene in the region. |
| `interior` | The region's scenes are the rooms of one building. |
| `mapBackground` | CSS color of that building's square. Falls back to the default node color; a one-room building uses its own `mapDefinitions.background`. |

One thing follows for authors: a building's coordinates should sit where the building actually *is*, since its square is drawn from its rooms' real geometry. Rooms authored a thousand units from their own front door draw a building a thousand units away from its door.

`minimapRadius` is set in `data/index.json` beside `worldMapSize`, and is the one number that tunes how much world the player sees at once — the demo's `500` shows Hollowbrook's square with its lanes running off the edges.

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

A scene can also start a fight the moment it's entered with `autoAttack` — an encounter that runs before the player picks anything, sharing the `combat` action's shape (`enemies` plus an optional `onVictory`), with an optional `condition` that gates whether it triggers:

```json
"autoAttack": {
  "condition": {
    "not": {
      "flag": "ambush_survived",
      "value": true
    }
  },
  "enemies": [
    "goblin_guard"
  ],
  "onVictory": [
    {
      "type": "set_flag",
      "flag": "ambush_survived",
      "value": true
    }
  ]
}
```

Winning re-renders the scene without re-triggering the ambush, so gate it on a flag its own `onVictory` sets (as above) if it should fire only once.

**An ambush is framed once.** The scene description printed a heartbeat earlier already narrates the encounter, so an `autoAttack` fight does *not* also print its enemy's `description` — otherwise the same instant is told twice. Write the reveal into the scene description; the enemy's own `description` still opens a fight the player *chose* (see [NPCs & Enemies](#npcs--enemies)).

### NPCs & Enemies

One shape covers monsters, conversation partners, and merchants. `description` is the encounter's opening framing: it prints at the top of a **solo** fight the player chose — never in a multi-enemy fight, and never in an `autoAttack` ambush, where the scene description did the framing instead.

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

Item `type` is one of `Weapon`, `Spell`, `Armor`, `Consumable`, `Special`, or `Flavour` (the default when omitted — keepsakes and key items). The type drives behavior: weapons and spells equip to a hand and attack; armor equips to its `slot`; consumables are drunk/used; flavour items just sit in the pack. In the inventory the card *is* the control — clicking an item equips, uses or unequips it, with no per-item buttons.

`Special` is the story/required category (the demo's Hearthstone). A Special item never leaves the pack by the player's hand: it's filtered out of the merchant's sell list, the display-case artifact picker, and the chest deposit list, so give it no `value`. It is still *used* like a consumable when it declares a use (`teleportScene`, `healingAmount`, …) and is otherwise an inert card. Scripted effects — a quest turn-in, a scene that consumes it — remove it normally; the rule governs the player's choices, not the engine's reach.

Equipment `slot` names are **game-defined** — whatever keys appear in `rules.playerDefaults.equipment` (the demo uses `Head`, `Amulet`, `Torso`, `Left Hand`, `Right Hand`, `Legs`). Only the two hand slots are engine-fixed, because combat reads weapons from them. A weapon or spell goes to a hand by virtue of its `type`, so the engine picks the hand and the item's own `slot` is ignored (most weapons declare none): an empty hand first, left before right, and otherwise alternating left, right, left… Both `type` and `slot` are validated at boot.

*   `attackAttribute` names the attribute whose modifier the wielder adds to attack rolls — accuracy belongs to the character, not the weapon.
*   Armor and relics use `attributes.attributeBonuses` (e.g. `{ "perception": 1 }`) and/or `armorClassBonus` to raise attributes while worn.
*   Consumable effects: `healingAmount` (number or dice notation) consumes the item; `teleportScene` makes a reusable travel item.

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

**Missions** are started via `questTrigger` (on scenes or dialogue) and completed through the quest system's lifecycle. The simplest form is a name, a description, and completion rewards:

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

Add `stages` for multi-step quests. Each stage names an objective; an optional `advanceWhen` condition tree (the same shape as option conditions) advances it **by observation** — re-evaluated on every state change *and* the moment the stage becomes current, so a player who already carries the goods advances instantly, chaining through as many stages as are satisfied. Advancement is one-way and recorded: once a stage is passed, its condition turning false again never regresses it. Advancing past the last stage completes the mission.

```json
{
  "name": "Echoes of the Sunstone",
  "description": "Bron swears the old waystation's sunstone shattered into the halls below.",
  "stages": [
    {
      "id": "collect_shards",
      "description": "Recover two sunstone shards from the dungeon.",
      "advanceWhen": { "item": "sunstone_shard", "count": 2 },
      "rewards": { "xp": 25 }
    },
    {
      "id": "show_bron",
      "description": "Show the shards to Bron."
    }
  ],
  "missionRewards": { "xp": 75, "gold": 50 }
}
```

A stage's `rewards` fire when the stage is completed (advanced past); the final stage's fire alongside `missionRewards`. Stages without `advanceWhen` advance through explicit `questTrigger` stage jumps — forward-only, and stages skipped by a jump grant nothing. A mission can also end `failed`: terminal, reachable only from `active`, and only through an explicit trigger (a quest-giver crossed, a deadline timer fired). The active quest card shows the current stage's description under the mission's, and conditions read quest progress through the `stage` / `stageReached` leaves — see [Conditions](#conditions-logic-gates). Full parameter reference: [`schemas/mission.schema.json`](schemas/mission.schema.json) and [`docs/ACTIONS.md`](docs/ACTIONS.md).

---

## The Player UI

The game renders as three panels, each with one job:

*   **Left — the player.** Tabs generated from `rules.tabs`: the character **Sheet** (stats and skills as collapsible sections), **Inventory**, **Quests**, **Map**, and **Options** (save / load / restart).
*   **Center — the story.** The narrative log, with a pinned status bar showing HP / AC / AP / Gold, any `headerResources`, and the world clock. The bar is icon-only — each stat's label lives in its hover title and in screen-reader-only text.
*   **Right — the interactions.** The current scene's options, skill checks, dialogue responses, or combat controls. Exactly one surface owns this panel at a time — the engine's mode machine guarantees it.

Tabs are data-driven: each entry names a locale key, an `icon`, and optionally a `widget` (`attributes`, `map`, `options` — or one a plugin registered). **The save/load/restart buttons only exist inside an `options` widget tab** — omit it and players cannot save (the validator warns).

Icons come from the engine's own set and mark the same concept everywhere it appears — the heart on the Sheet's Hit Points row is the heart in the status bar. Game data references a glyph by name from `rules.tabs[].icon`, `rules.headerResources[].icon`, and `rules.customAttributes[].icon`; plugins pass one to `engine.registerSheetRow`. The set: `sheet`, `backpack`, `trophy`, `map`, `cog`, `heart`, `shield`, `sword`, `star`, `coin`, `person`, `level`, `bolt`, `thumbs_up`, `dumbbell`, `bulb`, `eye`, `moon`, `speech`. They are inline SVG filled with `currentColor` — no icon font, no image files. Add a glyph by adding it to [`src/core/icons.js`](src/core/icons.js), which is also what the validator checks names against.

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
│   │   ├── icons.js         # The inline SVG icon set, referenced by name from data
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
│   │   ├── narrative.js     # The chronological story log
│   │   └── audio.js         # Ambience loops & narration clips (Web Audio)
│   ├── ui/                  # UIManager (tab widgets, sheet, top bar, save/load) + panels
│   ├── world/map.js         # Minimap + full-screen world map
│   ├── screens/char-creation.js
│   └── plugins/curator.js   # Reference plugin (museum curation & reputation)
├── scripts/generate-manifest.js  # Regenerates data/index.json from the data tree
├── tests/                   # Node unit tests (npm test) + smoke.html (browser UI test)
├── schemas/                 # JSON Schemas for items, scenes, and NPCs
├── audio/                   # Ambience & narration clips (layout: docs/AUDIO.md)
└── data/                    # The shipped demo game: scenes, items, NPCs, rules, locales
```

The deeper tour — boot flow, the mode machine, state contracts, events, hooks, localisation, and testing policy — lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The binding conventions for code, comments, game data, and docs are codified in [`docs/STYLE.md`](docs/STYLE.md).

---

## Testing

*   **`npm test`** — 300+ synchronous unit tests on Node's native runner: state and saves, combat math, the condition AST, dice, checks and their attempt machine, scene and dialogue logic, the world clock, the validator, the curator plugin, and a data-integrity suite over the shipped demo.
*   **`tests/smoke.html`** — a zero-dependency browser smoke test that boots the real game and drives the UI like a player: character creation, tabs, the sheet, the top bar, the new-content notifier dots, inventory markup invariants and equipping, a live skill check, the scene panel's option sections, the audio controls, the museum's curator flows (wings, display cases, building, a save/load round trip), the combat framing rules, and merchant trade. `scripts/run-smoke.sh` runs it in headless Chrome and is part of CI, so the surfaces Node cannot reach are covered there too.
*   **CI** — GitHub Actions runs the test suite and verifies the manifest is in sync with the data tree on every push and pull request.

---

## License

This is free and unencumbered software released into the public domain. For details, see [LICENSE](LICENSE).
