# Area Loading Plan

Load the world in parts, the way BG3 loads regions. Boot loads a small world
index plus the player's current area. Crossing into another area loads that
area. The action pipeline stays synchronous — the async boundary sits at the
area border, never inside `runActions` → `navigate` → render.

## Vocabulary

- **Region** stays what it is today: the fine-grained `region` field on scenes
  (`village`, `village_store`, …) that drives ambience, map grouping, and flags.
- **Area** is the new load unit: one scene directory under `data/scenes/`
  (`dungeon`, `player_home`, `village`). An area holds several regions.
  The directory tree already encodes this grouping — no new authored field.

## Constraints honored

1. `SceneRenderer.render` and the action pipeline stay sync (the 2026-07-17
   decision, `docs/ARCHITECTURE.md:178`). Async happens only in
   `engine.renderScene` before render starts, and only for a non-resident scene.
2. Authoring stays one file per entity. Bundles are build artifacts.
3. No eviction. A loaded area stays resident. Even a full country is tens of
   MB of plain objects; eviction adds re-fetch bugs for no felt benefit.
4. Items, tables, missions, flags, rules, locales stay global at boot. They are
   small (items: 6 KB total). Only scenes and NPCs load per area — together
   they are ~97% of content bytes.

---

## Phase 1 — Generate the world index

**Change `scripts/generate-manifest.js`** to also emit `data/world.json` and
write `"world": "data/world.json"` into the manifest.

Shape:

```json
{
  "areas": {
    "village": { "scenes": ["village_square", ...], "npcs": ["alder_frey", ...] }
  },
  "scenes": {
    "village_square": {
      "area": "village",
      "region": "village",
      "name": "...", "title": "...",
      "interior": false,
      "mapDefinitions": { "top": 0, "left": 0, "width": 0, "height": 0, "background": "..." },
      "exits": ["village_north_road", ...]
    }
  }
}
```

- Per scene, copy exactly the fields the map and option classifier read:
  `name`, `title`, `region`, `interior`, `mapDefinitions`, plus `area` and
  `exits`. Omit absent fields. `exits` = every `navigate` destination found by
  a recursive walk of the scene's options/actions (same walk
  `sceneNavigationTargets` does at `src/world/map.js:14-25`, but build-time).
- **NPC → area assignment:** recursively walk each scene's JSON and collect
  every `npc` value (dialogue actions) and every `enemies` array (combat,
  autoAttack, onVictory, timers). An NPC referenced from scenes in two areas
  is listed in both. An NPC referenced nowhere: honor an optional `"area"`
  field on the NPC file, else print a warning and list it in every area
  (safe default; the warning is the fix signal).
- The existing `--check` mode compares `world.json` too, so CI
  (`.github/workflows/test.yml`) fails on a stale index.

**Verify:** run the generator; inspect `data/world.json`; `--check` passes;
one generator test asserts index shape, exit extraction, and NPC assignment
(including the multi-area and unreferenced cases).

## Phase 2 — Map and option classifier read the index

Land this while everything is still eager-loaded — behavior must not change,
which makes it safely verifiable in isolation.

**`src/world/map.js`:** add one lookup helper on `MapManager`:

```js
_entry(id) — world.scenes[id] ?? projection of engine.data.scenes[id]
_allEntries() — world.scenes ∪ resident scenes not in the index
```

The fallback covers runtime-injected scenes (curator museum rooms,
`src/plugins/curator.js:405`), which are never in the generated index.
Then repoint:

- `sceneNavigationTargets(scenes[id])` uses → index `exits` (`map.js:320`)
- `_outdoorKnowledge` destination classification (`map.js:318-323`) → `_entry`
- `_buildingRooms` full scan (`map.js:339`) → `_allEntries`
- `_visitedMapScenes` full scan (`map.js:430`) → `_allEntries`
- `_interiorKeyOf` (`map.js:381`) → `_entry`

**`src/systems/scene.js:241-251`:** `navTargets` reads destination scene
bodies only to ask `isInteriorScene(dest)`. Answer it from the index entry
(`interior` + `region`) with the same resident fallback, so Entrances/Exits
classification survives a non-resident destination in Phase 3.

**`src/core/validate.js:231`:** resolve `navigate` destinations against
`ctx.scenes` ∪ the index, so a partial world stops producing false
"unknown destination" errors. The whole-world check lives in
`tests/data-integrity.test.js`, which loads every file in Node — CI keeps
full coverage.

**Verify:** full Node suite green with zero behavior change; browser smoke
test; walk the village, open minimap + world map, enter a building, build a
museum room and see it drawn (exercises the fallback).

## Phase 3 — Lazy area loading

**Loader (`src/core/engine.js`):**

- `loadData()` fetches manifest, locales, `world.json`, and the global
  categories (items, tables, missions, flags, rules). `data.scenes` and
  `data.npcs` start empty. Store the index as `this.world`; track
  `this._loadedAreas = new Set()`.
- New `async loadArea(areaId)`: resolve the area's scene/NPC ids via
  `world.areas[areaId]`, skip already-resident ids, fetch each id's path from
  the manifest maps with the existing `fetchJson`, `Object.assign` into
  `data.scenes` / `data.npcs`. Run `normalizeCarriedItems` on the new NPCs
  (today it runs once at `engine.js:235`). Emit a `world:areaLoaded` engine
  event. Re-run `_validateData()` (dev console tooling; duplicate reports on
  later loads are acceptable). Concurrent calls for the same area must share
  one in-flight promise.
