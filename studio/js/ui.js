import { el } from './utils.js';

export function showModal(title, placeholder = '') {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'modal-overlay' });
    const box     = el('div', { class: 'modal-box' });
    const titleEl = el('div', { class: 'modal-title' }, [title]);
    const input   = el('input', { type: 'text', class: 'form-input', placeholder });
    const actions = el('div', { class: 'modal-actions' });
    const cancel  = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
    const confirm = el('button', { class: 'btn btn-primary'   }, ['Create']);

    const close = val => { overlay.remove(); resolve(val); };
    cancel.addEventListener('click', () => close(null));
    confirm.addEventListener('click', () => close(input.value.trim() || null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    });

    actions.append(cancel, confirm);
    box.append(titleEl, input, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => input.focus());
  });
}

/**
 * Multi-field modal for guided creation flows. fields:
 *   [{ key, label, type: 'text'|'textarea'|'select', placeholder?,
 *      options?: [[value, label]], required?, value? }]
 * Resolves with { key: trimmedValue, ... } or null on cancel. Required
 * fields block confirm (marked with the error class instead).
 */
export function showFormModal(title, fields, confirmLabel = 'Create') {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'modal-overlay' });
    const box     = el('div', { class: 'modal-box' });
    box.appendChild(el('div', { class: 'modal-title' }, [title]));

    const inputs = new Map();
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = el('select', { class: 'form-select' });
        for (const [value, label] of (f.options ?? [])) {
          const opt = el('option', { value }, [label]);
          if (value === f.value) opt.selected = true;
          input.appendChild(opt);
        }
      } else if (f.type === 'textarea') {
        input = el('textarea', { class: 'form-textarea', rows: 3, placeholder: f.placeholder ?? '' }, [f.value ?? '']);
      } else {
        input = el('input', { type: 'text', class: 'form-input', placeholder: f.placeholder ?? '', value: f.value ?? '' });
      }
      inputs.set(f, input);
      box.appendChild(el('div', { class: 'form-row' }, [
        el('label', { class: 'form-label' }, [f.label]),
        input,
      ]));
    }

    const actions = el('div', { class: 'modal-actions' });
    const cancel  = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
    const confirm = el('button', { class: 'btn btn-primary'   }, [confirmLabel]);

    const close = val => { overlay.remove(); resolve(val); };
    const submit = () => {
      const out = {};
      let blocked = false;
      for (const [f, input] of inputs) {
        const value = input.value.trim();
        input.classList.toggle('form-input-error', !!f.required && !value);
        if (f.required && !value) blocked = true;
        out[f.key] = value;
      }
      if (!blocked) close(out);
    };

    cancel.addEventListener('click', () => close(null));
    confirm.addEventListener('click', submit);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') close(null);
    });

    actions.append(cancel, confirm);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => inputs.values().next().value?.focus());
  });
}

export function showConfirm(message, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'modal-overlay' });
    const box     = el('div', { class: 'modal-box' });
    const msgEl   = el('div', { class: 'modal-message' }, [message]);
    const actions = el('div', { class: 'modal-actions' });
    const cancel  = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
    const confirm = el('button', { class: 'btn btn-danger'    }, [confirmLabel]);

    const close = val => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);

    actions.append(cancel, confirm);
    box.append(msgEl, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => confirm.focus());
  });
}

/** Show validateGameData findings grouped per source entity. */
export function showValidationResults(issues) {
  if (!issues.length) {
    toast('No issues found', 'success');
    return;
  }

  const overlay = el('div', { class: 'modal-overlay' });
  const box     = el('div', { class: 'modal-box validate-box' });
  box.appendChild(el('div', { class: 'modal-title' },
    [`Validation — ${issues.length} issue${issues.length === 1 ? '' : 's'}`]));

  const byGroup = new Map();
  for (const { group, message } of issues) {
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(message);
  }

  const list = el('div', { class: 'validate-list' });
  for (const [group, messages] of byGroup) {
    list.appendChild(el('div', { class: 'validate-group' }, [group]));
    for (const msg of messages) list.appendChild(el('div', { class: 'validate-msg' }, [msg]));
  }
  box.appendChild(list);

  const actions  = el('div', { class: 'modal-actions' });
  const closeBtn = el('button', { class: 'btn btn-primary' }, ['Close']);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  actions.appendChild(closeBtn);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

export function toast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  container.appendChild(t);

  requestAnimationFrame(() => t.classList.add('toast-show'));

  setTimeout(() => {
    t.classList.remove('toast-show');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
  }, 3000);
}
