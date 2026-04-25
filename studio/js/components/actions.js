import { store } from '../app.js';
import { el, select } from '../utils.js';

const ACTION_TYPES = [
  ['navigate',          'Navigate to Scene'],
  ['set_flag',          'Set Flag'],
  ['loot',              'Loot (Item / XP)'],
  ['combat',            'Start Combat'],
  ['dialogue',          'Start Dialogue'],
  ['heal',              'Heal Player'],
  ['full_rest',         'Full Rest'],
  ['return',            'Return'],
  ['log',               'Log Message'],
  ['questTrigger',      'Quest Trigger'],
  ['manage_chest',      'Manage Chest'],
  ['goToConversation',  'Go To Conversation'],
  ['trade',             'Open Trade'],
  ['leave',             'Leave Dialogue'],
  ['makeFriendly',      'Make NPC Friendly'],
];

/** Render a reusable action pipeline editor.
 *  `actions` — mutable array of action objects.
 *  `onChange` — called whenever the array is mutated.
 */
export function renderActionPipeline(actions, onChange) {
  const container = el('div', { class: 'action-pipeline' });

  function rebuild() {
    container.innerHTML = '';

    actions.forEach((action, i) => {
      const row = el('div', { class: 'action-row' });

      const typeSel = select(ACTION_TYPES, action.type, v => {
        Object.keys(action).forEach(k => { if (k !== 'type') delete action[k]; });
        action.type = v;
        onChange();
        rebuild();
      });
      typeSel.className = 'form-select action-type-sel';

      const params = el('div', { class: 'action-params' });
      renderParams(action, params, onChange);

      const rmBtn = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rmBtn.addEventListener('click', () => { actions.splice(i, 1); onChange(); rebuild(); });

      row.append(typeSel, params, rmBtn);
      container.appendChild(row);
    });

    const addBtn = el('button', { class: 'btn btn-secondary' }, ['+ Add Action']);
    addBtn.addEventListener('click', () => { actions.push({ type: 'navigate' }); onChange(); rebuild(); });
    container.appendChild(addBtn);
  }

  rebuild();
  return container;
}

// ── Per-type parameter renderers ───────────────────────────────────────────

