# Gravity — The Ruleset

*The RPG system, explained in plain words. This is how the game plays with the numbers the demo ships with. Almost every number below lives in `rules.json` or in item/scene data, so each game can tune them. The engine rule is the same everywhere; the demo numbers are the examples.*

---

## The one rule

Everything in the game is decided the same way:

> **Roll one twenty-sided die (1d20). Add one of your attributes. Compare the total to a target number. Equal or higher wins.**

- Outside combat the target is called a **Difficulty Check (DC)**. Example: `1d20 + Perception vs DC 14`.
- In combat the target is the defender's **Armor Class (AC)**. Example: `1d20 + Strength vs AC 7`.

There is no second dice system. Damage and healing use normal dice notation (`1d6`, `2d4+2`, `1d8-1`), but every *decision* is d20 + attribute vs a target.

The math is never hidden. A check button shows which attribute it uses and the DC before you click. The log shows the full roll after: `You search the area: 7 (1d20: 6 + 1 Perception) vs DC 14.`

---

## Your character

### Creating a character

You start with a name and **3 points** to spend. Every point buys:

| Stat | One point gives |
|---|---|
| Health (HP) | +2 max HP (base 10) |
| Armor Class (AC) | +1 AC (base 10) |
| Initiative | +1 (base 0) |
| Strength, Intelligence, Perception, Stealth, Charisma, Luck | +1 each (base 0, max 5) |

### The six attributes

Attributes are small numbers (0–5). They are the bonus you add to a d20 roll:

| Attribute | Used for |
|---|---|
| **Strength** | Melee attacks (swords, fists) |
| **Intelligence** | Spell attacks, and Fireball's bonus damage |
| **Perception** | Noticing and finding things |
| **Stealth** | Sneaking past danger |
| **Charisma** | Talking your way through (haggling, persuading) |
| **Luck** | Checks with no better answer — pure chance moments |

### Resources

| Resource | Demo start | What it does |
|---|---|---|
| **Hit Points (HP)** | 10/10 | Your life. 0 = game over. |
| **Action Points (AP)** | 3/3 | Your budget per combat turn. Only combat spends AP. |
| **Luck Points** | 3/3 | Pay 1 to retry a failed check. Refill on a long rest. |
| **Short Rests** | 3/3 | Draws on the short-rest pool. Refill on a long rest. |
| **Gold** | 0 | Money for trading. |

### XP and leveling

- Defeating enemies and finishing quests gives XP.
- Level-up threshold: **your current level × 100 XP**. Level 1 → 2 costs 100 XP, level 2 → 3 costs 200 XP, and so on. Surplus XP carries over.
- On each level-up you get, immediately:
  - **+5 max HP**, and your HP refills to full.
  - **1 stat point** to spend on the character sheet, same menu as character creation.

---

## Skill checks

Scenes and conversations offer checks. A check card tells you everything up front: what it rolls (`1d20 + Perception`), the DC, and the retry price if there is one.

### How a check resolves

Roll d20 + attribute vs DC. The result lands in one of four **tiers**:

| Tier | When | What it means |
|---|---|---|
| **Critical** | Beat the DC by 5 or more | An extra-good result — only if the scene authored one. Never worse than a normal success. |
| **Success** | Meet or beat the DC | You get the thing. |
| **Partial** | Miss the DC by 3 or less | Fail-forward: you get the thing *with a catch* (damage, noise, worse prices). Only if authored. |
| **Failure** | Miss by more | The authored failure result, which can still move the story. |

Critical and partial only exist where the scene defines them; otherwise a roll is simply success or failure.

### Retries cost Luck

- The **first attempt at a check is always free**.
- Retrying a failed check costs **1 Luck Point**. The button shows the price ("Retry: 1 Luck Point") and disables when you cannot pay.
- Luck Points come back on a long rest.

### Checks can be limited

- Some checks allow only a few attempts (**attempt budget**). When attempts run out, an authored way out fires — the story routes around it, it never dead-locks.
- Some checks roll **exactly once**, whatever the outcome ("one-shot"). Example in the demo: the climb toward the ceiling shimmer — a failure still gets the prize, but you take fall damage.
- **Passive checks** roll silently the first time you enter a scene. A perceptive character just *notices* things without clicking "Look Around".
- **Narrative checks** have no roll at all — they are a story beat framed as a skill.

### Checks live in dialogue too

