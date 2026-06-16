# Gravity — Pre-Release Code Audit

**Date:** 2026-06-16
**Scope:** Full codebase (`src/`, `studio/`, `data/`, `schemas/`, `tests/`, docs, project hygiene)
**Goal of the review:** Assess readiness to release Gravity as a free, public-domain, open-source project welcoming to both non-coders and senior engineers.
**Method:** Full read of every JS module, the example game data, schemas, and docs; `npm test` executed (232 passing); the highest-severity findings were re-verified by hand against the source.

---

## 0. Remediation Progress Tracker

Status of fixes for each finding. Updated as work proceeds.

Legend: ✅ done · 🔧 in progress · ⬜ not started · ➖ won't fix (with reason)

| ID | Finding (short) | Severity | Status |
|----|-----------------|----------|--------|
| C1 | README scratch artifact | Critical | ✅ |
| H1 | Studio reset writes incomplete index.json | High | ✅ |
| H2 | Studio save truncate-then-write window | High | ✅ |
| H3 | Schemas contradict data | High | ✅ |
| H4 | Example game never validated in tests | High | ✅ |
| M1 | Decoupling claim vs code | Medium | ✅ |
| M2 | `loadFromObject` no shape guard | Medium | ✅ |
| M3 | `addXP` infinite-loop on `xpPerLevel:0` | Medium | ✅ |
| M4 | Migration version math fragile | Medium | ✅ |
| M5 | English heuristics / hardcoded strings | Medium | ✅ |
| M6 | `MSG.GAME_LOADED` dedup by text | Medium | ✅ |
| M7 | Studio `detectType` name collision | Medium | ✅ |
| M8 | Studio node rename dangling refs | Medium | ✅ |
| M9 | `beforeunload` returnValue | Medium | ✅ |
| M10 | Missing OSS hygiene files | Medium | ✅ |
| L1 | Dead-key strip unscoped to depth | Low | ✅ |
| L2 | `setByPath` prototype-pollution guard | Low | ✅ |
| L3 | `narrative.restore()` innerHTML | Low | ➖ documented trust boundary; see notes |
| L4 | `NaN` from malformed numbers | Low | ✅ |
| L5 | `Date.now()` ID collisions | Low | ✅ |
| L6 | curator direct state access claim | Low | ✅ |
| L7 | plugin import trust / curator substring | Low | ✅ |
| L8 | example-data nits | Low | ✅ |
| L9 | .DS_Store committed / package.json thin | Low | ✅ |
| L10 | JSDoc coverage inconsistent | Low | ✅ |
| L11 | minor duplication | Low | ➖ see notes |

