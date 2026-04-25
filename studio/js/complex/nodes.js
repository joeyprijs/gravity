import { store, markDirty, setActiveFile } from '../app.js';
import { el } from '../utils.js';

const NODE_W   = 240;
const COL_GAP  = 320;
const ROW_GAP  = 200;
const LAYOUT   = '_studioLayout';

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
    ['Drag nodes to reposition · drag anchor dot to connect']));
  wrap.appendChild(hdr);

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

  // Ensure layout exists and covers all current nodes
  if (!npc[LAYOUT]) npc[LAYOUT] = autoLayout(convs);
  const pos = npc[LAYOUT];
  for (const id of Object.keys(convs)) {
    if (!pos[id]) {
      const maxY = Object.values(pos).reduce((m, p) => Math.max(m, p.y), 0);
      pos[id] = { x: 40, y: maxY + ROW_GAP };
    }
  }

  // Build node elements
  const nodeEls = {};
  for (const [nodeId, node] of Object.entries(convs)) {
    const card = makeNode(nodeId, node, pos[nodeId], npcKey, convs, pos, scrollWrap, svg, redraw);
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

  function redraw() {
    clearSvg(svg);
    addArrowDef(svg, NS);

    const wRect = scrollWrap.getBoundingClientRect();

    for (const [nodeId, node] of Object.entries(convs)) {
      const card = nodeEls[nodeId];
      if (!card) continue;

      (node.responses ?? []).forEach((resp, ri) => {
        const target = (resp.actions ?? []).find(a => a.type === 'goToConversation')?.node;
        if (!target || !nodeEls[target]) return;

        const anchor = card.querySelector(`[data-anchor="${ri}"]`);
        const tHdr   = nodeEls[target].querySelector('.dg-node-hdr');
        if (!anchor || !tHdr) return;

        const a = anchor.getBoundingClientRect();
        const t = tHdr.getBoundingClientRect();

        const ax = a.right  - wRect.left + scrollWrap.scrollLeft;
        const ay = (a.top + a.bottom) / 2 - wRect.top + scrollWrap.scrollTop;
        const tx = t.left   - wRect.left + scrollWrap.scrollLeft;
        const ty = (t.top + t.bottom) / 2 - wRect.top + scrollWrap.scrollTop;

        drawBezier(svg, NS, ax, ay, tx, ty);
        anchor.classList.add('dg-anchor-on');
      });
    }
  }

  return wrap;
}

// ── Node card ─────────────────────────────────────────────────────────────

function makeNode(nodeId, node, initPos, npcKey, convs, pos, scrollWrap, svg, redraw) {
  const card = el('div', { class: 'dg-node' });
  card.style.cssText = `left:${initPos.x}px;top:${initPos.y}px`;

  // Draggable header
  const hdr = el('div', { class: 'dg-node-hdr', 'data-node-id': nodeId });
  hdr.appendChild(el('code', {}, [nodeId]));
  card.appendChild(hdr);

  // NPC text preview
  const preview = (node.npcText ?? '').slice(0, 90) + ((node.npcText ?? '').length > 90 ? '…' : '');
  card.appendChild(el('div', { class: 'dg-npc-text' }, [preview || '(no text)']));

  // Response rows
  const respWrap = el('div', { class: 'dg-responses' });
  (node.responses ?? []).forEach((resp, ri) => {
    respWrap.appendChild(makeResponseRow(ri, resp, nodeId, convs, npcKey, scrollWrap, svg, redraw));
  });
  card.appendChild(respWrap);

  // Drag the node by its header
  makeDraggable(hdr, card, nodeId, pos, npcKey, scrollWrap, redraw);

  return card;
}

function makeResponseRow(ri, resp, nodeId, convs, npcKey, scrollWrap, svg, redraw) {
  const row = el('div', { class: 'dg-response' });

  const text = el('span', { class: 'dg-resp-text' }, [resp.text?.slice(0, 32) || '(empty)']);
  row.appendChild(text);

  const anchor = el('div', { class: 'dg-anchor', 'data-anchor': String(ri) });
  const hasConn = (resp.actions ?? []).some(a => a.type === 'goToConversation' && a.node);
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
        const actions = resp.actions ?? (resp.actions = []);
        const existing = actions.find(a => a.type === 'goToConversation');
        if (existing) existing.node = target;
        else actions.push({ type: 'goToConversation', node: target });
        markDirty(npcKey);
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
      const x = e.clientX - wRect.left + scrollWrap.scrollLeft - ox;
      const y = e.clientY - wRect.top  + scrollWrap.scrollTop  - oy;
      card.style.left = x + 'px';
      card.style.top  = y + 'px';
      pos[nodeId].x = x;
      pos[nodeId].y = y;
      redraw();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      markDirty(npcKey);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Auto-layout (BFS columns) ─────────────────────────────────────────────

function autoLayout(convs) {
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
        for (const a of resp?.actions ?? []) {
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
  const cx = x1 + (x2 - x1) * 0.55;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
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
  marker.setAttribute('id', 'dg-arrow');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', '0 0, 8 3, 0 6');
  poly.setAttribute('fill', '#4a9eff');
  poly.setAttribute('opacity', '0.65');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function clearSvg(svg) {
  while (svg.lastChild) svg.removeChild(svg.lastChild);
}
