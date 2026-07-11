import { store, markDirty } from '../store.js';
import { el, formRow, select, makeCollapsible, dcInput } from '../utils.js';
import { renderActionPipeline, renderEnemyList } from './actions.js';
import { renderInlineCondition } from './condition-inline.js';
import { renderCheckBehavior } from './check-fields.js';

/** Normalize a scene description to array-of-objects (the engine accepts
 *  a plain string, an array of strings, or {text, condition?} entries). */
export function normalizeDescription(description) {
  if (typeof description === 'string') return [{ text: description }];
  if (!Array.isArray(description)) return [];
  return description.map(d => typeof d === 'string' ? { text: d } : d);
}

/**
 * The authoring kind of a choice, detected from its data shape so existing
 * scenes round-trip: a one-action navigate pipeline reads as "go", a
 * one-action dialogue pipeline as "talk", anything else as "custom".
 * Entries from scene.skills[] are always "check".
 */
export function detectChoiceKind(option) {
  const a = Array.isArray(option.actions) ? option.actions : [];
  if (a.length === 1 && a[0].type === 'navigate') return 'go';
  if (a.length === 1 && a[0].type === 'dialogue') return 'talk';
  return 'custom';
}

// ── Scene form (player-order: what they read → what they can do → plumbing) ──

export function renderSceneForm(key, data) {
  data.description = normalizeDescription(data.description);
  if (!Array.isArray(data.options)) data.options = [];
  if (!Array.isArray(data.skills))  data.skills  = [];

  const wrap = el('div', { class: 'form-wrap wide' });
  const titleEl = el('h2', { class: 'form-title' }, [data.title || 'New Scene']);
  wrap.appendChild(titleEl);

  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  const onChange = () => markDirty(key);

  // ── Header ──────────────────────────────────────────────────────────────

  const titleInput = el('input', { type: 'text', class: 'form-input', value: data.title ?? '', 'data-required': '' });
  titleInput.addEventListener('input', () => {
    data.title = titleInput.value;
    titleEl.textContent = titleInput.value || 'New Scene';
    onChange();
  });
  form.appendChild(formRow('Title', titleInput));

  const regions = Object.entries(store.index?.regions ?? {}).map(([id, r]) => [id, r.name || id]);
  const regionSel = select(regions.length ? regions : [['', 'none']], data.region ?? '', v => {
    data.region = v; onChange();
  });
  regionSel.className = 'form-select';
  form.appendChild(formRow('Region', regionSel));

  // ── What the player reads ────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Description']));
  form.appendChild(renderDescBlocks(data, onChange));

  // ── What the player can do ──────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Choices']));
  form.appendChild(renderChoices(data, onChange));

  // ── When the scene loads (events) ────────────────────────────────────────

  const events = collapsedSection(form, 'When the scene loads', 'passive checks · auto attack · quest trigger');
  events.appendChild(el('div', { class: 'card-section-label' }, ['Passive checks (rolled silently on first entry)']));
  events.appendChild(renderPassiveChecks(data, onChange));
  events.appendChild(el('div', { class: 'card-section-label' }, ['Auto attack']));
  events.appendChild(renderAutoAttack(data, onChange));
  events.appendChild(el('div', { class: 'card-section-label' }, ['Quest trigger']));
  events.appendChild(renderQuestTrigger(data, onChange));

  // ── Advanced scene settings ──────────────────────────────────────────────

  const adv = collapsedSection(form, 'Advanced', 'XP · hooks · map · exhibits · display stands');

  const xpInput = el('input', { type: 'number', class: 'form-input', value: data.xpReward ?? '' });
  xpInput.addEventListener('input', () => { data.xpReward = xpInput.value === '' ? undefined : Number(xpInput.value); onChange(); });
  adv.appendChild(formRow('XP Reward', xpInput));

  const listId = 'description-hooks-list';
  let datalist = document.getElementById(listId);
  if (!datalist) {
    datalist = el('datalist', { id: listId });
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = '';
  [...store.descriptionHooks].forEach(hook => {
    datalist.appendChild(el('option', { value: hook }));
  });

  const hookInput = el('input', {
    type: 'text',
    class: 'form-input',
    value: data.descriptionHook ?? '',
    placeholder: 'e.g. museumChestContents (optional)',
    list: listId
  });
  hookInput.addEventListener('input', () => { data.descriptionHook = hookInput.value.trim() || undefined; onChange(); });
  adv.appendChild(formRow('Description Hook', hookInput));

  const exhibitsCheckbox = el('input', { type: 'checkbox', class: 'form-checkbox' });
  if (data.supportsExhibits) exhibitsCheckbox.checked = true;
  exhibitsCheckbox.addEventListener('change', () => {
    data.supportsExhibits = exhibitsCheckbox.checked ? true : undefined;
    onChange();
  });
  adv.appendChild(formRow('Supports Exhibits', exhibitsCheckbox));

  adv.appendChild(el('div', { class: 'card-section-label' }, ['Map position']));
  adv.appendChild(renderMapDefs(data, onChange));

  adv.appendChild(el('div', { class: 'card-section-label' }, ['Display stands']));
  adv.appendChild(renderDisplaysList(data, onChange));

  return wrap;
}

// A collapsed section: heading toggles the body, muted hint says what's
// inside without opening it.
function collapsedSection(form, title, hint) {
  const hdr = el('h3', { class: 'form-section-title collapsible collapsed' }, [
    title, ' ', el('span', { class: 'section-hint' }, [hint]),
  ]);
  const body = el('div', { class: 'section-body' });
  body.style.display = 'none';
  form.appendChild(hdr);
  form.appendChild(body);
  hdr.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    hdr.classList.toggle('collapsed', !open);
  });
  return body;
}

