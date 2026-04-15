import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription } from "../core/utils.js";
import { EL, CSS } from "../core/config.js";

// NarrativeLog manages the scrollable narrative panel — the stream of scene
// descriptions, player choices, and system messages that forms the game log.
// It also owns the currentSceneEl reference (the active scene DOM node) so
// subsystems can append content to the correct container.
export class NarrativeLog {
  constructor() {
    this.el = document.getElementById(EL.SCENE_NARRATIVE);
    this.currentSceneEl = null;
    this.isGameStart = true;

    // Flush scene--new from log entries before each option-btn action fires.
    // Capture phase ensures the flush runs before the button's onclick handler.
    document.addEventListener('click', e => {
      if (e.target.closest('button')) {
        this.flushScenes();
        this.flushEntries();
      }
    }, true);
  }

  openScene(modifier = '') {
    this.flushScenes();
    const classes = [CSS.SCENE, CSS.SCENE_NEW];
    if (modifier) classes.push(modifier);
    const scene = createElement('div', classes);
    this.el.appendChild(scene);
    this.el.scrollTop = this.el.scrollHeight;
    this.currentSceneEl = scene;
    return scene;
  }

  // Removes scene--new from .scene container divs only.
  flushScenes() {
    this.el.querySelectorAll(`.${CSS.SCENE}.${CSS.SCENE_NEW}`)
      .forEach(el => el.classList.remove(CSS.SCENE_NEW));
  }

  // Removes scene--new from log <p> entries only.
  flushEntries() {
    this.el.querySelectorAll(`p.${CSS.SCENE_NEW}`)
      .forEach(el => el.classList.remove(CSS.SCENE_NEW));
  }

  log(type, message, variant = 'system', persist = true) {
    if (!this.currentSceneEl) this.openScene();
    const p = createElement('p', [CSS.SCENE_LOG, `${CSS.SCENE_LOG}--${variant}`, CSS.SCENE_NEW]);
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
      requestAnimationFrame(() => {
        this.el.scrollTop = this.el.scrollHeight;
      });
    });
  }
}
