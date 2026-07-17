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
 * Collapse/expand wiring for section-toggle headings, with the collapsed-key
 * set persisted under one localStorage key — a UI preference, not game
 * state. `defaultCollapsed` applies only while nothing is stored yet: an
 * explicitly stored empty set means the player expanded everything, and
 * wins. Collapsing hides the body element in place — no re-render, so its
 * bindings and buttons survive. Used by the inventory panel and the sheet
 * tab, each with its own storage key.
 *
 * @param {string} storageKey - localStorage key holding the collapsed keys.
 * @param {string[]} [defaultCollapsed] - Keys collapsed on first run.
 * @returns {{wire: function(HTMLElement, HTMLElement, string): void}}
 */
export function createSectionToggles(storageKey, defaultCollapsed = []) {
  let collapsed;
  try {
    const stored = globalThis.localStorage?.getItem(storageKey);
    collapsed = new Set(stored ? JSON.parse(stored) : defaultCollapsed);
  } catch {
    collapsed = new Set(defaultCollapsed);
  }
  const save = () => {
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify([...collapsed]));
    } catch { /* storage unavailable (private mode) — state stays per-session */ }
  };
  return {
    // Applies the current state to a heading/body pair and flips it
    // (persisting) on heading clicks. onclick, not addEventListener, so
    // re-wiring after a re-render replaces the handler instead of stacking.
    wire(heading, body, key) {
      const applyState = (isCollapsed) => {
        body.hidden = isCollapsed;
        heading.classList.toggle(CSS.SECTION_TOGGLE_COLLAPSED, isCollapsed);
      };
      applyState(collapsed.has(key));
      heading.onclick = () => {
        const nowCollapsed = !collapsed.delete(key);
        if (nowCollapsed) collapsed.add(key);
        applyState(nowCollapsed);
        save();
      };
    },
  };
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
 * The attribute deltas one equipment piece carries while worn: its
 * attributeBonuses map, plus the legacy armorClassBonus folded into 'ac'.
 * equipItem/unequipItem apply these on swap, so a relic can raise any
 * declared attribute the way armor has always raised AC.
 * @param {object|null} itemData - The item definition, or null for an empty slot.
 * @returns {Object<string, number>}
 */
export function equipmentAttributeBonuses(itemData) {
  const map = { ...(itemData?.attributes?.attributeBonuses || {}) };
  const acBonus = itemData?.attributes?.armorClassBonus ?? 0;
  if (acBonus) map.ac = (map.ac ?? 0) + acBonus;
  return map;
}

// Item attributes the generic stat-line loop must skip: authoring data that
// isn't a player-facing stat (a scene id on a card helps nobody), and
// attackAttribute, which gets its own "Uses:" line above the loop.
const HIDDEN_ITEM_ATTRS = new Set(['teleportScene', 'attackAttribute', 'actionPoints']);

/**
 * The display name of an attribute (actions.skillBadgeFree.<id>), falling
 * back to the capitalized id. Takes the translate function directly so
 * DOM-free helpers can use it; skillLabel (skill-checks.js) is the
 * engine-flavored wrapper.
 * @param {function} t - The engine's translate function.
 * @param {string} attrId - Attribute ID (e.g. "perception").
 * @returns {string}
 */
