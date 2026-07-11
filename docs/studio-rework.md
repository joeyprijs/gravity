# Studio Rework — from schema mirror to authoring tool

Studio grew as a 1:1 mirror of the engine's JSON schema: every field became a
form row, every entity starts as an ID prompt and an empty form. That makes it
an expert tool by construction — using it requires holding the engine's data
format in your head. This rework inverts the mental model: authors think
"a place, what you can do there, where it leads", and the tool writes the
schema for them. The raw forms and the Edit-as-JSON toggle stay as the expert
escape hatch throughout — no big-bang rewrite, Studio stays usable every day.

## What stays (confirmed solid)

- `io.js` — File System Access layer, save discipline, dead-key stripping
- `store.js` — state + dirty tracking
- `validate-workspace.js` + the engine's own `src/core/validate.js`
- `contracts.js`, `utils.js`, `ui.js` primitives
- `logic.js` (condition builder), `check-fields.js` (outcome tiers)
- `preview.js` — the live-preview iframe bridge (real engine, unsaved edits,
  scene deep-links). This is the killer approachability feature and it
  already works; the rework promotes it rather than builds it.

## The rework layer

`forms.js`, `scene-form.js`, `npc-form.js`, `actions.js`, and the sidebar's
creation/navigation model.

## Five moves

1. **Task-shaped creation.** Guided "New Scene / New NPC / New Item" flows:
   author supplies a title/name and intent; IDs are slugged automatically;
   implicit contracts are handled by the tool (dialogues get their `start`
   node, new entities offer "reachable from" cross-linking).
2. **One "choice" concept in the scene editor.** Rebuild the scene form in
   player-order (what they read → what they can do), each choice one card:
   go somewhere / talk to someone / attempt a check / custom pipeline.
   Collapses the options-vs-skills split and the four check shapes into one
   flow. Exotica (timers, AP costs, resolveOnce, budgets) folds behind
   "Advanced" per card.
3. **Map becomes home.** Create scenes on the canvas, connect by dragging
   (writes navigate options), click to edit. Same for the dialogue graph:
   add nodes and edit text in the graph.
4. **Preview always on.** The play pane is the default state, auto-refresh
   on — authors see the game as they type.
5. **Escape hatch preserved.** Raw JSON toggle and expert forms remain.

## Phases

- **Phase 1 — creation flows + preview by default.** [SHIPPED]
  - `showFormModal` multi-field modal primitive
  - Guided New Scene (title→slug ID, region, first description, optional
    "reachable from" scene that gains a navigate option)
  - Guided New NPC (name→slug, greeting text, auto `start` node with a
    Farewell/leave response, optional "reachable from" scene that gains a
    Talk-to option)
  - Guided New Item (name→slug, kind template with sensible mechanics
    defaults per type)
  - Preview pane opens automatically after workspace load, auto-refresh on
- **Phase 2 — scene editor rebuilt** around the unified choice card. [SHIPPED]
  - One Choices list: go somewhere / talk to someone / attempt a check /
    custom, detected from existing data (one-action navigate → go, one-action
    dialogue → talk; skills[] entries → check) so every scene round-trips
  - Check cards pick a style (roll vs DC / search for items / narrative
    beat) that fronts the relevant editor; nothing is deleted on switch
  - Go/talk cards front only their destination; option extras (requires
    item, time cost, log mode, condition) fold behind Advanced, with a
    view-only "edit full pipeline" escalation
  - Scene form reordered to player-order: description → choices; passive
    checks/auto-attack/quest trigger under a collapsed "When the scene
    loads"; XP/hooks/map/exhibits/stands under collapsed "Advanced"
  - apCost/timeCost now authorable on checks (previously JSON-only)
- **Phase 3 — map as home.** [SHIPPED]
  - Navigate connections draw as arrows between placed scenes and track
    live while dragging
  - Dragging a scene's anchor onto another writes the "Go to" option
    (deduped per destination); double-clicking empty canvas creates a
    scene at that spot in the current region
  - Unplaced scenes of the region wait in a tray; one click places them
    in the current view
  - Guided "New Scene" (sidebar) auto-places next to its "reachable from"
    source when that scene is on the map
- **Phase 4 — dialogue graph as primary** dialogue surface. [SHIPPED]
  - NPC text and reply text edit in place on the node cards (nodes grow
    with their text; arrows re-route live)
  - Double-clicking empty canvas creates a node there — NPC line first,
    id auto-slugged from it (or given explicitly)
  - "+ reply" adds a response; ✕ deletes a reply or a whole node, with a
    confirm that counts and removes inbound connections ("start" is
    protected — the engine's entry node)
  - Inbound-ref helpers (rename + delete) now scan outcome tiers and
    onExhausted pipelines, not just the flat actions/onFailure
  - NPC form's Conversations section links "Edit in Graph" always (also
    for NPCs with no dialogue yet) and remains the expert escape hatch

## Known hotspots the later phases must resolve

- Check semantics scattered across four authoring shapes (scene skills[],
  passiveChecks[], dialogue response checks, check-fields tiers)
- Implicit cross-entity contracts (start node, NPC reachability, map
  visibility, free-text flags) — surface as navigable links/affordances
- The action-pipeline editor's ~20 param renderers assume engine knowledge —
  most common pipelines (navigate, loot, dialogue, combat) should be
  first-class choice kinds instead
