# Gravity — Checks, Time, and Luck (the engagement toolkit)

*The authoring guide for skill checks and the systems that give them stakes. Implements the designs in [`archive/time.md`](archive/time.md) and [`archive/luck.md`](archive/luck.md); this document is the current reference.*

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
| **Test Your Luck** | `luckCheck: true` | 2d6 at-or-under current luck, then luck −1 *regardless*. No DC — the player's own luck is the difficulty. One-shot by default. |
| **Passive** | scene-level `passiveChecks` | Auto-rolled silently on first entry, once per game, into an author-named flag. |

Check buttons always show the player what they're weighing: the DC **and their modifier** (`actions.skillBadge.*` locale strings take a `{mod}` param), or the gamble's **odds** for luck checks. Informed decisions are the point — hidden math is a slot machine.

## Outcome tiers

Pass/fail checks (scene and dialogue) resolve against margin-based tiers:

```json
{
  "text": "Slip past the goblins undetected.",
  "skillCheck": "stealth",
  "dc": 14,
  "outcomes": {
    "critical": { "margin": 5, "text": "You move like a rumor.", "actions": [ ... ] },
    "success":  { "actions": [ ... ] },
    "partial":  { "margin": 3, "text": "You make it — barely.",  "actions": [ ... ] },
    "failure":  { "actions": [ ... ] }
  }
}
```

- `margin` on `critical`: beat the DC by at least this much (default 5).
- `margin` on `partial`: miss the DC by at most this much (default 3).
- `critical` and `partial` exist **only when authored**. A `critical` without its own pipeline runs the success actions — the best roll never does less than a plain success.
- `outcomes` is the one authoring shape. The legacy fields (`actions` = success pipeline, `onFailure` = failure pipeline) are still read for older data, but Studio migrates them on edit and the validator nags when both shapes define the same tier.
- **`partial` is the fail-forward tier**: the player gets the thing, with a catch (took damage, made noise, annoyed the trader). Partial still counts as a failed attempt for retry purposes — it just isn't *empty* failure.
- Each tier's `text` logs as narration when it lands, after the locale-driven roll line (`actions.skillCritical` / `skillSuccess` / `skillPartial` / `skillFail`).

## One-shot checks: `resolveOnce`

`"resolveOnce": true` — the check rolls exactly once, then retires permanently (it survives scene re-entry and save/load). This is the fail-forward commitment: whatever tier lands, the situation *resolves*. Route failure/partial somewhere real; the moment never repeats. Test Your Luck checks are `resolveOnce` by default (set `"resolveOnce": false` to allow repeat gambles).

In dialogue, a resolved response stays gone across conversations.

## Attempt budgets: `maxAttempts` + `onExhausted`

```json
{
  "text": "Look Around",
  "skillCheck": "perception",
  "maxAttempts": 4,
  "onExhausted": [
    { "type": "set_flag", "flag": "search_exhausted", "value": true },
    { "type": "log", "message": "Your eyes won't find anything more here." }
  ],
  "items": [ ... ]
}
```

When the budget runs out without success, the check retires and `onExhausted` runs once — the authored way out. Never hard-lock: if the check gates progress, make `onExhausted` (or an option it reveals) an alternative route. The validator warns when `maxAttempts` has no `onExhausted`. In dialogue, budgets are per conversation — walking away and re-talking resets patience.

`retryText` (a string or array walked per attempt) changes the button/log wording as attempts mount; attempt counts reset on scene re-entry.

## The world clock (`rules.time`)

Time is a single monotonic tick counter in save state. It only moves when the player acts — no wall clock, fully deterministic, save-safe. Configure it in `rules.json`:

```json
"time": {
  "ticksPerDay": 24,
  "startTick": 8,
  "segments": [
    { "id": "morning", "from": 6 }, { "id": "day", "from": 10 },
    { "id": "evening", "from": 18 }, { "id": "night", "from": 22 }
  ],
  "defaultCosts": { "navigate": 1, "skillAttempt": 0, "fullRest": 8 }
}
```

Without `rules.time` the system is dormant: no HUD chip, no default costs (explicit `timeCost` fields and `advance_time` still move the invisible counter).

