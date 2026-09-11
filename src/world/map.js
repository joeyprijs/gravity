import { createElement, hideCursorTooltip, isInteriorScene, showCursorTooltip } from '../core/utils.js';
import { MINIMAP_SIZE, MAP_PADDING, MAP_NODE_DEFAULT_BG, CSS, EL } from '../core/config.js';

// The map's notion of a door: the navigate destinations of a scene's options,
// onVictory included. Options only: a skill check's destination is the reward
// for passing it, and must not appear on the map before it is discovered.
function sceneNavigationTargets(scene) {
  const targets = [];
  const walk = (actions) => {
    for (const action of actions || []) {
      if (action.type === 'navigate' && action.destination) targets.push(action.destination);
      walk(action.onVictory);
    }
  };

  for (const option of scene?.options || []) walk(option.actions);
  return targets;
}

// The minimap and the full-screen world map, drawn from one body of knowledge
// (_outdoorKnowledge) so they never disagree about what exists. The minimap is
// "where am I": a building's rooms inside, a viewport on the player outside.
// The full map is "where is everything", at authored coordinates.
export class MapManager {
  constructor(engine) {
    this.engine = engine;

    // The minimap rebuilds only when the player moves. Anything else that
    // changes the map must call invalidateMinimap() first.
    this._minimapCacheKey = null;
  }

