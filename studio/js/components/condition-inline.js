import { el } from '../utils.js';
import { renderConditionBuilder } from '../complex/logic.js';

/**
 * Inline condition toggle. Shows "+ Condition" when empty;
 * renders the visual builder when a condition is set.
 *
 * @param {() => object|null} get
 * @param {(v) => void}       set   — pass null to remove
 * @param {() => void}        onChange
 */
export function renderInlineCondition(get, set, onChange) {
  const wrap = el('div', { class: 'inline-condition' });

  function render() {
    wrap.innerHTML = '';
    const cond = get();

    if (cond == null) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Condition']);
      btn.addEventListener('click', () => {
        set({ flag: '', value: true });
        onChange();
        render();
      });
      wrap.appendChild(btn);
    } else {
      const header = el('div', { class: 'condition-header' });
      header.appendChild(el('span', { class: 'condition-label' }, ['Condition']));
      const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['Remove']);
      rmBtn.addEventListener('click', () => { set(null); onChange(); render(); });
      header.appendChild(rmBtn);
      wrap.appendChild(header);

      wrap.appendChild(renderConditionBuilder(get, set, onChange));
    }
  }

  render();
  return wrap;
}
