import { store, markDirty } from '../app.js';
import { el, formRow, getPath, setPath, select } from '../utils.js';
import { renderSceneForm } from './scene-form.js';
import { renderNpcForm }   from './npc-form.js';

export function renderForm(key, data) {
  if (key.startsWith('items:'))    return renderItemForm(key, data);
  if (key === '__rules')           return renderRulesForm(key, data);
  if (key.startsWith('flags:'))    return renderFlagsForm(key, data);
  if (key.startsWith('missions:')) return renderMissionForm(key, data);
  if (key.startsWith('tables:'))   return renderTableForm(key, data);
  if (key.startsWith('scenes:'))   return renderSceneForm(key, data);
  if (key.startsWith('npcs:'))     return renderNpcForm(key, data);
  return renderRawJson(key, data);
}

// ── Item form ──────────────────────────────────────────────────────────────

function renderItemForm(key, data) {
  const wrap = el('div', { class: 'form-wrap' });
  const title = el('h2', { class: 'form-title' }, [data.name || 'New Item']);
  wrap.appendChild(title);

  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  function bindInput(path, type = 'text', placeholder = '') {
    const attrs = { type, class: 'form-input' };
    if (placeholder) attrs.placeholder = placeholder;
    const val = getPath(data, path);
    attrs.value = val != null ? String(val) : '';
    const input = el('input', attrs);
    input.addEventListener('input', () => {
      let v = input.value;
      if (type === 'number') v = v === '' ? undefined : Number(v);
      setPath(data, path, v);
      markDirty(key);
      if (path === 'name') title.textContent = input.value || 'New Item';
    });
    return input;
  }

  function bindTextarea(path) {
    const ta = el('textarea', { class: 'form-textarea' }, [getPath(data, path) ?? '']);
    ta.addEventListener('input', () => {
      setPath(data, path, ta.value);
      markDirty(key);
    });
    return ta;
  }

  form.appendChild(formRow('Name', bindInput('name')));

  // Type select
  const typeOpts = ['Weapon', 'Spell', 'Armor', 'Consumable', 'Flavour'].map(t => [t, t]);
  const typeSelect = select(typeOpts, data.type, v => {
    data.type = v;
    markDirty(key);
    updateConditional();
  });
  typeSelect.className = 'form-select';
  form.appendChild(formRow('Type', typeSelect));

  // Slot select (conditional)
  const slotOpts = [['', 'None'], 'Head', 'Amulet', 'Torso', 'Left Hand', 'Right Hand', 'Legs']
    .map(s => typeof s === 'string' ? [s, s] : s);
  const slotSelect = select(slotOpts, data.slot ?? '', v => {
    data.slot = v || undefined;
    markDirty(key);
  });
  slotSelect.className = 'form-select';
  const slotRow = formRow('Slot', slotSelect);
  form.appendChild(slotRow);

  form.appendChild(formRow('Description', bindTextarea('description')));
  form.appendChild(formRow('Value (gold)', bindInput('value', 'number')));
  form.appendChild(formRow('Action Points', bindInput('actionPoints', 'number')));

  // Bonus hit chance (conditional)
  const hitRow = formRow('Bonus Hit Chance', bindInput('bonusHitChance', 'number'));
  form.appendChild(hitRow);

  // Dynamic attributes section
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Attributes']));
  const attrsBody = el('div');
  form.appendChild(attrsBody);

  function updateConditional() {
    const type = data.type;
    const hasSlot = type === 'Weapon' || type === 'Spell' || type === 'Armor';
    const isOffensive = type === 'Weapon' || type === 'Spell';

    slotRow.style.display = hasSlot ? '' : 'none';
    hitRow.style.display = isOffensive ? '' : 'none';

    if (!data.attributes) data.attributes = {};

    attrsBody.innerHTML = '';

    if (isOffensive) {
      const drInput = el('input', {
        type: 'text', class: 'form-input',
        value: data.attributes.damageRoll ?? '',
        placeholder: 'e.g. 1d6 or 2d6+2',
      });
      drInput.addEventListener('input', () => {
        data.attributes.damageRoll = drInput.value || undefined;
        markDirty(key);
      });
      attrsBody.appendChild(formRow('Damage Roll', drInput));
    }

    if (type === 'Armor') {
      const acInput = el('input', {
        type: 'number', class: 'form-input',
        value: data.attributes.armorClassBonus ?? '',
      });
      acInput.addEventListener('input', () => {
        data.attributes.armorClassBonus = acInput.value === '' ? undefined : Number(acInput.value);
        markDirty(key);
      });
      attrsBody.appendChild(formRow('Armor Class Bonus', acInput));

      const sceneIds = Object.keys(store.index?.scenes ?? {});
      const teleOpts = [['', 'None'], ...sceneIds.map(id => [id, id])];
      const teleSel = select(teleOpts, data.attributes.teleportScene ?? '', v => {
        data.attributes.teleportScene = v || undefined;
        markDirty(key);
      });
      teleSel.className = 'form-select';
      attrsBody.appendChild(formRow('Teleport to Scene', teleSel));
    }

    if (type === 'Consumable') {
      const haInput = el('input', {
        type: 'text', class: 'form-input',
        value: data.attributes.healingAmount ?? '',
        placeholder: 'e.g. 1d8+2 or 10',
      });
      haInput.addEventListener('input', () => {
        const v = haInput.value;
        data.attributes.healingAmount = /^\d+$/.test(v) ? Number(v) : (v || undefined);
        markDirty(key);
      });
      attrsBody.appendChild(formRow('Healing Amount', haInput));
    }
  }

  updateConditional();
  return wrap;
}

