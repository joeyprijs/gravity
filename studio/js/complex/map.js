// The map is the primary authoring surface for a region: every placed scene
// is a card, navigate connections draw as arrows, dragging an anchor onto
// another card writes the "Go to" option, and double-clicking empty canvas
// creates a scene right there. Unplaced scenes wait in a tray.
import { store, markDirty, setActiveFile } from '../store.js';
import { el, select, slugify, uniqueId } from '../utils.js';
import { showFormModal, toast } from '../ui.js';
import { createEntry } from '../io.js';

const GRID = 5;
const snap = v => Math.round(v / GRID) * GRID;
const NS = 'http://www.w3.org/2000/svg';

export function openMapView() {
  document.querySelectorAll('.sidebar-item').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-key="__map"]')?.classList.add('active');
  const editor = document.getElementById('editor');
  editor.innerHTML = '';
  editor.appendChild(buildMapView());
}

function buildMapView() {
  const { index } = store;
  const regions = Object.entries(index?.regions ?? {}).map(([id, r]) => [id, r.name || id]);
  let currentRegion = regions[0]?.[0] ?? '';

  const wrap = el('div', { class: 'map-wrap' });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = el('div', { class: 'map-toolbar' });
  toolbar.appendChild(el('span', { class: 'map-toolbar-label' }, ['Region']));

  const regionSel = select(regions, currentRegion, v => { currentRegion = v; rebuild(); });
  regionSel.className = 'form-select sm';
  toolbar.appendChild(regionSel);

  toolbar.appendChild(el('span', { class: 'map-hint' },
    ['double-click empty space to create a scene · drag the ○ onto another scene to connect · click a scene to edit']));
  wrap.appendChild(toolbar);

  // Unplaced scenes tray (current region, no map position yet).
  const tray = el('div', { class: 'map-tray' });
  wrap.appendChild(tray);

  // ── Canvas ────────────────────────────────────────────────────────────────
  const scrollWrap = el('div', { class: 'map-scroll' });
  wrap.appendChild(scrollWrap);

  const { width = 3000, height = 2000 } = index?.worldMapSize ?? {};
  const canvas = el('div', {
    class: 'map-canvas',
    style: `width:${width}px;height:${height}px`,
  });
  scrollWrap.appendChild(canvas);

  // Connection layer sits under the cards and never eats their clicks.
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'map-conn-svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const regionScenes = () => Object.keys(index?.scenes ?? {})
    .map(id => ({ id, key: `scenes:${id}`, scene: store.files[`scenes:${id}`] }))
    .filter(s => s.scene?.region === currentRegion);

  function rebuild() {
    canvas.innerHTML = '';
    canvas.appendChild(svg);
    for (const { key, scene } of regionScenes()) {
      if (!scene.mapDefinitions) continue;
      canvas.appendChild(makeSceneCard(key, scene, scrollWrap, svg, redrawEdges));
    }
    // Edges need the cards' rendered geometry — wait for layout.
    requestAnimationFrame(redrawEdges);
    rebuildTray();
  }

  // ── Edges: every navigate action whose destination is placed here ────────
  // Geometry comes from the rendered cards, not mapDefinitions: CSS min
  // sizes make cards larger than their authored width/height, and the
  // arrows must land on what the author actually sees.
  function redrawEdges() {
    svg.innerHTML = '';
    addArrowDef(svg);
    const cards = new Map();
    for (const cardEl of canvas.querySelectorAll('.map-scene')) {
      cards.set(cardEl.dataset.sceneKey.slice('scenes:'.length), cardEl);
    }
    const rectOf = c => ({ x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight });

    for (const [id, cardEl] of cards) {
      const scene = store.files[`scenes:${id}`];
      for (const opt of (scene.options ?? [])) {
        const pipeline = opt.actions ?? opt.outcomes?.success?.actions ?? [];
        for (const action of pipeline) {
          if (action.type !== 'navigate') continue;
          const target = cards.get(action.destination);
          if (!target) continue;
          drawEdge(svg, rectOf(cardEl), rectOf(target));
        }
      }
    }
  }

  // ── Create on canvas ──────────────────────────────────────────────────────
  canvas.addEventListener('dblclick', async e => {
    if (e.target !== canvas && e.target !== svg && !svg.contains(e.target)) return;
    const wRect = scrollWrap.getBoundingClientRect();
    const x = snap(e.clientX - wRect.left + scrollWrap.scrollLeft);
    const y = snap(e.clientY - wRect.top + scrollWrap.scrollTop);

    const input = await showFormModal('New Scene here', [
      { key: 'title', label: 'Title', placeholder: 'The Old Mill', required: true },
      { key: 'description', label: 'What does the player see?', type: 'textarea' },
    ]);
    if (!input) return;
    const base = slugify(input.title);
    if (!base) { toast('Name needs at least one letter or digit', 'error'); return; }
    const id = uniqueId(base, sid => !!store.index.scenes?.[sid]);

    try {
      await createEntry('scenes', id, {
        title: input.title,
        region: currentRegion,
        description: input.description ? [{ text: input.description }] : [],
        options: [],
        mapDefinitions: { top: y, left: x, width: 50, height: 50 },
      });
      document.dispatchEvent(new CustomEvent('studio:sidebar-refresh'));
      rebuild();
    } catch (err) {
      toast(`Failed to create: ${err.message}`, 'error');
    }
  });

  // ── Unplaced tray ─────────────────────────────────────────────────────────
  function rebuildTray() {
    tray.innerHTML = '';
    const unplaced = regionScenes().filter(s => !s.scene.mapDefinitions);
    if (!unplaced.length) { tray.style.display = 'none'; return; }
    tray.style.display = '';
    tray.appendChild(el('span', { class: 'map-toolbar-label' }, ['Not on map yet:']));
    for (const { key, scene } of unplaced) {
      const chip = el('button', { class: 'btn btn-secondary btn-sm' }, [scene.title || key]);
      chip.title = 'Place in the center of the current view';
      chip.addEventListener('click', () => {
        scene.mapDefinitions = {
          top:  snap(scrollWrap.scrollTop  + scrollWrap.clientHeight / 2),
          left: snap(scrollWrap.scrollLeft + scrollWrap.clientWidth  / 2),
          width: 50, height: 50,
        };
        markDirty(key);
        rebuild();
      });
      tray.appendChild(chip);
    }
  }

  rebuild();
  return wrap;
}

