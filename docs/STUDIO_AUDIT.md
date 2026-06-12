# Code Quality Audit — Gravity Studio

*Audit date: 2026-06-12. Scope: everything under `studio/` (JS, HTML, CSS), plus its contracts with the engine's data formats. Line numbers refer to the codebase at commit `8cade2f`. Companion to [AUDIT.md](AUDIT.md), which covered the engine and explicitly excluded this directory.*

---

## 1. Executive Summary

Studio is in decent shape for a tool of its age: a clean module layout, zero dependencies, no build step, small composable DOM helpers, and a whole-object load/save model that makes it naturally tolerant of engine data-format additions (unknown fields round-trip untouched — this is why the recent audit-remediation work required almost no Studio changes). The visual editors (condition builder, dialogue graph, map) are genuinely good for ~750 lines combined.

The findings cluster differently than the engine's did. The engine's problems were polish-layer; Studio's worst problems are **correctness bugs in an editor whose one job is to not lose or corrupt authored content**:

1. **The description-block normalizer is a silent no-op for string entries** — `Object.assign` on a string primitive — so a legal-looking scene shape renders as *empty* in the editor and throws on edit. Worse, Studio's own Reset boilerplate emits exactly that shape, which the engine and schema also reject.
2. **`select()` silently displays the first option when the data's value isn't in the list** — the UI and the data disagree until the user touches the control, at which point the real value is destroyed. New items default to type `'Misc'` (not a valid type), and any plugin-registered action type hits the same trap.
3. **Persistence is half-transactional** — create/delete write to disk immediately while the index update waits for a manual save, and there is no unsaved-changes guard at all. Both halves can strand a workspace in a state the engine warns or silently drops content on.
4. **Engine contracts are hand-copied and already drifting** — Studio edits a `npcName` field the engine never reads, its boilerplate includes a `stages` field nothing consumes, and it has no awareness of plugin actions or of the engine's new headless `validate.js`, which it could reuse wholesale.

Recurring themes: data mutation during render without dirty-tracking, the same list-editor/collapsible-card UI reimplemented five-plus times, import cycles centered on `app.js`, and zero test coverage despite several extractable pure functions.

---

## 2. Architecture Overview

**Boot flow.** `index.html` loads `js/app.js` as the single module entry. `app.js` owns the global `store` (loaded files, file handles, the parsed index, dirty-set) and wires the toolbar. "Open Workspace" uses the File System Access API: the user picks the repo root, `io.js` loads `data/index.json` and every file it references into `store.files`, keyed `"type:id"` (plus `__rules`, `__index`). Forms mutate those objects in place and call `markDirty(key)`; Save serializes each dirty object back through `saveReplacer` (strips dead keys and empty `actions`/`onFailure`/`items` arrays).

**Module graph.**

```
app.js (store, save/open/reset wiring, dirty tracking)
├── io.js                workspace load/save, create/delete entries, reset boilerplate
├── ui.js                modal / confirm / toast
├── utils.js             el(), formRow(), getPath/setPath, select()
├── components/
│   ├── sidebar.js       nav tree, search, create/delete entries
│   ├── forms.js         router + item/rules/flags/mission/table forms
│   ├── scene-form.js    scene editor (description blocks, options, skills, drops, displays)
│   ├── npc-form.js      NPC editor (attributes, equipment, conversations)
│   ├── actions.js       action-pipeline editor (15-type registry)
│   └── condition-inline.js  "+ Condition" toggle wrapper
└── complex/
    ├── logic.js         visual condition AST builder (pack/unpack shorthand)
    ├── nodes.js         dialogue graph (drag nodes, drag-to-connect, BFS auto-layout)
    └── map.js           world-map view (drag scene rectangles, 5px snap)
```

