# Gravity

A browser-based text RPG inspired by classic choose-your-own-adventure games. Navigate branching scenes, fight enemies with D&D-style combat, manage your inventory, track quests, and explore a growing world — all in the browser with zero dependencies.

## Features

- **Scene system** — branching narrative driven by JSON scene definitions; choices can require items, check state flags, trigger quests, and more
- **D&D-style combat** — turn-based fights using HP, Armor Class, Action Points, Initiative, and Level/XP
- **Inventory & equipment** — collect, equip, and use items across weapons, armor, spells, and consumables
- **Quest log** — missions triggered by scene entry, tracked as active or completed
- **World map** — minimap HUD showing your current region, click to open a scrollable full world map
- **Save / Load** — export and import save files to persist progress across sessions

## Tech Stack

| Concern | Choice |
|---|---|
| Language | Vanilla JavaScript (ES modules) |
| Markup | HTML5 |
| Styling | Plain CSS (custom properties, glass-morphism UI) |
| Build | None — runs directly in the browser |
| Dependencies | None |

## Project Structure

```
gravity/
├── index.html          # Entry point
├── css/
│   └── styles.css      # All styles
├── src/
│   ├── engine.js       # Game orchestrator — loads data, wires systems together
│   ├── state.js        # Game state management and save/load
│   ├── scene.js        # Scene rendering and navigation
│   ├── combat.js       # Combat system
│   ├── dialogue.js     # NPC dialogue and store system
│   ├── narrative.js    # Narrative log and scroll behaviour
│   ├── quests.js       # Quest management
│   ├── map.js          # Minimap HUD and world map overlay
│   ├── ui.js           # UI rendering (inventory, equipment, quests)
│   ├── config.js       # Shared constants
│   └── utils.js        # DOM helpers
└── data/
    ├── index.json      # Manifest — regions, world map size
    ├── scenes/         # Scene definitions (grouped by region)
    ├── items/          # Item definitions
    ├── npcs/           # NPC and enemy definitions
    └── missions/       # Quest definitions
```

## Running Locally

No build step required. Open `index.html` directly in a browser, or serve the directory to avoid ES module CORS restrictions:

```bash
npx serve .
# or
python3 -m http.server
```

Then open `http://localhost:3000` (or whichever port your server uses).

## Adding Content

All game content lives in `data/` as JSON files and is loaded at runtime by the engine.

- **New scene** — add a JSON file under `data/scenes/<region>/` and register it in `data/index.json`
- **New item** — add a JSON file under `data/items/` and register it in `data/index.json`
- **New NPC/enemy** — add a JSON file under `data/npcs/` and register it in `data/index.json`
- **New quest** — add a JSON file under `data/missions/` and register it in `data/index.json`
- **World map placement** — add a `mapDefinitions` block to a scene with `top`, `left`, `width`, `height` (in px, relative to the 3000×2000 world canvas) and a `background` colour
