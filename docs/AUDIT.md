# Code Quality Audit — Gravity Engine

*Audit date: 2026-06-10. Scope: all JavaScript under `src/`, plus `tests/`, `schemas/`, `data/` contracts, and docs. The `/studio` directory is excluded. Line numbers refer to the codebase at commit `5ac1511`.*

> **Remediation status (updated 2026-06-11):** every item in the "Before release" **and** "First pass after release" roadmap groups has been implemented — see the checked boxes in [Section 7](#7-remediation-roadmap) and the ✅ annotations on individual findings. Line numbers in resolved findings refer to the pre-fix code. The remaining work is the "Nice to have" group.

---

## 1. Executive Summary

The codebase is in good shape architecturally. The module graph is clean and acyclic, subsystems communicate through the engine rather than importing each other, quests are decoupled via events, the UI re-renders reactively through a state subscription, and the whole engine runs with zero dependencies. The 98 unit tests exercise real modules rather than mocks. None of the findings below are structural rot — they are the polish layer between "solid internal project" and "open-source project strangers can extend."

The four issues most worth fixing before release:

1. **The JSON schemas are not valid JSON Schema** — they declare draft-07 but use non-standard uppercase type names, so they can't be used with any validator and teach contributors the wrong syntax.
2. **Curator-plugin rendering leaked back into core** — `scene.js` still renders the museum exhibits table (with inline styles and a `plugin.curator.*` locale key), undoing part of the plugin extraction.
3. **No data validation at load time** — malformed or dangling data fails silently or crashes deep in gameplay, which will be the #1 frustration for people authoring their own data packs.
4. **The plugin API has no formal surface** — the curator plugin monkey-patches the state singleton and writes engine-private fields, a pattern that breaks as soon as two plugins coexist.

Beyond those, the recurring themes are duplication (the same five patterns copy-pasted across systems), magic strings (flag keys, `'gold'`, hardcoded costs), undocumented implicit contracts (conditions, actions, hooks, events), and test coverage that stops at the systems/UI boundary.

---

## 2. Architecture Overview

*(This section doubles as onboarding material; consider promoting it to a future `ARCHITECTURE.md`.)*

**Boot flow.** `index.html` loads a single module entry point, `src/core/engine.js`. The `RPGEngine` constructor instantiates all subsystems; `init()` then loads the data manifest and cascades JSON loads (items, NPCs, scenes, missions, rules, flags, locales), loads plugins declared in the manifest (plugins run *before* state init so they can register migrations), runs lightweight cross-reference validation, initializes the `gameState` singleton, subscribes the UI as a state listener, and either shows character creation or renders the starting scene.

**Module graph.**

```
engine.js (orchestrator, service locator, event bus, action runner)
├── core/state.js      gameState singleton + listener pattern + save migrations
├── core/config.js     EL / CSS / LOG registries and constants
├── core/utils.js      DOM helpers (createElement, clearElement), path access
├── systems/
│   ├── scene.js       scene rendering, options, skill checks, item discovery
│   ├── combat.js      initiative-based turn combat + renderer
│   ├── dialogue.js    conversation trees, skill gates, merchant shops
│   ├── quests.js      mission state transitions (event-driven via engine.on)
│   ├── narrative.js   scrollable log + scene container lifecycle
│   ├── actions.js     action handler registry (loot, combat, navigate, …)
│   └── condition.js   recursive AST evaluator (and/or/not + leaf checks)
├── ui/                UIManager + tab panels (quest, chest, inventory)
├── world/map.js       minimap / full-map rendering with caching
├── screens/char-creation.js
└── plugins/curator.js museum curation + reputation (loaded via manifest)
```

**State management.** A single `gameState` (`state.js`) owns all mutable data. Systems mutate via `StateManager` methods, never raw property writes; mutations call `notifyListeners(hint)` and the UI re-renders the hinted region. Saves are Base64-encoded JSON with a versioned migration chain.

**Plugin system.** The manifest declares plugins; the engine dynamic-imports them and passes itself in. Plugins can register actions, migrations, description hooks, locale namespaces, and event listeners. (Section 3.4 covers where this API currently falls short.)

**Strengths worth preserving:** no circular dependencies; event-driven quest triggers; `hint`-based partial UI updates; data-driven content (scenes/NPCs/items/rules as JSON); zero runtime dependencies; tests that run in plain `node --test` with no framework.

---

## 3. High-Severity Findings

### 3.1 Schemas are not valid JSON Schema ✅ *Resolved*

> **Resolution:** all three schemas converted to valid draft-07 (lowercase types); `carriedItems` now uses a proper `oneOf` for its string/object forms.

Every file in `schemas/` declares `"$schema": "http://json-schema.org/draft-07/schema#"` but uses uppercase type names — `"type": "OBJECT"`, `"STRING"`, `"INTEGER"` (e.g. `schemas/scene.schema.json:4`). Standard JSON Schema requires lowercase. Consequences:

- The schemas cannot be used with any validator (Ajv, IDE JSON validation, CI checks). They are documentation-only, and the `$schema` declaration makes that misleading.
- Contributors will copy the pattern into new schemas.
- It blocks the most valuable fix in this report (3.3): load-time data validation.

**Recommendation:** Convert all schemas to valid draft-07 (lowercase types, fix the mixed-type `carriedItems` declaration in `npc.schema.json:22-33` with a proper `oneOf`). Then they become assets instead of liabilities: editor autocomplete for data authors and a validation source for 3.3.

### 3.2 Curator-plugin rendering leaked into core `scene.js` ✅ *Resolved*

> **Resolution:** a new `engine.registerSceneDecorator({ description, options })` plugin API was added; the exhibits table *and* the auto-injected curator button both moved into `curator.js`, inline styles moved to CSS classes in `css/styles.css` (which also fixed references to the undefined `--border-color`/`--text-color` variables), the table headers are now locale keys, and player-entered display names are HTML-escaped via a new `escapeHtml()` utility. Core `scene.js` no longer contains any curator reference.

`scene.js:425-442` (`_resolveDescription`) builds a museum "exhibits table" inline: ~10 lines of HTML in template strings, heavy inline `style="…"` attributes, and the locale key `plugin.curator.curatorEmpty`. This is curator-plugin UI living in the core engine — a leftover from the plugin extraction (commit `84f6fb0`). It undermines the headline claim that the curation mechanic is a standalone plugin: delete the plugin and core still renders museum displays referencing a missing locale key.

**Recommendation:** Move this rendering into `curator.js` using the `registerDescriptionHook` mechanism that already exists for exactly this purpose (the hook dispatch is right above, `scene.js:420-423`). Move the inline styles to classes in `css/`. Related: the display/exhibit state helpers in `state.js` (`getDisplaysForScene`, `addDisplayToScene`, migration v3) are also curator-flavored — worth a deliberate decision on whether "displays" are a generic engine feature or plugin state.

### 3.3 No data validation layer at load time ✅ *Resolved*

> **Resolution:** validation now lives in a headless `src/core/validate.js` with per-collection validators (tables, scenes, NPCs incl. conversation trees, rules), covered by `tests/validate.test.js`. New checks beyond the old cross-reference pass: unknown action types in dialogue pipelines, unknown `skillCheck` names, enemies missing the attributes combat requires, broken `goToConversation` node references, and unknown items in skill discovery lists. Output is grouped per source entity via `console.groupCollapsed`. Validation runs after plugin loading so plugin-registered action types are known. `addToInventory` now rejects unknown item IDs at the state layer (when an item database was provided to `init()`).

`engine._validateData()` (`engine.js:193-276`) only checks cross-references (unknown IDs) and only emits ungrouped `console.warn`s. The schemas are never enforced (3.1). Concrete failure modes today:

- Unknown item IDs are added to inventory unvalidated (`scene.js:306`, `actions.js:23`, `dialogue.js:381`) — the inventory then renders raw IDs or breaks.
- An NPC missing `attributes` crashes combat with a property-read TypeError (`combat.js:100`, `262-264`) rather than a useful message.
- A scene option with an unknown `skillCheck` silently rolls with modifier 0 (`scene.js:269`, `dialogue.js:195`) — no warning anywhere.
- A skill with explicit `increment: 0` (allowed by the schema, present in demo data `data/scenes/dungeon/start.json:72,77`) disables DC escalation entirely — possibly unintended.

For an engine whose pitch is "author your own content as JSON," fail-fast validation with good messages is the single biggest contributor-experience improvement available.

**Recommendation:** After fixing the schemas, validate all loaded data on boot (a small hand-rolled checker is fine given the zero-dependency goal; full schema validation is the stretch goal). Group output ("12 issues in data/scenes/…") instead of one `console.warn` per issue. Also guard `addToInventory` against unknown item IDs at the state layer.

### 3.4 The plugin API has no formal surface — curator patches internals ✅ *Resolved*

> **Resolution:** `StateManager` gained a formal plugin surface — `onMutation(fn)` (post-mutation hooks), `registerStatHandler(stat, fn)` (custom-stat interception), and `setPlayerAttribute(attr, value)` (absolute writes for derived stats). The engine gained `setCustomUIOpen(bool)`; all four external `_customUIOpen` writes now go through it. `curator.js`'s `patchState()` is gone — the plugin registers hooks instead of replacing methods, so two plugins can no longer trample each other. Documented in ARCHITECTURE.md's plugin section.

Two patterns in `curator.js` show the plugin API's current limits:

- `patchState()` (`curator.js:7-141`) wraps `gameState.init`, `modifyPlayerStat`, etc. by replacing the methods on the live singleton. This is invisible to readers of `state.js`, untestable in isolation, and two plugins patching the same method will trample each other.
- Plugins and even core modules write the engine-private field `engine._customUIOpen` directly (`curator.js:164,234`, `chest-ui.js:46`, `actions.js:91`) while `engine.js:384` exposes it via the `inCustomUI` getter. An underscore-private field mutated from four external call sites isn't private — it's an undeclared API.

**Recommendation:** Promote what plugins actually need into explicit API: state lifecycle hooks (e.g. `gameState.onMutate(fn)` or engine-level events for stat/inventory changes) to replace method wrapping, and a public `engine.setCustomUIOpen(bool)` (or open/close events) to replace the private-field writes. The existing `registerAction` / `registerMigration` / `registerDescriptionHook` / `on()` registrations are the right shape — extend that pattern rather than inventing a new one.

---

## 4. Medium-Severity Findings

### 4.1 Duplicated logic across systems ✅ *Resolved*

> **Resolution:** all five extractions implemented — `getItemLabel()` and `resetOptionsPanel()` in `core/utils.js`, `performSkillCheck()`/`getEscalatedDc()`/`escalateDc()` in a new `systems/skill-checks.js`, and `_addToItemList()`/`_removeFromItemList()` in `StateManager`. Note one deliberate behavior change: chest and curator custom UIs now also clear/hide the skills container (previously they left scene skill buttons visible behind the custom panel).

The same five patterns were independently reimplemented:

| Pattern | Occurrences | Suggested home |
|---|---|---|
| DC escalation on failed checks (init map in flags, bump by `increment`) | `scene.js:87-98, 256-261, 333-351` and, with different key shapes, `dialogue.js:57, 176-186, 205-206` | shared `skill-checks.js` helper |
| Skill roll + success test (`roll(1, MAX_D20_ROLL) + mod >= dc`) + logging | `scene.js:269-282, 357`, `dialogue.js:195-200` | `rollSkillCheck(skill, dc) → {roll, success}` |
| Options-panel clearing boilerplate (clear containers, hide skills, remove sections, re-add reminder) | `combat.js:450-458`, `dialogue.js:159-172`, `scene.js:122-137` | UI utility `clearOptionsPanel()` |
| Item label (`items[id]?.name \|\| id`, append `(xN)` when amount > 1) | 6+ sites in `chest-ui.js`, `inventory-ui.js`, `curator.js`, `scene.js:307` | `getItemLabel(itemId, amount)` in utils |
| Find-entry → adjust amount → drop-at-zero collection logic | `state.js:232-248` (inventory) vs `282-305` (chest) | private `_modifyItemCollection()` in StateManager |

### 4.2 Magic strings and numbers ✅ *Resolved*

> **Resolution:** `config.js` now exports `GOLD_ITEM_ID`, `FLAG_KEYS` (builders for `skill_dc_*`, `dialogue_dc_*`, `merchant_stock_*`, `trade_discount_*`, `friendly_*`, `xp_awarded_*`) and `MAP_PADDING`; all inline sites were converted. The curator install cost moved to `rules.json` (`curator.installCost`).

- **Flag-key construction** — `skill_dc_${…}`, `dialogue_dc_${…}`, `merchant_stock_${…}`, `friendly_${…}` are assembled inline at every use site across `scene.js` and `dialogue.js`. A typo silently creates a new flag. Centralize as key-builder functions in `config.js`.
- **`'gold'`** as the special currency ID is hardcoded in ~8 places (`engine.js:199,223,233,245,287,…`, `scene.js:301`). One constant in `config.js`.
- **Hardcoded balance values in code:** curator install cost `50` (`curator.js:284`); `merchantSellRatio ?? 0.5` fallback (`dialogue.js:393`) duplicating a number that `item.schema.json` documents; minimap `padding = 40` (`map.js:74`) while sibling sizes live in `config.js`. Balance numbers belong in `rules.json`; layout constants in `config.js`.

### 4.3 i18n is wired but dead-ended

Plugin locale loading hardcodes `const currentLang = 'en'` (`engine.js:53`). The locale plumbing (namespaced plugin locales, `t()` with params) is genuinely good — but there is no way to select a language, so the manifest's `locales` map is misleading. Either add a language setting (rules.json or browser-language detection) or document English-only status until then.

### 4.4 Browser/DOM concerns in the state layer ✅ *Resolved*

> **Resolution:** `downloadSave()` was split — `gameState.getSaveString()` returns the encoded string (headless), and `UIManager._downloadSave()` owns the Blob/anchor/click mechanics next to the matching load path.

`state.js:100-129` `downloadSave()` builds a Blob, creates an anchor, appends and clicks it. That is UI work inside StateManager — the one module that should stay headless (it's also what makes the current Node tests possible). Split it: state produces the encoded string; `ui.js` (which already owns the matching *load* path at `ui.js:31-58`) owns the download mechanics.

### 4.5 `createElement`'s third parameter is `innerHTML` ✅ *Resolved*

> **Resolution:** the third parameter now sets `textContent`; no call site relied on HTML injection (verified — no markup exists in any game data or locale file). The sanctioned HTML channels (scene description bodies, structural widget templates) are documented in the function's JSDoc and in ARCHITECTURE.md, with `escapeHtml()` required for dynamic values.

`utils.js:39` assigns the third argument to `el.innerHTML`, and data-driven strings flow through it: item descriptions (`inventory-ui.js:78`), stat labels (`ui.js:98-109`), the curator REP header (`curator.js:149-152`), and the exhibits table (3.2). Today all data is first-party JSON, so this is not an exploitable XSS — but for an extensible engine where data packs may be third-party, HTML injection as the *default* text path is the wrong contract.

**Recommendation:** Make the third parameter `textContent` and add an explicit opt-in (separate helper or options flag) for the few call sites that intentionally render authored HTML. Decide and document the policy: "game data is text unless explicitly HTML."

### 4.6 Long functions / deep nesting ✅ *Resolved*

> **Resolution:** all five split — `renderStore` → `_buildBuySection`/`_buildSellSection`; `char-creation._render` → `_buildNameSection`/`_buildStatsSection`/`_buildStatRow`/`_buildActionsRow`; `scene.render` → `_registerInitialDisplays`/`_appendSceneDescription`/`_resetSkillDcs`/`_maybeStartAutoAttack`; `_validateData` → per-collection validators in `core/validate.js`; `_buildItemDiscoveryButton` → `_resolveDiscovery`/`_awardDiscoveredLoot`.

Five functions account for most of the hard-to-read code; each mixes several responsibilities and embeds multi-level logic inside `onclick` closures:

- `dialogue.renderStore()` — 121 lines (`dialogue.js:302-423`): buy panel, sell panel, stock bookkeeping, pricing. Split into `_buildBuySection` / `_buildSellSection`.
- `char-creation._render()` — 132 lines (`char-creation.js:35-166`) of raw DOM construction.
- `scene.render()` — 85 lines (`scene.js:36-120`): display auto-registration, quest triggering, auto-attack, then actual rendering. Extract the three preludes.
- `engine._validateData()` — 84 lines (`engine.js:193-276`) of nested loops; extract per-collection validators (also enables 3.3).
- `scene._buildItemDiscoveryButton()` — 73 lines (`scene.js:255-328`) with table rolling, aggregation, and logging inline in the click handler; extract a named `_resolveDiscovery()`.

### 4.7 Test coverage stops at the systems/UI boundary

Current coverage is real and good where it exists: `state`, `combat`, `condition`, `dice`, `display`, `reputation`, `char-creation` logic — 98 tests against real modules. Zero coverage: `dialogue.js`, `scene.js`, `actions.js`, `narrative.js`, `map.js`, all of `src/ui/`, and `curator.js`. The untested trio dialogue/scene/actions contains the most intricate game logic in the repo (merchant stock, DC escalation, loot aggregation) — and notably, the duplication in 4.1 lives almost entirely in untested files, which raises refactoring risk. Priority order: actions → dialogue (mostly pure logic, testable today) → scene → jsdom-based UI smoke tests.

### 4.8 Documentation drift and unenforced standards ✅ *Resolved*

> **Resolution:** the README badge no longer hardcodes a test count (it always drifted), the structure tree now lists all seven test files and the `src/plugins/` directory, and CONTRIBUTING's JSDoc rule was rescoped to public APIs (exported functions, shared helpers, cross-module methods) to match a standard the codebase can actually hold.

- README badge says **85** tests (`README.md:6`) and the structure section repeats it (`README.md:121`); actual count is **98**. The hand-maintained badge will always drift — generate it or drop the number.
- README's test-file list omits `display.test.js`, `reputation.test.js`, `char-creation.test.js`.
- `CONTRIBUTING.md:15` mandates JSDoc on all functions, but UI and systems methods widely lack it and nothing enforces it. Either soften the requirement or meet it (public APIs first: StateManager methods, engine registration methods, condition/action contracts). Inconsistency between stated rules and the codebase is exactly what new contributors notice.

### 4.9 Implicit contracts with no written documentation ✅ *Resolved*

> **Resolution:** `docs/ARCHITECTURE.md` now documents the boot flow, module graph, state contracts, condition AST, action pipeline, events, hooks/decorators, and the plugin how-to; README and CONTRIBUTING link to it. The dialogue-local action switch is gone — `DialogueSystem` registers `goToConversation`/`trade`/`leave`/`makeFriendly`/`questTrigger` on the global registry, so there is one extension mechanism. Public APIs (StateManager, engine registration/event methods, condition/action handler shapes) now carry JSDoc.

These are the engine's real extension surface, currently discoverable only by reading source:

- **Condition AST** (`condition.js`): `and`/`or`/`not` plus ~8 leaf types (flag, item, gold, level, mission, customAttributes, …). Documented only inside `scene.schema.json` descriptions.
- **Action pipeline** (`actions.js` registry) — and note the split brain: dialogue-specific actions (`goToConversation`, `trade`, `makeFriendly`, …) live in a hardcoded switch in `dialogue.js:88-124`, while global actions use the registry. Two extension mechanisms, one extensible.
- **Description hooks** — `registerDescriptionHook` exists, but no list of built-in hooks; the curator hook is invisible without reading plugin code.
- **Engine events** — `on`/`off`/`emit` with no catalog of event names or payloads (e.g. `player:apSpent`, `engine.js:372`).
- **Inventory entry shape** `{item, amount}` — assumed everywhere, written nowhere.

**Recommendation:** One `ARCHITECTURE.md` (or `docs/extending.md`) covering boot flow, the five contracts above, and "how to write a plugin." Cheap to write, highest leverage for the OSS goal.

### 4.10 Smaller mediums

- **`carriedItems` mixed string/object form** is normalized ad-hoc at the read site (`dialogue.js:352-358`). Normalize once at load instead, so every consumer sees one shape.
- **Mixed event-binding idioms**: `addEventListener` in `ui.js` setup, deliberate `onclick=` rebinding in `bindItemActions` (`ui.js:158`, commented), and ad-hoc choices in chest/curator/char-creation. The onclick-rebinding trick is fine — but adopt it (or delegation) consciously and consistently, and write the rule down.

---

## 5. Low-Severity Findings

- DOM element references stored on data/config objects: `stat._decrementBtn` etc. (`char-creation.js:137-141`) — pollutes config with DOM; use a local map.
- Inline styles in curator UI (`curator.js:241-244, 336-337, 413-414`) — move to CSS classes.
- Inconsistent `??` vs `||` for defaults across systems — pick `??` for numeric/nullable defaults, note it in CONTRIBUTING.
- `JSON.parse(JSON.stringify(...))` clone in `makeDefaultState` (`state.js:41`) — fine for JSON rules, but `structuredClone` is the modern equivalent.
- Orphan comment numbering in `curator.js:157-162` (`// 1.` jumps to `// 3.`) — looks like removed code; renumber.
- `window.gameEngine` global (`engine.js:464-466`) with `utils.js:74-82` reaching back into it for translation — a hidden core→global→core cycle; pass the engine (or a `t` function) explicitly.
- Minimap cache keyed only on scene ID; `invalidateMinimap()` is only called on tab switch (`map.js:60, 108, 157`) — stale if maps ever change dynamically.
- DC escalation persists across scene re-entry (`scene.js:87-98` only initializes when the flag is absent). Plausibly intentional (anti-retry-grinding) — decide, then document the intent either way.

---

## 6. Claims Investigated and Verified OK

During the audit these suspected issues were checked and found **not** to be problems — recorded so future audits don't re-litigate them:

- **No event-listener leak in `ui.js`** — `setup()` runs once per page load; `bindItemActions` uses `onclick` assignment precisely so rebinding replaces handlers.
- **Merchant stock never renders "(xnull)"** — unlimited stock is guarded at `dialogue.js:366`.
- **`reset()` does fully clear state** — it replaces the entire state object via `makeDefaultState`, inventory included.
- **No combat double-render after victory** — guarded by the `didNavigate` scene-id comparison (`combat.js:345-350`).
- **Loot-table nulls can't reach `addToInventory`** — filtered at `scene.js:288`.
- **Save encoding is careful** — the TextEncoder/byte-loop Base64 round-trip (`state.js:103-110`, `ui.js:39-46`) correctly handles Unicode and avoids stack overflow on large saves; nice work, keep it.

---

## 7. Remediation Roadmap

### Before release

- [x] Fix all `schemas/*.json` to valid draft-07 (lowercase types, `oneOf` for `carriedItems`). *(3.1)*
- [x] Move the exhibits table out of `scene.js` into the curator plugin via the new scene-decorator API; inline styles → CSS. *(3.2)*
- [x] Fix README test badge (now count-free) and complete the test-file list; reconcile CONTRIBUTING's JSDoc rule with reality. *(4.8)*
- [x] Extract the five duplicated patterns (item label, skill roll, panel clearing, DC escalation, collection modify). *(4.1)*
- [x] Centralize flag-key builders, the `'gold'` constant, and move the curator install cost into `rules.json`. *(4.2)*
- [x] Decide and implement the `createElement` text-vs-HTML policy (text by default; documented HTML channels). *(4.5)*
- [x] Write `docs/ARCHITECTURE.md` documenting boot flow, conditions, actions, hooks, events, and the plugin how-to. *(4.9)*

### First pass after release

- [x] Load-time data validation with grouped, actionable messages; guard `addToInventory` against unknown IDs. *(3.3)*
- [x] Formal plugin lifecycle: state mutation hooks replacing `patchState`, public custom-UI open/close API replacing `_customUIOpen` writes. *(3.4)*
- [x] Split the five long functions (`renderStore`, `_render`, `scene.render`, `_validateData`, `_buildItemDiscoveryButton`). *(4.6)*
- [x] Move `downloadSave()` DOM work into the UI layer. *(4.4)*
- [x] JSDoc the public APIs (StateManager, engine registration methods, condition/action shapes). *(4.8, 4.9)*
- [x] Unify dialogue actions with the action registry. *(4.9)*

### Nice to have

- [ ] Tests for `actions.js`, `dialogue.js`, `scene.js`; jsdom smoke tests for the UI layer; curator plugin tests. *(4.7)*
- [ ] Real language selection for i18n. *(4.3)*
- [ ] Normalize `carriedItems` at load; standardize event binding and `??` usage; remaining Section 5 items. *(4.10, 5)*
