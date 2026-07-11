import { store, setActiveFile, setFormRenderer, updateSaveButton } from './store.js';
import { openWorkspace, saveFile, resetWorkspace } from './io.js';
import { renderSidebar } from './components/sidebar.js';
import { renderForm } from './components/forms.js';
import { toast, showConfirm, showValidationResults } from './ui.js';
import { togglePreview, refreshPreview, openPreview } from './complex/preview.js';
import { gatherIssues } from './validate-workspace.js';

setFormRenderer(renderForm);

// The field each file type can't meaningfully ship without. Checked at the
// data level so dirty files edited earlier don't escape the warning (the
// [data-required] DOM check only ever sees the currently open form).
const REQUIRED_FIELDS = { items: 'name', npcs: 'name', scenes: 'title', missions: 'name' };

async function handleSave() {
  // Warn about empty required fields but don't block save
  document.querySelectorAll('[data-required]').forEach(input => {
    input.classList.toggle('form-input-error', !input.value.trim());
  });
  const missingRequired = [...store.dirtyFiles].filter(key => {
    const field = REQUIRED_FIELDS[key.split(':')[0]];
    return field && !String(store.files[key]?.[field] ?? '').trim();
  });

  let currentKey;
  try {
    for (const key of [...store.dirtyFiles]) {
      currentKey = key;
      // Dirty flag is cleared only after the write fully commits (saveFile
      // awaits close()); a mid-batch failure leaves the failed file and every
      // file after it still marked dirty so no change is silently lost.
      await saveFile(key);
      store.dirtyFiles.delete(key);
      const node = document.querySelector(`.sidebar-item[data-key="${CSS.escape(key)}"]`);
      if (node) node.classList.remove('dirty');
    }
    updateSaveButton();
    refreshPreview();
    if (missingRequired.length > 0) {
      toast(`Saved — but ${missingRequired.length} file${missingRequired.length === 1 ? ' has' : 's have'} empty required fields`, 'error');
    } else {
      toast('Saved', 'success');
    }
  } catch (e) {
    updateSaveButton();
    toast(`Save failed on "${currentKey}": ${e.message}. Other unsaved changes were kept.`, 'error');
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
    document.getElementById('btn-preview').disabled = false;
    // Seeing the game while editing is the default, not a mode.
    openPreview();
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Error: ${e.message}`, 'error');
  }
}

function handleValidate() {
  showValidationResults(gatherIssues());
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
document.getElementById('btn-preview').addEventListener('click', togglePreview);

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
  if (store.dirtyFiles.size > 0) {
    e.preventDefault();
    // Some browsers only show the unsaved-changes prompt when returnValue is set.
    e.returnValue = '';
  }
});
