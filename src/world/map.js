import { clearElement, isInteriorScene } from '../core/utils.js';
import { MINIMAP_SIZE, MAP_PADDING, MAP_NODE_DEFAULT_BG, CSS, EL } from '../core/config.js';

// Every scene a scene can send the player to: the destinations of the navigate
// actions in its *options*. This is the map's notion of a door, and what one
// step of sight is measured along.
//
// Options only, deliberately: an option is a door the player can see standing
// here, whatever its condition currently says. Where a skill check navigates,
// the destination is the *reward* for passing it — walking those pipelines
// would draw the secret on the map before it was discovered. `onVictory`
// stays in: the road past a fight is a road, and the option offering the
// fight is right there.
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

// MapManager owns both the minimap HUD in the sidebar and the full-screen world
// map overlay.
//
// The two answer different questions from one body of knowledge
// (_outdoorKnowledge), so they can never disagree about what exists; what
// differs is projection and detail. The minimap is "where am I" — inside a
// building, that building's rooms; outdoors, a viewport centered on the player.
// The full map is "where is everything" — the same places at their authored
// coordinates, collapsing only the buildings never entered.
export class MapManager {
  constructor(engine) {
    this.engine = engine;

    // Cached scene ID to skip rebuilding coordinates if the player hasn't moved.
    // Initialized to null to guarantee a render on the first boot update.
    // The scene ID is a sufficient cache key by design: mapDefinitions are
    // static data, and newly visited scenes always come with a scene change.
    // Anything that changes map appearance without moving the player must
    // call invalidateMinimap() first (as the map tab switch in ui.js does).
    this._minimapCacheKey = null;

    // The shared hover tooltip for minimap boxes, created on first use.
    this._tooltipEl = null;
  }

