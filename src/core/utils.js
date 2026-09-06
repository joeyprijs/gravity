import { CSS, EL, HAND_SLOT_KIND } from './config.js';
import { iconHtml } from './icons.js';

// Reads a value from a nested object using a dot-separated path, e.g.
// getByPath(player, 'resources.hp.current'). Undefined if any segment is missing.
export function getByPath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

// Keys that would let a dotted path reach an object's prototype chain. Blocked
// so setByPath can never be used as a prototype-pollution sink.
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Sets a value on a nested object using a dot-separated path, e.g.
// setByPath(player, 'resources.hp.max', 15). Prototype-chain segments are rejected.
export function setByPath(obj, path, value) {
  const parts = path.split('.');
  if (parts.some(p => UNSAFE_PATH_KEYS.has(p))) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

// Creates a DOM element. Content is set via textContent — game data (item
// names, descriptions, locale strings) is always treated as plain text, never
// HTML. The only sanctioned HTML channels are scene description bodies (see
// buildSceneDescription) and engine-authored structural templates; dynamic
// values embedded in those must go through escapeHtml().
export function createElement(tag, className = '', textContent = '') {
  const el = document.createElement(tag);
  if (Array.isArray(className)) el.classList.add(...className.filter(Boolean));
  else if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

// Escapes HTML special characters. Use for any dynamic value (player input,
// save-file data) that flows into innerHTML.
export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Section expand state, keyed by group so it survives panel re-renders within
// one visit. In memory only — see createSectionToggles for the policy.
const sectionExpandState = new Map();

// Every toggle group built this session, so collapseAllSections can reach a
// panel that isn't re-rendered when it opens (the sheet). A group is created
// once per UI object and the game reloads on restart, so this never grows.
const sectionGroups = new Set();

// Shuts every section in every panel. Called on tab switch.
export function collapseAllSections() {
  for (const group of sectionGroups) group.collapseAll();
}

/**
 * Collapse/expand wiring for section-toggle headings. Every section starts
 * collapsed, so a panel always opens as a short list of headings; expansions
 * are a per-session UI preference — never saved, and dropped on every tab
 * switch. Collapsing hides the body element in place — no re-render, so its
 * bindings and buttons survive. Used by the inventory panel and the sheet
 * tab, each with its own group key.
 */
export function createSectionToggles(groupKey) {
  let expanded = sectionExpandState.get(groupKey);
  if (!expanded) {
    expanded = new Set();
    sectionExpandState.set(groupKey, expanded);
  }
  // The heading/body pair currently on screen for each key, so collapseAll can
  // shut a panel that won't be re-rendered. Re-wiring after a render overwrites
  // the entry, so this holds live nodes rather than accumulating detached ones.
  const wired = new Map();
  const group = {
    // Read by render decisions that hinge on visibility (e.g. the heading's
    // new-content dot). A section never opened this session counts as collapsed.
    isCollapsed(key) { return !expanded.has(key); },
    // Applies the current state to a heading/body pair and flips it on heading
    // clicks. onclick, not addEventListener, so re-wiring after a re-render
    // replaces the handler instead of stacking.
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
        // Expanding reveals the contents — the new-content dot has done its job.
        if (!nowCollapsed) heading.classList.remove(CSS.SECTION_TOGGLE_NOTIFY);
        applyState(nowCollapsed);
      };
    },
    // Clears the set (what the next render needs) and hides what's on screen
    // now (what a hidden, un-re-rendered panel needs).
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

// Clears all children of an element, given the element or its id.
export function clearElement(el) {
  el.innerHTML = '';
}

// A `{ current, max }` resource pool, as opposed to a flat number like gold.
export function isResourcePool(value) {
  return !!(value && typeof value === 'object' && 'current' in value);
}

// The one cursor-following hover tooltip, shared by every surface that names
// things at the pointer (minimap boxes, tab icons). A custom element rather
// than the native title attribute, whose fixed ~1s hover delay reads as
// unresponsive — a player pointing at something wants its name now. Created
// on first use; a single element suffices since only one thing is hovered.
let cursorTooltipEl = null;

// Shows the shared tooltip with the given label, beside the cursor (e is the mousemove event).
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

// The display label for an item: its name (falling back to the raw id) plus an
// "(xN)" suffix when amount > 1, e.g. "Healing Potion (x3)".
export function getItemLabel(itemsData, itemId, amount = 1) {
  const name = itemsData[itemId]?.name || itemId;
  return amount > 1 ? `${name} (x${amount})` : name;
}

/**
 * True for a Special item — the story/required category the player can never
 * part with by choice: not sellable, not displayable, not stowable in a chest.
 * Every surface that parts the player from an item filters on this. Scripted
 * effects (a quest turn-in, a scene that consumes it) still remove it normally.
 */
export function isSpecialItem(itemData) {
  return itemData?.type === 'Special';
}

/**
 * Whether a scene is the inside of a building rather than a place in the open
 * world. A building of one room marks itself (`interior` on the scene); the
 * rooms of a bigger one are grouped by a region flagged `interior`.
 *
 * The map draws buildings from this and the interactions panel sorts doors
 * apart from roads by it — both ask here so they can't disagree.
 */
export function isInteriorScene(scene, regions) {
  return !!(scene?.interior || regions?.[scene?.region]?.interior);
}

/**
 * The four cardinal points, clockwise from north.
 *
 * Four, not eight: a diagonal arrow is harder to read at option size — the eye
 * takes "up" instantly but has to work out "up-and-right". Roads are still
 * authored in eight-point order (which needs the finer resolution to be
 * deterministic); what the player sees rounds to the nearest cardinal.
 */
export const COMPASS_POINTS = Object.freeze(['N', 'E', 'S', 'W']);

/**
 * Which way one scene lies from another, as a compass point.
 *
 * Derived from map coordinates rather than authored in prose ("take the forge
 * lane east"), so the game's one piece of navigational meaning isn't trapped
 * in a string a translator has to get right. Rounded to a compass point on
 * purpose: a road bearing 340° reads as north to anyone looking at it. Null
 * unless both scenes have geometry.
 */
export function compassPoint(from, to) {
  const a = from?.mapDefinitions;
  const b = to?.mapDefinitions;
  if (!a || !b) return null;

  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  if (!dx && !dy) return null;

  // Screen coordinates put north at the *top*, so north is a negative dy.
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const step = 360 / COMPASS_POINTS.length;
  return COMPASS_POINTS[Math.round(degrees / step) % COMPASS_POINTS.length];
}

// The slot kind an item targets. Armor and everything else name their kind
// outright; a Weapon or Spell defaults to a hand, so the hundreds of swords a
// game may hold never have to repeat `"slot": "hand"`. Returns null for an
// item that goes into no slot at all (a potion, a key).
const HAND_TYPES = new Set(['Weapon', 'Spell']);

export function itemSlotKind(itemData) {
  if (!itemData) return null;
  return itemData.slot ?? (HAND_TYPES.has(itemData.type) ? HAND_SLOT_KIND : null);
}

/**
 * The display name of an equipment slot (ui.equipmentSlots.<id>) or of a slot
 * kind (itemStats.slotKinds.<kind>), falling back to the raw id. Slot ids are
 * semantic (`left_ring`), so the wording is the locale's to own — a game in
 * another language renames the slot without touching rules.json.
 */
export function slotLabel(t, id, kind = false) {
  const key = kind ? `itemStats.slotKinds.${id}` : `ui.equipmentSlots.${id}`;
  const name = t(key);
  return name !== key ? name : id;
}

/**
 * The declared equipment slots of one kind, in declaration order — which is
 * also the order they render in. Slots are game-defined
 * (rules.playerDefaults.equipmentSlots); only the `hand` kind is special to
 * the engine, because combat reads the player's attacks from it.
 */
export function slotsOfKind(rules, kind) {
  return (rules?.playerDefaults?.equipmentSlots ?? [])
    .filter(slot => slot.kind === kind)
    .map(slot => slot.id);
}

// The slot ids a weapon or spell can occupy. Combat reads the player's
// attacks from these, and an enemy's weapon out of the same kind.
export function handSlots(rules) {
  return slotsOfKind(rules, HAND_SLOT_KIND);
}

/**
 * The attribute deltas one equipment piece carries while worn: its
 * attributeBonuses map, plus the legacy armorClassBonus folded into 'ac'.
 * equipItem/unequipItem apply these on swap, so a relic can raise any
 * declared attribute the way armor has always raised AC.
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
const HIDDEN_ITEM_ATTRS = new Set(['teleportScene', 'attackAttribute', 'actionPoints', 'damageAttribute']);

/**
 * The display name of an attribute (actions.skillBadgeFree.<id>), falling
 * back to the capitalized id. Takes the translate function directly so
 * DOM-free helpers can use it; skillLabel (skill-checks.js) is the
 * engine-flavored wrapper.
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
 * `attributes` are the wielder's, to show the governing attribute's current
 * modifier. `uses` is the item's remaining rest-limited uses
 * (state.getItemUses) — live state, so the caller looks it up; null renders no
 * uses line. `items` (the loaded definitions) names granted spells; omitted
 * renders no grants line.
 */
export function itemStatLines(t, itemData, attributes = {}, uses = null, items = null) {
  const lines = [];
  const apCost = itemData.attributes?.actionPoints;
  if (apCost !== undefined) lines.push(t('itemStats.actionPoints', { value: apCost }));
  // The hit line spells out the attack roll ("Attack: 1d20 + Strength") —
  // accuracy is the wielder's, so their current modifier rides along as a
  // locale param for locales that want to show it.
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
      // attributeBonuses renders one line per worn bonus ("Bonus: +1 Perception").
      if (k === 'attributeBonuses' && v && typeof v === 'object') {
        for (const [attr, amt] of Object.entries(v)) {
          const value = amt >= 0 ? `+${amt}` : `${amt}`;
          lines.push(t('itemStats.attributeBonus', { attribute: attributeLabel(t, attr), value }));
        }
        continue;
      }
      // A granted spell renders one line per spell, naming the spell rather
      // than its id — the id is authoring data, and no player knows it.
      if (k === 'grantsSpells' && Array.isArray(v)) {
        for (const spellId of v) {
          const name = items?.[spellId]?.name;
          if (name) lines.push(t('itemStats.grantsSpell', { name }));
        }
        continue;
      }
      if (typeof v === 'object') continue;
      // The damage line carries the wielder-scaling attribute when the weapon
      // names one ("Damage: 8d6 + Intelligence") — one stat, one line.
      if (k === 'damageRoll' && itemData.attributes.damageAttribute) {
        lines.push(t('itemStats.damageRollWithAttribute', {
          value: v, attribute: attributeLabel(t, itemData.attributes.damageAttribute),
        }));
        continue;
      }
      // targets is semantic ("all" or a cap), so its line is a dedicated key,
      // not the raw data value.
      if (k === 'targets') {
        lines.push(v === 'all' ? t('itemStats.targetsAll') : t('itemStats.targets', { value: v }));
        continue;
      }
      const key = `itemStats.${k}`;
      const line = t(key, { value: v });
      lines.push(line !== key ? line : `${k}: ${v}`);
    }
  }
  // The remaining rest-limited uses trail the item's fixed facts — live
  // state, not a property of the item. The line names the rest that brings
  // the charges back, so the key splits on the refresh.
  if (uses) {
    lines.push(t(uses.refresh === 'short_rest' ? 'itemStats.usesShortRest' : 'itemStats.usesFullRest',
      { current: uses.current, max: uses.max }));
  }
  return lines;
}

