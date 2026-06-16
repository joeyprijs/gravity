import { store, markDirty, setActiveFile } from '../store.js';
import { el, formRow, getPath, setPath, select, renderItemAmountList } from '../utils.js';
import { ITEM_TYPES, EQUIPMENT_SLOTS, GOLD_ITEM_ID } from '../contracts.js';
import { toast } from '../ui.js';
import { renderSceneForm } from './scene-form.js';
import { renderNpcForm }   from './npc-form.js';

// Files the author has switched to the raw JSON editor; survives navigating
// away and back, reset only by toggling or reloading Studio.
const rawJsonKeys = new Set();

function visualRendererFor(key) {
  if (key.startsWith('items:'))    return renderItemForm;
  if (key === '__rules')           return renderRulesForm;
  if (key.startsWith('flags:'))    return renderFlagsForm;
  if (key.startsWith('missions:')) return renderMissionForm;
  if (key.startsWith('tables:'))   return renderTableForm;
  if (key.startsWith('scenes:'))   return renderSceneForm;
  if (key.startsWith('npcs:'))     return renderNpcForm;
  return null;
}

export function renderForm(key, data) {
  const visual = visualRendererFor(key);
  if (!visual) return renderRawJson(key, data);

  const isRaw = rawJsonKeys.has(key);
  const wrap = isRaw ? renderRawJson(key, data) : visual(key, data);

  const toggle = el('button', { class: 'btn btn-secondary btn-sm raw-toggle' },
    [isRaw ? 'Visual Editor' : 'Edit as JSON']);
  toggle.addEventListener('click', () => {
    if (isRaw) rawJsonKeys.delete(key);
    else rawJsonKeys.add(key);
    setActiveFile(key);
  });
  wrap.appendChild(toggle);

  return wrap;
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

  const nameInput = bindInput('name');
  nameInput.setAttribute('data-required', '');
  form.appendChild(formRow('Name', nameInput));

  // Type select
  const typeOpts = ITEM_TYPES.map(t => [t, t]);
  const typeSelect = select(typeOpts, data.type, v => {
    data.type = v;
    markDirty(key);
    updateConditional();
  });
  typeSelect.className = 'form-select';
  form.appendChild(formRow('Type', typeSelect));

  // Slot select (conditional)
  const slotOpts = [['', 'None'], ...EQUIPMENT_SLOTS.map(s => [s, s])];
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
  form.appendChild(formRow('Reputation', bindInput('reputation', 'number')));

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
    const sceneIds = Object.keys(store.index?.scenes ?? {});

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

      const teleOpts = [['', 'None'], ...sceneIds.map(id => [id, id])];
      const teleSel = select(teleOpts, data.attributes.teleportScene ?? '', v => {
        data.attributes.teleportScene = v || undefined;
        markDirty(key);
      });
      teleSel.className = 'form-select';
      attrsBody.appendChild(formRow('Teleport to Scene', teleSel));
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
  addNumber('playerDefaults.resources.hp.max',    'Starting Max HP');
  addNumber('playerDefaults.resources.ap.max',    'Starting Max AP');
  addNumber('playerDefaults.resources.gold',      'Starting Gold');
  addNumber('playerDefaults.attributes.ac',       'Starting Armor Class');
  addNumber('playerDefaults.attributes.initiative', 'Starting Initiative');

  // Starting equipment
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Starting Equipment']));
  if (!data.playerDefaults) data.playerDefaults = {};
  if (!data.playerDefaults.equipment) data.playerDefaults.equipment = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const sel = select(
      [['', 'None'], ...itemIds.map(id => [id, id])],
      data.playerDefaults.equipment[slot] ?? '',
      v => {
        if (v) data.playerDefaults.equipment[slot] = v;
        else delete data.playerDefaults.equipment[slot];
        markDirty(key);
      }
    );
    sel.className = 'form-select';
    form.appendChild(formRow(slot, sel));
  }

  // Starting inventory (the engine requires the array to exist, so
  // materializing it here is safe)
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Starting Inventory']));
  if (!data.playerDefaults.inventory) data.playerDefaults.inventory = [];
  form.appendChild(renderItemAmountList(data.playerDefaults.inventory, itemIds, () => markDirty(key)));

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

      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
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

  // ── Point-Buy Character Creation ─────────────────────────────────────────
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Point-Buy Character Creation']));
  if (!data.charCreation) data.charCreation = {};
  const pbInput = el('input', { type: 'number', class: 'form-input sm', value: data.charCreation.pointBudget ?? '' });
  pbInput.addEventListener('input', () => {
    data.charCreation.pointBudget = pbInput.value === '' ? undefined : Number(pbInput.value);
    markDirty(key);
  });
  form.appendChild(formRow('Starting Point Budget', pbInput));

  const ccStatsContainer = el('div', { class: 'list-editor' });
  form.appendChild(ccStatsContainer);

  function renderCcStats() {
    ccStatsContainer.innerHTML = '';
    if (!data.charCreation) data.charCreation = {};
    const stats = data.charCreation.stats ?? [];

    stats.forEach((stat, i) => {
      const row = el('div', { class: 'list-row wrap' });

      const idInput = el('input', { type: 'text', class: 'form-input grow', value: stat.id ?? '', placeholder: 'path, e.g. attributes.perception' });
      idInput.addEventListener('input', () => { stat.id = idInput.value; markDirty(key); });

      const localeInput = el('input', { type: 'text', class: 'form-input sm w-100', value: stat.localeKey ?? '', placeholder: 'localeKey' });
      localeInput.addEventListener('input', () => { stat.localeKey = localeInput.value; markDirty(key); });

      const bonusInput = el('input', { type: 'number', class: 'form-input sm w-60', value: stat.bonusPerPoint ?? 1, placeholder: 'bonus' });
      bonusInput.addEventListener('input', () => { stat.bonusPerPoint = Number(bonusInput.value) || 1; markDirty(key); });

      const minInput = el('input', { type: 'number', class: 'form-input sm w-50', value: stat.min ?? 0, placeholder: 'min' });
      minInput.addEventListener('input', () => { stat.min = Number(minInput.value) || 0; markDirty(key); });

      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        stats.splice(i, 1);
        if (!stats.length) delete data.charCreation.stats;
        markDirty(key);
        renderCcStats();
      });

      row.append(
        idInput,
        el('span', { class: 'list-label' }, ['key:']), localeInput,
        el('span', { class: 'list-label' }, ['bonus:']), bonusInput,
        el('span', { class: 'list-label' }, ['min:']), minInput,
        rmBtn
      );
      ccStatsContainer.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Point-Buy Stat']);
    addBtn.addEventListener('click', () => {
      if (!data.charCreation) data.charCreation = {};
      if (!data.charCreation.stats) data.charCreation.stats = [];
      data.charCreation.stats.push({ id: '', localeKey: '', bonusPerPoint: 1, min: 0 });
      markDirty(key);
      renderCcStats();
    });
    ccStatsContainer.appendChild(addBtn);
  }
  renderCcStats();

  // ── Sidebar Tabs Manager ──────────────────────────────────────────────────
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Sidebar Navigation Tabs']));
  const tabsContainer = el('div', { class: 'list-editor' });
  form.appendChild(tabsContainer);

  function renderTabs() {
    tabsContainer.innerHTML = '';
    const tabs = data.tabs ?? [];

    tabs.forEach((tab, i) => {
      const row = el('div', { class: 'list-row wrap' });

      const idInput = el('input', { type: 'text', class: 'form-input w-120', value: tab.id ?? '', placeholder: 'tab-id' });
      idInput.addEventListener('input', () => { tab.id = idInput.value; markDirty(key); });

      const localeInput = el('input', { type: 'text', class: 'form-input w-120', value: tab.localeKey ?? '', placeholder: 'localeKey' });
      localeInput.addEventListener('input', () => { tab.localeKey = localeInput.value; markDirty(key); });

      const widgetSel = select([
        ['', 'No widget (Standard)'],
        ['attributes', 'Attributes (customAttributes)'],
        ['map', 'Map (minimap canvas)']
      ], tab.widget ?? '', v => {
        tab.widget = v || undefined;
        markDirty(key);
      });
      widgetSel.className = 'form-select w-180';

      const defaultCheck = el('input', { type: 'checkbox', class: 'checkbox-inline' });
      if (tab.default) defaultCheck.checked = true;
      defaultCheck.addEventListener('change', () => {
        tabs.forEach((t, idx) => {
          if (idx === i) t.default = defaultCheck.checked || undefined;
          else delete t.default;
        });
        markDirty(key);
        renderTabs();
      });

      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        tabs.splice(i, 1);
        if (!tabs.length) delete data.tabs;
        markDirty(key);
        renderTabs();
      });

      row.append(
        idInput,
        localeInput,
        widgetSel,
        el('span', { class: 'list-label' }, ['Default:']),
        defaultCheck,
        rmBtn
      );
      tabsContainer.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Tab']);
    addBtn.addEventListener('click', () => {
      if (!data.tabs) data.tabs = [];
      data.tabs.push({ id: '', localeKey: '', default: data.tabs.length === 0 ? true : undefined });
      markDirty(key);
      renderTabs();
    });
    tabsContainer.appendChild(addBtn);
  }
  renderTabs();

  // ── Inventory Type Sorting priorities ───────────────────────────────────────
  form.appendChild(el('h3', { class: 'form-section-title' }, ['Inventory Type Sorting Priorities']));
  const orderContainer = el('div', { class: 'list-editor' });
  form.appendChild(orderContainer);

  function renderTypeOrder() {
    orderContainer.innerHTML = '';
    if (!data.itemTypeOrder) data.itemTypeOrder = {};
    ITEM_TYPES.forEach(t => {
      const row = el('div', { class: 'list-row' });
      const input = el('input', { type: 'number', class: 'form-input sm', value: data.itemTypeOrder[t] ?? 99 });
      input.addEventListener('input', () => {
        data.itemTypeOrder[t] = input.value === '' ? 99 : Number(input.value);
        markDirty(key);
      });
      row.append(el('span', { class: 'list-label w-120' }, [t]), input);
      orderContainer.appendChild(row);
    });
  }
  renderTypeOrder();

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
        if (newName in data) {
          toast(`Flag "${newName}" already exists`, 'error');
          nameInput.value = currentName;
          return;
        }
        const val = data[currentName];
        delete data[currentName];
        data[newName] = val;
        currentName = newName;
        markDirty(key);
        renderFlags();
      });

      const valSel = select([['false', 'false'], ['true', 'true']], String(data[flagName]), v => {
        data[currentName] = v === 'true';
        markDirty(key);
      });
      valSel.className = 'form-select sm';

      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
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
      // Clearing both reward fields would otherwise leave missionRewards: {}
      if (data.missionRewards && Object.values(data.missionRewards).every(x => x === undefined)) {
        delete data.missionRewards;
      }
      markDirty(key);
      if (path === 'name') title.textContent = input.value || missionId;
    });
    form.appendChild(formRow(label, input));
    return input;
  }

  addInput('name', 'Name').setAttribute('data-required', '');

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

      const itemSel = select([GOLD_ITEM_ID, ...itemIds].map(id => [id, id]), entry.item, v => {
        entry.item = v;
        markDirty(key);
      });
      itemSel.className = 'form-select';

      const amtInput = el('input', {
        type: 'number', class: 'form-input sm', min: '1',
        value: entry.amount ?? '', placeholder: 'amt',
      });
      amtInput.addEventListener('input', () => {
        // Empty falls back to the engine default; explicit values clamp to ≥1
        // so authored entries can't silently evaporate as zero-amount drops.
        if (amtInput.value === '') delete entry.amount;
        else entry.amount = Math.max(1, Number(amtInput.value) || 1);
        markDirty(key);
      });

      const weightInput = el('input', {
        type: 'number', class: 'form-input sm', min: '0',
        value: entry.dropWeight ?? '', placeholder: 'drop wt',
        title: 'Drop weight: relative likelihood of this entry (higher = more common). Defaults to 1.',
      });
      weightInput.addEventListener('input', () => {
        // Negative weights would corrupt the weighted-roll loop.
        if (weightInput.value === '') delete entry.dropWeight;
        else entry.dropWeight = Math.max(0, Number(weightInput.value) || 0);
        markDirty(key);
      });

      const rmBtn = el('button', { class: 'btn-hdr' }, ['✕']);
      rmBtn.addEventListener('click', () => {
        entries.splice(i, 1);
        markDirty(key);
        renderEntries();
      });

      row.append(itemSel, amtInput, weightInput, rmBtn);
      listContainer.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Entry']);
    addBtn.addEventListener('click', () => {
      if (!data.entries) data.entries = [];
      data.entries.push({ item: itemIds[0] ?? GOLD_ITEM_ID });
      markDirty(key);
      renderEntries();
    });
    listContainer.appendChild(addBtn);
  }

  renderEntries();
  return wrap;
}

// ── Raw JSON fallback (keys with no dedicated form) ────────────────────────

function renderRawJson(key, data) {
  const label = key.replace(':', ': ').replace('__', '');
  const wrap = el('div', { class: 'form-wrap' });
  wrap.appendChild(el('h2', { class: 'form-title' }, [label]));
  const hint = visualRendererFor(key)
    ? 'Editing raw JSON — every valid parse is applied; invalid JSON is never saved.'
    : 'No visual editor for this file — edit the raw JSON below.';
  wrap.appendChild(el('p', { class: 'form-hint' }, [hint]));

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
