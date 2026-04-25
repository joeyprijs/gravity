import { openWorkspace, saveFile } from './io.js';
import { renderSidebar } from './components/sidebar.js';
import { renderForm } from './components/forms.js';
import { toast } from './ui.js';

export const store = {
  files: {},        // { "items:rusty_sword": { ...json }, "__rules": { ... }, ... }
  fileHandles: {},  // { "items:rusty_sword": FileSystemFileHandle, ... }
  index: null,      // parsed data/index.json
  dirHandle: null,  // root FileSystemDirectoryHandle
  activeFile: null,
  dirtyFiles: new Set(),
};

export function setActiveFile(key) {
  store.activeFile = key;

  const editor = document.getElementById('editor');
  editor.innerHTML = '';

  if (key && store.files[key] !== undefined) {
    editor.appendChild(renderForm(key, store.files[key]));
  } else {
    editor.innerHTML = '<div id="editor-placeholder">Select a file from the sidebar.</div>';
  }

  document.querySelectorAll('.sidebar-item').forEach(node => {
    node.classList.toggle('active', node.dataset.key === key);
  });
}

export function markDirty(key) {
  store.dirtyFiles.add(key);
  updateSaveButton();
  const node = document.querySelector(`.sidebar-item[data-key="${CSS.escape(key)}"]`);
  if (node) node.classList.add('dirty');
}

function updateSaveButton() {
  const btn = document.getElementById('btn-save');
  const count = store.dirtyFiles.size;
  btn.disabled = count === 0;
  btn.textContent = count > 0 ? `Save (${count})` : 'Save';
}

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
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Error: ${e.message}`, 'error');
  }
}

document.getElementById('btn-open').addEventListener('click', handleOpen);
document.getElementById('btn-save').addEventListener('click', handleSave);

document.addEventListener('input', e => {
  if (e.target.hasAttribute('data-required')) e.target.classList.remove('form-input-error');
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (store.dirtyFiles.size > 0) handleSave();
  }
});
