# Gravity Project Audit & Engine Comparison Report

**Audited by: Antigravity (Gemini 3.1 Pro (High))**

This report provides a comprehensive, senior-developer-level audit of the Gravity RPG Engine codebase. It evaluates the project's JavaScript architecture, identifies areas for improvement or technical debt, and compares the engine against other prominent text-based browser game engines.

## 1. Architectural Audit

### 1.1 The Good (Strengths & Patterns)
- **Zero-Dependency Vanilla JS:** The adherence to native, zero-build JavaScript (ES Modules) is excellent. It ensures the longevity of the project and removes the cognitive load of complex build pipelines (Webpack, Babel). 
- **Modular Domain Structure (Recent Update):** The recent refactoring to separate the monolithic `src/` folder into domain-specific subdirectories (`core/`, `systems/`, `ui/`, `screens/`, `world/`) is a massive step forward, enforcing a cleaner separation of concerns and making the core engine much more navigable.
- **Screen Architecture (Recent Update):** The introduction of standalone UI flows (like the `CharCreationScreen`) proves the engine can elegantly handle custom, pre-game states outside of the standard narrative scene loop.
- **Data-Driven Design:** Decoupling the game logic from the content (via the `data/` directory and JSON schemas) gives Authoring a huge boost. It means game designers don't have to touch code to add items, scenes, or NPCs.
- **Reactive UI Pattern:** `state.js` implements a simple React-like `subscribe`/`notify` pattern. When game data mutates, listeners are notified, which updates the UI. This drastically reduces the bugs common to jQuery-era DOM manipulation where UI falls out of sync with internal state.
- **Cross-Reference Validation:** `engine.js` implements a developer-friendly `_validateData()` method that checks for orphaned scenes, items, and broken links on startup. This is an advanced feature often missing from bespoke engines and heavily speeds up debugging content creation.
- **Save File Abstraction:** Safely converting state to a Base64-encoded Blob for download/upload is a fast, straightforward implementation.

### 1.2 Areas for Improvement (Technical Debt & Risks)
- **God Object / Tight Coupling:** `engine.js` currently behaves as a centralized orchestrator (a God Object) while passing `this` (the engine) down to sub-components (like `SceneRenderer` or `CombatSystem`). Although it's meant to expose a "thin delegate API", it creates tight bidirectional coupling between the engine and its systems. 
- **Mixed State Access Patterns:** The project mixes Dependency Injection (`this.engine`) with Global Singleton imports (`import { gameState } from "./state.js"`). For instance, `scene.js` uses `gameState.addVisitedScene()` but calls `this.engine.log()`. Standardizing state access through a single method would improve testability.
- **Widespread UI Re-Renders:** Currently, whenever `notifyListeners()` or `forceUpdate()` is called iteratively, the game triggers a full UI re-render (`this.ui.update()`). While absolutely fine for text-based games at small scale, it destroys and recreates large chunks of the DOM on actions as small as taking a step or drinking a potion.
- **Lack of Save Migration / Versioning:** `state.js`'s `loadFromObject` function manually patches missing keys (e.g., `!parsedData.museumChest`). As the game scales, adding a standard `version` string to saves with proper migration functions (e.g. `migrate_v1_to_v2(saveData)`) will prevent older saves from breaking when the data schema changes.
- **Upfront Data Loading:** `loadData()` fetches the entire manifest and all JSONs at boot time. If the game grows to thousands of JSON files (scenes, items, npcs), this will create a network waterfall affecting startup time. Lazy-loading scenes via region transitions may be needed eventually.

---

## 2. Comparison with Other Game Engines

### Gravity vs. Twine (Harlowe/SugarCube)
* **Mechanics:** Twine handles hypertext linking exceptionally well out of the box, but struggles with complex continuous state (like an inventory or stats UI) without third-party macros (e.g., SugarCube's inventory plugins). Gravity provides native, hard-coded inventory, stats, and a D&D combat loop off the shelf.
* **Storage & Output:** Twine compiles everything into a single monolithic `.html` file. Gravity runs off distinct JSON files via REST/fetch operations.
* **Verdict:** Gravity is much better suited for an RPG system with distinct mechanics (combat, loot, maps). Twine is superior for pure branching narrative and interactive fiction.

### Gravity vs. ink / inkjs (Inklewriter)
* **Mechanics:** `ink` is a specialized scripting language built heavily around conditional text-weaving and flow-control. It does not provide UI, stats displays, or combat. Using `inkjs` just gives you text output string lines.
* **Authoring:** Writing in `ink` is significantly faster for dense prose than Gravity's JSON structure. Writing conditional text in Gravity's JSON format requires somewhat clunky array objects: `[{"text": "...", "requiredState": ...}]`.
* **Verdict:** If the game’s core focus ever shifts exclusively to dense, context-sensitive dialogue, `ink` would be better. For the current RPG focus, Gravity’s structured JSON provides stricter validation for required game variables.

### Gravity vs. ChoiceScript (Choice of Games)
* **Mechanics:** ChoiceScript is designed purely for stat-tracking "choose your path" titles. Its logic lives in indentation-based text files. It intentionally blocks things like dynamic inventory drag-and-drop or visual minimaps.
* **Verdict:** Gravity's decoupled UI gives it significantly more modern utility (glassmorphism UI, a real-time world map layer, and tabbed submenus) compared to ChoiceScript’s mostly static, text-only rigid structure.

---

## 3. Conclusion
The Gravity engine effectively solves the niche of being a **stateful, vanilla-JS RPG shell**. It strikes a good balance between data-driven architecture and a lightweight footprint. To graduate to a larger-scale project, refactoring UI rendering to only patch changed elements (or adopting a lightweight Virtual DOM solution) and formalizing Save Data schema versions should be the architectural priorities.
