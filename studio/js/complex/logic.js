import { store } from '../app.js';
import { el, select } from '../utils.js';

const ALL_TYPES = [
  ['flag',      'Flag'],
  ['item',      'Item'],
  ['gold',      'Gold'],
  ['level',     'Level'],
  ['mission',   'Mission'],
  ['attribute', 'Attribute'],
  ['and',       'AND — all of'],
  ['or',        'OR — any of'],
  ['not',       'NOT'],
];

/**
 * Render a visual condition tree for a non-null condition.
 *
 * @param {() => object} get
 * @param {(v: object) => void} set  — called with the full new condition
 * @param {() => void} onChange       — called to mark the file dirty
 */
export function renderConditionBuilder(get, set, onChange) {
  const wrap = el('div', { class: 'cond-root' });

  function rebuild() {
    wrap.innerHTML = '';
    wrap.appendChild(renderNode(get(), newCond => { set(newCond); onChange(); rebuild(); }, onChange));
  }

  rebuild();
  return wrap;
}

// ── Node dispatcher ────────────────────────────────────────────────────────

function renderNode(cond, onReplace, onChange) {
  const type = detectType(cond);
  const wrap = el('div', { class: `cond-node cond-node-${cssClass(type)}` });

  const typeSel = select(ALL_TYPES, type, newType => onReplace(defaultFor(newType)));
  typeSel.className = 'form-select cond-type-sel';

  if (type === 'and' || type === 'or') {
    renderCombinator(wrap, typeSel, cond, type, onReplace, onChange);
  } else if (type === 'not') {
    renderNot(wrap, typeSel, cond, onReplace, onChange);
  } else {
    renderLeaf(wrap, typeSel, type, cond, onReplace, onChange);
  }

  return wrap;
}

// ── AND / OR ───────────────────────────────────────────────────────────────

function renderCombinator(wrap, typeSel, cond, type, onReplace, onChange) {
  if (!Array.isArray(cond[type])) cond[type] = [defaultFlag()];
  const arr = cond[type];

  wrap.appendChild(el('div', { class: 'cond-header' }, [typeSel]));

  const body = el('div', { class: 'cond-body' });
  wrap.appendChild(body);

  function rebuildChildren() {
    body.innerHTML = '';
    arr.forEach((child, i) => {
      const row = el('div', { class: 'cond-child-row' });
      row.appendChild(renderNode(child,
        newChild => { arr[i] = newChild; onChange(); rebuildChildren(); },
        onChange
      ));
      const rm = el('button', { class: 'btn btn-danger btn-sm cond-rm' }, ['✕']);
      rm.addEventListener('click', () => { arr.splice(i, 1); onChange(); rebuildChildren(); });
      row.appendChild(rm);
      body.appendChild(row);
    });
    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Add']);
    add.addEventListener('click', () => { arr.push(defaultFlag()); onChange(); rebuildChildren(); });
    body.appendChild(add);
  }

  rebuildChildren();
}

// ── NOT ────────────────────────────────────────────────────────────────────

function renderNot(wrap, typeSel, cond, onReplace, onChange) {
  if (!cond.not) cond.not = defaultFlag();

  wrap.appendChild(el('div', { class: 'cond-header' }, [typeSel]));

  const body = el('div', { class: 'cond-body' });
  wrap.appendChild(body);

  function rebuildChild() {
    body.innerHTML = '';
    body.appendChild(renderNode(cond.not,
      newChild => { cond.not = newChild; onChange(); rebuildChild(); },
      onChange
    ));
  }

  rebuildChild();
}

// ── Leaf nodes ─────────────────────────────────────────────────────────────

