# Gravity: Museum Curator RPG Concept & Engine Feature Proposals

This document outlines the conceptual design and engine extension plans for a cozy, narrative-driven **Museum Curator RPG** built on top of the **Gravity Engine**. 

---

## 1. The Core Narrative Concept

### The Backstory & Hook
* **The Player:** An 18-year-old starting their adult life in a quiet, forgotten village.
* **The Conflict:** Your family has owned and run the local historical museum for generations. However, with massive technological advancements and societal shifts, people have lost interest in the past. The museum is dying, and unpaid bills are accumulating.
* **The Parents:** Out of profound love, your parents send you out into the world on your 18th birthday to seek adventure, build a life, and leave the dying village behind. They *do not care* if the museum dies—they care about *you*.
* **The Goal:** Because you grew up hearing the magical stories behind every display case, you refuse to let the museum fade away. You set off into a world of magic, advanced tech, combat, and ancient mysteries to find lost artifacts, restore the museum, and save your family legacy.

### The Gameplay Loop
```
[ Explore Wilds / Dungeons ] ➔ [ Recover Ancient Relics ] ➔ [ Curate Museum Exhibits ] 
          ▲                                                                 │
          │                                                                 ▼
[ Invest in Gear & Upgrades ] ◄─── [ Earn Donations & Reputation ] ◄─── [ Attract Visitors ]
```

---

## 2. Leverage Existing Gravity Subsystems

Gravity’s current data-driven architecture is already 80% ready to handle this game loop:

| Existing Subsystem | Museum RPG Implementation |
| :--- | :--- |
| **Custom Attributes** (`rules.json`) | Track player stats like **Antiquity** (history/runes/magic) and **Modernity** (tech/hacking/machinery). |
| **Chest System** (`chest-ui.js`) | Re-purpose chests into **Museum Display Cases**. Items placed in these cases are physically exhibited. |
| **AST-Logic Conditions** (`condition.js`) | Dynamically change museum scene descriptions and visitor spawn rates based on which relics are in display cases or global museum flags. |
| **Quests & Missions** (`quests.js`) | Track "Outreach" missions, advertising campaigns, and landmark relic recovery quests. |

---

## 3. Proposed Engine Features & Plugins

To fully realize the cozy curation and narrative mechanics, the following modular extensions can be added to the engine or implemented via the **Plugin API**:

### A. Dynamic Exhibit & Passive Income System
Convert static chests into revenue-generating exhibits that calculate visitor interest.
* **Item Metadata:** Add a `historicalValue` or `appeal` integer to relic item JSONs:
  ```json
  {
    "name": "Etheric Core",
    "type": "Flavour",
    "historicalValue": 75,
    "attributes": {
      "rarity": "Legendary",
      "techLevel": 4
    }
  }
  ```
* **The Plugin Mechanism:** A custom background hook that runs when resting or returning to town. It sums the `historicalValue` of all items deposited in designated museum chests, generating gold donations:
  $$\text{Gold Earned} = \left( \sum \text{Relic Appeal} \right) \times \text{Museum Reputation}$$

### B. Relic Lore & Playable "Memory Echoes"
Allow players to interactively examine relics to unlock their backstory and learn new skills.
* **Item Action Hook:** Add an optional `inspectScene` navigation trigger to relics:
  ```json
  {
    "name": "Ancient Crest",
    "inspectScene": "flashback_ancient_battle"
  }
  ```
* **The Flashback Mechanic:** Clicking **Inspect** on a relic in your collection temporarily transports you to a historical scene, where you play as the ancient hero who used the relic. Completing the short vignette unlocks a unique combat spell or permanent stat boost in the present.

### C. The Stacking Bills & Parent Letters
Inject a wholesome yet motivating tension into the economy.
* **The Mailbox Mechanic:** Every few in-game days or completed quests, a letter arrives from home.
* **Wholesome Tension:** The letters from your parents contain small gifts and say, *"Sweetheart, don't worry about the museum bills, we're doing fine! Go enjoy your adventure!"*
* **The Interaction:** You can choose to deposit gold into a "Family Fund" chest at home to pay down the debt, unlocking heartwarming narrative responses, upgraded museum aesthetics, and rare family heirlooms.

### D. Magic vs. Technology Alignment
Deepen the roleplay elements by letting players choose how they modernize the museum.
* **Curator Choice:** 
  * If you exhibit high-tech relics (cyber-cores, robotic parts), you attract corporate patrons and technologists, unlocking high-tech shop items and modern conveniences.
  * If you exhibit magical antiquities (runic staves, dragon bones), you attract spellcasters and traditional historians, unlocking deep magical knowledge and artifacts.
* **Hybrid Systems:** Build display halls that contrast both eras, reflecting the evolving world outside.

### E. Museum Reputation & Dynamic Visitor Spawns
Make the museum feel alive as it gains popularity.
* **Reputation System**:
  * **Items**: Rare relics have a `reputation` value (configured via Gravity Studio).
  * **Player Reputation**: Tracked under `attributes.reputation` in the Skills sheet. Increases when acquiring a reputation-bearing relic for the first time.
  * **Museum Reputation**: Calculated dynamically:
    $$\text{Museum Reputation} = \text{Museum Permanent Reputation} + \text{Museum Display Reputation}$$
    * **Museum Permanent Reputation** increases permanently whenever the player's reputation increases (spreading the word in the outer world).
    * **Museum Display Reputation** is a dynamic value that sums the reputations of all items currently exhibited in display cases inside the museum.
  * **Curator Panel**: The dashboard displays the live museum reputation score.
* **Dynamic NPCs:** Create conditional NPC spawns in your home village based on reputation thresholds.
  * At *Reputation 1*: Only a couple of local children wander in.
  * At *Reputation 5*: Travelling merchants, eccentric wealthy collectors, and academy researchers visit, offering premium prices for duplicates or giving you high-stakes archaeological leads.

---

## 4. Initial Content Roadmap

To build a vertical slice of this concept, we can draft:
1. **The Starting Scene (`home_bedroom.json`):** Your 18th birthday morning, talking to your parents.
2. **The Museum Room (`home_museum.json`):** Containing your first empty Display Case (Chest) and a couple of dusty default relics.
3. **The First Relic Quest:** A journey to a nearby cave to recover the **"Sunstone Shard"**, exhibiting it, and watching the village description update dynamically to celebrate the museum's first new visitor.
