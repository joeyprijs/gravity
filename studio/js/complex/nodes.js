import { store, markDirty, setActiveFile } from '../store.js';
import { el, slugify, uniqueId } from '../utils.js';
import { showFormModal, showConfirm, toast } from '../ui.js';

// A response's pipeline lives either flat (`actions`) or, once outcome tiers
// are authored, in `outcomes.success.actions` — connections read from both.
const successActions = resp => resp?.actions ?? resp?.outcomes?.success?.actions ?? [];

// Every action pipeline hanging off a node where a goToConversation can live.
function* nodePipelines(node) {
  yield node.actions;
  for (const resp of node.responses ?? []) {
    yield resp.actions;
    yield resp.onFailure;
    yield resp.onExhausted;
    for (const tier of Object.values(resp.outcomes ?? {})) yield tier?.actions;
  }
}

function countInbound(convs, nodeId) {
  let n = 0;
  for (const node of Object.values(convs)) {
    for (const actions of nodePipelines(node)) {
      n += (actions ?? []).filter(a => a.type === 'goToConversation' && a.node === nodeId).length;
    }
  }
  return n;
}

function removeInbound(convs, nodeId) {
  for (const node of Object.values(convs)) {
    for (const actions of nodePipelines(node)) {
      if (!actions) continue;
      for (let i = actions.length - 1; i >= 0; i--) {
        if (actions[i].type === 'goToConversation' && actions[i].node === nodeId) actions.splice(i, 1);
      }
    }
  }
}

// Node id from the NPC's line: first few words, slugged, made unique.
// Exported for testing.
export function nodeIdFromText(text, exists) {
  const base = slugify(String(text).split(/\s+/).slice(0, 4).join(' '));
  return uniqueId(base, exists);
}

const NODE_W   = 240;
const COL_GAP  = 320;
// Nodes show their full text and reply editors now — leave room for it.
const ROW_GAP  = 300;
const GRID     = 5;
const snap     = v => Math.round(v / GRID) * GRID;
// Node positions are editor state, not game data — they live in localStorage
// so saved NPC JSON stays pure (io.js strips the legacy _studioLayout key).
const LAYOUT_STORE_PREFIX = 'gravity-studio:layout:';

function loadLayout(npcKey) {
  try { return JSON.parse(localStorage.getItem(LAYOUT_STORE_PREFIX + npcKey)); }
  catch { return null; }
}

function saveLayout(npcKey, pos) {
  try { localStorage.setItem(LAYOUT_STORE_PREFIX + npcKey, JSON.stringify(pos)); }
  catch { /* storage unavailable — the layout can be re-dragged */ }
}

export function openDialogueGraph(npcKey) {
  document.querySelectorAll('.sidebar-item').forEach(n => {
    n.classList.toggle('active', n.dataset.key === npcKey);
  });
  const editor = document.getElementById('editor');
  editor.innerHTML = '';
  editor.appendChild(buildGraph(npcKey));
}

// ── Main graph builder ────────────────────────────────────────────────────