- **Spending time.** `timeCost` on any option, skill, or dialogue response (explicit always wins; `0` opts out of a default). Defaults from `defaultCosts`: options that navigate charge `navigate`, options that full-rest charge `fullRest`, check attempts charge `skillAttempt`. Dialogue and narrative checks are free unless authored otherwise.
- **Actions.** `{ "type": "advance_time", "amount": 8 }`, or `{ "type": "advance_time", "until": "morning" }` for sleep-until-morning (never 0 ticks — in the morning it sleeps to tomorrow's).
- **Reading time.** Condition leaves work everywhere conditions do: `{ "time": { "at_least": 120 } }`, `{ "day": { "at_least": 3 } }`, `{ "segment": "night" }`.
- **Timers.** `{ "type": "set_timer", "id": "alarm", "afterTicks": 12, "actions": [ ... ] }` (or `atTick`); `cancel_timer` disarms. Timer pipelines are restricted to **quiet actions** (`set_flag`, `log`, `questTrigger`, `set_timer`, `cancel_timer`) — the world changes through flags, which scene re-renders and conditions already read, so a timer firing mid-anything is always safe. Re-arming an id replaces the old deadline.
- **HUD.** With `ticksPerDay` set, a "Day 2 — Evening" chip appears in the header (`ui.timeChipDay` / `ui.timeChipSegment` + `time.segments.*` locale keys).

Combat does not advance the clock by default; author an `advance_time` in `onVictory` if a fight should cost time.

## Luck (`rules.playerDefaults.resources.luck`)

Opt in by declaring the resource:

```json
"resources": { "hp": {...}, "ap": {...}, "luck": { "current": 7, "max": 9 } }
```

A depleting meta-currency (Fighting Fantasy's Test Your Luck): 2d6 at-or-under current luck = lucky, then **luck −1 regardless of outcome**. Odds decay as you spend; every invocation is a real decision. The button always shows the odds.

The tuning knobs live together in one rules block (legacy top-level names — `skillRetryLuckCost`, `fullRestLuckRestore`, `combatLuck`, `combatLuckMinDamage` — are still read, but deprecated):

```json
"luck": { "retryCost": 1, "restRestore": 1, "combat": true, "combatMinDamage": 3 }
```

- **Test Your Luck checks** — `"luckCheck": true` on scene skills or dialogue responses; `outcomes.success` on lucky, `outcomes.failure` on unlucky; one-shot by default.
- **Retry currency** — `"retryCost": 1`: first attempt at any pass/fail or discovery check is free, each retry spends luck. Unaffordable retries render disabled (like unmet item requirements). This is the direct anti-spam replacement for DC escalation.
- **Restoration (authored and scarce)** — the `restore_luck` action; item attributes `luckAmount` (consumable restore) and `luckMaxBonus` (permanent max increase); `"restRestore": 1` lets sleep trickle a point back.
- **Conditions** — `{ "luck": { "at_most": 2 } }` lets the world notice desperation or fortune.
- **Combat luck** — `"combat": true` (default off): attacks and enemy phases always resolve fully; qualifying moments leave optional follow-up gambles among the combat options. A landed hit opens a **twist the blade** window (+2 damage / target shrugs 1 off) that lasts until your next swing or the turn ends; damage taken during the enemies' phases accumulates into one **steel yourself** gamble (recover up to 2 of it / the wound bites 1 deeper — which can kill) available for your whole next turn. Skipping is simply not clicking. The buttons spell out the full stakes plus the odds (`combat.luckOffenseBadge` / `luckDefenseBadge` locale keys). `"combatMinDamage": 3` (default 1) keeps trivial scratches from offering the gamble.
- **Character creation** — add `{ "id": "resources.luck.max", "localeKey": "luck", "bonusPerPoint": 1 }` to `charCreation.stats` and "lucky" becomes a build identity.
- Old saves are safe: rules-declared resources missing from a save are seeded on load.

**Tuning guideline:** time and luck both tax repetition — pick one per surface, don't stack. The demo's economy: retries cost luck, travel and sleep cost time, sleep restores a point of luck.

## Passive checks

```json
"passiveChecks": [
  { "skillCheck": "perception", "dc": 13, "flag": "chamber_noticed_shimmer",
    "text": "Something up in the crack catches the light." }
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
| Narrative check | Corridor "Study the wanderer's tracks" |
| Test Your Luck | Corridor rubble gamble (sunstone shard or crushed fingers) |
| Passive check | Grand Chamber ceiling shimmer → one-shot fail-forward climb |
| One-shot dialogue check with tiers | Stranger's discount haggle (critical: 20% + a clover; failure: marked-up prices) |
| Time + sleep + luck restore | Bedroom "Sleep until morning"; kitchen changes at night |
| Luck items | Four-Leaf Clover (in the loot table and the stranger's stock) |

## Validation

`validateGameData` (and Studio's Validate button) checks all of it: leftover `increment`, `luckCheck`/`skillCheck` conflicts, unknown outcome tiers, doubly-defined tier pipelines, `resolveOnce`+`maxAttempts` redundancy, inert `onExhausted`, unsafe timer actions, unknown segments, day/segment/luck conditions without their backing config, malformed `defaultCosts`, missing segment locale keys, luck knobs without the luck resource, and passive checks missing `flag` or `skillCheck`.
