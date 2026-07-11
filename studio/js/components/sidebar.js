import { store, setActiveFile, markDirty } from '../store.js';
import { el, makeCollapsible, slugify, uniqueId } from '../utils.js';
import { openMapView } from '../complex/map.js';
import { createEntry, deleteEntry } from '../io.js';
import { showModal, showConfirm, showFormModal, toast } from '../ui.js';

// UI state preserved across rebuilds (create/delete re-render the sidebar).
const expandedSections = new Set();
let searchQuery = '';

function makeItem(label, key, deletable = false) {
  const item = el('div', { class: 'sidebar-item', 'data-key': key, 'data-label': label.toLowerCase() }, [label]);
  item.addEventListener('click', () => setActiveFile(key));

  if (deletable) {
    const delBtn = el('button', { class: 'sidebar-delete-btn', title: 'Delete' }, ['×']);
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const confirmed = await showConfirm(`Delete "${label}"? This cannot be undone.`);
      if (!confirmed) return;
      try {
        await deleteEntry(key);
        if (store.activeFile === key) {
          document.getElementById('editor').innerHTML =
            '<div id="editor-placeholder">Select a file from the sidebar.</div>';
          store.activeFile = null;
        }
        renderSidebar(document.getElementById('sidebar'));
      } catch (err) {
        toast(`Delete failed: ${err.message}`, 'error');
      }
    });
    item.appendChild(delBtn);
  }

  return item;
}

function makeSection(title, children, nested = false, onAdd = null) {
  const header = el('div', { class: 'sidebar-section-header' }, [title]);

  if (onAdd) {
    const addBtn = el('button', { class: 'sidebar-add-btn' }, ['+']);
    addBtn.addEventListener('click', e => { e.stopPropagation(); onAdd(); });
    header.appendChild(addBtn);
  }

  const body = el('div', { class: 'sidebar-section-body' }, children);
  const section = el('div', { class: nested ? 'sidebar-section nested' : 'sidebar-section' }, [header, body]);

  const stateKey = nested ? `nested:${title}` : title;
  makeCollapsible(header, body, {
    startCollapsed: !expandedSections.has(stateKey),
    onToggle: collapsed => {
      if (collapsed) expandedSections.delete(stateKey);
      else expandedSections.add(stateKey);
    },
  });

  return section;
}

// ── Guided creation flows ─────────────────────────────────────────────────────
// Authors supply a name and intent; Studio slugs the id, writes a working
// entity, and wires the cross-links the engine's implicit contracts expect
// (dialogues need a `start` node; entities are only real once reachable).

// The first free snake_case id for a display name, or null (with a toast)
// when the name has no usable characters.
function idFor(type, name) {
  const base = slugify(name);
  if (!base) {
    toast('Name needs at least one letter or digit', 'error');
    return null;
  }
  return uniqueId(base, id => !!store.index[type]?.[id]);
}

// "Reachable from" select options: every scene, plus a none entry.
function sceneOptions() {
  return [['', '— not yet —'],
    ...Object.keys(store.index.scenes ?? {}).map(id => [id, store.files[`scenes:${id}`]?.title || id])];
}

// Appends an option to a source scene's pipeline (the cross-link half of
// guided creation) and marks it dirty.
function linkFromScene(sceneId, option) {
  const key = `scenes:${sceneId}`;
  const scene = store.files[key];
  if (!scene) return;
  if (!Array.isArray(scene.options)) scene.options = [];
  scene.options.push(option);
  markDirty(key);
}

async function finishCreate(type, id, data, after = null) {
  try {
    const key = await createEntry(type, id, data);
    after?.();
    renderSidebar(document.getElementById('sidebar'));
    setActiveFile(key);
  } catch (e) {
    toast(`Failed to create: ${e.message}`, 'error');
  }
}

async function addScene() {
  const input = await showFormModal('New Scene', [
    { key: 'title', label: 'Title', placeholder: 'The Old Mill', required: true },
    { key: 'region', label: 'Region', type: 'select', options: [['', '— none —'], ...Object.keys(store.index.regions ?? {}).map(r => [r, store.index.regions[r]?.name || r])] },
    { key: 'description', label: 'What does the player see?', type: 'textarea', placeholder: 'A sagging mill leans over the stream…' },
    { key: 'linkFrom', label: 'Reachable from', type: 'select', options: sceneOptions() },
  ]);
  if (!input) return;
  const id = idFor('scenes', input.title);
  if (!id) return;

  const data = {
    title: input.title,
    region: input.region,
    description: input.description ? [{ text: input.description }] : [],
    options: [],
  };
  await finishCreate('scenes', id, data, () => {
    if (input.linkFrom) {
      linkFromScene(input.linkFrom, { text: `Go to ${input.title}`, actions: [{ type: 'navigate', destination: id }] });
    }
  });
}

async function addNpc() {
  const input = await showFormModal('New NPC', [
    { key: 'name', label: 'Name', placeholder: 'Mira the Miller', required: true },
    { key: 'greeting', label: 'What do they say first?', type: 'textarea', placeholder: 'Greetings, traveler.' },
    { key: 'linkFrom', label: 'Reachable from', type: 'select', options: sceneOptions() },
  ]);
  if (!input) return;
  const id = idFor('npcs', input.name);
  if (!id) return;

  // A working dialogue out of the box: the engine requires a `start` node,
  // and every conversation needs a way out.
  const data = {
    name: input.name,
    conversations: {
      start: {
        npcText: input.greeting || 'Greetings, traveler.',
        responses: [{ text: 'Farewell.', actions: [{ type: 'leave' }] }],
      },
    },
    carriedItems: [],
    attributes: {},
  };
  await finishCreate('npcs', id, data, () => {
    if (input.linkFrom) {
      linkFromScene(input.linkFrom, { text: `Talk to ${input.name}`, actions: [{ type: 'dialogue', npc: id }] });
    }
  });
}

