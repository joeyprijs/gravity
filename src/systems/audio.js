// AudioSystem — the engine's ambience layer: a looping background bed
// resolved per scene. A scene's own `ambience` overrides its region's; an
// explicit null silences the scene. Re-syncing to the same path is a no-op, so
// walking between rooms of one region never restarts the loop.
//
// Everything is opt-in via game data — a game that authors no audio fields
// never fetches or decodes a single byte of audio. Browsers block audio until
// a user gesture, so the AudioContext is created on the first
// pointerdown/keydown (data or not); paths resolved before that are
// remembered and started at unlock. Web Audio (not
// <audio loop>) because buffer sources loop gaplessly. Safari caveats:
// callback-form decodeAudioData, no connect() chaining.

const SETTINGS_KEY = 'gravity.audio';
// 1 is the ceiling: the file's own level, unaltered.
const DEFAULT_SETTINGS = { muted: false, ambienceVolume: 1 };

// Seconds an ambience loop takes to fade in/out when the location changes.
export const AMBIENCE_FADE = 1.5;

// Resolves the ambience loop path for a scene against the manifest's regions
// map: the scene's own `ambience` field wins (null meaning "explicitly
// silent"), else the region's, else null.
export function resolveAmbience(scene, regions) {
  if ('ambience' in scene) return scene.ambience ?? null;
  return regions?.[scene.region]?.ambience ?? null;
}

export class AudioSystem {
  constructor(engine) {
    this.engine = engine;
    this.settings = this._loadSettings();

    // Created at unlock; null means "not unlocked yet" everywhere below.
    this._ctx = null;
    this._masterGain = null;
    this._channelGain = { ambience: null };

    // path → Promise<AudioBuffer|null>. Failed loads cache null so a missing
    // file warns once instead of re-fetching on every scene entry.
    this._buffers = new Map();

    // The resolved target loop (what SHOULD be playing) vs the playing one.
    this._ambiencePath = null;
    this._ambienceNodes = null; // { source, gain, path }

    this._bindUnlock();
  }

  // Syncs the ambience channel to a scene. Called on every scene render and
  // on save restore; a no-op when the resolved loop is already the target.
  syncAmbience(scene) {
    const path = resolveAmbience(scene, this.engine.data.regions);
    if (path === this._ambiencePath) return;
    this._ambiencePath = path;
    if (!this._ctx) return; // started at unlock
    this._fadeOutAmbience();
    if (path) this._startAmbience(path);
  }

  // Persisted as a device preference (localStorage), not game state.
  setMuted(muted) {
    this.settings.muted = muted;
    this._saveSettings();
    this._applySettings();
  }

  // Sets a channel's volume (0..1). Persisted like setMuted.
  setVolume(channel, value) {
    this.settings[`${channel}Volume`] = value;
    this._saveSettings();
    this._applySettings();
  }

  // Unlock & node graph

  _bindUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      this._unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  _unlock() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this._ctx = new Ctx();
    if (this._ctx.state === 'suspended') this._ctx.resume();

    // source → (per-loop fade gain) → channel gain → master gain → speakers.
    // Separate connect() statements: Safari's connect() returns undefined.
    this._masterGain = this._ctx.createGain();
    this._masterGain.connect(this._ctx.destination);
    for (const channel of Object.keys(this._channelGain)) {
      const gain = this._ctx.createGain();
      gain.connect(this._masterGain);
      this._channelGain[channel] = gain;
    }
    this._applySettings();

    if (this._ambiencePath) this._startAmbience(this._ambiencePath);
  }

  _applySettings() {
    if (!this._ctx) return; // re-applied at unlock
    this._masterGain.gain.value = this.settings.muted ? 0 : 1;
    this._channelGain.ambience.gain.value = this.settings.ambienceVolume;
  }

  // Playback internals

  _startAmbience(path) {
    this._getBuffer(path).then(buffer => {
      // The target may have changed again while the buffer loaded.
      if (!buffer || this._ambiencePath !== path || this._ambienceNodes?.path === path) return;
      const source = this._ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this._ctx.createGain();
      const now = this._ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + AMBIENCE_FADE);
      source.connect(gain);
      gain.connect(this._channelGain.ambience);
      source.start();
      this._ambienceNodes = { source, gain, path };
    });
  }

  _fadeOutAmbience() {
    const nodes = this._ambienceNodes;
    if (!nodes) return;
    this._ambienceNodes = null;
    const now = this._ctx.currentTime;
    nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
    nodes.gain.gain.linearRampToValueAtTime(0, now + AMBIENCE_FADE);
    nodes.source.onended = () => {
      nodes.source.disconnect();
      nodes.gain.disconnect();
    };
    nodes.source.stop(now + AMBIENCE_FADE + 0.05);
  }

  _getBuffer(path) {
    if (!this._buffers.has(path)) {
      const promise = fetch(path)
        .catch(err => {
          // A failed FETCH (offline, flaky network) is transient — drop the
          // cache entry so a later scene entry retries, instead of the clip
          // staying silent for the whole session. A missing file (HTTP error)
          // or an undecodable one keeps its cached null: warn once, not per entry.
          this._buffers.delete(path);
          throw err;
        })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        // Callback form: Safari's decodeAudioData predates the promise form.
        .then(data => new Promise((resolve, reject) => this._ctx.decodeAudioData(data, resolve, reject)))
        .catch(err => {
          console.warn(`[Gravity] audio: failed to load "${path}" —`, err);
          return null;
        });
      this._buffers.set(path, promise);
    }
    return this._buffers.get(path);
  }

  // Settings persistence

  _loadSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch { /* corrupted or unavailable storage — fall back to defaults */ }
    return { ...DEFAULT_SETTINGS };
  }

  _saveSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      }
    } catch { /* storage full/blocked — settings just won't persist */ }
  }
}
