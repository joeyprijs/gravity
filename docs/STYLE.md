# Gravity Style Guide

The binding conventions for this repository — code, comments, game data, and documentation. Rules are stated as imperatives; when a rule and existing code disagree, one of them is a bug. Machine-checkable rules are enforced by CI (marked **[CI]**); the rest are enforced by review.

The test for every rule here: it must describe what the codebase actually does. Don't add aspirational rules — change the code first, then the rule.

---

## 1. Code

### Language & platform

- Vanilla JavaScript, native ES Modules. No build step, no transpiler, no dependencies — `npm install` must remain unnecessary forever. **[CI]** (the suite runs dependency-free)
- Target modern evergreen browsers and Node ≥ 18. Use the platform (`Intl`, `structuredClone`, `crypto`, optional chaining) before writing a helper.
- Pure modules (`dice.js`, `time.js`, `condition.js`, `i18n.js`, `validate.js`) must stay DOM- and engine-free so they run directly under `node:test`. If a change would make one touch `document` or the engine, the change belongs elsewhere.

### Formatting

- 2-space indentation, semicolons always.
- Double quotes for `import` specifiers; single quotes for all other strings; template literals for interpolation.
- No trailing whitespace.
- Section dividers inside a file are box-drawing rules padded toward column 78:

  ```js
  // ── World clock & timers ──────────────────────────────────────────────────
  ```

### Naming

- `PascalCase` classes, `camelCase` functions and methods, `UPPER_SNAKE_CASE` module constants, `_underscorePrefix` for private methods and fields. The underscore *is* the visibility marker — nothing else (no `#`, no `@private`).
- Registry constants live in `core/config.js` and are the only way to spell their strings in JS: CSS classes (`CSS`), element ids (`EL`), action types (`ACTIONS`), flag keys (`FLAG_KEYS`), check-state keys (`CHECK_KEYS`), log labels (`LOG`), mission statuses (`MISSION_STATUS`), item types (`ITEM_TYPES`). An inline `'scene-options'` or `'skill_dc_' + x` in a module is a defect: a typo would silently mint a new key.
- Author-facing vocabularies that also appear in game data (action types, item types, equipment slots) get a *validation* safety net in `validateGameData`, not just a constant — data files can't import constants, so a boot-time check is what catches an author's typo. Adding a new such vocabulary means adding its check.

### Architecture rules

- **State:** every mutation goes through a `StateManager` method. Subsystems reach state as `engine.state`; only `engine.js` imports the singleton. Never hand out or mutate raw state from outside — add a method.
- **Mode:** exactly one surface owns the interactions panel. All transitions go through `engine.setMode()`; all reads go through the facades (`inCombat`, `inDialogue`, `inCustomUI`, `isGameOver`). Never add a per-subsystem "am I open" boolean.
- **Decoupling:** stateful subsystems never import each other — they communicate through `engine.*` delegates or events. Pure helpers are importable by anyone. Events are notifications; control flow is an explicit call.
- **Actions:** a handler owns exactly one side effect. Navigation is its own `navigate` action, never a hidden consequence of another handler.
- **Notification discipline:** mutations notify with the narrowest hint that covers them; `setFlag`/`setCheckState` deliberately don't notify (their callers drive the re-render). Batch multi-stat writes through `modifyPlayerStats`.
- **No speculative flexibility.** No options, hooks, or abstractions without a second real caller. The registries exist because plugins are real; nothing else earns one in advance.

### Strings & the DOM

- Every player-facing string resolves through `engine.t(key)`. No English sentence fragments assembled in code: lists join via `formatList` (`Intl.ListFormat`), plural-sensitive messages pick a `…One` key variant via `isOne` (`Intl.PluralRules`).
- Game data renders through `textContent` (`createElement`). `innerHTML` is reserved for engine-authored templates and scene description bodies; any dynamic value embedded there passes through `escapeHtml()`.

### Errors

- Bad *data* degrades gracefully: `console.warn('[Gravity] <where>: <what> — <consequence>')` and a no-op, plus a `validateGameData` rule so authors hear about it at boot.
- Bad *programming* fails loudly: throw on contract violations that would corrupt state silently (e.g. migration version collisions).

---

## 2. Comments

### Language & voice

