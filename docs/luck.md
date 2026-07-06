# Gravity — Luck System (Design Proposal)

*Status: **proposal, not committed.** Grew out of the same gameplay evaluation as [`time.md`](time.md) and a comparison with Fighting Fantasy gamebooks (2026-07-06). Nothing here is built. Companion candidate for [`ROADMAP.md`](ROADMAP.md) Phase 2.*

---

## Why luck

Fighting Fantasy's cleverest mechanic is **Test Your Luck**: roll 2d6, and if the result is *at or under* your current LUCK you're lucky — then LUCK drops by 1 **regardless of outcome**. Luck is therefore a depleting meta-currency: every invocation is a real spend, restoration is rare, and the standing question — *do I gamble now or hoard it?* — is a genuine decision the player revisits all game.

That property attacks the same wonkiness diagnosed in the gameplay evaluation, from the opposite side as the time proposal. Re-rollable skill checks feel hollow because retries are free; [`time.md`](time.md) makes repetition cost *world pressure*, luck makes it cost a *personal, spendable resource*. Either alone fixes check-spam. Luck is the smaller build, and it also fixes a second finding from that evaluation: on a flat d20 a +1 modifier is noise, while on 2d6-roll-under every point of luck swings the odds by 10–15 percentage points — the stat visibly matters.

The constraint we hold, as always: **never hard-lock content.** Luck runs out, but it is restorable and checks are never the sole route to anything.

## Design at a glance

| Piece | What it is | New machinery? |
|---|---|---|
| **The resource** | `resources.luck { current, max }` alongside hp/ap. | Small: state, clamp, HUD chip, save migration. |
| **Retry currency** | Retrying a failed skill check costs 1 luck. First attempt free. | Small: one gate in the pass-fail/discovery button path. |
| **Test Your Luck** | Authored gamble moments: 2d6 ≤ current luck, then −1 either way. | Moderate: one new check flavor beside the existing three. |
| **Restoration** | Authored only — consumables, rewards, rare scene actions. | Tiny: `restore_luck` action + item attribute. |
| **Conditions** | `{ "luck": { "at_least": 5 } }` leaf. | Tiny: one leaf in `evaluateCondition`. |
| **Combat luck** | FF-style damage gambles. **Optional, default off.** | Moderate; deliberately last. |

## 1. The resource

Luck joins hp/ap as a third resource in `rules.json` `playerDefaults`:

```json
"resources": {
  "hp":   { "current": 10, "max": 10 },
  "ap":   { "current": 3,  "max": 3  },
  "luck": { "current": 7,  "max": 9  }
}
```

`modifyPlayerStat('luck', n)` clamps to `[0, max]` exactly like hp/ap. Save migration seeds the default for old saves (SAVE_VERSION bump). Character creation can offer it in the point-buy (`resources.luck.max`, +1 per point) so "lucky" becomes a build identity next to perceptive/charming/stealthy.

Why 2d6-roll-under instead of the house d20: the bell curve is the point. Odds of being lucky at each value:

| Luck | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|
| Chance | 17% | 28% | 42% | 58% | 72% | 83% | 92% |

Each point matters, and because every test *lowers* luck, the odds visibly decay as you spend — the push-your-luck pressure is built into the math. `dice.js` already parses `NdF` notation, so the roll itself is free to implement.

## 2. Luck as retry currency (the headline)

The change that fixes re-roll spam: **the first attempt at any skill check is free; each retry costs 1 luck.**

