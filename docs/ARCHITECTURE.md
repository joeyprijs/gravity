# Gravity Engine Architecture

This document explains how the engine boots, how the modules fit together, and — most importantly for contributors — the implicit contracts (conditions, actions, events, hooks) that the JSON data and the plugin API are built on.

## Design Principles

1. **Zero dependencies.** The engine runs as native ES Modules in the browser; tests run on Node's built-in test runner. Nothing is compiled or bundled.
2. **Data-driven.** All game content (scenes, NPCs, items, quests, rules, loot tables) lives in JSON under `data/`. Authoring a game requires no JavaScript.
3. **Unidirectional reactive state.** All mutations go through the engine's `StateManager` (`engine.state`); the UI re-renders via listeners. Game logic never touches DOM values directly, and UI code never owns game rules. Subsystems receive their state dependency through the engine — no module imports the state singleton directly (only `engine.js` does, to own it).
4. **Decoupled subsystems.** Stateful subsystems (combat, dialogue, scene, quests, narrative) never import each other — they communicate through the engine's delegate methods or its event bus. The exception is the pure, stateless helper modules `dice.js`, `condition.js`, and `skill-checks.js`: they hold no state and touch neither the engine nor the DOM, so subsystems import them directly the way they would any library function. The rule that prevents tangling is "no subsystem reaches into another subsystem's state," not "no file imports another."

## Boot Flow

`index.html` loads a single entry point, `src/core/engine.js`. It constructs `RPGEngine` on `DOMContentLoaded`:

