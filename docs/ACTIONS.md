# Action Reference

Actions are the mutation half of the engine: the ordered pipeline a scene option, dialogue response, skill-check outcome, `onVictory`, or timer runs when it fires. Each entry is `{ "type": "name", ...params }`. This is the complete parameter reference; the [README](../README.md#actions-mutations) has the at-a-glance catalogue.

## How pipelines run

- **Order matters.** Actions execute top to bottom. Every action in the array runs, but a *navigating* action (`navigate`, `return`, `dialogue`, `combat`, `manage_chest`, and dialogue's `goToConversation`/`trade`/`leave`) hands the interactions panel to a new surface — so the caller stops re-rendering the old one once navigation has happened. The practical rule: **put state changes before navigation**, so the destination sees them.

  ```json
  "actions": [
    {
      "type": "set_flag",
      "flag": "door_unlocked",
      "value": true
    },
    {
      "type": "navigate",
      "destination": "dungeon_corridor"
    }
  ]
  ```

- **One side effect each.** A handler does exactly one thing; navigation is never a hidden consequence of another action. Compose behavior by listing several actions, not by overloading one.

- **Validated at boot.** Unknown action types, and bad references inside them (a `navigate` to a missing scene, a `loot` of an unknown item, a `combat` naming an undeclared enemy), are reported by `validateGameData` as grouped `[Gravity]` console warnings at startup, and again by `npm test` over the shipped data. A typo is a warning, not a silent no-op.

### The `log` convention

The state-changing actions — `loot`, `heal`, `full_rest`, `short_rest`, and `advance_time` — write a default line to the narrative log. Two optional controls, shared by all of them:

- `"log": false` — silence the default message entirely.
- `"log": "Some text."` — replace the default with your own line.

Override strings resolve through the locale table first: a key like `"log": "actions.heal"` prints that key's prose (keeping the line translatable — prefer this for anything that is a variant of an existing message), while a string that matches no key logs as-is (the allowance for genuinely one-off narrative lines). Voice follows STYLE.md's log rule: a string override is the world's answer (narrated), while `heal`, `full_rest`, and `short_rest` defaults are the act's *yield* — `(+2 HP)`, `(HP restored)` — amended onto the `[Player]` option line that ran the pipeline.

`advance_time` is the one exception in shape: it has **no** default message and logs *only* when you pass a string (its day/segment-change narration is produced separately by the clock). The other action types (`navigate`, `set_flag`, `combat`, `dialogue`, timers, …) don't take `log` at all.

### The `narration` convention

Any action may carry `"narration": "audio/clip.webm"` — a recorded read-aloud of the line it just wrote, played on the audio system's narration channel. It sits beside the text it narrates:

```json
{
  "type": "loot",
  "item": "cellar_key",
  "log": "You spot it: a small iron key in the gap beneath the door.",
  "narration": "audio/narration/dungeon/start__closer_look.webm"
}
```

Two things follow from the narration channel playing one clip at a time:

- A second narrated action in the same pipeline **cuts off** the first. Narrate one beat per pipeline.
- Entering a scene stops narration, so a narrated action followed by `navigate` in the same pipeline is silenced on arrival. Narrate the destination instead.

A missing file warns once in the console and is otherwise silent — clips can be recorded and dropped in after the data is authored. The channel model, the file layout, and the naming rules are in [`docs/AUDIO.md`](AUDIO.md).

---

## Actions available everywhere

Usable in scene option pipelines, skill-check outcome pipelines, `onVictory`, and dialogue responses.

### `loot`

Give an item — or gold — to the player.

- `item` *(string, required)* — the item id to grant, or the literal `"gold"` to add currency to the player's gold resource instead of to the inventory.
- `amount` *(number, default `1`)* — the stack size, or the quantity of gold.
- `received` *(boolean, default `false`)* — narration only: `false` reads the loot as *found* (searched, dropped), `true` as *handed over* (an NPC gift or reward). It only selects the log message; the item transfer is identical.
- `xpReward` *(number, optional)* — also award this much XP, logged on its own line.
- `log` — see [The `log` convention](#the-log-convention).

An unknown `item` is refused with a console warning (and flagged at boot) — nothing enters the inventory, though the found/received line still prints, with the raw id standing in for the name.

### `combat`

Start a turn-based encounter.

- `enemies` *(string[], required)* — the NPC ids to fight.
- `onVictory` *(action[], optional)* — a pipeline run when the player wins the fight. Loot, flags, and navigation for a defeated encounter live here, not on the NPC.

```json
{
  "type": "combat",
  "enemies": [
    "goblin_guard"
  ],
  "onVictory": [
    {
      "type": "loot",
      "item": "cellar_key",
      "received": true
    },
    {
      "type": "set_flag",
      "flag": "guard_defeated",
      "value": true
    }
  ]
}
```

### `dialogue`

Open a conversation.

- `npc` *(string, required)* — the NPC id to talk to. An unknown id warns and does nothing.

### `navigate`

Move the player to another scene.

- `destination` *(string, required)* — the scene id to render.

### `return`

Return to the scene the player last teleported away from (set by a `teleportScene` item), falling back to `rules.startingScene` when there is none. Takes no parameters — it is the "go home" counterpart to a teleport.

### `heal`

Change the player's HP.

- `amount` *(number, default `rules.snackHealAmount`, or `2` if unset)* — HP delta. A negative value deals damage; HP is clamped to `[0, max]`.
- `log` — see [The `log` convention](#the-log-convention).

### `full_rest`

Restore the player at a resting point. Takes no effect parameters. Sets HP to full, refills the retry currency by `rules.skillRetry.restRestore` (clamped to its max) when one is configured, and tops up the short-rest pool when `rules.shortRest` is configured. AP is not restored here — it is a per-combat budget that resets on its own when the next fight begins.

- `log` — see [The `log` convention](#the-log-convention).

### `short_rest`

One draw on the short-rest pool: heals `rules.shortRest.heal` (dice notation like `"1d8"`, or a flat number) and spends one use of `rules.shortRest.resource` — a declared `{ current, max }` resource that only `full_rest` refills, so each draw spends something real (the D&D Hit Dice rhythm). An empty pool refuses in the world's voice and heals nothing.

Where resting is on offer is yours to author: add a scene option whose pipeline runs this action (with a `timeCost` if resting should spend time, like any option). Such an option renders with the configured heal and the pool's remaining uses as its stat lines, and disables (rather than hides) at an empty pool.

- `log` — see [The `log` convention](#the-log-convention). The default yield includes the roll: `(+6 HP, 1d8: 6)`.

### `set_flag`

Write a persistent flag — the primary way an action records that something happened.

- `flag` *(string, required)* — the flag key.
- `value` *(any, required)* — the value to store. Usually a boolean, but any JSON value works; conditions compare it with strict equality (`{ "flag": "...", "value": ... }`).

Silent by design — flags surface through the scene re-renders and condition gates their writes drive.

### `log`

Print a line to the narrative log.

- `message` *(string)* — the text to print, in the narrator's voice (the `System` label, which the demo locale renders as `[Narrator]`). It resolves the same way as a `log` override: a locale key prints that key's prose, a string that matches no key prints as-is.

### `manage_chest`

Open a chest's deposit/withdraw panel (a custom UI that takes over the interactions panel).

- `chest` *(string, required)* — the chest id. Chests are persistent containers stored per id in the save; a chest is created the first time something is deposited into it, so any id is valid.

### `advance_time`

Advance the world clock. The tick counter always advances and due timers always fire, even without `rules.time` — what needs the config is everything derived from it: days, segments, the `until` form, and the clock's own passage narration. Provide **one** of:

- `amount` *(number, default `0`)* — advance by this many ticks.
- `until` *(string)* — advance to the next start of this day segment instead (e.g. `"morning"`). Needs `rules.time.segments`; an unknown segment warns and does nothing. Asking during the segment itself sleeps to its next occurrence, never zero ticks. When present, `until` takes precedence over `amount`.
- `log` *(string, optional)* — a line to print. Unlike other actions this has no default message; the clock narrates day and segment changes on its own.

Timers that come due during the advance fire here (see `set_timer`).

### `set_timer`

Arm a timer whose pipeline fires when the clock later passes a deadline.

- `id` *(string, required)* — the timer's id. A missing id warns and is ignored. Arming an id that already exists **replaces** the previous timer.
- `afterTicks` *(number, default `0`)* — deadline = the current tick + this many. The default arms a timer that fires on the very next advance.
- `actions` *(action[])* — the pipeline to run at the deadline, restricted to the **quiet** action types: `set_flag`, `log`, `questTrigger`, `set_timer`, `cancel_timer`. A timer changes the world through flags — it can never navigate or start combat from inside the clock advance. Non-quiet actions are stripped with a warning (and flagged at boot).

### `cancel_timer`

Disarm a timer.

- `id` *(string, required)* — the timer to cancel. An unknown id is a no-op.

---

## Conversation actions

These live in conversation nodes (an NPC's `actions` or a response's `actions`), with different guards: `goToConversation` and `trade` warn and no-op outside an active dialogue; `leave` outside one just re-renders the current scene. `questTrigger` is the exception — it runs from any pipeline (scene options, timers, `onVictory`) and sits here only because dialogue is where it is most often authored.

### `goToConversation`

- `node` *(string, required)* — the key of another node in the current NPC's `conversations`. An unknown node warns.

### `trade`

Open the merchant store for the current NPC.

- `tradeDiscount` *(number or numeric string, default `0`)* — a percentage applied to buy prices. Positive is a discount, negative a markup; an unparseable value is treated as `0`.
- `persistDiscount` *(boolean, default `false`)* — when `true` and the discount is non-zero, the discount is saved so it outlasts the conversation (a merchant's earned goodwill — or grudge — persists).

### `leave`

Leave the conversation and return to the current scene. Takes no parameters.

### `questTrigger`

Drive a mission's lifecycle. One trigger performs one transition — a status change *or* a forward stage jump, never both.

- `mission` *(string, required)* — the mission id.
- `status` *(string)* — `"active"` starts the mission (only when it has not started yet; it logs the quest as begun), `"complete"` finishes it (granting the current stage's `rewards`, then `missionRewards`, and logging completion), `"failed"` fails it (only reachable from `active` — a mission that never started cannot fail). `complete` and `failed` are **terminal**: no trigger moves a mission out of them, and their rewards can never re-grant.
- `stage` *(string)* — a stage id from the mission's `stages` to jump forward to. Forward-only: naming the current or an earlier stage is a no-op, so re-running the pipeline never regresses the quest. The stage being left counts as completed — its `rewards` fire; stages skipped over grant nothing.

An unknown mission, or one already complete or failed, is silently skipped — so re-entering a trigger scene is always safe.

The same block can be attached to a scene as `questTrigger` (fired on entry) rather than run as an action; the effect is identical.

Stage *objectives* usually need no trigger at all: a stage with `advanceWhen` in the mission file advances by observation the moment its condition holds — see [Missions in the README](../README.md#loot-tables-flags-missions) for the staged mission format.

---

## Plugin-provided actions

Plugins register their own action types on the same registry, usable in any pipeline. The shipped curator plugin adds two:

### `manage_exhibits`

Open the curator dashboard (a custom UI). Takes no parameters.

### `build_wing`

Build a new museum wing off the hall (the scene flagged `museumHall`).

- `name` *(string, optional)* — the wing's player-facing name; falls back to a numbered default.
- `cost` *(number, optional)* — gold charged; defaults to the plugin config's `wingCost`, then `250`. When the player can't afford it, the action refuses with an in-game line (`ui.notEnoughGold`).

It also refuses when the game has no hall, or no `museumLayout` in the curator's plugin config — a wing's map geometry is derived from the layout, so without one it would land nowhere. The save carries the wing as data (`{ id, name, slot }`); its scene is rebuilt from that on every load.

To add your own action type from a plugin, see [Plugin API](../README.md#plugin-api): `engine.registerAction('my_action', (action, engine) => { ... })`. Custom types are validated against the live registry, so they get the same boot-time typo checking as the built-ins.
