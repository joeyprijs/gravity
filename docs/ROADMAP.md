# Gravity — Roadmap & Build Tracker

Living tracker for the engine's strategic direction. It grew out of the capability assessment in [`exploration.md`](exploration.md) and a follow-up design discussion: rather than chase feature parity with Twine/Ink/Inform, Gravity's differentiator is the **integration story** — a real browser RPG authored as data, edited and played in one place, shipped with no toolchain. The sequencing below leans into that.

## Strategy: three phases, in order

| Phase | What | Why this order |
|---|---|---|
| **1. Workbench** | Live preview: edit in Studio, play the result instantly in the same window. | Decoupled from feature work and cheap to build. It's the tool we'll *use* to build everything else, so it pays for itself during Phase 2. |
| **2. Expand the engine** | The agreed "later list" — tactical combat, time, quest depth, etc. | This is where the schema churns. Doing it with the workbench in hand makes authoring + playtesting each feature far faster. |
| **3. Showcase & publish** | Polished side-by-side edit/play UI, onboarding, one-click publish/export. | The "expensive half" of the integration story. Worth investing once the engine is meaty and the data format has stabilised. |

The one ordering we explicitly avoid: building the whole engine expansion *before* any preview — that means authoring it all blind, the slow way.

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` done · `[-]` deliberately deferred

---

## Phase 1 — Workbench (live preview)  `[x]`

**Goal:** From Studio, open a Preview pane that runs the real engine against the **current in-memory edits** (saved *or* unsaved) and reloads on demand.

### Design

The engine fetches game data from disk on boot (`engine.js → loadData()`). Studio already holds every parsed file in `store.files`. So instead of round-tripping through disk, Studio assembles an in-memory **data bundle** and injects it into an embedded engine via `postMessage`:

1. Studio opens an iframe at `index.html?preview=1`.
2. In preview mode the engine does **not** auto-boot. It posts `gravity:preview-ready` to the parent and waits.
3. Studio responds with `gravity:bundle` — a snapshot of `store.files` shaped exactly like the engine's loaded data (`{ manifest, rules, locale, items, npcs, scenes, missions, tables, flags }`).
4. The engine boots against the injected bundle (`loadData()` returns it instead of fetching).
5. To refresh, Studio reloads the iframe; the handshake repeats and the latest bundle is sent.

This keeps the preview **decoupled from feature work** — it renders whatever data the engine is handed, so new engine features need no preview changes. Reflecting unsaved edits falls out for free because the bundle is built live from `store`.

### Build checklist

- `[x]` Engine: accept an injected data bundle (`RPGEngine(previewBundle)`), branch in `loadData()`, add `_loadFromBundle()` — backward-compatible, null in normal play. (`src/core/engine.js`)
- `[x]` Engine: `?preview=1` bootstrap — defer boot, post `gravity:preview-ready`, boot on `gravity:bundle`. (`src/core/engine.js`)
- `[x]` Studio: preview module — build bundle from `store`, manage the iframe, answer the ready handshake, reload-on-demand. (`studio/js/complex/preview.js`)
- `[x]` Studio: Preview toggle button + pane markup. (`studio/index.html`)
- `[x]` Studio: wire toggle, enable on workspace open, auto-refresh after save. (`studio/js/app.js`)
- `[x]` Studio: pane layout styles. (`studio/css/studio.css`)
- `[x]` Engine: skip character creation in preview (placeholder name) so authors land on content. (`src/core/engine.js`)

**Verification:** full suite green (252/252 `npm test`). Live browser smoke-test (headless Chrome, served over localhost) — the real `index.html?preview=1` page booted the full game from an injected real-data bundle (scene/options/skills/items/missions/quest-trigger/locale/curator-plugin all rendered); a probe with a mutated bundle confirmed **unsaved edits** render; `preview.js` loads cleanly in-browser; Studio preview markup present. The only path not automated is `showDirectoryPicker` (native dialog) — the in-memory bundle path it feeds is proven.

### How to use (once built)

1. Serve the repo over `http://localhost` (the File System Access API and ES modules already require this).
2. Open `studio/`, **Open Workspace** → the project root.
3. Click **Preview**. The pane boots to the scene you're editing and shows a validation strip. Edit a scene/item/NPC, then **Save** (auto-refreshes), hit **↻ Reload** to preview unsaved edits, or flip **Auto** to reload a moment after each edit.

### Known limitations (v1)

- External (dynamically-imported) plugins load from the served origin, not the FS-API workspace; the built-in curator works. 
- Preview uses the default-language locale only.

### Polish — required to close Phase 1

- `[x]` Debounced auto-refresh on edit — opt-in **Auto** toggle (default off, so a playtest in progress isn't reset on every keystroke); ~700ms debounce. (`studio/js/complex/preview.js`)
- `[x]` Deep-link preview to the scene currently being edited — `buildBundle` passes `store.activeFile`; engine boots there. (`preview.js`, `src/core/engine.js`)
- `[x]` Surface validation issues inside the pane — strip driven by the engine's own `validateGameData` (extracted to a shared `validate-workspace.js`), click for details. (`studio/js/validate-workspace.js`, `preview.js`)

---

## Phase 2 — Expand the engine  `[ ]`

From the agreed "later list" (see [`exploration.md`](exploration.md) → *Where it feels thin*):

- `[ ]` Tactical combat — multi-target/AoE, status effects/buffs/DoT, damage types.
- `[ ]` A sense of time — turn/day counters, cooldowns, scheduler, time-gated content.
- `[ ]` Quest depth — chained/branching objectives, failure states.
- `[ ]` Party / companions (acknowledged as complex; lower priority).
- `[ ]` Content *creation* (not just layout) inside Studio's visual map/dialogue tools.
- `[ ]` Additional shipped locales.
- `[-]` Random encounters — *deliberately deferred*; static hand-placement is a valued constraint, this is a maybe-later, not a gap.

> Game-specific concepts (e.g. a museum/curator economy) stay as **plugins**, not core-engine features.

## Phase 3 — Showcase & publish  `[ ]`

- `[ ]` Polished side-by-side edit/play layout (built on the Phase 1 workbench).
- `[ ]` Inline validation as a first-class authoring affordance.
- `[ ]` One-click publish / self-contained export.
- `[ ]` Schema as single source of truth (forms, validator, docs from one schema set).
- `[ ]` "Fork-a-starter" onboarding worlds.