- Configured in `rules.json`: `"skillRetryLuckCost": 1` (0 restores today's behavior — the mechanic is opt-in per game).
- Applies to pass/fail and item-discovery checks. The button shows the cost once an attempt has been made; at luck 0 it renders disabled-with-reason, exactly like the existing `requirements.item` treatment of "Unlock the door".
- "Has been attempted" rides the same flag-backed per-scene map the DC-escalation system already uses (`FLAG_KEYS.skillDc`), so no new persistence shape is needed.
- **DC escalation should retire where retry costs exist.** Charging luck *and* raising the DC double-punishes the player who keeps trying — and escalation was the mechanism that produced both the soft-lockout and the leave-and-re-enter exploit. Retry costs replace it cleanly; `increment` can remain for games that set `skillRetryLuckCost: 0`.

Not a hard lock: luck restores (below), other routes exist, and desperate players can choose to walk away and come back luckier. The gamebook framing: Fighting Fantasy readers held a finger between the pages to retry a roll; this makes the finger cost something.

## 3. Test Your Luck as an authored check

A fourth check flavor beside flavor/discovery/pass-fail (`scene.js` dispatch), also usable on dialogue responses:

```json
{
  "luckCheck": true,
  "text": "scene.bridge.riskyJump",
  "actions":   [ { "type": "navigate", "destination": "far_bank" } ],
  "onFailure": [ { "type": "heal", "amount": -4 }, { "type": "set_flag", "flag": "bridge_out", "value": true } ]
}
```

Semantics: roll 2d6 vs. current luck, run `actions` or `onFailure`, then luck −1 **regardless**. No DC to author — the player's own depleting stat *is* the difficulty, which is what makes it a gamble rather than a check. These are one-shot by nature (the situation resolves either way, FF-style fail-forward); authors should always route `onFailure` somewhere, and `validateGameData` can warn when it's missing.

The button should surface the odds ("Test your luck — 7 → 58%") so the gamble is an informed decision; hiding the math would make it a slot machine again.

## 4. Restoring luck

Authored and scarce — scarcity is the entire economy:

- A `restore_luck` action (mirror of `heal`) for pipelines: quest rewards, shrine scenes, a good night's sleep *(if the time proposal ships, sleeping is the natural trickle-restore — see below)*.
- A `luckAmount` item attribute (mirror of `healingAmount`) for consumables: a four-leaf clover, a Potion of Fortune. FF's Potion of Fortune also raised max luck by 1 — a `luckMaxBonus` attribute is a cheap, flavorful rarity tier.
- **Demo tie-in:** the Hearthstone (currently a flavor reward from pacifying the goblins) is begging to become a luck charm — e.g. restores 2 luck, once. The charisma route then hands you exactly the resource that route-taking players value.

## 5. Conditions and fiction

One leaf in `evaluateCondition`, following the existing `gold` pattern:

```json
{ "luck": { "at_most": 2 } }
```

This lets the world *notice* desperation or fortune: a beggar NPC who only bothers cursed-looking travelers, a gambling den that bars the visibly lucky, a scene description variant when you're running on fumes. Cheap to build, high flavor yield.

## 6. Combat luck — optional, default off

FF's combat gambles, translated: after landing a hit, optionally test luck (lucky: +2 damage, unlucky: −1); after taking a hit, optionally test luck (lucky: take 2 less, unlucky: take 1 more). Each test spends luck as usual.

This is the one piece that adds mid-combat UI (a transient prompt between attack resolution and the log line), so it's gated behind `rules.combatLuck: false` and sequenced last. It's also the piece that adds real decision texture to combat *without* positioning, statuses, or AoE — consistent with the stance that combat stays simple. But the proposal stands complete without it.

## Interaction with the time proposal

[`time.md`](time.md) and this document both tax repetition; they are complementary, not competing:

- **Luck** is personal, spendable, and strategic — pressure the player *chooses* to spend.
- **Time** is external and inexorable — pressure the world applies.

Either alone fixes re-roll spam. If both ship, retries should cost **one or the other by default, not both** (`skillRetryLuckCost` and the time system's per-attempt `timeCost` are independent knobs, so this is a tuning decision, not an architecture one). The natural division: retries cost luck; travel, rest, and sleep cost time; sleep restores a point of luck. That loop — spend luck exploring, spend time recovering it — is a complete game economy in two rules.

## Build order (each slice shippable alone)

1. **Resource + retry currency** — `resources.luck`, migration, HUD chip, `skillRetryLuckCost` gate on pass-fail/discovery retries, `restore_luck` action, `luckAmount` consumable attribute, `luck` condition leaf. This slice alone fixes check-spam.
2. **Test Your Luck checks** — the `luckCheck` flavor in scenes and dialogue, odds shown on the button, validator warning for missing `onFailure`, char-creation point-buy entry, demo content (Hearthstone as charm, one authored gamble in the dungeon).
3. **Combat luck** — behind `rules.combatLuck`, off by default.

## Open questions (to settle before building)

- **Dice model.** 2d6-roll-under is FF-authentic and makes each point count, but introduces a second resolution idiom beside d20-vs-DC. Alternative: d20-roll-under-luck×2 keeps one die at the cost of a flat curve. Recommendation: accept the second idiom — *feeling different from skill checks is a feature* (a gamble, not a test).
- **Numbers.** Start 7 / max 9 with +1 per creation point is a first guess; wants playtesting against how many luck sinks the demo actually authors.
- **Retry model.** Flat spend (recommended: pay 1 luck, roll the skill normally) vs. test-to-retry (a Test Your Luck gates whether you may re-roll) — the latter is more FF but stacks two rolls per attempt.
- **Retire DC escalation entirely,** or keep `increment` as a legacy knob for games that opt out of luck?
- **Restoration cadence.** How scarce is scarce? One charm per region? Sleep-restore only with the time system?
- **Naming.** "Luck" is genre-legible but FF-adjacent; "fortune" reads slightly more neutral. Pure taste.
