# Gravity — A Designer's Exploration

*A guided tour of what the Gravity engine actually lets you build, where it sings, and where it runs thin — written from a game designer's chair rather than a code reviewer's.*

This is a companion piece, not a reference. For engine internals see [`ARCHITECTURE.md`](ARCHITECTURE.md); for a code-quality audit by severity see [`AUDIT.md`](AUDIT.md). Here we care about one question: **as a designer, what can I make with this — and what would I wish for?**

---

## The demo as a designer sees it

Boot the demo and you wake up in a cellar with no memory of who you are. That opening scene — `The Awakening` — is a tidy thesis statement for the whole engine, so it's worth reading like a designer.

The room has a locked door to the north and a single skill option: **Look Around** (a Perception check). Roll well and you find the `cellar_key` at DC 5, plus two rolls on the `basic_loot` table at a much stiffer DC 14. Find the key, an "Unlock the door" option appears (gated on owning `cellar_key`), it flips a `door_unlocked` flag, and the scene's description *rewrites itself* — the door now "stands wide open." Nothing here is scripted. It's all declarative JSON: a condition, a flag, a requirement, an action pipeline.

Push north and the demo shows its second trick. The corridor triggers an **auto-attack**: a panicked `lost_wanderer` lurches out and combat starts before you can speak. Win, and the encounter's `onVictory` pipeline sets `wanderer_defeated`, drops 5 gold and a potion, and the corridor's prose calms down on your next visit. The dungeon continues like this — goblins you can fight, sneak past (Stealth), or charm (Charisma) — culminating in a Grand Chamber where you meet the **Mysterious Stranger**, a merchant who'll give you a standing discount if you pass a Charisma check (and hands you a free potion the first time you butter him up).

Escape the dungeon and the tone flips entirely: you land in a cozy **home hub** — living room, kitchen, bedroom, and a small museum wing with display cases you can curate. The demo is two genres stitched together (a tense dungeon crawl and a warm home base) precisely to prove the engine isn't single-purpose.

**What the demo is really showing off:** ten scenes, six NPCs, twelve items, and one quest are enough to demonstrate branching narrative, three flavors of skill check, turn-based combat with loot hooks, a working merchant economy, persistent world flags, a minimap, save/load, and a plugin (the museum curator). It's a vertical slice chosen to exercise breadth, not length.

---

## What the systems let you build today

The headline feature is real: **you can author a complete game in JSON with zero scripting.** Here's the expressive palette a designer has on day one.

**Reactive, conditional narrative.** A scene's `description` can be an ordered list of `{ text, condition }` blocks — first match wins. Combined with flags, missions, inventory, gold, level, and custom-attribute conditions (with `and`/`or`/`not` and operators like `at_least`, `more_than`, `is`), the world visibly remembers what you've done. The cellar door rewriting itself is the simplest case; you can gate entire option sets, dialogue branches, and scene variants the same way.

**Options as action pipelines.** Every choice runs an ordered list of actions — `set_flag`, `navigate`, `loot`, `combat`, `dialogue`, `heal`, `full_rest`, `log`, `manage_chest`, and more. Choices can carry `requirements` (you need the `cellar_key`) and `condition` gates (only shown if `door_unlocked` is false). Composing these is the core authoring verb.

**Three distinct skill-check idioms**, which is more design range than it first appears:
- *Flavor* checks (no DC) — one-shot atmosphere you reveal and retire.
- *Item-discovery* checks — one roll attempts a list of finds, each with its own DC; misses **escalate** the DC and found items persist. This is the "search the room" verb.
- *Pass/fail* checks — success runs `actions`, failure runs `onFailure`, and the DC ramps on repeat failure so brute-force retrying gets harder.

**Combat with consequences attached.** Turn-based, D&D-flavored: d20 + bonus vs. armor class, initiative ordering, action points per turn, multi-attack enemies. Crucially, victory fires the originating option's `onVictory` pipeline — so a fight isn't a dead end, it's a gate that hands you loot, flips flags, and routes you onward. Enemies are cloned at encounter start, so the same goblin template can appear repeatedly without corrupting state.

**A believable merchant economy.** NPCs flagged `isMerchant` carry stock, buy at a configurable sell ratio (0.5 by default), track remaining inventory in flags, and can offer **persistent discounts** earned through dialogue skill checks — exactly what the Mysterious Stranger does.

**Quests, leveling, and a curated home.** Missions transition `not_started → active → complete` via scene triggers and pay out XP/gold. XP rolls into a linear leveling curve with an HP bonus per level. The chest and museum-display systems give you persistent off-body storage and a curation loop, all saved.

**It all persists.** State is a single reactive source of truth, serialized to a base64 save string with **versioned migrations** — so shipping new content to existing players doesn't break their saves. For a hobby-scale engine, that's a genuinely grown-up feature.

---

## Strong sides

- **Data-driven to the bone.** The cellar-key puzzle, the wanderer ambush, the merchant haggle — none of it is code. A designer who never opens a `.js` file can build the entire demo. That's the engine's whole reason for existing, and it delivers.
- **Zero dependencies, browser-native.** No build step, no framework, no install. It runs by opening a file. That makes it trivially portable and embeddable, and it ages well.
- **A real authoring pipeline, not just a runtime.** The browser-based **Studio** (forms + validation for every content type via the File System Access API) plus load-time `validateGameData` plus ~16 Node-native test suites means content gets caught when it's wrong — dangling references, bad action types, schema drift. Most hobby engines have the runtime and nothing else.
- **Clean extensibility seams.** The plugin API exposes custom actions, stat handlers, mutation hooks, save migrations, description hooks, and scene decorators. The bundled curator plugin proves the seams are load-bearing, not theoretical — a whole museum subsystem lives outside the core.
- **i18n discipline from the start.** Game text lives behind semantic locale keys, not raw English strings baked into data. The demo ships English-only, but the architecture never assumed one language — retrofitting that later is the expensive mistake this codebase didn't make.
- **Reactive state with adult save handling.** One source of truth, hint-scoped UI updates, and forward-migrating saves. The plumbing is solid.

