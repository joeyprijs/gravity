# Gravity Studio: Visual Editor Architecture Plan

This document outlines the architectural blueprint for building **Gravity Studio**, a visual editor for the Gravity Engine. It is intended for the developer who will be implementing the tool.

## 1. Overview & Constraints

The goal of Gravity Studio is to provide a visual interface for authors to build text-RPG campaigns without writing raw JSON. 

**Strict Constraints:**
*   **Zero Dependencies:** The editor must be built using pure Vanilla JavaScript, HTML5, and CSS3. No frameworks (React, Vue, Svelte) and no build tools (Webpack, Vite).
*   **No Backend:** The application must run entirely in the browser as a static site. No databases or Node.js servers.
*   **1:1 Engine Compatibility:** The editor must read and output the exact JSON schemas that the Gravity Engine consumes.

## 2. Directory Structure

The studio should be hosted in a `/studio` directory alongside the main game, or as a completely separate repository.

```text
gravity-studio/
├── index.html          # Main editor layout shell
├── css/
│   └── studio.css      # Grid layouts, dark mode theme
└── js/
    ├── app.js          # Main entry point and global state
    ├── io.js           # Handles File System Access API
    ├── utils.js        # DOM creation helpers (e.g., el('div', { class: 'btn' }))
    ├── components/
    │   ├── sidebar.js  # File explorer tree (Items, NPCs, Scenes)
    │   ├── forms.js    # Auto-generates standard forms from JSON schemas
    │   └── actions.js  # Action pipeline builder UI
    └── complex/
        ├── map.js      # Drag-and-drop visual cartographer
        ├── logic.js    # Condition tree builder
        └── nodes.js    # Dialogue graph editor
```

## 3. Core Systems

### File I/O (File System Access API)
Do not use upload/download forms. The editor should use the modern `window.showDirectoryPicker()` API.
1. User clicks "Open Workspace".
2. Browser requests permission to read/write the `gravity/data/` folder.
3. `io.js` scans the directory, parses all JSON files, and loads them into a global `State` object in `app.js`.
4. When the user clicks "Save", `io.js` writes the updated JSON string back to the original file handle.
*Fallback:* Implement a standard `.zip` export/import for browsers that do not support the File System Access API (e.g., Firefox).

### State Management
Maintain a central `store` object in memory that tracks:
1. `files`: The currently loaded JSON objects.
2. `activeFile`: The file currently open in the main editor view.
3. `dirtyFiles`: A set of files that have been modified and need saving.

## 4. Tackling the Complex UIs (Vanilla JS Approaches)

The primary engineering challenge is building complex interfaces without libraries like React Flow or grid systems.

### A. The Condition Builder (`logic.js`)
**The Problem:** Generating AST-style recursive JSON (`{"and": [{"not": {"flag": "x"}}]}`).
**The Solution:** Nested Flexbox containers.
*   **UI:** Render conditions as visual "blocks" (divs with distinct borders). An `AND` block is a container. 
*   **Interaction:** Every block has an `+ Add Rule` button. Clicking it creates a new row with a `<select>` dropdown (Flag, Item, Level, Nested OR/AND). 
*   **Dynamic Inputs:** Attach an `onchange` listener to the select dropdown. If "Flag" is chosen, render a text input. If "Level" is chosen, render a number input.
*   **Export:** Write a recursive function `buildConditionJSON(domNode)` that walks down the DOM tree of containers and reconstructs the JSON object.

### B. The Dialogue Graph (`nodes.js`)
**The Problem:** Visualizing branching dialogue (`goToConversation`) requires drawing lines between elements.
**The Solution:** Absolute positioned HTML Nodes + an SVG Overlay.
*   **UI:** The workspace is a scrollable `div` (`position: relative`). Conversation nodes are `div` cards (`position: absolute`).
*   **Connections:** Place an `<svg>` element that covers the entire workspace, `pointer-events: none`.
*   **Interaction:** When a user clicks a "Connect" anchor on a response and drags, attach a `mousemove` listener to the workspace that draws an SVG `<path>` bezier curve from the anchor to the mouse cursor.
*   **Data Binding:** When the mouse is released over a target node, update the response's `goToConversation` string to match the target node's ID, and finalize the SVG path.

### C. The Visual Cartographer (`map.js`)
**The Problem:** Authors need to place scenes on a map and generate absolute pixel coordinates (`top`, `left`, `width`, `height`).
**The Solution:** A 2D drag-and-drop canvas.
*   **UI:** A large grid background. Scenes with `mapDefinitions` are rendered as draggable `div` rectangles.
*   **Interaction:** Implement standard drag-and-drop (`mousedown`, `mousemove`, `mouseup`). 
*   **Snapping:** Enforce grid snapping using a simple math function: `Math.round(val / GRID_SIZE) * GRID_SIZE`.
*   **Export:** On `mouseup`, read the element's CSS `top` and `left` properties, strip the `px`, and update the scene's `mapDefinitions` object in memory.

## 5. Recommended Implementation Phases

1.  **Phase 1: I/O & Basic Forms.** Implement the File System Access API, the sidebar, and generic text/number forms for editing `items` and `rules`. This proves the zero-dependency architecture works.
2.  **Phase 2: Scenes & Action Pipelines.** Build the UI to add/remove actions from an option's `actions` array dynamically.
3.  **Phase 3: The Condition Builder.** Implement the nested flexbox logic.
4.  **Phase 4: The Map & Node Editors.** Implement the custom drag-and-drop canvas and SVG connection logic.
