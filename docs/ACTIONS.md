# Action Reference

Actions are the mutation half of the engine: the ordered pipeline a scene option, dialogue response, skill-check outcome, `onVictory`, or timer runs when it fires. Each entry is `{ "type": "name", ...params }`. This is the complete parameter reference; the [README](../README.md#actions-mutations) has the at-a-glance catalogue.

## How pipelines run

- **Order matters.** Actions execute top to bottom. Every action in the array runs, but a *navigating* action (`navigate`, `return`, `dialogue`, `combat`, `manage_chest`, and dialogue's `trade`/`leave`) hands the interactions panel to a new surface — so the caller stops re-rendering the old one once navigation has happened. The practical rule: **put state changes before navigation**, so the destination sees them.

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

The state-changing actions — `loot`, `heal`, `full_rest`, `modify_ap`, `modify_resource`, and `advance_time` — write a default sentence to the narrative log. Two optional controls, shared by all of them:

- `"log": false` — silence the default message entirely.
- `"log": "Some text."` — replace the default with your own line.

`advance_time` is the one exception in shape: it has **no** default message and logs *only* when you pass a string (its day/segment-change narration is produced separately by the clock). The other action types (`navigate`, `set_flag`, `combat`, `dialogue`, timers, …) don't take `log` at all.

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

An unknown `item` is ignored with a console warning (and flagged at boot).

### `combat`

Start a turn-based encounter.

- `enemies` *(string[], required)* — the NPC ids to fight. Any id currently flagged friendly (via `makeFriendly`) is filtered out; if every enemy has been befriended, no fight starts and the encounter is narrated as avoided.
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

Restore the player at a resting point. Takes no effect parameters. Sets HP to full, restores AP according to `rules.apEconomy.restRestore` (full by default), and refills the retry currency by `rules.skillRetry.restRestore` (clamped to its max) when one is configured.

- `log` — see [The `log` convention](#the-log-convention).

### `modify_ap`

Move Action Points mid-story — the narrative valve of the AP economy.

- `amount` *(number or `"full"`, default `"full"`)* — a number moves AP within `[0, max]`; a negative number drains; `"full"` (or omitting `amount`) tops the pool up to max. If the resolved change is zero (already full, or already empty and draining), the action is silent and does nothing.
- `log` — see [The `log` convention](#the-log-convention).

### `modify_resource`

The generic sibling of `modify_ap`: move any declared `{ current, max }` resource (a custom currency like luck points or favor).

- `resource` *(string, required)* — the resource name. Must be a `{ current, max }` resource declared in `rules.playerDefaults.resources`; an undeclared name warns and does nothing (and is flagged at boot).
- `amount` *(number or `"full"`, default `"full"`)* — same semantics as `modify_ap`.
- `log` — see [The `log` convention](#the-log-convention). The resource's display name comes from the `ui.resources.<resource>` locale key.

### `set_flag`

Write a persistent flag — the primary way an action records that something happened.

- `flag` *(string, required)* — the flag key.
- `value` *(any, required)* — the value to store. Usually a boolean, but any JSON value works; conditions compare it with strict equality (`{ "flag": "...", "value": ... }`).

Silent by design — flags surface through the scene re-renders and condition gates their writes drive.

### `log`

Print a line to the narrative log.

- `message` *(string)* — the text to print, as a System line. This is **literal text**, not a locale key — it is the one action that emits a raw authored string, so it does not localize.

### `manage_chest`

Open a chest's deposit/withdraw panel (a custom UI that takes over the interactions panel).

- `chest` *(string, required)* — the chest id. Chests are persistent containers stored per id in the save; a chest is created the first time something is deposited into it, so any id is valid.

### `advance_time`

Advance the world clock (requires `rules.time`; without it the clock stays dormant and this is a no-op). Provide **one** of:

- `amount` *(number, default `0`)* — advance by this many ticks.
- `until` *(string)* — advance to the next start of this day segment instead (e.g. `"morning"`). Needs `rules.time.segments`; an unknown segment warns and does nothing. Asking during the segment itself sleeps to its next occurrence, never zero ticks. When present, `until` takes precedence over `amount`.
- `log` *(string, optional)* — a line to print. Unlike other actions this has no default message; the clock narrates day and segment changes on its own.

Timers that come due during the advance fire here (see `set_timer`).

### `set_timer`

Arm a timer whose pipeline fires when the clock later passes a deadline.

- `id` *(string, required)* — the timer's id. A missing id warns and is ignored. Arming an id that already exists **replaces** the previous timer.
- `afterTicks` *(number)* — deadline = the current tick + this many.
- `atTick` *(number)* — an absolute deadline tick instead. Takes precedence over `afterTicks`.
- `actions` *(action[])* — the pipeline to run at the deadline, restricted to the **quiet** action types: `set_flag`, `log`, `questTrigger`, `set_timer`, `cancel_timer`. A timer changes the world through flags — it can never navigate or start combat from inside the clock advance. Non-quiet actions are stripped with a warning (and flagged at boot).

### `cancel_timer`

Disarm a timer.

- `id` *(string, required)* — the timer to cancel. An unknown id is a no-op.

---

## Conversation actions

These are valid **only inside conversation nodes** (an NPC's `actions` or a response's `actions`). Used outside a dialogue they warn and no-op.

### `goToConversation`

- `node` *(string, required)* — the key of another node in the current NPC's `conversations`. An unknown node warns.

### `trade`

Open the merchant store for the current NPC.

- `tradeDiscount` *(number or numeric string, default `0`)* — a percentage applied to buy prices. Positive is a discount, negative a markup; an unparseable value is treated as `0`.
- `persistDiscount` *(boolean, default `false`)* — when `true` and the discount is non-zero, the discount is saved so it outlasts the conversation (a merchant's earned goodwill — or grudge — persists).

### `leave`

Leave the conversation and return to the current scene. Takes no parameters.

### `makeFriendly`

Mark the current NPC friendly. Takes no parameters. Subsequent `combat` actions naming this NPC skip it, so a talked-down guard stays talked down.

### `questTrigger`

Drive a mission's lifecycle.

- `mission` *(string, required)* — the mission id.
- `status` *(string, required)* — `"active"` starts the mission (only when it has not started yet; it logs the quest as begun) or `"complete"` finishes it (granting `missionRewards` and logging completion). An unknown mission, or one already complete, is silently skipped — so re-entering a trigger scene is safe.

The same block can be attached to a scene as `questTrigger` (fired on entry) rather than run as an action; the effect is identical.

---

## Plugin-provided actions

Plugins register their own action types on the same registry, usable in any pipeline. The shipped curator plugin adds two:

### `manage_exhibits`

Open the curator dashboard (a custom UI). Takes no parameters.

### `add_display`

Install a display case in a scene.

- `scene` *(string, optional, default: the current scene)* — the scene to add the case to.
- `cost` *(number, default `0`)* — gold charged to install it; the action refuses and warns when the player can't afford it.
- `name` *(string, optional)* — the case's label; falls back to a default name.

To add your own action type from a plugin, see [Plugin API](../README.md#plugin-api): `engine.registerAction('my_action', (action, engine) => { ... })`. Custom types are validated against the live registry, so they get the same boot-time typo checking as the built-ins.