---

## Where it feels thin

These are *expressive* limits — gaps a designer bumps into — not bugs. (For code-quality concerns, see [`AUDIT.md`](AUDIT.md).) Each item carries its standing after a design review: **[Planned]** is on the roadmap, **[By design]** is a deliberate constraint, **[Open]** is an acknowledged gap that isn't prioritized yet.

- **Combat is single-target and shallow on tactics.** *[Planned]* You attack one enemy at a time; there's no area-of-effect, no targeting of multiple foes with one action. Enemy "AI" is a loop that swings its one equipped weapon until its AP runs out. There are no status effects, no buffs/debuffs, no damage-over-time, no resistances or damage types — so a `flames` spell and a `rusty_sword` differ only by dice. Tactically rich combat isn't expressible yet.
- **No sense of time.** *[Planned]* There are no timers, turn counters outside combat, cooldowns, or day/night. "Every few days a letter arrives" or "this option is only available at night" can't be authored without code. The world reacts to *what* you've done, never *when* or *how long*.
- **Encounters are static and hand-placed.** *[By design]* Loot rolls on weighted tables, but encounters themselves don't — every fight is a specific NPC dropped into a specific scene. This is a deliberate constraint: hand-placement forces intentional design, and the restriction is itself creatively useful. An optional random-encounter facility is a *maybe-later*, not a gap to close.
- **No party or companions.** *[Planned]* It's a strictly solo protagonist. An ally who fights alongside you, or a follower NPC, has no representation in combat or state — wanted, but acknowledged as a complex addition, so it sits lower on the list.
- **No mid-combat negotiation.** *[Open]* *Sequencing* across the two systems is already fine: combat outcomes set flags (`goblins_pacified`, `defeated_goblin_guard`), and both scene options and dialogue branches read them — so charming the goblins and *then* talking to them, or branching a later conversation on how a fight ended, is fully authorable today (the demo just doesn't wire a dialogue node onto the pacified goblins). What's missing is interaction *during* an active fight: combat runs attacks-only until victory or defeat, with no action to surrender, negotiate, or drop into dialogue mid-encounter. Acknowledged, not yet prioritized.
- **Quest depth is unexercised.** *[Planned]* The framework supports activate/complete with rewards, but the demo ships exactly one mission, so chained objectives, branching quest lines, and failure states are untested in practice — a designer attempting a long campaign is in unproven territory.
- **Visual authoring stops at layout, not creation.** *[Planned]* Studio is more than forms: it has a drag-to-reposition **map editor** (scene cards on a canvas, snap-to-grid, click to open) and a visual **dialogue-graph editor** (drag nodes, drag an anchor dot to wire responses together). The remaining gap is that these visual views edit the *layout and wiring of existing* content — spawning a brand-new scene or dialogue node still happens through the forms/sidebar — and the underlying model (flags, conditions, pipelines) still has to live in the designer's head.
- **One shipped locale.** *[Planned]* The i18n *architecture* is excellent; the *content* is English-only, so the multi-language story is currently a promise rather than a demonstration.

---

## Fun additions (engine-level)

These are general-purpose primitives that would widen what *any* Gravity game can express — deliberately distinct from game-specific content. (Anything tied to a particular game's fiction — a museum economy, a faction storyline — is better delivered as a **plugin** on top of these primitives, which is exactly what the plugin API is for.)

- **Status effects & timed modifiers.** A first-class system for buffs/debuffs/DoT with durations measured in turns. This single addition deepens combat, items (poison, regeneration), and skill checks (a "blessed" bonus) all at once.
- **Multi-target & area combat.** Let an action hit several enemies, and let encounters field grouped foes. Combine with damage types/resistances to make weapon and spell choice a real decision.
- **A lightweight scheduler / world clock.** A turn or day counter plus a trigger queue ("fire this action after N rests / on entering scene X the third time"). Unlocks cooldowns, recurring events, time-gated options, and ambient world change — none of which are expressible today.
- **Randomized encounter & scene tables.** Extend the existing weighted loot-table mechanism to spawn encounters or pick scene variants, giving designers procedural replayability with the table syntax they already know.
- **Companion / party support.** Represent one or more allies in combat and state, with their own equipment and turns. Even a single follower would dramatically expand the kinds of stories the engine can tell.
- **Richer condition & action vocabulary.** Conditions for "item is equipped" or comparing two flags; actions for arithmetic on flags/stats and conditional branching inside a pipeline. Small primitives that compound into a lot of new design space.
- **Presentation hooks.** Audio/SFX cues and simple scene-transition or portrait hooks, surfaced as data so designers can score moments without touching the renderer.
- **Accessibility pass.** Keyboard navigation, focus management, and screen-reader semantics for the option/combat UI — a feature that's invisible until someone needs it, and unbuildable as an afterthought.

Notably, several of these (the scheduler, status effects, condition operators) are *force multipliers*: they don't just add one feature, they expand what every other system can already do. That's the highest-leverage place to invest — and the plugin architecture is well-positioned to prototype them before any graduate into the core.
