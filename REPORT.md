# Gravity Engine - Architecture & Extensibility Audit

## Executive Summary
The Gravity engine boasts a well-structured, decoupled core for its event systems and data loading (`engine.js`), and implements modern reactive state management (`state.js`). 

Following the most recent rounds of massive structural refactoring, the engine has successfully transitioned from a rigid, D&D-flavored prototype into a **truly universal, reskinnable RPG framework**. By aggressively decoupling terminology across the backend, implementing Vanilla JS Data-Bindings to rescue the frontend, and transitioning to a unified Action-Array sequence pattern across the entire engine, it has achieved the holy grail of "no-code" extendability.

This report documents the finalized architecture of the Gravity Engine.

---

## 1. The Unified Action Array Pipeline
**Status: Perfect Execution**

The most powerful feature of the engine is its Action Registry (`engine.registerAction()`), which allows developers to create custom logic (plugins) that can be triggered natively via JSON without editing source code. 

Previously, scene options and NPC dialogues had wildly different, inconsistent data structures. Now, they are completely synchronized into the **Action Array Pipeline**.
*   **Sequential Pipeline:** Both physical scenes (`scene.js`) and NPC dialogue nodes (`dialogue.js`) uniformly iterate through an `"actions": []` array, firing events sequentially. 
*   **Plugin Agnosticism:** If a creator builds a brilliant space-hacking minigame and registers it as `"type": "hack_terminal"`, they can trigger it by pressing a glowing button on a computer terminal (a scene) OR by telling a cyborg NPC a secret password (a dialogue branch). The global registry supports both equally.

```json
"actions": [
  { "type": "giveItem", "item": "wayfinder_charm" },
  { "type": "setFlag", "flag": "took_charm", "value": true },
  { "type": "goToConversation", "node": "charm_given" } 
]
```
This grants creators infinite chaining capabilities. You can give a player an item, trigger combat, set a flag, and navigate to a new scene simultaneously simply by adding lines to the JSON array without writing a drop of JavaScript.

*(Note: Claude has successfully aliased `loot` to `giveItem`, allowing the use of the semantically cleaner name when scripting NPCs handing the player items).*

---

## 2. JSON "Humanization" & UI Data Binding (MVC Separation)
**Status: Exceptional Pattern**

Previously, `rules.json` attempted to dictate the UI structure using CSS properties (`"cssClass": "stat-item--hp"`), violating the Model-View-Controller separation by forcing presentation logic into the data layer.

*   **View-Side Domination:** The presentation logic has been completely ripped out of `rules.json`. `index.html` has taken back total control over how the UI is grouped, styled, and laid out.
*   **Zero-JS Data Binding:** In the most elegant addition to the engine, `index.html` now uses attributes like `data-stat-bind="resources.hp.current"`. The `ui.js` script simply scans the DOM for these tags and auto-fills them with data from the state tree. 
*   **Result:** Creators can rip apart the UI, build entirely custom HTML layouts, and inject game logic instantly just by adding a `data-stat-bind` HTML attribute.

---

## 3. Hardcoded `engine.log` Triggers & Overrides
**Status: Solved with Overrides**

*   **Silent Execution:** Pipeline actions now fully support `"log": false`. This allows designers to execute background mechanics or stealth maneuvers without spamming the system log.
*   **Custom Narration:** By passing `"log": "You slowly bandage your wounds"`, creators can override the generic systemic translation block and dictate the exact pacing and tone of an interaction.

---

## 4. Experience Curve & Economy
**Status: Strong (Config-Driven Logic)**
Systemic constants like `xpPerLevel`, `levelUpHpBonus`, and `merchantSellRatio` have been successfully pulled out of JavaScript and into `rules.json`. Support for configurations like `"levelingCurve": "linear"` opens the door for extending the leveling pipeline with custom algebraic equations securely isolated from the core state manager.

---

## 5. Save State & Migration Management
**Status: Exceptional Architecture**
The newly added `v7` migration elegantly bridges the gap between the game's old, flat player schema and its new abstract `resources/attributes` format without damaging active saves. Crucially, the exposure of `registerMigration()` ensures plugins altering game mechanics can safely register their own save-file migrations, keeping the core engine perfectly separated from game-specific schemas.

---

## Final Verdict
The engine’s internal architecture is incredibly robust, fully abstracted, and entirely prepared for visual authoring. The framework is completely agnostic to game genre (fantasy vs sci-fi) and mechanics (combat vs puzzle), requiring no source-code changes to completely redefine the rules of the universe. Gravity represents a highly mature, production-ready framework for data-driven game design.