- New `async ensureSceneLoaded(sceneId)`: no-op when resident; else
  `loadArea(world.scenes[sceneId].area)`.
- `init()`: after `state.init(...)`, `await ensureSceneLoaded(state.getCurrentSceneId())`
  before `_startGame` / char creation. `init` is already async.

**The one async seam — `engine.renderScene` (`engine.js:453`):**

```js
if (!this.data.scenes[sceneId] && this.world?.scenes[sceneId]) {
  // travel beat in the log, then render when the area arrives
  return this.ensureSceneLoaded(sceneId).then(() => this.renderScene(sceneId, opts));
}
```

Every cross-area entry funnels through here: the `navigate` action
(`actions.js:151`), the teleport item (`items.js:64`, home rune from the
dungeon), and combat victory navigation. Same-area navigation never takes
this branch and stays fully sync.

**Prefetch makes the async branch rare:** on `scene:entered`, look up the
current scene's `exits` in the index; for each exit whose area is not loaded,
fire `loadArea` without awaiting. You can only stand at a border by being in
the neighbor area, so in practice the crossing is resident by click time.
The awaited branch remains the slow-network / missed-prefetch fallback.

**Save restore (`src/ui/ui.js:557` `_applyLoadedSave`):** after
`loadFromObject` succeeds, `await engine.ensureSceneLoaded(state.getCurrentSceneId())`
before `restoreScene`. The method goes async; both callers (Load button, char
creation screen) must tolerate that.

**Curator (`src/plugins/curator.js` room sync at `:395-410`):**
`buildRoomScene` reads the hall scene body, which may not be resident when a
save loads elsewhere. Guard the sync on the hall being resident, and re-run it
on `world:areaLoaded`. Known cosmetic limit: while `player_home` is unloaded,
dynamically built museum rooms are absent from the world-map footprint (the
static home rooms in the index still draw the building).

**Pipeline-ordering guard:** an authored pipeline with actions *after* a
cross-area `navigate` would run them before the deferred render. Add a
validate.js warning: a `navigate` whose destination lies in another area
must be the final action of its pipeline. The generator knows both areas, the
validator knows the index — cheap to check, and it turns the one real
ordering hazard into an authoring error.

**Verify:**
- New Node tests (fixtures with a two-area world): boot loads only the start
  area; cross-area `renderScene` loads then renders; same-area navigation
  never fetches; save restore into an unloaded area works; concurrent
  `loadArea` dedupes; the new validator warning fires.
- Existing suite green (loader tests gain `world.json` fixtures).
- Browser: fresh boot, network tab shows no village/dungeon fetches until
  entry; walk home → village → dungeon; save in dungeon, reload, load save —
  restores into the dungeon with home/village unloaded; museum still works
  after walking home.

## Phase 4 — Bundle transport (release form)

Orthogonal to laziness: it only changes *how many requests* one `loadArea`
costs (per-file: ~40 for the village; bundled: 1).

- Generator flag `--bundles`: write `data/bundles/<area>.json` as
  `{ "scenes": {id → def}, "npcs": {id → def} }` and set
  `"bundles": { area: path }` in the manifest.
- `loadArea` prefers `manifest.bundles[areaId]` (one `fetchJson`) over the
  per-id maps.
- The demo keeps per-file mode — editing a scene JSON must not require a
  regeneration step. Bundles are for release builds; one test boots from a
  generated bundle manifest to keep the path covered.
- While here, resolve a doc discrepancy found during research: `README.md:119`
  and `docs/ARCHITECTURE.md:178` document an *array* bundle form that
  `loadCategory` (`engine.js:205-213`) never implemented — an array category
  would load as keys `"0","1",…`. Fix the docs (or implement the form) as
  part of documenting bundles properly.

**Verify:** generate bundles; boot the demo from a bundle manifest; suite
green; request count at boot ≤ ~10 plus the start area's bundle.

## Docs

Update `docs/ARCHITECTURE.md:178` — region-lazy loading stops being a
non-goal; describe the area model, the single async seam, and why the pipeline
stays sync. Document `data/world.json` and the NPC `area` override field.

## Decisions taken (and their alternatives)

- **Area = scene directory.** Zero new authored fields; the tree already
  groups this way. Alternative (an `area` field per region) adds authoring
  surface for nothing at current scale.
- **Async seam in `engine.renderScene`, not in `handleNavigate` or a
  `getScene` accessor.** One funnel catches navigation, teleports, and
  victory routing; `getScene` would cascade async through the whole pipeline
  (rejected 2026-07-17, stays rejected).
- **No eviction, flags/items/missions stay global, NPCs duplicate across
  areas when shared.** All three trade a little memory for a lot of
  simplicity.
- **Runtime validation goes incremental; whole-world validation lives in CI**
  (`data-integrity.test.js` already loads every file in Node).

## Order and size

Each phase lands and ships independently; the demo behaves identically after
Phases 1–2, which is what makes them safe to verify. Rough sizes: Phase 1
~120 lines in the generator + test; Phase 2 ~60 lines touched; Phase 3 the
real one, ~150 lines across engine/ui/curator/validate + tests; Phase 4 ~80.