// ── Choices — the unified card ─────────────────────────────────────────────
// One list for everything the player can click in this scene. Options and
// skill checks stay in their engine arrays (options[] renders before
// skills[] in play); each card knows its source array.

const CHOICE_KINDS = {
  go:     { label: 'Go somewhere' },
  talk:   { label: 'Talk to someone' },
  check:  { label: 'Attempt a check' },
  custom: { label: 'Custom' },
};

function renderChoices(data, onChange) {
  const container = el('div', { class: 'flat-list' });

  function render() {
    container.innerHTML = '';

    data.options.forEach((opt, i) => {
      container.appendChild(renderOptionChoice(data, opt, i, onChange, render));
    });
    data.skills.forEach((skill, i) => {
      container.appendChild(renderCheckChoice(data, skill, i, onChange, render));
    });

    // Add row: pick what the choice does, not which array it lives in.
    const addRow = el('div', { class: 'choice-add-row' });
    addRow.appendChild(el('span', { class: 'list-label' }, ['Add a choice:']));
    for (const [kind, def] of Object.entries(CHOICE_KINDS)) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, [`+ ${def.label}`]);
      btn.addEventListener('click', () => { addChoice(data, kind); onChange(); render(); });
      addRow.appendChild(btn);
    }
    container.appendChild(addRow);
  }

  render();
  return container;
}

function addChoice(data, kind) {
  const firstScene = Object.keys(store.index?.scenes ?? {})[0] ?? '';
  const firstNpc   = Object.keys(store.index?.npcs   ?? {})[0] ?? '';
  const firstAttr  = (store.files['__rules']?.customAttributes ?? [])[0]?.id ?? '';

  if (kind === 'go')     data.options.push({ text: '', actions: [{ type: 'navigate', destination: firstScene }] });
  if (kind === 'talk')   data.options.push({ text: '', actions: [{ type: 'dialogue', npc: firstNpc }] });
  if (kind === 'custom') data.options.push({ text: '', actions: [] });
  if (kind === 'check')  data.skills.push({ text: '', skillCheck: firstAttr, dc: 10 });
}

// The card frame every choice shares: kind badge, button-text input, remove.
function choiceCard(kindLabel, textObj, onChange, onRemove) {
  const card = el('div', { class: 'card-item' });
  const hdr = el('div', { class: 'card-hdr collapsible' });
  hdr.appendChild(el('span', { class: 'choice-kind-badge' }, [kindLabel]));
  const textInput = el('input', { type: 'text', class: 'form-input flat-title-input', value: textObj.text ?? '', placeholder: 'Button text the player sees…' });
  textInput.addEventListener('input', () => { textObj.text = textInput.value; onChange(); });
  hdr.appendChild(textInput);
  const rm = el('button', { class: 'btn-hdr' }, ['✕']);
  rm.addEventListener('click', onRemove);
  hdr.appendChild(rm);
  card.appendChild(hdr);
  const body = el('div', { class: 'card-body' });
  card.appendChild(body);
  makeCollapsible(hdr, body);
  return { card, body };
}