**Strengths worth preserving:** zero dependencies and no build step (matches the engine's ethos); whole-object round-tripping that survives engine format additions; the condition builder's `pack`/`unpack` exactly mirrors the engine's `compare()` shorthand (verified, see §6); text-node-only DOM construction (no HTML injection path for authored data); `saveReplacer` keeping authored JSON clean.

**Structural caveat:** unlike the engine's acyclic graph, Studio has import cycles — `app.js ↔ io.js`, `app.js ↔ sidebar.js`, `app.js ↔ forms.js`. They work because usage is deferred past module init, but they're fragile to reordering; see 4.6.

---

## 3. High-Severity Findings

### 3.1 String description blocks: broken normalizer, invalid boilerplate

`scene-form.js:13` tries to normalize array-of-strings description entries in place:

```js
data.description.forEach(d => { if (typeof d === 'string') Object.assign(d, { text: d }); });
```

`Object.assign` on a string primitive coerces it to a throwaway `String` wrapper, sets `text` on *that*, and discards it — the array still holds the primitive. Consequences for a scene whose `description` is `["Some text", …]`:

- The editor renders every block's textarea **empty** (`block.text` is `undefined`, `scene-form.js:203`) — the author's text appears lost.
- Typing into the textarea throws `TypeError: Cannot create property 'text' on string` (`scene-form.js:204`; modules are strict mode), inside an event listener, so nothing is saved and no error surfaces.

This shape isn't hypothetical: **Studio's own Reset boilerplate writes it** (`io.js:226-230`, `description: ["You stand at the beginning…"]`). And it's invalid on the engine side too — `scene.schema.json` requires array items to be `{text, condition?}` objects, and `scene._resolveDescription` (`src/systems/scene.js:407`) reads `.text` off each entry, so the engine renders the boilerplate scene with an **empty description**.

**Recommendation:** Replace the in-place `forEach` with `data.description = data.description.map(d => typeof d === 'string' ? { text: d } : d)`, and fix the Reset boilerplate to emit `[{ text: "…" }]`. (The top-level `typeof data.description === 'string'` branch at `scene-form.js:8-9` is correct — only array elements are affected.)

### 3.2 `select()` silently mis-renders unknown values; the mismatch destroys data

`utils.js:48-57`: `select()` marks an option `selected` only on exact match. When the data's current value isn't in the options list, the browser displays the **first option** while the underlying data still holds the real value — UI and data disagree, and the first interaction with the control overwrites the real value with whatever's displayed. Concrete casualties:

- **New items are born invalid.** `io.js:107` defaults new items to `type: 'Misc'`, which is not in the type list (`forms.js:57`) and unknown to the engine, schemas, and `rules.itemTypeOrder`. The form displays "Weapon" while the file says `"Misc"`; the type-specific attribute fields are all hidden; the mismatch persists until the author happens to touch the type select.
- **Plugin action types are destroyed on touch.** The action editor's type select (`actions.js:36-41`) deletes *every* key except `type` when changed. An action with a plugin-registered type (e.g. the curator's `manage_exhibits`/`add_display`, `src/plugins/curator.js:162-167`) displays as "Navigate to Scene"; selecting anything wipes the original action irrecoverably.
- Same pattern, lower stakes: scene `region` when unset (`scene-form.js:37`), `startingScene` (`forms.js:183`), quest-trigger mission (`scene-form.js:134`), skill `skillCheck` when `customAttributes` changed (`scene-form.js:368`), equipment slots referencing deleted items.