Conversations can offer checks (the trader's "How about a discount?!", Charisma vs DC 10). Attempt budgets in dialogue reset when you leave the conversation and come back. A one-shot dialogue check stays resolved forever — the demo's haggle marks prices 10% up on a failure, 20% down plus a free potion on a critical.

---

## Combat

### Starting a fight

A fight starts from a scene option (or an ambush on entering a scene). Everyone rolls **initiative: 1d20 + Initiative**.

- Enemies that rolled **higher** than you act **before** your turn each round.
- Enemies at your roll or lower act **after** you. Ties go to you.

### Your turn: Action Points

You have **3 AP** each turn. Your AP refills to full at the start of combat and at the end of every round — spend it or lose it. During your turn you can, in any order:

| Action | AP cost |
|---|---|
| Attack with a weapon | The weapon's cost (Rusty Sword: 1) |
| Cast a spell | The spell's cost (Spark: 1, Flames: 2, Fireball: 3) |
| Attack unarmed | 1 |
| Use an item (Healing Potion) | The item's cost (1) |
| Take a piece of gear off | 1 |
| Put a piece of gear on | The item's AP number (armor is often 0) |
| **End Turn** | Free — hands the round to the slower enemies |

When your AP hits 0, your turn ends by itself.

### Attacking

1. Roll **1d20 + the attack attribute** the weapon names. A sword rolls Strength; a spell rolls Intelligence. Accuracy belongs to the wielder, not the tool.
2. Meet or beat the target's **AC** → hit.
3. Roll the weapon's **damage dice**. Some weapons add an attribute to damage too (Fireball adds Intelligence). Damage never goes below 0.

There are no critical hits on attacks — a natural 20 is just a high roll.

### Hands and weapons

- You have two hand slots (Left Hand, Right Hand). Weapons **and spells** are held in a hand.
- Each equipped weapon or spell gives its own attack button per enemy.
- Both hands empty? You fight with **Unarmed Strike**: 1 AP, 1d20 + Strength, 1d4 damage.

### Spells and charges

- A spell works like a weapon with a **limited number of casts** (charges).
- Spark: 2 charges and Flames: 3 charges, both back after a **short rest**. Fireball: 3 charges, back after a **long rest**.
- A charge is spent when you cast, **hit or miss**.

### Spells from worn gear

Some gear carries a spell. The Cinderband, a circlet you start with, grants **Spark**: 1 AP, 1d6, 2 charges per short rest.

- Wear the item and you can cast the spell. It **takes no hand** — sword and shield both stay.
- Take the item off and the spell leaves your options at once.
- The charges belong to the **spell**, not to the item. Hold Spark in a hand as well and you still get one button drawing on one pool of 2.

### Hitting more than one enemy

Some spells strike several enemies with one cast (Fireball: up to 3 targets).

- One hit roll, compared against **each** target's own AC.
- Every enemy that is hit takes **its own damage roll**.
- A capped spell (`targets: 3`) hits the enemy you aimed at plus its neighbors in order; `targets: "all"` hits everyone.

### Enemy turns

Each enemy has its own AP and weapon and **swings until its AP runs out** (a guard with 2 AP and a 1-AP sword attacks twice per round). Enemies roll the same math you do, against your AC.

### Winning and losing

- **Win** (all enemies at 0 HP): you get the XP of every enemy, the fight's authored loot ("You found 5 Gold. You found the Fireball."), and your AP refills.
- **Lose** (you at 0 HP): game over. Load a save or restart.
- Combat does not advance the world clock unless the scene says so.

---

## Time

The world has a clock that only moves **when you act**. A day is 24 ticks, split into segments: **Morning** (from 6), **Daytime** (from 10), **Evening** (from 18), **Night** (from 22). The top bar shows it: "Day 1: Daytime".

What costs time (demo defaults):

| Act | Ticks |
|---|---|
| Moving to another scene | 1 |
| A skill-check attempt | 0 (a scene can price its own checks) |
| A long rest | Sleeps until next morning |

Scenes can react to time: descriptions change at night, timers can be armed by story events (opening the cellar door starts a 12-tick alarm in the demo) — the world moves on whether you hurry or not.

---

## Resting

Two kinds of rest, D&D-style:

| | Short Rest | Long Rest |
|---|---|---|
| Where | Authored spots (a quiet corridor, the bedroom) | Authored spots (your bed) |
| Cost | 1 draw from your pool of 3 | Sleeps until morning (8+ ticks) |
| Heals | 1d8 HP | All HP |
| Restores | Charges of short-rest spells (Flames) | Everything: Luck Points, the short-rest pool, all spell charges |

The short-rest pool only refills on a long rest. So each draw out in the field spends something real.

Scenes may also offer plain authored heals ("Rest here (+10 HP)") — those are story actions, not the rest system.

---

## Items and gear

### Types

| Type | Examples | What they do |
|---|---|---|
| **Weapon** | Rusty Sword, Hand Axe | Held in a hand; gives attacks |
| **Spell** | Spark, Flames, Fireball | Held in a hand, or granted by worn gear; attacks with charges |
| **Armor** | Leather Armor, Eagle-Eye Amulet, Cinderband | Worn; passive bonuses, and may grant a spell |
| **Consumable** | Healing Potion, Loaf of Bread | Used up; heals or feeds |
| **Special** | Hearthstone | A unique tool with its own action |
| **Flavour** | Cellar Key, Sunstone Shard, relics | Story items; keys, quest goals, museum pieces |

### Equipment slots

Head, Amulet, Torso, Left Hand, Right Hand, Legs.

### Worn bonuses

Armor pieces give bonuses **while worn**: Leather Armor gives +2 AC; the Eagle-Eye Amulet gives +1 Perception. Take it off, lose the bonus. Worn bonuses cannot push a stat past the point-buy cap trickery — the caps compare your base value.

### The Hearthstone

Rub it to teleport home to your sanctuary, from anywhere. Walk back through "Return via Teleport". Home is where beds, storage, and friendly faces live.

---

## Trading

- Every item has a **value** in gold.
- Merchants **sell to you at value** and **buy from you at half value** (rounded).
- Charm can move prices: the demo trader's haggle check gives 20% discount plus a gift on a critical, and *raises* prices 10% if you fail. One shot — choose the moment.

---

## People and conversations

- NPCs talk in **conversation trees**: you pick lines, they answer, new topics open.
- Lines can be **gated**: an option appears only if a condition holds (a quest done, an item carried, a flag set, the time of day).
- Checks can sit inside dialogue (persuasion, haggling), with the same tiers and retry rules as scene checks.
- Some NPCs fight instead of talking. Loot never hangs on the person — it is authored on the fight that drops it.

---

## Quests

- A quest has a name, a description, and rewards (XP, gold) when it completes.
- Bigger quests have **stages**. Each stage says what to do ("Recover two sunstone shards"), can advance itself when its condition is met (carrying 2 shards), and can pay its own reward. The final stage completes the quest and pays the quest reward.
- The Quests tab lists what is active; a dot marks news you have not seen.

---

## Reputation

Reputation is your museum's standing, and it comes from **relics**.

- Some items carry a reputation value (Sunstone Shard: 25, Eldritch Eye: 40).
- The **first time** you obtain a relic, its value is added to your permanent reputation.
- Relics **on display** in the museum add their value again as a bonus while exhibited.
- The world can read your reputation: conversations and prices may react to it.

---

## Death, saving, starting over

- At 0 HP the run ends on a game-over screen.
- **Save** (Options tab) downloads your game as a file. **Load** reads such a file back — also available from the character-creation screen. **Restart** begins fresh.
- Saving is manual. Save before doing something brave.

---

## Where the numbers live (for authors)

| Rule | Where |
|---|---|
| Starting stats, point budget, attributes, resources | `rules.json` → `playerDefaults`, `charCreation`, `customAttributes` |
| XP per level, level-up HP and points | `rules.json` → `xpPerLevel`, `levelUpHpBonus`, `levelUp.statPoints` |
| Retry price and refill | `rules.json` → `skillRetry` |
| Short rest healing and pool | `rules.json` → `shortRest`, `playerDefaults.resources.shortRests` |
| Clock, segments, time prices | `rules.json` → `time` |
| Merchant buy-back ratio, swap-out AP price | `rules.json` → `merchantSellRatio`, `unequipApCost` |
| A weapon's dice, costs, attributes, charges | The item's JSON in `data/items/` (spells in `data/items/spells/`) |
| The spells a worn item grants | That item's `attributes.grantsSpells` |
| A check's DC, tiers, budgets | The scene/NPC JSON in `data/scenes/`, `data/npcs/` |

Deeper authoring detail: [CHECKS.md](CHECKS.md) for checks and time, [ACTIONS.md](ACTIONS.md) for the action pipeline, [ARCHITECTURE.md](ARCHITECTURE.md) for how the engine fits together.
