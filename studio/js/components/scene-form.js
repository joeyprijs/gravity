import { store, markDirty } from '../app.js';
import { el, formRow, select } from '../utils.js';
import { renderActionPipeline } from './actions.js';
import { renderInlineCondition } from './condition-inline.js';

export function renderSceneForm(key, data) {
  // Normalize description to array-of-objects (engine accepts both formats)
  if (typeof data.description === 'string') {
    data.description = [{ text: data.description }];
  } else if (!Array.isArray(data.description)) {
    data.description = [];
  }
  data.description.forEach(d => { if (typeof d === 'string') Object.assign(d, { text: d }); });
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

  // ── Quest Trigger ────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Quest Trigger']));
  form.appendChild(renderQuestTrigger(data, onChange));

  // ── Map Position ─────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Map Position']));
  form.appendChild(renderMapDefs(data, onChange));

  // ── Description Blocks ───────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Description']));
  form.appendChild(renderDescBlocks(data, onChange));

  // ── Options ──────────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Options']));
  form.appendChild(renderOptions(data, onChange));

  // ── Skill Checks ─────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Skill Checks']));
  form.appendChild(renderSkills(data, onChange));

  // ── Auto Attack ──────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Auto Attack']));
  form.appendChild(renderAutoAttack(data, onChange));

  return wrap;
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

      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['Remove']);
      rm.style.marginTop = '4px';
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

      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['Remove']);
      rm.style.marginTop = '4px';
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
      const card = el('div', { class: 'block-item' });

      const hdr = blockHeader(`Block ${i + 1}`, () => { data.description.splice(i, 1); onChange(); render(); });
      card.appendChild(hdr);

      const ta = el('textarea', { class: 'form-textarea desc-ta' }, [block.text ?? '']);
      ta.addEventListener('input', () => { block.text = ta.value; onChange(); });
      card.appendChild(ta);

      card.appendChild(renderInlineCondition(
        () => block.condition,
        v => { if (v == null) delete block.condition; else block.condition = v; },
        onChange
      ));

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Block']);
    add.addEventListener('click', () => { data.description.push({ text: '' }); onChange(); render(); });
    container.appendChild(add);
  }

  render();
  return container;
}

// ── Options ────────────────────────────────────────────────────────────────