**Recommendation:** In `select()`, when `currentVal` is non-empty and matches no option, prepend a disabled-styled `[currentVal, '⚠ ${currentVal} (unknown)']` option and select it. That one change fixes every call site. Separately: fix the `'Misc'` default to `'Flavour'` (or the type list's first entry), and have the action-type switch preserve unknown types behind a confirm.

### 3.3 Half-transactional persistence and no unsaved-changes guard

Two halves of the same data-consistency problem:

- **Create/delete bypass the save model.** `createEntry` (`io.js:115-135`) writes the new JSON file to disk immediately but only marks `__index` dirty; `deleteEntry` (`io.js:137-153`) removes the file from disk immediately, ditto. Close the tab without saving and you have either an orphaned data file the engine never loads (invisible content), or an index entry pointing at a deleted file (a 404 warning and a missing scene/NPC at boot).
- **Dirty edits vanish silently.** There is no `beforeunload` handler (`app.js`) — an author with twelve dirty files who closes the tab loses everything without a prompt, in an editor whose Save button is the only persistence point.

**Recommendation:** Add `window.addEventListener('beforeunload', e => { if (store.dirtyFiles.size) e.preventDefault(); })` — one line, closes the bigger hole. For create/delete, the cheap consistent option is to save `index.json` to disk in the same operation (both already touch disk anyway); full deferral of the file write is more work for little gain.

---

## 4. Medium-Severity Findings

### 4.1 Engine contracts are hand-copied and already drifting

All of Studio's knowledge of the engine's data formats is hardcoded, with no shared source and observable drift in both directions:

- **`npcName` is a dead field.** The scene skill editor offers it (`scene-form.js:382-387`) and demo data carries it (`data/scenes/dungeon/hallway.json:105`), but nothing under `src/` reads it. Either the engine lost this feature or Studio invented it; decide and reconcile.
- **`stages` is a phantom.** New missions are created with `stages: []` (`io.js:110`); no engine code, schema, or demo data mentions mission stages. The mission form doesn't edit it either.
- **The action registry is closed.** `ACTION_TYPES` (`actions.js:4-20`) matches the engine's 15 core registrations exactly (verified, §6) but can't represent plugin actions (see 3.2) and must be updated by hand every time the engine adds one — the `received` loot flag (commit `8cade2f`) is the precedent.
- Item types, equipment slots, condition leaf types, and rules fields are each duplicated in 2-3 Studio locations (`forms.js:57,67,222,471`, `npc-form.js:82`, `logic.js:4-14`).

**Recommendation:** Create one `studio/js/contracts.js` exporting the shared enums (action types + their parameter renderers' metadata, item types, slots), so drift is at least confined to one file. The stretch goal: Studio is served from the repo root, so it *can* `import` browser-safe engine modules directly — e.g. deriving slot names and item types from the schemas, or the action list from a small exported constant in `src/core/config.js`.

### 4.2 No referential integrity on rename or delete

Studio freely renames and deletes things that other data references, with no check or warning:

- Renaming a conversation node (`npc-form.js:182-191`) just moves the key; `goToConversation` actions pointing at the old id — in this NPC or rendered in the graph — now dangle. Renaming away the `start` node breaks the NPC entirely: the engine hardwires `renderDialogue("start")` (`src/systems/dialogue.js:113,151`). Studio neither protects `start` nor warns when an NPC with conversations lacks one.
- Renaming a flag (`forms.js:508-517`) leaves every `set_flag` action and `flag` condition pointing at the old name — which the engine treats as a brand-new always-false flag.
- Deleting an item/NPC/scene from the sidebar (`sidebar.js:13-29`) never checks inbound references (inventories, loot tables, `navigate` destinations, enemy lists, conditions).

The engine just grew exactly the tool for this: `src/core/validate.js` is headless and exports `validateGameData(data, knownActionTypes)` with grouped, actionable messages. Studio is served from the same origin and can import it (`../../src/core/validate.js`).

**Recommendation:** Add a "Validate" toolbar button that assembles `{items, npcs, scenes, missions, tables, rules}` from `store.files` and renders `validateGameData`'s findings in a panel. That covers deletes and renames after the fact without Studio re-implementing reference tracking. Cheap targeted extras: warn when conversations exist but no `start` node does, and confirm before renaming a node that has inbound `goToConversation` references.

### 4.3 Render-time mutation without dirty-tracking; phantom keys in saved JSON

Form renderers mutate the data object as a side effect of *displaying* it, without `markDirty`:

- `renderSceneForm` materializes `description`/`options`/`skills` arrays (`scene-form.js:7-15`), and per-card renderers add `actions`/`onFailure`/`items`/`displays` (`scene-form.js:246,376-378,598`).
- `renderNpcForm` materializes `carriedItems`/`conversations`/`attributes`/`equipment` (`npc-form.js:8-16,59,79`).
- The rules form creates `playerDefaults`, `equipment`, `charCreation`, `itemTypeOrder` on open (`forms.js:220-221,332,470`).

Two consequences: (a) merely *opening* a file then saving it for an unrelated edit writes phantom diffs — noisy git history for data authors; (b) `STRIP_EMPTY_ARRAYS` (`io.js:158`) covers only `actions`/`onFailure`/`items`, so empty `skills: []`, `options: []`, `displays: []`, `carriedItems: []` all persist.

**Recommendation:** Either normalize on a *copy* used for rendering and write through on first real edit, or — much cheaper — extend `STRIP_EMPTY_ARRAYS` with `skills`, `displays`, `carriedItems` (keep `options`: the engine expects it) and strip empty objects like `attributes`/`equipment`/`conversations` in `saveReplacer`. That makes the render-time materialization harmless on disk.

### 4.4 `_studioLayout` editor state persists into game data

Opening the dialogue graph writes node positions into the NPC object itself (`nodes.js:7,49`), and dragging a node marks the *game data file* dirty (`nodes.js:267`). `saveReplacer` strips engine-dead keys (`disposition`, `droppedLoot`) but not Studio's own `_studioLayout` (`io.js:156`) — so the first author who uses the graph and saves ships editor metadata inside `data/npcs/*.json` (none is in the repo yet; the leak is latent). The asymmetry is the smell: the replacer cleans up *other* tools' residue while depositing its own.

**Recommendation:** Decide the policy. Either add `_studioLayout` to `DEAD_KEYS` and persist layouts in `localStorage` keyed by npc id (layout survives, game JSON stays pure), or document that `_studio*`-prefixed keys are sanctioned editor metadata the engine must ignore. The first is more in keeping with the engine audit's "no editor concerns in data" spirit.

### 4.5 Duplicated UI patterns

The same widgets are reimplemented across files — the exact failure mode the engine audit's §4.1 catalogued:

| Pattern | Occurrences | Suggested home |
|---|---|---|
| Collapsible card (`let collapsed = true` + display toggle + header click with target-exclusion) | `scene-form.js:215-223, 329-337, 424-432, 646-654`, `npc-form.js:238-246, 284-292`, `sidebar.js:48-56` | `makeCollapsible(hdr, body, ignore)` in `utils.js` |
| NPC enemy list editor | `actions.js:214-232` and `scene-form.js:541-555` are line-for-line the same widget | export one from `actions.js` |
| Item + amount row list (select, ×, number, ✕, + Add) | `forms.js:241-280` (inventory), `forms.js:605-657` (tables), `npc-form.js:114-140` (carriedItems) | shared `renderItemAmountList(list, itemIds, opts)` |
| `numInput()` helper | `actions.js:208-212` and `logic.js:301-308` (slightly different semantics — one allows `undefined`, one coerces to 0) | `utils.js` |
| DC + increment input pair | `scene-form.js:390-396, 484-489`, `npc-form.js:322-331` | shared row builder |

### 4.6 Import cycles centered on `app.js`

`app.js` exports the `store` that everything imports, *and* imports `io.js`/`sidebar.js`/`forms.js`, which import it back. ES-module hoisting makes it work today because all uses are inside functions, but any future top-level use of a cyclic import breaks at load with a confusing TDZ error.

**Recommendation:** Extract `store`, `setActiveFile`, and `markDirty` into a dependency-free `store.js`; `app.js` keeps only the toolbar wiring. Every cycle disappears — `io/sidebar/forms → store ← app`.

### 4.7 Zero test coverage

The engine has 200+ headless tests; Studio has none, and its DOM-heavy style makes most of it untestable without jsdom (which the project deliberately avoids — see AUDIT.md §4.7). But real logic is trapped inside the DOM files and *is* extractable today: `pack`/`unpack`/`detectType` (`logic.js:226-295`), `autoLayout` (`nodes.js:277-314`), `saveReplacer` (`io.js:160-164`), and the normalizations from 3.1/4.3. The 3.1 bug is exactly the kind a five-line `node --test` case would have caught.

**Recommendation:** Move the pure functions into importable positions (or export them as-is — they're already side-effect-free except `detectType`'s `store` read, which can take the attribute list as a parameter) and add `tests/studio-logic.test.js` to the existing suite.

### 4.8 Sidebar rebuilds lose UI state

Every create/delete calls `renderSidebar` from scratch (`sidebar.js:25,75`): all sections re-collapse (`sidebar.js:48-50`), the search query and its filtering are wiped, and the active highlight is rebuilt. Creating three items in a row means re-expanding the Items section three times. Low-effort fix: remember expanded section titles and the search string in module-level state and reapply after rebuild.

---

## 5. Low-Severity Findings

- **Dead CSS** — `.label-above` (`studio.css:509`), `.conv-responses-hdr` (`:918`), `.card-section-hdr` (`:976`), and `.flat-item-section`/`-label`/`-fields` (`:998-1007`, self-described as "kept as alias … for backward compat" with nothing) match no JS/HTML. (`cond-node-*` classes look unused to grep but are built dynamically — keep.)
- **Inline styles in JS** despite a 1000-line stylesheet: `scene-form.js:143,179,285`, `npc-form.js:37,100`, `forms.js:349-360,403-422`. Move to classes; same call as the engine audit's §5.
- **Stale phase comments + unreachable fallback** — `forms.js:663-669` ("Visual editor coming in Phase 2") guards `renderRawJson`, which is unreachable: every key prefix is routed at `forms.js:7-13`. Either delete it or — more useful — route a deliberate "raw JSON" mode through it.
- **ID hygiene** — `addEntry` (`sidebar.js:64`) only collapses whitespace; uppercase, unicode, and dots pass through unchecked despite the `use_snake_case` placeholder (path separators only fail later, as an FS Access API error). Flag renames (`forms.js:508-517`) and node renames (`npc-form.js:182-191`) silently overwrite an existing key on collision; the flag value select also reads its initial value from a stale closure after a rename (`forms.js:519`).
- **Map view click/drag edges** — a zero-movement drag (or 1px jitter) on a scene card both swallows the click-to-open and marks the scene dirty without changes (`map.js:87-96`). Track a small movement threshold and compare positions before `markDirty`.
- **Dialogue graph** — `redraw()` runs a full `getBoundingClientRect` sweep over every connection on every `mousemove` during a drag (`nodes.js:77-147,261`); fine at demo scale, quadratic-feeling at 50 nodes. There's no way to *remove* a connection from the graph (only re-target; deletion requires finding the `goToConversation` action in the form), and node dragging doesn't snap while the map view does (`map.js:4-5`).
- **Amount inputs accept 0/negative** — clearing an amount field yields `Number('') === 0` despite `min: 1` (`forms.js:254-258`, `npc-form.js:123-124`, table weights `forms.js:628-636`); the engine's collection logic drops zero-amount entries, so authored intent silently evaporates.
- **`handleSave`'s required-field check only sees the open form** (`app.js:49-51` queries the live DOM) while saving *all* dirty files — files edited earlier escape the check.
- **`showConfirm` binds Escape but not Enter** (`ui.js:39-44`); minor keyboard-flow inconsistency with `showModal`.
- **Mission rewards leave residue** — clearing both reward fields leaves `missionRewards: {}` in the JSON (`forms.js:585-586` via `setPath` with `undefined`).

---

## 6. Claims Investigated and Verified OK

Checked and found *not* to be problems — recorded so future audits don't re-litigate:

- **Condition shorthand matches the engine exactly.** `logic.js`'s `pack`/`unpack` (bare number = `at_least`; `{op: N}` objects for the other four) mirrors `compare()` in `src/systems/condition.js:35-47` operator-for-operator, and the six leaf types + three combinators cover the engine's full condition surface.
- **The action enum matches the engine's core registry exactly.** All 15 entries in `actions.js:4-20` correspond 1:1 to `registerAction` calls in `src/systems/actions.js:101-110` and `src/systems/dialogue.js:60-85`. (Plugin-registered actions are the gap — see 3.2/4.1.)
- **`carriedItems` normalization agrees with the engine.** `npc-form.js:8-15` produces the same `{item, amount}` shape as the engine's load-time `normalizeCarriedItems`.
- **`DEAD_KEYS` strips genuinely dead fields.** Nothing under `src/` reads `disposition` or `droppedLoot` (loot moved to `onVictory` actions); stripping them on save is correct.
- **No HTML-injection path for authored data.** `el()` builds children as text nodes (`utils.js:18-21`); every `innerHTML` assignment in Studio is `''` (clearing) or a static literal. Authored strings never flow through `innerHTML`.
- **Unknown fields round-trip.** Whole-object load/save means new engine fields (`defaultLanguage`, `locales`, `rules.curator`, `received`) survive Studio edits untouched — confirmed by the data diffs from the engine-audit commits.
- **Empty-array stripping is engine-safe.** Every consumer of `actions`/`onFailure`/`items` in the engine tolerates the key's absence.

---

## 7. Remediation Roadmap

### Correctness first

- [x] Fix string description-block normalization (map, don't `Object.assign`) and the Reset boilerplate's invalid `description` shape. *(3.1)*
- [x] Teach `select()` to surface unknown current values instead of silently showing the first option; fix the `'Misc'` item default; make the action-type switch non-destructive for unknown types. *(3.2)*
- [x] Add the `beforeunload` dirty-files guard; save `index.json` as part of create/delete. *(3.3)*
- [x] Reconcile `npcName` (removed from Studio, schema, and demo data — the engine never read it) and drop `stages` from the mission boilerplate. *(4.1)*

### First pass after that

- [x] "Validate" toolbar button reusing the engine's `validateGameData`; warn on missing `start` conversation node and on renames with inbound references. *(4.2)*
- [x] Extend `saveReplacer` to strip the remaining phantom empties; add `_studioLayout` to the strip list and move graph layout to `localStorage`. *(4.3, 4.4)*
- [x] Extract `store.js` to break the `app.js` import cycles. *(4.6)*
- [x] Consolidate the duplicated list/collapsible/numInput widgets into `utils.js` (table editor kept its own rows — the weight column makes it a different widget). *(4.5)*

### Nice to have

- [x] Export the pure logic (`pack`/`unpack`/`detectType`, `autoLayout`, `saveReplacer`, normalizers) and cover it in the existing `node --test` suite (`tests/studio-logic.test.js`). *(4.7)*
- [x] One `contracts.js` for the hand-copied engine enums; `GOLD_ITEM_ID` now imported straight from `src/core/config.js`, and a test pins `ACTION_TYPES` to the engine's core registrations. *(4.1)*
- [x] Sidebar state preservation across rebuilds; the Section 5 paper cuts (graph `redraw()` perf left as-is — fine at demo scale, as noted). *(4.8, 5)*
