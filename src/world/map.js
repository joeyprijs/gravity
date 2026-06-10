import { gameState } from "../core/state.js";
import { clearElement } from "../core/utils.js";
import { MINIMAP_SIZE, MAP_PADDING, MAP_NODE_DEFAULT_BG, CSS, EL } from "../core/config.js";

/**
 * MapManager handles both the minimap HUD in the sidebar and the full-screen world map overlay.
 * 
 * Key Functions:
 * 1. Computes coordinate transformations to scale, fit, and project scene nodes on 2D surfaces.
 * 2. Implements bounding-box scaling to fit arbitrary layout dimensions within the HUD bounds.
 * 3. Handles scroll alignments to dynamically center viewports on the active coordinate set.
 */
export class MapManager {
  /**
   * Constructs the MapManager.
   * 
   * @param {object} engine - The central RPGEngine coordination instance.
   */
  constructor(engine) {
    this.engine = engine;
    
    // Cached scene ID to skip rebuilding coordinates if the player hasn't moved.
    // Initialized to null to guarantee a render on the first boot update.
    this._minimapCacheKey = null;
  }

  /**
   * Establishes document-level click, backdrop, and keyboard ESC triggers
   * to manage opening and closing the full-screen world map overlay.
   */
  setup() {
    document.getElementById(EL.MINIMAP).addEventListener('click', () => this.openFullMap());
    document.getElementById(EL.FULLMAP_CLOSE).addEventListener('click', () => this.closeFullMap());
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById(EL.FULLMAP_OVERLAY).hidden) {
        this.closeFullMap();
      }
    });
    
    // Click outside panel (backdrop area) closes the overlay
    document.getElementById(EL.FULLMAP_OVERLAY).addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeFullMap();
    });
  }

  /**
   * Renders the local region minimap inside the player HUD panel.
   * Dynamically filters, projects, and scales absolute positions to fit within HUD bounds.
   */
  renderMinimap() {
    const minimapEl = document.getElementById(EL.MINIMAP);
    const canvasEl = document.getElementById(EL.MINIMAP_CANVAS);
    if (!minimapEl || !canvasEl) return;

    const currentSceneId = gameState.getCurrentSceneId();

    // Cache guard: Only rebuild DOM elements when the player moves.
    // Movement resets this key, ensuring discovered rooms are instantly captured.
    if (currentSceneId === this._minimapCacheKey) return;

    const regionId = this.engine.data.scenes[currentSceneId]?.region;
    const regionScenes = this._getVisitedScenesForRegion(regionId);

    // Hide the minimap entirely if the current scene lacks map configurations
    if (regionScenes.length === 0) {
      minimapEl.hidden = true;
      return;
    }

    // ── Bounding Box Scaling Mathematics ────────────────────────────────────
    // 1. Compute the strict structural bounds containing all active nodes.
    const bbox = this._computeBbox(regionScenes);
    const padding = MAP_PADDING;
    
    // 2. Compute absolute horizontal and vertical footprint sizes.
    const bboxW = (bbox.maxRight - bbox.minLeft) + padding * 2;
    const bboxH = (bbox.maxBottom - bbox.minTop) + padding * 2;
    
    // 3. Scale factor calculations: fits the larger dimension within the HUD box width.
    const size = minimapEl.offsetWidth || MINIMAP_SIZE;
    const scale = size / Math.max(bboxW, bboxH);

    // Safari layout bug prevention: Rebuilding the canvas wrapper and swapping it
    // into the DOM via replaceWith() forces the browser engine to completely flush 
    // its compositor layers cache, preventing rendering glitches during fast moves.
    const fresh = document.createElement('div');
    fresh.id = EL.MINIMAP_CANVAS;
    fresh.className = CSS.MINIMAP_CANVAS;

    // ── Projection Loop ─────────────────────────────────────────────────────
    for (const { id, scene } of regionScenes) {
      const d = scene.mapDefinitions;
      const node = this._buildMapNode(id, scene, id === currentSceneId);
      
      // Coordinate conversions mapping absolute pixels to relative minimap bounds.
      // Arithmetic projection: ((Coordinate - Offset + Buffer) * Scale)px
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

  /**
   * Opens the full-screen world map overlay, rendering all visited map nodes.
   * Automatically centers the viewport scroll bars on the player's active position.
   */
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

    // ── Centering Scroll Calculations ───────────────────────────────────────
    // Centering formula: TargetCenterCoordinate - ViewportHalfSize
    // Uses requestAnimationFrame to ensure dimensions are loaded before measuring.
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

  /**
   * Hides the full-screen world map overlay.
   */
  closeFullMap() {
    document.getElementById(EL.FULLMAP_OVERLAY).hidden = true;
  }

  /**
   * Invalidate the minimap cache, forcing a complete redraw on the next update call.
   */
  invalidateMinimap() {
    this._minimapCacheKey = null;
  }

  /**
   * Resolves and returns all visited scene structures containing map definitions.
   * 
   * @private
   * @returns {object[]} Array of filtered map nodes.
   */
  _getAllVisitedMapScenes() {
    const visited = new Set(gameState.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  /**
   * Resolves visited scene structures restricted to a specific region folder.
   * 
   * @private
   * @param {string} regionId - The region category string.
   * @returns {object[]} Array of region-specific map nodes.
   */
  _getVisitedScenesForRegion(regionId) {
    if (!regionId) return [];
    const visited = new Set(gameState.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => scene?.region === regionId && visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  /**
   * Creates a styled, absolutely positioned div element representing a map node.
   * The caller is responsible for setting dimensional top/left bounds on the returned element.
   * 
   * @private
   * @param {string} id - The scene identifier.
   * @param {object} scene - The scene configuration schema.
   * @param {boolean} isCurrentScene - True if the player is currently in this room.
   * @returns {HTMLElement} The styled map node DOM element.
   */
  _buildMapNode(id, scene, isCurrentScene) {
    const node = document.createElement('div');
    node.className = isCurrentScene ? `${CSS.MAP_NODE} ${CSS.MAP_NODE_CURRENT}` : CSS.MAP_NODE;
    
    const label = document.createElement('span');
    label.className = CSS.MAP_NODE_LABEL;
    label.textContent = scene.title || scene.name || id;
    node.appendChild(label);
    
    return node;
  }

  /**
   * Computes the axis-aligned bounding box (AABB) enclosing a set of map scenes.
   * Used to establish the minimal coordinate box containing all rendered rooms.
   * 
   * @private
   * @param {object[]} scenes - Array of scene objects with definitions.
   * @returns {{minLeft: number, minTop: number, maxRight: number, maxBottom: number}} Bbox.
   */
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

  /**
   * Projects and appends scene nodes onto the full-screen canvas layout.
   * 
   * @private
   * @param {HTMLElement} canvasEl - The target canvas wrapper.
   * @param {object[]} scenes - Array of all visited scenes.
   * @param {string} currentSceneId - Active player scene ID.
   */
  _renderSceneNodes(canvasEl, scenes, currentSceneId) {
    clearElement(canvasEl);
    for (const { id, scene } of scenes) {
      const { top, left, width, height, background } = scene.mapDefinitions;
      const node = this._buildMapNode(id, scene, id === currentSceneId);
      
      // Apply exact coordinate mappings configured by the developer
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
