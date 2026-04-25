import { store, setActiveFile, markDirty } from '../app.js';
import { el } from '../utils.js';
import { openMapView } from '../complex/map.js';
import { createEntry, deleteEntry } from '../io.js';
import { showModal, showConfirm, toast } from '../ui.js';

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
        markDirty('__index');
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

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    header.classList.toggle('collapsed', collapsed);
  });

  return section;
}

async function addEntry(type) {
  const raw = await showModal(`New ${type} ID`, 'use_snake_case');
  if (!raw) return;
  const id = raw.trim().replace(/\s+/g, '_');
  if (!id) return;

  if (store.index[type]?.[id]) {
    toast(`"${id}" already exists in ${type}`, 'error');
    return;
  }

  try {
    const key = await createEntry(type, id);
    markDirty('__index');
    renderSidebar(document.getElementById('sidebar'));
    setActiveFile(key);
  } catch (e) {
    toast(`Failed to create: ${e.message}`, 'error');
  }
}

export function renderSidebar(container) {
  container.innerHTML = '';
  const { index } = store;
  if (!index) return;

  // Search
  const search = el('input', { type: 'text', class: 'sidebar-search', placeholder: 'Search…' });
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase().trim();
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
}
