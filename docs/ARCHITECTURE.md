# Gravity Engine Architecture

This document explains how the engine boots, how the modules fit together, and — most importantly for contributors — the implicit contracts (conditions, actions, events, hooks) that the JSON data and the plugin API are built on.

## Design Principles

1. **Zero dependencies.** The engine runs as native ES Modules in the browser; tests run on Node's built-in test runner. Nothing is compiled or bundled.
2. **Data-driven.** All game content (scenes, NPCs, items, quests, rules, loot tables) lives in JSON under `data/`. Authoring a game requires no JavaScript.
3. **Unidirectional reactive state.** All mutations go through `gameState` (a `StateManager` singleton); the UI re-renders via listeners. Game logic never touches DOM values directly, and UI code never owns game rules.
4. **Decoupled subsystems.** Stateful subsystems (combat, dialogue, scene, quests, narrative) never import each other — they communicate through the engine's delegate methods or its event bus. The exception is the pure, stateless helper modules `dice.js`, `condition.js`, and `skill-checks.js`: they hold no state and touch neither the engine nor the DOM, so subsystems import them directly the way they would any library function. The rule that prevents tangling is "no subsystem reaches into another subsystem's state," not "no file imports another."

## Boot Flow

`index.html` loads a single entry point, `src/core/engine.js`. In normal play it constructs `RPGEngine` on `DOMContentLoaded` (for the Studio live-preview path, see below):

