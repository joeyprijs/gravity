import { gameState } from "../core/state.js";
import { clearElement } from "../core/utils.js";
import { MINIMAP_SIZE, MAP_NODE_DEFAULT_BG, CSS, EL } from "../core/config.js";

// MapManager handles both the minimap HUD and the full-screen world map overlay.
// The minimap is cached by scene ID so it only rebuilds when the player moves.
// The full map renders all visited scenes at their authored pixel coordinates.
export class MapManager {
  constructor(engine) {
    this.engine = engine;
    // Last scene ID for which the minimap was successfully rendered.
    // null forces a render on the first update() call.
    this._minimapCacheKey = null;
  }

  // Wires up minimap click-to-open, ESC/backdrop/button close for the full map.
  setup() {
    document.getElementById(EL.MINIMAP).addEventListener('click', () => this.openFullMap());
    document.getElementById(EL.FULLMAP_CLOSE).addEventListener('click', () => this.closeFullMap());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById(EL.FULLMAP_OVERLAY).hidden) this.closeFullMap();
    });
    // Clicking outside the map panel (on the backdrop) also closes it.
    document.getElementById(EL.FULLMAP_OVERLAY).addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeFullMap();
    });
  }

  renderMinimap() {
    const minimapEl = document.getElementById(EL.MINIMAP);
    const canvasEl = document.getElementById(EL.MINIMAP_CANVAS);
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
    const size = minimapEl.offsetWidth || MINIMAP_SIZE;
    const scale = size / Math.max(bboxW, bboxH);

    // Build a fresh canvas div and swap it in with replaceWith() — this forces
    // Safari to flush its compositor layer cache, which can otherwise show a
    // stale minimap when navigating between scenes.
    const fresh = document.createElement('div');
    fresh.id = EL.MINIMAP_CANVAS;
    fresh.className = CSS.MINIMAP_CANVAS;

    for (const { id, scene } of regionScenes) {
      const d = scene.mapDefinitions;
      const node = this._buildMapNode(id, scene, id === currentSceneId);
      // Positions are computed directly in minimap pixel space rather than
      // using CSS transforms, which avoids additional Safari caching issues.
      node.style.top    = ((d.top    - bbox.minTop  + padding) * scale) + 'px';
      node.style.left   = ((d.left   - bbox.minLeft + padding) * scale) + 'px';
      node.style.width  = (d.width  * scale) + 'px';
      node.style.height = (d.height * scale) + 'px';
      node.style.background = d.background || MAP_NODE_DEFAULT_BG;
      fresh.appendChild(node);
    }

    canvasEl.replaceWith(fresh);
    minimapEl.hidden = false;
    this._minimapCacheKey = currentSceneId;
  }

  // Renders all visited scenes on the full-screen world map and scrolls so the
  // current scene is centered in the scrollable viewport.
  openFullMap() {
    const overlay = document.getElementById(EL.FULLMAP_OVERLAY);
    const canvasEl = document.getElementById(EL.FULLMAP_CANVAS);
    const titleEl = document.getElementById(EL.FULLMAP_TITLE);
    const scrollEl = overlay?.querySelector(`.${CSS.FULLMAP_INNER}`);
    if (!overlay || !canvasEl || !scrollEl) return;

    const currentSceneId = gameState.getCurrentSceneId();
    const allScenes = this._getAllVisitedMapScenes();
    const { width, height } = this.engine.data.worldMapSize;

    if (titleEl) titleEl.textContent = this.engine.t('ui.worldMapTitle');
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;

    this._renderSceneNodes(canvasEl, allScenes, currentSceneId);
    overlay.hidden = false;

    // Scroll so the current scene is centered in the viewport.
    // requestAnimationFrame ensures the overlay is visible before we measure.
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
    document.getElementById(EL.FULLMAP_OVERLAY).hidden = true;
  }

  invalidateMinimap() {
    this._minimapCacheKey = null;
  }

  // Returns all visited scenes that have mapDefinitions, across all regions.
  _getAllVisitedMapScenes() {
    const visited = new Set(gameState.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  // Returns visited scenes that belong to a specific region and have mapDefinitions.
  // Used by the minimap to show only the current region, not the whole world.
  _getVisitedScenesForRegion(regionId) {
    if (!regionId) return [];
    const visited = new Set(gameState.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => scene?.region === regionId && visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  // Builds a positioned map node div. The caller is responsible for setting
  // top/left/width/height/background on the returned element.
  _buildMapNode(id, scene, isCurrentScene) {
    const node = document.createElement('div');
    node.className = isCurrentScene ? `${CSS.MAP_NODE} ${CSS.MAP_NODE_CURRENT}` : CSS.MAP_NODE;
    const label = document.createElement('span');
    label.className = CSS.MAP_NODE_LABEL;
    label.textContent = scene.title || scene.name || id;
    node.appendChild(label);
    return node;
  }

  // Computes the axis-aligned bounding box of a set of map scenes.
  // Used by renderMinimap() to fit all visible nodes within the minimap square.
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

  // Clears and redraws scene nodes on a canvas element at their authored pixel
  // coordinates. Used by openFullMap() to populate the full-screen world map.
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
        background: background || MAP_NODE_DEFAULT_BG
      });
      canvasEl.appendChild(node);
    }
  }
}
