/**
 * Create a DOM element.
 * attrs supports: class, id, style, data-*, on (event map), and any HTML attribute.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') {
      for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    } else if (k === 'class') {
      node.className = v;
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child instanceof Node) node.appendChild(child);
  }
  return node;
}

/** Create a labeled form row. */
export function formRow(label, input) {
  const lbl = el('label', {}, [label]);
  return el('div', { class: 'form-row' }, [lbl, input]);
}

/** Read a nested value by dot-path, e.g. "attributes.damageRoll". */
export function getPath(obj, path) {
  return path.split('.').reduce((cur, k) => cur?.[k], obj);
}

/** Write a nested value by dot-path. Creates intermediate objects as needed. */
export function setPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

/** Collapsible card: clicking the header toggles the body. Clicks on
 *  interactive elements inside the header don't toggle. Starts collapsed. */
export function makeCollapsible(hdr, body) {
  let collapsed = true;
  body.style.display = 'none';
  hdr.classList.add('collapsed');
  hdr.addEventListener('click', e => {
    if (e.target.closest('input, select, textarea, button')) return;
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    hdr.classList.toggle('collapsed', collapsed);
  });
}

/** Number input; onChange receives a Number, or undefined when cleared. */
export function numInput(val, onChange, sizeCls = '') {
  const input = el('input', { type: 'number', class: `form-input${sizeCls ? ' ' + sizeCls : ''}`, value: String(val) });
  input.addEventListener('input', () => onChange(input.value === '' ? undefined : Number(input.value)));
  return input;
}

/** Labeled DC + increment input pair bound to obj.dc / obj.increment.
 *  Returns nodes to spread into a row container. */
export function dcIncrementInputs(obj, onChange) {
  const bind = (field, placeholder) => {
    const input = el('input', { type: 'number', class: 'form-input sm', value: obj[field] ?? '', placeholder });
    input.addEventListener('input', () => { obj[field] = input.value === '' ? undefined : Number(input.value); onChange(); });
    return input;
  };
  return [
    el('span', { class: 'list-label' }, ['DC']), bind('dc', 'DC'),
    el('span', { class: 'list-label' }, ['+ Increment']), bind('increment', 'Increment'),
  ];
}

/** List editor for {item, amount} entries: item select × amount + ✕ rows. */
export function renderItemAmountList(list, itemIds, onChange) {
  const container = el('div', { class: 'list-editor' });

  function render() {
    container.innerHTML = '';
    list.forEach((entry, i) => {
      const row = el('div', { class: 'list-row' });
      const sel = select(itemIds.map(id => [id, id]), entry.item, v => { entry.item = v; onChange(); });
      const amtInput = el('input', { type: 'number', class: 'form-input sm', min: '1', value: entry.amount ?? 1 });
      amtInput.addEventListener('input', () => { entry.amount = Number(amtInput.value); onChange(); });
      const rm = el('button', { class: 'btn-hdr' }, ['✕']);
      rm.addEventListener('click', () => { list.splice(i, 1); onChange(); render(); });
      row.append(sel, el('span', { class: 'list-label' }, ['×']), amtInput, rm);
      container.appendChild(row);
    });
    const add = el('button', { class: 'btn btn-secondary' }, ['+ Add Item']);
    add.addEventListener('click', () => {
      list.push({ item: itemIds[0] ?? '', amount: 1 });
      onChange(); render();
    });
    container.appendChild(add);
  }

  render();
  return container;
}

/** Build a <select> from an options array of [value, label] pairs.
 *  A non-empty currentVal that matches no option is surfaced as a disabled
 *  "unknown" entry instead of silently displaying the first option. */
export function select(options, currentVal, onChange, className = 'form-select') {
  const sel = el('select', { class: className });
  const cur = currentVal ?? '';
  if (cur !== '' && !options.some(([val]) => val === cur)) {
    const warn = el('option', { value: cur, disabled: '' }, [`⚠ ${cur} (unknown)`]);
    warn.selected = true;
    sel.appendChild(warn);
  }
  for (const [val, label] of options) {
    const opt = el('option', { value: val }, [label]);
    if (val === cur) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