**Implementation notes (where a fix differs from the naive reading):**
- **M6** — The "game loaded" log line is logged with `persist=false`, so it is never written to a saved log; the `MSG.GAME_LOADED` text filter was therefore dead code *and* English-coupled. Fixed by removing the filter and the unused constant rather than inventing a semantic flag for an entry that is never persisted.
- **M7** — The Studio `detectType` correctly mirrors the engine's condition-leaf precedence; the real bug is that a custom attribute named `gold`/`level`/etc. is ambiguous *at the engine level too*. Fixed at the root cause: `validate.js` now rejects reserved attribute ids, preventing the corruption at authoring time.
- **M5 (back options)** — Replaced the English-substring heuristic with a data-driven `isBack` flag (plus the existing `return`-action check). The five demo scenes that relied on the heuristic were given `"isBack": true`, the scene schema documents it, and the Studio scene editor exposes a "Back / Exit option" checkbox.
- **H3/H4** — Schemas were corrected to match the data (`scene` now requires `region` + anyOf `title`/`name`; the dead item `id` fields and the stranger's partial `attributes` were removed from the data). `tests/data-integrity.test.js` now loads the real `data/` directory, asserts `validateGameData` returns zero issues, and checks every item/scene/NPC against its schema at the top level — wiring the previously-orphaned schemas into CI.

**Notes on deferred items:**
- **L3** — `narrative.restore()` re-injecting persisted `desc` via `innerHTML` is the documented trust model (local first-party saves are trusted). Hardened indirectly by M2's save shape-guard; sanitizing here would require treating all authored scene HTML as untrusted, which contradicts the engine's stated design. Left as documented behavior, now also spelled out in `SECURITY.md`.
- **L8 (goblin name)** — The NPC is named "Cave Goblin Guard"; the README's generic example says "Goblin Guard". No in-data reference disagrees (no scene hard-codes the name), so this is illustrative-only and was left as intentional flavor. The genuine data nits (dead `finished` field, partial merchant attributes, missing loot weights) were fixed.
- **L11** — Minor duplication (AP-refill math, `getAllFlags`) is cosmetic and was left to avoid churn beyond the audit's scope.

---

## 0a. Remediation Summary

All Critical, High, and Medium findings are resolved, along with every Low/Nit except the two documented deferrals (L3, L11) which are accepted-as-designed.

- **Tests:** 232 → **244 passing, 0 failing.** New coverage: malformed-save rejection and migration version math (`state.test.js`), `xpPerLevel`-zero guard, reserved-attribute and `xpPerLevel` validation (`validate.test.js`), malformed-range dice fallback (`dice.test.js`), nested dead-key survival (`studio-logic.test.js`), and a new `data-integrity.test.js` that validates the shipped game and its schema conformance.
- **New files:** `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `tests/data-integrity.test.js`; `package.json` fleshed out with name/version/license/repository/engines.
- **Verification:** full suite green; all edited modules pass `node --check`; all 36 data files parse; the real example game validates clean and conforms to its schemas.

---

## 1. Executive Summary

Gravity is, for an AI-generated codebase, **unusually polished and genuinely well-engineered.** The architecture is clean and honestly documented, the engine has no third-party dependencies, the example game is coherent and welcoming, and the test suite is real (232 passing assertions, no flakiness, minimal honest mocking). A senior engineer opening this repo will find a codebase they can respect; a newcomer will find a readable one.

It is **not yet release-ready**, but the gap is a focused punch-list, not a rewrite. The problems cluster in five places:

1. **A leftover scratch artifact in the README** — the single most embarrassing item; trivially fixed.
2. **Schemas that contradict the data they claim to describe** and are wired into nothing.
3. **The Studio's save/reset paths** carry real (if low-probability) data-loss risks — the highest-stakes area, since Studio writes directly to a user's files.
4. **Doc-vs-code drift** that will erode senior-engineer trust (a documented architectural invariant that the code violates).
5. **Missing open-source hygiene files** expected of a public, contribution-seeking repo.

**Overall verdict:** Strong foundation, near release-ready. Address the Critical/High items below and this is a project worth being proud of.

**Release-readiness grade: B+ — ship it after the Critical + High punch-list.**

No Critical *runtime* bugs were found in the game engine itself. The Critical items are a documentation artifact and a Studio data-loss path.

---

## 2. Genuine Strengths (verified, not flattery)

- **Architecture & documentation honesty.** `docs/ARCHITECTURE.md` was checked against the code — the boot flow, action registry, events table, and plugin extension points are all accurate. This is rare and valuable.
- **Zero dependencies, no build step.** Runs as native ES modules; tests run on Node's built-in runner. The claim in the README is true.
- **The condition AST, dice, skill-checks, and quest modules are exemplary** — small, pure, fully JSDoc'd, and unit-tested. `condition.js` and `dice.js` are model code.
- **Real test coverage of the hard parts.** State, combat math, conditions, dice, displays, reputation, char-creation, and the Studio's condition pack/unpack round-trip are all covered with meaningful assertions.
- **Deliberate XSS discipline.** Game data reaches the DOM via `textContent`/`createElement` by default; `escapeHtml()` is correct and complete; the one sanctioned HTML channel (scene description bodies) is documented. The Studio is systematically `innerHTML`-free for user data.
- **Thoughtful plugin API.** Mutation hooks, stat handlers, and migration registration give plugins real power *without* monkey-patching the singletons — and the docs say so explicitly. The curator plugin is a solid reference implementation.
- **Defensive data handling in the right spots.** Enemy templates are deep-cloned before combat; the Studio's `select()` surfaces unknown values as a disabled "⚠ unknown" option instead of silently dropping them; map drags that don't move don't mark files dirty.

---

## 3. Findings by Severity

Severities reflect impact on a *public release*. Each was assigned after weighing likelihood and blast radius; where a sub-agent's severity was moderated after hand-verification, that is noted.

### 🔴 Critical — fix before any public release

| # | Finding | Location |
|---|---------|----------|
| C1 | **Leftover scratch content in the README.** The file ends with `## This is a test` / "Let's see what Gemini does." This is the project's front page. | `README.md:489-491` |

### 🟠 High — fix before release

| # | Finding | Location |
|---|---------|----------|
| H1 | **Studio "Reset Workspace" writes an incomplete `index.json`.** The hardcoded scaffold omits `defaultLanguage`, top-level `locales`, and the `plugins` array — all present in the real manifest. A reset therefore strips locale wiring and unregisters plugins. Reset is intentionally destructive, but the manifest it leaves behind is missing config the engine and the Studio's own Validate step (which reads locales) expect. *(Verified; moderated from the sub-agent's "Critical" — reset is a deliberate user action, but the scaffold it produces is genuinely incomplete.)* | `studio/js/io.js:288-310` |
| H2 | **Studio save has a truncate-then-write corruption window.** `createWritable()` truncates the file immediately; if the write/close throws mid-stream the file is left empty or partial. Combined with the batch-save loop clearing each file's dirty flag as it goes (`app.js`), a failure on file N leaves earlier files saved, file N possibly truncated, and no per-file error isolation. Stage writes and clear dirty only after every `close()` resolves; consider write-to-temp-then-rename. | `studio/js/io.js:196-202`, `studio/js/app.js:27-32` |
| H3 | **JSON schemas contradict the shipped data and are enforced by nothing.** `scene.schema.json` requires `["name", "region"]` with `additionalProperties:false`, but every scene uses `title` (not `name`) — so all shipped scenes *fail their own schema*. `item.schema.json` has `additionalProperties:false`, but four item files carry an inline `id` — so they *fail too*. The schemas are referenced only in comments; no test, the Studio, or the runtime loads them. *(All verified directly.)* | `schemas/*.schema.json`, `data/scenes/**`, `data/items/{eldritch_eye,home_rune,sunstone_shard,wayfinder_charm}.json` |
| H4 | **The shipped example game is never validated end-to-end.** `validate.test.js` runs only synthetic fixtures; the real `data/` directory is never passed through `validateGameData()` or any schema. This is why H3's drift went unnoticed. A one-line test loading real `data/` and asserting zero issues would be a high-value regression guard for the project's showcase content. | `tests/validate.test.js` |

