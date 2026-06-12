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
