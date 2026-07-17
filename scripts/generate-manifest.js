#!/usr/bin/env node
// Regenerates the data-file maps in data/index.json from the data/ tree, so
// adding a game file never requires hand-editing the manifest.
//
//   node scripts/generate-manifest.js          rewrite data/index.json
//   node scripts/generate-manifest.js --check  exit 1 if the manifest is stale (CI)
//
// Each entry's key is the file's top-level "id" field when present, else its
// filename stem (scenes declare ids because their keys carry region prefixes
// the filenames don't). Hand-authored manifest fields (rules, locales,
// plugins, regions, worldMapSize, flags-as-single-file, …) are preserved.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = join(root, 'data', 'index.json');

// Category name → the data/ subdirectory scanned for it.
const CATEGORIES = {
  items: 'items',
  tables: 'tables',
  npcs: 'npcs',
  scenes: 'scenes',
  missions: 'missions',
  flags: 'flags',
};

function* jsonFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a game without this category simply has no directory
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(p);
    else if (entry.name.endsWith('.json')) yield p;
  }
}

function buildCategory(dirName) {
  const map = {};
  for (const file of jsonFiles(join(root, 'data', dirName))) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const key = typeof data.id === 'string' ? data.id : basename(file, '.json');
    if (map[key]) {
      console.error(`[generate-manifest] duplicate id "${key}": ${map[key]} and ${relative(root, file)}`);
      process.exit(1);
    }
    map[key] = relative(root, file).split(sep).join('/');
  }
  return map;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const [category, dirName] of Object.entries(CATEGORIES)) {
  // A category authored as a single bundle path (string) or bundle list
  // (array) is hand-managed — only regenerate the id → path map form.
  if (typeof manifest[category] === 'string' || Array.isArray(manifest[category])) continue;
  const map = buildCategory(dirName);
  if (Object.keys(map).length || manifest[category]) manifest[category] = map;
}

const output = JSON.stringify(manifest, null, 2) + '\n';
const current = readFileSync(manifestPath, 'utf8');

if (process.argv.includes('--check')) {
  if (output !== current) {
    console.error('[generate-manifest] data/index.json is stale — run: node scripts/generate-manifest.js');
    process.exit(1);
  }
  console.log('[generate-manifest] data/index.json is up to date');
} else if (output !== current) {
  writeFileSync(manifestPath, output);
  console.log('[generate-manifest] data/index.json regenerated');
} else {
  console.log('[generate-manifest] data/index.json already up to date');
}
