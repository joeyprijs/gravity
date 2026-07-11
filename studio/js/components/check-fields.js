// Shared editor for the check-behavior fields that scene skill options and
// dialogue responses have in common: one-shot resolution, attempt budgets
// (with onExhausted), time costs, retry wording, and the margin-based
// outcome tiers. The `outcomes` object is the one authoring
// shape: every tier (critical/success/partial/failure) carries its own
// narration and action pipeline. The engine still reads the legacy fields
// (`actions` = success pipeline, `onFailure` = failure pipeline); Studio
// displays those as their tier but only folds them into `outcomes` when the
// author edits a tier — rendering must leave the data untouched, because
// the dialogue graph and unsaved-change tracking read the flat shape too.
import { el } from '../utils.js';
import { renderActionPipeline } from './actions.js';

function migrateLegacyPipelines(check) {
  if (check.actions?.length) {
    check.outcomes ??= {};
    check.outcomes.success ??= {};
    check.outcomes.success.actions ??= check.actions;
  }
  if (check.onFailure?.length) {
    check.outcomes ??= {};
    check.outcomes.failure ??= {};
    check.outcomes.failure.actions ??= check.onFailure;
  }
  delete check.actions;
  delete check.onFailure;
}

// Read-only view of a tier that sees through the legacy flat fields, so a
// not-yet-migrated check still displays its success/failure pipelines.
function tierView(check, tierName) {
  const tier = check.outcomes?.[tierName];
  if (tier) return tier;
  if (tierName === 'success' && check.actions?.length)   return { actions: check.actions };
  if (tierName === 'failure' && check.onFailure?.length) return { actions: check.onFailure };
  return undefined;
}

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

  // The tier object to write to; migrates the legacy flat pipelines first so
  // every edit lands in the one authored shape.
  const live = () => {
    migrateLegacyPipelines(check);
    check.outcomes ??= {};
    return check.outcomes[tierName] ??= {};
  };

  function render() {
    wrap.innerHTML = '';
    const tier = tierView(check, tierName);
    if (!tier) {
      const btn = el('button', { class: 'btn btn-secondary btn-sm' }, [`+ ${tierName} tier`]);
      btn.addEventListener('click', () => {
        const t = live();
        if (hasActions && !Array.isArray(t.actions)) t.actions = [];
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
      migrateLegacyPipelines(check);
      delete check.outcomes?.[tierName];
      if (check.outcomes && !Object.keys(check.outcomes).length) delete check.outcomes;
      onChange(); render();
    });
    hdr.appendChild(rm);
    card.appendChild(hdr);

    const body = el('div', { class: 'card-body' });
    if (hasMargin) {
      const row = el('div', { class: 'drop-rhs' });
      const marginLabel = tierName === 'critical' ? 'Beat DC by ≥' : 'Miss DC by ≤';
      row.append(...labeledNum(marginLabel, tier.margin, v => { live().margin = v; onChange(); }));
      body.appendChild(row);
    }
    const ta = el('textarea', { class: 'form-textarea ta-sm', placeholder: 'Narration when this tier lands…' }, [tier.text ?? '']);
    ta.addEventListener('input', () => {
      live().text = ta.value || undefined;
      onChange();
    });
    body.appendChild(ta);
    if (hasActions) {
      // Bind the pipeline editor to the array where it lives today. If the
      // check is still legacy-shaped, migration moves this same array object
      // into outcomes, so the binding survives the first edit. (A tier with
      // no actions array is always a real outcomes tier — the legacy view
      // only exists when the flat pipeline does.)
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
 * @param {{ retry?: boolean }} [opts] - retry: offer the retryText editor.
 */
export function renderCheckBehavior(check, onChange, { retry = true } = {}) {
  const wrap = el('div', { class: 'card-section' });
  wrap.appendChild(el('div', { class: 'card-section-label' }, ['Check Behavior']));

  const knobs = el('div', { class: 'drop-rhs' });
  knobs.append(...labeledCheck('Resolve once (fail forward)', check.resolveOnce, v => {
    check.resolveOnce = v || undefined;
    onChange();
  }));
  knobs.append(...labeledNum('Max attempts', check.maxAttempts, v => { check.maxAttempts = v; onChange(); }));
  knobs.append(...labeledNum('Time cost', check.timeCost, v => { check.timeCost = v; onChange(); }));
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

  wrap.appendChild(renderTier(check, 'success', onChange, { hasMargin: false, hasActions: true, hint: 'a pass (or choosing a plain reply)' }));
  wrap.appendChild(renderTier(check, 'failure', onChange, { hasMargin: false, hasActions: true, hint: 'a miss' }));
  wrap.appendChild(renderTier(check, 'critical', onChange, { hasMargin: true, hasActions: true, hint: 'beat the DC big' }));
  wrap.appendChild(renderTier(check, 'partial', onChange, { hasMargin: true, hasActions: true, hint: 'fail forward' }));

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
