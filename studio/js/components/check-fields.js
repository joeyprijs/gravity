// Shared editor for the check-behavior fields that scene skill options and
// dialogue responses have in common: luck gambles, one-shot resolution,
// attempt budgets (with onExhausted), time costs, retry wording, and the
// margin-based outcome tiers. Success/failure ACTIONS stay in the forms'
// existing "On Success"/"On Failure" pipelines (the engine treats those as the
// success/failure tiers); here the tiers add text, and critical/partial add
// margin + their own pipelines.
import { el } from '../utils.js';
import { renderActionPipeline } from './actions.js';

// retryText / resultText / tier text areas: one line → string, several → array.
function linesValue(v) {
  return Array.isArray(v) ? v.join('\n') : (v ?? '');
}

function parseLines(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return undefined;
  return lines.length === 1 ? lines[0] : lines;
}

function labeledNum(label, value, onValue) {
  const input = el('input', { type: 'number', class: 'form-input sm', value: value ?? '' });
  input.addEventListener('input', () => onValue(input.value === '' ? undefined : Number(input.value)));
  return [el('span', { class: 'list-label' }, [label]), input];
}

function labeledCheck(label, checked, onValue) {
  const input = el('input', { type: 'checkbox' });
  if (checked) input.checked = true;
  // Raw boolean — callers map it to their field's authored shape (true /
  // false / absent), since defaults differ per check type.
  input.addEventListener('change', () => onValue(input.checked));
  return [el('span', { class: 'list-label' }, [label]), input];
}

// One outcome tier: a toggle that adds/removes it, then margin (critical and
// partial only), narration text, and — for critical/partial — an action
// pipeline of its own.
function renderTier(check, tierName, onChange, { hasMargin, hasActions, hint }) {
  const wrap = el('div');

  function render() {
    wrap.innerHTML = '';
    const tier = check.outcomes?.[tierName];
    if (!tier) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, [`+ ${tierName} tier`]);
      btn.addEventListener('click', () => {
        if (!check.outcomes) check.outcomes = {};
        check.outcomes[tierName] = hasActions ? { actions: [] } : {};
        onChange(); render();
      });
      wrap.appendChild(btn);
      return;
    }

    const card = el('div', { class: 'card-item' });
    const hdr = el('div', { class: 'card-hdr' });
    hdr.appendChild(el('span', { class: 'card-hdr-label' }, [`Outcome: ${tierName}${hint ? ` — ${hint}` : ''}`]));
    const rm = el('button', { class: 'btn-hdr' }, ['✕']);
    rm.addEventListener('click', () => {
      delete check.outcomes[tierName];
      if (!Object.keys(check.outcomes).length) delete check.outcomes;
      onChange(); render();
    });
    hdr.appendChild(rm);
    card.appendChild(hdr);

    const body = el('div', { class: 'card-body' });
    if (hasMargin) {
      const row = el('div', { class: 'drop-rhs' });
      const marginLabel = tierName === 'critical' ? 'Beat DC by ≥' : 'Miss DC by ≤';
      row.append(...labeledNum(marginLabel, tier.margin, v => { tier.margin = v; onChange(); }));
      body.appendChild(row);
    }
    const ta = el('textarea', { class: 'form-textarea ta-sm', placeholder: 'Narration when this tier lands…' }, [tier.text ?? '']);
    ta.addEventListener('input', () => {
      tier.text = ta.value || undefined;
      onChange();
    });
    body.appendChild(ta);
    if (hasActions) {
      if (!Array.isArray(tier.actions)) tier.actions = [];
      body.appendChild(renderActionPipeline(tier.actions, onChange));
    }
    card.appendChild(body);
    wrap.appendChild(card);
  }

  render();
  return wrap;
}

/**
 * Renders the shared check-behavior controls, mutating `check` in place.
 * @param {object} check - The scene skill option or dialogue response.
 * @param {() => void} onChange - Dirty-marking callback.
 * @param {{ luck?: boolean, retry?: boolean }} [opts] - luck: offer the
 *   Test-Your-Luck toggle; retry: offer the retryText editor.
 */