// Nested collapsed fold inside a card body for the rarely-touched fields.
function advancedFold(body) {
  const hdr = el('div', { class: 'adv-fold-hdr collapsed' }, ['Advanced']);
  const fold = el('div', { class: 'adv-fold-body' });
  fold.style.display = 'none';
  hdr.addEventListener('click', () => {
    const open = fold.style.display === 'none';
    fold.style.display = open ? '' : 'none';
    hdr.classList.toggle('collapsed', !open);
  });
  body.appendChild(hdr);
  body.appendChild(fold);
  return fold;
}

// Options the author explicitly expanded to the full surface this session.
// A view preference, not data — nothing in the JSON changes.
const forcedCustom = new WeakSet();

// options[]-backed choices: go / talk / custom, detected from the pipeline.
function renderOptionChoice(data, opt, i, onChange, rerender) {
  if (!Array.isArray(opt.actions)) opt.actions = [];
  const kind = forcedCustom.has(opt) ? 'custom' : detectChoiceKind(opt);
  const { card, body } = choiceCard(CHOICE_KINDS[kind].label, opt, onChange,
    () => { data.options.splice(i, 1); onChange(); rerender(); });

  if (kind === 'go') {
    const scenes = Object.keys(store.index?.scenes ?? {}).map(id => [id, store.files[`scenes:${id}`]?.title || id]);
    const destSel = select(scenes, opt.actions[0].destination ?? '', v => { opt.actions[0].destination = v; onChange(); });
    destSel.className = 'form-select';
    body.appendChild(formRow('Destination', destSel));
  } else if (kind === 'talk') {
    const npcs = Object.keys(store.index?.npcs ?? {}).map(id => [id, store.files[`npcs:${id}`]?.name || id]);
    const npcSel = select(npcs, opt.actions[0].npc ?? '', v => { opt.actions[0].npc = v; onChange(); });
    npcSel.className = 'form-select';
    body.appendChild(formRow('Talk to', npcSel));
  } else {
    // Custom: the full pipeline editor front and center.
    const actWrap = el('div', { class: 'card-section' });
    actWrap.appendChild(el('div', { class: 'card-section-label' }, ['Actions']));
    actWrap.appendChild(renderActionPipeline(opt.actions, onChange));
    body.appendChild(actWrap);
  }

  // Shared option extras live behind Advanced for go/talk, in the open for
  // custom (authors reaching for custom want the full surface).
  const extras = kind === 'custom' ? body : advancedFold(body);
  renderOptionExtras(extras, opt, onChange);
  if (kind !== 'custom') {
    const convert = el('button', { class: 'btn btn-secondary btn-sm mt-4' }, ['Edit full pipeline (custom view)']);
    convert.addEventListener('click', () => {
      forcedCustom.add(opt); // view-only: the data is untouched
      rerender();
    });
    extras.appendChild(convert);
  }

  return card;
}