// Point where the segment from this rect's center toward `toward` crosses
// the rect's border.
function borderPoint(rect, toward) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const s = Math.min(
    dx ? (rect.w / 2) / Math.abs(dx) : Infinity,
    dy ? (rect.h / 2) / Math.abs(dy) : Infinity
  );
  if (!Number.isFinite(s)) return { x: cx, y: cy };
  return { x: cx + dx * s, y: cy + dy * s };
}

// Straight arrow between two placed scenes, clipped to the rendered card
// borders so the line spans the gap between cards, with the head sitting
// on the target's edge. Touching or overlapping cards (tile-style maps
// have no gap at all) get a short arrow across the shared boundary
// instead.
function drawEdge(svg, from, to) {
  const c1 = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const c2 = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const len = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (!len) return;

  let p1 = borderPoint(from, c2);
  let p2 = borderPoint(to, c1);
  if ((p2.x - p1.x) * (c2.x - c1.x) + (p2.y - p1.y) * (c2.y - c1.y) <= 0) {
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const ux = (c2.x - c1.x) / len, uy = (c2.y - c1.y) / len;
    p1 = { x: mx - ux * 12, y: my - uy * 12 };
    p2 = { x: mx + ux * 12, y: my + uy * 12 };
  }

  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', String(p1.x));
  line.setAttribute('y1', String(p1.y));
  line.setAttribute('x2', String(p2.x));
  line.setAttribute('y2', String(p2.y));
  line.setAttribute('class', 'map-conn-line');
  line.setAttribute('marker-end', 'url(#map-arrow)');
  svg.appendChild(line);
}