- American English (`behavior`, `initialize`, `serialized`, `centralized`).
- Full sentences, sentence case, terminal periods. Em dashes are fine.
- A comment states a **constraint, invariant, or reason the code can't show** — ordering requirements, why a guard exists, what would break without it. Never a restatement of the next line, and never commentary about the change that introduced it ("now uses", "refactored to", "was previously"). Comments describe the present.
- A stale comment is a bug. Updating behavior without updating its comments is an incomplete change.

### Structure

- **Module and class headers** are `//` blocks: what the module owns, in two to six lines.
- **Exported functions and public methods** get JSDoc: a first line saying what it does, then `@param {type} name - Description.` (with the dash) and `@returns` where the shape isn't obvious. Skip JSDoc where a signature is self-evident (trivial getters, delegates).
- **Private (`_`) methods and inline notes** use `//` blocks — substantive, but no JSDoc scaffolding and no `@private` tag.
- Long files group related members under `// ── Section ──…` dividers.

---

## 3. Authoring (game data)

### Format **[CI]**

- Every file under `data/` is canonical expanded JSON: 2-space indent, one property per line, nothing inlined. `node scripts/format-data.js` produces the form; CI rejects deviations.
- The manifest's file maps are generated — run `node scripts/generate-manifest.js` after adding files; never edit the maps by hand. **[CI]**

### Identifiers

- All ids and flags are `snake_case`: `cellar_key`, `door_unlocked`, `escape_dungeon`. Filenames match their id (`cellar_key.json`).
- Scene ids carry their region prefix and declare it in a top-level `"id"` field (`"id": "home_kitchen"` in `data/scenes/player_home/kitchen.json`).
- Flags are *semantic facts*, not display text: name what is true about the world (`guard_distracted`), never what the UI should say. Player-facing wording lives in authored prose fields and locale files.
- The engine owns the prefixes `merchant_stock_`, `trade_discount_`, `friendly_`, `passive_done_`, `xp_awarded_` (flags) and `skill_dc_`, `dialogue_dc_`, `dialogue_resolved_` (check state). Never author keys with these shapes.

### Content rules

- Loot is authored on the encounter (`onVictory` pipelines, discovery `items`, loot tables) — never on the NPC. NPC definitions stay reusable across encounters.
- Mechanical item stats live inside `attributes`; accuracy belongs to the wielder (`attackAttribute`), never to the weapon.
- Anything tone-opinionated (retry currencies, time pressure, AP economies) must be opt-in through `rules.json` — a game that omits the block gets classic behavior. The engine stays tone-neutral; the demo is deliberately a kitchen sink.
- A repeatable check that rewards loot must retire itself (`resolveOnce`, or a flag its own success sets) — the validator flags farmable checks.
- Ship clean: boot the game and fix every `[Gravity]` validation warning; `npm test` runs the same checks over the shipped data. **[CI]**

Check design (tiers, budgets, retry costs, the clock) has its own guide: [`CHECKS.md`](CHECKS.md).

---

## 4. Documentation

### Where things go

- `README.md` — orientation and the authoring essentials. The map, not the territory.
- `docs/ARCHITECTURE.md` — contributor contracts: boot flow, state, the mode machine, events, hooks, the plugin surface.
- `docs/CHECKS.md` — the check-authoring guide.
- `docs/ACTIONS.md` — the action-pipeline reference.
- `docs/STYLE.md` — this file.
- Authoring and reference guides may be added as the surface grows (a vocabulary deep enough to need its own page earns one — `CHECKS.md` and `ACTIONS.md` did). But **no roadmaps, changelogs, or archives**: git history is the record, and docs describe only what exists today.

### Writing rules

- Present tense, current behavior. A doc that says "will" or "used to" is describing the wrong version of the engine.
- Docs change in the same commit as the behavior they describe.
- JSON examples follow the same canonical expanded form as the data files. The one exception: single-line leaf shapes inside markdown tables, where cells can't hold blocks.
- Known deferrals are documented where the tradeoff lives, stated with the reason *and* the trigger to revisit ("revisit if saves exceed…") — never as a bare TODO.
- Every code identifier in prose is backticked; internal links are relative.

---

## Enforcement summary

| Check | Command | CI |
|---|---|---|
| Unit + data-integrity tests | `npm test` | ✔ |
| Manifest in sync with data tree | `node scripts/generate-manifest.js --check` | ✔ |
| Canonical data formatting | `node scripts/format-data.js --check` | ✔ |
| Browser UI smoke test | open `tests/smoke.html` | manual |
| Everything else in this guide | review | — |
