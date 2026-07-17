# Gravity — Checks and Time (the engagement toolkit)

*The authoring guide for skill checks and the systems that give them stakes. This document is the current reference (the archived time/luck proposals are historical).*

**Everything here is optional.** A game that configures none of it plays like classic Gravity: d20 vs DC, retry at will. Each tool below is an independent knob an author turns per game (in `rules.json`) or per check (in scene/NPC data).

**DC escalation (`increment`) is gone.** It punished retries without informing the player, soft-locked content, and the scene re-entry reset made it exploitable. The validator flags any `increment` left in data. Its replacements — attempt budgets, one-shot resolution, retry costs, and time pressure — are all below.

---

## The check flavors

A scene's `skills` array (and an NPC's dialogue `responses`) supports five check flavors, dispatched by shape:

| Flavor | Shape | What happens |
|---|---|---|
| **Narrative** | `skillCheck`, no `dc`, no `items` | No roll. Logs `resultText`, runs `actions`, retires unless `repeatable`. A story beat framed as a skill. |
| **Pass/fail** | `skillCheck` + `dc` | 1d20 + modifier vs DC, resolved through outcome tiers (below). |
| **Item discovery** | `skillCheck` + `items` | One roll vs every still-hidden item's own DC; found items persist. |
| **Passive** | scene-level `passiveChecks` | Auto-rolled silently on first entry, once per game, into an author-named flag. |

Check buttons always show the player what they're weighing: their modifier ("Bonus: Perception +2", from the `actions.skillBadge.*` locale strings) and the DC on its own line (`actions.skillBadgeDc`). Informed decisions are the point — hidden math is a slot machine.

## Outcome tiers

Pass/fail checks (scene and dialogue) resolve against margin-based tiers:

```json
{
  "text": "Slip past the goblins undetected.",
  "skillCheck": "stealth",
  "dc": 14,
  "outcomes": {
    "critical": {
      "margin": 5,
      "text": "You move like a rumor.",
      "actions": [ ... ]
    },
    "success": {
      "actions": [ ... ]
    },
    "partial": {
      "margin": 3,
      "text": "You make it — barely.",
      "actions": [ ... ]
    },
    "failure": {
      "actions": [ ... ]
    }
  }
}
```

- `margin` on `critical`: beat the DC by at least this much (default 5).
- `margin` on `partial`: miss the DC by at most this much (default 3).
- `critical` and `partial` exist **only when authored**. A `critical` without its own pipeline runs the success actions — the best roll never does less than a plain success.
- `outcomes` is the one authoring shape. The legacy fields (`actions` = success pipeline, `onFailure` = failure pipeline) are still read for older data, and the validator nags when both shapes define the same tier.
- **`partial` is the fail-forward tier**: the player gets the thing, with a catch (took damage, made noise, annoyed the trader). Partial still counts as a failed attempt for retry purposes — it just isn't *empty* failure.
- Each tier's `text` logs as narration when it lands, after the locale-driven roll line (`actions.skillCritical` / `skillSuccess` / `skillPartial` / `skillFail`).

## One-shot checks: `resolveOnce`

`"resolveOnce": true` — the check rolls exactly once, then retires permanently (it survives scene re-entry and save/load). This is the fail-forward commitment: whatever tier lands, the situation *resolves*. Route failure/partial somewhere real; the moment never repeats.

In dialogue, a resolved response stays gone across conversations.

## Attempt budgets: `maxAttempts` + `onExhausted`

```json
{
  "text": "Look Around",
  "skillCheck": "perception",
  "maxAttempts": 4,
  "onExhausted": [
    {
      "type": "set_flag",
      "flag": "search_exhausted",
      "value": true
    },
    {
      "type": "log",
      "message": "Your eyes won't find anything more here."
    }
  ],
  "items": [ ... ]
}
```

When the budget runs out without success, the check retires and `onExhausted` runs once — the authored way out. Never hard-lock: if the check gates progress, make `onExhausted` (or an option it reveals) an alternative route. The validator warns when `maxAttempts` has no `onExhausted`. In dialogue, budgets are per conversation — walking away and re-talking resets patience.

`retryText` (a string or array walked per attempt) changes the button/log wording as attempts mount; attempt counts reset on scene re-entry. A tier's narration `text` may also be an array — walked per failed attempt so repeated failures escalate ("The rubble holds." → "Your fingers come away raw." → "It settles for good."), clamping to the last line.

## Retry currency (`rules.skillRetry`)

Failing a check is free the first time; *retrying* it can cost a scarce resource — a spend-to-try-again economy that makes "search again?" a real decision instead of free spam. Declare a resource and point the retry policy at it:

```json
"playerDefaults": {
  "resources": {
    "hp": { ... },
    "ap": { ... },
    "gold": 0,
    "luckPoints": {
      "current": 3,
      "max": 3
    }
  }
},
"skillRetry": {
  "resource": "luckPoints",
  "cost": 1,
  "restRestore": 3
},
"headerResources": ["luckPoints"]
```

- **First attempt always free**; each retry of a failed pass/fail or discovery check (and dialogue checks) spends `cost` of the resource. The badge shows it as its own line ("Retry: 1 Luck Point", from `actions.badgeRetryCost`); when the player can't afford it the button renders disabled, like an unmet item requirement.
- **`restRestore`** refills the resource on `full_rest` (clamped to max) — the cozy counterweight: spend do-overs while out, recover them sleeping at home.
- **`headerResources`** lists resources to surface in the story panel's status bar and the character sheet (label from `ui.resources.<id>`); it's general — any declared `{ current, max }` resource can appear, and any can be spent/restored by name through actions.
- The resource is tone-neutral: name it "Luck", "Grit", "Focus", whatever fits. It doesn't touch how checks *resolve* (still d20 + modifier vs DC) — it only gates retries.

