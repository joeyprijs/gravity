import { store, markDirty, setActiveFile } from '../store.js';
import { el, select } from '../utils.js';

const GRID = 5;
const snap = v => Math.round(v / GRID) * GRID;

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

  const regionSel = select(regions, currentRegion, v => { currentRegion = v; rebuildCards(); });
  regionSel.className = 'form-select sm';
  toolbar.appendChild(regionSel);

  toolbar.appendChild(el('span', { class: 'map-hint' },
    [`Drag to reposition · click to open · snaps to ${GRID}px`]));
  wrap.appendChild(toolbar);

  // ── Canvas ────────────────────────────────────────────────────────────────
  const scrollWrap = el('div', { class: 'map-scroll' });
  wrap.appendChild(scrollWrap);

  const { width = 3000, height = 2000 } = index?.worldMapSize ?? {};
  const canvas = el('div', {
    class: 'map-canvas',
    style: `width:${width}px;height:${height}px`,
  });
  scrollWrap.appendChild(canvas);

  function rebuildCards() {
    canvas.innerHTML = '';
    for (const sceneId of Object.keys(index?.scenes ?? {})) {
      const key  = `scenes:${sceneId}`;
      const scene = store.files[key];
      if (!scene?.mapDefinitions || scene.region !== currentRegion) continue;
      canvas.appendChild(makeSceneCard(key, scene, scrollWrap));
    }
  }

  rebuildCards();
  return wrap;
}

function makeSceneCard(sceneKey, scene, scrollWrap) {
  const md = scene.mapDefinitions;

  const card = el('div', { class: 'map-scene' });
  card.style.cssText = `top:${md.top}px;left:${md.left}px;width:${md.width}px;height:${md.height}px`;
  if (md.background) card.style.background = md.background;
  if (store.activeFile === sceneKey) card.classList.add('map-scene-active');

  card.appendChild(el('span', { class: 'map-scene-label' }, [scene.title || sceneKey]));

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

    const onMove = e => {
      if (!dragged && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return;
      dragged = true;
      const x = snap(e.clientX - wRect.left + scrollWrap.scrollLeft - origX);
      const y = snap(e.clientY - wRect.top  + scrollWrap.scrollTop  - origY);
      card.style.left = x + 'px';
      card.style.top  = y + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',  onUp);

      if (!dragged) { setActiveFile(sceneKey); return; }

      const newLeft = parseInt(card.style.left);
      const newTop  = parseInt(card.style.top);
      if (newLeft === md.left && newTop === md.top) return;
      md.left = newLeft;
      md.top  = newTop;
      markDirty(sceneKey);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',  onUp);
  });

  return card;
}
