import { store, markDirty } from '../app.js';
import { el, formRow, select } from '../utils.js';
import { renderActionPipeline } from './actions.js';
import { renderInlineCondition } from './condition-inline.js';
import { openDialogueGraph } from '../complex/nodes.js';

export function renderNpcForm(key, data) {
  // Normalize carriedItems to array-of-objects
  if (Array.isArray(data.carriedItems)) {
    data.carriedItems = data.carriedItems.map(e =>
      typeof e === 'string' ? { item: e, amount: 1 } : e
    );
  } else {
    data.carriedItems = [];
  }
  if (!data.conversations) data.conversations = {};

  const wrap = el('div', { class: 'form-wrap wide' });
  const titleEl = el('h2', { class: 'form-title' }, [data.name || 'New NPC']);
  wrap.appendChild(titleEl);

  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  const onChange = () => markDirty(key);

  // ── Basic fields ─────────────────────────────────────────────────────────

  const nameInput = el('input', { type: 'text', class: 'form-input', value: data.name ?? '', 'data-required': '' });
  nameInput.addEventListener('input', () => {
    data.name = nameInput.value;
    titleEl.textContent = nameInput.value || 'New NPC';
    onChange();
  });
  form.appendChild(formRow('Name', nameInput));

  const descTa = el('textarea', { class: 'form-textarea', style: 'min-height:56px' }, [data.description ?? '']);
  descTa.addEventListener('input', () => { data.description = descTa.value || undefined; onChange(); });
  form.appendChild(formRow('Description', descTa));

  const merchantCheck = el('input', { type: 'checkbox' });
  if (data.isMerchant) merchantCheck.checked = true;
  merchantCheck.addEventListener('change', () => {
    data.isMerchant = merchantCheck.checked || undefined;
    exitTextRow.style.display = data.isMerchant ? '' : 'none';
    onChange();
  });
  form.appendChild(formRow('Is Merchant', merchantCheck));

  const exitInput = el('input', { type: 'text', class: 'form-input', value: data.storeExitText ?? '' });
  exitInput.addEventListener('input', () => { data.storeExitText = exitInput.value || undefined; onChange(); });
  const exitTextRow = formRow('Store Exit Text', exitInput);
  exitTextRow.style.display = data.isMerchant ? '' : 'none';
  form.appendChild(exitTextRow);

  // ── Combat Attributes ────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Combat Attributes']));
  if (!data.attributes) data.attributes = {};

  for (const [field, label] of [
    ['healthPoints', 'Health Points'],
    ['armorClass',   'Armor Class'],
    ['actionPoints', 'Action Points'],
    ['initiative',   'Initiative'],
    ['xpReward',     'XP Reward'],
  ]) {
    const input = el('input', { type: 'number', class: 'form-input', value: data.attributes[field] ?? '' });
    input.addEventListener('input', () => {
      data.attributes[field] = input.value === '' ? undefined : Number(input.value);
      onChange();
    });
    form.appendChild(formRow(label, input));
  }

  // ── Equipment ────────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Equipment']));
  if (!data.equipment) data.equipment = {};
  const itemIds = Object.keys(store.index?.items ?? {});

  for (const slot of ['Head', 'Amulet', 'Torso', 'Left Hand', 'Right Hand', 'Legs']) {
    const sel = select(
      [['', 'None'], ...itemIds.map(id => [id, id])],
      data.equipment[slot] ?? '',
      v => { if (v) data.equipment[slot] = v; else delete data.equipment[slot]; onChange(); }
    );
    sel.className = 'form-select';
    form.appendChild(formRow(slot, sel));
  }

  // ── Carried Items ─────────────────────────────────────────────────────────

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Carried Items']));
  form.appendChild(renderCarriedItems(data, itemIds, onChange));

  // ── Conversations ─────────────────────────────────────────────────────────

  const convHdr = el('div', { class: 'section-hdr-row' });
  convHdr.appendChild(el('h3', { class: 'form-section-title', style: 'margin:0;border:none;padding:0' }, ['Conversations']));
  if (Object.keys(data.conversations ?? {}).length > 0) {
    const graphBtn = el('button', { class: 'btn btn-secondary btn-sm' }, ['View Graph']);
    graphBtn.addEventListener('click', () => openDialogueGraph(key));
    convHdr.appendChild(graphBtn);
  }
  form.appendChild(convHdr);
  form.appendChild(renderConversations(data, onChange));

  return wrap;
}

