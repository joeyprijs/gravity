// Live preview: runs the real engine in an iframe against the current
// in-memory workspace, so edits (saved or not) can be played instantly.
//
// The engine page is loaded with ?preview=1, which makes it wait for a data
// bundle instead of fetching from disk. It posts 'gravity:preview-ready' after
// each (re)load; we answer with a snapshot of store.files. Reloading the iframe
// re-runs the handshake, which is how a refresh picks up the latest edits.
import { store } from '../store.js';
import { gatherIssues } from '../validate-workspace.js';
import { showValidationResults } from '../ui.js';

const PREVIEW_SRC = '../index.html?preview=1';
const AUTO_REFRESH_DELAY = 700;
let iframe = null;
let autoRefresh = false;
let debounceTimer = null;

const pane = () => document.getElementById('preview-pane');

/** Build category maps ({ id: json }) from the flat store.files keyspace. */
function collect(prefix) {
  const out = {};
  for (const [key, value] of Object.entries(store.files)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

// Shape a snapshot of the workspace exactly like the engine's loaded data.
function buildBundle() {
  // Merge every region's flag file into one map, mirroring the engine's loader.
  const flags = {};
  for (const [key, value] of Object.entries(store.files)) {
    if (key.startsWith('flags:')) Object.assign(flags, value);
  }
  // Deep-link: if a scene is open in the editor, boot the preview there.
  const startScene = store.activeFile?.startsWith('scenes:')
    ? store.activeFile.slice('scenes:'.length)
    : null;
  return {
    manifest: store.index ?? {},
    rules: store.files['__rules'] ?? null,
    locale: store.locale ?? {},
    items: collect('items:'),
    // Cloned: the engine normalizes carriedItems in place, which must not
    // mutate the editor's live data.
    npcs: structuredClone(collect('npcs:')),
    scenes: collect('scenes:'),
    missions: collect('missions:'),
    tables: collect('tables:'),
    flags,
    preview: { startScene },
  };
}

function sendBundle() {
  // Same-origin target only: the bundle is the author's entire workspace and
  // must never be delivered to a foreign page the iframe may have navigated to.
  iframe?.contentWindow?.postMessage({ type: 'gravity:bundle', bundle: buildBundle() }, location.origin);
  updateValidation();
}

// Run the engine's own validation over the live workspace and surface a summary
// strip in the pane; clicking opens the full results modal.
function updateValidation() {
  const strip = document.getElementById('preview-validation');
  if (!strip) return;
  const issues = gatherIssues();
  if (issues.length === 0) {
    strip.textContent = '✓ Data valid';
    strip.className = 'preview-validation ok';
  } else {
    strip.textContent = `⚠ ${issues.length} validation issue${issues.length === 1 ? '' : 's'} — click for details`;
    strip.className = 'preview-validation warn';
  }
  strip.hidden = false;
}

export function isPreviewOpen() {
  return !pane().hidden;
}

export function openPreview() {
  pane().hidden = false;
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'preview-frame';
    iframe.src = PREVIEW_SRC;
    document.getElementById('preview-frame-wrap').appendChild(iframe);
  } else {
    refreshPreview();
  }
}

export function closePreview() {
  pane().hidden = true;
}

export function togglePreview() {
  isPreviewOpen() ? closePreview() : openPreview();
}

// Reload the iframe; on its next 'preview-ready' we send a freshly-built bundle,
// so unsaved edits in store.files are reflected too.
export function refreshPreview() {
  if (!iframe || pane().hidden) return;
  iframe.contentWindow?.location.reload();
}

// Auto-refresh (opt-in): debounce edits so a playtest isn't reset mid-typing.
function scheduleAutoRefresh() {
  if (!autoRefresh || !isPreviewOpen()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(refreshPreview, AUTO_REFRESH_DELAY);
}

// The engine announces readiness after every (re)load — answer with the bundle.
// Only our own same-origin preview iframe is answered; anything else could be
// a foreign page trying to request the workspace.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== iframe?.contentWindow) return;
  if (e.data?.type === 'gravity:preview-ready') sendBundle();
});

// Editor changes flow through form inputs; debounce a refresh when Auto is on.
document.addEventListener('input', scheduleAutoRefresh);
document.addEventListener('change', scheduleAutoRefresh);

// Pane controls are static markup, present at module load (script is deferred).
document.getElementById('btn-preview-reload')?.addEventListener('click', refreshPreview);
document.getElementById('btn-preview-close')?.addEventListener('click', closePreview);
document.getElementById('preview-auto')?.addEventListener('change', (e) => {
  autoRefresh = e.target.checked;
  if (autoRefresh) scheduleAutoRefresh();
});
document.getElementById('preview-validation')?.addEventListener('click', () => {
  showValidationResults(gatherIssues());
});
