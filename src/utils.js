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
    p.innerHTML = body;
    div.appendChild(p);
  }
  return div;
}

/**
 * Builds an option button:
 *   button.option-btn > span[text] + optional span.option-btn__req-text[--sell]
 *
 * Pass reqText to show a requirement/cost badge on the right.
 * Pass isSell=true for the sell variant (green badge instead of muted).
 * Returns the button element — caller sets .onclick and .disabled.
 */
/**
 * Switches the options container between list and 2-column grid layout
 * based on how many buttons it contains. Non-button children (e.g. stat bars)
 * are excluded from the count and automatically span all columns via CSS.
 * Call this after every render that populates the options container.
 */
export function applyOptionsLayout(container, threshold = 5) {
  const btnCount = Array.from(container.children).filter(c => c.tagName === 'BUTTON').length;
  container.classList.toggle('scene__options--grid', btnCount >= threshold);
}

export function buildOptionButton(text, reqText = null, isSell = false) {
  const btn = createElement('button', CSS.OPTION_BTN);
  btn.appendChild(createElement('span', '', text));
  if (reqText !== null) {
    const cls = isSell ? CSS.OPTION_BTN_REQ_SELL : CSS.OPTION_BTN_REQ;
    btn.appendChild(createElement('span', cls, reqText));
  }
  return btn;
}
