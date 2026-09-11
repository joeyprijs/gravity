import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapManager } from '../src/world/map.js';
import { sharedEdgeMidpoint } from '../src/core/utils.js';

// Map knowledge that is derived from static data rather than walked: `known`
// regions, and the one step of sight out through a walked room's door. These
// guard the invariant at the seams every map view reads through —
// _outdoorKnowledge, _visitedMapScenes and _minimapPlacements.

const DEF = { top: 0, left: 0, width: 10, height: 10 };

function makeEngine({ scenes, regions, visited = [] }) {
  return {
    data: { scenes, regions },
    state: { getVisitedScenes: () => visited },
  };
}

test('a known interior region shows as a building before any visit, and its rooms count as walked', () => {
  const map = new MapManager(makeEngine({
    regions: { home: { name: 'Your House', interior: true, known: true } },
    scenes: {
      home_hall: { region: 'home', mapDefinitions: DEF },
      home_kitchen: { region: 'home', mapDefinitions: DEF },
    },
  }));

  const { rooms, buildings } = map._outdoorKnowledge();
  assert.deepEqual([...buildings], ['region:home']);
  assert.deepEqual([...rooms], []);

  assert.deepEqual(
    map._visitedMapScenes().map(({ id }) => id).sort(),
    ['home_hall', 'home_kitchen']
  );
});

test('a known region reveals only its own scenes — no sight spreads from them', () => {
  const map = new MapManager(makeEngine({
    regions: { yard: { name: 'The Yard', known: true }, village: { name: 'Village' } },
    scenes: {
      yard: {
        region: 'yard',
        mapDefinitions: DEF,
        options: [{ actions: [{ type: 'navigate', destination: 'lane' }] }],
      },
      lane: { region: 'village', mapDefinitions: DEF },
    },
  }));

  // Known but unvisited: the yard is on the map, the lane off it is not.
  assert.deepEqual([...map._outdoorKnowledge().rooms], ['yard']);

  // Once actually walked, sight spreads from it as from any visited scene.
  map.engine.state.getVisitedScenes = () => ['yard'];
  assert.deepEqual([...map._outdoorKnowledge().rooms].sort(), ['lane', 'yard']);
});

test('inside a building, the minimap draws the ground outside a walked room\'s door', () => {
  const map = new MapManager(makeEngine({
    regions: { home: { name: 'Your House', interior: true }, village: { name: 'Village' } },
    scenes: {
      home_hall: {
        region: 'home',
        mapDefinitions: DEF,
        options: [{ actions: [{ type: 'navigate', destination: 'hill_path' }] }],
      },
      home_kitchen: {
        region: 'home',
        mapDefinitions: DEF,
        options: [{ actions: [{ type: 'navigate', destination: 'back_lane' }] }],
      },
      hill_path: { region: 'village', mapDefinitions: DEF },
      back_lane: { region: 'village', mapDefinitions: DEF },
    },
    visited: ['home_hall'],
  }));

  // The door stood inside of reveals the path, and only that path: the
  // kitchen's back door has not been walked to, so the lane stays unknown.
  assert.deepEqual([...map._outdoorKnowledge().rooms], ['hill_path']);

  // The ground comes first so the rooms paint over it; the room is current.
  assert.deepEqual(
    map._minimapPlacements('home_hall').map(({ id, isCurrent }) => ({ id, isCurrent })),
    [{ id: 'hill_path', isCurrent: false }, { id: 'home_hall', isCurrent: true }]
  );
});

// Doorways are derived, never authored: a navigate between two touching boxes.
// These pin the rule at its edges — which passages count, where the mark
// lands, and that a building's door lands on its square from outside.

const nav = (...destinations) => destinations.map(d => ({ actions: [{ type: 'navigate', destination: d }] }));