// The option fields that aren't the pipeline: requirement, back flag,
// time cost, log mode, condition.
function renderOptionExtras(parent, opt, onChange) {
  const itemIds = Object.keys(store.index?.items ?? {});

  const reqSel = select(
    [['', 'None'], ...itemIds.map(id => [id, id])],
    opt.requirements?.item ?? '',
    v => {
      if (v) { if (!opt.requirements) opt.requirements = {}; opt.requirements.item = v; }
      else delete opt.requirements;
      onChange();
    }
  );
  reqSel.className = 'form-select';
  parent.appendChild(labeledParam('Requires Item', reqSel));

  const backCheck = el('input', { type: 'checkbox' });
  if (opt.isBack) backCheck.checked = true;
  backCheck.addEventListener('change', () => {
    opt.isBack = backCheck.checked || undefined;
    onChange();
  });
  parent.appendChild(labeledParam('Back / Exit option', backCheck));

  const timeCostInput = el('input', { type: 'number', class: 'form-input sm', value: opt.timeCost ?? '', placeholder: 'default' });
  timeCostInput.addEventListener('input', () => {
    opt.timeCost = timeCostInput.value === '' ? undefined : Number(timeCostInput.value);
    onChange();
  });
  parent.appendChild(labeledParam('Time Cost (ticks)', timeCostInput));

  const curLog = opt.log;
  let logMode = 'default';
  if (curLog === false) logMode = 'silent';
  else if (typeof curLog === 'string') logMode = 'custom';

  const customLogInput = el('input', {
    type: 'text',
    class: 'form-input mt-4',
    value: typeof opt.log === 'string' ? opt.log : '',
    placeholder: 'Enter custom log description…',
  });
  if (logMode !== 'custom') customLogInput.style.display = 'none';
  customLogInput.addEventListener('input', () => {
    opt.log = customLogInput.value;
    onChange();
  });

  const logModeSel = select([
    ['default', 'Default (Show Option Text)'],
    ['silent', 'Silent (Hide from Narrative Log)'],
    ['custom', 'Custom Narrative Message…']
  ], logMode, v => {
    if (v === 'default') {
      delete opt.log;
      customLogInput.style.display = 'none';
    } else if (v === 'silent') {
      opt.log = false;
      customLogInput.style.display = 'none';
    } else if (v === 'custom') {
      opt.log = typeof curLog === 'string' ? curLog : '';
      customLogInput.style.display = '';
      customLogInput.value = opt.log;
    }
    onChange();
  });
  logModeSel.className = 'form-select';
  parent.appendChild(labeledParam('Narrative Log', el('div', { class: 'stack-col' }, [logModeSel, customLogInput])));

  const optCondWrap = el('div', { class: 'card-section' });
  optCondWrap.appendChild(renderInlineCondition(
    () => opt.condition,
    v => { if (v == null) delete opt.condition; else opt.condition = v; },
    onChange
  ));
  parent.appendChild(optCondWrap);
}

function labeledParam(label, control) {
  const row = el('div', { class: 'action-param' });
  row.appendChild(el('span', { class: 'action-param-label' }, [label]));
  row.appendChild(control);
  return row;
}