// ── Rules form ─────────────────────────────────────────────────────────────

function renderRulesForm(key, data) {
  const wrap = el('div', { class: 'form-wrap' });
  wrap.appendChild(el('h2', { class: 'form-title' }, ['Rules']));
  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  function addNumber(path, label) {
    const input = el('input', { type: 'number', class: 'form-input', value: getPath(data, path) ?? '' });
    input.addEventListener('input', () => {
      setPath(data, path, input.value === '' ? undefined : Number(input.value));
      markDirty(key);
    });
    form.appendChild(formRow(label, input));
  }

  // Starting scene
  const sceneIds = Object.keys(store.index?.scenes ?? {});
  const sceneSel = select(sceneIds.map(id => [id, id]), data.startingScene, v => {
    data.startingScene = v;
    markDirty(key);
  });
  sceneSel.className = 'form-select';
  form.appendChild(formRow('Starting Scene', sceneSel));

  addNumber('merchantSellRatio', 'Merchant Sell Ratio');
  addNumber('unequipApCost',     'Unequip AP Cost');
  addNumber('restHealAmount',    'Rest Heal Amount');
  addNumber('snackHealAmount',   'Snack Heal Amount');
  addNumber('levelUpHpBonus',    'Level Up HP Bonus');
  addNumber('xpPerLevel',        'XP per Level');

  // Fallback weapons
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Fallback Weapons']));
  const itemIds = Object.keys(store.index?.items ?? {});
  for (const who of ['player', 'enemy']) {
    const sel = select(itemIds.map(id => [id, id]), data.fallbackWeapons?.[who], v => {
      if (!data.fallbackWeapons) data.fallbackWeapons = {};
      data.fallbackWeapons[who] = v;
      markDirty(key);
    });
    sel.className = 'form-select';
    form.appendChild(formRow(`Fallback (${who})`, sel));
  }

  // Player defaults
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Player Defaults']));
  addNumber('playerDefaults.resources.hp.max',  'Starting Max HP');
  addNumber('playerDefaults.resources.ap.max',  'Starting Max AP');
  addNumber('playerDefaults.resources.gold',    'Starting Gold');

  // Starting inventory
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Starting Inventory']));
  const invContainer = el('div', { class: 'list-editor' });
  form.appendChild(invContainer);

  function renderInventory() {
    invContainer.innerHTML = '';
    const inv = data.playerDefaults?.inventory ?? [];

    inv.forEach((entry, i) => {
      const row = el('div', { class: 'list-row' });

      const itemSel = select(itemIds.map(id => [id, id]), entry.item, v => {
        entry.item = v;
        markDirty(key);
      });
      itemSel.className = 'form-select';

      const amtInput = el('input', { type: 'number', class: 'form-input sm', min: '1', value: entry.amount ?? 1 });
      amtInput.addEventListener('input', () => {
        entry.amount = Number(amtInput.value);
        markDirty(key);
      });

      const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        inv.splice(i, 1);
        markDirty(key);
        renderInventory();
      });

      row.append(itemSel, el('span', { class: 'list-label' }, ['×']), amtInput, rmBtn);
      invContainer.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Item']);
    addBtn.addEventListener('click', () => {
      if (!data.playerDefaults) data.playerDefaults = {};
      if (!data.playerDefaults.inventory) data.playerDefaults.inventory = [];
      data.playerDefaults.inventory.push({ item: itemIds[0] ?? '', amount: 1 });
      markDirty(key);
      renderInventory();
    });
    invContainer.appendChild(addBtn);
  }
  renderInventory();

  // Custom attributes
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Custom Attributes (Skills)']));
  const attrsContainer = el('div', { class: 'list-editor' });
  form.appendChild(attrsContainer);

  function renderAttrs() {
    attrsContainer.innerHTML = '';
    const attrs = data.customAttributes ?? [];

    attrs.forEach((attr, i) => {
      const row = el('div', { class: 'list-row' });

      const idInput = el('input', { type: 'text', class: 'form-input', value: attr.id ?? '', placeholder: 'attribute id' });
      idInput.addEventListener('input', () => {
        attr.id = idInput.value;
        markDirty(key);
      });

      const defInput = el('input', { type: 'number', class: 'form-input sm', value: attr.default ?? 0 });
      defInput.addEventListener('input', () => {
        attr.default = Number(defInput.value);
        markDirty(key);
      });

      const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        attrs.splice(i, 1);
        if (!attrs.length) delete data.customAttributes;
        markDirty(key);
        renderAttrs();
      });

      row.append(idInput, el('span', { class: 'list-label' }, ['default:']), defInput, rmBtn);
      attrsContainer.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Attribute']);
    addBtn.addEventListener('click', () => {
      if (!data.customAttributes) data.customAttributes = [];
      data.customAttributes.push({ id: '', default: 0 });
      markDirty(key);
      renderAttrs();
    });
    attrsContainer.appendChild(addBtn);
  }
  renderAttrs();

  return wrap;
}

