import { store, setActiveFile, setFormRenderer, updateSaveButton } from './store.js';
import { openWorkspace, saveFile, resetWorkspace } from './io.js';
import { renderSidebar } from './components/sidebar.js';
import { renderForm } from './components/forms.js';
import { ACTION_TYPES } from './contracts.js';
import { toast, showConfirm, showValidationResults } from './ui.js';
import { validateGameData, normalizeCarriedItems } from '../../src/core/validate.js';

setFormRenderer(renderForm);

async function handleSave() {
  // Warn about empty required fields but don't block save
  const emptyRequired = [...document.querySelectorAll('[data-required]')]
    .filter(input => !input.value.trim());
  emptyRequired.forEach(input => input.classList.add('form-input-error'));

  try {
    for (const key of [...store.dirtyFiles]) {
      await saveFile(key);
      store.dirtyFiles.delete(key);
      const node = document.querySelector(`.sidebar-item[data-key="${CSS.escape(key)}"]`);
      if (node) node.classList.remove('dirty');
    }
    updateSaveButton();
    if (emptyRequired.length > 0) {
      toast('Saved — but some required fields are empty', 'error');
    } else {
      toast('Saved', 'success');
    }
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  }
}

async function handleOpen() {
  try {
    await openWorkspace();
    document.getElementById('sidebar-placeholder')?.remove();
    renderSidebar(document.getElementById('sidebar'));
    const count = Object.keys(store.files).length;
    toast(`Loaded ${count} files`, 'success');
    document.getElementById('btn-reset').disabled = false;
    document.getElementById('btn-validate').disabled = false;
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Error: ${e.message}`, 'error');
  }
}

function collectType(prefix) {
  const out = {};
  for (const [key, value] of Object.entries(store.files)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

function handleValidate() {
  // NPCs are cloned because the engine's carriedItems normalization rewrites
  // them in place — validation must not touch the editor's data.
  const npcs = structuredClone(collectType('npcs:'));
  normalizeCarriedItems(npcs);
  const data = {
    items: collectType('items:'),
    npcs,
    scenes: collectType('scenes:'),
    missions: collectType('missions:'),
    tables: collectType('tables:'),
    rules: store.files['__rules'] ?? {},
    locale: store.locale,
  };
  const knownActionTypes = new Set([...ACTION_TYPES.map(([t]) => t), ...store.actionTypes]);
  const issues = validateGameData(data, knownActionTypes);

  // Studio extra: the engine hardwires dialogue to open at the "start" node.
  for (const [id, npc] of Object.entries(npcs)) {
    const convs = npc.conversations ?? {};
    if (Object.keys(convs).length > 0 && !convs.start) {
      issues.push({
        group: `NPC "${id}"`,
        message: 'has conversations but no "start" node — the engine opens dialogue at "start"',
      });
    }
  }

  showValidationResults(issues);
}

async function handleReset() {
  const confirmed = await showConfirm(
    'Are you sure you want to reset all campaign data? This will permanently delete all custom items, NPCs, scenes, missions, and tables, and reset the project to a clean boilerplate.',
    'Reset Data'
  );
  if (!confirmed) return;

  try {
    await resetWorkspace();
    renderSidebar(document.getElementById('sidebar'));
    setActiveFile(null);
    toast('Workspace reset successfully', 'success');
  } catch (e) {
    toast(`Reset failed: ${e.message}`, 'error');
  }
}

document.getElementById('btn-open').addEventListener('click', handleOpen);
document.getElementById('btn-save').addEventListener('click', handleSave);
document.getElementById('btn-validate').addEventListener('click', handleValidate);
document.getElementById('btn-reset').addEventListener('click', handleReset);

document.addEventListener('input', e => {
  if (e.target.hasAttribute('data-required')) e.target.classList.remove('form-input-error');
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (store.dirtyFiles.size > 0) handleSave();
  }
});

window.addEventListener('beforeunload', e => {
  if (store.dirtyFiles.size > 0) e.preventDefault();
});