function buildGraph(npcKey) {
  const npc   = store.files[npcKey];
  const convs = npc?.conversations ?? {};

  const wrap = el('div', { class: 'dg-wrap' });

  // Header
  const hdr = el('div', { class: 'dg-header' });
  const backBtn = el('button', { class: 'btn btn-secondary btn-sm' }, ['← Back to Form']);
  backBtn.addEventListener('click', () => setActiveFile(npcKey));
  hdr.append(backBtn, el('span', { class: 'dg-title' }, [`${npc?.name ?? npcKey} — Dialogue Graph`]));
  hdr.appendChild(el('span', { class: 'map-hint' },
    ['double-click empty space to add a node · drag the dot to connect · drop it on empty space to disconnect']));
  wrap.appendChild(hdr);

  // Structural changes (nodes or replies added/removed) rebuild the whole
  // graph; positions survive through the saved layout.
  function rebuild() {
    saveLayout(npcKey, pos);
    openDialogueGraph(npcKey);
  }

  // Scroll area
  const scrollWrap = el('div', { class: 'dg-scroll' });
  wrap.appendChild(scrollWrap);

  const canvas = el('div', { class: 'dg-canvas' });
  scrollWrap.appendChild(canvas);

  // SVG overlay for connections
  const NS  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('dg-svg');
  canvas.appendChild(svg);

  // ── Create a node on the canvas ──────────────────────────────────────────
  canvas.addEventListener('dblclick', async e => {
    if (e.target !== canvas && !svg.contains(e.target)) return;
    const wRect = scrollWrap.getBoundingClientRect();
    const x = snap(e.clientX - wRect.left + scrollWrap.scrollLeft);
    const y = snap(e.clientY - wRect.top + scrollWrap.scrollTop);

    const input = await showFormModal('New dialogue node', [
      { key: 'text', label: 'What does the NPC say?', type: 'textarea', required: true },
      { key: 'id', label: 'Node ID (optional)', placeholder: 'auto' },
    ]);
    if (!input) return;

    const conversations = (store.files[npcKey].conversations ??= {});
    const id = input.id
      ? slugify(input.id)
      : nodeIdFromText(input.text, nid => !!conversations[nid]);
    if (!id) { toast('Node id needs at least one letter or digit', 'error'); return; }
    if (conversations[id]) { toast(`Node "${id}" already exists`, 'error'); return; }

    pos[id] = { x, y };
    conversations[id] = { npcText: input.text, responses: [] };
    markDirty(npcKey);
    rebuild();
  });

  // Ensure layout exists and covers all current nodes
  const pos = loadLayout(npcKey) ?? autoLayout(convs);
  for (const id of Object.keys(convs)) {
    if (!pos[id]) {
      const maxY = Object.values(pos).reduce((m, p) => Math.max(m, p.y), 0);
      pos[id] = { x: 40, y: maxY + ROW_GAP };
    }
  }

  // Coalesce redraw requests to one per animation frame — node dragging
  // fires mousemove far faster than the screen repaints.
  let redrawScheduled = false;
  function scheduleRedraw() {
    if (redrawScheduled) return;
    redrawScheduled = true;
    requestAnimationFrame(() => { redrawScheduled = false; redraw(); });
  }

  // Build node elements
  const nodeEls = {};
  for (const [nodeId, node] of Object.entries(convs)) {
    const card = makeNode(nodeId, node, pos[nodeId], npcKey, convs, pos, scrollWrap, svg, scheduleRedraw, rebuild);
    nodeEls[nodeId] = card;
    canvas.appendChild(card);
  }

  // Size canvas to content
  requestAnimationFrame(() => {
    const maxX = Math.max(...Object.values(pos).map(p => p.x + NODE_W + 80), 1200);
    const maxY = Math.max(...Object.values(pos).map(p => p.y + 320),          800);
    canvas.style.width  = maxX + 'px';
    canvas.style.height = maxY + 'px';
    svg.setAttribute('width',  maxX);
    svg.setAttribute('height', maxY);
    redraw();
  });

  // Structured as one read phase (measure every rect, cards cached per node)
  // followed by one write phase (draw all paths), so a full redraw costs a
  // single layout reflow no matter how many connections exist.
  function redraw() {
    clearSvg(svg);
    addArrowDef(svg, NS);

    const wRect = scrollWrap.getBoundingClientRect();
    const cardRects = new Map();
    const rectOf = id => {
      if (!cardRects.has(id)) cardRects.set(id, nodeEls[id].getBoundingClientRect());
      return cardRects.get(id);
    };

    // Read phase: collect every connection with its measurements, counting
    // how many arrive at each (target, side) pair so we can spread them
    // evenly along that edge.
    const conns = [];
    const inCount = {};
    for (const [nodeId, node] of Object.entries(convs)) {
      const card = nodeEls[nodeId];
      if (!card) continue;

      (node.responses ?? []).forEach((resp, ri) => {
        const target = successActions(resp).find(a => a.type === 'goToConversation')?.node;
        if (!target || !nodeEls[target]) return;

        const anchor = card.querySelector(`[data-anchor="${ri}"]`);
        if (!anchor) return;

        const a  = anchor.getBoundingClientRect();
        const sc = rectOf(nodeId);
        const tc = rectOf(target);

        const backward = tc.left < sc.right;
        const key      = `${target}_${backward ? 'r' : 'l'}`;
        inCount[key] = (inCount[key] ?? 0) + 1;

        conns.push({
          anchor, tc, backward, key,
          ax: a.right - wRect.left + scrollWrap.scrollLeft,
          ay: (a.top + a.bottom) / 2 - wRect.top + scrollWrap.scrollTop,
        });
      });
    }

    // Write phase: draw, assigning each connection its spread port position.
    const inIdx = {};
    const ARROW  = 8;
    const MARGIN = 16;

    for (const { anchor, tc, backward, key, ax, ay } of conns) {
      const total = inCount[key] ?? 1;
      const idx   = inIdx[key] ?? 0;
      inIdx[key]  = idx + 1;

      // Spread ports evenly between MARGIN from top and MARGIN from bottom.
      const portY = total === 1
        ? (tc.top + tc.bottom) / 2
        : tc.top + MARGIN + idx * (tc.height - 2 * MARGIN) / (total - 1);
      const ty = portY - wRect.top + scrollWrap.scrollTop;

      const tx = backward
        ? tc.right - wRect.left + scrollWrap.scrollLeft + ARROW
        : tc.left  - wRect.left + scrollWrap.scrollLeft - ARROW;

      drawBezier(svg, NS, ax, ay, tx, ty);
      anchor.classList.add('dg-anchor-on');
    }
  }

  return wrap;
}