// ── Carried Items ──────────────────────────────────────────────────────────

function renderCarriedItems(data, itemIds, onChange) {
  const container = el('div', { class: 'list-editor' });

  function render() {
    container.innerHTML = '';
    data.carriedItems.forEach((entry, i) => {
      const row = el('div', { class: 'list-row' });
      const sel = select(itemIds.map(id => [id, id]), entry.item, v => { entry.item = v; onChange(); });
      sel.className = 'form-select';
      const amtInput = el('input', { type: 'number', class: 'form-input sm', min: '1', value: entry.amount ?? 1 });
      amtInput.addEventListener('input', () => { entry.amount = Number(amtInput.value); onChange(); });
      const rm = el('button', { class: 'btn-hdr' }, ['✕']);
      rm.addEventListener('click', () => { data.carriedItems.splice(i, 1); onChange(); render(); });
      row.append(sel, el('span', { class: 'list-label' }, ['×']), amtInput, rm);
      container.appendChild(row);
    });
    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Item']);
    add.addEventListener('click', () => {
      data.carriedItems.push({ item: itemIds[0] ?? '', amount: 1 });
      onChange(); render();
    });
    container.appendChild(add);
  }

  render();
  return container;
}

// ── Conversations ──────────────────────────────────────────────────────────

function renderConversations(data, onChange) {
  const container = el('div', { class: 'conv-list' });

  function render() {
    container.innerHTML = '';

    for (const [nodeId, node] of Object.entries(data.conversations)) {
      if (!Array.isArray(node.responses)) node.responses = [];
      container.appendChild(renderNode(nodeId, node, data, onChange, render));
    }

    // Add new node row
    const addRow = el('div', { class: 'list-row' });
    const idInput = el('input', { type: 'text', class: 'form-input', placeholder: 'new_node_id' });
    const addBtn  = el('button', { class: 'btn btn-secondary' }, ['+ Add Node']);
    addBtn.addEventListener('click', () => {
      const id = idInput.value.trim();
      if (!id || data.conversations[id]) { idInput.style.borderColor = 'var(--danger)'; return; }
      data.conversations[id] = { npcText: '', responses: [] };
      idInput.value = '';
      idInput.style.borderColor = '';
      onChange(); render();
    });
    addRow.append(idInput, addBtn);
    container.appendChild(addRow);
  }

  render();
  return container;
}

function renderNode(nodeId, node, data, onChange, rerenderAll) {
  let currentId = nodeId;

  const card = el('div', { class: 'card-item' });

  const header = el('div', { class: 'card-hdr collapsible' });

  const idInput = el('input', { type: 'text', class: 'form-input flat-title-input', value: nodeId });
  idInput.addEventListener('change', () => {
    const newId = idInput.value.trim();
    if (!newId || newId === currentId) return;
    const nodeData = data.conversations[currentId];
    delete data.conversations[currentId];
    data.conversations[newId] = nodeData;
    currentId = newId;
    onChange();
  });
  header.appendChild(idInput);

  const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
  rmBtn.addEventListener('click', e => {
    e.stopPropagation();
    delete data.conversations[currentId];
    onChange(); rerenderAll();
  });
  header.appendChild(rmBtn);
  card.appendChild(header);

  const body = el('div', { class: 'card-body' });
  card.appendChild(body);

  const npcTa = el('textarea', { class: 'form-textarea', style: 'min-height:56px', placeholder: 'NPC text…' }, [node.npcText ?? '']);
  npcTa.addEventListener('input', () => { node.npcText = npcTa.value; onChange(); });
  body.appendChild(npcTa);

  if (!Array.isArray(node.actions)) node.actions = [];
  const actSection = el('div', { class: 'card-section' });
  actSection.appendChild(el('div', { class: 'card-section-label' }, ['Actions']));
  actSection.appendChild(renderActionPipeline(node.actions, onChange));
  body.appendChild(actSection);

  const respSection = el('div', { class: 'card-section' });
  respSection.appendChild(el('span', { class: 'action-param-label' }, ['Responses']));

  const respContainer = el('div', { class: 'resp-list' });
  respSection.appendChild(respContainer);
  body.appendChild(respSection);

  function renderRespCards() {
    respContainer.innerHTML = '';
    node.responses.forEach((resp, i) => {
      if (!Array.isArray(resp.actions)) resp.actions = [];
      respContainer.appendChild(makeResponseCard(resp, i, node, onChange, renderRespCards));
    });
    const addRespBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Response']);
    addRespBtn.addEventListener('click', () => {
      node.responses.push({ text: '', actions: [] });
      onChange(); renderRespCards();
    });
    respContainer.appendChild(addRespBtn);
  }
  renderRespCards();

  let collapsed = true;
  body.style.display = 'none';
  header.classList.add('collapsed');
  header.addEventListener('click', e => {
    if (e.target === idInput || rmBtn.contains(e.target)) return;
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    header.classList.toggle('collapsed', collapsed);
  });

  return card;
}