function renderOptions(data, onChange) {
  const container = el('div', { class: 'block-list' });
  const itemIds = Object.keys(store.index?.items ?? {});

  function render() {
    container.innerHTML = '';
    data.options.forEach((opt, i) => {
      if (!Array.isArray(opt.actions)) opt.actions = [];

      const card = el('div', { class: 'block-item' });
      const labelEl = el('span', { class: 'block-title' }, [previewText(opt.text, `Option ${i + 1}`)]);

      const hdr = el('div', { class: 'block-header' }, [labelEl]);
      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rm.addEventListener('click', () => { data.options.splice(i, 1); onChange(); render(); });
      hdr.appendChild(rm);
      card.appendChild(hdr);

      const textInput = el('input', { type: 'text', class: 'form-input', value: opt.text ?? '', placeholder: 'Button text' });
      textInput.addEventListener('input', () => {
        opt.text = textInput.value;
        labelEl.textContent = previewText(opt.text, `Option ${i + 1}`);
        onChange();
      });
      card.appendChild(formRow('Text', textInput));

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
      card.appendChild(formRow('Requires Item', reqSel));

      card.appendChild(renderInlineCondition(
        () => opt.condition,
        v => { if (v == null) delete opt.condition; else opt.condition = v; },
        onChange
      ));

      card.appendChild(el('div', { class: 'section-label' }, ['Actions']));
      card.appendChild(renderActionPipeline(opt.actions, onChange));

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Option']);
    add.addEventListener('click', () => { data.options.push({ text: '', actions: [] }); onChange(); render(); });
    container.appendChild(add);
  }

  render();
  return container;
}

// ── Skill Checks ───────────────────────────────────────────────────────────

function renderSkills(data, onChange) {
  const container = el('div', { class: 'block-list' });
  const itemIds  = Object.keys(store.index?.items  ?? {});
  const tableIds = Object.keys(store.index?.tables ?? {});
  const customAttrs = (store.files['__rules']?.customAttributes ?? []).map(a => [a.id, a.id]);

  function render() {
    container.innerHTML = '';
    data.skills.forEach((skill, i) => {
      if (!Array.isArray(skill.items)) skill.items = [];

      const card = el('div', { class: 'block-item' });
      const hdr = blockHeader(`Skill Check ${i + 1}`, () => { data.skills.splice(i, 1); onChange(); render(); });
      card.appendChild(hdr);

      const textInput = el('input', { type: 'text', class: 'form-input', value: skill.text ?? '' });
      textInput.addEventListener('input', () => { skill.text = textInput.value; onChange(); });
      card.appendChild(formRow('Button Text', textInput));

      const skillSel = select(customAttrs, skill.skillCheck ?? '', v => { skill.skillCheck = v; onChange(); });
      skillSel.className = 'form-select';
      card.appendChild(formRow('Skill', skillSel));

      card.appendChild(el('div', { class: 'section-label' }, ['Item Drops']));
      card.appendChild(renderDropsList(skill, itemIds, tableIds, onChange));

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Skill Check']);
    add.addEventListener('click', () => { data.skills.push({ text: '', skillCheck: customAttrs[0]?.[0] ?? '', items: [] }); onChange(); render(); });
    container.appendChild(add);
  }

  render();
  return container;
}

function renderDropsList(skill, itemIds, tableIds, onChange) {
  const container = el('div', { class: 'block-list' });

  function render() {
    container.innerHTML = '';
    skill.items.forEach((drop, i) => {
      const row = el('div', { class: 'action-row' });
      const isTable = drop.table !== undefined;

      const modeSel = select([['item', 'Item'], ['table', 'Table']], isTable ? 'table' : 'item', v => {
        if (v === 'table') { delete drop.item; delete drop.amount; drop.table = tableIds[0] ?? ''; drop.itemDrops = 1; }
        else               { delete drop.table; delete drop.itemDrops; drop.item = itemIds[0] ?? ''; drop.amount = 1; }
        onChange(); render();
      });
      modeSel.className = 'form-select sm';
      row.appendChild(modeSel);

      if (isTable) {
        const tSel = select(tableIds.map(id => [id, id]), drop.table ?? '', v => { drop.table = v; onChange(); });
        tSel.className = 'form-select';
        row.appendChild(tSel);
        const drInput = el('input', { type: 'number', class: 'form-input sm', value: drop.itemDrops ?? 1 });
        drInput.addEventListener('input', () => { drop.itemDrops = Number(drInput.value); onChange(); });
        row.append(el('span', { class: 'list-label' }, ['drops']), drInput);
      } else {
        const iSel = select(itemIds.map(id => [id, id]), drop.item ?? '', v => { drop.item = v; onChange(); });
        iSel.className = 'form-select';
        row.appendChild(iSel);
        const amtInput = el('input', { type: 'number', class: 'form-input sm', value: drop.amount ?? 1 });
        amtInput.addEventListener('input', () => { drop.amount = Number(amtInput.value); onChange(); });
        row.append(el('span', { class: 'list-label' }, ['×']), amtInput);
      }

      const dcInput = el('input', { type: 'number', class: 'form-input sm', value: drop.dc ?? '', placeholder: 'DC' });
      dcInput.addEventListener('input', () => { drop.dc = dcInput.value === '' ? undefined : Number(dcInput.value); onChange(); });
      const incInput = el('input', { type: 'number', class: 'form-input sm', value: drop.increment ?? '', placeholder: '+' });
      incInput.addEventListener('input', () => { drop.increment = incInput.value === '' ? undefined : Number(incInput.value); onChange(); });
      row.append(el('span', { class: 'list-label' }, ['DC']), dcInput, el('span', { class: 'list-label' }, ['+']), incInput);

      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rm.addEventListener('click', () => { skill.items.splice(i, 1); onChange(); render(); });
      row.appendChild(rm);

      container.appendChild(row);
    });

    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Add Drop']);
    add.addEventListener('click', () => { skill.items.push({ item: itemIds[0] ?? '', amount: 1, dc: 10, increment: 1 }); onChange(); render(); });
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
      const aa = data.autoAttack;
      if (!Array.isArray(aa.enemies))   aa.enemies   = [];
      if (!Array.isArray(aa.onVictory)) aa.onVictory = [];

      // Enemies
      const enemyWrap = el('div', { class: 'list-editor' });
      function rebuildEnemies() {
        enemyWrap.innerHTML = '';
        aa.enemies.forEach((id, i) => {
          const row = el('div', { class: 'list-row' });
          const sel = select(npcIds.map(nid => [nid, nid]), id, v => { aa.enemies[i] = v; onChange(); });
          sel.className = 'form-select';
          const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
          rm.addEventListener('click', () => { aa.enemies.splice(i, 1); onChange(); rebuildEnemies(); });
          row.append(sel, rm);
          enemyWrap.appendChild(row);
        });
        const addE = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Enemy']);
        addE.addEventListener('click', () => { aa.enemies.push(npcIds[0] ?? ''); onChange(); rebuildEnemies(); });
        enemyWrap.appendChild(addE);
      }
      rebuildEnemies();
      wrap.appendChild(formRow('Enemies', enemyWrap));

      wrap.appendChild(renderInlineCondition(
        () => aa.condition,
        v => { if (v == null) delete aa.condition; else aa.condition = v; },
        onChange
      ));

      wrap.appendChild(el('div', { class: 'section-label' }, ['On Victory']));
      wrap.appendChild(renderActionPipeline(aa.onVictory, onChange));

      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['Remove Auto Attack']);
      rm.style.marginTop = '8px';
      rm.addEventListener('click', () => { delete data.autoAttack; onChange(); render(); });
      wrap.appendChild(rm);
    }
  }

  render();
  return wrap;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function blockHeader(label, onRemove) {
  const hdr = el('div', { class: 'block-header' });
  hdr.appendChild(el('span', { class: 'block-title' }, [label]));
  const btn = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
  btn.addEventListener('click', onRemove);
  hdr.appendChild(btn);
  return hdr;
}

function previewText(text, fallback) {
  return text ? `"${text.slice(0, 35)}${text.length > 35 ? '…' : ''}"` : fallback;
}