1. **Construct subsystems** — combat, dialogue, quests, narrative log, scene renderer, UI manager. Each receives the engine instance.
2. **`init()`** registers the built-in actions, then loads `data/index.json` (the manifest), resolves the active language (see *Localisation*), and fetches every registered asset in parallel. NPC `carriedItems` are normalized at load to `{ item, amount }` objects (`amount: null` = unlimited), so data files may use the string shorthand but consumers only ever see one shape.
3. **Plugins load next** — *before* state initialisation, so they can register save migrations. Plugin locales declared in the manifest are loaded into a namespaced `plugin.<id>.*` locale tree, using the active language (falling back to the plugin's `en` file).
4. **Data validation** (`core/validate.js`, invoked via `_validateData`) checks all loaded data: dangling IDs (items, scenes, enemies, NPCs, tables, conversation nodes), unknown action types and `skillCheck` names, enemies missing the attributes combat requires, and missing locale keys. Issues are printed to the console grouped per source entity. Developer tooling only — it never blocks the game.
5. **`gameState.init(rules)`** replaces the skeleton state with defaults derived from `rules.json`; missions and scene flags are registered on top.
6. **UI setup + subscription** — `gameState.subscribe((_, hint) => ui.update(hint))` makes every state change reactively re-render the relevant UI region.
7. **Character creation** is shown for a fresh state; otherwise the starting scene renders.

### Studio live-preview boot (`?preview=1`)

The Phase-1 workbench adds a second boot path. With `?preview=1` in the URL the engine does **not** boot on `DOMContentLoaded`: it posts `gravity:preview-ready` to the parent window and waits for a `gravity:bundle` message, then constructs `RPGEngine(bundle)` — the constructor takes an optional `previewBundle`. Bundles are accepted only from a **same-origin parent** (scene descriptions render via `innerHTML`, so a foreign page embedding a deployed game must never be able to inject one).

With a bundle present, `loadData()` branches into `_loadFromBundle()` instead of fetching: it assembles the same loaded-data shape from the in-memory bundle (`{ manifest, rules, locale, items, npcs, scenes, missions, tables, flags }`), applying the same `carriedItems` normalization as the fetch path. Preview additionally deep-links to the scene being edited (`bundle.preview.startScene` wins over `rules.startingScene`) and skips character creation by giving the player a placeholder name. Studio's half of the handshake lives in `studio/js/complex/preview.js`; everything downstream of `loadData()` — validation, state init, rendering, plugins — is identical in both modes.

## Module Graph

```
engine.js (orchestrator, delegate API, event bus, registries)
├── core/state.js      gameState singleton, listeners, save/load + migrations
├── core/config.js     CSS/EL registries, ACTIONS, FLAG_KEYS, constants
├── core/validate.js   load-time game-data validation (Studio reuses it via studio/js/validate-workspace.js)
├── core/i18n.js       language resolution (pure)
├── core/utils.js      DOM helpers (createElement, resetOptionsPanel, …)
├── systems/
│   ├── scene.js       scene rendering, options, item discovery
│   ├── combat.js      initiative-based turn combat + combat renderer
│   ├── dialogue.js    conversation trees, merchant shops
│   ├── quests.js      mission lifecycle (listens to scene:entered)
│   ├── narrative.js   scrollable narrative log
│   ├── actions.js     built-in action handlers
│   ├── condition.js   condition AST evaluator (pure)
│   ├── skill-checks.js d20 checks, outcome tiers, attempt/resolution bookkeeping, luck
│   └── dice.js        roll() and damage parsing (pure)
├── ui/                UIManager + tab panels (inventory, quests, chests)
├── world/map.js       minimap + full-screen world map
├── screens/char-creation.js
└── plugins/           optional modules loaded via the manifest
```

There are no circular imports. Stateful subsystems reach each other only through `engine.*` delegates (`engine.renderScene()`, `engine.log()`, `engine.runActions()`, …) or events. The pure helpers (`dice.js`, `condition.js`, `skill-checks.js`) are leaf modules: they import nothing from `systems/` and are imported freely by the subsystems that need their math.

## State Management

`gameState` (in `core/state.js`) is the single source of truth. Key contracts:

- **Inventory/chest entries** have the shape `{ item: string, amount: number }`.
- **Mutations notify listeners** with an optional *hint* (`'stats'`, `'inventory'`, `'quests'`, `'map'`, `'displays'`) so the UI can re-render only the affected region. No hint means "update everything".
- **Flags** are a flat key→value map. Static flags are declared in `data/flags/`; dynamic flags (skill-check attempt state, merchant stock, etc.) use the key builders in `config.js` (`FLAG_KEYS`) so each format is defined exactly once.
- **Saves** are the whole state object, JSON-serialised and Base64-encoded, delivered as a file download (no storage quota applies). Compression is a known deferral: Base64 adds ~33% to a file measured in tens of KB, which isn't worth making the save/load path async (`CompressionStream`) today — revisit if saves ever move into `localStorage` or real campaigns produce multi-MB states. `SAVE_VERSION` gates a chain of migration functions so old saves stay loadable; plugins add their own with `gameState.registerMigration(version, fn)` using versions above the core number.

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
| `{ "time": { "at_least": 120 } }` | Absolute elapsed ticks |
| `{ "day": { "at_least": 3 } }` | Day number (needs `rules.time.ticksPerDay`) |
| `{ "segment": "night" }` | Current day segment (needs `rules.time.segments`) |
| `{ "luck": { "at_most": 2 } }` | Current luck resource |
| `{ "clock": "id", "progress": { "at_least": 2 } }` | Progress-clock fill (not running = 0) |
| `{ "<attribute>": 2 }` | Any custom attribute from `rules.customAttributes` |

Numeric leaves accept a bare number (meaning *at least*) or an operator object: `at_least`, `more_than`, `at_most`, `less_than`, `is`.

## Actions

Actions are the mutation pipeline: an array of `{ "type": ..., ...params }` objects executed in order by `engine.runActions()`. Handlers live in a registry; built-ins are registered from `systems/actions.js` under the names in `config.js` `ACTIONS`:

`loot`, `combat`, `dialogue`, `navigate`, `return`, `full_rest`, `heal`, `set_flag`, `log`, `manage_chest`, `advance_time`, `set_timer`, `cancel_timer`, `start_clock`, `advance_clock`, `cancel_clock`, `restore_luck` — plus plugin-registered actions (the curator plugin adds `manage_exhibits` and `add_display`).

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
| `player:apSpent` | `{ remaining }` | The player spends AP in combat; drives the enemy-turn hand-off |

## Scene Rendering Hooks

Two mechanisms let dynamic content reach scene rendering:

- **Description hooks** (`engine.registerDescriptionHook(name, fn)`) — *per-scene, opt-in*: a scene declares `"descriptionHook": "name"` in its JSON and the hook's return value (an HTML string) is appended to that scene's description.
- **Scene decorators** (`engine.registerSceneDecorator({ description?, options? })`) — *global*: invoked for every rendered scene. `description(scene, sceneId, engine)` returns HTML appended to the description; `options(scene, optionsContainer, engine)` may append extra option buttons. The curator plugin uses this to render its exhibits table and "Museum Curator Panel" button on any scene that has display cases.

## Plugins

Plugins are ES modules declared in `data/index.json`:

```json
"plugins": [
  {
    "id": "curator",
    "src": "./src/plugins/curator.js",
    "locales": { "en": "./src/plugins/curator/locales/en.json" }
  }
]
```

The default export receives the engine instance at boot (before state init). Available extension points:

- `engine.registerAction(name, fn)` — custom action types
- `engine.registerDescriptionHook(name, fn)` / `engine.registerSceneDecorator(decorator)` — dynamic scene content
- `engine.on(event, fn)` — react to engine events
- `engine.setCustomUIOpen(bool)` — mark a custom panel (chest, curator dashboard, …) as open/closed so scene re-renders don't draw over it; read back via `engine.inCustomUI`
- `gameState.onMutation(fn)` — observe state mutations: `fn(method, info)` fires after a mutating StateManager method completes (`init`, `loadFromObject`, `reset`, `modifyPlayerStat`, `addXP`, `addToInventory`, `removeFromInventory`, `equipItem`, `placeItemInDisplay`, `takeItemFromDisplay`)
- `gameState.registerStatHandler(stat, fn)` — intercept `modifyPlayerStat` for a custom stat; the handler fully replaces the default behaviour
- `gameState.setPlayerAttribute(attr, value)` — absolute attribute writes (e.g. for derived stats)
- `gameState.registerMigration(version, fn)` — save-format migrations for plugin state
- Locales declared in the manifest are exposed under `engine.t('plugin.<id>.<key>')`

Do **not** replace or wrap StateManager/engine methods on the live singletons — two plugins doing that will trample each other. Plugin-owned save fields (e.g. the curator's `museumReputation`/`obtainedItems`) are introduced via `registerMigration` and live at the top level of the save object.

**Trust boundary:** plugins are trusted code. They load via dynamic `import()` and run with full access to the page — the DOM, storage, the whole engine and game state. That is deliberate: the plugin API's value is direct, synchronous engine access, and the author of a game is the author of its plugins. The corollary: never load a campaign (manifest + plugins) from a source you don't trust, and don't host third-party campaigns on an origin whose storage or cookies matter. Sandboxing plugins (iframe/worker + `postMessage`) is intentionally out of scope until untrusted user-generated campaigns become a real use case — it would turn every hook into async RPC.

`src/plugins/curator.js` (museum curation + reputation) is the reference implementation.

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

## UI Layer

- `UIManager.update(hint)` re-renders the hinted region; `[data-stat-bind="path"]` elements are bound to player state by dot-path.
- The scene options panel (option buttons, injected sections, skills container, location reminder) is reset through `resetOptionsPanel()` in `core/utils.js` — every system that takes over the panel (scene, combat, dialogue, store, chest, curator) goes through it.
- **Text vs HTML policy:** `createElement(tag, class, text)` sets `textContent` — game data is always treated as plain text. The only sanctioned HTML channels are scene description bodies (`buildSceneDescription`) and engine-authored structural templates; any dynamic value embedded in those must pass through `escapeHtml()`.

## Testing

`npm test` runs `node --test tests/*.test.js` — synchronous unit tests against the real modules, no DOM required. Sixteen suites cover the engine's logic surface: state, combat math, the condition AST, dice, the action registry, scene and dialogue logic, displays and reputation (curator), character creation, i18n resolution, the validator itself, and a data-integrity suite that checks the shipped demo content. Studio has two suites of its own: pure editor logic, and IO integration tests against a mocked File System Access API. The DOM-rendering layer (`ui/`, the narrative log, the map) remains untested — the working policy is to keep rendering thin and the logic behind it in testable modules.
