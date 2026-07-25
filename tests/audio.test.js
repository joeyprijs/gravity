import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem, resolveAmbience, AMBIENCE_FADE } from '../src/systems/audio.js';
import { SceneRenderer } from '../src/systems/scene.js';

// ── resolveAmbience: scene override → region fallback → silence ────────────

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

// ── AudioSystem: headless (pre-unlock / no Web Audio) behavior ─────────────

const makeAudio = () => new AudioSystem({ data: { regions: REGIONS } });

test('AudioSystem constructs headless with default settings', () => {
  const audio = makeAudio();
  assert.deepEqual(audio.settings, { muted: false, ambienceVolume: 1, narrationVolume: 0.25 });
});

test('syncAmbience before unlock records the target loop without playing', () => {
  const audio = makeAudio();
  audio.syncAmbience({ region: 'dungeon' });
  assert.equal(audio._ambiencePath, 'audio/dungeon.wav');
  assert.equal(audio._ambienceNodes, null);
});

test('playNarration before unlock stores the clip as pending', () => {
  const audio = makeAudio();
  audio.playNarration('audio/intro.wav');
  assert.equal(audio._pendingNarration, 'audio/intro.wav');
  // A null (scene without narration) clears the pending clip again.
  audio.playNarration(null);
  assert.equal(audio._pendingNarration, null);
});

// ── Narration waits out the ambience fade ──────────────────────────────────

// The delay is computed on the AudioContext clock, so a stub clock and a
// pre-primed buffer cache are enough to exercise it without Web Audio.
const makeTimedAudio = ({ now, ambiencePath, startedAt, buffer = {} }) => {
  const audio = makeAudio();
  audio._ctx = { currentTime: now };
  audio._ambiencePath = ambiencePath;
  if (ambiencePath) audio._buffers.set(ambiencePath, Promise.resolve(buffer));
  if (startedAt !== undefined) audio._ambienceNodes = { path: ambiencePath, startedAt };
  return audio;
};

test('narration waits for a bed that just started to finish fading in', async () => {
  const audio = makeTimedAudio({ now: 10, ambiencePath: 'audio/dungeon.wav', startedAt: 10 });
  assert.equal(await audio._narrationStartTime(), 10 + AMBIENCE_FADE);
});

test('narration starts at once over a bed that faded in long ago', async () => {
  // Another room of the same region: the loop never restarted, so its fade is
  // far in the past and the returned time is already behind the clock.
  const audio = makeTimedAudio({ now: 60, ambiencePath: 'audio/dungeon.wav', startedAt: 3 });
  assert.ok(await audio._narrationStartTime() < 60, 'a settled bed imposes no wait');
});

test('narration waits for nothing in a silent scene', async () => {
  const audio = makeTimedAudio({ now: 10, ambiencePath: null });
  assert.equal(await audio._narrationStartTime(), 10);
});

test('narration waits for nothing when the bed failed to load', async () => {
  const audio = makeTimedAudio({ now: 10, ambiencePath: 'audio/missing.wav', buffer: null });
  assert.equal(await audio._narrationStartTime(), 10);
});

test('narration waits for a bed that is still decoding, not just its fade', async () => {
  // A multi-megabyte loop can resolve after a short clip does. The wait is
  // measured from when the bed actually starts, not from the request.
  const audio = makeTimedAudio({ now: 10, ambiencePath: 'audio/dungeon.wav' });
  let resolveBuffer;
  audio._buffers.set('audio/dungeon.wav', new Promise(r => { resolveBuffer = r; }));
  const pending = audio._narrationStartTime();
  audio._ctx.currentTime = 14;                                   // 4s of decoding
  audio._ambienceNodes = { path: 'audio/dungeon.wav', startedAt: 14 };
  resolveBuffer({});
  assert.equal(await pending, 14 + AMBIENCE_FADE);
});

test('setMuted and setVolume update settings headless', () => {
  const audio = makeAudio();
  audio.setMuted(true);
  audio.setVolume('ambience', 0.25);
  assert.equal(audio.settings.muted, true);
  assert.equal(audio.settings.ambienceVolume, 0.25);
});

// ── SceneRenderer narration resolution ─────────────────────────────────────

// _resolveNarration only touches engine.state through evaluateCondition.
const makeRenderer = (flags = {}) =>
  new SceneRenderer({ state: { getFlag: (key) => flags[key] ?? false } });

test('_resolveNarration reads the scene-level field for string descriptions', () => {
  const renderer = makeRenderer();
  const scene = { description: 'A quiet room.', narration: 'audio/room.wav' };
  assert.equal(renderer._resolveNarration(scene), 'audio/room.wav');
  assert.equal(renderer._resolveNarration({ description: 'Silent.' }), null);
});

test('_resolveNarration picks the resolved description variant', () => {
  const scene = {
    description: [
      { text: 'Door open.', condition: { flag: 'door_unlocked', value: true } },
      { text: 'You awake.', narration: 'audio/awake.wav' },
    ],
  };
  assert.equal(makeRenderer()._resolveNarration(scene), 'audio/awake.wav');
  // Once the flag flips, the matched variant has no narration — and the
  // fallback variant's clip must NOT leak through.
  assert.equal(makeRenderer({ door_unlocked: true })._resolveNarration(scene), null);
});

test('_resolveNarration falls back to scene-level narration for a variant without one', () => {
  const scene = {
    narration: 'audio/default.wav',
    description: [
      { text: 'Door open.', condition: { flag: 'door_unlocked', value: true } },
      { text: 'You awake.', narration: 'audio/awake.wav' },
    ],
  };
  assert.equal(makeRenderer({ door_unlocked: true })._resolveNarration(scene), 'audio/default.wav');
});
