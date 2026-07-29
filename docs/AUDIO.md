# Gravity — Audio

*The authoring guide for the two-channel audio layer: what the engine plays, and where the files live.*

**Everything here is optional.** A game that authors no audio fields never touches the Web Audio API — no context is created, no file is fetched. Audio is opt-in per scene and per action.

---

## The channels

The engine mixes two channels, each with its own volume slider in the Options tab (persisted in `localStorage` as a device preference, not in the save):

| Channel | What it plays | Overlap |
|---|---|---|
| **ambience** | A looping bed for the player's location, resolved on every scene render. | One loop at a time; crossfades over 1.5s when the location changes. |
| **narration** | One-shot read-alouds of authored text. | One clip at a time; a new clip replaces the previous. |

Browsers block audio until a user gesture, so the `AudioContext` is created on the first `pointerdown`/`keydown`. Paths resolved before that (the opening scene's bed and narration) are remembered and started at unlock — nothing is lost, it just waits for the first click.

A missing or undecodable file warns once in the console and is otherwise silent: the loop stays quiet, the game plays on. **Clips can be referenced before they are recorded** — author the data first, drop the files in later. `npm test` asserts that every path in the shipped data resolves to a real file, so a typo fails locally instead of shipping as silence (in a checkout with no clips at all it has nothing to check and skips — see [File layout](#file-layout)).

## Ambience

Declared on the region (in `data/index.json`) and overridable per scene:

```json
"regions": {
  "dungeon": { "name": "The Dungeon", "ambience": "audio/ambience/dungeon.m4a" }
}
```

```json
{ "id": "home_door", "region": "player_home", "ambience": "audio/ambience/home_door.m4a" }
```

Resolution order, per scene: the scene's own `ambience` wins, else the region's, else silence. An explicit `"ambience": null` on a scene silences it against a region that has a bed.

Re-syncing to the same path is a no-op, so walking between rooms of one region never restarts the loop — the bed is continuous across a whole dungeon, and only a region (or an overriding scene) change crossfades it. A region with no `ambience` is silence: stepping from the hillside outside `home_door` into the house fades the outdoors out.

## Narration

Three places can carry a `narration` path, in resolution order:

1. **A description variant** — read when that variant is the one that matched.
2. **The scene** — the fallback, and the only option for a plain-string `description`.
3. **An action** — see [The `narration` convention](ACTIONS.md#the-narration-convention) in the action reference.

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
    home_door.m4a              #   a scene id, for a scene-level override
  narration/                   # O(scenes) — mirrors data/scenes/
    dungeon/
      start.webm               #   data/scenes/dungeon/start.json — its description
      start__closer_look.webm  #   …and a clip for one action inside it
    shared/                    # the engine's own lines, named for the locale key
      actions.lookAroundFail.webm
  _masters/                    # lossless sources + superseded takes — gitignored
  _scripts/                    # generated recording scripts — committed
```

**The clips are gitignored for now** (`audio/**/*.m4a`, `*.webm`, `*.wav`, and friends) — a checkout has the layout and the recording scripts but no audio, and plays silent, which is exactly how the engine handles a missing file anyway. Two consequences worth knowing: the deployed demo on GitHub Pages has no sound, and the data-integrity test that checks every referenced clip exists skips itself when there are no clips to check. `audio/_scripts/` stays tracked — it is text, and its diffs are the drift signal.

The rules behind it:

- **Top level is the channel.** A file's path says which channel plays it and which volume slider governs it.
- **Ambience is flat**, named for the id that declares it — a region id, or a scene id where a scene overrides its region. This class is bounded by the number of regions; nesting would be ceremony.
- **Narration mirrors `data/scenes/<region>/<scene>`.** This is the class that grows with content, and its whole maintenance problem is *which clip belongs to which line* — mirroring makes the path derivable from the JSON and back again, with no lookup.
- **A second clip for the same scene takes a `__suffix` naming the beat it narrates** — `start__closer_look` for an action, or the condition flag for a description variant (`start__door_open`). Never the option's button text: labels get reworded during polish, the beat doesn't.
- **`snake_case`**, matching data filenames and ids. The schema field is spelled `ambience` — keep the files spelled the same way so one grep finds both.

## Recording scripts

```
node scripts/generate-narration-script.js          # write audio/_scripts/
node scripts/generate-narration-script.js --check  # exit 1 if stale (CI)
```

Writes one plain-text recording script per scene — `audio/_scripts/<region>/<scene>.txt`. Each entry gives the line wrapped for reading aloud, where it lives in the JSON, and the clip path the take belongs at:

```
────────────────────────────────────────────────────────────────────────
Log line · Take a closer look at the door · loot
options[1].actions[0].log
→ audio/narration/dungeon/start__closer_look.webm  [clip authored]

  You run your hands over the rough planks, feeling for weakness.
  Nothing gives. But crouching at the threshold, you spot it: a small
  iron key lying in the gap beneath the door, slid through from the
  other side. Whoever locked you in wanted you to let yourself out.
```

What it extracts, per scene: the description (plain or every variant, labelled with the state that selects it), `passiveChecks[].text`, each skill's `resultText` and `outcomes.<tier>.text` — including the per-attempt array form, one entry per attempt — and every custom `log` / `message` string in any action pipeline, at any nesting depth.

Prose locations are an explicit allowlist, not a scan for `text`: `options[].text`, `skills[].text`, and `retryText` are button labels and are never narrated.

Where the data already wires a `narration` path, the script shows that path. Where it doesn't, it suggests one by the rules above and marks the line `[no clip yet]`. Kinds the engine cannot play yet — outcome text, `resultText`, passive checks — say so on the status line, so recording them is a deliberate choice to work ahead of the engine rather than a surprise silence.

**The output is committed on purpose.** The script is a pure function of the data — it never looks at which clips are on disk — so `git diff` after editing prose is exactly the list of clips that no longer match their text. That is the answer to narration's real failure mode: a recording that quietly stops matching the line it reads. CI runs `--check` to keep the two in step.

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
