# Contributing to Gravity

First off, thank you for taking the time to contribute! Gravity is a dependency-free, browser-native text RPG engine and creator studio built entirely with Vanilla JavaScript and HTML5.

Following these guidelines helps ensure the project remains high-performance, lightweight, and maintainable.

Before diving in, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — it documents the boot flow, module graph, and the data/plugin contracts (conditions, actions, events, hooks) the engine is built on.

---

## 1. Ground Rules & Code Design

Gravity holds a strict commitment to the following architectural design principles:
1.  **Zero Third-Party Production Dependencies:** The core engine and studio run directly in the browser via native ES Modules. Do not introduce npm compilation dependencies (like webpack, Babel, or React) in the core runtimes.
2.  **Unidirectional Reactive State:** All game mutations must proceed strictly through `gameState` (an instance of `StateManager` in `state.js`), which triggers UI re-renders reactively via listeners. Never manipulate HTML element values directly from action/combat logic code.
3.  **Cross-Subsystem Decoupling:** Subsystems (Combat, Narrative, Scene, Quests, Dialogue) must remain completely decoupled, avoiding circular imports. Communication is routed through the Event Bus (`engine.emit` and `engine.on`) or thin coordinator delegates on `RPGEngine`.
4.  **JSDoc on Public APIs:** Exported functions, shared helper utilities, and any method called from other modules must carry formal JSDoc blocks (`/** ... */`) documenting parameter types and return values. For internal/private methods, a concise comment explaining *why* the code exists is preferred over restating *what* it does.

---

## 2. Setting Up Your Development Environment

Setting up the workspace is designed to be extremely fast with zero installation required:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/joeyprijs/gravity.git
    cd gravity
    ```
2.  **Serve Locally:**
    Serve the root directory to avoid local ES Module CORS restrictions:
    ```bash
    # Option A: Node serve (if installed)
    npx serve .
    
    # Option B: Python server
    python3 -m http.server 3000
    ```
    Then open `http://localhost:3000` (or the port indicated by serve).

---

## 3. Writing and Running Tests

Gravity utilizes Node.js's native test runner (available in Node 18+). There are **no testing package dependencies** required.

*   **Running the Suite:**
    ```bash
    npm test
    ```
*   **Creating New Tests:**
    All test files live under the `tests/` directory and match the `*.test.js` pattern. When adding a new mechanic or fixing a bug, write a companion test case using Node's standard assertions (`node:assert`):
    ```javascript
    import test from 'node:test';
    import assert from 'node:assert';
    import { roll } from '../src/systems/dice.js';

    test('custom mechanics test case description', () => {
      const result = roll(1, 1);
      assert.strictEqual(result, 1);
    });
    ```

---

## 4. Submitting a Pull Request (PR)

1.  **Create a Feature Branch:** Branch from the `main` head.
    ```bash
    git checkout -b feature/my-cool-mechanic
    ```
2.  **Format and Comment:** Document public APIs with JSDoc (see Ground Rules). Write descriptive inline comments for complex mathematical transformations, rendering optimizations, or state checks.
3.  **Run Checks:** Ensure that `npm test` runs successfully with 100% assertions passing before opening a PR.
4.  **Open PR:** Open a Pull Request on GitHub detailing your changes, reproduction cases, and test results.