// ── Flags form ─────────────────────────────────────────────────────────────

function renderFlagsForm(key, data) {
  const regionId = key.split(':')[1];
  const wrap = el('div', { class: 'form-wrap' });
  wrap.appendChild(el('h2', { class: 'form-title' }, [`Flags: ${regionId}`]));

  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  const listContainer = el('div', { class: 'list-editor' });
  form.appendChild(listContainer);

  function renderFlags() {
    listContainer.innerHTML = '';

    for (const flagName of Object.keys(data)) {
      const row = el('div', { class: 'list-row' });
      let currentName = flagName;

      const nameInput = el('input', { type: 'text', class: 'form-input', value: flagName });
      nameInput.addEventListener('change', () => {
        const newName = nameInput.value.trim();
        if (!newName || newName === currentName) return;
        const val = data[currentName];
        delete data[currentName];
        data[newName] = val;
        currentName = newName;
        markDirty(key);
      });

      const valSel = select([['false', 'false'], ['true', 'true']], String(data[flagName]), v => {
        data[currentName] = v === 'true';
        markDirty(key);
      });
      valSel.className = 'form-select sm';

      const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        delete data[currentName];
        markDirty(key);
        renderFlags();
      });

      row.append(nameInput, valSel, rmBtn);
      listContainer.appendChild(row);
    }

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Flag']);
    addBtn.addEventListener('click', () => {
      let name = 'new_flag';
      let n = 1;
      while (Object.prototype.hasOwnProperty.call(data, name)) name = `new_flag_${n++}`;
      data[name] = false;
      markDirty(key);
      renderFlags();
    });
    listContainer.appendChild(addBtn);
  }

  renderFlags();
  return wrap;
}

