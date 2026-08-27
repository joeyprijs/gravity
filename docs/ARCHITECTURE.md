# Gravity Engine Architecture

This document explains how the engine boots, how the modules fit together, and — most importantly for contributors — the implicit contracts (conditions, actions, events, hooks) that the JSON data and the plugin API are built on.

## Design Principles

1. **Zero dependencies.** The engine runs as native ES Modules in the browser; tests run on Node's built-in test runner. Nothing is compiled or bundled.
2. **Data-driven.** All game content (scenes, NPCs, items, quests, rules, loot tables) lives in JSON under `data/`. Authoring a game requires no JavaScript.
3. **Unidirectional reactive state.** All mutations go through the engine's `StateManager` (`engine.state`); the UI re-renders via listeners. Game logic never touches DOM values directly, and UI code never owns game rules. Subsystems receive their state dependency through the engine — no module imports the state singleton directly (only `engine.js` does, to own it).
4. **Decoupled subsystems.** Stateful subsystems (combat, dialogue, scene, quests, narrative, audio) never import each other — they communicate through the engine's delegate methods or its event bus. The exception is the stateless helper modules `dice.js`, `time.js`, `condition.js`, and `skill-checks.js`: they hold no state of their own, so subsystems import them directly the way they would any library function (`dice`, `time`, and `condition` touch neither the engine nor the DOM; `skill-checks` receives the engine as a parameter rather than owning any of it). The rule that prevents tangling is "no subsystem reaches into another subsystem's state," not "no file imports another."

## Boot Flow

`index.html` loads a single entry point, `src/core/engine.js`. It constructs `RPGEngine` on `DOMContentLoaded`:

1. **Construct subsystems** — narrative log, combat, dialogue, quests, UI manager, scene renderer, audio. Each receives the engine instance, except the narrative log, which takes only what it needs (`t`, `state`).
2. **`init()`** registers the built-in actions, then loads `data/index.json` (the manifest), resolves the active language (see *Localisation*), and fetches every registered asset in parallel. NPC `carriedItems` are normalized at load to `{ item, amount }` objects (`amount: null` = unlimited), so data files may use the string shorthand but consumers only ever see one shape.
3. **Plugins load next** — *before* state initialisation, so they can register save migrations. Plugin locales declared in the manifest are loaded into a namespaced `plugin.<id>.*` locale tree, using the active language (falling back to the plugin's `en` file).
4. **Data validation** (`core/validate.js`, invoked via `_validateData`) checks all loaded data: dangling IDs (items, scenes, enemies, NPCs, tables, conversation nodes), unknown action types and `skillCheck` names, enemies missing the attributes combat requires, and missing locale keys. Issues are printed to the console grouped per source entity. Developer tooling only — it never blocks the game.
5. **`engine.state.init(rules, items)`** replaces the skeleton state with defaults derived from `rules.json`; missions and scene flags are registered on top.
6. **UI setup + subscription** — `engine.state.subscribe((_, hint) => ui.update(hint))` makes every state change reactively re-render the relevant UI region.
7. **Character creation** is shown for a fresh state; otherwise the starting scene renders.

## Module Graph

```
engine.js (orchestrator, mode machine, delegate API, event bus, registries)
├── core/state.js      StateManager (owned as engine.state), listeners, save/load + migrations
├── core/config.js     CSS/EL registries, ACTIONS, FLAG_KEYS, constants
├── core/validate.js   load-time game-data validation
├── core/i18n.js       language resolution, list/plural formatting (pure)
├── core/utils.js      DOM helpers (createElement, resetOptionsPanel, …)
├── core/icons.js      the inline SVG icon set, referenced by name from data (pure)
├── systems/
│   ├── scene.js       scene rendering, options, item discovery
│   ├── combat.js      initiative-based turn combat (renderer in ui/combat-ui.js)
│   ├── dialogue.js    conversation trees, merchant shops
│   ├── quests.js      mission lifecycle + staged objectives (scene:entered + the mutation bus)
│   ├── narrative.js   scrollable narrative log
│   ├── audio.js       two-channel audio: region ambience loops + narration clips
│   ├── actions.js     built-in action handlers
│   ├── items.js       item use / equip / unequip (consumable-effect table)
│   ├── time.js        world-clock math: days, segments, time costs (pure)
│   ├── condition.js   condition AST evaluator (pure)
│   ├── skill-checks.js d20 checks, outcome tiers, runCheckAttempt, bookkeeping
│   └── dice.js        roll(), damage parsing, weighted tables (pure)
├── ui/                UIManager (tab widgets, sheet, top bar, save/load) + inventory/quest/chest/combat panels
├── world/map.js       minimap + full-screen world map
├── screens/char-creation.js
└── plugins/           optional modules loaded via the manifest
```

There are no circular imports. Stateful subsystems reach each other only through `engine.*` delegates (`engine.renderScene()`, `engine.log()`, `engine.runActions()`, …) or events. The stateless helpers (`dice.js`, `time.js`, `condition.js`, `skill-checks.js`) sit at the bottom of the graph: they import only each other (`condition` reads the clock through `time`, `skill-checks` rolls through `dice`) and `core` utilities, never a stateful subsystem, and are imported freely by the subsystems that need their math.

## State Management

`StateManager` (in `core/state.js`, owned by the engine as `engine.state`) is the single source of truth. Key contracts:

- **Inventory/chest entries** have the shape `{ item: string, amount: number }`.
- **Mutations notify listeners** with an optional *hint* (`'stats'`, `'inventory'`, `'quests'`, `'map'`, `'time'`) so the UI can re-render only the affected region (a plugin may notify with a hint of its own — the curator's `'displays'` — which no UI region binds to, so a plugin's own render never rides on it). No hint means "update everything". `modifyPlayerStat` accepts `'full'` to top a `{ current, max }` resource up to its cap; `modifyPlayerStats(deltas)` applies a whole map (the equip/unequip bonus swap) with a single notification.
- **`setFlag` and `setCheckState` deliberately do not notify.** Their effects surface through scene re-renders, option gating, and dialogue visibility, which their callers already drive; notifying on every write would double-render every skill-check click. Don't "fix" this — it's a convention, not an oversight.
- **Flags** are a flat, author-facing key→scalar map: static flags declared in `data/flags/`, plus engine-written world state (merchant stock, friendliness, one-time markers) built by the `FLAG_KEYS` builders in `config.js`. Anything here is fair game for an authored condition.
- **Check bookkeeping lives in `state.checkState`**, not in flags: the object-valued skill-check maps (attempt counts, resolution markers, discovery progress), keyed by the `CHECK_KEYS` builders and accessed via `getCheckState`/`setCheckState`. Engine-private — conditions never read it. Older saves stored these under prefixed flag keys; `loadFromObject` normalizes them over unconditionally (idempotent, version-independent).
- **Character creation** applies through `applyCharCreation(name, bonuses)` — one sanctioned mutation; nothing outside `StateManager` writes the player object directly.
- **Saves** are the whole state object, JSON-serialised and Base64-encoded, delivered as a file download (no storage quota applies). Compression is a known deferral: Base64 adds ~33% to a file measured in tens of KB, which isn't worth making the save/load path async (`CompressionStream`) today — revisit if saves ever move into `localStorage` or real campaigns produce multi-MB states. `SAVE_VERSION` gates a chain of migration functions so old saves stay loadable; plugins add their own with `state.registerMigration(pluginId, version, fn)` on a **per-plugin version line** (`state.pluginSaveVersions[pluginId]`, partitioned from the core counter, so a plugin stamping its data can never make a save silently skip a future core migration). Duplicating a version within a plugin's line throws; saves stamped by the pre-partition scheme are adopted back onto the core line on load.
- **Core state vs plugin state.** A top-level state field with dedicated `StateManager` accessors is for engine features authors reach through the schema and built-in actions — the player, inventory, flags, `checkState`, and **chests** (the built-in `manage_chest` action + core `ChestUI`). Everything a plugin *owns* goes under `state.plugins.<id>` via `pluginState(id)` (versioned with the plugin's own `registerMigration`) — never a new top-level field, and never by reading the raw `state.state` object.

  **The museum's display cases are the worked example of that line.** They used to be core: a `state.displays` map with five `StateManager` accessors, seeded by the scene renderer. They are now the curator's, in its bag beside the wings that hold them, with the mutators in `plugins/curator.js`. Two things forced the move. The container was already plugin-owned while its contents weren't — the wings live in `pluginState('curator').rooms`, so a load had to sync rooms *before* anything could address the cases standing in them. And core emitted `placeItemInDisplay`/`takeItemFromDisplay` mutations for exactly one listener, the curator's reputation; owning the mutator, it recomputes inline and the hook is gone. The test for "does this belong in core?" is **not** whether a mechanic resembles one that does (a case is not a chest with a smaller lid: capacity one, and the item's identity feeds a score) — it's whether anything outside the plugin can reach it. Nothing outside the curator ever put anything in a case.

  What stayed behind is a *scene file* field: `scene.displays` is still described in `schemas/scene.schema.json`, because that schema validates authored scenes and `additionalProperties: false` would otherwise reject it. It sits there alongside `museumSlot`, `museumHall`, and `museumBuilt` — plugin fields documented in a core schema, an acknowledged seam rather than a plugin-schema-extension mechanism built for one plugin. The curator reads the field and seeds its own map on `init`/`loadFromObject`/`reset` (never on scene render: the panel and the scene decorator both ask whether a room has cases *while* rendering it).

## The Mode Machine

Exactly one surface owns the interactions panel at a time. `engine.mode` is the single source of truth — `'scene' | 'combat' | 'dialogue' | 'store' | 'customUI' | 'gameover'` — and every transition goes through `engine.setMode()` (combat start/end, dialogue open/close, store enter/exit, custom UIs via `setCustomUIOpen`, save loads). Call sites read it through the facades `engine.inCombat`, `engine.inDialogue`, `engine.inCustomUI`, `engine.isGameOver`.

The companion helper is `engine.snapshotNavigation()`: capture it before running an action pipeline, and afterwards it answers "did anything move the player?" (a scene change or any mode transition). Every "skip the re-render when the pipeline navigated" decision in scenes, checks, and combat victory goes through this one predicate.

Turn handoff in combat is an explicit call, not an event: `engine._spendAP` hands each combat spend to `CombatSystem.notePlayerSpentAP`, which ends the player's turn when the budget runs out.

## Conditions

Conditions gate scene options, dialogue responses, description variants, and auto-combat. They are evaluated by `systems/condition.js`:

**Combinators** — `and: [...]`, `or: [...]`, `not: {...}`, nested arbitrarily.

**Leaf nodes:**

| Shape | Meaning |
|---|---|
| `{ "flag": "name", "value": true }` | Flag equals value |
| `{ "item": "id", "count": 2 }` | Inventory holds ≥ count (count optional) |
| `{ "mission": "id", "status": "active" }` | Quest status (`not_started`/`active`/`complete`/`failed`) |
| `{ "mission": "id", "stage": "collect" }` | Mission is active and exactly on this stage |
| `{ "mission": "id", "stageReached": "collect" }` | Mission's recorded stage is at or past this one (authored order; survives completion) |
| `{ "story": "book_id", "chapter": "id" }` | The player has heard this chapter of a story book (granted via `grant_chapter`) |
| `{ "level": 3 }` | Player level comparison |
| `{ "gold": { "less_than": 10 } }` | Gold comparison |
| `{ "<attribute>": 2 }` | Any custom attribute from `rules.customAttributes` |

Numeric leaves accept a bare number (meaning *at least*) or an operator object: `at_least`, `more_than`, `at_most`, `less_than`, `is`.

## Actions

Actions are the mutation pipeline: an array of `{ "type": ..., ...params }` objects executed in order by `engine.runActions()`. Every type — built-in or plugin — lives in one registry keyed by the strings in `config.js` `ACTIONS`; the built-ins are registered from `systems/actions.js`, the dialogue actions by `DialogueSystem` in its constructor. The **complete catalogue with parameters is in the README** ([Actions](../README.md#actions-mutations)); this section is the mechanism a contributor needs.

- A handler receives `(action, engine)` and owns exactly one side effect. Navigation is its own `navigate` action, never a hidden consequence — this is what keeps pipelines composable and `snapshotNavigation` meaningful.
- The conversation-bound actions (`goToConversation`, `trade`) warn and no-op when no dialogue is active; they share the global registry so scene options and conversation nodes extend through one mechanism.
- `action.log` is a shared convention, not a per-handler feature: `false` silences the default message, a string replaces it.
- Timer pipelines are filtered to the `TIMER_SAFE_ACTIONS` allowlist (`config.js`) before running, so a timer can't navigate or start combat from inside `advanceTime`.

Register a custom action from a plugin: `engine.registerAction('my_action', (action, engine) => { ... })`. A registered name overwrites an existing one with a console warning; unknown types warn at `runActions` time. `validateGameData` flags unknown action types at boot against the registry's current keys.

## Events

A minimal pub/sub bus on the engine: `engine.on(event, fn)`, `engine.emit(event, data)`.

Current events:

| Event | Payload | Emitted when |
|---|---|---|
| `scene:entered` | `{ sceneId, scene, isEntry, startsCombat }` | Every scene render except save restores. `isEntry` distinguishes a true arrival from a same-scene re-render — listeners that act on arrival must check it (the quest system does, and filters for scenes with a `questTrigger` itself) |

Events are notifications, not control flow — the combat turn handoff, for example, is an explicit `notePlayerSpentAP` call, not an event (see *The Mode Machine*).

## Scene Rendering Hooks

- **Scene decorators** (`engine.registerSceneDecorator({ description?, options? })`) — *global*: invoked for every rendered scene. `description(scene, sceneId, engine)` returns HTML appended to the description; `options(scene, optionsContainer, engine, sections)` may append extra option buttons, either to the unheaded container or to one of the panel's headed `sections` (`conversations`, `actions`) — a section left empty is hidden again afterwards. The curator plugin uses `options` to add its "Curate the exhibits" button, an act like any other, to the Actions section of any scene that has display cases; what stands in each case is the panel's to show, so nothing is spliced into the description.
- **Sheet rows** (`engine.registerSheetRow({ label, bind, icon })`) — adds a row to the sheet tab's character section, filled by the same `data-stat-bind` loop as the built-in stats. Plugins load before the UI builds, so registered rows render as part of the sheet itself — no DOM injection or timing games. The curator plugin surfaces `attributes.reputation` this way; the row simply doesn't render in games whose tabs omit the attributes widget.

## Plugins

Plugins are ES modules declared in `data/index.json`:

```json
"plugins": [
  {
    "id": "curator",
    "src": "./src/plugins/curator.js",
    "locales": {
      "en": "./src/plugins/curator/locales/en.json"
    },
    "config": {
      "installCost": 50
    }
  }
]
```

The optional `config` object holds the plugin's tunables, read back at runtime via `engine.pluginConfig(id)` — plugin config lives here, not in `rules.json`. The default export receives the engine instance at boot (before state init). Available extension points:

- `engine.registerAction(name, fn)` — custom action types
- `engine.registerValidator(fn)` — a boot-time data validator run after the core checks; `fn(data, { add })` calls `add(group, message)` per issue, so a plugin flags its own authoring mistakes (deprecated shapes, missing config) in the same report as the built-ins
- `engine.registerSceneDecorator(decorator)` — dynamic scene content
- `engine.registerTabWidget(name, fn)` / `engine.registerSheetRow({ label, bind, icon })` — contribute a whole sidebar tab (referenced from `rules.tabs[].widget`) or a single sheet row
- `engine.on(event, fn)` — react to engine events
- `engine.setCustomUIOpen(bool)` — mark a custom panel (chest, curator dashboard, …) as open/closed so scene re-renders don't draw over it; read back via `engine.inCustomUI`
- `engine.state.onMutation(fn)` — observe state mutations: `fn(method, info)` fires after a mutating StateManager method completes, immediately before its listener notification — so anything a hook derives or records is in place for the render that notification triggers (`init`, `loadFromObject`, `reset`, `modifyPlayerStat`, `addXP`, `addToInventory`, `removeFromInventory`, `equipItem`, `applyCharCreation`, …)
- `engine.state.registerStatHandler(stat, fn)` — intercept `modifyPlayerStat` for a custom stat; the handler fully replaces the default behaviour
- `engine.state.setPlayerAttribute(attr, value)` — absolute attribute writes (e.g. for derived stats)
- `engine.state.registerMigration(pluginId, version, fn)` — save-format migrations for plugin state, on the plugin's own version line (`state.pluginSaveVersions[pluginId]`, partitioned from the core `SAVE_VERSION`; duplicate versions throw)
- `engine.state.pluginState(id)` — the plugin's named save-data bag (`state.plugins.<id>`), serialized with the save. **This is where plugin-owned save data lives** — never write top-level state fields.
- `engine.pluginConfig(id)` — the plugin's config bag, declared as `config` on its manifest entry (see below). **This is where plugin tunables live** — the plugin's counterpart to core `rules`, so plugin knobs don't squat in `rules.json`.
- Locales declared in the manifest are exposed under `engine.t('plugin.<id>.<key>')`

Do **not** replace or wrap StateManager/engine methods on the live instances — two plugins doing that will trample each other. The curator's `museumReputation`/`obtainedItems` live in `pluginState('curator')`, introduced via its `registerMigration` (which also adopts the older top-level fields those saves carried).

**Trust boundary:** plugins are trusted code. They load via dynamic `import()` (except an id in `BUILT_IN_PLUGINS` — the shipped curator — which short-circuits to its statically imported module so the demo also boots from `file://`) and run with full access to the page — the DOM, storage, the whole engine and game state. That is deliberate: the plugin API's value is direct, synchronous engine access, and the author of a game is the author of its plugins. The corollary: never load a campaign (manifest + plugins) from a source you don't trust, and don't host third-party campaigns on an origin whose storage or cookies matter. Sandboxing plugins (iframe/worker + `postMessage`) is intentionally out of scope until untrusted user-generated campaigns become a real use case — it would turn every hook into async RPC.

`src/plugins/curator.js` (museum curation + reputation) is the reference implementation.

## Skill Checks

The full attempt machine — roll → outcome tier → time charge → `resolveOnce` → tier pipeline → attempt bookkeeping → `maxAttempts` exhaustion → re-render — exists exactly once: `runCheckAttempt` in `systems/skill-checks.js`. Scene pass/fail checks and dialogue responses both run through it, describing their surface via callbacks (where attempt state lives, how pipelines run, how to re-render). The button-side bundle (retry/AP gates, retry-aware text, badge lines) is `checkPresentation`, shared by those two *and* item-discovery checks. Discovery keeps its own resolution (a one-roll race against per-item DCs with loot awards) — it is genuinely a different machine, not a divergent copy. See `docs/CHECKS.md` for the authoring surface.

## The Data Manifest

`data/index.json` maps every content file. **Don't edit the file maps by hand** — `node scripts/generate-manifest.js` regenerates them from the `data/` tree (each entry's key is the file's top-level `"id"` field, else its filename stem; scenes declare ids because their keys carry region prefixes). CI runs `--check` to fail when the manifest is stale.

Each category (`items`, `npcs`, `scenes`, `missions`, `tables`) also accepts a *bundle*: a single path (or array of paths) to a JSON object holding many `id → definition` entries in one file. The per-file map form keeps authoring diffable at demo scale; bundles keep a game with thousands of scenes to a handful of requests at boot. Full region-lazy loading is intentionally out of scope: the action pipeline (`runActions` → `navigate` → render) is synchronous and deterministic, and an async scene accessor would cascade through all of it for memory savings that don't matter for text content.

## Localisation

Every player-facing string resolves through `engine.t(key, params)` against the active locale tree; missing keys fall back to the key itself so they are visible without crashing. A per-key fallback chain (missing key in the active language → default language's string) is a known deferral: no game ships a second locale yet, and the change interacts with the `t(key) !== key` missing-key probe some renderers use — build and test it against real partial translations when the first non-English locale lands.

The manifest may declare the locale files a game ships, plus the language used when the player's browser matches none of them:

```json
"defaultLanguage": "en",
"locales": {
  "en": "data/locales.json",
  "nl": "data/locales.nl.json"
}
```

At boot the engine matches `navigator.languages` against the declared codes — exact tag first (`pt-BR`), then base code (`pt`); the matching is implemented in `core/i18n.js` (`resolveLanguage`). The resolved code is exposed as `engine.language`, and plugin locale maps are resolved against the same language. `data/locales.json` is always loaded first as the fallback so error messages stay translatable even when the manifest fails to load; single-language games can omit `locales` entirely.

Grammar never lives in code: lists join through `formatList` (`Intl.ListFormat`) and plural-sensitive messages pick a `…One` key variant via `isOne` (`Intl.PluralRules`) — both in `core/i18n.js`.

## UI Layer

The game is three panels — player (left), story (center), interactions (right) — a deliberate layout: each panel maps onto one future mobile drawer.

- **Player panel:** tabs generated from `rules.tabs`. Each entry names a locale key, an `icon`, and an optional `widget` — `attributes` (the character sheet: stat and skill sections as collapsible icon/label/value rows, the skills' icons coming from `rules.customAttributes[].icon`), `map` (the minimap), or `options` (the save/load/restart buttons, which exist *only* here; `validate.js` warns when a tabs list omits the widget). Collapse state persists per section via `createSectionToggles` in `core/utils.js`, shared with the inventory panel's groups.
- **Story panel:** the narrative log, with a pinned top bar (`scene__topbar`) showing HP/AC/AP/Gold, every `rules.headerResources` entry, and the world clock. Each stat shows an icon in place of its label — the label survives as the hover title and as `.visually-hidden` text, so the accessible reading is still "HP: 10/10". The bar never scrolls — the log is the panel's internal scroll container.
- **Interactions panel:** the scene options, skill checks, dialogue responses, or combat controls. A scene's options are split by what their pipelines do, never by their wording: an option that `navigate`s stays in the unheaded first list (where the player can *go*), a `dialogue` action puts one under **NPCs**, anything else is an act performed here — resting, eating, opening a chest, starting a `combat` — and lands under **Actions**; skill checks keep their own **Skills** section. Two splits read the destination rather than the action, for moves that cross a threshold: outdoors a `navigate` into a building (`isInteriorScene`) lands under **Entrances**; inside one, a `navigate` to somewhere that isn't this building — or a `return` — lands under **Exits**, rendered at the foot of the panel where the way out has always sat. Both take precedence over an explicit `isBack` (which then only orders within the section), and neither applies to a move that stays on one side of the threshold: a road between outdoor places, or a door between two rooms of one house. A headed section stays hidden until something lands in it. The panel is reset through `resetOptionsPanel()` in `core/utils.js` — every system that takes over it (scene, combat, dialogue, store, chest, curator) goes through it.
- **The two map views:** `world/map.js` answers two different questions and must keep them apart. The minimap is *where am I* — inside a building, that building's visited rooms; outdoors, a `minimapRadius` viewport centered on the player over everything `_outdoorKnowledge()` reports as known (walked, plus one step of sight along the navigate destinations of its *options* — `sceneNavigationTargets` deliberately skips skill checks, whose destinations are discoveries rather than doors), with each building drawn as one square. `_interiorKeyOf()` is the single place that decides what counts as a building: a scene flagged `interior`, or a scene whose region is. The full-screen map is *where is everything* — the same knowledge from `_outdoorKnowledge()` at authored coordinates, collapsing only the buildings the player hasn't been inside. The two views must never disagree about what exists, so both read that one method; what differs is projection and detail. A building of several walked rooms also gets a `_buildingOutline` — a fill-less node carrying the building's name, emitted *last* so its label survives landing over a neighbor. Four seams: `_outdoorKnowledge` decides what is known, `_minimapPlacements` / `_fullMapPlacements` pick what each view draws, `_minimapView` decides how coordinates land in the HUD square, and the renderers only build DOM. Extend the one that matches the change.
- **Step direction:** every option in the unheaded list — a road between outdoor places, or a door between two rooms of one building, i.e. `stepTo()`: anything that neither enters nor leaves a building — gets a compass arrow, from `compassPoint()` in `core/utils.js`, rounded to the nearest cardinal — a road at 340° is *north* to a reader, and a diagonal glyph is the one the eye has to stop and decode. (Roads are still *ordered* on eight points; display rounds to four. Order needs the resolution to be deterministic, display needs the coarseness to be readable — `COMPASS_POINTS.length` drives the rounding, so the two never drift.) One `arrow` glyph drawn pointing north, turned by CSS (`--turn` is the point's index), so four directions cost one path. It sits absolutely on the card's trailing edge with `margin: 0` — `.card > * + *` spaces a card's stacked lines, and the marker is the second child, so without that it hangs 8px below the centre line. The glyph is `aria-hidden`, so the point's name goes in a `.visually-hidden` span beside it: the prose no longer says "east", and without that the direction would exist only for people who can see the arrow.
- **Naming a box on the minimap:** a name is unreadable at minimap scale, so `.map-node__label` is hidden there and `renderMinimap` copies the same text onto the node's `title` — the top bar's trick, where an icon keeps its label as a hover name. It is the only way to tell one unlabeled box from another, so every node carries one. (A panel→map hover highlight was built on top of this and removed again: pointing at an option lit its destination on the minimap, which worked, but taking an option rebuilds the panel under a cursor that has not moved, and the map lighting up on arrival read as a reaction to the move rather than to the player. Recoverable from git — `bed2551` is the last commit with it — if a better trigger than hover turns up. The direction arrows carry most of what it was for.)
- **Reactive updates:** `UIManager.update(hint)` re-renders the hinted region (`'stats'`, `'inventory'`, `'quests'`, `'map'`, `'time'`); `[data-stat-bind="path"]` elements anywhere in the document are filled from player state by dot-path on every stats change. The sheet, the top bar, and plugin-registered sheet rows all ride this one loop.
- **Shared DOM vocabulary:** `buildCard` in `core/utils.js` is the single builder for every titled box (options, checks, attacks, inventory items, quests, chest rows); `attrRowHtml` is the single builder for sheet rows, icon included. Restyle `.card` and `.attr-list__row` and the whole game follows.
- **Text vs HTML policy:** `createElement(tag, class, text)` sets `textContent` — game data is always treated as plain text. The only sanctioned HTML channels are scene description bodies (`buildSceneDescription`) and engine-authored structural templates; any dynamic value embedded in those must pass through `escapeHtml()`.

## Testing

`npm test` runs `node --test tests/*.test.js` — synchronous unit tests against the real modules, no DOM required. One suite per logic module covers the engine's surface: state, combat math, the condition AST, dice, the action registry, scene and dialogue logic, skill checks (scene and dialogue), the world clock, audio resolution, items and equipping, the DOM utils, displays and reputation (curator), character creation, i18n resolution, the validator itself, and a data-integrity suite that checks the shipped demo content.

The DOM-rendering layer is covered by a browser smoke test, `tests/smoke.html` (serve the repo, open the page): it injects the real skeleton from `index.html`, boots the engine against the shipped demo through `new RPGEngine()` (setting `window.GRAVITY_MANUAL_BOOT` so the production `DOMContentLoaded` boot stands down), then drives the UI like a player — character creation, tabs, the sheet's sections and bound values, the top bar, the new-content notifier dots, inventory markup invariants and equipping, the options tab (save/load/restart and the audio controls), the scene panel's option sections, a skill-check click, the museum's curator flows end to end (reputation line, wings, display cases, building, a save/load round trip), combat framing, and merchant trade. Results render on the page; `window.__SMOKE__` and the document title (`SMOKE: PASS/FAIL`) carry the verdict for automation. Zero dependencies, like everything else. Run it after UI-layer changes — the working policy stays "keep rendering thin and the logic in testable modules", with the smoke page catching what the Node suites structurally can't.
