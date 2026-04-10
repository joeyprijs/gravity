import { gameState } from "./state.js";
import { createElement, buildSceneDescription } from "./utils.js";
import { EL, CSS } from "./config.js";

// NarrativeLog manages the scrollable narrative panel — the stream of scene
// descriptions, player choices, and system messages that forms the game log.
// It also owns the currentSceneEl reference (the active scene DOM node) so
// subsystems can append content to the correct container.
export class NarrativeLog {
  constructor() {
    this.currentSceneEl = null;
    this.isGameStart = true;
  }

  // Lazily resolved so the element doesn't need to exist at construction time
  get el() {
    return document.getElementById(EL.SCENE_NARRATIVE);
  }

  openScene(modifier = '') {
    this.flush();
    const classes = [CSS.SCENE, CSS.SCENE_NEW];
    if (modifier) classes.push(modifier);
    const scene = createElement('div', classes);
    this.el.appendChild(scene);
    this.el.scrollTop = this.el.scrollHeight;
    this.currentSceneEl = scene;
    return scene;
  }

  flush() {
    if (this.isGameStart) return;
    this.el.querySelectorAll(`.${CSS.SCENE_NEW}`).forEach(el => el.classList.remove(CSS.SCENE_NEW));
  }

  log(type, message, variant = 'system', persist = true) {
    this.flush();
    if (!this.currentSceneEl) this.openScene();
    const p = createElement('p', [CSS.SCENE_LOG, `${CSS.SCENE_LOG}--${variant}`]);
    p.innerText = `[${type}] ${message}`;
    this.currentSceneEl.appendChild(p);
    this.el.scrollTop = this.el.scrollHeight;
    if (persist) gameState.appendLog({ type, message, variant });
  }

  // Rebuilds the narrative DOM from a persisted log (used on save load).
  // Returns the last rendered scene description so SceneRenderer can restore its state.
  restore(logEntries) {
    let lastDesc = null;
    logEntries.forEach(entry => {
      if (entry.type === 'scene') {
        this.openScene();
        this.currentSceneEl.appendChild(buildSceneDescription(entry.title, entry.desc));
        lastDesc = entry.desc;
      } else {
        if (!this.currentSceneEl) this.openScene();
        const p = createElement('p', [CSS.SCENE_LOG, `${CSS.SCENE_LOG}--${entry.variant}`]);
        p.innerText = `[${entry.type}] ${entry.message}`;
        this.currentSceneEl.appendChild(p);
      }
    });
    this.el.scrollTop = this.el.scrollHeight;
    return lastDesc;
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.el.scrollTop = this.el.scrollHeight;
    });
  }

  // Observes the options panel for size changes and scrolls to bottom — catches
  // cases where new options render without the narrative itself changing size.
  setupScrollObserver() {
    const resizeObserver = new ResizeObserver(() => {
      this.el.scrollTop = this.el.scrollHeight;
    });
    resizeObserver.observe(document.getElementById(EL.SCENE_OPTIONS));
  }
}
