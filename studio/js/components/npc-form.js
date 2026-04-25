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

  const nameInput = el('input', { type: 'text', class: 'form-input', value: data.name ?? '' });
  nameInput.addEventListener('input', () => {
    data.name = nameInput.value;
    titleEl.textContent = nameInput.value || 'New NPC';
    onChange();
  });
  form.appendChild(formRow('Name', nameInput));

  const descTa = el('textarea', { class: 'form-textarea', style: 'min-height:56px' }, [data.description ?? '']);
  descTa.addEventListener('input', () => { data.description = descTa.value || undefined; onChange(); });
  form.appendChild(formRow('Description', descTa));

  const dispositionSel = select(
    [['', 'None'], ['Hostile', 'Hostile'], ['Friendly', 'Friendly'], ['Neutral', 'Neutral']],
    data.disposition ?? '',
    v => { data.disposition = v || undefined; onChange(); }
  );
  dispositionSel.className = 'form-select';
  form.appendChild(formRow('Disposition', dispositionSel));

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
  form.appendChild(el('div', { class: 'form-section-title', style: 'padding-top:18px' }));
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
      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
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
    const addRow = el('div', { class: 'list-row', style: 'margin-top:8px' });
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

  const card = el('div', { class: 'conversation-node' });

  const header = el('div', { class: 'conv-node-header' });
  const nodeLabel = el('code', {}, [nodeId]);
  header.appendChild(nodeLabel);

  const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['Delete Node']);
  rmBtn.addEventListener('click', e => {
    e.stopPropagation();
    delete data.conversations[currentId];
    onChange(); rerenderAll();
  });
  header.appendChild(rmBtn);
  card.appendChild(header);

  const body = el('div', { class: 'conv-node-body' });
  card.appendChild(body);

  // Node ID rename
  const idInput = el('input', { type: 'text', class: 'form-input', value: nodeId });
  idInput.addEventListener('change', () => {
    const newId = idInput.value.trim();
    if (!newId || newId === currentId) return;
    const nodeData = data.conversations[currentId];
    delete data.conversations[currentId];
    data.conversations[newId] = nodeData;
    currentId = newId;
    nodeLabel.textContent = newId;
    onChange();
  });
  body.appendChild(formRow('Node ID', idInput));
  body.appendChild(el('p', { class: 'form-hint', style: 'margin-top:-4px' },
    ['Renaming does not update goToConversation references.']));

  const npcTa = el('textarea', { class: 'form-textarea', style: 'min-height:56px' }, [node.npcText ?? '']);
  npcTa.addEventListener('input', () => { node.npcText = npcTa.value; onChange(); });
  body.appendChild(formRow('NPC Text', npcTa));

  body.appendChild(el('div', { class: 'section-label' }, ['Responses']));
  body.appendChild(renderResponses(node, onChange));

  // Collapse toggle
  let collapsed = false;
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    header.classList.toggle('collapsed', collapsed);
  });

  return card;
}

function renderResponses(node, onChange) {
  const container = el('div', { class: 'block-list' });

  function render() {
    container.innerHTML = '';

    node.responses.forEach((resp, i) => {
      if (!Array.isArray(resp.actions)) resp.actions = [];

      const card = el('div', { class: 'response-item' });
      const labelEl = el('span', { class: 'block-title' }, [previewText(resp.text, `Response ${i + 1}`)]);

      const hdr = el('div', { class: 'block-header' }, [labelEl]);
      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rm.addEventListener('click', () => { node.responses.splice(i, 1); onChange(); render(); });
      hdr.appendChild(rm);
      card.appendChild(hdr);

      const textInput = el('input', { type: 'text', class: 'form-input', value: resp.text ?? '', placeholder: 'Player response text' });
      textInput.addEventListener('input', () => {
        resp.text = textInput.value;
        labelEl.textContent = previewText(resp.text, `Response ${i + 1}`);
        onChange();
      });
      card.appendChild(formRow('Text', textInput));

      card.appendChild(renderSkillCheckToggle(resp, onChange));

      card.appendChild(renderInlineCondition(
        () => resp.condition,
        v => { if (v == null) delete resp.condition; else resp.condition = v; },
        onChange
      ));

      card.appendChild(el('div', { class: 'section-label' }, ['Actions']));
      card.appendChild(renderActionPipeline(resp.actions, onChange));

      container.appendChild(card);
    });

    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Add Response']);
    add.addEventListener('click', () => { node.responses.push({ text: '', actions: [] }); onChange(); render(); });
    container.appendChild(add);
  }

  render();
  return container;
}

function renderSkillCheckToggle(resp, onChange) {
  const wrap = el('div', { style: 'margin-top:6px' });

  function render() {
    wrap.innerHTML = '';
    if (!resp.skillCheck) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Skill Check']);
      btn.addEventListener('click', () => {
        const attrs = store.files['__rules']?.customAttributes ?? [];
        resp.skillCheck = attrs[0]?.id ?? '';
        resp.dc = 10;
        resp.increment = 1;
        onChange(); render();
      });
      wrap.appendChild(btn);
    } else {
      const attrs = (store.files['__rules']?.customAttributes ?? []).map(a => [a.id, a.id]);
      const sel = select(attrs, resp.skillCheck, v => { resp.skillCheck = v; onChange(); });
      sel.className = 'form-select';
      wrap.appendChild(formRow('Skill Check', sel));

      const dcInput = el('input', { type: 'number', class: 'form-input sm', value: resp.dc ?? '' });
      dcInput.addEventListener('input', () => { resp.dc = dcInput.value === '' ? undefined : Number(dcInput.value); onChange(); });
      wrap.appendChild(formRow('DC', dcInput));

      const incInput = el('input', { type: 'number', class: 'form-input sm', value: resp.increment ?? '' });
      incInput.addEventListener('input', () => { resp.increment = incInput.value === '' ? undefined : Number(incInput.value); onChange(); });
      wrap.appendChild(formRow('Increment', incInput));

      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['Remove Skill Check']);
      rm.style.marginTop = '4px';
      rm.addEventListener('click', () => { delete resp.skillCheck; delete resp.dc; delete resp.increment; onChange(); render(); });
      wrap.appendChild(rm);
    }
  }

  render();
  return wrap;
}

function previewText(text, fallback) {
  return text ? `"${text.slice(0, 35)}${text.length > 35 ? '…' : ''}"` : fallback;
}
