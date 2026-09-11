import { createElement, buildSceneDescription } from '../core/utils.js';
import { EL, CSS } from '../core/config.js';

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
    // The newest [Player] choice line in the current block, for amendLast.
    this._lastChoice = null;
    this._scrollRaf = undefined;

    // Flush scene--new from log entries before each interactive card
    // (option button) fires. Capture phase ensures the flush runs before
    // the button's onclick handler.
    document.addEventListener('click', e => {
      if (e.target.closest(`button.${CSS.CARD}`)) this.flushNew();
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

  // Nothing on screen is new any more — scene blocks and log entries alike.
  flushNew() {
    this.el.querySelectorAll(`.${CSS.SCENE_NEW}`)
      .forEach(el => el.classList.remove(CSS.SCENE_NEW));
  }

  // One log <p> in the current scene block. Consecutive entries from the same
  // source group into one block: the repeated [Label] is omitted and the gap
  // tightened (scene__log--grouped).
  _appendEntry(type, message, variant, isNew) {
    if (!this.currentSceneEl) this.openScene();
    const p = createElement('p', [CSS.SCENE_LOG, `${CSS.SCENE_LOG}--${variant}`]);
    if (isNew) p.classList.add(CSS.SCENE_NEW);
    if (type === this._lastLogType) {
      p.classList.add(`${CSS.SCENE_LOG}--grouped`);
    } else {
      p.appendChild(createElement('span', CSS.SCENE_LOG_PREFIX, type));
    }
    p.append(` ${message}`);
    this._lastLogType = type;
    this.currentSceneEl.appendChild(p);
    return p;
  }

  // Appends a line to the current scene block: type is the [Label] prefix
  // (LOG.SYSTEM, LOG.PLAYER), variant the CSS suffix. persist=false shows the
  // entry without saving it to the persisted log (transient notices like
  // "loaded"). Returns the entry element (see scrollToEntry).
  log(type, message, variant = 'system', persist = true) {
    const p = this._appendEntry(type, message, variant, true);
    if (variant === 'choice') this._lastChoice = { el: p, persisted: persist };
    this.scrollToBottom();
    if (persist) this.state?.appendLog({ type, message, variant });
    return p;
  }

  // Extends the current scene block's newest choice line in place with
  // ` suffix` (the translated yield, "(+2 HP)") — how an act and its yield
  // stay one line: the option's [Player] line is already written when its
  // pipeline runs, so the handler amends it rather than logging a second
  // entry. Narrator lines may land in between (an act that advances time
  // logs the tick and any due timers first), so the amend reaches back to
  // the choice line — but never past the scene block it lives in. Returns
  // false with no choice line to amend; the caller then logs the yield as
  // its own line instead.
  amendLast(suffix) {
    if (!this._lastChoice) return false;
    this._lastChoice.el.append(` ${suffix}`);
    if (this._lastChoice.persisted) this.state?.amendLog(` ${suffix}`);
    this.scrollToBottom();
    return true;
  }

  // Rebuilds the narrative DOM from a persisted log (save load). Returns the
  // last rendered scene description so SceneRenderer can restore its state,
  // or null if no scene entry was present.
  restore(logEntries) {
    let lastDesc = null;
    logEntries.forEach(entry => {
      if (entry.type === 'scene') {
        this.openScene();
        this.currentSceneEl.appendChild(buildSceneDescription(entry.title, entry.desc, this.t));
        lastDesc = entry.desc;
      } else {
        this._appendEntry(entry.type, entry.message, entry.variant, false);
      }
    });
    // Restored history is not new — only what happens after the load is.
    this.flushNew();
    this.scrollToBottom();
    return lastDesc;
  }

  scrollToBottom() {
    cancelAnimationFrame(this._scrollRaf);
    this._scrollRaf = requestAnimationFrame(() => {
      this.el.scrollTop = this.el.scrollHeight;
    });
  }

  // Scrolls the log so the given entry (returned by log()) sits at the top of
  // the panel — how a book's retelling starts on its first line instead of its
  // last. Cancels the scroll-to-bottom the appended entries themselves queued,
  // so this must be called after the last of them.
  scrollToEntry(entryEl) {
    cancelAnimationFrame(this._scrollRaf);
    this._scrollRaf = requestAnimationFrame(() => {
      this.el.scrollTop += entryEl.getBoundingClientRect().top - this.el.getBoundingClientRect().top;
    });
  }
}
