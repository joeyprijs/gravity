import { CSS, EL } from "./config.js";

/**
 * Reads a value from a nested object using a dot-separated path.
 * e.g. getByPath(player, 'resources.hp.current') → player.resources.hp.current
 */
export function getByPath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

/**
 * Sets a value on a nested object using a dot-separated path.
 * e.g. setByPath(player, 'resources.hp.max', 15)
 */
export function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

/**
* Creates a new DOM element.
*
* Content is set via textContent — game data (item names, descriptions,
* locale strings) is always treated as plain text, never HTML. The only
* sanctioned HTML channels are scene description bodies (see
* buildSceneDescription) and engine-authored structural templates; dynamic
* values embedded in those must go through escapeHtml().
*
* @param {string} tag - The HTML tag name.
* @param {string|string[]} [className] - Optional CSS class names.
* @param {string} [textContent] - Optional plain-text content.
* @returns {HTMLElement} The constructed DOM element.
*/
export function createElement(tag, className = "", textContent = "") {
  const el = document.createElement(tag);
  if (className) {
    if (Array.isArray(className)) {
      el.classList.add(...className.filter(Boolean));
    } else {
      el.className = className;
    }
  }
  if (textContent) {
    el.textContent = textContent;
  }
  return el;
}

/**
 * Escapes HTML special characters so a string can be safely embedded in an
 * HTML fragment. Use for any dynamic value (player input, save-file data)
 * that flows into innerHTML.
 * @param {string} str - The raw string.
 * @returns {string} The escaped string.
 */
export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
 * Returns the display label for an item: its name from the items data map
 * (falling back to the raw ID) plus an "(xN)" suffix when amount > 1.
 * @param {Object} itemsData - The item database (engine.data.items).
 * @param {string} itemId - The item identifier.
 * @param {number} [amount=1] - Stack size.
 * @returns {string} e.g. "Healing Potion (x3)".
 */
export function getItemLabel(itemsData, itemId, amount = 1) {
  const name = itemsData[itemId]?.name || itemId;
  return amount > 1 ? `${name} (x${amount})` : name;
}

/**
 * Resets the scene options panel to an empty state: clears the option button
 * container, removes injected option sections, and clears + hides the skills
 * container. The location reminder is re-appended as the container's first
 * child; pass reminderText to also update its text.
 * @param {string|null} [reminderText=null] - New text for the location reminder.
 * @returns {{panel: HTMLElement, container: HTMLElement, skillsContainer: HTMLElement, reminder: HTMLElement|null}}
 */
export function resetOptionsPanel(reminderText = null) {
  const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
  const container = document.getElementById(EL.SCENE_OPTIONS);
  const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
  const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

  clearElement(container);
  clearElement(skillsContainer);
  skillsContainer.setAttribute('hidden', '');
  panel.querySelectorAll(`.${CSS.SCENE_OPTIONS_SECTION}`).forEach(el => el.remove());

  if (reminder) {
    if (reminderText !== null) reminder.innerText = reminderText;
    container.appendChild(reminder);
  }
  return { panel, container, skillsContainer, reminder };
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
    let html = body;
    if (body && !/^\s*\[/.test(body)) {
      let label = 'Narrator';
      if (typeof window !== 'undefined' && window.gameEngine && typeof window.gameEngine.t === 'function') {
        const translated = window.gameEngine.t('log.Narrator');
        if (translated !== 'log.Narrator') {
          label = translated;
        }
      }
      html = `[${label}] ${body}`;
    }
    p.innerHTML = html;
    div.appendChild(p);
  }
  return div;
}

/**
 * Builds an option button:
 *   button.option-btn > span[text] + optional span.option-btn__badge
 *
 * Pass reqText to show a badge on the right (AP cost, price, skill DC, etc.).
 * Returns the button element — caller sets .onclick and .disabled.
 */

export function buildOptionButton(text, reqText = null) {
  const classes = reqText !== null
    ? [CSS.BTN, CSS.OPTION_BTN, CSS.OPTION_BTN_STACKED]
    : [CSS.BTN, CSS.OPTION_BTN];
  const btn = createElement('button', classes);
  btn.appendChild(createElement('span', '', text));
  if (reqText !== null) {
    btn.appendChild(createElement('span', CSS.OPTION_BTN_BADGE, reqText));
  }
  return btn;
}