### 🟡 Medium — should fix; affects trust, robustness, or i18n correctness

| # | Finding | Location |
|---|---------|----------|
| M1 | **A documented architectural invariant is violated by the code.** ARCHITECTURE.md and CONTRIBUTING.md state "systems never import each other," yet `scene.js`, `dialogue.js`, and `combat.js` directly `import` `condition.js`, `dice.js`, and `skill-checks.js`. These three *are* effectively pure shared utilities — the fix is to either reclassify them (move to `core/` or relabel as utilities in the docs) or route through engine delegates. As written, code and docs disagree, which a senior reviewer will notice immediately. *(Verified.)* | `src/systems/scene.js:4-6`, `dialogue.js:4-5`, `combat.js:4`, `skill-checks.js:3` |
| M2 | **`loadFromObject` does no shape validation before replacing all state.** A save file that is valid JSON but missing `player`/`log` throws inside `migrate()` or at `parsedData.log.filter(...)`, potentially after state is partly committed. Saves are user-supplied files. Guard the shape and return a boolean so the UI can report a clean failure. *(Verified — no guard present.)* | `src/core/state.js:193-203` |
| M3 | **`addXP` can infinite-loop (browser hang) if `xpPerLevel` is 0.** `threshold = level * xpPerLevel`; a threshold of 0 makes `while (xp >= threshold)` never terminate. `validate.js` does not check `xpPerLevel > 0`. Add a guard and/or a validation rule. *(Verified.)* | `src/core/state.js:301-308` |
| M4 | **Save-version migration math is fragile.** `migrate()` derives `maxVersion` from registered plugin migrations and unconditionally writes it back, so a future-versioned save can be rewritten *backwards* and a plugin migration registered at a low version can re-run on current saves. Apply only migrations actually run and guard `from > maxVersion`. | `src/core/state.js:30-38` |
| M5 | **English substring heuristics break in localized games.** `scene.js` classifies "back" options by matching the English words "return"/"go back"/"leave"/"exit" in option text; it should rely on the `return` action type. Several plugin/curator strings and an XP "roll suffix" are also hardcoded English embedded into localized output — contradicts the project's stated "no raw strings" rule. | `src/systems/scene.js:138-143`, `src/plugins/curator.js:179,327-331`, `src/core/engine.js:266` |
| M6 | **`MSG.GAME_LOADED` log-dedup ties save semantics to an English string literal.** `loadFromObject` filters log entries by exact message text; once logs are localized, saves written in another language won't match and the dedup silently breaks. Use a semantic flag on the entry, not its rendered text. | `src/core/config.js:167-171`, `src/core/state.js:199` |
| M7 | **Studio condition `detectType` collides with custom-attribute names.** Attribute conditions are stored as `{ <attrId>: value }`; if an author names a custom attribute `flag`, `gold`, `level`, `item`, `mission`, `and`, `or`, or `not`, the type is misdetected and editing the condition corrupts the AST. | `studio/js/complex/logic.js:197,226-238` |
| M8 | **Studio node rename leaves inbound `goToConversation` refs dangling** — it only warns. A non-coder will likely confirm and silently break dialogue flow; offer to rewrite references. | `studio/js/components/npc-form.js:174-201` |
| M9 | **`beforeunload` unsaved-changes guard may not fire.** `preventDefault()` is called but `e.returnValue` is never set; some browsers require it to prompt. Risk: accidental navigation loses unsaved Studio edits. | `studio/js/app.js:130-132` |
| M10 | **Missing open-source hygiene files.** No `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, or PR template. Issue templates exist (good). Expected of a public, contribution-seeking repo. | repo root, `.github/` |

### 🔵 Low / Nits — polish; safe to defer

- **L1 — Dead-key stripping on Studio save is unscoped to nesting depth.** The `JSON.stringify` replacer drops `disposition`/`droppedLoot`/`npcName`/`_studioLayout` at *any* level. The keys are deliberately-chosen legacy names (low real-world collision risk), but a nested plugin field sharing a name would vanish silently. Scope it to the top level (or NPC-only). *(Moderated from sub-agent "High" — the chosen keys make accidental loss unlikely.)* `studio/js/io.js:173,186-193`
- **L2 — `setByPath` has no prototype-pollution guard.** Not exploitable today (only author-controlled stat paths reach it), but it's an exported general-purpose util; add a `__proto__`/`constructor` guard or document "trusted keys only." `src/core/utils.js:15-20`
- **L3 — `narrative.restore()` re-injects persisted log `desc` via `innerHTML`**, the one place save-derived content meets `innerHTML`. Safe for local first-party saves; a hand-edited/imported save is a theoretical stored-XSS vector. `src/systems/narrative.js:69`
- **L4 — Malformed authored numbers produce silent `NaN`** rather than warn-and-fallback: `parseDamage`'s range path (`"1-2-3"`, `"-3"`) and `tradeDiscount` parsing. `src/systems/dice.js:35-42`, `src/systems/dialogue.js:65-67`
- **L5 — `Date.now()`-based ID generation** can collide within a millisecond (`addDisplayToScene`, Studio display IDs). Use a counter or `crypto.randomUUID()`. `src/core/state.js:509`, `studio/js/components/scene-form.js:597`
- **L6 — `curator.js` reads/writes `gameState.state.*` directly** while its own header claims it goes "through the formal StateManager API." Reconcile the claim or the code. `src/plugins/curator.js:40-43,88-103`
- **L7 — Plugin `import()` trusts arbitrary manifest URLs**, and the curator fast-path keys off `url.includes('curator.js')` (substring-fragile). For a community-content future this is the main supply-chain surface; document the trust boundary and consider same-origin enforcement. `src/core/engine.js:78,87-93`
- **L8 — Example-data nits:** mission `escape_dungeon.json` carries a dead `"finished"` field; goblin NPC `name` ("Cave Goblin Guard") disagrees with the README/scene text ("Goblin Guard"); `basic_loot.json` omits the `weight` field the README advertises.
- **L9 — `.DS_Store` files are committed** despite being in `.gitignore`; `git rm --cached` them. `docs/IDEAS.md` describes unshipped features without labeling itself aspirational. `package.json` lacks `name`/`version`/`license`/`repository`/`engines`.
- **L10 — JSDoc coverage is inconsistent.** Excellent in `condition.js`/`dice.js`/`state.js`/`i18n.js`; absent (only `//` comments) on public methods in `scene.js`/`narrative.js`/`quests.js`/`actions.js` and most Studio form renderers. CONTRIBUTING requires JSDoc on public APIs.
- **L11 — Minor duplication** across modules (AP-refill math in `combat.js`; `getAllFlags` in both `actions.js` and `studio/logic.js`; world-size defaults in two Studio files; dirty-selector logic in three places).