// ── Mission form ───────────────────────────────────────────────────────────

function renderMissionForm(key, data) {
  const missionId = key.split(':')[1];
  const wrap = el('div', { class: 'form-wrap' });
  const title = el('h2', { class: 'form-title' }, [data.name || missionId]);
  wrap.appendChild(title);

  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  function addInput(path, label, type = 'text') {
    const input = el('input', { type, class: 'form-input', value: getPath(data, path) ?? '' });
    input.addEventListener('input', () => {
      const v = type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value;
      setPath(data, path, v);
      markDirty(key);
      if (path === 'name') title.textContent = input.value || missionId;
    });
    form.appendChild(formRow(label, input));
  }

  addInput('name', 'Name');

  const descTa = el('textarea', { class: 'form-textarea' }, [data.description ?? '']);
  descTa.addEventListener('input', () => {
    data.description = descTa.value;
    markDirty(key);
  });
  form.appendChild(formRow('Description', descTa));

  form.appendChild(el('h3', { class: 'form-section-title' }, ['Rewards']));
  addInput('missionRewards.xp',   'XP Reward',   'number');
  addInput('missionRewards.gold', 'Gold Reward', 'number');

  return wrap;
}

// ── Table form ─────────────────────────────────────────────────────────────

function renderTableForm(key, data) {
  const tableId = key.split(':')[1];
  const wrap = el('div', { class: 'form-wrap' });
  wrap.appendChild(el('h2', { class: 'form-title' }, [`Table: ${tableId}`]));

  const form = el('div', { class: 'form' });
  wrap.appendChild(form);

  const itemIds = Object.keys(store.index?.items ?? {});
  const listContainer = el('div', { class: 'list-editor' });
  form.appendChild(listContainer);

  function renderEntries() {
    listContainer.innerHTML = '';
    const entries = data.entries ?? [];

    entries.forEach((entry, i) => {
      const row = el('div', { class: 'list-row' });

      const itemSel = select(['gold', ...itemIds].map(id => [id, id]), entry.item, v => {
        entry.item = v;
        markDirty(key);
      });
      itemSel.className = 'form-select';

      const amtInput = el('input', {
        type: 'number', class: 'form-input sm',
        value: entry.amount ?? '', placeholder: 'amt',
      });
      amtInput.addEventListener('input', () => {
        entry.amount = amtInput.value === '' ? undefined : Number(amtInput.value);
        if (entry.amount === undefined) delete entry.amount;
        markDirty(key);
      });

      const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        entries.splice(i, 1);
        markDirty(key);
        renderEntries();
      });

      row.append(itemSel, amtInput, rmBtn);
      listContainer.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Entry']);
    addBtn.addEventListener('click', () => {
      if (!data.entries) data.entries = [];
      data.entries.push({ item: itemIds[0] ?? 'gold' });
      markDirty(key);
      renderEntries();
    });
    listContainer.appendChild(addBtn);
  }

  renderEntries();
  return wrap;
}

// ── Raw JSON fallback (NPCs, Scenes in Phase 1) ────────────────────────────

function renderRawJson(key, data) {
  const label = key.replace(':', ': ').replace('__', '');
  const wrap = el('div', { class: 'form-wrap' });
  wrap.appendChild(el('h2', { class: 'form-title' }, [label]));
  wrap.appendChild(el('p', { class: 'form-hint' }, ['Visual editor coming in Phase 2. Edit raw JSON below.']));

  const ta = el('textarea', { class: 'form-textarea raw-json' }, [JSON.stringify(data, null, 2)]);
  const errMsg = el('p', { class: 'form-error', style: 'display:none' });

  ta.addEventListener('input', () => {
    try {
      const parsed = JSON.parse(ta.value);
      store.files[key] = parsed;
      markDirty(key);
      errMsg.style.display = 'none';
      ta.classList.remove('form-input-error');
    } catch (e) {
      errMsg.textContent = e.message;
      errMsg.style.display = '';
      ta.classList.add('form-input-error');
    }
  });

  wrap.append(ta, errMsg);
  return wrap;
}
