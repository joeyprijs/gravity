import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapManager } from '../src/world/map.js';

// Map knowledge from `known` regions: places the player knows without walking
// them. The reveal is derived from static data, so these guard the invariant
// at the two seams every map view reads through — _outdoorKnowledge and
// _visitedMapScenes.

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