---

## 4. Findings by Area

**Engine core (`src/core/`)** — The strongest part of the codebase. Clean delegate/event design, excellent JSDoc on the public API, no circular imports. Issues are robustness against hostile/malformed *save* input (M2, M4), one bad-data hang (M3), and the English-literal log coupling (M6). No critical bugs.

**Game systems (`src/systems/`)** — Logic is correct; no infinite loops, off-by-one, or AST bugs found in normal authored content. The headline issue is the documented-decoupling violation (M1). `condition.js`, `dice.js`, `skill-checks.js`, `quests.js` are model modules. Weakest on consistency: the English back-button heuristic and curator raw strings (M5), plus `NaN` robustness (L4).

**Studio IDE (`studio/`)** — The highest-stakes area because it writes directly to the user's files, and the place most worth hardening. Save/reset robustness (H1, H2, M9) and the condition-name collision (M7) are the real risks; the node-rename dangling refs (M8) is a likely-to-be-hit footgun for non-coders. Genuinely XSS-safe and otherwise well-structured.

**Example data (`data/`)** — Coherent, complete, welcoming; all manifest references resolve; the "loot on actions" and `received:true` semantic-flag patterns are used correctly. Only nits (L8) and the schema mismatches surfaced via H3.

**Schemas (`schemas/`)** — The weakest artifact. Orphaned, partial (no schema for rules/manifest/missions/tables), and contradicting the data (H3). Either wire them in (editor `$schema`, or generate from `validate.js`) or remove them — leaving authoritative-looking files that enforce nothing and disagree with reality is worse than not shipping them.

