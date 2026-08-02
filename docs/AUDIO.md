# Gravity — Audio

*The authoring guide for the two-channel audio layer: what the engine plays, and where the files live.*

**Everything here is optional.** A game that authors no audio fields never fetches or decodes a byte of audio — an `AudioContext` still opens on the first user gesture (the unlock listener is unconditional), but nothing ever plays through it. Audio is opt-in per scene and per action.

---

## The channels

The engine mixes two channels, each with its own volume slider in the Options tab (persisted in `localStorage` as a device preference, not in the save):

| Channel | What it plays | Overlap |
|---|---|---|
| **ambience** | A looping bed for the player's location, resolved on every scene render. | One loop at a time; 1.5s fades when the location changes — a true crossfade when the incoming bed is already decoded, outgoing-fade-then-incoming-fade on a cold fetch. |
| **narration** | One-shot read-alouds of authored text. | One clip at a time; a new clip replaces the previous. |

Browsers block audio until a user gesture, so the `AudioContext` is created on the first `pointerdown`/`keydown`. Paths resolved before that (the opening scene's bed and narration) are remembered and started at unlock — nothing is lost, it just waits for the first click.

A missing or undecodable file warns once in the console and is otherwise silent: the loop stays quiet, the game plays on. **Clips can be referenced before they are recorded** — author the data first, drop the files in later. `npm test` asserts that every `ambience`/`narration` path authored on the shipped regions and scenes resolves to a real file, so a typo fails locally instead of shipping as silence (paths authored anywhere else — an NPC pipeline, an item — aren't swept; in a checkout with no clips at all it has nothing to check and skips — see [File layout](#file-layout)).

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

## Narration

A scene's read-aloud resolves two-deep: a **description variant**'s `narration` wins when that variant is the one that matched, else the **scene**'s own (the only option for a plain-string `description`), else silence. Separately, any **action** may carry a clip of its own, played whenever the pipeline runs it — see [The `narration` convention](ACTIONS.md#the-narration-convention) in the action reference.

```json
"description": [
  { "text": "You are back in the cellar.", "condition": { "flag": "door_unlocked", "value": true } },
  { "text": "You awake in a dimly lit cellar…", "narration": "audio/narration/dungeon/start.webm" }
]
```

Scene narration plays exactly when a **new description block is appended** to the narrative — so it reads on entry, but not on the re-renders that follow an option click, and not when a save is restored into the scene. Entering a scene with no clip stops narration: the previous room's read-aloud never bleeds into the next.

A clip waits for the location's ambience to finish fading in before it speaks, so arriving somewhere new settles first — audibly, on boot and on every region change. Nothing waits when there is no bed to wait for, and a bed that has been running since an earlier room faded in long ago, so its narration starts at once. The wait is measured from the moment the bed actually *starts*, not from when it was asked for: a multi-megabyte loop can still be decoding when a short clip is ready, and starting the narrator into silence is the case this exists to prevent.

Because the channel plays one clip at a time, a narrated action followed by `navigate` in the same pipeline is cut off on arrival. Narrate the destination instead.

## File layout

```
audio/
  ambience/                    # O(regions) — flat, named for the id that declares it
    dungeon.m4a                #   a region id
    hill_path.m4a              #   a scene id, for a scene-level override
  narration/                   # O(scenes) — mirrors data/scenes/
    dungeon/
      start.webm               #   data/scenes/dungeon/start.json — its description
      start__closer_look.webm  #   …and a clip for one action inside it
  _masters/                    # lossless sources + superseded takes — gitignored
```

**The clips are gitignored for now** (`audio/**/*.m4a`, `*.webm`, `*.wav`, and friends) — a checkout has the layout but no audio, and plays silent, which is exactly how the engine handles a missing file anyway. Two consequences worth knowing: the deployed demo on GitHub Pages has no sound, and the data-integrity test that checks every referenced clip exists skips itself when there are no clips to check.

The rules behind it:

- **Top level is the channel.** A file's path says which channel plays it and which volume slider governs it.
- **Ambience is flat**, named for the id that declares it — a region id, or a scene id where a scene overrides its region. This class is bounded by the number of regions; nesting would be ceremony.
- **Narration mirrors `data/scenes/<region>/<scene>`.** This is the class that grows with content, and its whole maintenance problem is *which clip belongs to which line* — mirroring makes the path derivable from the JSON and back again, with no lookup.
- **A second clip for the same scene takes a `__suffix`** naming the beat: the condition flag that selects a description variant (`corridor__wanderer_defeated`), or a slug of the owning option's text for an action line (`start__closer_look`).
- **`snake_case`**, matching data filenames and ids. The schema field is spelled `ambience` — keep the files spelled the same way so one grep finds both.

## Format

Two formats are in play, for practical reasons rather than principle:

- **Ambience — AAC in `.m4a`**, from the lossless masters with the system encoder:

  ```sh
  afconvert -f m4af -d aac -b 128000 master.wav ambience/dungeon.m4a   # beds, stereo
  afconvert -f m4af -d aac -b 64000  master.wav narration/…/start.m4a  # speech, mono
  ```

- **Narration — Opus in `.webm`**, as currently delivered by the recording pipeline. Opus is the better codec for voice per byte, so this is not a compromise on quality — but mind the bitrate: **mono speech wants 48–64 kbps**, and Opus is already transparent there. The first drop arrived at ~150 kbps, which made each clip roughly twice the size of the 64 kbps AAC it replaced. Bitrate matters far more here than the container does.

- **`.wav` stays for short one-shots** (sfx, when they land). Compression saves nothing worth the trouble there.

- **Keep lossless masters in `audio/_masters/`** (gitignored), and superseded takes in `audio/_masters/superseded/`. Every re-record of a *tracked* binary would be a permanent extra copy in git history — and a lossless master means a re-encode never stacks a second generation of lossy loss on the first.

**Opus-in-WebM plays in Safari** — confirmed by ear on macOS Safari, both channels, so `decodeAudioData` handles it there as well as in Chrome and Firefox. WebM is safe to ship.

The one practical catch: macOS's own media stack has no WebM support at all — `afconvert` and `afinfo` cannot even open these files — so **transcoding a `.webm` locally requires ffmpeg**. Keep a lossless master of every take and that never comes up.

## Which format when

**Narration: Opus in WebM at 48–64 kbps mono.** Smaller than the AAC equivalent and better sounding, and it decodes everywhere that matters. Ambience is AAC only because the beds were encoded from WAV masters with the system encoder before the WebM pipeline existed; there is no reason not to move it to Opus once ffmpeg is around.

Encode from a **lossless master**, never from another lossy file — transcoding Opus to AAC (or back) pays for the loss twice.

**On AAC and gapless loops.** The usual warning is that MP3/AAC encoder padding puts silence — and so a click — at a loop seam. Measured rather than assumed: decoding these `.m4a` beds at their native rate in Chrome yields **no leading silence** (the encoder delay is trimmed via the container's edit list), a length only 148 frames long (3.4 ms on a 27-second bed), and a seam discontinuity *smaller* than the source WAV's. Nothing is inserted, so nothing clicks. This was verified in Chrome; Safari and Firefox honour the same gapless metadata, but if a seam ever ticks on another browser, re-check there first — and the fallback is a mono, lower-sample-rate WAV, which is codec-risk-free at about a quarter of the original size.
