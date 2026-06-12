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
  data.description = data.description.map(d => typeof d === 'string' ? { text: d } : d);
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

  const xpInput = el('input', { type: 'number', class: 'form-input', value: data.xpReward ?? '' });
  xpInput.addEventListener('input', () => { data.xpReward = xpInput.value === '' ? undefined : Number(xpInput.value); onChange(); });
  form.appendChild(formRow('XP Reward', xpInput));

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
  form.appendChild(formRow('Description Hook', hookInput));

  // supportsExhibits checkbox
  const exhibitsCheckbox = el('input', { type: 'checkbox', class: 'form-checkbox' });
  if (data.supportsExhibits) exhibitsCheckbox.checked = true;
  exhibitsCheckbox.addEventListener('change', () => {
    data.supportsExhibits = exhibitsCheckbox.checked ? true : undefined;
    onChange();
  });
  form.appendChild(formRow('Supports Exhibits', exhibitsCheckbox));

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

  // ── Display Stands ───────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Display Stands']));
  form.appendChild(renderDisplaysList(data, onChange));

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

      let collapsed = true;
      cardBody.style.display = 'none';
      hdr.classList.add('collapsed');
      hdr.addEventListener('click', e => {
        if (e.target.closest('.btn-hdr')) return;
        collapsed = !collapsed;
        cardBody.style.display = collapsed ? 'none' : '';
        hdr.classList.toggle('collapsed', collapsed);
      });

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
  const container = el('div', { class: 'flat-list' });
  const itemIds = Object.keys(store.index?.items ?? {});

  function render() {
    container.innerHTML = '';
    data.options.forEach((opt, i) => {
      if (!Array.isArray(opt.actions)) opt.actions = [];

      const item = el('div', { class: 'card-item' });

      const hdr = el('div', { class: 'card-hdr collapsible' });
      const textInput = el('input', { type: 'text', class: 'form-input flat-title-input', value: opt.text ?? '', placeholder: 'Option text…' });
      textInput.addEventListener('input', () => { opt.text = textInput.value; onChange(); });
      hdr.appendChild(textInput);
      const rm = el('button', { class: 'btn-hdr' }, ['✕']);
      rm.addEventListener('click', () => { data.options.splice(i, 1); onChange(); render(); });
      hdr.appendChild(rm);
      item.appendChild(hdr);

      const cardBody = el('div', { class: 'card-body' });
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
      const reqParam = el('div', { class: 'action-param' });
      reqParam.appendChild(el('span', { class: 'action-param-label' }, ['Requires Item']));
      reqParam.appendChild(reqSel);
      cardBody.appendChild(reqParam);

      const curLog = opt.log;
      let logMode = 'default';
      if (curLog === false) logMode = 'silent';
      else if (typeof curLog === 'string') logMode = 'custom';

      const customLogInput = el('input', {
        type: 'text',
        class: 'form-input',
        value: typeof opt.log === 'string' ? opt.log : '',
        placeholder: 'Enter custom log description…',
        style: logMode === 'custom' ? 'margin-top:4px' : 'display:none;margin-top:4px'
      });
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

      const logParam = el('div', { class: 'action-param' });
      logParam.appendChild(el('span', { class: 'action-param-label' }, ['Narrative Log']));
      logParam.appendChild(el('div', { style: 'display:flex;flex-direction:column;flex-grow:1' }, [logModeSel, customLogInput]));
      cardBody.appendChild(logParam);
      const optCondWrap = el('div', { class: 'card-section' });
      optCondWrap.appendChild(renderInlineCondition(
        () => opt.condition,
        v => { if (v == null) delete opt.condition; else opt.condition = v; },
        onChange
      ));
      cardBody.appendChild(optCondWrap);
      const actWrap = el('div', { class: 'card-section' });
      actWrap.appendChild(el('div', { class: 'card-section-label' }, ['Actions']));
      actWrap.appendChild(renderActionPipeline(opt.actions, onChange));
      cardBody.appendChild(actWrap);
      item.appendChild(cardBody);

      let collapsed = true;
      cardBody.style.display = 'none';
      hdr.classList.add('collapsed');
      hdr.addEventListener('click', e => {
        if (textInput.contains(e.target) || rm.contains(e.target)) return;
        collapsed = !collapsed;
        cardBody.style.display = collapsed ? 'none' : '';
        hdr.classList.toggle('collapsed', collapsed);
      });

      container.appendChild(item);
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
  const container = el('div', { class: 'flat-list' });
  const itemIds  = Object.keys(store.index?.items  ?? {});
  const tableIds = Object.keys(store.index?.tables ?? {});
  const customAttrs = (store.files['__rules']?.customAttributes ?? []).map(a => [a.id, a.id]);

  function render() {
    container.innerHTML = '';
    data.skills.forEach((skill, i) => {
      const item = el('div', { class: 'card-item' });

      const hdr = el('div', { class: 'card-hdr collapsible' });
      const textInput = el('input', { type: 'text', class: 'form-input flat-title-input', value: skill.text ?? '', placeholder: 'Button text…' });
      textInput.addEventListener('input', () => { skill.text = textInput.value; onChange(); });
      hdr.appendChild(textInput);
      const skillSel = select(customAttrs, skill.skillCheck ?? '', v => { skill.skillCheck = v; onChange(); });
      skillSel.className = 'form-select';
      hdr.appendChild(skillSel);
      const rm = el('button', { class: 'btn-hdr' }, ['✕']);
      rm.addEventListener('click', () => { data.skills.splice(i, 1); onChange(); render(); });
      hdr.appendChild(rm);
      item.appendChild(hdr);

      if (!Array.isArray(skill.actions)) skill.actions = [];
      if (!Array.isArray(skill.onFailure)) skill.onFailure = [];
      if (!Array.isArray(skill.items)) skill.items = [];

      const cardBody = el('div', { class: 'card-body' });

      const dcWrap = el('div', { class: 'card-section' });
      const dcRow = el('div', { class: 'drop-rhs' });
      const dcInput = el('input', { type: 'number', class: 'form-input sm', value: skill.dc ?? '', placeholder: 'DC' });
      dcInput.addEventListener('input', () => { skill.dc = dcInput.value === '' ? undefined : Number(dcInput.value); onChange(); });
      const incInput = el('input', { type: 'number', class: 'form-input sm', value: skill.increment ?? '', placeholder: 'Increment' });
      incInput.addEventListener('input', () => { skill.increment = incInput.value === '' ? undefined : Number(incInput.value); onChange(); });
      dcRow.append(el('span', { class: 'list-label' }, ['DC']), dcInput, el('span', { class: 'list-label' }, ['+ Increment']), incInput);
      dcWrap.appendChild(dcRow);
      cardBody.appendChild(dcWrap);

      const skillCondWrap = el('div', { class: 'card-section' });
      skillCondWrap.appendChild(renderInlineCondition(
        () => skill.condition,
        v => { if (v == null) delete skill.condition; else skill.condition = v; },
        onChange
      ));
      cardBody.appendChild(skillCondWrap);

      const actWrap = el('div', { class: 'card-section' });
      actWrap.appendChild(el('div', { class: 'card-section-label' }, ['On Success']));
      actWrap.appendChild(renderActionPipeline(skill.actions, onChange));
      cardBody.appendChild(actWrap);

      const failWrap = el('div', { class: 'card-section' });
      failWrap.appendChild(el('div', { class: 'card-section-label' }, ['On Failure']));
      failWrap.appendChild(renderActionPipeline(skill.onFailure, onChange));
      cardBody.appendChild(failWrap);

      const dropsWrap = el('div', { class: 'card-section' });
      dropsWrap.appendChild(el('div', { class: 'card-section-label' }, ['Item Drops']));
      dropsWrap.appendChild(renderDropsList(skill, itemIds, tableIds, onChange));
      cardBody.appendChild(dropsWrap);

      item.appendChild(cardBody);

      let collapsed = true;
      cardBody.style.display = 'none';
      hdr.classList.add('collapsed');
      hdr.addEventListener('click', e => {
        if (textInput.contains(e.target) || skillSel.contains(e.target) || rm.contains(e.target)) return;
        collapsed = !collapsed;
        cardBody.style.display = collapsed ? 'none' : '';
        hdr.classList.toggle('collapsed', collapsed);
      });

      container.appendChild(item);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Skill Check']);
    add.addEventListener('click', () => {
      data.skills.push({ text: '', skillCheck: customAttrs[0]?.[0] ?? '', dc: 10, increment: 2, actions: [], onFailure: [] });
      onChange(); render();
    });
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
      const dcInput = el('input', { type: 'number', class: 'form-input sm', value: drop.dc ?? '', placeholder: 'DC' });
      dcInput.addEventListener('input', () => { drop.dc = dcInput.value === '' ? undefined : Number(dcInput.value); onChange(); });
      const incInput = el('input', { type: 'number', class: 'form-input sm', value: drop.increment ?? '', placeholder: 'Increment' });
      incInput.addEventListener('input', () => { drop.increment = incInput.value === '' ? undefined : Number(incInput.value); onChange(); });
      rhs.append(el('span', { class: 'list-label' }, ['DC']), dcInput, el('span', { class: 'list-label' }, ['+ Increment']), incInput);
      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
      rmBtn.addEventListener('click', () => { skill.items.splice(i, 1); onChange(); render(); });
      rhs.appendChild(rmBtn);
      row.appendChild(rhs);

      container.appendChild(row);
    });

    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Add Drop']);
    add.addEventListener('click', () => {
      skill.items.push({ item: itemIds[0] ?? '', amount: 1, dc: 10, increment: 1 });
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
      const enemyList = el('div', { class: 'mini-list' });
      function rebuildEnemies() {
        enemyList.innerHTML = '';
        aa.enemies.forEach((id, i) => {
          const row = el('div', { class: 'list-row' });
          const sel = select(npcIds.map(nid => [nid, nid]), id, v => { aa.enemies[i] = v; onChange(); });
          sel.className = 'form-select';
          const rm = el('button', { class: 'btn-hdr' }, ['✕']);
          rm.addEventListener('click', () => { aa.enemies.splice(i, 1); onChange(); rebuildEnemies(); });
          row.append(sel, rm);
          enemyList.appendChild(row);
        });
        const addE = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Enemy']);
        addE.addEventListener('click', () => { aa.enemies.push(npcIds[0] ?? ''); onChange(); rebuildEnemies(); });
        enemyList.appendChild(addE);
      }
      rebuildEnemies();
      enemyParam.appendChild(enemyList);
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

      let collapsed = true;
      cardBody.style.display = 'none';
      hdr.classList.add('collapsed');
      hdr.addEventListener('click', e => {
        if (nameInput.contains(e.target) || rm.contains(e.target)) return;
        collapsed = !collapsed;
        cardBody.style.display = collapsed ? 'none' : '';
        hdr.classList.toggle('collapsed', collapsed);
      });

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Display Stand']);
    add.addEventListener('click', () => {
      const id = `display_${Date.now()}`;
      data.displays.push({ id, name: 'New Display Stand' });
      onChange();
      render();
    });
    container.appendChild(add);
  }

  render();
  return container;
}
