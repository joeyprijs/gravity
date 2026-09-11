import { CSS, EL, HAND_SLOT_KIND } from './config.js';
import { iconHtml } from './icons.js';
import { translateOr } from './i18n.js';

// getByPath(player, 'resources.hp.current'); undefined if a segment is missing.
export function getByPath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

// Blocked in setByPath so a dotted path can never pollute the prototype chain.
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// setByPath(player, 'resources.hp.max', 15); a prototype-chain segment is a no-op.
export function setByPath(obj, path, value) {
  const parts = path.split('.');
  if (parts.some(p => UNSAFE_PATH_KEYS.has(p))) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

// Content goes in as textContent: game data is never HTML. The only HTML
// channels are scene description bodies (buildSceneDescription) and
// engine-authored templates, where dynamic values pass through escapeHtml().
export function createElement(tag, className = '', textContent = '') {
  const el = document.createElement(tag);
  if (Array.isArray(className)) el.classList.add(...className.filter(Boolean));
  else if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

// For any dynamic value (player input, save data) that flows into innerHTML.
export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Expanded sections per group, so a panel re-render within one visit keeps
// them open. In memory only: never saved, dropped on every tab switch.
const sectionExpandState = new Map();

// Every toggle group built this session, so collapseAllSections can reach a
// panel that is not re-rendered when it opens (the sheet).
const sectionGroups = new Set();

// Called on tab switch: a tab always opens as headings only.
export function collapseAllSections() {
  for (const group of sectionGroups) group.collapseAll();
}

// Collapse/expand wiring for the section headings of one panel (the inventory
// and the sheet each have a group). Collapsing hides the body in place, so its
// bindings and buttons survive without a re-render.
export function createSectionToggles(groupKey) {
  let expanded = sectionExpandState.get(groupKey);
  if (!expanded) {
    expanded = new Set();
    sectionExpandState.set(groupKey, expanded);
  }
  // The live heading/body pair per key; re-wiring after a render overwrites
  // the entry, so detached nodes never accumulate.
  const wired = new Map();
  const group = {
    // A section never opened this session counts as collapsed.
    isCollapsed(key) { return !expanded.has(key); },
    // onclick, not addEventListener: re-wiring after a re-render replaces the
    // handler instead of stacking.
    wire(heading, body, key) {
      wired.set(key, { heading, body });
      const applyState = (isCollapsed) => {
        body.hidden = isCollapsed;
        heading.classList.toggle(CSS.SECTION_TOGGLE_COLLAPSED, isCollapsed);
      };
      applyState(!expanded.has(key));
      heading.onclick = () => {
        const nowCollapsed = expanded.delete(key);
        if (!nowCollapsed) expanded.add(key);
        // Expanding reveals the contents; the new-content dot has done its job.
        if (!nowCollapsed) heading.classList.remove(CSS.SECTION_TOGGLE_NOTIFY);
        applyState(nowCollapsed);
      };
    },
    // Both the set (for the next render) and the nodes on screen (for a
    // panel that will not be re-rendered).
    collapseAll() {
      expanded.clear();
      for (const { heading, body } of wired.values()) {
        body.hidden = true;
        heading.classList.add(CSS.SECTION_TOGGLE_COLLAPSED);
      }
    },
  };
  sectionGroups.add(group);
  return group;
}

// A `{ current, max }` resource pool, as opposed to a flat number like gold.
export function isResourcePool(value) {
  return !!(value && typeof value === 'object' && 'current' in value);
}

// "+2", "-1", "+0": how modifiers, bonuses, and yields read.
export function formatSigned(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

// The one hover tooltip (minimap boxes, tab icons), created on first use. A
// custom element because the native title attribute's ~1s delay reads as
// unresponsive.
let cursorTooltipEl = null;

// e is the mousemove event the label follows.
export function showCursorTooltip(label, e) {
  if (!cursorTooltipEl) {
    cursorTooltipEl = document.createElement('div');
    cursorTooltipEl.className = CSS.CURSOR_TOOLTIP;
    document.body.appendChild(cursorTooltipEl);
  }
  cursorTooltipEl.textContent = label;
  cursorTooltipEl.style.left = `${e.clientX + 12}px`;
  cursorTooltipEl.style.top = `${e.clientY + 16}px`;
  cursorTooltipEl.hidden = false;
}

export function hideCursorTooltip() {
  if (cursorTooltipEl) cursorTooltipEl.hidden = true;
}

// "Healing Potion (x3)"; the raw id when the item is unknown.
export function getItemLabel(itemsData, itemId, amount = 1) {
  const name = itemsData[itemId]?.name || itemId;
  return amount > 1 ? `${name} (x${amount})` : name;
}

// A Special item is one the player can never part with by choice: not sold,
// exhibited, or stowed. Every such surface filters on this; scripted removal
// (a quest turn-in) still works.
export function isSpecialItem(itemData) {
  return itemData?.type === 'Special';
}

// Inside a building: the scene marks itself `interior`, or its region is.
// The map and the options panel both ask here so they cannot disagree.
export function isInteriorScene(scene, regions) {
  return !!(scene?.interior || regions?.[scene?.region]?.interior);
}

// Clockwise from north. Four, not eight: a diagonal arrow is the one the eye
// stops to decode, so display rounds to the nearest cardinal.
export const COMPASS_POINTS = Object.freeze(['N', 'E', 'S', 'W']);

// Which way `to` lies from `from`, read edge to edge rather than centre to
// centre (the rule and its reasons: README, "Regions, Interiors, and the Map").
// Null unless both scenes have mapDefinitions.
export function compassPoint(from, to) {
  const a = from?.mapDefinitions;
  const b = to?.mapDefinitions;
  if (!a || !b) return null;

  // Screen coordinates: north is a negative dy.
  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  // Per-axis distance between the boxes; negative where they overlap.
  const gapX = Math.max(b.left - (a.left + a.width), a.left - (b.left + b.width));
  const gapY = Math.max(b.top - (a.top + a.height), a.top - (b.top + b.height));
  if (gapX > gapY && dx) return dx > 0 ? 'E' : 'W';
  if (gapY > gapX && dy) return dy > 0 ? 'S' : 'N';

  // A tie, or intersecting boxes: the bearing between centres, rounded.
  if (!dx && !dy) return null;
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const step = 360 / COMPASS_POINTS.length;
  return COMPASS_POINTS[Math.round(degrees / step) % COMPASS_POINTS.length];
}

// Where a doorway between two boxes sits: the midpoint of the wall they share,
// with which way that wall runs. Null unless they meet edge to edge with some
// overlap — boxes meeting at a corner share no wall to put a door in.
export function sharedEdgeMidpoint(a, b) {
  const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);

  if (overlapX > 0) {
    const x = Math.max(a.left, b.left) + overlapX / 2;
    if (a.top + a.height === b.top) return { x, y: b.top, vertical: false };
    if (b.top + b.height === a.top) return { x, y: a.top, vertical: false };
  }
  if (overlapY > 0) {
    const y = Math.max(a.top, b.top) + overlapY / 2;
    if (a.left + a.width === b.left) return { x: b.left, y, vertical: true };
    if (b.left + b.width === a.left) return { x: a.left, y, vertical: true };
  }
  return null;
}

// A Weapon or Spell defaults to a hand, so swords never repeat "slot": "hand".
const HAND_TYPES = new Set(['Weapon', 'Spell']);

// The slot kind an item targets; null for an item that wears nowhere.
export function itemSlotKind(itemData) {
  if (!itemData) return null;
  return itemData.slot ?? (HAND_TYPES.has(itemData.type) ? HAND_SLOT_KIND : null);
}

// The display name of a slot (ui.equipmentSlots.<id>) or, with kind, of a
// slot kind (itemStats.slotKinds.<kind>); the raw id when the locale has none.
export function slotLabel(t, id, kind = false) {
  return translateOr(t, kind ? `itemStats.slotKinds.${id}` : `ui.equipmentSlots.${id}`, id);
}

// The declared slot ids of one kind, in declaration order (which is render order).
export function slotsOfKind(rules, kind) {
  return (rules?.playerDefaults?.equipmentSlots ?? [])
    .filter(slot => slot.kind === kind)
    .map(slot => slot.id);
}

// The one kind the engine depends on: combat reads attacks and weapons from it.
export function handSlots(rules) {
  return slotsOfKind(rules, HAND_SLOT_KIND);
}

// What a worn piece adds to the wearer: attributeBonuses, plus the legacy
// armorClassBonus folded into 'ac'.
export function equipmentAttributeBonuses(itemData) {
  const map = { ...(itemData?.attributes?.attributeBonuses || {}) };
  const acBonus = itemData?.attributes?.armorClassBonus ?? 0;
  if (acBonus) map.ac = (map.ac ?? 0) + acBonus;
  return map;
}

// Skipped by the generic stat-line loop: authoring data that is no stat, and
// the attributes that get a dedicated line.
const HIDDEN_ITEM_ATTRS = new Set(['teleportScene', 'attackAttribute', 'actionPoints', 'damageAttribute']);

// The display name of an attribute (actions.skillBadgeFree.<id>), else the
// capitalized id. skillLabel (skill-checks.js) is the engine-bound wrapper.
export function attributeLabel(t, attrId) {
  return translateOr(t, `actions.skillBadgeFree.${attrId}`, attrId.charAt(0).toUpperCase() + attrId.slice(1));
}

// An item's stat lines, one string each: AP cost, the attack roll, then the
// scalar attributes (itemStats.<key>, or "key: value" for an unknown one).
// Shared by the combat attack buttons and every item card. `attributes` are
// the wielder's; `uses` is state.getItemUses(id) or null; `items` names
// granted spells.
export function itemStatLines(t, itemData, attributes = {}, uses = null, items = null) {
  const lines = [];
  const apCost = itemData.attributes?.actionPoints;
  if (apCost !== undefined) lines.push(t('itemStats.actionPoints', { value: apCost }));
  // "Attack: 1d20 + Strength": accuracy is the wielder's, so their modifier
  // rides along for locales that show it.
  const attackAttr = itemData.attributes?.attackAttribute;
  if (attackAttr) {
    const mod = attributes[attackAttr] ?? 0;
    lines.push(t('itemStats.hit', {
      attribute: attributeLabel(t, attackAttr),
      value: formatSigned(mod),
    }));
  }
  if (itemData.attributes) {
    for (const k in itemData.attributes) {
      if (HIDDEN_ITEM_ATTRS.has(k)) continue;
      const v = itemData.attributes[k];
      // One line per worn bonus ("Bonus: +1 Perception").
      if (k === 'attributeBonuses' && v && typeof v === 'object') {
        for (const [attr, amt] of Object.entries(v)) {
          lines.push(t('itemStats.attributeBonus', { attribute: attributeLabel(t, attr), value: formatSigned(amt) }));
        }
        continue;
      }
      // One line per granted spell, by name; no player knows the id.
      if (k === 'grantsSpells' && Array.isArray(v)) {
        for (const spellId of v) {
          const name = items?.[spellId]?.name;
          if (name) lines.push(t('itemStats.grantsSpell', { name }));
        }
        continue;
      }
      if (typeof v === 'object') continue;
      // "Damage: 8d6 + Intelligence" when the weapon scales with an attribute.
      if (k === 'damageRoll' && itemData.attributes.damageAttribute) {
        lines.push(t('itemStats.damageRollWithAttribute', {
          value: v, attribute: attributeLabel(t, itemData.attributes.damageAttribute),
        }));
        continue;
      }
      // "all" or a cap: a dedicated key, not the raw value.
      if (k === 'targets') {
        lines.push(v === 'all' ? t('itemStats.targetsAll') : t('itemStats.targets', { value: v }));
        continue;
      }
      lines.push(translateOr(t, `itemStats.${k}`, `${k}: ${v}`, { value: v }));
    }
  }
  // Live state trails the item's fixed facts; the key names the rest that
  // brings the charges back.
  if (uses) {
    lines.push(t(uses.refresh === 'short_rest' ? 'itemStats.usesShortRest' : 'itemStats.usesFullRest',
      { current: uses.current, max: uses.max }));
  }
  return lines;
}

// An item card's stat lines: itemStatLines plus the slot (leading) and the
// value (trailing; none at value 0). `slot: false` is for the equipped list,
// whose cards already name the slot. `story` is { granted, total } chapters.
// Undefined when there are no lines, which buildCard takes as no stat block.
export function itemCardStats(t, itemData, attributes = {}, { slot = true, uses = null, items = null, story = null } = {}) {
  const lines = itemStatLines(t, itemData, attributes, uses, items);
  if (story) lines.push(t('itemStats.storyChapters', { current: story.granted, total: story.total }));
  // The kind, not the slot: which slot of a kind the item lands in is decided
  // at equip time (see pickSlot).
  if (slot && itemData.type === 'Armor' && itemData.slot) {
    lines.unshift(t('itemStats.slot', { value: slotLabel(t, itemData.slot, true) }));
  }
  if (itemData.value > 0) lines.push(t('itemStats.value', { value: itemData.value }));
  return lines.length > 0 ? lines : undefined;
}

// itemCardStats with the live state filled in from the engine.
export function itemCardStatsFor(engine, itemData, options = {}) {
  const story = itemData.story
    ? { granted: engine.state.getStoryChapters(itemData.id).length, total: itemData.story.chapters.length }
    : null;
  return itemCardStats(engine.t, itemData, engine.state.getPlayer().attributes,
    { ...options, uses: engine.state.getItemUses(itemData.id), items: engine.data.items, story });
}

// A section built at render time (chest contents, an enemy's attacks); the
// caller fills it and inserts it before resetOptionsPanel's skills container.
export function buildPanelSection(headingText = null) {
  const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
  if (headingText) section.appendChild(createElement('div', CSS.SECTION_HEADING, headingText));
  return section;
}

// Empties the options panel: the option list, the injected sections, and the
// headed sections (hidden again). The location reminder stays as the first
// child; reminderText, when given, renames it.
export function resetOptionsPanel(reminderText = null) {
  const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
  const container = document.getElementById(EL.SCENE_OPTIONS);
  const talkContainer = document.getElementById(EL.SCENE_OPTIONS_TALK);
  const actionsContainer = document.getElementById(EL.SCENE_OPTIONS_ACTIONS);
  const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
  const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

  container.replaceChildren();
  // A headed section earns its heading only once something lands in it.
  [talkContainer, actionsContainer, skillsContainer].forEach(section => {
    section.replaceChildren();
    section.setAttribute('hidden', '');
  });
  panel.querySelectorAll(`.${CSS.PANEL_SECTION_DYNAMIC}`).forEach(el => el.remove());

  if (reminder) {
    if (reminderText !== null) reminder.textContent = reminderText;
    container.appendChild(reminder);
  }
  return { panel, container, talkContainer, actionsContainer, skillsContainer, reminder };
}

// A leading "[label]" becomes a styled span, brackets dropped: they are
// marker syntax, and weight and color carry the label on screen.
function wrapLogPrefix(html) {
  return String(html).replace(
    /^(\s*)\[([^\]]*)\]/,
    `$1<span class="${CSS.SCENE_LOG_PREFIX}">$2</span>`
  );
}

// Prefixes a body with the "[Narrator]" label and wraps it in the span that
// scopes the drop cap. A body already carrying a "[label]" (NPC speech) is
// left alone.
function narratorLabelHtml(body, t = null) {
  if (!body || /^\s*\[/.test(body)) return body;
  const label = t ? translateOr(t, 'log.Narrator', 'Narrator') : 'Narrator';
  return `[${label}] <span class="${CSS.SCENE_BODY_TEXT}">${body}</span>`;
}

// The scene header block: a title (text) over an optional body. The body is
// authored HTML from game JSON and may carry inline markup; never pass
// user-supplied or save-derived content. t translates the Narrator label.
export function buildSceneDescription(title, body = null, t = null) {
  const div = createElement('div', CSS.SCENE_DESCRIPTION);
  const h2 = createElement('h2', CSS.SCENE_TITLE);
  h2.textContent = title;
  div.appendChild(h2);
  if (body !== null) {
    const p = createElement('p', CSS.SCENE_BODY);
    p.innerHTML = wrapLogPrefix(narratorLabelHtml(body, t));
    div.appendChild(p);
  }
  return div;
}

// One sheet row, shared with plugin rows so they cannot drift from the
// sheet's markup. The label is escaped; valueHtml and trailingHtml are
// engine-authored markup; icon is a name from core/icons.js.
export function attrRowHtml({ label, valueHtml, icon = '', extraClasses = '', trailingHtml = '' }) {
  return `<div class="attr-list__row${extraClasses ? ` ${extraClasses}` : ''}">
    <span class="attr-list__label">${icon ? iconHtml(icon) : ''}${escapeHtml(label)}</span>
    <span class="attr-list__value">${valueHtml}</span>${trailingHtml}
  </div>`;
}

// The standard clickable option: a button card with optional stat lines
// (a string or an array). The caller sets onclick and disabled.
export function buildOptionButton(text, reqText = null) {
  return buildCard({ tag: 'button', title: text, stats: reqText ?? undefined });
}

// The direction arrow on a navigation button. Here rather than in the scene
// renderer because the curator's panels build navigation buttons too. Nothing
// is added when either scene has no geometry.
//
// The button gets a class instead of CSS asking via `:has()`: where `:has()`
// is unsupported the marker would position against the viewport.
export function addDirectionMarker(engine, scene, destination, button) {
  if (!destination) return;

  const point = compassPoint(scene, destination);
  if (!point) return;

  const marker = createElement('span', CSS.OPTION_DIRECTION);
  marker.dataset.point = point;
  // One glyph drawn pointing north, turned a quarter-turn per point by CSS.
  marker.style.setProperty('--turn', String(COMPASS_POINTS.indexOf(point)));
  // The glyph is aria-hidden; the point's name is there for screen readers.
  marker.innerHTML = `${iconHtml('arrow')}<span class="visually-hidden">${escapeHtml(engine.t(`ui.compass${point}`))}</span>`;

  button.classList.add(CSS.CARD_DIRECTED);
  button.appendChild(marker);
}

// "Action Points: 1" splits at the first colon into label and value spans so
// CSS can column-align values; a line without a colon stays one span.
function buildStatLine(tag, line) {
  const el = createElement(tag);
  const colon = line.indexOf(':');
  if (colon > 0) {
    el.appendChild(createElement('span', CSS.CARD_STAT_LABEL, line.slice(0, colon + 1)));
    el.appendChild(createElement('span', CSS.CARD_STAT_VALUE, line.slice(colon + 1).trim()));
  } else {
    el.appendChild(createElement('span', '', line));
  }
  return el;
}

// The one block for every titled box in the UI (options, checks, attacks,
// items, quests, exhibits), restyled from the .card block in styles.css:
//
//   <tag class="card">
//     <.card__title>   the bold first line
//     <.card__body>    0..n muted lines
//     <.card__stats>   one element per fact, each split label/value (buildStatLine)
//
// A card the player acts on is a <button>: the whole card is the control.
// Inert cards are <div> or <li>. Stats split on \n for multi-line locale strings.
export function buildCard({ tag = 'div', title, body, stats, classes = [] } = {}) {
  // A button may hold phrasing content only, so its children are spans.
  const child = tag === 'button' ? 'span' : 'div';
  const card = createElement(tag, [CSS.CARD, ...classes]);
  if (title) card.appendChild(createElement(tag === 'button' ? 'span' : 'strong', CSS.CARD_TITLE, title));
  for (const line of (Array.isArray(body) ? body : [body])) {
    if (line) card.appendChild(createElement(child, CSS.CARD_BODY, line));
  }
  const statLines = stats == null ? []
    : (Array.isArray(stats) ? stats : [stats]).flatMap(s => String(s).split('\n')).filter(Boolean);
  if (statLines.length > 0) {
    // Screen readers flatten a button to its text, so spans lose nothing there.
    const [listTag, lineTag] = tag === 'button' ? ['span', 'span'] : ['ul', 'li'];
    const list = createElement(listTag, CSS.CARD_STATS);
    statLines.forEach(line => list.appendChild(buildStatLine(lineTag, line)));
    card.appendChild(list);
  }
  return card;
}
