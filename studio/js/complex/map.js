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
    redrawEdges();
    rebuildTray();
  }

  // ── Edges: every navigate action whose destination is placed here ────────
  function redrawEdges() {
    svg.innerHTML = '';
    const placed = new Map(regionScenes()
      .filter(s => s.scene.mapDefinitions)
      .map(s => [s.id, s.scene.mapDefinitions]));

    for (const [id, md] of placed) {
      const scene = store.files[`scenes:${id}`];
      for (const opt of (scene.options ?? [])) {
        for (const action of (opt.actions ?? [])) {
          if (action.type !== 'navigate') continue;
          const target = placed.get(action.destination);
          if (!target) continue;
          drawEdge(svg, md, target);
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

// Straight arrow between two placed scenes, center to center, trimmed so
// the head lands on the target's edge rather than under the card.
function drawEdge(svg, from, to) {
  const x1 = from.left + (from.width ?? 50) / 2;
  const y1 = from.top  + (from.height ?? 50) / 2;
  const x2 = to.left   + (to.width ?? 50) / 2;
  const y2 = to.top    + (to.height ?? 50) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Pull the endpoint back to the target's boundary (approximate: half the
  // smaller card dimension) so the arrowhead is visible.
  const trim = Math.min(to.width ?? 50, to.height ?? 50) / 2 + 4;
  const ex = x2 - (dx / len) * trim;
  const ey = y2 - (dy / len) * trim;

  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(ex));
  line.setAttribute('y2', String(ey));
  line.setAttribute('class', 'map-conn-line');
  svg.appendChild(line);

  // Arrowhead: two short strokes.
  const angle = Math.atan2(dy, dx);
  for (const off of [Math.PI * 0.85, -Math.PI * 0.85]) {
    const hx = ex + Math.cos(angle + off) * 8;
    const hy = ey + Math.sin(angle + off) * 8;
    const head = document.createElementNS(NS, 'line');
    head.setAttribute('x1', String(ex));
    head.setAttribute('y1', String(ey));
    head.setAttribute('x2', String(hx));
    head.setAttribute('y2', String(hy));
    head.setAttribute('class', 'map-conn-line');
    svg.appendChild(head);
  }
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
    const startX = md.left + (md.width ?? 50) / 2;
    const startY = md.top + (md.height ?? 50) / 2;

    const pending = document.createElementNS(NS, 'line');
    pending.setAttribute('class', 'map-conn-line map-conn-pending');
    pending.setAttribute('x1', String(startX));
    pending.setAttribute('y1', String(startY));
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
