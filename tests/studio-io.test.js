import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../studio/js/store.js';
import { saveFile, resetWorkspace, createEntry, deleteEntry } from '../studio/js/io.js';

// Integration coverage for the Studio's File System Access I/O. The browser's
// FS Access API can't run headlessly, but io.js operates entirely on injected
// directory/file handles — so an in-memory mock of that API lets the *real*
// io.js code run in Node and have its on-disk results asserted exactly. This
// validates the data-loss-sensitive save/reset paths (audit H1, H2, L1).

// ── In-memory File System Access API mock ────────────────────────────────────

class MockWritable {
  constructor(handle) { this.handle = handle; this._buf = ''; }
  async write(chunk) {
    if (this.handle._failWrite) throw new Error('simulated write failure');
    this._buf += chunk;
  }
  async close() { this.handle._content = this._buf; }     // commit
  async abort() { /* discard buffer; on-disk content stays as it was */ }
}

class MockFileHandle {
  constructor(name, content = '') {
    this.kind = 'file';
    this.name = name;
    this._content = content;
    this._failWrite = false;
    this.createWritableCount = 0;
  }
  async getFile() { const c = this._content; return { text: async () => c }; }
  async createWritable() { this.createWritableCount++; return new MockWritable(this); }
}

class MockDirHandle {
  constructor(name = '') { this.kind = 'directory'; this.name = name; this.children = new Map(); }
  async getDirectoryHandle(name, opts = {}) {
    if (!this.children.has(name)) {
      if (!opts.create) throw new Error(`NotFound: directory "${name}"`);
      this.children.set(name, new MockDirHandle(name));
    }
    const h = this.children.get(name);
    if (h.kind !== 'directory') throw new Error(`"${name}" is not a directory`);
    return h;
  }
  async getFileHandle(name, opts = {}) {
    if (!this.children.has(name)) {
      if (!opts.create) throw new Error(`NotFound: file "${name}"`);
      this.children.set(name, new MockFileHandle(name));
    }
    const h = this.children.get(name);
    if (h.kind !== 'file') throw new Error(`"${name}" is not a file`);
    return h;
  }
  async removeEntry(name) {
    if (!this.children.has(name)) throw new Error(`NotFound: "${name}"`);
    this.children.delete(name);
  }
  async *values() { for (const v of this.children.values()) yield v; }
}

// Build a directory at the given slash path, creating intermediate dirs.
async function ensureDir(root, path) {
  let dir = root;
  for (const part of path.split('/')) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}
async function writeJson(root, path, obj) {
  const parts = path.split('/');
  const dir = parts.length > 1 ? await ensureDir(root, parts.slice(0, -1).join('/')) : root;
  const fh = await dir.getFileHandle(parts.at(-1), { create: true });
  fh._content = JSON.stringify(obj, null, 2) + '\n';
  return fh;
}
async function readPath(root, path) {
  const parts = path.split('/');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) node = node.children.get(parts[i]);
  return node?.children.get(parts.at(-1));
}

beforeEach(() => {
  store.files = {};
  store.fileHandles = {};
  store.index = null;
  store.dirHandle = null;
  store.dirtyFiles.clear();
});

// ── saveFile (H2: never leave a file truncated; L1 dead-key stripping) ───────

test('saveFile writes via the replacer (top-level dead keys stripped, trailing newline)', async () => {
  const fh = new MockFileHandle('guard.json', 'OLD');
  store.fileHandles['npcs:guard'] = fh;
  store.files['npcs:guard'] = { name: 'Guard', disposition: 'x', nested: { disposition: 'real' } };

  await saveFile('npcs:guard');

  const written = JSON.parse(fh._content);
  assert.equal('disposition' in written, false);          // top-level dead key stripped
  assert.equal(written.nested.disposition, 'real');       // nested same-named field survives (L1)
  assert.equal(written.name, 'Guard');
  assert.ok(fh._content.endsWith('\n'));
});

test('saveFile aborts and leaves the file intact when the write fails (H2)', async () => {
  const fh = new MockFileHandle('guard.json', 'ORIGINAL-CONTENT');
  fh._failWrite = true;
  store.fileHandles['npcs:guard'] = fh;
  store.files['npcs:guard'] = { name: 'Guard' };

  await assert.rejects(() => saveFile('npcs:guard'), /write failure/);
  assert.equal(fh._content, 'ORIGINAL-CONTENT');          // not truncated/corrupted
});

