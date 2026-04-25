import { store } from './app.js';

/** Navigate a FileSystemDirectoryHandle to a file by slash-separated path. */
async function getFileHandle(rootHandle, path) {
  const parts = path.split('/');
  let handle = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  return handle.getFileHandle(parts[parts.length - 1]);
}

async function readJson(fileHandle) {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

export async function openWorkspace() {
  store.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

  // Verify this looks like the gravity/ root by finding data/index.json
  let indexHandle;
  try {
    indexHandle = await getFileHandle(store.dirHandle, 'data/index.json');
  } catch {
    throw new Error('Could not find data/index.json — please open the gravity/ project root folder.');
  }

  store.fileHandles['__index'] = indexHandle;
  store.index = await readJson(indexHandle);
  store.files['__index'] = store.index;

  // Rules
  if (store.index.rules) {
    const h = await getFileHandle(store.dirHandle, store.index.rules);
    store.fileHandles['__rules'] = h;
    store.files['__rules'] = await readJson(h);
  }

  // Typed collections
  for (const type of ['items', 'npcs', 'scenes', 'missions', 'tables']) {
    const entries = store.index[type];
    if (!entries) continue;
    for (const [id, path] of Object.entries(entries)) {
      const key = `${type}:${id}`;
      const h = await getFileHandle(store.dirHandle, path);
      store.fileHandles[key] = h;
      store.files[key] = await readJson(h);
    }
  }

  // Flags
  const flagEntries = store.index.flags;
  if (flagEntries) {
    for (const [regionId, path] of Object.entries(flagEntries)) {
      const key = `flags:${regionId}`;
      const h = await getFileHandle(store.dirHandle, path);
      store.fileHandles[key] = h;
      store.files[key] = await readJson(h);
    }
  }
}

const DEFAULTS = {
  items:    () => ({ name: 'New Item', type: 'Misc' }),
  npcs:     () => ({ name: 'New NPC', conversations: {}, carriedItems: [], attributes: {} }),
  scenes:   () => ({ title: 'New Scene', region: '', description: [], options: [] }),
  missions: () => ({ name: 'New Mission', stages: [] }),
  tables:   () => ({ entries: [] }),
  flags:    () => ({}),
};

export async function createEntry(type, id) {
  const path = `data/${type}/${id}.json`;

  const dataDir = await store.dirHandle.getDirectoryHandle('data', { create: true });
  const typeDir = await dataDir.getDirectoryHandle(type, { create: true });
  const fileHandle = await typeDir.getFileHandle(`${id}.json`, { create: true });

  const data = DEFAULTS[type]?.() ?? {};
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2) + '\n');
  await writable.close();

  const key = `${type}:${id}`;
  store.fileHandles[key] = fileHandle;
  store.files[key] = data;

  if (!store.index[type]) store.index[type] = {};
  store.index[type][id] = path;

  return key;
}

export async function deleteEntry(key) {
  const [type, id] = key.split(':');
  const path = store.index[type]?.[id];
  if (!path) throw new Error(`No index entry for "${key}"`);

  const parts = path.split('/');
  let dirHandle = store.dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
  }
  await dirHandle.removeEntry(parts[parts.length - 1]);

  delete store.fileHandles[key];
  delete store.files[key];
  delete store.index[type][id];
  store.dirtyFiles.delete(key);
}

export async function saveFile(key) {
  const handle = store.fileHandles[key];
  if (!handle) throw new Error(`No file handle for "${key}"`);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(store.files[key], null, 2) + '\n');
  await writable.close();
}
