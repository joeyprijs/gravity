import { CSS } from "./config.js";

/**
* Creates a new DOM element.
* @param {string} tag - The HTML tag name.
* @param {string|string[]} [className] - Optional CSS class names.
* @param {string} [innerHTML] - Optional inner HTML content.
* @returns {HTMLElement} The constructed DOM element.
*/
export function createElement(tag, className = "", innerHTML = "") {
  const el = document.createElement(tag);
  if (className) {
    if (Array.isArray(className)) {
      el.classList.add(...className.filter(Boolean));
    } else {
      el.className = className;
    }
  }
  if (innerHTML) {
    el.innerHTML = innerHTML;
  }
  return el;
}

/**
* Clears all child elements from a parent DOM element.
* @param {HTMLElement|string} elementOrId - The element or its ID.
*/
export function clearElement(elementOrId) {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (el) {
    el.innerHTML = '';
  }
}

/**
 * Builds the standard scene header block:
 *   div.scene__description > h2.scene__title + optional p.scene__body
 *
 * title is set via textContent (plain text — NPC/scene names are not trusted HTML).
 * body is set via innerHTML and may contain authored HTML (<br>, <span>, etc.).
 * Omit body (or pass null) for scenes that have no description paragraph.
 */
export function buildSceneDescription(title, body = null) {
  const div = createElement('div', CSS.SCENE_DESCRIPTION);
  const h2 = createElement('h2', CSS.SCENE_TITLE);
  h2.textContent = title;
  div.appendChild(h2);
  if (body !== null) {
    const p = createElement('p', CSS.SCENE_BODY);
    // body is trusted HTML authored in game JSON (scene descriptions, NPC text).
    // It intentionally supports inline markup (<br>, <em>, etc.). Never pass
    // user-supplied or save-file-derived content here.
    p.innerHTML = body;
    div.appendChild(p);
  }
  return div;
}

/**
 * Builds an option button:
 *   button.option-btn > span[text] + optional span.option-btn__badge[--cost|--sell]
 *
 * Pass reqText to show a requirement/cost badge on the right.
 * Pass isSell=true for the sell variant (green badge instead of muted).
 * Returns the button element — caller sets .onclick and .disabled.
 */

export function buildOptionButton(text, reqText = null, isSell = false) {
  const classes = reqText !== null
    ? [CSS.BTN, CSS.OPTION_BTN, CSS.OPTION_BTN_STACKED]
    : [CSS.BTN, CSS.OPTION_BTN];
  const btn = createElement('button', classes);
  btn.appendChild(createElement('span', '', text));
  if (reqText !== null) {
    const cls = isSell ? [CSS.OPTION_BTN_BADGE, CSS.OPTION_BTN_BADGE_SELL] : [CSS.OPTION_BTN_BADGE, CSS.OPTION_BTN_BADGE_COST];
    btn.appendChild(createElement('span', cls, reqText));
  }
  return btn;
}
