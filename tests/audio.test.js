import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem, resolveAmbience } from '../src/systems/audio.js';

// resolveAmbience: scene override → region fallback → silence

const REGIONS = {
  dungeon: { name: 'The Dungeon', ambience: 'audio/dungeon.wav' },
  player_home: { name: 'Player Home' },
};

test('resolveAmbience falls back to the region ambience', () => {
  assert.equal(resolveAmbience({ region: 'dungeon' }, REGIONS), 'audio/dungeon.wav');
});

test('resolveAmbience prefers the scene-level override', () => {
  const scene = { region: 'dungeon', ambience: 'audio/hillside.wav' };
  assert.equal(resolveAmbience(scene, REGIONS), 'audio/hillside.wav');
});

test('resolveAmbience treats an explicit null as silence, overriding the region', () => {
  assert.equal(resolveAmbience({ region: 'dungeon', ambience: null }, REGIONS), null);
});

test('resolveAmbience is silent when neither scene nor region declares audio', () => {
  assert.equal(resolveAmbience({ region: 'player_home' }, REGIONS), null);
  assert.equal(resolveAmbience({ region: 'nowhere' }, REGIONS), null);
});

// AudioSystem: headless (pre-unlock / no Web Audio) behavior

const makeAudio = () => new AudioSystem({ data: { regions: REGIONS } });

test('syncAmbience before unlock records the target loop without playing', () => {
  const audio = makeAudio();
  audio.syncAmbience({ region: 'dungeon' });
  assert.equal(audio._ambiencePath, 'audio/dungeon.wav');
  assert.equal(audio._ambienceNodes, null);
});