// ── Node card ─────────────────────────────────────────────────────────────

function makeNode(nodeId, node, initPos, npcKey, convs, pos, scrollWrap, svg, redraw, rebuild) {
  const card = el('div', { class: 'dg-node' });
  card.style.cssText = `left:${initPos.x}px;top:${initPos.y}px`;

  // Draggable header
  const hdr = el('div', { class: 'dg-node-hdr', 'data-node-id': nodeId });
  hdr.appendChild(el('code', {}, [nodeId]));
  if (nodeId !== 'start') {
    // The engine opens dialogue at "start" — that node can't be deleted here.
    const rm = el('button', { class: 'btn-hdr', title: 'Delete node' }, ['✕']);
    rm.addEventListener('mousedown', e => e.stopPropagation());
    rm.addEventListener('click', async () => {
      const inbound = countInbound(convs, nodeId);
      const msg = inbound
        ? `Delete "${nodeId}"? ${inbound} connection${inbound === 1 ? '' : 's'} pointing here will be removed too.`
        : `Delete "${nodeId}"?`;
      if (!(await showConfirm(msg))) return;
      delete convs[nodeId];
      removeInbound(convs, nodeId);
      markDirty(npcKey);
      rebuild();
    });
    hdr.appendChild(rm);
  }
  card.appendChild(hdr);

  // NPC text, edited in place. Height follows the text, so arrows re-route.
  const ta = el('textarea', { class: 'dg-npc-text', rows: '2', placeholder: 'What does the NPC say?' }, [node.npcText ?? '']);
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', () => {
    node.npcText = ta.value;
    markDirty(npcKey);
    autosize();
    redraw();
  });
  requestAnimationFrame(autosize);
  card.appendChild(ta);

  // Response rows
  const respWrap = el('div', { class: 'dg-responses' });
  (node.responses ?? []).forEach((resp, ri) => {
    respWrap.appendChild(makeResponseRow(ri, resp, nodeId, node, convs, npcKey, scrollWrap, svg, redraw, rebuild));
  });
  card.appendChild(respWrap);

  const addBtn = el('button', { class: 'dg-add-resp' }, ['+ reply']);
  addBtn.addEventListener('click', () => {
    (node.responses ??= []).push({ text: '' });
    markDirty(npcKey);
    rebuild();
  });
  card.appendChild(addBtn);

  // Drag the node by its header
  makeDraggable(hdr, card, nodeId, pos, npcKey, scrollWrap, redraw);

  return card;
}