/**
 * The stat lines of an item CARD — itemStatLines plus slot and value, the two
 * facts cards show and attack buttons don't. An item a merchant won't pay for
 * (value 0) shows no value line. Shared by every surface that presents an item
 * as a card (inventory, the curator's exhibits) so the same item reads the
 * same in all of them.
 *
 * Options: `slot: false` drops the leading slot row — the equipped list passes
 * it because its cards already say "Equipped: Torso", and a card must not state
 * the same fact twice. `uses` and `items` are as in itemStatLines. `story`
 * ({granted, total}) is a story book's heard-chapter progress — the card's
 * visible sign that listening filled more pages. Returns undefined when the
 * item has no lines (buildCard's `stats` takes undefined for "no stat block").
 */
export function itemCardStats(t, itemData, attributes = {}, { slot = true, uses = null, items = null, story = null } = {}) {
  const lines = itemStatLines(t, itemData, attributes, uses, items);
  if (story) lines.push(t('itemStats.storyChapters', { current: story.granted, total: story.total }));
  // Where it's worn leads, because it's what the player checks first on gear.
  // The KIND is what the card can honestly promise — which of a kind's slots
  // the item lands in is decided at equip time (see pickSlot), so a ring says
  // "Ring", not which hand it will end up on.
  if (slot && itemData.type === 'Armor' && itemData.slot) {
    lines.unshift(t('itemStats.slot', { value: slotLabel(t, itemData.slot, true) }));
  }
  if (itemData.value > 0) lines.push(t('itemStats.value', { value: itemData.value }));
  return lines.length > 0 ? lines : undefined;
}