  /**
   * Wires the open/close triggers for the full-screen map overlay (minimap
   * click, close button, ESC, backdrop click).
   */
  setup() {
    const minimapEl = document.getElementById(EL.MINIMAP);
    minimapEl.addEventListener('click', () => this.openFullMap());

    // Instant hover names: the native title tooltip sits behind the browser's
    // ~1s hover delay, so a custom element carries the label instead. Delegated
    // to the minimap container because the canvas is rebuilt on every move.
    minimapEl.addEventListener('mousemove', (e) => this._moveMapTooltip(e));
    minimapEl.addEventListener('mouseleave', () => this._hideMapTooltip());
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

    const currentSceneId = this.engine.state.getCurrentSceneId();

    // Only rebuild the DOM when the player moves (see the cache-key note in
    // the constructor).
    if (currentSceneId === this._minimapCacheKey) return;

    const placements = this._minimapPlacements(currentSceneId);

    // Deliberately WITHOUT caching the key. Drawing nothing is a transient
    // state, not a settled one: state.init() seeds currentSceneId from
    // rules.startingScene before that scene has been visited, so the first
    // render finds nothing to draw while the id is already its final value.
    // Caching here would mark the starting scene as "already drawn" and the
    // minimap would stay hidden for the whole of it — the scene id is only a
    // sufficient key once there is something on the map.
    if (placements.length === 0) {
      minimapEl.hidden = true;
      return;
    }

    // Unhide before measuring: a [hidden] element has no offsetWidth, so the
    // very first render (boot, or a save loaded from the character screen)
    // would fall back to MINIMAP_SIZE and project everything for the wrong
    // square — then cache it. The fallback still covers the panel itself
    // being hidden (inactive map tab), which the tab switch re-renders.
    minimapEl.hidden = false;
    const size = minimapEl.offsetWidth || MINIMAP_SIZE;
    const view = this._minimapView(currentSceneId, placements, size);

    // Safari layout bug prevention: Rebuilding the canvas wrapper and swapping it
    // into the DOM via replaceWith() forces the browser engine to completely flush
    // its compositor layers cache, preventing rendering glitches during fast moves.
    const fresh = document.createElement('div');
    fresh.id = EL.MINIMAP_CANVAS;
    fresh.className = CSS.MINIMAP_CANVAS;

    for (const { def, label, background, isCurrent } of placements) {
      const node = this._buildMapNode(label, isCurrent);
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

    const currentSceneId = this.engine.state.getCurrentSceneId();
    const { width, height } = this.engine.data.worldMapSize;

    if (titleEl) titleEl.textContent = this.engine.t('ui.worldMapTitle');
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;

    this._renderSceneNodes(canvasEl, this._fullMapPlacements(currentSceneId));
    this._hideMapTooltip();
    overlay.hidden = false;

    // Center the scroll viewport on the player's scene. requestAnimationFrame
    // so the overlay has laid out before clientWidth/Height are measured.
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

  /** Hides the full-screen world map overlay. */
  closeFullMap() {
    document.getElementById(EL.FULLMAP_OVERLAY).hidden = true;
  }

  // Shows the hovered box's name at the cursor, or hides it between boxes.
  // The name is already built into the node and hidden at this scale, so the
  // tooltip reads it back out. Unlabeled boxes you can name by pointing at them.
  _moveMapTooltip(e) {
    const node = e.target.closest(`.${CSS.MAP_NODE}`);
    const label = node?.querySelector(`.${CSS.MAP_NODE_LABEL}`)?.textContent;
    if (!label) {
      this._hideMapTooltip();
      return;
    }

    if (!this._tooltipEl) {
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.className = CSS.MAP_TOOLTIP;
      document.body.appendChild(this._tooltipEl);
    }
    this._tooltipEl.textContent = label;
    this._tooltipEl.style.left = `${e.clientX + 12}px`;
    this._tooltipEl.style.top = `${e.clientY + 16}px`;
    this._tooltipEl.hidden = false;
  }

  _hideMapTooltip() {
    if (this._tooltipEl) this._tooltipEl.hidden = true;
  }

  /**
   * Forces a full minimap redraw on the next renderMinimap call — for changes
   * that alter the map without moving the player (see the cache-key note above).
   */
  invalidateMinimap() {
    this._minimapCacheKey = null;
  }

  // What the minimap draws, as { def, label, background, isCurrent } boxes.
  //
  // Inside a building, only that building's visited rooms: what a player wants
  // from the map in Frey's Store is the store, and a house reveals itself room
  // by room as you walk it. Outdoors is the open world instead — one continuous
  // map of everywhere the player knows about, no matter which region it belongs
  // to, with each building on it drawn as the single square it occupies.
  _minimapPlacements(currentSceneId) {
    const inside = this._interiorKeyOf(currentSceneId);
    if (inside) {
      return this._visitedMapScenes()
        .filter(({ id }) => this._interiorKeyOf(id) === inside)
        .map(({ id, scene }) => this._roomPlacement(id, scene, currentSceneId));
    }

    const scenes = this.engine.data.scenes;
    const known = this._outdoorKnowledge();
    const rooms = [...known.rooms]
      .filter(id => scenes[id]?.mapDefinitions)
      .map(id => this._roomPlacement(id, scenes[id], currentSceneId));
    const buildings = [...known.buildings].map(key => this._buildingPlacement(key));

    // Buildings first so the rooms paint over them: a building's square is a
    // bounding box, so it covers ground its rooms don't fill, and the world the
    // player is standing in must never end up underneath it.
    return [...buildings, ...rooms];
  }

  // What the full map draws: everywhere the player knows of, in as much detail
  // as they know it. Outdoors follows the same reveal as the minimap. A building
  // they have been inside shows the rooms they walked, at their real coordinates;
  // one they have only seen from the road shows as its footprint, because a shape
  // in the landscape is all they know of it yet.
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

    // Footprints first, so a building's box never covers the road it stands on.
    // Outlines last: they draw no fill, and their names sit above the building,
    // which for a building backing onto something else is over its neighbor —
    // readable only if nothing paints after them.
    return [
      ...[...buildings].filter(key => !walked.has(key)).map(key => this._buildingPlacement(key)),
      ...[...rooms].filter(id => scenes[id]?.mapDefinitions)
        .map(id => this._roomPlacement(id, scenes[id], currentSceneId)),
      ...insideRooms,
      // Only where there is something to group: a building drawn as a single
      // room is already named by that room, and an outline would just say it
      // twice.
      ...[...walked].filter(([, rooms]) => rooms.length > 1)
        .map(([key, rooms]) => this._buildingOutline(key, rooms))
    ];
  }

  // A building the player has been inside, drawn around the rooms they walked:
  // an outline with the building's name above it. Rooms tile their building
  // exactly, so without this a house reads as loose boxes that nothing names.
  //
  // Bounded by the rooms *walked*, not the whole footprint: a half-explored
  // dungeon must not have its extent drawn before it is earned.
  _buildingOutline(key, rooms) {
    return {
      def: this._enclosing(rooms),
      label: this._buildingFace(key, rooms).label,
      background: 'transparent',
      isCurrent: false,
      isBuilding: true
    };
  }

  // The box enclosing a set of rooms, in the shape the renderers position.
  _enclosing(rooms) {
    const bbox = this._computeBbox(rooms.map(room => room.mapDefinitions));
    return {
      top: bbox.minTop,
      left: bbox.minLeft,
      width: bbox.maxRight - bbox.minLeft,
      height: bbox.maxBottom - bbox.minTop
    };
  }

  // Everywhere outdoors the player knows of: what they have walked, plus one
  // step of sight from it — the roads leading off the places they have stood,
  // and the buildings whose doors they have stood at. Nothing is ever entered
  // off a map it wasn't already on.
  //
  // Sight stops at that one step: you can see the lane leaving the square, not
  // what stands along it. Indoors has no equivalent — a building's rooms are
  // revealed by walking them, which is what makes exploring one feel like
  // exploring.
  _outdoorKnowledge() {
    const scenes = this.engine.data.scenes;
    const rooms = new Set();
    const buildings = new Set();

    for (const id of this.engine.state.getVisitedScenes()) {
      if (!scenes[id] || this._interiorKeyOf(id)) continue;
      rooms.add(id);
      for (const dest of sceneNavigationTargets(scenes[id])) {
        const key = this._interiorKeyOf(dest);
        if (key) buildings.add(key);
        else if (scenes[dest]) rooms.add(dest);
      }
    }

    // A building is drawn from its rooms' geometry, so one whose rooms carry no
    // mapDefinitions has no square to occupy. Dropping it here rather than
    // downstream keeps "known" meaning "drawable", so neither view has to think
    // about a building it cannot place. validate.js says so at boot.
    return {
      rooms,
      buildings: new Set([...buildings].filter(key => this._buildingRooms(key).length))
    };
  }

  // The rooms of one building that carry map geometry, as scene definitions.
  _buildingRooms(key) {
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => scene?.mapDefinitions && this._interiorKeyOf(id) === key)
      .map(([, scene]) => scene);
  }