function renderLeaf(wrap, typeSel, type, cond, onReplace, onChange) {
  const row = el('div', { class: 'cond-leaf-row' });
  row.appendChild(typeSel);

  const sceneIds  = Object.keys(store.index?.scenes   ?? {});
  const itemIds   = Object.keys(store.index?.items    ?? {});
  const missionIds = Object.keys(store.index?.missions ?? {});
  const flagList  = getAllFlags();
  const customAttrs = store.files['__rules']?.customAttributes ?? [];

  switch (type) {

    case 'flag': {
      const flagSel = select(
        [['', '— flag —'], ...flagList.map(f => [f, f])],
        cond.flag ?? '', v => { cond.flag = v; onChange(); }
      );
      flagSel.className = 'form-select cond-wide-sel';

      const valSel = select(
        [['true', 'true'], ['false', 'false']],
        String(cond.value ?? true), v => { cond.value = v === 'true'; onChange(); }
      );
      valSel.className = 'form-select sm';

      row.append(flagSel, op('='), valSel);
      break;
    }

    case 'item': {
      const iSel = select(
        [['', '— item —'], ...itemIds.map(id => [id, id])],
        cond.item ?? '', v => { cond.item = v; onChange(); }
      );
      iSel.className = 'form-select cond-wide-sel';

      const countInput = el('input', {
        type: 'number', class: 'form-input sm', min: '1',
        value: cond.count ?? '', placeholder: '≥1',
      });
      countInput.addEventListener('input', () => {
        cond.count = countInput.value === '' ? undefined : Number(countInput.value);
        if (cond.count === undefined) delete cond.count;
        onChange();
      });

      row.append(iSel, op('≥'), countInput);
      break;
    }

    case 'gold': {
      let { op: curOp, val: curVal } = unpack(cond.gold);
      const opSel = select(opOptions(), curOp, v => {
        curOp = v; cond.gold = pack(curOp, curVal); onChange();
      });
      opSel.className = 'form-select sm';

      const valInput = numInput(curVal, v => { curVal = v; cond.gold = pack(curOp, curVal); onChange(); });

      row.append(opSel, valInput);
      break;
    }

    case 'level': {
      const lvlInput = numInput(cond.level ?? 1, v => { cond.level = v; onChange(); });
      row.append(op('≥'), lvlInput);
      break;
    }

    case 'mission': {
      const mSel = select(
        [['', '— mission —'], ...missionIds.map(id => [id, id])],
        cond.mission ?? '', v => { cond.mission = v; onChange(); }
      );
      mSel.className = 'form-select cond-wide-sel';

      const sSel = select(
        [['active', 'active'], ['complete', 'complete'], ['not_started', 'not started']],
        cond.status ?? 'active', v => { cond.status = v; onChange(); }
      );
      sSel.className = 'form-select sm';

      row.append(mSel, sSel);
      break;
    }

    case 'attribute': {
      const attrId = customAttrs.find(a => a.id in cond)?.id ?? customAttrs[0]?.id ?? '';
      let { op: curOp, val: curVal } = unpack(cond[attrId] ?? 0);

      const attrSel = select(
        customAttrs.map(a => [a.id, a.id]),
        attrId, newAttr => {
          if (newAttr === attrId) return;
          onReplace({ [newAttr]: cond[attrId] ?? 0 });
        }
      );
      attrSel.className = 'form-select';

      const opSel = select(opOptions(), curOp, v => {
        curOp = v; cond[attrId] = pack(curOp, curVal); onChange();
      });
      opSel.className = 'form-select sm';

      const valInput = numInput(curVal, v => { curVal = v; cond[attrId] = pack(curOp, curVal); onChange(); });

      row.append(attrSel, opSel, valInput);
      break;
    }
  }

  wrap.appendChild(row);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function detectType(cond) {
  if (!cond || typeof cond !== 'object') return 'flag';
  if (Array.isArray(cond.and)) return 'and';
  if (Array.isArray(cond.or))  return 'or';
  if ('not' in cond)           return 'not';
  if ('flag' in cond)          return 'flag';
  if ('item' in cond)          return 'item';
  if ('gold' in cond)          return 'gold';
  if ('level' in cond)         return 'level';
  if ('mission' in cond)       return 'mission';
  const customIds = store.files['__rules']?.customAttributes?.map(a => a.id) ?? [];
  if (customIds.some(id => id in cond)) return 'attribute';
  return 'flag';
}

function cssClass(type) {
  if (type === 'and') return 'and';
  if (type === 'or')  return 'or';
  if (type === 'not') return 'not';
  return 'leaf';
}

function defaultFor(type) {
  const attrs = store.files['__rules']?.customAttributes ?? [];
  switch (type) {
    case 'flag':      return defaultFlag();
    case 'item':      return { item: '' };
    case 'gold':      return { gold: 0 };
    case 'level':     return { level: 1 };
    case 'mission':   return { mission: '', status: 'active' };
    case 'attribute': return { [attrs[0]?.id ?? 'perception']: 0 };
    case 'and':       return { and: [defaultFlag()] };
    case 'or':        return { or:  [defaultFlag()] };
    case 'not':       return { not: defaultFlag() };
    default:          return defaultFlag();
  }
}

function defaultFlag() { return { flag: '', value: true }; }

function getAllFlags() {
  const flags = [];
  for (const [key, data] of Object.entries(store.files)) {
    if (key.startsWith('flags:')) flags.push(...Object.keys(data));
  }
  return flags.sort();
}

function opOptions() {
  return [
    ['at_least',  '≥'],
    ['more_than', '>'],
    ['at_most',   '≤'],
    ['less_than', '<'],
    ['is',        '='],
  ];
}

/** Unpack a comparison value: number → {op:'at_least', val:N}, {op:N} → {op, val:N} */
function unpack(raw) {
  if (raw == null)              return { op: 'at_least', val: 0 };
  if (typeof raw === 'number')  return { op: 'at_least', val: raw };
  const [opKey] = Object.keys(raw);
  return { op: opKey ?? 'at_least', val: raw[opKey] ?? 0 };
}

/** Pack back: at_least → shorthand number; others → {op: val} */
function pack(opKey, val) {
  return opKey === 'at_least' ? val : { [opKey]: val };
}

function op(symbol) {
  return el('span', { class: 'cond-op' }, [symbol]);
}

function numInput(initialVal, onChange) {
  const input = el('input', {
    type: 'number', class: 'form-input sm',
    value: String(initialVal ?? ''),
  });
  input.addEventListener('input', () => onChange(Number(input.value) || 0));
  return input;
}
