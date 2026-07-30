import { createElement, buildSceneDescription } from "../core/utils.js";
import { EL, CSS } from "../core/config.js";

// NarrativeLog manages the scrollable narrative panel — the stream of scene
// descriptions, player choices, and system messages that forms the game log.
// It also owns the currentSceneEl reference (the active scene DOM node) so
// subsystems can append content to the correct container.
export class NarrativeLog {
  // t: locale lookup (engine.t) used when rebuilding scene descriptions on
  // save restore; state: the engine's StateManager (persisted log). Both are
  // passed in explicitly so this module never reaches back through globals.
  constructor(t = null, state = null) {
    this.t = t;
    this.state = state;
    this.el = document.getElementById(EL.SCENE_NARRATIVE);
    this.currentSceneEl = null;
    this._lastLogType = null;
    this._scrollRaf = undefined;

    // Flush scene--new from log entries before each interactive card
    // (option button) fires. Capture phase ensures the flush runs before
    // the button's onclick handler.
    document.addEventListener('click', e => {
      if (e.target.closest(`button.${CSS.CARD}`)) {
        this.flushScenes();
        this.flushEntries();
      }
    }, true);
  }

  openScene(modifier = '') {
    // No flush here: one move can open several scene blocks (a scene that
    // starts combat, a dialogue that becomes a trade). They're all new since
    // the player's last move, so they all keep the rail until the next click.
    const classes = [CSS.SCENE, CSS.SCENE_NEW];
    if (modifier) classes.push(modifier);
    const scene = createElement('div', classes);
    this.el.appendChild(scene);
    this.scrollToBottom();
    this.currentSceneEl = scene;
    this._lastLogType = null;
    this._lastChoice = null;
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
    // Consecutive entries from the same source group into one block: the
    // repeated [Label] is omitted and the gap tightened (scene__log--grouped).
    if (type === this._lastLogType) {
      p.classList.add(`${CSS.SCENE_LOG}--grouped`);
    } else {
      p.appendChild(createElement('span', CSS.SCENE_LOG_PREFIX, type));
    }
    p.append(` ${message}`);
    this._lastLogType = type;
    if (variant === 'choice') this._lastChoice = { el: p, persisted: persist };
    this.currentSceneEl.appendChild(p);
    this.scrollToBottom();
    if (persist) this.state?.appendLog({ type, message, variant });
  }

  /**
   * Extends the current scene block's newest choice line in place with
   * ` suffix` — how an act and its yield stay one line ("Eat a Snack
   * (+2 HP)"): the option's [Player] line is already written when its
   * pipeline runs, so the handler amends it rather than logging a second
   * entry. Narrator lines may land in between (an act that advances time
   * logs the tick and any due timers first), so the amend reaches back to
   * the choice line — but never past the scene block it lives in. With no
   * choice line to amend, the caller logs the yield as its own line instead.
   *
   * @param {string} suffix - The yield, already translated ("(+2 HP)").
   * @returns {boolean} True if a line was amended.
   */
  amendLast(suffix) {
    if (!this._lastChoice) return false;
    this._lastChoice.el.append(` ${suffix}`);
    if (this._lastChoice.persisted) this.state?.amendLog(` ${suffix}`);
    this.scrollToBottom();
    return true;
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
        // Mirror log()'s grouping so a restored log reads the same as it did live.
        if (entry.type === this._lastLogType) {
          p.classList.add(`${CSS.SCENE_LOG}--grouped`);
        } else {
          p.appendChild(createElement('span', CSS.SCENE_LOG_PREFIX, entry.type));
        }
        p.append(` ${entry.message}`);
        this._lastLogType = entry.type;
        this.currentSceneEl.appendChild(p);
      }
    });
    // Restored history is not new — only what happens after the load is.
    this.flushScenes();
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