// itemCardStats bound to an engine: the player's attributes, the item's
// remaining uses and story progress come from live state.
export function itemCardStatsFor(engine, itemData, options = {}) {
  const story = itemData.story
    ? { granted: engine.state.getStoryChapters(itemData.id).length, total: itemData.story.chapters.length }
    : null;
  return itemCardStats(engine.t, itemData, engine.state.getPlayer().attributes,
    { ...options, uses: engine.state.getItemUses(itemData.id), items: engine.data.items, story });
}

/**
 * Resets the scene options panel to an empty state: clears the option button
 * container, removes injected option sections, and clears + hides the headed
 * sections (conversations, actions, skills). The location reminder is
 * re-appended as the container's first child; pass reminderText to also update
 * its text.
 */
// A panel section built at render time (chest contents, an enemy's attacks, a
// museum's wings) with its heading; null skips the heading. The caller fills
// it and inserts it before the skills container of resetOptionsPanel().
export function buildPanelSection(headingText = null) {
  const section = createElement('div', [CSS.PANEL_SECTION, CSS.PANEL_SECTION_DYNAMIC]);
  if (headingText) section.appendChild(createElement('div', CSS.SECTION_HEADING, headingText));
  return section;
}

export function resetOptionsPanel(reminderText = null) {
  const panel = document.getElementById(EL.SCENE_OPTIONS_PANEL);
  const container = document.getElementById(EL.SCENE_OPTIONS);
  const entrancesContainer = document.getElementById(EL.SCENE_OPTIONS_ENTRANCES);
  const talkContainer = document.getElementById(EL.SCENE_OPTIONS_TALK);
  const actionsContainer = document.getElementById(EL.SCENE_OPTIONS_ACTIONS);
  const skillsContainer = document.getElementById(EL.SCENE_OPTIONS_SKILLS);
  const exitsContainer = document.getElementById(EL.SCENE_OPTIONS_EXITS);
  const reminder = document.getElementById(EL.SCENE_LOCATION_REMINDER);

  clearElement(container);
  // Every headed section starts empty and hidden: its heading is only earned
  // once something lands in it (see renderOptions).
  [entrancesContainer, talkContainer, actionsContainer, skillsContainer, exitsContainer].forEach(section => {
    clearElement(section);
    section.setAttribute('hidden', '');
  });
  panel.querySelectorAll(`.${CSS.PANEL_SECTION_DYNAMIC}`).forEach(el => el.remove());

  if (reminder) {
    if (reminderText !== null) reminder.innerText = reminderText;
    container.appendChild(reminder);
  }
  return { panel, container, entrancesContainer, talkContainer, actionsContainer, skillsContainer, exitsContainer, reminder };
}

