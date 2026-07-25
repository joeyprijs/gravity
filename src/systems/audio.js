// AudioSystem — the engine's two-channel audio layer.
//
//   ambience:  a looping background bed resolved per scene. A scene's own
//              `ambience` overrides its region's; an explicit null silences
//              the scene. Re-syncing to the same path is a no-op, so walking
//              between rooms of one region never restarts the loop.
//   narration: one-shot description read-alouds, one at a time; starting a
//              new clip (or entering a scene without one) stops the previous.
//
// Everything is opt-in via game data — a game that authors no audio fields
// never touches the Web Audio API. Browsers block audio until a user gesture,
// so the AudioContext is created on the first pointerdown/keydown; paths
// resolved before that are remembered and started at unlock. Web Audio (not
// <audio loop>) because buffer sources loop gaplessly. Safari caveats:
// callback-form decodeAudioData, no connect() chaining.

const SETTINGS_KEY = 'gravity.audio';
// Tuned by ear against the shipped clips, not derived from anything: the beds
// are quiet recordings and the narration takes are hot, so the mixer evens them
// out. Normalizing the source levels would let both sit near 1 — until then
// these are the numbers that sound right. 1 is the ceiling: the file's own
// level, unaltered.
const DEFAULT_SETTINGS = { muted: false, ambienceVolume: 1, narrationVolume: 0.25 };

// Seconds an ambience loop takes to fade in/out when the location changes.
// Narration also waits this out, so a room is established before the narrator
// speaks over it.
export const AMBIENCE_FADE = 1.5;

/**
 * Resolves the ambience loop path for a scene: the scene's own `ambience`
 * field wins (null meaning "explicitly silent"), else the region's, else null.
 *
 * @param {object} scene - A loaded scene definition.
 * @param {Object<string, object>} regions - The manifest's regions map.
 * @returns {string|null} Path to the loop file, or null for silence.
 */
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
    this._channelGain = { ambience: null, narration: null };

    // path → Promise<AudioBuffer|null>. Failed loads cache null so a missing
    // file warns once instead of re-fetching on every scene entry.
    this._buffers = new Map();

    // The resolved target loop (what SHOULD be playing) vs the playing one.
    this._ambiencePath = null;
    this._ambienceNodes = null; // { source, gain, path }

    // Monotonic token invalidates in-flight narration loads when a newer
    // playNarration call supersedes them.
    this._narrationToken = 0;
    this._narrationSource = null;
    this._pendingNarration = null;

    this._bindUnlock();
  }

  /**
   * Syncs the ambience channel to a scene. Called on every scene render and
   * on save restore; a no-op when the resolved loop is already the target.
   *
   * @param {object} scene - The scene being rendered.
   */
  syncAmbience(scene) {
    const path = resolveAmbience(scene, this.engine.data.regions);
    if (path === this._ambiencePath) return;
    this._ambiencePath = path;
    if (!this._ctx) return; // started at unlock
    this._fadeOutAmbience();
    if (path) this._startAmbience(path);
  }

  /**
   * Plays a narration clip, replacing any current one. Null stops narration —
   * entering a scene without a clip shouldn't keep narrating the previous one.
   *
   * The clip begins once the location's ambience has finished fading in, so
   * arriving somewhere new settles before the narrator starts. A bed that was
   * already running (another room of the same region) faded in long ago, so
   * its narration starts at once.
   *
   * @param {string|null} path - Path to the clip, or null to just stop.
   */
  playNarration(path) {
    const token = ++this._narrationToken;
    this._stopNarration();
    this._pendingNarration = null;
    if (!path) return;
    if (!this._ctx) {
      this._pendingNarration = path;
      return;
    }
    Promise.all([this._getBuffer(path), this._narrationStartTime()]).then(([buffer, startAt]) => {
      if (!buffer || token !== this._narrationToken) return;
      const source = this._ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this._channelGain.narration);
      source.onended = () => {
        source.disconnect();
        if (this._narrationSource === source) this._narrationSource = null;
      };
      source.start(Math.max(this._ctx.currentTime, startAt));
      this._narrationSource = source;
    });
  }

  /**
   * The audio-clock time narration may begin: when the ambience bed has faded
   * all the way in. A time already past means "right now".
   *
   * Waits on the bed's *buffer*, not just its fade: a multi-megabyte loop can
   * still be decoding when a short clip is ready, and starting the narrator
   * into silence is the thing this avoids. Silence by design (no bed, or a bed
   * that failed to load) waits for nothing.
   *
   * @returns {Promise<number>} A time on the AudioContext clock.
   * @private
   */
  _narrationStartTime() {
    if (!this._ambiencePath) return Promise.resolve(this._ctx.currentTime);
    return this._getBuffer(this._ambiencePath).then(buffer => {
      if (!buffer) return this._ctx.currentTime;
      return (this._ambienceNodes?.startedAt ?? this._ctx.currentTime) + AMBIENCE_FADE;
    });
  }

  /**
   * Mutes or unmutes both channels. Persisted as a device preference
   * (localStorage), not game state.
   *
   * @param {boolean} muted
   */
  setMuted(muted) {
    this.settings.muted = muted;
    this._saveSettings();
    this._applySettings();
  }

  /**
   * Sets a channel's volume. Persisted like setMuted.
   *
   * @param {'ambience'|'narration'} channel
   * @param {number} value - 0..1
   */
  setVolume(channel, value) {
    this.settings[`${channel}Volume`] = value;
    this._saveSettings();
    this._applySettings();
  }

  // ── Unlock & node graph ───────────────────────────────────────────────────

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
    if (this._pendingNarration) this.playNarration(this._pendingNarration);
  }

  _applySettings() {
    if (!this._ctx) return; // re-applied at unlock
    this._masterGain.gain.value = this.settings.muted ? 0 : 1;
    this._channelGain.ambience.gain.value = this.settings.ambienceVolume;
    this._channelGain.narration.gain.value = this.settings.narrationVolume;
  }

  // ── Playback internals ────────────────────────────────────────────────────

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
      // startedAt + AMBIENCE_FADE is when this bed is at full volume — the
      // moment narration is allowed to speak over it.
      this._ambienceNodes = { source, gain, path, startedAt: now };
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

  _stopNarration() {
    const source = this._narrationSource;
    if (!source) return;
    this._narrationSource = null;
    // A clip waiting on the ambience fade is scheduled but not yet started,
    // and stop() before start() throws without cancelling it — dropping the
    // node out of the graph is what actually silences that case.
    source.disconnect();
    try { source.stop(); } catch { /* scheduled but never started, or already ended */ }
  }

  _getBuffer(path) {
    if (!this._buffers.has(path)) {
      const promise = fetch(path)
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

  // ── Settings persistence ──────────────────────────────────────────────────

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
