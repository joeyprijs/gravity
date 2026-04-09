import { gameState } from "./state.js";
import { clearElement } from "./utils.js";
import { MINIMAP_SIZE } from "./config.js";

export class MapManager {
  constructor(engine) {
    this.engine = engine;
    this._minimapCacheKey = null;
  }

  setup() {
    document.getElementById('minimap').addEventListener('click', () => this.openFullMap());
    document.getElementById('fullmap-close').addEventListener('click', () => this.closeFullMap());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('fullmap-overlay').hidden) this.closeFullMap();
    });
    document.getElementById('fullmap-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeFullMap();
    });
  }

  renderMinimap() {
    const minimapEl = document.getElementById('minimap');
    const canvasEl = document.getElementById('minimap-canvas');
    if (!minimapEl || !canvasEl) return;

    const currentSceneId = gameState.getCurrentSceneId();

    // Only rebuild when the player has moved to a new scene. Visiting a new
    // scene always changes currentSceneId, so this key covers both "you are
    // here" updates and newly-discovered rooms appearing on the map.
    if (currentSceneId === this._minimapCacheKey) return;

    const regionId = this.engine.data.scenes[currentSceneId]?.region;
    const regionScenes = this._getVisitedScenesForRegion(regionId);

    if (regionScenes.length === 0) {
      minimapEl.hidden = true;
      return;
      // Cache key intentionally not updated — retry next update() in case
      // visitedScenes hasn't been populated yet for this scene.
    }

    const bbox = this._computeBbox(regionScenes);
    const padding = 40;
    const bboxW = (bbox.maxRight - bbox.minLeft) + padding * 2;
    const bboxH = (bbox.maxBottom - bbox.minTop) + padding * 2;
    const scale = MINIMAP_SIZE / Math.max(bboxW, bboxH);

    // Compute each node's position directly in minimap pixel space — no CSS
    // transform on the canvas, which avoids Safari compositor layer caching.
    const fresh = document.createElement('div');
    fresh.id = 'minimap-canvas';
    fresh.className = 'minimap__canvas';

    for (const { id, scene } of regionScenes) {
      const d = scene.mapDefinitions;
      const node = this._buildMapNode(id, scene, id === currentSceneId);
      node.style.top    = ((d.top    - bbox.minTop  + padding) * scale) + 'px';
      node.style.left   = ((d.left   - bbox.minLeft + padding) * scale) + 'px';
      node.style.width  = (d.width  * scale) + 'px';
      node.style.height = (d.height * scale) + 'px';
      node.style.background = d.background || 'var(--glass-bg)';
      fresh.appendChild(node);
    }

    canvasEl.replaceWith(fresh);
    minimapEl.hidden = false;
    this._minimapCacheKey = currentSceneId;
  }

  openFullMap() {
    const overlay = document.getElementById('fullmap-overlay');
    const canvasEl = document.getElementById('fullmap-canvas');
    const titleEl = document.getElementById('fullmap-title');
    const scrollEl = overlay?.querySelector('.fullmap-overlay__inner');
    if (!overlay || !canvasEl || !scrollEl) return;

    const currentSceneId = gameState.getCurrentSceneId();
    const allScenes = this._getAllVisitedMapScenes();
    const { width, height } = this.engine.data.worldMapSize;

    if (titleEl) titleEl.textContent = 'World Map';
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;

    this._renderSceneNodes(canvasEl, allScenes, currentSceneId);
    overlay.hidden = false;

    // Scroll so the current scene is centered in the viewport
    const defs = this.engine.data.scenes[currentSceneId]?.mapDefinitions;
    if (defs) {
      requestAnimationFrame(() => {
        const cx = defs.left + defs.width / 2;
        const cy = defs.top + defs.height / 2;
        scrollEl.scrollLeft = cx - scrollEl.clientWidth / 2;
        scrollEl.scrollTop = cy - scrollEl.clientHeight / 2;
      });
    }
  }

  closeFullMap() {
    document.getElementById('fullmap-overlay').hidden = true;
  }

  _getAllVisitedMapScenes() {
    const visited = new Set(gameState.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  _getVisitedScenesForRegion(regionId) {
    if (!regionId) return [];
    const visited = new Set(gameState.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => scene?.region === regionId && visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  _buildMapNode(id, scene, isCurrentScene) {
    const node = document.createElement('div');
    node.className = 'map-node' + (isCurrentScene ? ' map-node--current' : '');
    const label = document.createElement('span');
    label.className = 'map-node__label';
    label.textContent = scene.title || scene.name || id;
    node.appendChild(label);
    return node;
  }

  _computeBbox(scenes) {
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    for (const { scene } of scenes) {
      const { left, top, width, height } = scene.mapDefinitions;
      if (left < minLeft) minLeft = left;
      if (top < minTop) minTop = top;
      if (left + width > maxRight) maxRight = left + width;
      if (top + height > maxBottom) maxBottom = top + height;
    }
    return { minLeft, minTop, maxRight, maxBottom };
  }

  _renderSceneNodes(canvasEl, scenes, currentSceneId) {
    clearElement(canvasEl);
    for (const { id, scene } of scenes) {
      const { top, left, width, height, background } = scene.mapDefinitions;
      const node = this._buildMapNode(id, scene, id === currentSceneId);
      Object.assign(node.style, {
        top: top + 'px',
        left: left + 'px',
        width: width + 'px',
        height: height + 'px',
        background: background || 'var(--glass-bg)'
      });
      canvasEl.appendChild(node);
    }
  }
}
