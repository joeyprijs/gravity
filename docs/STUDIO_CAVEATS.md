# Known Caveats — Gravity Studio

*Last updated: 2026-06-12, after completing the Studio audit remediation (commits `80c2942`..`2f7bf1a`). This document records the limitations and accepted trade-offs that survived that work, so they can be referenced — and re-evaluated — later. It is the durable successor to the (since removed) audit documents.*

These are not bugs. Each entry is a deliberate ceiling: the current behavior, why it was accepted, and what would change the calculus.

---

## 1. The form layer is untested

The 22 cases in `tests/studio-logic.test.js` cover Studio's pure logic (condition shorthand, graph layout, save stripping, normalizers) plus a contract-drift test. The bulk of Studio's code — the DOM-coupled form wiring in `components/` — is verified only by use. A bug that mutates data incorrectly inside an event listener can still hide there.

**Why accepted:** the project is deliberately dependency-free; testing DOM wiring would require jsdom or a browser harness (the engine audit made the same cut, AUDIT.md §4.7). The mitigation is a pattern, not a framework: logic gets extracted into importable pure functions and tested that way. Studio's modules import cleanly under plain Node, so extraction is always cheap.

**Re-evaluate when:** a form-layer regression actually ships, or a contributor unfamiliar with the codebase starts editing forms.

## 2. In-place mutation blocks undo/redo

Forms mutate `store.files` objects directly and call `markDirty(key)`. Simple, fast, and the whole-object round-trip model falls out of it for free — but there is no command layer, so undo/redo cannot be retrofitted cheaply. A mis-click that deletes a scene option is only recoverable by not saving.

**Why accepted:** an undo system means either a command/patch architecture or immutable snapshots, both structural rewrites of every form. Not justified yet.

**Re-evaluate when:** Studio gets regular authoring use. Undo is the first thing an author will miss. This is the single biggest structural investment on the list — if it happens, do it before the form surface grows further.

## 3. Two of three contract enums have no drift test

`ACTION_TYPES` in `studio/js/contracts.js` is pinned to the engine's `registerAction` calls by a test; if the engine adds an action, the suite fails. `ITEM_TYPES` and `EQUIPMENT_SLOTS` are hand-maintained in the same file with no equivalent guard — they drift silently if the engine's schemas change.

**Why accepted:** they change far less often than actions, and deriving them from `schemas/*.schema.json` requires agreeing that the schemas are the source of truth (today they describe, rather than define, the formats).

**Re-evaluate when:** either enum changes for the first time, or schema-driven validation lands engine-side.

## 4. No multi-tab / multi-writer protection

Two Studio tabs open on the same workspace will clobber each other: last save wins per file, and neither tab learns the other exists. The File System Access API offers no locking.

**Why accepted:** single-author tool, and the failure needs two simultaneous editors of the same workspace. The `beforeunload` guard and transactional index updates protect against the common single-tab hazards.

**Re-evaluate when:** more than one person authors the same campaign. A cheap first step would be a lock file or a `BroadcastChannel` heads-up between tabs of the same origin.

## 5. Plugin action discovery is a regex scan

At workspace load, Studio scans workspace `.js` files for `registerAction('name')` / `registerDescriptionHook('name')` string literals (`io.js`). The curator plugin registers with literals, so this works today — but an action registered with a computed name, or from outside the workspace folder, is invisible to the scan. Such actions still round-trip safely (the editor surfaces them as `⚠ unknown` and confirms before destroying), but Validate will flag them as unknown types.

**Why accepted:** the engine registers actions at runtime; without executing plugin code, a static scan is the honest option, and the unknown-value UI makes the failure mode loud rather than destructive.

**Re-evaluate when:** a plugin legitimately needs computed action names — at that point, consider a declarative manifest (plugin lists its action names in `index.json`).

## 6. Validation is after-the-fact, not referential integrity

Deleting an item/NPC/scene, or renaming a flag, does not check inbound references at the moment of the edit; the Validate button finds the dangles afterwards (renaming a conversation node is the one case with an inline warning, since the engine hard-wires the `start` node). Validate reuses the engine's `validateGameData`, so Studio and engine can never disagree about what's broken.

**Why accepted:** live reference tracking means Studio re-implementing reference semantics the engine already owns — exactly the hand-copied-contract problem the remediation removed. One shared validator, run on demand, was the better trade.

**Re-evaluate when:** authors routinely delete/rename late in a project and the Validate-after workflow proves too easy to forget. A cheap middle ground: run Validate automatically before Save and show a count.

## 7. Dialogue-graph layouts don't travel with the repo

Node positions live in `localStorage` keyed by NPC (`gravity-studio:layout:<key>`), not in the data files. A fresh clone or another machine falls back to the BFS auto-layout; hand-arranged layouts are per-browser.

**Why accepted:** the alternative — editor state inside game JSON — is what the audit classified as a leak and the remediation removed (`_studioLayout` is stripped on save). Pure game data won.

**Re-evaluate when:** layouts represent real authoring effort worth sharing. The sanctioned path would be a separate, gitignored-or-not `studio/.layouts.json`, never the game data files.

## 8. Known scale ceilings

The dialogue-graph redraw is one reflow per animation frame regardless of connection count, fine well past 50 nodes. The next ceilings, in likely order of appearance on very large projects:

- **Workspace load** reads every data file up front and scans all workspace JS for registrations — O(project size) at open, serial fetches.
- **Sidebar rebuilds** from scratch on create/delete (state is preserved, the DOM is not) — O(entries) per rebuild.
- **Graph redraw** rebuilds all SVG paths per frame during a drag; per-edge in-place updates are the next lever if profiles ever show it.

**Why accepted:** all are O(project) with small constants; none has a measured problem.

**Re-evaluate when:** a real campaign makes opening a workspace or dragging a node feel slow — profile first, the fixes are localized.
