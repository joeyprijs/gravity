# Gravity — Time System (Design Proposal)

*Status: **proposal, not committed.** Written after a gameplay evaluation of the tech demo (2026-07-06) so the reasoning isn't lost; nothing here is built. Companion to [`ROADMAP.md`](ROADMAP.md) Phase 2 → "A sense of time".*

---

## Why time, and why before tactical combat

The gameplay evaluation surfaced a family of related wonkiness: **free repeatable actions with pure upside**. Skill checks can be re-rolled at no cost until they succeed (the dice only decide the click count). "Rest here" restores HP for free, so optimal play is spam-rest before every door. Scene re-entry resets escalated DCs, so the optimal counter to DC escalation is walking out and back in. In each case *repetition is the optimal strategy, and repetition is boring*.

The constraint we hold: **never hard-lock content behind a failed roll.** Players should always have a path forward.

A time system resolves the whole family with one mechanic: attempts cost time, resting costs time, travel costs time — and time advances the world. You can still retry a Perception check forever; the goblin patrol just gets closer while you do. **Cost without lockout.** It also retroactively legitimizes the re-entry DC reset: re-entering costs travel time, so it becomes a real trade instead of an exploit.

Time is also the prerequisite for the quest depth item on the roadmap (deadlines and failure states need a clock), which is why this proposal ranks it the highest-leverage Phase 2 feature for gameplay feel.

## Design at a glance

| Piece | What it is | New machinery? |
|---|---|---|
| **Ticks** | One monotonic integer counter in state. | Small: `state.time`, `advanceTime()`, save migration. |
| **Costs** | `timeCost` on options/skills/responses + an `advance_time` action. | Small: one hook in the option-execution path, one action handler. |
| **Conditions** | `time` / `day` / `segment` leaves in the condition AST. | Tiny: three leaves in `evaluateCondition`. |
| **Timers** | "When the clock passes X, run this (restricted) pipeline." | The one genuinely new subsystem. |
| **Presentation** | Days/segments derived from rules; HUD chip. | Derived data, not state. |

Everything reuses the engine's existing grammar: costs are authored like actions, reactions are authored like conditions and flags. No real-time clock, no simulation loop, no `setTimeout` — time only moves when the player acts, which keeps the engine deterministic, testable, and save-friendly.

## 1. The core primitive: ticks

A single counter in `StateManager`:

```js
state.time = { ticks: 0 }   // SAVE_VERSION 3 → 4; migration seeds { ticks: 0 }
```

`gameState.advanceTime(n)` is the **only** mutator. It emits a `time:advanced` event through the existing listener/hint system, so the HUD and plugins react the same way they already do for HP or gold.

Days and day-segments are **presentation, not state** — derived in one place from `rules.json`:

```json
"time": {
  "ticksPerDay": 24,
  "startTick": 8,
  "segments": [
    { "id": "morning", "from": 6  },
    { "id": "day",     "from": 10 },
    { "id": "evening", "from": 18 },
    { "id": "night",   "from": 22 }
  ]
}
```

Segment names resolve through locale keys like all other text — no raw strings in data.

## 2. Spending time: `timeCost`

Two declarative ways to advance the clock.

**A field on anything that runs a pipeline** (scene options, skill options, dialogue responses). `scene.js` already owns the "player chose this" chokepoint; it advances time before running the pipeline:

```json
{ "text": "scene.hallway.sneak", "skill": "stealth", "dc": 14, "timeCost": 1 }
```

**An explicit pipeline action** for authored moments:

```json
{ "type": "advance_time", "amount": 8 }
{ "type": "advance_time", "until": "morning" }
```

The `until` form gives "sleep until morning" for free — the single most-requested verb once a clock exists.

Defaults live in `rules.json` so authors don't annotate every option:

```json
"defaultCosts": {
  "navigate": 1,
  "skillAttempt": 1,
  "fullRest": 8,
  "combatRound": 1
}
```

`"timeCost": 0` is the explicit opt-out. Dialogue lines default to free; browsing menus is always free.

## 3. Reading time: three condition leaves