  setup() {
    const minimapEl = document.getElementById(EL.MINIMAP);
    minimapEl.addEventListener('click', () => this.openFullMap());

    // Delegated to the container: the canvas is rebuilt on every move.
    minimapEl.addEventListener('mousemove', (e) => this._moveMapTooltip(e));
    minimapEl.addEventListener('mouseleave', () => hideCursorTooltip());
    document.getElementById(EL.FULLMAP_CLOSE).addEventListener('click', () => this.closeFullMap());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById(EL.FULLMAP_OVERLAY).hidden) {
        this.closeFullMap();
      }
    });

    document.getElementById(EL.FULLMAP_OVERLAY).addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeFullMap();
    });
  }

  renderMinimap() {
    const minimapEl = document.getElementById(EL.MINIMAP);
    const canvasEl = document.getElementById(EL.MINIMAP_CANVAS);
    if (!minimapEl || !canvasEl) return;

    const currentSceneId = this.engine.state.getCurrentSceneId();

    if (currentSceneId === this._minimapCacheKey) return;

    const placements = this._minimapPlacements(currentSceneId);

    // Not cached: state.init() seeds currentSceneId before the scene is
    // visited, so the first render finds nothing while the id is already
    // final. Caching here would keep the minimap hidden for the whole scene.
    if (placements.length === 0) {
      minimapEl.hidden = true;
      return;
    }

    // Unhide before measuring: a [hidden] element has no offsetWidth, and the
    // fallback would project everything for the wrong square, then cache it.
    minimapEl.hidden = false;
    const size = minimapEl.offsetWidth || MINIMAP_SIZE;
    const view = this._minimapView(currentSceneId, placements, size);

    // A fresh canvas swapped in with replaceWith() flushes Safari's compositor
    // cache, which otherwise glitches on fast moves.
    const fresh = createElement('div', CSS.MINIMAP_CANVAS);
    fresh.id = EL.MINIMAP_CANVAS;

    for (const { id, key, def, label, background, isCurrent } of placements) {
      const node = this._buildMapNode(label, isCurrent);
      // So setPeek can find the box again.
      if (id) node.dataset.scene = id;
      if (key) node.dataset.building = key;
      node.style.top    = ((def.top  - view.top)  * view.scale) + 'px';
      node.style.left   = ((def.left - view.left) * view.scale) + 'px';
      node.style.width  = (def.width  * view.scale) + 'px';
      node.style.height = (def.height * view.scale) + 'px';
      node.style.background = background || MAP_NODE_DEFAULT_BG;
      fresh.appendChild(node);
    }

    canvasEl.replaceWith(fresh);
    this._minimapCacheKey = currentSceneId;
  }

  // Lights the box a considered move leads to: the room, or the building it
  // is inside when the view does not draw the room. Only a box already on the
  // map can light up; the peek reveals nothing. Null clears.
  setPeek(sceneId) {
    const canvas = document.getElementById(EL.MINIMAP_CANVAS);
    if (!canvas) return;
    canvas.querySelectorAll(`.${CSS.MAP_NODE_PEEK}`)
      .forEach(n => n.classList.remove(CSS.MAP_NODE_PEEK));
    if (!sceneId) return;

    let target = canvas.querySelector(`[data-scene="${sceneId}"]`);
    if (!target) {
      const key = this._interiorKeyOf(sceneId);
      if (key) target = canvas.querySelector(`[data-building="${key}"]`);
    }
    target?.classList.add(CSS.MAP_NODE_PEEK);
  }

  openFullMap() {
    const overlay = document.getElementById(EL.FULLMAP_OVERLAY);
    const canvasEl = document.getElementById(EL.FULLMAP_CANVAS);
    const titleEl = document.getElementById(EL.FULLMAP_TITLE);
    const scrollEl = overlay?.querySelector(`.${CSS.FULLMAP_INNER}`);
    if (!overlay || !canvasEl || !scrollEl) return;

    const currentSceneId = this.engine.state.getCurrentSceneId();
    const { width, height } = this.engine.data.worldMapSize;

    if (titleEl) titleEl.textContent = this.engine.t('ui.worldMapTitle');
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;

    this._renderSceneNodes(canvasEl, this._fullMapPlacements(currentSceneId));
    hideCursorTooltip();
    overlay.hidden = false;

    // Centre on the player once the overlay has laid out.
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

  // The box's label is hidden at minimap scale; the tooltip reads it back out.
  _moveMapTooltip(e) {
    const node = e.target.closest(`.${CSS.MAP_NODE}`);
    const label = node?.querySelector(`.${CSS.MAP_NODE_LABEL}`)?.textContent;
    if (label) showCursorTooltip(label, e);
    else hideCursorTooltip();
  }

  // For changes that alter the map without moving the player.
  invalidateMinimap() {
    this._minimapCacheKey = null;
  }

  // The minimap's boxes. Inside a building: its visited rooms, plus the ground
  // outside doors already seen through, so a way out has somewhere to point.
  // Outside: everywhere known, with each building as the one square it occupies.
  _minimapPlacements(currentSceneId) {
    const scenes = this.engine.data.scenes;
    const known = this._outdoorKnowledge();
    const inside = this._interiorKeyOf(currentSceneId);
    if (inside) {
      const rooms = this._visitedMapScenes()
        .filter(({ id }) => this._interiorKeyOf(id) === inside);
      const outside = new Set(rooms
        .flatMap(({ scene }) => sceneNavigationTargets(scene))
        .filter(id => known.rooms.has(id) && scenes[id]?.mapDefinitions));
      return [
        ...[...outside].map(id => this._roomPlacement(id, scenes[id], currentSceneId)),
        ...rooms.map(({ id, scene }) => this._roomPlacement(id, scene, currentSceneId))
      ];
    }

    const rooms = [...known.rooms]
      .filter(id => scenes[id]?.mapDefinitions)
      .map(id => this._roomPlacement(id, scenes[id], currentSceneId));
    const buildings = [...known.buildings].map(key => this._buildingPlacement(key));

    // Buildings first: a building's square is a bounding box, and the ground
    // the player stands on must never end up underneath it.
    return [...buildings, ...rooms];
  }

  // The full map's boxes: everywhere known, in as much detail as it is known.
  // A building entered shows its walked rooms; one seen from the road, its
  // footprint.
  _fullMapPlacements(currentSceneId) {
    const scenes = this.engine.data.scenes;
    const { rooms, buildings } = this._outdoorKnowledge();

    const walked = new Map();
    const insideRooms = [];
    for (const { id, scene } of this._visitedMapScenes()) {
      const key = this._interiorKeyOf(id);
      if (!key) continue;
      if (!walked.has(key)) walked.set(key, []);
      walked.get(key).push(scene);
      insideRooms.push(this._roomPlacement(id, scene, currentSceneId));
    }

    // Footprints first, so no building covers its road. Outlines last: their
    // names sit above the building, over whatever it backs onto.
    return [
      ...[...buildings].filter(key => !walked.has(key)).map(key => this._buildingPlacement(key)),
      ...[...rooms].filter(id => scenes[id]?.mapDefinitions)
        .map(id => this._roomPlacement(id, scenes[id], currentSceneId)),
      ...insideRooms,
      // A building of one room is already named by that room.
      ...[...walked].filter(([, rooms]) => rooms.length > 1)
        .map(([key, rooms]) => this._buildingOutline(key, rooms))
    ];
  }

  // An outline with the building's name around the rooms walked, not the
  // whole footprint: a half-explored dungeon must not give its extent away.
  _buildingOutline(key, rooms) {
    return {
      def: this._enclosing(rooms),
      label: this._buildingFace(key, rooms).label,
      background: 'transparent',
      isCurrent: false,
      isBuilding: true
    };
  }

  _enclosing(rooms) {
    const bbox = this._computeBbox(rooms.map(room => room.mapDefinitions));
    return {
      top: bbox.minTop,
      left: bbox.minLeft,
      width: bbox.maxRight - bbox.minLeft,
      height: bbox.maxBottom - bbox.minTop
    };
  }

  // Everywhere outdoors the player knows of: what they walked, plus one step
  // of sight from it (the roads off a place, the buildings whose doors they
  // stood at, the ground outside a door). Sight reaches out of a building but
  // never in: rooms are revealed by walking them.
  _outdoorKnowledge() {
    const scenes = this.engine.data.scenes;
    const rooms = new Set();
    const buildings = new Set();

    for (const id of this.engine.state.getVisitedScenes()) {
      if (!scenes[id]) continue;
      const indoors = this._interiorKeyOf(id);
      if (!indoors) rooms.add(id);
      for (const dest of sceneNavigationTargets(scenes[id])) {
        const key = this._interiorKeyOf(dest);
        if (!key && scenes[dest]) rooms.add(dest);
        else if (key && !indoors) buildings.add(key);
      }
    }

    // A known region's scenes seed no sight of their own.
    for (const id of this._knownSceneIds()) {
      const key = this._interiorKeyOf(id);
      if (key) buildings.add(key);
      else rooms.add(id);
    }

    // A building without room geometry has no square; dropping it here keeps
    // "known" meaning "drawable" for both views.
    return {
      rooms,
      buildings: new Set([...buildings].filter(key => this._buildingRooms(key).length))
    };
  }

  _buildingRooms(key) {
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => scene?.mapDefinitions && this._interiorKeyOf(id) === key)
      .map(([, scene]) => scene);
  }

  // Outdoors with a minimapRadius the minimap is a viewport centred on the
  // player, so a growing world scrolls instead of shrinking. Otherwise, and
  // inside a building, the frame is the extent of what is drawn.
  _minimapView(currentSceneId, placements, size) {
    const radius = this.engine.data.minimapRadius;
    const here = this.engine.data.scenes[currentSceneId]?.mapDefinitions;

    if (radius > 0 && here && !this._interiorKeyOf(currentSceneId)) {
      return {
        left: (here.left + here.width / 2) - radius,
        top: (here.top + here.height / 2) - radius,
        scale: size / (radius * 2)
      };
    }

    const bbox = this._computeBbox(placements.map(p => p.def));
    const span = Math.max(
      (bbox.maxRight - bbox.minLeft),
      (bbox.maxBottom - bbox.minTop)
    ) + MAP_PADDING * 2;
    return {
      left: bbox.minLeft - MAP_PADDING,
      top: bbox.minTop - MAP_PADDING,
      scale: size / span
    };
  }

  // The building the player is inside as a stable key, or null outdoors. The
  // scene's own `interior` wins over its region's, so a shop inside a keep
  // stays its own building.
  _interiorKeyOf(sceneId) {
    const scene = this.engine.data.scenes[sceneId];
    if (!isInteriorScene(scene, this.engine.data.regions)) return null;
    return scene.interior ? `scene:${sceneId}` : `region:${scene.region}`;
  }

  // A building's whole footprint, entered or not.
  _buildingPlacement(key) {
    const rooms = this._buildingRooms(key);

    return {
      key,
      def: this._enclosing(rooms),
      ...this._buildingFace(key, rooms),
      isCurrent: false
    };
  }

  // A grouped building takes its region's name and color; a one-room building
  // its room's.
  _buildingFace(key, rooms) {
    if (key.startsWith('region:')) {
      const region = this.engine.data.regions?.[key.slice('region:'.length)];
      return { label: region?.name || key, background: region?.mapBackground };
    }
    const room = rooms[0];
    return {
      label: room.name || room.title || key.slice('scene:'.length),
      background: room.mapDefinitions.background
    };
  }

  // `name` before `title`: the schema reserves `name` for map tags, so a room
  // need not repeat its building's name.
  _roomPlacement(id, scene, currentSceneId) {
    return {
      id,
      def: scene.mapDefinitions,
      label: scene.name || scene.title || id,
      background: scene.mapDefinitions.background,
      isCurrent: id === currentSceneId
    };
  }

  // Walked scenes plus the scenes of known regions, with geometry.
  _visitedMapScenes() {
    const visited = new Set(this.engine.state.getVisitedScenes());
    for (const id of this._knownSceneIds()) visited.add(id);
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  // A `known` region is known without being walked: their own house, not the
  // village. Map knowledge only; visited-state is untouched.
  _knownSceneIds() {
    const regions = this.engine.data.regions || {};
    return Object.entries(this.engine.data.scenes)
      .filter(([, scene]) => regions[scene?.region]?.known)
      .map(([id]) => id);
  }

  // The caller positions and sizes it.
  _buildMapNode(labelText, isCurrentScene, isBuilding = false) {
    const node = createElement('div', [
      CSS.MAP_NODE,
      isCurrentScene && CSS.MAP_NODE_CURRENT,
      isBuilding && CSS.MAP_NODE_BUILDING,
    ]);
    node.appendChild(createElement('span', CSS.MAP_NODE_LABEL, labelText));
    return node;
  }

  _computeBbox(defs) {
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    for (const def of defs) {
      const { left, top, width, height } = def;
      if (left < minLeft) minLeft = left;
      if (top < minTop) minTop = top;
      if (left + width > maxRight) maxRight = left + width;
      if (top + height > maxBottom) maxBottom = top + height;
    }
    return { minLeft, minTop, maxRight, maxBottom };
  }

  // Authored coordinates, unscaled.
  _renderSceneNodes(canvasEl, placements) {
    canvasEl.replaceChildren();
    for (const { def, label, background, isCurrent, isBuilding } of placements) {
      const node = this._buildMapNode(label, isCurrent, isBuilding);
      Object.assign(node.style, {
        top: def.top + 'px',
        left: def.left + 'px',
        width: def.width + 'px',
        height: def.height + 'px',
        background: background || MAP_NODE_DEFAULT_BG
      });

      canvasEl.appendChild(node);
    }
  }
}