function renderParams(action, container, onChange) {
  container.innerHTML = '';
  const sceneIds = Object.keys(store.index?.scenes ?? {});
  const itemIds  = Object.keys(store.index?.items  ?? {});
  const npcIds   = Object.keys(store.index?.npcs   ?? {});

  switch (action.type) {

    case 'navigate':
      container.appendChild(param('Destination',
        select([['', '— scene —'], ...sceneIds.map(id => [id, id])], action.destination ?? '', v => {
          action.destination = v || undefined; onChange();
        }, 'form-select')
      ));
      break;

    case 'set_flag': {
      const flags = getAllFlags();
      container.appendChild(param('Flag',
        select([['', '— flag —'], ...flags.map(f => [f, f])], action.flag ?? '', v => {
          action.flag = v || undefined; onChange();
        }, 'form-select')
      ));
      container.appendChild(param('Value',
        select([['true', 'true'], ['false', 'false']], String(action.value ?? 'true'), v => {
          action.value = v === 'true'; onChange();
        }, 'form-select sm')
      ));
      break;
    }

    case 'loot': {
      const isXp = action.xpReward !== undefined;
      container.appendChild(param('Mode',
        select([['item', 'Item'], ['xp', 'XP']], isXp ? 'xp' : 'item', v => {
          if (v === 'xp') {
            delete action.item; delete action.amount; action.xpReward = 0;
          } else {
            delete action.xpReward; action.item = itemIds[0] ?? ''; action.amount = 1;
          }
          onChange(); renderParams(action, container, onChange);
        }, 'form-select sm')
      ));
      if (isXp) {
        const xpInput = numInput(action.xpReward ?? 0, v => { action.xpReward = v; onChange(); });
        container.appendChild(param('XP', xpInput));
      } else {
        container.appendChild(param('Item',
          select(['gold', ...itemIds].map(id => [id, id]), action.item ?? 'gold', v => {
            action.item = v; onChange();
          }, 'form-select')
        ));
        container.appendChild(param('×', numInput(action.amount ?? 1, v => { action.amount = v; onChange(); }, 'sm')));
      }
      break;
    }

    case 'combat':
      if (!Array.isArray(action.enemies)) action.enemies = [];
      container.appendChild(param('Enemies', renderEnemyList(action.enemies, npcIds, onChange)));
      break;

    case 'dialogue':
      container.appendChild(param('NPC',
        select([['', '— npc —'], ...npcIds.map(id => [id, id])], action.npc ?? '', v => {
          action.npc = v || undefined; onChange();
        }, 'form-select')
      ));
      break;

    case 'heal': {
      const input = numInput(action.amount ?? '', v => { action.amount = v || undefined; onChange(); }, 'sm');
      input.placeholder = 'default';
      container.appendChild(param('Amount', input));
      break;
    }

    case 'log': {
      const input = el('input', { type: 'text', class: 'form-input', value: action.message ?? '' });
      input.addEventListener('input', () => { action.message = input.value; onChange(); });
      container.appendChild(param('Message', input));
      break;
    }

    case 'questTrigger': {
      const missionIds = Object.keys(store.index?.missions ?? {});
      container.appendChild(param('Mission',
        select([['', '— mission —'], ...missionIds.map(id => [id, id])], action.mission ?? '', v => {
          action.mission = v || undefined; onChange();
        }, 'form-select')
      ));
      container.appendChild(param('Status',
        select([['active', 'active'], ['complete', 'complete']], action.status ?? 'active', v => {
          action.status = v; onChange();
        }, 'form-select sm')
      ));
      break;
    }

    case 'manage_chest': {
      const input = el('input', { type: 'text', class: 'form-input', value: action.chest ?? '' });
      input.addEventListener('input', () => { action.chest = input.value; onChange(); });
      container.appendChild(param('Chest ID', input));
      break;
    }

    case 'goToConversation': {
      const input = el('input', { type: 'text', class: 'form-input', value: action.node ?? '' });
      input.addEventListener('input', () => { action.node = input.value; onChange(); });
      container.appendChild(param('Node ID', input));
      break;
    }

    case 'trade': {
      const discInput = numInput(action.tradeDiscount ?? '', v => { action.tradeDiscount = v || undefined; onChange(); }, 'sm');
      discInput.placeholder = 'none';
      container.appendChild(param('Discount %', discInput));

      const persistCheck = el('input', { type: 'checkbox' });
      if (action.persistDiscount) persistCheck.checked = true;
      persistCheck.addEventListener('change', () => {
        action.persistDiscount = persistCheck.checked || undefined;
        onChange();
      });
      container.appendChild(param('Persist', persistCheck));
      break;
    }

    // full_rest, return, leave, makeFriendly — no params
    default: break;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function param(label, input) {
  return el('div', { class: 'action-param' }, [
    el('span', { class: 'action-param-label' }, [label]),
    input,
  ]);
}

function numInput(val, onChange, sizeCls = '') {
  const input = el('input', { type: 'number', class: `form-input${sizeCls ? ' ' + sizeCls : ''}`, value: String(val) });
  input.addEventListener('input', () => onChange(input.value === '' ? undefined : Number(input.value)));
  return input;
}

function renderEnemyList(enemies, npcIds, onChange) {
  const wrap = el('div', { class: 'mini-list' });
  function rebuild() {
    wrap.innerHTML = '';
    enemies.forEach((id, i) => {
      const row = el('div', { class: 'list-row' });
      const sel = select(npcIds.map(nid => [nid, nid]), id, v => { enemies[i] = v; onChange(); }, 'form-select');
      const rm = el('button', { class: 'btn btn-danger btn-sm' }, ['✕']);
      rm.addEventListener('click', () => { enemies.splice(i, 1); onChange(); rebuild(); });
      row.append(sel, rm);
      wrap.appendChild(row);
    });
    const add = el('button', { class: 'btn btn-secondary btn-sm' }, ['+ Enemy']);
    add.addEventListener('click', () => { enemies.push(npcIds[0] ?? ''); onChange(); rebuild(); });
    wrap.appendChild(add);
  }
  rebuild();
  return wrap;
}

function getAllFlags() {
  const flags = [];
  for (const [key, data] of Object.entries(store.files)) {
    if (key.startsWith('flags:')) flags.push(...Object.keys(data));
  }
  return flags.sort();
}
