// Shared fixtures for the Node suite. Each test file still builds its own
// engine mock — their shapes differ per system — but the rules every file
// feeds gameState.init() share one base.

export const SLOTS = [
  { id: 'head', kind: 'head' },
  { id: 'body', kind: 'body' },
  { id: 'left_hand', kind: 'hand' },
  { id: 'right_hand', kind: 'hand' },
  { id: 'left_ring', kind: 'ring' },
  { id: 'right_ring', kind: 'ring' },
];

// Minimal rules for gameState.init(), mirroring rules.json's key values.
// Top-level overrides win; playerDefaults merges one level deep, so a caller
// that changes `attributes` or `resources` spells out the whole object.
export function makeRules({ playerDefaults = {}, ...rest } = {}) {
  return {
    playerDefaults: {
      name: '',
      level: 1,
      xp: 0,
      resources: { hp: { current: 10, max: 10 }, ap: { current: 3, max: 3 }, gold: 0 },
      attributes: { ac: 10, initiative: 0 },
      inventory: [],
      ...playerDefaults,
    },
    customAttributes: [],
    startingScene: null,
    xpPerLevel: 100,
    levelUpHpBonus: 5,
    ...rest,
  };
}

// A t() that echoes its key and params, so log assertions can match both.
export const paramEchoT = (key, params) => params ? `${key}:${JSON.stringify(params)}` : key;

// Minimal DOM stand-in — just enough for createElement/buildOptionButton to
// run headless. Elements are only built by the code under test, never queried.
export const fakeEl = () => ({
  classList: { add() {} },
  children: [],
  appendChild(child) { this.children.push(child); return child; },
  setAttribute() {},
  removeAttribute() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});
