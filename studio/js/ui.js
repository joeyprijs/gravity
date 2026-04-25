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

export function showConfirm(message, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    const overlay = el('div', { class: 'modal-overlay' });
    const box     = el('div', { class: 'modal-box' });
    const msgEl   = el('div', { class: 'modal-message' }, [message]);
    const actions = el('div', { class: 'modal-actions' });
    const cancel  = el('button', { class: 'btn btn-secondary' }, ['Cancel']);
    const confirm = el('button', { class: 'btn btn-danger'    }, [confirmLabel]);

    const close = val => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = e => { if (e.key === 'Escape') close(false); };
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