**Tests (`tests/`)** — Real and trustworthy: 232 passing, ~430 assertions, no over-mocking. Honest about the UI/render gap. The one meaningful hole is that the shipped game is never validated (H4); world map, narrative log, and engine boot/plugin loading are also untested.

**Docs & hygiene** — ARCHITECTURE.md is excellent and accurate. CONTRIBUTING is actionable. LICENSE matches the README badge (Unlicense). Blockers are the README artifact (C1), the decoupling claim drift (M1), and the missing community files (M10).

---

## 5. Recommended Punch-List (prioritized)

**Before tagging a release:**
1. Delete `README.md:489-491` (C1).
2. Fix `resetWorkspace` to preserve/merge `defaultLanguage`, `locales`, and `plugins` (H1).
3. Harden the Studio save path: stage writes, clear dirty only after `close()` succeeds, report per-file failures (H2).
4. Resolve the schemas: regenerate from `validate.js` / fix `name`↔`title` and the `id` field, and wire them into a test — or delete them (H3).
5. Add a test that runs the real `data/` through `validateGameData()` and asserts zero issues (H4).
6. Reconcile the "systems never import each other" claim with the code (M1).

**Strongly recommended (robustness & trust):**
7. Shape-guard `loadFromObject`; guard `addXP`/`xpPerLevel`; fix the migration version math (M2–M4).
8. Replace English-string heuristics and hardcoded strings with action-type checks / locale keys (M5, M6).
9. Studio: guard condition-name collisions, offer ref-rewrite on node rename, set `beforeunload` `returnValue` (M7–M9).
10. Add `CODE_OF_CONDUCT.md`, `SECURITY.md`, a PR template, and flesh out `package.json` (M10, L9).

**Polish (post-launch is fine):** the Low/Nit list — prototype-pollution guard, `NaN` fallbacks, ID generation, JSDoc gaps, `.DS_Store` cleanup, de-duplication.

---

## 6. Notes for the Two Target Audiences

**For non-coders** the project is in good shape: the data format is consistent and documented, the example game teaches by example, and the Studio is approachable. The risks that matter most to *them* are the ones that can silently lose their work — which is exactly why H1, H2, M7, and M8 (all Studio save/edit paths) are prioritized above cosmetic engine nits.

**For senior engineers** the code will earn respect, but credibility hinges on internal consistency. The decoupling-claim violation (M1), the schemas that fail their own data (H3), and the un-validated showcase content (H4) are the items a reviewer will catch in the first hour — fixing them removes the "looks polished but doesn't hold together under inspection" risk.

---

*This audit reflects the state of the repository on 2026-06-16. Line numbers may shift as the code evolves; treat them as starting points, not permanent addresses.*
