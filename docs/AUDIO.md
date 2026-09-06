# Gravity — Audio

*The authoring guide for the ambience layer: what the engine plays, and where the files live.*

**Everything here is optional.** A game that authors no audio fields never fetches or decodes a byte of audio — an `AudioContext` still opens on the first user gesture (the unlock listener is unconditional), but nothing ever plays through it. Audio is opt-in per region and per scene.

---

## The channel

The engine plays one channel, **ambience**: a looping bed for the player's location, resolved on every scene render. One loop at a time; 1.5s fades when the location changes — a true crossfade when the incoming bed is already decoded, outgoing-fade-then-incoming-fade on a cold fetch. Mute and volume live in the Options tab (persisted in `localStorage` as a device preference, not in the save).

Browsers block audio until a user gesture, so the `AudioContext` is created on the first `pointerdown`/`keydown`. A bed resolved before that (the opening scene's) is remembered and started at unlock — nothing is lost, it just waits for the first click.

A missing or undecodable file warns once in the console and is otherwise silent: the loop stays quiet, the game plays on. **Clips can be referenced before they are recorded** — author the data first, drop the files in later. `npm test` asserts that every `ambience` path authored on the shipped regions and scenes resolves to a real file, so a typo fails locally instead of shipping as silence (in a checkout with no clips at all it has nothing to check and skips — see [File layout](#file-layout)).

## Ambience

Declared on the region (in `data/index.json`) and overridable per scene:

```json
"regions": {
  "dungeon": { "name": "The Dungeon", "ambience": "audio/ambience/dungeon.m4a" }
}
```

```json
{ "id": "village_hill_path", "region": "village", "ambience": "audio/ambience/hill_path.m4a" }
```

Resolution order, per scene: the scene's own `ambience` wins, else the region's, else silence. An explicit `"ambience": null` on a scene silences it against a region that has a bed.

Re-syncing to the same path is a no-op, so walking between rooms of one region never restarts the loop — the bed is continuous across a whole dungeon, and only a region (or an overriding scene) change crossfades it. A region with no `ambience` is silence: climbing from the hillside of `village_hill_path` into the house fades the outdoors out.

## File layout

```
audio/
  ambience/                    # O(regions) — flat, named for the id that declares it
    dungeon.m4a                #   a region id
    hill_path.m4a              #   a scene id, for a scene-level override
  _masters/                    # lossless sources + superseded takes — gitignored
```

**The clips are gitignored for now** (`audio/**/*.m4a`, `*.webm`, `*.wav`, and friends) — a checkout has the layout but no audio, and plays silent, which is exactly how the engine handles a missing file anyway. Two consequences worth knowing: the deployed demo on GitHub Pages has no sound, and the data-integrity test that checks every referenced clip exists skips itself when there are no clips to check.

The rules behind it:

- **Top level is the channel.** A file's path says which channel plays it and which volume slider governs it.
- **Ambience is flat**, named for the id that declares it — a region id, or a scene id where a scene overrides its region. This class is bounded by the number of regions; nesting would be ceremony.
- **`snake_case`**, matching data filenames and ids. The schema field is spelled `ambience` — keep the files spelled the same way so one grep finds both.

## Format

**Ambience is AAC in `.m4a`**, encoded from lossless masters with the system encoder:

```sh
afconvert -f m4af -d aac -b 128000 master.wav ambience/dungeon.m4a   # beds, stereo
```

**Keep lossless masters in `audio/_masters/`** (gitignored). Every re-record of a *tracked* binary would be a permanent extra copy in git history — and a lossless master means a re-encode never stacks a second generation of lossy loss on the first. Encode from the master, never from another lossy file.

Opus-in-WebM also decodes everywhere that matters (confirmed by ear on macOS Safari as well as Chrome and Firefox), and there is no reason not to move the beds to it once ffmpeg is around — macOS's own media stack has no WebM support, so `afconvert` cannot produce it.

**On AAC and gapless loops.** The usual warning is that MP3/AAC encoder padding puts silence — and so a click — at a loop seam. Measured rather than assumed: decoding these `.m4a` beds at their native rate in Chrome yields **no leading silence** (the encoder delay is trimmed via the container's edit list), a length only 148 frames long (3.4 ms on a 27-second bed), and a seam discontinuity *smaller* than the source WAV's. Nothing is inserted, so nothing clicks. This was verified in Chrome; Safari and Firefox honour the same gapless metadata, but if a seam ever ticks on another browser, re-check there first — and the fallback is a mono, lower-sample-rate WAV, which is codec-risk-free at about a quarter of the original size.