export function attributeLabel(t, attrId) {
  const key = `actions.skillBadgeFree.${attrId}`;
  const name = t(key);
  return name !== key ? name : attrId.charAt(0).toUpperCase() + attrId.slice(1);
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
 * @param {Object<string, number>} [attributes] - The wielder's attributes,
 *   used to show the governing attribute's current modifier.
 * @returns {string[]} Stat lines, possibly empty.
 */
export function itemStatLines(t, itemData, attributes = {}) {
  const lines = [];
  const apCost = itemData.attributes?.actionPoints;
  if (apCost !== undefined) {
    lines.push(t('itemStats.actionPoints', { value: apCost }));
  }
  // The hit line shows the governing attribute with the wielder's current
  // modifier ("Uses: Strength +2") — accuracy is the wielder's, so show theirs.
  const attackAttr = itemData.attributes?.attackAttribute;
  if (attackAttr) {
    const mod = attributes[attackAttr] ?? 0;
    lines.push(t('itemStats.hit', {
      attribute: attributeLabel(t, attackAttr),
      value: mod >= 0 ? `+${mod}` : `${mod}`,
    }));
  }
  if (itemData.attributes) {
    for (const k in itemData.attributes) {
      if (HIDDEN_ITEM_ATTRS.has(k)) continue;
      const v = itemData.attributes[k];
      // attributeBonuses renders one line per worn bonus ("Perception: +1").
      if (k === 'attributeBonuses' && v && typeof v === 'object') {
        for (const [attr, amt] of Object.entries(v)) {
          const value = amt >= 0 ? `+${amt}` : `${amt}`;
          lines.push(t('itemStats.attributeBonus', { attribute: attributeLabel(t, attr), value }));
        }
        continue;
      }
      // modifyResource is an object-shaped attribute with a display line:
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
  panel.querySelectorAll(`.${CSS.PANEL_SECTION_DYNAMIC}`).forEach(el => el.remove());

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
 * Prefixes a description body with the translated "[Narrator]" label, wrapping
 * the body in a span that scopes ::first-letter styling (drop caps) to
 * narration. A body that already carries a leading "[label]" (NPC speech)
 * stays unwrapped on purpose. Shared by buildSceneDescription and the
 * in-place description refresh so the two can't drift.
 *
 * @param {string} body - Authored HTML body.
 * @param {((key: string) => string)|null} [t=null] - Locale lookup (engine.t);
 *   plain "Narrator" when omitted or untranslated.
 * @returns {string}
 */
export function narratorLabelHtml(body, t = null) {
  if (!body || /^\s*\[/.test(body)) return body;
  const translated = t ? t('log.Narrator') : null;
  const label = translated && translated !== 'log.Narrator' ? translated : 'Narrator';
  return `[${label}] <span class="${CSS.SCENE_BODY_TEXT}">${body}</span>`;
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
    p.innerHTML = wrapLogPrefix(narratorLabelHtml(body, t));
    div.appendChild(p);
  }
  return div;
}

/**
 * One sheet attribute row — the label/value line the sheet tab's sections
 * are made of, shared so plugin rows injected into them (e.g. the curator's
 * reputation) can't drift from the sheet's markup. The label is escaped;
 * valueHtml is engine-authored markup (data-stat-bind spans).
 *
 * @param {string} label - Display label (plain text).
 * @param {string} valueHtml - HTML for the value cell.
 * @param {string} [extraClasses] - Extra classes on the row element.
 * @returns {string} HTML for one .attr-list__row.
 */
export function attrRowHtml(label, valueHtml, extraClasses = '', trailingHtml = '') {
  return `<div class="attr-list__row${extraClasses ? ` ${extraClasses}` : ''}">
    <span class="attr-list__label">${escapeHtml(label)}</span>
    <span class="attr-list__value">${valueHtml}</span>${trailingHtml}
  </div>`;
}

/**
 * Builds an interactive card (button.card) with a title and optional accent
 * stat lines — the standard clickable option (see buildCard). Pass reqText
 * for the stat lines (AP cost, price, skill DC, retry cost — a line or an
 * array of lines). Returns the button element — caller sets .onclick and
 * .disabled.
 */

export function buildOptionButton(text, reqText = null) {
  return buildCard({ tag: 'button', title: text, stats: reqText ?? undefined });
}

/**
 * Builds a card — THE standard block for anything presented as a titled box:
 * scene options, skill checks, dialogue responses, combat attacks, inventory
 * items, quests, chest rows, exhibits. One DOM shape and one class
 * vocabulary, so a designer restyles every card in the game from the .card
 * block in styles.css:
 *
 *   <tag class="card">
 *     <.card__title>     the bold first line
 *     <.card__body>      0..n muted secondary lines
 *     <.card__stats>     accent stat lines, one element per fact — a real
 *                        <ul>/<li> in container cards; block <span>s inside
 *                        button cards (buttons allow phrasing content only)
 *     <.card__actions>   optional row of action buttons
 *
 * Interactive cards are <button class="card"> — the whole card is the
 * control (scene options, chest rows). Container cards are <div>/<li>
 * carrying their controls in .card__actions (inventory items).
 *
 * @param {object} spec
 * @param {string} [spec.tag='div'] - 'button' | 'div' | 'li'.
 * @param {string} [spec.title] - Title line.
 * @param {string|string[]} [spec.body] - Muted line(s); empties are skipped.
 * @param {string|string[]} [spec.stats] - Accent stat lines. Strings (array
 *   elements included) are split on \n so game packs with multi-line locale
 *   strings keep working.
 * @param {HTMLElement[]} [spec.actions] - Buttons for the actions row.
 * @param {string[]} [spec.classes] - Extra classes on the card element.
 * @returns {HTMLElement}
 */
export function buildCard({ tag = 'div', title, body, stats, actions = [], classes = [] } = {}) {
  // Buttons may not contain block elements — inline children only.
  const child = tag === 'button' ? 'span' : 'div';
  const card = createElement(tag, [CSS.CARD, ...classes]);
  if (title) card.appendChild(createElement(tag === 'button' ? 'span' : 'strong', CSS.CARD_TITLE, title));
  for (const line of (Array.isArray(body) ? body : [body])) {
    if (line) card.appendChild(createElement(child, CSS.CARD_BODY, line));
  }
  const statLines = stats == null ? []
    : (Array.isArray(stats) ? stats : [stats]).flatMap(s => String(s).split('\n')).filter(Boolean);
  if (statLines.length > 0) {
    // Screen readers flatten a button to its text anyway, so the spans lose
    // nothing over a list there; CSS displays both shapes as one-fact rows.
    const [listTag, lineTag] = tag === 'button' ? ['span', 'span'] : ['ul', 'li'];
    const list = createElement(listTag, CSS.CARD_STATS);
    statLines.forEach(line => list.appendChild(createElement(lineTag, '', line)));
    card.appendChild(list);
  }
  if (actions.length > 0) {
    const row = createElement('div', CSS.CARD_ACTIONS);
    actions.forEach(a => row.appendChild(a));
    card.appendChild(row);
  }
  return card;
}
