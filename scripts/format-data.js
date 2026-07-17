#!/usr/bin/env node
// Rewrites every JSON file under data/ in canonical expanded form: 2-space
// indent, one property per line, no inline objects or arrays — authored
// files read as blocks, not code-dense one-liners.
//
//   node scripts/format-data.js          rewrite files in place
//   node scripts/format-data.js --check  exit 1 if any file is not canonical (CI)
//
// Purely a formatting pass: content is parsed and re-serialized, so key
// order and values are preserved exactly.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'data');

function* jsonFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(p);
    else if (entry.name.endsWith('.json')) yield p;
  }
}

const check = process.argv.includes('--check');
const stale = [];

for (const file of jsonFiles(dataDir)) {
  const source = readFileSync(file, 'utf8');
  const canonical = JSON.stringify(JSON.parse(source), null, 2) + '\n';
  if (source === canonical) continue;
  if (check) {
    stale.push(relative(root, file));
  } else {
    writeFileSync(file, canonical);
    console.log(`[format-data] rewrote ${relative(root, file)}`);
  }
}

if (check && stale.length) {
  console.error(`[format-data] ${stale.length} file(s) not in canonical form — run: node scripts/format-data.js`);
  stale.forEach(f => console.error(`  ${f}`));
  process.exit(1);
}
if (check) console.log('[format-data] all data files are canonical');