// skills[]-backed choices. One card, three styles — the style selector only
// changes which editor is front and center; nothing is deleted on switch,
// and the full surface stays reachable under Advanced.
function renderCheckChoice(data, skill, i, onChange, rerender) {
  if (!Array.isArray(skill.items)) skill.items = [];
  const itemIds  = Object.keys(store.index?.items  ?? {});
  const tableIds = Object.keys(store.index?.tables ?? {});
  const customAttrs = (store.files['__rules']?.customAttributes ?? []).map(a => [a.id, a.id]);

  const { card, body } = choiceCard(CHOICE_KINDS.check.label, skill, onChange,
    () => { data.skills.splice(i, 1); onChange(); rerender(); });

  const skillSel = select(customAttrs, skill.skillCheck ?? '', v => { skill.skillCheck = v; onChange(); });
  skillSel.className = 'form-select';
  body.appendChild(formRow('Skill', skillSel));

  // Detected authoring style: search (has drops), narrative (result text,
  // no DC), or roll (everything else).
  const style = skill.items.length > 0 ? 'search'
    : (skill.resultText && !skill.dc) ? 'narrative'
    : 'roll';

  const styleSel = select([
    ['roll', 'Roll against a DC (outcomes)'],
    ['search', 'Search for items (per-item DCs)'],
    ['narrative', 'Narrative beat (no roll)'],
  ], style, v => { renderStyle(v); });
  styleSel.className = 'form-select';
  body.appendChild(formRow('Check style', styleSel));

  const styleWrap = el('div');
  body.appendChild(styleWrap);

  function renderStyle(s) {
    styleWrap.innerHTML = '';

    if (s === 'roll') {
      const dcWrap = el('div', { class: 'card-section' });
      const dcRow = el('div', { class: 'drop-rhs' });
      dcRow.append(...dcInput(skill, onChange));
      dcWrap.appendChild(dcRow);
      styleWrap.appendChild(dcWrap);
      styleWrap.appendChild(renderCheckBehavior(skill, onChange));
    }

    if (s === 'search') {
      const dropsWrap = el('div', { class: 'card-section' });
      dropsWrap.appendChild(el('div', { class: 'card-section-label' }, ['What can be found']));
      dropsWrap.appendChild(renderDropsList(skill, itemIds, tableIds, onChange));
      styleWrap.appendChild(dropsWrap);
      styleWrap.appendChild(renderCheckBehavior(skill, onChange));
    }

    if (s === 'narrative') {
      const narrativeWrap = el('div', { class: 'card-section' });
      const resultTa = el('textarea', {
        class: 'form-textarea ta-sm',
        placeholder: 'What happens — one line per use…',
      }, [Array.isArray(skill.resultText) ? skill.resultText.join('\n') : (skill.resultText ?? '')]);
      resultTa.addEventListener('input', () => {
        const lines = resultTa.value.split('\n').map(t => t.trim()).filter(Boolean);
        skill.resultText = lines.length === 0 ? undefined : (lines.length === 1 ? lines[0] : lines);
        onChange();
      });
      narrativeWrap.appendChild(resultTa);
      const repeatRow = el('div', { class: 'drop-rhs' });
      const repeatCheck = el('input', { type: 'checkbox' });
      if (skill.repeatable) repeatCheck.checked = true;
      repeatCheck.addEventListener('change', () => { skill.repeatable = repeatCheck.checked || undefined; onChange(); });
      repeatRow.append(el('span', { class: 'list-label' }, ['Repeatable']), repeatCheck);
      narrativeWrap.appendChild(repeatRow);
      styleWrap.appendChild(narrativeWrap);
    }
  }
  renderStyle(style);

  // Rarely-touched check fields.
  const fold = advancedFold(body);

  const apCostInput = el('input', { type: 'number', class: 'form-input sm', value: skill.apCost ?? '', placeholder: 'default' });
  apCostInput.addEventListener('input', () => {
    skill.apCost = apCostInput.value === '' ? undefined : Number(apCostInput.value);
    onChange();
  });
  fold.appendChild(labeledParam('AP Cost', apCostInput));

  const timeCostInput = el('input', { type: 'number', class: 'form-input sm', value: skill.timeCost ?? '', placeholder: 'default' });
  timeCostInput.addEventListener('input', () => {
    skill.timeCost = timeCostInput.value === '' ? undefined : Number(timeCostInput.value);
    onChange();
  });
  fold.appendChild(labeledParam('Time Cost (ticks)', timeCostInput));

  const condWrap = el('div', { class: 'card-section' });
  condWrap.appendChild(renderInlineCondition(
    () => skill.condition,
    v => { if (v == null) delete skill.condition; else skill.condition = v; },
    onChange
  ));
  fold.appendChild(condWrap);

  return card;
}

// ── Quest Trigger ──────────────────────────────────────────────────────────

function renderQuestTrigger(data, onChange) {
  const wrap = el('div');

  function render() {
    wrap.innerHTML = '';
    if (!data.questTrigger) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Enable']);
      btn.addEventListener('click', () => {
        const mids = Object.keys(store.index?.missions ?? {});
        data.questTrigger = { mission: mids[0] ?? '', status: 'active' };
        onChange(); render();
      });
      wrap.appendChild(btn);
    } else {
      const qt = data.questTrigger;
      const mids = Object.keys(store.index?.missions ?? {});

      const mSel = select(mids.map(id => [id, id]), qt.mission, v => { qt.mission = v; onChange(); });
      mSel.className = 'form-select';
      wrap.appendChild(formRow('Mission', mSel));

      const sSel = select([['active', 'active'], ['complete', 'complete']], qt.status, v => { qt.status = v; onChange(); });
      sSel.className = 'form-select sm';
      wrap.appendChild(formRow('Status', sSel));

      const rm = el('button', { class: 'btn btn-danger btn-sm mt-4' }, ['Remove']);
      rm.addEventListener('click', () => { delete data.questTrigger; onChange(); render(); });
      wrap.appendChild(rm);
    }
  }

  render();
  return wrap;
}