*(A depleting resource is opt-in. Omit `skillRetry` and retries are unlimited and free.)*

## The world clock (`rules.time`)

Time is a single monotonic tick counter in save state. It only moves when the player acts — no wall clock, fully deterministic, save-safe. Configure it in `rules.json`:

```json
"time": {
  "ticksPerDay": 24,
  "startTick": 8,
  "segments": [
    {
      "id": "morning",
      "from": 6
    },
    {
      "id": "day",
      "from": 10
    },
    {
      "id": "evening",
      "from": 18
    },
    {
      "id": "night",
      "from": 22
    }
  ],
  "defaultCosts": {
    "navigate": 1,
    "skillAttempt": 0,
    "fullRest": 8
  }
}
```

Without `rules.time` the system is dormant: no HUD chip, no default costs (explicit `timeCost` fields and `advance_time` still move the invisible counter).

- **Spending time.** `timeCost` on any option, skill, or dialogue response (explicit always wins; `0` opts out of a default). Defaults from `defaultCosts`: options that navigate charge `navigate`, options that full-rest charge `fullRest`, check attempts charge `skillAttempt`. Dialogue and narrative checks are free unless authored otherwise.
- **Actions.** `{ "type": "advance_time", "amount": 8 }`, or `{ "type": "advance_time", "until": "morning" }` for sleep-until-morning (never 0 ticks — in the morning it sleeps to tomorrow's).
- **Reading time.** Condition leaves work everywhere conditions do: `{ "time": { "at_least": 120 } }`, `{ "day": { "at_least": 3 } }`, `{ "segment": "night" }`.
- **Timers.** `{ "type": "set_timer", "id": "alarm", "afterTicks": 12, "actions": [ ... ] }` (or `atTick`); `cancel_timer` disarms. Timer pipelines are restricted to **quiet actions** (`set_flag`, `log`, `questTrigger`, `set_timer`, `cancel_timer`) — the world changes through flags, which scene re-renders and conditions already read, so a timer firing mid-anything is always safe. Re-arming an id replaces the old deadline.
- **HUD.** With `ticksPerDay` set, the story panel's status bar shows the clock ("Day 2: Evening" — `ui.timeChipDay` for the day text, `time.segments.*` for the segment names). Games without segments show just the day.

Combat does not advance the clock by default; author an `advance_time` in `onVictory` if a fight should cost time.

## There is no luck subsystem

"Luck" is not a built-in mechanic — it's modeled from the pieces above. The demo combines both halves:

- **Luck the skill**: a plain custom attribute (`{ "id": "luck", "default": 0 }`), point-buyable in character creation, rolled with `"skillCheck": "luck"` against a DC exactly like perception, readable in conditions (`{ "luck": { "at_least": 2 } }`).
- **Luck Points the pool**: a `luckPoints` resource + `rules.skillRetry` — see *Retry currency*. Pushing your luck spends from it: the first attempt at a luck check (or any check) is free, each retry costs a point, and rest refills the pool.

Together they read as one theme — the skill is how good you are at being lucky, the points are how much luck you have left to push — while staying one resolution mechanic everywhere: d20 + modifier vs DC, never a parallel dice system. Either half works alone; a game can also skip luck entirely.

*History: a Fighting-Fantasy-style 2d6 roll-under luck subsystem (depleting resource, Test Your Luck gambles, combat gambles) shipped briefly and was removed — a second resolution mechanic cost more in player legibility than it earned. The validator flags its leftover authoring surface (`luckCheck`, `restore_luck`, `rules.luck`, a `luck` resource) with pointers to these conventions.*


## Passive checks

```json
"passiveChecks": [
  {
    "skillCheck": "perception",
    "dc": 13,
    "flag": "chamber_noticed_shimmer",
    "text": "Something up in the crack catches the light."
  }
]
```

Rolled silently on the player's **first** entry, once per game, writing pass/fail into the flag. Description variants, options, and skills condition on the flag; `text` logs only on success. This removes the "ritually click Look Around in every room" tax — perceptive characters just *notice* things.

## Where the demo shows each tool

| Tool | Demo location |
|---|---|
| Attempt budget + authored way out | Cellar "Look Around" (`maxAttempts: 4` → force the lock with the rusty sword) |
| Timer + world reaction | Opening the cellar door arms `dungeon_alarm` (12 ticks → hallway description changes) |
| Partial / critical tiers | Hallway stealth check (graze through / pickpocket on a critical) |
| Budgeted persuasion → consequence | Hallway goblin charm (3 tries, then they attack) |
| Narrative check | Kitchen "Sneak a taste of the stew" (repeatable, escalating resultText) |
| Luck skill + retry currency | Corridor rubble dig: d20 + Luck vs DC 12; retries cost a Luck Point, escalating failure lines |
| Passive check | Grand Chamber ceiling shimmer → one-shot fail-forward climb |
| One-shot dialogue check with tiers | Stranger's discount haggle (critical: 20% + a clover; failure: marked-up prices) |
| Time + sleep | Bedroom "Sleep until morning"; kitchen changes at night |

## Validation

`validateGameData` checks all of it: leftover `increment` and removed luck-subsystem fields, unknown outcome tiers, doubly-defined tier pipelines, `resolveOnce`+`maxAttempts` redundancy, inert `onExhausted`, unsafe timer actions, unknown segments, day/segment conditions without their backing config, malformed `defaultCosts`, missing segment locale keys, and passive checks missing `flag` or `skillCheck`.
