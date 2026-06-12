import { store, setActiveFile, setFormRenderer, updateSaveButton } from './store.js';
import { openWorkspace, saveFile, resetWorkspace } from './io.js';
import { renderSidebar } from './components/sidebar.js';
import { renderForm } from './components/forms.js';
import { toast, showConfirm } from './ui.js';

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
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Error: ${e.message}`, 'error');
  }
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