// ── Map Definitions ────────────────────────────────────────────────────────

function renderMapDefs(data, onChange) {
  const wrap = el('div');

  function render() {
    wrap.innerHTML = '';
    if (!data.mapDefinitions) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Show on Map']);
      btn.addEventListener('click', () => {
        data.mapDefinitions = { top: 0, left: 0, width: 50, height: 50 };
        onChange(); render();
      });
      wrap.appendChild(btn);
    } else {
      const md = data.mapDefinitions;
      for (const f of ['top', 'left', 'width', 'height']) {
        const input = el('input', { type: 'number', class: 'form-input sm', value: md[f] ?? 0 });
        input.addEventListener('input', () => { md[f] = Number(input.value); onChange(); });
        wrap.appendChild(formRow(f.charAt(0).toUpperCase() + f.slice(1), input));
      }
      const bg = el('input', { type: 'text', class: 'form-input', value: md.background ?? '', placeholder: 'e.g. rgba(60,40,20,0.9)' });
      bg.addEventListener('input', () => { md.background = bg.value || undefined; onChange(); });
      wrap.appendChild(formRow('Background', bg));

      const rm = el('button', { class: 'btn btn-danger btn-sm mt-4' }, ['Remove']);
      rm.addEventListener('click', () => { delete data.mapDefinitions; onChange(); render(); });
      wrap.appendChild(rm);
    }
  }

  render();
  return wrap;
}

// ── Description Blocks ─────────────────────────────────────────────────────