function addArrowDef(svg) {
  const defs   = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id',           'map-arrow');
  marker.setAttribute('markerWidth',  '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX',         '8');
  marker.setAttribute('refY',         '3');
  marker.setAttribute('orient',       'auto');
  marker.setAttribute('markerUnits',  'userSpaceOnUse');
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', '0 0, 8 3, 0 6');
  poly.setAttribute('class',  'map-conn-head');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

function makeSceneCard(sceneKey, scene, scrollWrap, svg, redrawEdges) {
  const md = scene.mapDefinitions;

  const card = el('div', { class: 'map-scene' });
  card.style.cssText = `top:${md.top}px;left:${md.left}px;width:${md.width}px;height:${md.height}px`;
  if (md.background) card.style.background = md.background;
  if (store.activeFile === sceneKey) card.classList.add('map-scene-active');
  card.dataset.sceneKey = sceneKey;

  card.appendChild(el('span', { class: 'map-scene-label' }, [scene.title || sceneKey]));

  // Connect anchor: drag onto another scene to write a "Go to" option.
  const anchor = el('div', { class: 'map-anchor', title: 'Drag onto another scene to connect' });
  card.appendChild(anchor);

  anchor.addEventListener('mousedown', e => {
    e.stopPropagation();
    e.preventDefault();

    const wRect = scrollWrap.getBoundingClientRect();
    // The pending line hangs off the anchor dot at the card's rendered
    // right edge — the place the author is actually dragging from.
    const startX = card.offsetLeft + card.offsetWidth;
    const startY = card.offsetTop + card.offsetHeight / 2;

    const pending = document.createElementNS(NS, 'line');
    pending.setAttribute('class', 'map-conn-line map-conn-pending');
    pending.setAttribute('x1', String(startX));
    pending.setAttribute('y1', String(startY));
    pending.setAttribute('x2', String(startX));
    pending.setAttribute('y2', String(startY));
    svg.appendChild(pending);

    const onMove = ev => {
      pending.setAttribute('x2', String(ev.clientX - wRect.left + scrollWrap.scrollLeft));
      pending.setAttribute('y2', String(ev.clientY - wRect.top + scrollWrap.scrollTop));
    };

    const onUp = ev => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      pending.remove();

      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetKey = hit?.closest('.map-scene')?.dataset.sceneKey;
      if (!targetKey || targetKey === sceneKey) return;

      const targetId = targetKey.slice('scenes:'.length);
      const targetScene = store.files[targetKey];

      // One connection per destination — repeat drags shouldn't stack
      // duplicate options.
      const already = (scene.options ?? []).some(o =>
        (o.actions ?? []).some(a => a.type === 'navigate' && a.destination === targetId));
      if (already) { toast('Already connected', 'info'); return; }

      if (!Array.isArray(scene.options)) scene.options = [];
      scene.options.push({
        text: `Go to ${targetScene?.title || targetId}`,
        actions: [{ type: 'navigate', destination: targetId }],
      });
      markDirty(sceneKey);
      toast(`Connected: ${scene.title} → ${targetScene?.title || targetId}`, 'success');
      redrawEdges();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Below this movement a mousedown still counts as a click-to-open,
  // and a jittery click can't mark the scene dirty.
  const DRAG_THRESHOLD = 4;

  card.addEventListener('mousedown', e => {
    e.preventDefault();
    let dragged = false;
    const startX = e.clientX;
    const startY = e.clientY;

    const wRect  = scrollWrap.getBoundingClientRect();
    const origX  = e.clientX - wRect.left + scrollWrap.scrollLeft - md.left;
    const origY  = e.clientY - wRect.top  + scrollWrap.scrollTop  - md.top;
    let raf = 0;
    let lastX = md.left, lastY = md.top;

    const onMove = e => {
      if (!dragged && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return;
      dragged = true;
      lastX = snap(e.clientX - wRect.left + scrollWrap.scrollLeft - origX);
      lastY = snap(e.clientY - wRect.top  + scrollWrap.scrollTop  - origY);
      card.style.left = lastX + 'px';
      card.style.top  = lastY + 'px';
      // Keep arrows attached while dragging, at most once a frame. The
      // callback reads the live lastX/lastY (never captured coordinates),
      // so a stale frame can't rewind the position.
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        md.left = lastX; md.top = lastY;
        redrawEdges();
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',  onUp);
      cancelAnimationFrame(raf);

      if (!dragged) { setActiveFile(sceneKey); return; }

      const newLeft = parseInt(card.style.left);
      const newTop  = parseInt(card.style.top);
      md.left = newLeft;
      md.top  = newTop;
      markDirty(sceneKey);
      redrawEdges();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',  onUp);
  });

  return card;
}
