import { store, setActiveFile, markDirty } from '../app.js';
import { el } from '../utils.js';
import { openMapView } from '../complex/map.js';
import { createEntry } from '../io.js';

function makeItem(label, key) {
  const item = el('div', { class: 'sidebar-item', 'data-key': key }, [label]);
  item.addEventListener('click', () => setActiveFile(key));
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
  const raw = prompt(`New ${type} ID (use snake_case):`);
  if (!raw) return;
  const id = raw.trim().replace(/\s+/g, '_');
  if (!id) return;

  if (store.index[type]?.[id]) {
    alert(`"${id}" already exists in ${type}.`);
    return;
  }

  try {
    const key = await createEntry(type, id);
    markDirty('__index');
    renderSidebar(document.getElementById('sidebar'));
    setActiveFile(key);
  } catch (e) {
    alert(`Failed to create: ${e.message}`);
  }
}

export function renderSidebar(container) {
  container.innerHTML = '';
  const { index } = store;
  if (!index) return;

  // Map view
  const mapItem = el('div', { class: 'sidebar-item', 'data-key': '__map' }, ['Visual Map']);
  mapItem.addEventListener('click', openMapView);
  container.appendChild(makeSection('Map', [mapItem]));

  // Rules
  container.appendChild(makeSection('Rules', [makeItem('rules.json', '__rules')]));

  // Flags
  const flagItems = Object.keys(index.flags ?? {}).map(id => makeItem(id, `flags:${id}`));
  container.appendChild(makeSection('Flags', flagItems, false, () => addEntry('flags')));

  // Items
  const itemItems = Object.keys(index.items ?? {}).map(id => {
    const data = store.files[`items:${id}`];
    return makeItem(data?.name || id, `items:${id}`);
  });
  container.appendChild(makeSection('Items', itemItems, false, () => addEntry('items')));

  // NPCs
  const npcItems = Object.keys(index.npcs ?? {}).map(id => {
    const data = store.files[`npcs:${id}`];
    return makeItem(data?.name || id, `npcs:${id}`);
  });
  container.appendChild(makeSection('NPCs', npcItems, false, () => addEntry('npcs')));

  // Scenes — grouped by region
  const byRegion = {};
  for (const id of Object.keys(index.scenes ?? {})) {
    const data = store.files[`scenes:${id}`];
    const region = data?.region || 'other';
    if (!byRegion[region]) byRegion[region] = [];
    byRegion[region].push(makeItem(data?.title || id, `scenes:${id}`));
  }
  const regionSections = Object.entries(byRegion).map(([region, items]) => {
    const name = index.regions?.[region]?.name || region;
    return makeSection(name, items, true);
  });
  container.appendChild(makeSection('Scenes', regionSections, false, () => addEntry('scenes')));

  // Missions
  const missionItems = Object.keys(index.missions ?? {}).map(id => {
    const data = store.files[`missions:${id}`];
    return makeItem(data?.name || id, `missions:${id}`);
  });
  container.appendChild(makeSection('Missions', missionItems, false, () => addEntry('missions')));

  // Tables
  const tableItems = Object.keys(index.tables ?? {}).map(id => makeItem(id, `tables:${id}`));
  container.appendChild(makeSection('Tables', tableItems, false, () => addEntry('tables')));
}