// Working mechanics per item kind, so a new item plays without further
// setup. attackAttribute is left to the author (it must name one of the
// game's declared attributes; validation guides that choice).
const ITEM_TEMPLATES = {
  Weapon:     () => ({ type: 'Weapon', slot: 'Right Hand', value: 0, attributes: { actionPoints: 1, damageRoll: '1d6' } }),
  Spell:      () => ({ type: 'Spell', slot: 'Right Hand', value: 0, attributes: { actionPoints: 2, damageRoll: '2d6' } }),
  Armor:      () => ({ type: 'Armor', slot: 'Torso', value: 0, attributes: { actionPoints: 0, armorClassBonus: 1 } }),
  Consumable: () => ({ type: 'Consumable', value: 0, attributes: { actionPoints: 1, healingAmount: '1d8+2' } }),
  Flavour:    () => ({ type: 'Flavour' }),
};

async function addItem() {
  const input = await showFormModal('New Item', [
    { key: 'name', label: 'Name', placeholder: 'Miller\'s Hammer', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: Object.keys(ITEM_TEMPLATES).map(k => [k, k]), value: 'Flavour' },
  ]);
  if (!input) return;
  const id = idFor('items', input.name);
  if (!id) return;

  const data = { name: input.name, description: '', ...ITEM_TEMPLATES[input.kind]() };
  await finishCreate('items', id, data);
}

// Missions/tables/flags keep the plain ID prompt for now (Phase 1 targets
// the big three — see docs/studio-rework.md).
async function addPlain(type) {
  const raw = await showModal(`New ${type} ID`, 'use_snake_case');
  if (!raw) return;
  const id = raw.trim().replace(/\s+/g, '_');
  if (!id) return;

  if (!/^[a-z0-9_]+$/.test(id)) {
    toast('IDs must be snake_case: lowercase letters, digits, and underscores', 'error');
    return;
  }

  if (store.index[type]?.[id]) {
    toast(`"${id}" already exists in ${type}`, 'error');
    return;
  }

  await finishCreate(type, id, null);
}

async function addEntry(type) {
  if (type === 'scenes') return addScene();
  if (type === 'npcs')   return addNpc();
  if (type === 'items')  return addItem();
  return addPlain(type);
}

export function renderSidebar(container) {
  container.innerHTML = '';
  const { index } = store;
  if (!index) return;

  // Search
  function applyFilter() {
    const q = searchQuery;
    container.querySelectorAll('.sidebar-item').forEach(item => {
      const match = !q
        || (item.dataset.key || '').toLowerCase().includes(q)
        || (item.dataset.label || '').includes(q);
      item.style.display = match ? '' : 'none';
    });
    container.querySelectorAll('.sidebar-section').forEach(section => {
      if (!q) { section.style.display = ''; return; }
      const hasVisible = [...section.querySelectorAll('.sidebar-item')]
        .some(item => item.style.display !== 'none');
      section.style.display = hasVisible ? '' : 'none';
    });
  }

  const search = el('input', { type: 'text', class: 'sidebar-search', placeholder: 'Search…' });
  search.value = searchQuery;
  search.addEventListener('input', () => {
    searchQuery = search.value.toLowerCase().trim();
    applyFilter();
  });
  container.appendChild(search);

  // Map view
  const mapItem = el('div', { class: 'sidebar-item', 'data-key': '__map' }, ['Visual Map']);
  mapItem.addEventListener('click', openMapView);
  container.appendChild(makeSection('Map', [mapItem]));

  // Rules
  container.appendChild(makeSection('Rules', [makeItem('rules.json', '__rules')]));

  // Flags
  const flagItems = Object.keys(index.flags ?? {}).map(id => makeItem(id, `flags:${id}`, true));
  container.appendChild(makeSection('Flags', flagItems, false, () => addEntry('flags')));

  // Items
  const itemItems = Object.keys(index.items ?? {}).map(id => {
    const data = store.files[`items:${id}`];
    return makeItem(data?.name || id, `items:${id}`, true);
  });
  container.appendChild(makeSection('Items', itemItems, false, () => addEntry('items')));

  // NPCs
  const npcItems = Object.keys(index.npcs ?? {}).map(id => {
    const data = store.files[`npcs:${id}`];
    return makeItem(data?.name || id, `npcs:${id}`, true);
  });
  container.appendChild(makeSection('NPCs', npcItems, false, () => addEntry('npcs')));

  // Scenes — grouped by region
  const byRegion = {};
  for (const id of Object.keys(index.scenes ?? {})) {
    const data = store.files[`scenes:${id}`];
    const region = data?.region || 'other';
    if (!byRegion[region]) byRegion[region] = [];
    byRegion[region].push(makeItem(data?.title || id, `scenes:${id}`, true));
  }
  const regionSections = Object.entries(byRegion).map(([region, items]) => {
    const name = index.regions?.[region]?.name || region;
    return makeSection(name, items, true);
  });
  container.appendChild(makeSection('Scenes', regionSections, false, () => addEntry('scenes')));

  // Missions
  const missionItems = Object.keys(index.missions ?? {}).map(id => {
    const data = store.files[`missions:${id}`];
    return makeItem(data?.name || id, `missions:${id}`, true);
  });
  container.appendChild(makeSection('Missions', missionItems, false, () => addEntry('missions')));

  // Tables
  const tableItems = Object.keys(index.tables ?? {}).map(id => makeItem(id, `tables:${id}`, true));
  container.appendChild(makeSection('Tables', tableItems, false, () => addEntry('tables')));

  if (searchQuery) applyFilter();
}