export function renderCheckBehavior(check, onChange, { luck = true, retry = true } = {}) {
  const wrap = el('div', { class: 'card-section' });
  wrap.appendChild(el('div', { class: 'card-section-label' }, ['Check Behavior']));

  const knobs = el('div', { class: 'drop-rhs' });
  function renderKnobs() {
    knobs.innerHTML = '';
    // Mirror the engine's defaults: a luck gamble is one-shot unless
    // resolveOnce is explicitly false; a skill check repeats unless it's
    // explicitly true. The checkbox shows and writes accordingly.
    const isLuck = !!check.luckCheck;
    const resolveOnceShown = isLuck ? check.resolveOnce !== false : !!check.resolveOnce;
    knobs.append(...labeledCheck('Resolve once (fail forward)', resolveOnceShown, v => {
      if (isLuck) check.resolveOnce = v ? undefined : false;
      else check.resolveOnce = v || undefined;
      onChange();
    }));
    knobs.append(...labeledNum('Max attempts', check.maxAttempts, v => { check.maxAttempts = v; onChange(); }));
    knobs.append(...labeledNum('Time cost', check.timeCost, v => { check.timeCost = v; onChange(); }));
    if (luck) {
      knobs.append(...labeledCheck('Luck gamble (2d6)', check.luckCheck, v => {
        check.luckCheck = v || undefined;
        if (v) {
          delete check.skillCheck;
          delete check.dc;
          // Item drops never trigger on a gamble (the engine routes luckCheck
          // first) — clear them in place so the saved data can't contradict.
          if (check.items?.length) check.items.length = 0;
        }
        // resolveOnce's meaning flips with the check type; drop a value that
        // now just restates the default (true for gambles, false for checks).
        if (check.resolveOnce === v) delete check.resolveOnce;
        onChange();
        renderKnobs();
      }));
    }
  }
  renderKnobs();
  wrap.appendChild(knobs);

  if (retry) {
    const retryTa = el('textarea', {
      class: 'form-textarea ta-sm',
      placeholder: 'Retry wording after failed attempts — one line per attempt (optional)…',
    }, [linesValue(check.retryText)]);
    retryTa.addEventListener('input', () => {
      check.retryText = parseLines(retryTa.value);
      onChange();
    });
    wrap.appendChild(retryTa);
  }

  wrap.appendChild(renderTier(check, 'critical', onChange, { hasMargin: true, hasActions: true, hint: 'beat the DC big' }));
  wrap.appendChild(renderTier(check, 'partial', onChange, { hasMargin: true, hasActions: true, hint: 'fail forward' }));
  wrap.appendChild(renderTier(check, 'success', onChange, { hasMargin: false, hasActions: false, hint: 'text only; actions live in On Success' }));
  wrap.appendChild(renderTier(check, 'failure', onChange, { hasMargin: false, hasActions: false, hint: 'text only; actions live in On Failure' }));

  // onExhausted: the authored way out when maxAttempts runs dry.
  const exWrap = el('div');
  function renderExhausted() {
    exWrap.innerHTML = '';
    if (!check.onExhausted) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ On Exhausted (maxAttempts spent)']);
      btn.addEventListener('click', () => { check.onExhausted = []; onChange(); renderExhausted(); });
      exWrap.appendChild(btn);
      return;
    }
    const label = el('div', { class: 'card-section-label' }, ['On Exhausted']);
    const rm = el('button', { class: 'btn-hdr' }, ['✕']);
    rm.addEventListener('click', () => { delete check.onExhausted; onChange(); renderExhausted(); });
    const hdrRow = el('div', { class: 'drop-rhs' }, [label, rm]);
    exWrap.appendChild(hdrRow);
    exWrap.appendChild(renderActionPipeline(check.onExhausted, onChange));
  }
  renderExhausted();
  wrap.appendChild(exWrap);

  return wrap;
}