function makeResponseCard(resp, i, node, onChange, rerender) {
  const item = el('div', { class: 'card-item' });

  const hdr = el('div', { class: 'card-hdr collapsible' });
  const textInput = el('input', { type: 'text', class: 'form-input flat-title-input', value: resp.text ?? '', placeholder: `Response ${i + 1}…` });
  textInput.addEventListener('input', () => { resp.text = textInput.value; onChange(); });
  hdr.appendChild(textInput);
  const rm = el('button', { class: 'btn-hdr' }, ['✕']);
  rm.addEventListener('click', () => { node.responses.splice(i, 1); onChange(); rerender(); });
  hdr.appendChild(rm);
  item.appendChild(hdr);

  if (!Array.isArray(resp.onFailure)) resp.onFailure = [];

  const body = el('div', { class: 'card-body' });
  body.appendChild(renderSkillCheckRow(resp, onChange));
  const respCondWrap = el('div', { class: 'card-section' });
  respCondWrap.appendChild(renderInlineCondition(
    () => resp.condition,
    v => { if (v == null) delete resp.condition; else resp.condition = v; },
    onChange
  ));
  body.appendChild(respCondWrap);
  const actSection = el('div', { class: 'card-section' });
  actSection.appendChild(el('div', { class: 'card-section-label' }, ['On Success']));
  actSection.appendChild(renderActionPipeline(resp.actions, onChange));
  body.appendChild(actSection);
  const failSection = el('div', { class: 'card-section' });
  failSection.appendChild(el('div', { class: 'card-section-label' }, ['On Failure']));
  failSection.appendChild(renderActionPipeline(resp.onFailure, onChange));
  body.appendChild(failSection);
  item.appendChild(body);

  let collapsed = true;
  body.style.display = 'none';
  hdr.classList.add('collapsed');
  hdr.addEventListener('click', e => {
    if (textInput.contains(e.target) || rm.contains(e.target)) return;
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    hdr.classList.toggle('collapsed', collapsed);
  });

  return item;
}

function renderSkillCheckRow(resp, onChange) {
  const attrs = (store.files['__rules']?.customAttributes ?? []).map(a => [a.id, a.id]);
  const ctrl = el('div', { class: 'skill-row-ctrl' });

  function render() {
    ctrl.innerHTML = '';
    const sel = select(
      [['', 'None'], ...attrs],
      resp.skillCheck ?? '',
      v => {
        if (v) {
          resp.skillCheck = v;
          if (resp.dc == null) resp.dc = 10;
          if (resp.increment == null) resp.increment = 1;
        } else {
          delete resp.skillCheck;
          delete resp.dc;
          delete resp.increment;
        }
        onChange(); render();
      }
    );
    sel.className = 'form-select';
    ctrl.appendChild(sel);

    if (resp.skillCheck) {
      ctrl.appendChild(el('span', { class: 'list-label' }, ['DC']));
      const dcInput = el('input', { type: 'number', class: 'form-input sm', value: resp.dc ?? '' });
      dcInput.addEventListener('input', () => { resp.dc = dcInput.value === '' ? undefined : Number(dcInput.value); onChange(); });
      ctrl.appendChild(dcInput);

      ctrl.appendChild(el('span', { class: 'list-label' }, ['+']));
      const incInput = el('input', { type: 'number', class: 'form-input sm', value: resp.increment ?? '' });
      incInput.addEventListener('input', () => { resp.increment = incInput.value === '' ? undefined : Number(incInput.value); onChange(); });
      ctrl.appendChild(incInput);
    }
  }

  render();
  const wrap = el('div', { class: 'action-param' });
  wrap.appendChild(el('span', { class: 'action-param-label' }, ['Skill Check']));
  wrap.appendChild(ctrl);
  return wrap;
}
