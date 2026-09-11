import { createElement, buildSceneDescription } from '../core/utils.js';
import { EL, CSS } from '../core/config.js';

// The scrollable narrative panel, and the current scene block subsystems
// append to.
export class NarrativeLog {
  // t rebuilds descriptions on restore; state holds the persisted log.
  constructor(t = null, state = null) {
    this.t = t;
    this.state = state;
    this.el = document.getElementById(EL.SCENE_NARRATIVE);
    this.currentSceneEl = null;
    this._lastLogType = null;
    // The newest [Player] choice line in the current block, for amendLast.
    this._lastChoice = null;
    this._scrollRaf = undefined;

    // Capture phase: the flush runs before the button's own onclick.
    document.addEventListener('click', e => {
      if (e.target.closest(`button.${CSS.CARD}`)) this.flushNew();
    }, true);
  }

  openScene(modifier = '') {
    // No flush: one move can open several blocks, all new until the next click.
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

  flushNew() {
    this.el.querySelectorAll(`.${CSS.SCENE_NEW}`)
      .forEach(el => el.classList.remove(CSS.SCENE_NEW));
  }

  // Consecutive entries from one source group: the label is omitted and the
  // gap tightened.
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

  // type is the [Label], variant the CSS suffix. persist=false is for
  // transient notices. Returns the entry element.
  log(type, message, variant = 'system', persist = true) {
    const p = this._appendEntry(type, message, variant, true);
    if (variant === 'choice') this._lastChoice = { el: p, persisted: persist };
    this.scrollToBottom();
    if (persist) this.state?.appendLog({ type, message, variant });
    return p;
  }

  // Appends the yield to the block's newest choice line, so act and yield
  // stay one line even when narrator lines landed in between. False when
  // there is no choice line; the caller logs its own.
  amendLast(suffix) {
    if (!this._lastChoice) return false;
    this._lastChoice.el.append(` ${suffix}`);
    if (this._lastChoice.persisted) this.state?.amendLog(` ${suffix}`);
    this.scrollToBottom();
    return true;
  }

  // Returns the last scene description, for SceneRenderer.restoreFromSave.
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
    // Restored history is not new.
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

  // Puts the entry at the top of the panel. Cancels the queued scroll to the
  // bottom, so call it after the last append.
  scrollToEntry(entryEl) {
    cancelAnimationFrame(this._scrollRaf);
    this._scrollRaf = requestAnimationFrame(() => {
      this.el.scrollTop += entryEl.getBoundingClientRect().top - this.el.getBoundingClientRect().top;
    });
  }
}
