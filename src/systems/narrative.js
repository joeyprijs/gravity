import { gameState } from "../core/state.js";
import { createElement, buildSceneDescription } from "../core/utils.js";
import { EL, CSS } from "../core/config.js";

// NarrativeLog manages the scrollable narrative panel — the stream of scene
// descriptions, player choices, and system messages that forms the game log.
// It also owns the currentSceneEl reference (the active scene DOM node) so
// subsystems can append content to the correct container.
export class NarrativeLog {
  // t: locale lookup (engine.t) used when rebuilding scene descriptions on
  // save restore — passed in explicitly so this module never reaches back
  // into the engine through globals.
  constructor(t = null) {
    this.t = t;
    this.el = document.getElementById(EL.SCENE_NARRATIVE);
    this.currentSceneEl = null;
    this.isGameStart = true;
    this._scrollRaf = undefined;

    // Flush scene--new from log entries before each option-btn action fires.
    // Capture phase ensures the flush runs before the button's onclick handler.
    document.addEventListener('click', e => {
      if (e.target.closest(`.${CSS.OPTION_BTN}`)) {
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
    this.scrollToBottom();
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

  /**
   * Appends a line to the current scene block in the narrative log.
   *
   * @param {string} type - The label prefix (e.g. LOG.SYSTEM, LOG.PLAYER).
   * @param {string} message - The message text (rendered as plain text).
   * @param {string} [variant='system'] - CSS variant suffix for styling.
   * @param {boolean} [persist=true] - When false, the entry is shown but not
   *   saved to the persisted log (used for transient notices like "loaded").
   */
  log(type, message, variant = 'system', persist = true) {
    if (!this.currentSceneEl) this.openScene();
    const p = createElement('p', [CSS.SCENE_LOG, `${CSS.SCENE_LOG}--${variant}`, CSS.SCENE_NEW]);
    p.appendChild(createElement('span', CSS.SCENE_LOG_PREFIX, `[${type}]`));
    p.append(` ${message}`);
    this.currentSceneEl.appendChild(p);
    this.scrollToBottom();
    if (persist) gameState.appendLog({ type, message, variant });
  }

  /**
   * Rebuilds the narrative DOM from a persisted log (used on save load).
   *
   * @param {object[]} logEntries - The persisted log entries (see appendLog).
   * @returns {?string} The last rendered scene description, so SceneRenderer can
   *   restore its state; null if no scene entry was present.
   */
  restore(logEntries) {
    let lastDesc = null;
    logEntries.forEach(entry => {
      if (entry.type === 'scene') {
        this.openScene();
        this.currentSceneEl.appendChild(buildSceneDescription(entry.title, entry.desc, this.t));
        lastDesc = entry.desc;
      } else {
        if (!this.currentSceneEl) this.openScene();
        const p = createElement('p', [CSS.SCENE_LOG, `${CSS.SCENE_LOG}--${entry.variant}`]);
        p.appendChild(createElement('span', CSS.SCENE_LOG_PREFIX, `[${entry.type}]`));
        p.append(` ${entry.message}`);
        this.currentSceneEl.appendChild(p);
      }
    });
    this.scrollToBottom();
    return lastDesc;
  }

  scrollToBottom() {
    cancelAnimationFrame(this._scrollRaf);
    this._scrollRaf = requestAnimationFrame(() => {
      this.el.scrollTop = this.el.scrollHeight;
    });
  }
}