function makeResponseRow(ri, resp, nodeId, node, convs, npcKey, scrollWrap, svg, redraw, rebuild) {
  const row = el('div', { class: 'dg-response' });

  const text = el('input', { type: 'text', class: 'dg-resp-input', value: resp.text ?? '', placeholder: 'Player reply…' });
  text.addEventListener('input', () => { resp.text = text.value; markDirty(npcKey); });
  row.appendChild(text);

  const rm = el('button', { class: 'btn-hdr', title: 'Delete reply' }, ['✕']);
  rm.addEventListener('click', () => {
    node.responses.splice(ri, 1);
    markDirty(npcKey);
    rebuild();
  });
  row.appendChild(rm);

  const anchor = el('div', { class: 'dg-anchor', 'data-anchor': String(ri) });
  const hasConn = successActions(resp).some(a => a.type === 'goToConversation' && a.node);
  if (hasConn) anchor.classList.add('dg-anchor-on');
  row.appendChild(anchor);

  // Drag-to-connect
  anchor.addEventListener('mousedown', e => {
    e.stopPropagation();
    e.preventDefault();

    const wRect = scrollWrap.getBoundingClientRect();
    const aRect = anchor.getBoundingClientRect();
    const startX = aRect.right  - wRect.left + scrollWrap.scrollLeft;
    const startY = (aRect.top + aRect.bottom) / 2 - wRect.top + scrollWrap.scrollTop;

    const NS = 'http://www.w3.org/2000/svg';
    const pending = document.createElementNS(NS, 'path');
    pending.setAttribute('stroke', '#aaa');
    pending.setAttribute('stroke-width', '2');
    pending.setAttribute('fill', 'none');
    pending.setAttribute('stroke-dasharray', '5 4');
    pending.setAttribute('opacity', '0.6');
    svg.appendChild(pending);

    const onMove = e => {
      const mx = e.clientX - wRect.left + scrollWrap.scrollLeft;
      const my = e.clientY - wRect.top  + scrollWrap.scrollTop;
      pending.setAttribute('d', bezier(startX, startY, mx, my));
    };

    const onUp = e => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      svg.removeChild(pending);

      // Find target node
      const hit    = document.elementFromPoint(e.clientX, e.clientY);
      const tHdr   = hit?.closest('.dg-node-hdr');
      const target = tHdr?.dataset.nodeId;

      if (target && target !== nodeId) {
        const actions = resp.actions ?? resp.outcomes?.success?.actions ?? (resp.actions = []);
        const existing = actions.find(a => a.type === 'goToConversation');
        if (existing) existing.node = target;
        else actions.push({ type: 'goToConversation', node: target });
        markDirty(npcKey);
      } else if (!tHdr) {
        // Dropped on empty canvas — remove the existing connection, if any.
        const actions = successActions(resp);
        const idx = actions.findIndex(a => a.type === 'goToConversation');
        if (idx !== -1) {
          actions.splice(idx, 1);
          anchor.classList.remove('dg-anchor-on');
          markDirty(npcKey);
        }
      }
      redraw();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  return row;
}

// ── Node drag ─────────────────────────────────────────────────────────────

function makeDraggable(handle, card, nodeId, pos, npcKey, scrollWrap, redraw) {
  handle.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();

    const wRect = scrollWrap.getBoundingClientRect();
    const ox = e.clientX - wRect.left + scrollWrap.scrollLeft - pos[nodeId].x;
    const oy = e.clientY - wRect.top  + scrollWrap.scrollTop  - pos[nodeId].y;

    const onMove = e => {
      const x = snap(e.clientX - wRect.left + scrollWrap.scrollLeft - ox);
      const y = snap(e.clientY - wRect.top  + scrollWrap.scrollTop  - oy);
      card.style.left = x + 'px';
      card.style.top  = y + 'px';
      pos[nodeId].x = x;
      pos[nodeId].y = y;
      redraw();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      saveLayout(npcKey, pos);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Auto-layout (BFS columns) ─────────────────────────────────────────────

export function autoLayout(convs) {
  const ids = Object.keys(convs);
  if (!ids.length) return {};

  const pos     = {};
  const visited = new Set();
  const levels  = [];
  let current   = [ids.includes('start') ? 'start' : ids[0]];

  while (current.length) {
    const level = current.filter(id => !visited.has(id) && convs[id]);
    if (!level.length) break;
    levels.push(level);
    level.forEach(id => visited.add(id));

    const next = new Set();
    for (const id of level) {
      for (const resp of convs[id]?.responses ?? []) {
        for (const a of successActions(resp)) {
          if (a.type === 'goToConversation' && a.node && !visited.has(a.node) && convs[a.node]) {
            next.add(a.node);
          }
        }
      }
    }
    current = [...next];
  }

  levels.forEach((level, col) =>
    level.forEach((id, row) => { pos[id] = { x: 40 + col * COL_GAP, y: 40 + row * ROW_GAP }; })
  );

  ids.filter(id => !visited.has(id)).forEach((id, i) => {
    pos[id] = { x: 40 + levels.length * COL_GAP, y: 40 + i * ROW_GAP };
  });

  return pos;
}

// ── SVG helpers ───────────────────────────────────────────────────────────

function bezier(x1, y1, x2, y2) {
  const t = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + t},${y1} ${x2 - t},${y2} ${x2},${y2}`;
}

function drawBezier(svg, NS, x1, y1, x2, y2) {
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', bezier(x1, y1, x2, y2));
  path.setAttribute('stroke', '#4a9eff');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.65');
  path.setAttribute('marker-end', 'url(#dg-arrow)');
  svg.appendChild(path);
}

function addArrowDef(svg, NS) {
  const defs   = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id',           'dg-arrow');
  marker.setAttribute('markerWidth',  '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX',         '0');
  marker.setAttribute('refY',         '3');
  marker.setAttribute('orient',       'auto');
  marker.setAttribute('markerUnits',  'userSpaceOnUse');
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', '0 0, 8 3, 0 6');
  poly.setAttribute('fill',   'context-stroke');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function clearSvg(svg) {
  while (svg.lastChild) svg.removeChild(svg.lastChild);
}