test('saveFile serializes before opening the writable, so bad data never truncates (H2)', async () => {
  const fh = new MockFileHandle('guard.json', 'ORIGINAL-CONTENT');
  store.fileHandles['npcs:guard'] = fh;
  const circular = { name: 'Guard' };
  circular.self = circular;                               // JSON.stringify throws
  store.files['npcs:guard'] = circular;

  await assert.rejects(() => saveFile('npcs:guard'));
  assert.equal(fh.createWritableCount, 0);                // file was never opened/truncated
  assert.equal(fh._content, 'ORIGINAL-CONTENT');
});

// ── resetWorkspace (H1: scaffold must include locale/plugin wiring) ──────────

function seedDemoWorkspace() {
  const root = new MockDirHandle('');
  // The real demo manifest carries locale wiring, a plugin, and regions.
  return (async () => {
    await writeJson(root, 'data/index.json', {
      worldMapSize: { width: 3000, height: 2000 },
      defaultLanguage: 'en',
      locales: { en: 'data/locales.json' },
      rules: 'data/rules.json',
      plugins: [{ id: 'curator', src: './src/plugins/curator.js' }],
      regions: { dungeon: { name: 'Dungeon' } },
      items: { old_item: 'data/items/old_item.json' },
      scenes: { old_scene: 'data/scenes/old_scene.json' },
      npcs: {}, tables: {}, missions: {}, flags: {},
    });
    await writeJson(root, 'data/rules.json', {
      startingScene: 'dungeon_start',
      xpPerLevel: 100,
      playerDefaults: { inventory: [{ item: 'x', amount: 1 }], equipment: { 'Right Hand': 'sword' } },
    });
    await writeJson(root, 'data/locales.json', { system: { loaded: 'Loaded.' } });
    await writeJson(root, 'data/items/old_item.json', { name: 'Old Item', type: 'Flavour' });
    await writeJson(root, 'data/scenes/old_scene.json', { title: 'Old Scene', region: 'dungeon' });
    return root;
  })();
}

test('resetWorkspace writes a complete manifest with locale + plugin wiring (H1)', async () => {
  const root = await seedDemoWorkspace();
  store.dirHandle = root;

  await resetWorkspace();

  const indexFh = await readPath(root, 'data/index.json');
  const index = JSON.parse(indexFh._content);

  // The original gap: these three were dropped, breaking i18n and unregistering plugins.
  assert.equal(index.defaultLanguage, 'en');
  assert.deepEqual(index.locales, { en: 'data/locales.json' });
  assert.ok(Array.isArray(index.plugins));

  // Fresh scaffold is otherwise intact.
  assert.ok(index.regions?.world);
  assert.ok(index.items?.unarmed_strike);
  assert.ok(index.scenes?.start);

  // locales.json is referenced and must still exist (reset must not delete it).
  assert.ok(await readPath(root, 'data/locales.json'), 'locales.json should be preserved');
});

test('resetWorkspace reloads the fresh workspace without error', async () => {
  const root = await seedDemoWorkspace();
  store.dirHandle = root;

  await resetWorkspace();

  // loadWorkspace ran at the end of reset and repopulated the store.
  assert.ok(store.index);
  assert.equal(store.index.scenes.start, 'data/scenes/start.json');
  assert.ok(store.files['scenes:start']);
  assert.equal(store.files['scenes:start'].title, 'A New Beginning');
  // The stale demo entries are gone.
  assert.equal(store.files['scenes:old_scene'], undefined);
});

// ── createEntry / deleteEntry (index + file stay consistent) ─────────────────

test('createEntry writes the file and registers it in the index', async () => {
  const root = new MockDirHandle('');
  await writeJson(root, 'data/index.json', { items: {} });
  store.dirHandle = root;
  store.index = { items: {} };
  store.fileHandles['__index'] = await readPath(root, 'data/index.json');
  store.files['__index'] = store.index;

  const key = await createEntry('items', 'new_sword');

  assert.equal(key, 'items:new_sword');
  assert.equal(store.index.items.new_sword, 'data/items/new_sword.json');
  assert.ok(await readPath(root, 'data/items/new_sword.json'));
  // The index file on disk reflects the new entry.
  assert.equal(JSON.parse((await readPath(root, 'data/index.json'))._content).items.new_sword,
    'data/items/new_sword.json');
});

test('deleteEntry removes the file and the index entry', async () => {
  const root = new MockDirHandle('');
  await writeJson(root, 'data/index.json', { items: { gone: 'data/items/gone.json' } });
  await writeJson(root, 'data/items/gone.json', { name: 'Gone' });
  store.dirHandle = root;
  store.index = { items: { gone: 'data/items/gone.json' } };
  store.fileHandles['__index'] = await readPath(root, 'data/index.json');
  store.files['__index'] = store.index;

  await deleteEntry('items:gone');

  assert.equal(store.index.items.gone, undefined);
  assert.equal(await readPath(root, 'data/items/gone.json'), undefined);
});