test('sharedEdgeMidpoint: the middle of the shared wall, and nothing for a corner or a gap', () => {
  const lane = { top: 2450, left: 2470, width: 90, height: 140 };
  const cottage = { top: 2450, left: 2560, width: 150, height: 100 };
  const across = { top: 2590, left: 2560, width: 50, height: 50 };
  const apart = { top: 2450, left: 2600, width: 50, height: 50 };

  assert.deepEqual(sharedEdgeMidpoint(lane, cottage), { x: 2560, y: 2500, vertical: true });
  assert.deepEqual(sharedEdgeMidpoint(cottage, lane), { x: 2560, y: 2500, vertical: true });
  assert.equal(sharedEdgeMidpoint(lane, across), null, 'corner to corner is no wall');
  assert.equal(sharedEdgeMidpoint(lane, apart), null);
});

test('outdoors, a cottage gets its door on the lane it opens onto, not on the square it backs onto', () => {
  // Hollowbrook's shape: the square, Sowers Lane running south off it, and
  // Taper Cottage in the angle between them with its door on the lane.
  const map = new MapManager(makeEngine({
    regions: { village: { name: 'Village' } },
    scenes: {
      square: {
        region: 'village',
        mapDefinitions: { top: 2270, left: 2320, width: 440, height: 180 },
        options: nav('lane'),
      },
      lane: {
        region: 'village',
        mapDefinitions: { top: 2450, left: 2470, width: 90, height: 140 },
        options: nav('square', 'taper'),
      },
      taper: {
        interior: true,
        region: 'village',
        mapDefinitions: { top: 2450, left: 2560, width: 150, height: 100 },
        options: nav('lane'),
      },
    },
    visited: ['square', 'lane'],
  }));

  const placements = map._minimapPlacements('lane');
  assert.deepEqual(
    map._minimapDoors(placements),
    [{ x: 2560, y: 2500, vertical: true }],
    'one door for the two-way passage, on the lane wall; square to lane is an open edge'
  );
});

test('two touching cottages with no passage between them share no door', () => {
  const map = new MapManager(makeEngine({
    regions: { village: { name: 'Village' } },
    scenes: {
      lane: {
        region: 'village',
        mapDefinitions: { top: 2310, left: 2760, width: 300, height: 100 },
        options: nav('smithy', 'fenwick'),
      },
      smithy: { interior: true, region: 'village', mapDefinitions: { top: 2230, left: 2760, width: 150, height: 80 }, options: nav('lane') },
      fenwick: { interior: true, region: 'village', mapDefinitions: { top: 2230, left: 2910, width: 150, height: 80 }, options: nav('lane') },
    },
    visited: ['lane'],
  }));

  const doors = map._minimapDoors(map._minimapPlacements('lane')).sort((a, b) => a.x - b.x);
  assert.deepEqual(doors, [
    { x: 2835, y: 2310, vertical: false },
    { x: 2985, y: 2310, vertical: false },
  ]);
});

test('a grouped building takes its door on the square it is drawn as, from outside', () => {
  // Frey's Store: two rooms folded into one square outdoors. The square's
  // navigate into the front room lands on the building's outer wall.
  const map = new MapManager(makeEngine({
    regions: { village: { name: 'Village' }, store: { name: 'Store', interior: true } },
    scenes: {
      square: {
        region: 'village',
        mapDefinitions: { top: 2270, left: 2320, width: 440, height: 180 },
        options: nav('store_front'),
      },
      store_front: { region: 'store', mapDefinitions: { top: 2190, left: 2320, width: 195, height: 80 }, options: nav('square', 'store_back') },
      store_back: { region: 'store', mapDefinitions: { top: 2140, left: 2320, width: 195, height: 50 }, options: nav('store_front') },
    },
    visited: ['square'],
  }));

  const placements = map._minimapPlacements('square');
  assert.ok(placements.some(p => p.key === 'region:store'), 'the store is one square');
  assert.deepEqual(map._minimapDoors(placements), [{ x: 2417.5, y: 2270, vertical: false }]);

  // Inside, the rooms are their own boxes: the door between them, and the
  // one out to the ground the front room opens onto.
  map.engine.state.getVisitedScenes = () => ['square', 'store_front', 'store_back'];
  const inside = map._minimapDoors(map._minimapPlacements('store_front')).sort((a, b) => a.y - b.y);
  assert.deepEqual(inside, [
    { x: 2417.5, y: 2190, vertical: false },
    { x: 2417.5, y: 2270, vertical: false },
  ]);
});