1. **Construct subsystems** — combat, dialogue, quests, narrative log, scene renderer, UI manager. Each receives the engine instance.
2. **`init()`** registers the built-in actions, then loads `data/index.json` (the manifest), resolves the active language (see *Localisation*), and fetches every registered asset in parallel. NPC `carriedItems` are normalized at load to `{ item, amount }` objects (`amount: null` = unlimited), so data files may use the string shorthand but consumers only ever see one shape.
3. **Plugins load next** — *before* state initialisation, so they can register save migrations. Plugin locales declared in the manifest are loaded into a namespaced `plugin.<id>.*` locale tree, using the active language (falling back to the plugin's `en` file).
4. **Data validation** (`core/validate.js`, invoked via `_validateData`) checks all loaded data: dangling IDs (items, scenes, enemies, NPCs, tables, conversation nodes), unknown action types and `skillCheck` names, enemies missing the attributes combat requires, and missing locale keys. Issues are printed to the console grouped per source entity. Developer tooling only — it never blocks the game.
5. **`engine.state.init(rules)`** replaces the skeleton state with defaults derived from `rules.json`; missions and scene flags are registered on top.
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
├── systems/
│   ├── scene.js       scene rendering, options, item discovery
│   ├── combat.js      initiative-based turn combat (renderer in ui/combat-ui.js)
│   ├── dialogue.js    conversation trees, merchant shops
│   ├── quests.js      mission lifecycle (listens to scene:entered)
│   ├── narrative.js   scrollable narrative log
│   ├── actions.js     built-in action handlers
│   ├── items.js       item use / equip / unequip (consumable-effect table)
│   ├── condition.js   condition AST evaluator (pure)
│   ├── skill-checks.js d20 checks, outcome tiers, runCheckAttempt, bookkeeping
│   └── dice.js        roll(), damage parsing, weighted tables (pure)
├── ui/                UIManager (tab widgets, sheet, top bar, save/load) + inventory/quest/chest/combat panels
├── world/map.js       minimap + full-screen world map
├── screens/char-creation.js
└── plugins/           optional modules loaded via the manifest
```

There are no circular imports. Stateful subsystems reach each other only through `engine.*` delegates (`engine.renderScene()`, `engine.log()`, `engine.runActions()`, …) or events. The pure helpers (`dice.js`, `condition.js`, `skill-checks.js`) are leaf modules: they import nothing from `systems/` and are imported freely by the subsystems that need their math.

## State Management

`StateManager` (in `core/state.js`, owned by the engine as `engine.state`) is the single source of truth. Key contracts:

- **Inventory/chest entries** have the shape `{ item: string, amount: number }`.
- **Mutations notify listeners** with an optional *hint* (`'stats'`, `'inventory'`, `'quests'`, `'map'`, `'displays'`, `'time'`) so the UI can re-render only the affected region. No hint means "update everything". `modifyPlayerStat` accepts `'full'` to top a `{ current, max }` resource up to its cap; `modifyPlayerStats(deltas)` applies a whole map (the equip/unequip bonus swap) with a single notification.
- **`setFlag` and `setCheckState` deliberately do not notify.** Their effects surface through scene re-renders, option gating, and dialogue visibility, which their callers already drive; notifying on every write would double-render every skill-check click. Don't "fix" this — it's a convention, not an oversight.
- **Flags** are a flat, author-facing key→scalar map: static flags declared in `data/flags/`, plus engine-written world state (merchant stock, friendliness, one-time markers) built by the `FLAG_KEYS` builders in `config.js`. Anything here is fair game for an authored condition.
- **Check bookkeeping lives in `state.checkState`**, not in flags: the object-valued skill-check maps (attempt counts, resolution markers, discovery progress), keyed by the `CHECK_KEYS` builders and accessed via `getCheckState`/`setCheckState`. Engine-private — conditions never read it. Older saves stored these under prefixed flag keys; `loadFromObject` normalizes them over unconditionally (idempotent, version-independent).
- **Character creation** applies through `applyCharCreation(name, bonuses)` — one sanctioned mutation; nothing outside `StateManager` writes the player object directly.
- **Saves** are the whole state object, JSON-serialised and Base64-encoded, delivered as a file download (no storage quota applies). Compression is a known deferral: Base64 adds ~33% to a file measured in tens of KB, which isn't worth making the save/load path async (`CompressionStream`) today — revisit if saves ever move into `localStorage` or real campaigns produce multi-MB states. `SAVE_VERSION` gates a chain of migration functions so old saves stay loadable; plugins add their own with `state.registerMigration(version, fn)` using versions **above** the core number — registering at (or duplicating) an existing version throws, because a colliding migration would silently shadow another in the merge.

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
| `{ "mission": "id", "status": "active" }` | Quest status (`not_started`/`active`/`complete`) |
| `{ "level": 3 }` | Player level comparison |
| `{ "gold": { "less_than": 10 } }` | Gold comparison |
| `{ "<attribute>": 2 }` | Any custom attribute from `rules.customAttributes` |

Numeric leaves accept a bare number (meaning *at least*) or an operator object: `at_least`, `more_than`, `at_most`, `less_than`, `is`.

## Actions

Actions are the mutation pipeline: an array of `{ "type": ..., ...params }` objects executed in order by `engine.runActions()`. Handlers live in a registry; built-ins are registered from `systems/actions.js` under the names in `config.js` `ACTIONS`:

`loot`, `combat`, `dialogue`, `navigate`, `return`, `full_rest`, `heal`, `set_flag`, `log`, `manage_chest` — plus plugin-registered actions (the curator plugin adds `manage_exhibits` and `add_display`).

The dialogue actions (`goToConversation`, `trade`, `leave`, `makeFriendly`, `questTrigger`) live in the same registry; `DialogueSystem` registers them in its constructor. The conversation-bound ones (`goToConversation`, `trade`, `makeFriendly`) warn and no-op when no dialogue is active.

Conventions:
- Handlers receive `(action, engine)` and own only their side effect; navigation is its own `navigate` action.
- `action.log` controls output: `false` silences it, a string overrides the default message.
- On `loot` actions, `"received": true` marks the item/gold as handed over (NPC gift or reward) rather than found — it switches the log message from the `loot.foundItem`/`loot.foundGold` locale keys to `loot.receivedItem`/`loot.receivedGold`.

Register a custom action from a plugin: `engine.registerAction('my_action', (action, engine) => { ... })`.

## Events

A minimal pub/sub bus on the engine: `engine.on(event, fn)`, `engine.off(event, fn)`, `engine.emit(event, data)`.

Current events:

| Event | Payload | Emitted when |
|---|---|---|
| `scene:entered` | `{ sceneId, scene }` | A scene with a `questTrigger` is actually entered (not on option re-renders or save restores) |

Events are notifications, not control flow — the combat turn handoff that used to ride a `player:apSpent` event is now an explicit `notePlayerSpentAP` call (see *The Mode Machine*).

## Scene Rendering Hooks

Two mechanisms let dynamic content reach scene rendering:

- **Description hooks** (`engine.registerDescriptionHook(name, fn)`) — *per-scene, opt-in*: a scene declares `"descriptionHook": "name"` in its JSON and the hook's return value (an HTML string) is appended to that scene's description.
- **Scene decorators** (`engine.registerSceneDecorator({ description?, options? })`) — *global*: invoked for every rendered scene. `description(scene, sceneId, engine)` returns HTML appended to the description; `options(scene, optionsContainer, engine)` may append extra option buttons. The curator plugin uses this to render its exhibits table and "Museum Curator Panel" button on any scene that has display cases.
- **Sheet rows** (`engine.registerSheetRow({ label, bind })`) — adds a row to the sheet tab's character section, filled by the same `data-stat-bind` loop as the built-in stats. Plugins load before the UI builds, so registered rows render as part of the sheet itself — no DOM injection or timing games. The curator plugin surfaces `attributes.reputation` this way; the row simply doesn't render in games whose tabs omit the attributes widget.

## Plugins

Plugins are ES modules declared in `data/index.json`:

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

The default export receives the engine instance at boot (before state init). Available extension points:

- `engine.registerAction(name, fn)` — custom action types
- `engine.registerDescriptionHook(name, fn)` / `engine.registerSceneDecorator(decorator)` — dynamic scene content
- `engine.registerTabWidget(name, fn)` / `engine.registerSheetRow({ label, bind })` — contribute a whole sidebar tab (referenced from `rules.tabs[].widget`) or a single sheet row
- `engine.on(event, fn)` — react to engine events
- `engine.setCustomUIOpen(bool)` — mark a custom panel (chest, curator dashboard, …) as open/closed so scene re-renders don't draw over it; read back via `engine.inCustomUI`
- `engine.state.onMutation(fn)` — observe state mutations: `fn(method, info)` fires after a mutating StateManager method completes (`init`, `loadFromObject`, `reset`, `modifyPlayerStat`, `addXP`, `addToInventory`, `removeFromInventory`, `equipItem`, `placeItemInDisplay`, `takeItemFromDisplay`, `applyCharCreation`, …)
- `engine.state.registerStatHandler(stat, fn)` — intercept `modifyPlayerStat` for a custom stat; the handler fully replaces the default behaviour
- `engine.state.setPlayerAttribute(attr, value)` — absolute attribute writes (e.g. for derived stats)
- `engine.state.registerMigration(version, fn)` — save-format migrations for plugin state (versions above the core `SAVE_VERSION`; collisions throw)
- `engine.state.pluginState(id)` — the plugin's named save-data bag (`state.plugins.<id>`), serialized with the save. **This is where plugin-owned save data lives** — never write top-level state fields.
- Locales declared in the manifest are exposed under `engine.t('plugin.<id>.<key>')`

Do **not** replace or wrap StateManager/engine methods on the live instances — two plugins doing that will trample each other. The curator's `museumReputation`/`obtainedItems` live in `pluginState('curator')`, introduced via its `registerMigration` (which also adopts the older top-level fields from pre-v5 saves).

**Trust boundary:** plugins are trusted code. They load via dynamic `import()` and run with full access to the page — the DOM, storage, the whole engine and game state. That is deliberate: the plugin API's value is direct, synchronous engine access, and the author of a game is the author of its plugins. The corollary: never load a campaign (manifest + plugins) from a source you don't trust, and don't host third-party campaigns on an origin whose storage or cookies matter. Sandboxing plugins (iframe/worker + `postMessage`) is intentionally out of scope until untrusted user-generated campaigns become a real use case — it would turn every hook into async RPC.

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

- **Player panel:** tabs generated from `rules.tabs`. Each entry names a locale key and an optional `widget` — `attributes` (the character sheet: stat and skill sections as collapsible label/value rows), `map` (the minimap), or `options` (the save/load/restart buttons, which exist *only* here; `validate.js` warns when a tabs list omits the widget). Collapse state persists per section via `createSectionToggles` in `core/utils.js`, shared with the inventory panel's groups.
- **Story panel:** the narrative log, with a pinned top bar (`scene__topbar`) showing HP/AC/AP/Gold, every `rules.headerResources` entry, and the world clock. The bar never scrolls — the log is the panel's internal scroll container.
- **Interactions panel:** the scene options, skill checks, dialogue responses, or combat controls. It is reset through `resetOptionsPanel()` in `core/utils.js` — every system that takes over the panel (scene, combat, dialogue, store, chest, curator) goes through it.
- **Reactive updates:** `UIManager.update(hint)` re-renders the hinted region (`'stats'`, `'inventory'`, `'quests'`, `'map'`); `[data-stat-bind="path"]` elements anywhere in the document are filled from player state by dot-path on every stats change. The sheet, the top bar, and plugin-registered sheet rows all ride this one loop.
- **Shared DOM vocabulary:** `buildCard` in `core/utils.js` is the single builder for every titled box (options, checks, attacks, inventory items, quests, chest rows); `attrRowHtml` is the single builder for sheet rows. Restyle `.card` and `.attr-list__row` and the whole game follows.
- **Text vs HTML policy:** `createElement(tag, class, text)` sets `textContent` — game data is always treated as plain text. The only sanctioned HTML channels are scene description bodies (`buildSceneDescription`) and engine-authored structural templates; any dynamic value embedded in those must pass through `escapeHtml()`.

## Testing

`npm test` runs `node --test tests/*.test.js` — synchronous unit tests against the real modules, no DOM required. One suite per logic module covers the engine's surface: state, combat math, the condition AST, dice, the action registry, scene and dialogue logic, skill checks, the world clock, displays and reputation (curator), character creation, i18n resolution, the validator itself, and a data-integrity suite that checks the shipped demo content.

The DOM-rendering layer is covered by a browser smoke test, `tests/smoke.html` (serve the repo, open the page): it injects the real skeleton from `index.html`, boots the engine against the shipped demo through `new RPGEngine()` (setting `window.GRAVITY_MANUAL_BOOT` so the production `DOMContentLoaded` boot stands down), then drives the UI like a player — character creation, tabs, the sheet's sections and bound values, the top bar, inventory markup invariants, the options tab, and a skill-check click. Results render on the page; `window.__SMOKE__` and the document title (`SMOKE: PASS/FAIL`) carry the verdict for automation. Zero dependencies, like everything else. Run it after UI-layer changes — the working policy stays "keep rendering thin and the logic in testable modules", with the smoke page catching what the Node suites structurally can't.
