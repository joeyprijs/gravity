// The ambience layer: one looping bed per scene, the scene's own `ambience`
// over its region's, null for silence. Browsers block audio until a gesture,
// so the AudioContext is created on the first pointerdown/keydown and the
// pending path starts then. Web Audio, because buffer sources loop gaplessly.

const SETTINGS_KEY = 'gravity.audio';
const DEFAULT_SETTINGS = { muted: false, ambienceVolume: 1 };

// Fade seconds when the location changes.
export const AMBIENCE_FADE = 1.5;

// The scene's own `ambience` (null: silent) wins over its region's.
export function resolveAmbience(scene, regions) {
  if ('ambience' in scene) return scene.ambience ?? null;
  return regions?.[scene.region]?.ambience ?? null;
}

export class AudioSystem {
  constructor(engine) {
    this.engine = engine;
    this.settings = this._loadSettings();

    // Null until unlock.
    this._ctx = null;
    this._masterGain = null;
    this._channelGain = { ambience: null };

    // path → Promise<AudioBuffer|null>; a missing file caches null and warns once.
    this._buffers = new Map();

    // What should be playing, and what is.
    this._ambiencePath = null;
    this._ambienceNodes = null; // { source, gain, path }

    this._bindUnlock();
  }

  // On every scene render; a no-op while the loop is unchanged.
  syncAmbience(scene) {
    const path = resolveAmbience(scene, this.engine.data.regions);
    if (path === this._ambiencePath) return;
    this._ambiencePath = path;
    if (!this._ctx) return; // started at unlock
    this._fadeOutAmbience();
    if (path) this._startAmbience(path);
  }

  // A device preference (localStorage), not game state.
  setMuted(muted) {
    this.settings.muted = muted;
    this._saveSettings();
    this._applySettings();
  }

  // 0..1, persisted like setMuted.
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

    // source → fade gain → channel gain → master gain. Separate connect()
    // calls: Safari's returns undefined.
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
      // The target may have moved on while the buffer loaded.
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
          // A failed fetch is transient, so a later entry retries; a missing
          // or undecodable file keeps its cached null.
          this._buffers.delete(path);
          throw err;
        })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        // Callback form: Safari's decodeAudioData has no promise form.
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