  // How world coordinates land in the HUD square. Outdoors the minimap is a
  // viewport — a fixed span of world centered on the player, so walking scrolls
  // the map rather than zooming it out. A world that keeps growing must not keep
  // shrinking what you can read of it. Without a configured span, or inside a
  // building, the frame is the extent of what's drawn: a building is bounded and
  // small, so there is nothing to scroll.
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

  // The building the player is inside, as a stable key, or null out in the open.
  // A one-room building marks itself (`interior` on the scene); the rooms of a
  // bigger one are grouped by a region flagged `interior`, which is also where
  // that building gets the single name and color its square is drawn with. The
  // scene's own marking wins, so a shop with its own map inside a keep stays
  // its own map.
  _interiorKeyOf(sceneId) {
    const scene = this.engine.data.scenes[sceneId];
    if (!isInteriorScene(scene, this.engine.data.regions)) return null;
    return scene.interior ? `scene:${sceneId}` : `region:${scene.region}`;
  }

  // One building as one square: its whole footprint, whether or not the player
  // has been inside. A building seen from the road is a shape in the landscape,
  // so its square is the ground it stands on — it doesn't grow as its owner
  // wanders around indoors.
  _buildingPlacement(key) {
    const rooms = this._buildingRooms(key);

    return {
      def: this._enclosing(rooms),
      ...this._buildingFace(key, rooms),
      isCurrent: false
    };
  }

  // The name and color a building's square is drawn with: a region's own for a
  // grouped building, the room's own for a building that is one room.
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

  // One drawn room, in the shape renderMinimap positions. Tagged with `name`
  // ahead of `title`: the schema reserves `title` for the header a player reads
  // on arrival and `name` for map tags, which is what lets a room inside a
  // building avoid repeating the building's own name on the map.
  _roomPlacement(id, scene, currentSceneId) {
    return {
      def: scene.mapDefinitions,
      label: scene.name || scene.title || id,
      background: scene.mapDefinitions.background,
      isCurrent: id === currentSceneId
    };
  }

  // Every visited scene that has mapDefinitions, as { id, scene } pairs.
  _visitedMapScenes() {
    const visited = new Set(this.engine.state.getVisitedScenes());
    return Object.entries(this.engine.data.scenes)
      .filter(([id, scene]) => visited.has(id) && scene.mapDefinitions)
      .map(([id, scene]) => ({ id, scene }));
  }

  // Builds one labeled map-node element. The caller positions and sizes it —
  // the minimap scales coordinates, the full map uses them as authored.
  _buildMapNode(labelText, isCurrentScene, isBuilding = false) {
    const node = document.createElement('div');
    node.className = CSS.MAP_NODE;
    if (isCurrentScene) node.classList.add(CSS.MAP_NODE_CURRENT);
    if (isBuilding) node.classList.add(CSS.MAP_NODE_BUILDING);

    const label = document.createElement('span');
    label.className = CSS.MAP_NODE_LABEL;
    label.textContent = labelText;
    node.appendChild(label);

    return node;
  }

  // The bounding box enclosing the given geometry — what the minimap scales to
  // fit its square, and what collapses a region into one node.
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

  // Fills the full-map canvas: one node per placement at its authored
  // coordinates, unscaled.
  _renderSceneNodes(canvasEl, placements) {
    clearElement(canvasEl);
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
