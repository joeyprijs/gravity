// Shared editor state and dirty-tracking. Dependency-free so every module can
// import it without creating cycles — app.js injects the form renderer at boot.

export const store = {
  files: {},        // { "items:rusty_sword": { ...json }, "__rules": { ... }, ... }
  fileHandles: {},  // { "items:rusty_sword": FileSystemFileHandle, ... }
  index: null,      // parsed data/index.json
  dirHandle: null,  // root FileSystemDirectoryHandle
  activeFile: null,
  dirtyFiles: new Set(),
  descriptionHooks: new Set(),
  actionTypes: new Set(),  // registerAction(...) names found in workspace JS (core + plugins)
  locale: {},              // default-language locale, read-only (used by Validate)
};

let renderForm = null;

/** Inject the form renderer (called once by app.js to avoid an import cycle). */
export function setFormRenderer(fn) {
  renderForm = fn;
}

export function setActiveFile(key) {
  store.activeFile = key;

  const editor = document.getElementById('editor');
  editor.innerHTML = '';

  if (key && store.files[key] !== undefined && renderForm) {
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

export function updateSaveButton() {
  const btn = document.getElementById('btn-save');
  const count = store.dirtyFiles.size;
  btn.disabled = count === 0;
  btn.textContent = count > 0 ? `Save (${count})` : 'Save';
}