/**
 * Wraps a leading "[label]" prefix in a styling span so it can be themed
 * separately from the body that follows. Only a prefix at the very start is
 * matched (the engine treats a leading bracket as a speaker/log label); a
 * no-op when the text has no leading prefix. The brackets are marker syntax,
 * not display — the rendered label drops them (weight and color carry it).
 */
function wrapLogPrefix(html) {
  return String(html).replace(
    /^(\s*)\[([^\]]*)\]/,
    `$1<span class="${CSS.SCENE_LOG_PREFIX}">$2</span>`
  );
}

// Prefixes a description body with the translated "[Narrator]" label (plain
// "Narrator" when t is omitted or has no translation), wrapping the body in a
// span that scopes ::first-letter styling (drop caps) to the narrator's text.
// A body that already carries a leading "[label]" (NPC speech) stays unwrapped
// on purpose.
function narratorLabelHtml(body, t = null) {
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
 * t (engine.t) translates the Narrator label.
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
 * reputation) can't drift from the sheet's markup. The label is escaped and
 * marked with its icon; valueHtml and trailingHtml are engine-authored markup
 * (data-stat-bind spans, the point-buy spend button). icon is a name from
 * core/icons.js.
 */
export function attrRowHtml({ label, valueHtml, icon = '', extraClasses = '', trailingHtml = '' }) {
  return `<div class="attr-list__row${extraClasses ? ` ${extraClasses}` : ''}">
    <span class="attr-list__label">${icon ? iconHtml(icon) : ''}${escapeHtml(label)}</span>
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
 * Adds the direction arrow to a navigation option button — only for moves
 * within one continuous space. A road between outdoor places or a door between
 * two rooms has a direction; crossing a building's threshold does not (the
 * same line Entrances and Exits are drawn on). The rule lives here because the
 * scene renderer and the curator's panels both build navigation buttons and
 * must agree on it. Geometry on both sides is required; a scene without
 * mapDefinitions is nowhere in particular.
 *
 * Marks the button with a class instead of letting CSS ask via `:has()`: the
 * marker is positioned against its card, every ancestor above the card is
 * `static`, and where `:has()` is unsupported the arrow would resolve against
 * the viewport and land in a page corner.
 */
export function addDirectionMarker(engine, scene, destination, button) {
  const regions = engine.data.regions;
  if (!destination) return;
  if (isInteriorScene(scene, regions) !== isInteriorScene(destination, regions)) return;

  const point = compassPoint(scene, destination);
  if (!point) return;

  const marker = createElement('span', CSS.OPTION_DIRECTION);
  marker.dataset.point = point;
  // One glyph drawn pointing north, turned a quarter-turn per point by CSS.
  marker.style.setProperty('--turn', String(COMPASS_POINTS.indexOf(point)));
  // The glyph is aria-hidden; the point's name rides along for screen readers.
  marker.innerHTML = `${iconHtml('arrow')}<span class="visually-hidden">${escapeHtml(engine.t(`ui.compass${point}`))}</span>`;

  button.classList.add(CSS.CARD_DIRECTED);
  button.appendChild(marker);
}

// One stat line for a card: "Action Points: 1" splits on its first colon into
// label and value spans so CSS can column-align card values. A line without a
// colon (a bare badge like "Deposit") stays a single full-row span. tag is
// 'li' in container cards, 'span' in button cards.
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
 *     <.card__stats>     muted stat lines, one element per fact — a real
 *                        <ul>/<li> in container cards; block <span>s inside
 *                        button cards (buttons allow phrasing content only).
 *                        Each line splits into a label/value pair of spans
 *                        (see buildStatLine)
 *
 * A card the player acts on is a <button class="card"> — the whole card is the
 * control (scene options, chest rows, inventory items). Cards with nothing to
 * click are <div>/<li> (quests, keepsakes). tag is 'button' | 'div' | 'li';
 * empty body lines are skipped; stats strings are split on \n so game packs
 * with multi-line locale strings keep working.
 */
export function buildCard({ tag = 'div', title, body, stats, classes = [] } = {}) {
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
    statLines.forEach(line => list.appendChild(buildStatLine(lineTag, line)));
    card.appendChild(list);
  }
  return card;
}
