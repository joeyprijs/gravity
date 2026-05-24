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
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await loadWorkspace(dirHandle);
}

export async function loadWorkspace(dirHandle) {
  store.dirHandle = dirHandle;
  store.files = {};
  store.fileHandles = {};
  store.index = null;
  store.activeFile = null;
  store.dirtyFiles.clear();

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

  // Scan for custom description hooks
  store.descriptionHooks.clear();
  try {
    await scanDirectoryForHooks(store.dirHandle);
  } catch (e) {
    console.warn('[Studio] Description hook directory scan failed:', e);
  }
}

async function scanDirectoryForHooks(dirHandle, currentPath = '') {
  const skipDirs = new Set(['studio', 'tests', 'node_modules', '.git']);
  if (skipDirs.has(currentPath)) return;

  for await (const entry of dirHandle.values()) {
    const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    if (entry.kind === 'file' && entry.name.endsWith('.js')) {
      try {
        const file = await entry.getFile();
        const code = await file.text();
        const hookRegex = /registerDescriptionHook\(\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = hookRegex.exec(code)) !== null) {
          store.descriptionHooks.add(match[1]);
        }
      } catch (e) {
        console.warn(`[Studio] Failed to scan file "${entryPath}":`, e);
      }
    } else if (entry.kind === 'directory') {
      await scanDirectoryForHooks(entry, entryPath);
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

// Fields the engine never reads — strip them from saved JSON.
const DEAD_KEYS = new Set(['disposition', 'droppedLoot']);
// Optional array fields — omit when empty so the JSON stays clean.
const STRIP_EMPTY_ARRAYS = new Set(['actions', 'onFailure', 'items']);

function saveReplacer(key, value) {
  if (DEAD_KEYS.has(key)) return undefined;
  if (STRIP_EMPTY_ARRAYS.has(key) && Array.isArray(value) && value.length === 0) return undefined;
  return value;
}

export async function saveFile(key) {
  const handle = store.fileHandles[key];
  if (!handle) throw new Error(`No file handle for "${key}"`);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(store.files[key], saveReplacer, 2) + '\n');
  await writable.close();
}

export async function resetWorkspace() {
  if (!store.dirHandle) throw new Error('No workspace open');

  const dataDir = await store.dirHandle.getDirectoryHandle('data');

  // Deleting existing directories recursive
  for (const dirName of ['flags', 'items', 'missions', 'npcs', 'scenes', 'tables']) {
    try {
      await dataDir.removeEntry(dirName, { recursive: true });
    } catch (e) {
      // Directory might not exist, ignore
    }
  }

  // Re-create the subdirectories
  const itemsDir = await dataDir.getDirectoryHandle('items', { create: true });
  const scenesDir = await dataDir.getDirectoryHandle('scenes', { create: true });
  await dataDir.getDirectoryHandle('flags', { create: true });
  await dataDir.getDirectoryHandle('missions', { create: true });
  await dataDir.getDirectoryHandle('npcs', { create: true });
  await dataDir.getDirectoryHandle('tables', { create: true });

  // 1. Write unarmed_strike.json
  const unarmedStrikeHandle = await itemsDir.getFileHandle('unarmed_strike.json', { create: true });
  const unarmedStrikeData = {
    name: "Unarmed Strike",
    type: "Weapon",
    actionPoints: 1,
    bonusHitChance: 0,
    attributes: { damageRoll: "1d4" }
  };
  const w1 = await unarmedStrikeHandle.createWritable();
  await w1.write(JSON.stringify(unarmedStrikeData, null, 2) + '\n');
  await w1.close();

  // 2. Write enemy_claw.json
  const enemyClawHandle = await itemsDir.getFileHandle('enemy_claw.json', { create: true });
  const enemyClawData = {
    name: "Claws",
    type: "Weapon",
    actionPoints: 1,
    bonusHitChance: 0,
    attributes: { damageRoll: "1d4" }
  };
  const w2 = await enemyClawHandle.createWritable();
  await w2.write(JSON.stringify(enemyClawData, null, 2) + '\n');
  await w2.close();

  // 3. Write start.json
  const startHandle = await scenesDir.getFileHandle('start.json', { create: true });
  const startData = {
    title: "A New Beginning",
    region: "world",
    description: [
      "You stand at the beginning of a brand new adventure. The world lies before you, waiting to be shaped."
    ],
    options: []
  };
  const w3 = await startHandle.createWritable();
  await w3.write(JSON.stringify(startData, null, 2) + '\n');
  await w3.close();

  // 4. Update rules.json
  let rules = {};
  try {
    const rulesHandle = await dataDir.getFileHandle('rules.json');
    rules = await readJson(rulesHandle);
  } catch {
    // If it doesn't exist, use basic default structure
  }
  rules.startingScene = "start";
  if (rules.playerDefaults) {
    rules.playerDefaults.inventory = [];
    if (rules.playerDefaults.equipment) {
      for (const k of Object.keys(rules.playerDefaults.equipment)) {
        rules.playerDefaults.equipment[k] = null;
      }
    }
  }
  const rulesHandle = await dataDir.getFileHandle('rules.json', { create: true });
  const w4 = await rulesHandle.createWritable();
  await w4.write(JSON.stringify(rules, null, 2) + '\n');
  await w4.close();

  // 5. Overwrite index.json
  const indexHandle = await dataDir.getFileHandle('index.json', { create: true });
  const indexData = {
    worldMapSize: { width: 3000, height: 2000 },
    rules: "data/rules.json",
    flags: {},
    regions: {
      world: { name: "Starting Region" }
    },
    items: {
      unarmed_strike: "data/items/unarmed_strike.json",
      enemy_claw: "data/items/enemy_claw.json"
    },
    tables: {},
    npcs: {},
    scenes: {
      start: "data/scenes/start.json"
    },
    missions: {}
  };
  const w5 = await indexHandle.createWritable();
  await w5.write(JSON.stringify(indexData, null, 2) + '\n');
  await w5.close();

  // Now reload workspace
  await loadWorkspace(store.dirHandle);
}
