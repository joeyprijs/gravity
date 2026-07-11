import { CSS, EL } from "./config.js";

/**
 * Reads a value from a nested object using a dot-separated path.
 * e.g. getByPath(player, 'resources.hp.current') → player.resources.hp.current
 *
 * @param {object} obj - The object to read from.
 * @param {string} path - Dot-separated path (e.g. 'resources.hp.current').
 * @returns {*} The value at the path, or undefined if any segment is missing.
 */
export function getByPath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

// Keys that would let a dotted path reach an object's prototype chain. Blocked
// so setByPath can never be used as a prototype-pollution sink.
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Sets a value on a nested object using a dot-separated path.
 * e.g. setByPath(player, 'resources.hp.max', 15)
 * Path segments touching the prototype chain are rejected.
 *
 * @param {object} obj - The target object.
 * @param {string} path - Dot-separated path (e.g. 'resources.hp.max').
 * @param {*} value - The value to assign at the path.
 */
export function setByPath(obj, path, value) {
  const parts = path.split('.');
  if (parts.some(p => UNSAFE_PATH_KEYS.has(p))) return;
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
 * Normalizes rules.apEconomy into a complete knob set. Every default
 * reproduces the engine's classic behavior (AP refills fully at combat
 * boundaries, every round, and on rest; skill checks are free; no per-turn
 * floor or cap), so games without the block play exactly as before.
 *
 * @param {object|null} rules - The loaded rules object.
 * @returns {{refillOnCombatStart: boolean, refillPerRound: ('full'|number),
 *   restRestore: ('full'|number), minPerTurn: number, maxPerTurn: number,
 *   skillAttemptCost: number}}
 */
export function apEconomyRules(rules) {
  const eco = rules?.apEconomy || {};
  return {
    refillOnCombatStart: eco.refillOnCombatStart !== false,
    refillPerRound: eco.refillPerRound ?? 'full',
    restRestore: eco.restRestore ?? 'full',
    minPerTurn: eco.minPerTurn ?? 0,
    maxPerTurn: eco.maxPerTurn ?? 0,
    skillAttemptCost: eco.skillAttemptCost ?? 0,
  };
}

/**
 * Builds the displayable stat lines for an item — one string per stat, in a
 * fixed order: AP cost, hit modifier (signed), then scalar attributes. Known
 * stats resolve their label through the locale (itemStats.<key>); unknown
 * attribute keys fall back to "key: value". Shared by the combat attack
 * buttons and the inventory panel so an item reads the same in both.
 *
 * @param {function} t - The engine's translate function.
 * @param {object} itemData - The item definition from data/items.
 * @returns {string[]} Stat lines, possibly empty.
 */
export function itemStatLines(t, itemData) {
  const lines = [];
  if (itemData.actionPoints !== undefined) {
    lines.push(t('itemStats.actionPoints', { value: itemData.actionPoints }));
  }
  if (itemData.bonusHitChance !== undefined) {
    const mod = itemData.bonusHitChance;
    lines.push(t('itemStats.bonusHitChance', { value: mod >= 0 ? `+${mod}` : `${mod}` }));
  }
  if (itemData.attributes) {
    for (const k in itemData.attributes) {
      const v = itemData.attributes[k];
      // modifyResource is the one object-shaped attribute with a display line:
      // the resource's label plus a signed amount ("Luck Points: +1").
      if (k === 'modifyResource' && v?.resource) {
        const labelKey = `ui.resources.${v.resource}`;
        const label = t(labelKey) !== labelKey ? t(labelKey) : v.resource;
        const value = typeof v.amount === 'number' && v.amount >= 0 ? `+${v.amount}` : `${v.amount}`;
        lines.push(t('itemStats.modifyResource', { resource: label, value }));
        continue;
      }
      if (typeof v === 'object') continue;
      const key = `itemStats.${k}`;
      const line = t(key, { value: v });
      lines.push(line !== key ? line : `${k}: ${v}`);
    }
  }
  return lines;
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
 * Wraps a leading "[label]" prefix in a styling span so it can be themed
 * separately from the body that follows. Only a prefix at the very start is
 * matched (the engine treats a leading bracket as a speaker/log label); a
 * no-op when the text has no leading prefix.
 *
 * @param {string} html - Trusted HTML that may start with a "[label]" prefix.
 * @returns {string} The HTML with any leading prefix wrapped in a span.
 */
export function wrapLogPrefix(html) {
  return String(html).replace(
    /^(\s*)\[([^\]]*)\]/,
    `$1<span class="${CSS.SCENE_LOG_PREFIX}">[$2]</span>`
  );
}

/**
 * Builds the standard scene header block:
 *   div.scene__description > h2.scene__title + optional p.scene__body
 *
 * title is set via textContent (plain text — NPC/scene names are not trusted HTML).
 * body is set via innerHTML and may contain authored HTML (<br>, <span>, etc.).
 * Omit body (or pass null) for scenes that have no description paragraph.
 *
 * @param {string} title - The scene/speaker title.
 * @param {string|null} [body=null] - Authored HTML body, or null for none.
 * @param {((key: string) => string)|null} [t=null] - Locale lookup (engine.t)
 *   used to translate the Narrator label; plain "Narrator" when omitted.
 */
export function buildSceneDescription(title, body = null, t = null) {
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
      const translated = t ? t('log.Narrator') : null;
      const label = translated && translated !== 'log.Narrator' ? translated : 'Narrator';
      // The span scopes ::first-letter styling (drop caps) to narration —
      // pre-labelled bodies (NPC speech) stay unwrapped on purpose.
      html = `[${label}] <span class="${CSS.SCENE_BODY_TEXT}">${body}</span>`;
    }
    p.innerHTML = wrapLogPrefix(html);
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