function renderDescBlocks(data, onChange) {
  const container = el('div', { class: 'block-list' });

  function render() {
    container.innerHTML = '';
    data.description.forEach((block, i) => {
      const card = el('div', { class: 'card-item' });

      const hdr = blockHeader(`Block ${i + 1}`, () => { data.description.splice(i, 1); onChange(); render(); });
      card.appendChild(hdr);

      const cardBody = el('div', { class: 'card-body' });
      const ta = el('textarea', { class: 'form-textarea desc-ta' }, [block.text ?? '']);
      ta.addEventListener('input', () => { block.text = ta.value; onChange(); });
      cardBody.appendChild(ta);
      const descCondWrap = el('div', { class: 'card-section' });
      descCondWrap.appendChild(renderInlineCondition(
        () => block.condition,
        v => { if (v == null) delete block.condition; else block.condition = v; },
        onChange
      ));
      cardBody.appendChild(descCondWrap);
      card.appendChild(cardBody);

      makeCollapsible(hdr, cardBody);

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Block']);
    add.addEventListener('click', () => { data.description.push({ text: '' }); onChange(); render(); });
    container.appendChild(add);
  }

  render();
  return container;
}

function renderDropsList(skill, itemIds, tableIds, onChange) {
  const container = el('div', { class: 'drop-list' });

  function render() {
    container.innerHTML = '';
    skill.items.forEach((drop, i) => {
      const isTable = drop.table !== undefined;
      const row = el('div', { class: 'drop-row' });

      const lhs = el('div', { class: 'drop-lhs' });
      const modeSel = select([['item', 'Item'], ['table', 'Table']], isTable ? 'table' : 'item', v => {
        if (v === 'table') { delete drop.item; delete drop.amount; drop.table = tableIds[0] ?? ''; drop.itemDrops = 1; }
        else               { delete drop.table; delete drop.itemDrops; drop.item = itemIds[0] ?? ''; drop.amount = 1; }
        onChange(); render();
      });
      modeSel.className = 'form-select sm';
      lhs.appendChild(modeSel);

      if (isTable) {
        const tSel = select(tableIds.map(id => [id, id]), drop.table ?? '', v => { drop.table = v; onChange(); });
        tSel.className = 'form-select';
        lhs.appendChild(tSel);
        const drInput = el('input', { type: 'number', class: 'form-input sm', value: drop.itemDrops ?? 1 });
        drInput.addEventListener('input', () => { drop.itemDrops = Number(drInput.value); onChange(); });
        lhs.append(el('span', { class: 'list-label' }, ['drops']), drInput);
      } else {
        const iSel = select(itemIds.map(id => [id, id]), drop.item ?? '', v => { drop.item = v; onChange(); });
        iSel.className = 'form-select';
        lhs.appendChild(iSel);
        const amtInput = el('input', { type: 'number', class: 'form-input sm', value: drop.amount ?? 1 });
        amtInput.addEventListener('input', () => { drop.amount = Number(amtInput.value); onChange(); });
        lhs.append(el('span', { class: 'list-label' }, ['×']), amtInput);
      }
      row.appendChild(lhs);

      const rhs = el('div', { class: 'drop-rhs' });
      rhs.append(...dcInput(drop, onChange));
      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
      rmBtn.addEventListener('click', () => { skill.items.splice(i, 1); onChange(); render(); });
      rhs.appendChild(rmBtn);
      row.appendChild(rhs);

      container.appendChild(row);
    });

    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Add Drop']);
    add.addEventListener('click', () => {
      skill.items.push({ item: itemIds[0] ?? '', amount: 1, dc: 10 });
      onChange(); render();
    });
    container.appendChild(add);
  }

  render();
  return container;
}

// ── Passive Checks ─────────────────────────────────────────────────────────
// Auto-rolled once on the player's first entry; the result lands in a flag.

function renderPassiveChecks(data, onChange) {
  const container = el('div', { class: 'flat-list' });
  const customAttrs = (store.files['__rules']?.customAttributes ?? []).map(a => [a.id, a.id]);

  function render() {
    container.innerHTML = '';
    if (!Array.isArray(data.passiveChecks)) data.passiveChecks = [];
    if (!data.passiveChecks.length) delete data.passiveChecks;

    (data.passiveChecks ?? []).forEach((check, i) => {
      const row = el('div', { class: 'drop-row' });

      const lhs = el('div', { class: 'drop-lhs' });
      const skillSel = select(customAttrs, check.skillCheck ?? '', v => { check.skillCheck = v; onChange(); });
      skillSel.className = 'form-select';
      lhs.appendChild(skillSel);
      const flagInput = el('input', { type: 'text', class: 'form-input', value: check.flag ?? '', placeholder: 'result flag (e.g. noticed_glint)' });
      flagInput.addEventListener('input', () => { check.flag = flagInput.value.trim(); onChange(); });
      lhs.appendChild(flagInput);
      const textInput = el('input', { type: 'text', class: 'form-input', value: check.text ?? '', placeholder: 'narration on success (optional)' });
      textInput.addEventListener('input', () => { check.text = textInput.value || undefined; onChange(); });
      lhs.appendChild(textInput);
      row.appendChild(lhs);

      const rhs = el('div', { class: 'drop-rhs' });
      rhs.append(...dcInput(check, onChange));
      const rm = el('button', { class: 'btn-hdr' }, ['✕']);
      rm.addEventListener('click', () => { data.passiveChecks.splice(i, 1); onChange(); render(); });
      rhs.appendChild(rm);
      row.appendChild(rhs);

      container.appendChild(row);
    });

    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Add Passive Check']);
    add.addEventListener('click', () => {
      if (!Array.isArray(data.passiveChecks)) data.passiveChecks = [];
      data.passiveChecks.push({ skillCheck: customAttrs[0]?.[0] ?? '', dc: 10, flag: '' });
      onChange(); render();
    });
    container.appendChild(add);
  }

  render();
  return container;
}

// ── Auto Attack ────────────────────────────────────────────────────────────

function renderAutoAttack(data, onChange) {
  const wrap = el('div');
  const npcIds = Object.keys(store.index?.npcs ?? {});

  function render() {
    wrap.innerHTML = '';
    if (!data.autoAttack) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Enable Auto Attack']);
      btn.addEventListener('click', () => { data.autoAttack = { enemies: [], onVictory: [] }; onChange(); render(); });
      wrap.appendChild(btn);
    } else {
      const card = el('div', { class: 'card-item' });
      const aa = data.autoAttack;
      if (!Array.isArray(aa.enemies))   aa.enemies   = [];
      if (!Array.isArray(aa.onVictory)) aa.onVictory = [];

      const aaHdr = el('div', { class: 'card-hdr' });
      aaHdr.appendChild(el('span', { class: 'card-hdr-label' }, ['Auto Attack']));
      const rmHdr = el('button', { class: 'btn-hdr' }, ['✕']);
      rmHdr.addEventListener('click', () => { delete data.autoAttack; onChange(); render(); });
      aaHdr.appendChild(rmHdr);
      card.appendChild(aaHdr);

      const cardBody = el('div', { class: 'card-body' });

      // Enemies
      const enemyParam = el('div', { class: 'action-param' });
      enemyParam.appendChild(el('span', { class: 'action-param-label' }, ['Enemies']));
      enemyParam.appendChild(renderEnemyList(aa.enemies, npcIds, onChange));
      cardBody.appendChild(enemyParam);

      const aaCondWrap = el('div', { class: 'card-section' });
      aaCondWrap.appendChild(renderInlineCondition(
        () => aa.condition,
        v => { if (v == null) delete aa.condition; else aa.condition = v; },
        onChange
      ));
      cardBody.appendChild(aaCondWrap);

      const victorySection = el('div', { class: 'card-section' });
      victorySection.appendChild(el('div', { class: 'card-section-label' }, ['On Victory']));
      victorySection.appendChild(renderActionPipeline(aa.onVictory, onChange));
      cardBody.appendChild(victorySection);

      card.appendChild(cardBody);
      wrap.appendChild(card);
    }
  }

  render();
  return wrap;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function blockHeader(label, onRemove) {
  const hdr = el('div', { class: 'card-hdr collapsible' });
  hdr.appendChild(el('span', { class: 'card-hdr-label' }, [label]));
  const btn = el('button', { class: 'btn-hdr' }, ['✕']);
  btn.addEventListener('click', onRemove);
  hdr.appendChild(btn);
  return hdr;
}

function renderDisplaysList(data, onChange) {
  const container = el('div', { class: 'flat-list' });

  function render() {
    container.innerHTML = '';
    if (!Array.isArray(data.displays)) data.displays = [];

    data.displays.forEach((disp, i) => {
      const card = el('div', { class: 'card-item' });

      const hdr = el('div', { class: 'card-hdr collapsible' });
      const nameInput = el('input', {
        type: 'text',
        class: 'form-input flat-title-input',
        value: disp.name ?? '',
        placeholder: 'Display stand name (e.g. Mahogany Pedestal)…'
      });
      nameInput.addEventListener('input', () => { disp.name = nameInput.value; onChange(); });
      hdr.appendChild(nameInput);

      const rm = el('button', { class: 'btn-hdr' }, ['✕']);
      rm.addEventListener('click', () => { data.displays.splice(i, 1); onChange(); render(); });
      hdr.appendChild(rm);
      card.appendChild(hdr);

      const cardBody = el('div', { class: 'card-body' });

      // ID field (required)
      const idInput = el('input', {
        type: 'text',
        class: 'form-input',
        value: disp.id ?? '',
        placeholder: 'Unique ID (e.g. museum_pedestal_1)'
      });
      idInput.addEventListener('input', () => { disp.id = idInput.value.trim(); onChange(); });
      cardBody.appendChild(formRow('Display ID', idInput));

      // Starting pre-placed item (optional)
      const itemIds = Object.keys(store.index?.items ?? {});
      const itemSel = select(
        [['', 'None (Empty)'], ...itemIds.map(id => [id, id])],
        disp.item ?? '',
        v => {
          if (v) disp.item = v;
          else delete disp.item;
          onChange();
        }
      );
      itemSel.className = 'form-select';
      cardBody.appendChild(formRow('Pre-placed Relic', itemSel));

      card.appendChild(cardBody);

      makeCollapsible(hdr, cardBody);

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Display Stand']);
    add.addEventListener('click', () => {
      // Derive a unique id from the existing ids rather than Date.now(), which
      // collides when two stands are added within the same millisecond.
      const existing = new Set(data.displays.map(d => d.id));
      let n = data.displays.length + 1;
      let id = `display_${n}`;
      while (existing.has(id)) id = `display_${++n}`;
      data.displays.push({ id, name: 'New Display Stand' });
      onChange();
      render();
    });
    container.appendChild(add);
  }

  render();
  return container;
}