`evaluateCondition` (`src/systems/condition.js`) is the single gate for option visibility, dialogue gating, and conditional scene descriptions. Adding three leaf types there makes **every existing surface time-aware at once**:

```json
{ "segment": "night" }
{ "day": { "at_least": 3 } }
{ "time": { "at_least": 120 } }
```

The existing `compare()` helper already handles the operator objects. With this slice alone, authors can write a scene description that reads differently at night, a merchant hidden outside shop hours, or a dialogue branch that only exists on day 1 — the same conditional-description trick the hallway already uses for its fight/sneak/pacify aftermath, with time as one more axis.

## 4. The world reacting: timers

A timer is "when the clock passes a deadline, run this pipeline":

```json
{
  "id": "goblin_reinforcements",
  "afterTicks": 12,
  "actions": [
    { "type": "set_flag", "flag": "hallway_reinforced", "value": true },
    { "type": "log", "message": "log.distantMarching" }
  ]
}
```

Armed via a `set_timer` action (plus `cancel_timer`), stored in `state.timers` as `{ id, deadline }`, checked inside `advanceTime()` and fired in deadline order. Two constraints keep it safe:

- **Timer pipelines are restricted to "quiet" actions** — `set_flag`, `log`, mission status changes. No `navigate`, no combat-start. The world changes *through flags*, which already flow into scene re-renders, option visibility, and dialogue naturally. This sidesteps every reentrancy question: a timer firing mid-combat just sets a flag, and the scene reflects it after the fight.
- **Firing is synchronous and deterministic** inside `advanceTime()` — nothing wall-clock. A save file replays identically; tests stay `node --test`-simple.

Timers turn the quest system's missing failure states into data: arm a timer when `escape_dungeon` activates, and its pipeline sets a flag that a `questTrigger` condition reads as "too late." Quest deadlines, patrols, a rescue that only holds three days — all authorable without touching `quests.js`.

## 5. What stays out of core

Following the curator-plugin precedent: hunger/survival meters, torch fuel, and NPC daily schedules (Ultima-style "the blacksmith walks home at 6pm") are game-specific *policies*, not engine concepts. All are buildable as plugins on the `time:advanced` hook — a hunger plugin is ~30 lines that decrements a stat every N ticks. Core ships the clock, the costs, the conditions, and the timers; opinions about what time *means* stay in plugins and data.

## Build order (each slice shippable alone)

1. **Clock + costs + conditions** — `state.time` + migration, `advanceTime`, `advance_time` action, `timeCost` on options/skills/responses, the three condition leaves, a HUD chip ("Day 2 — Evening"). Touches `state.js`, `actions.js`, `condition.js`, `scene.js`, `rules.json`, one HUD widget. This slice alone fixes check-spam and rest-spam.
2. **`until` + sleep-until-morning** — pure convenience on top of slice 1.
3. **Timers** — the world-reacts layer, plus schema/`validateGameData` support (dangling timer ids, illegal actions in timer pipelines) and demo content to prove it: a night-only hallway description, a deadline on `escape_dungeon`.

## Open questions (to settle before building)

- **Tick granularity.** Instinct: coarse ticks (one tick ≈ 10–60 fictional minutes, a "turn") rather than minutes — small numbers are easier to author and nothing in the design cares about the unit. Needs a decision because every `timeCost` in demo content bakes it in.
- **Should combat advance the clock?** `combatRound: 1` is proposed, but a long fight could then blow a quest deadline the player couldn't see coming. Alternative: combat costs a flat amount on entry, rounds are free.
- **Does the demo want day/night at all,** or only elapsed-time? Segments are cheap but demo content must then acknowledge them (a dungeon has no visible sky; the home hub does).
- **Timer visibility.** Are deadlines surfaced to the player (quest log shows "2 days left") or discovered through fiction? UI-only question, but it changes how fair failure feels.
- **Preview/Studio interaction.** The workbench should probably get a "set clock" debug control so authors can test time-gated content without grinding ticks.
- **Interaction with the luck proposal** ([`luck.md`](luck.md)). Both proposals tax repeated attempts; if both ship, skill-check retries should cost one or the other by default, not both. See the "Interaction with the time proposal" section there.
