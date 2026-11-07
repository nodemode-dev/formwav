# Extensions in formwav

formwav loads extensions made to the Form Extension Contract, API 1 (product id `formwav`). An extension is a folder with a `manifest.json` and web files; formwav runs its pages in a sandboxed frame and talks to them over `postMessage` (JSON-RPC 2.0, `"formext": 1`). This page is what formwav answers. The contract itself (package rules, the protocol, permissions, consent) is the kit's `CONTRACT.md`; the extension side is its `sdk/formext.ts`.

## host.hello

```json
{
  "product": "formwav",
  "app": "formwav",
  "appVersion": "2.24.0",
  "api": "1",
  "extension": { "id": "podcast-chapters", "version": "0.1.0", "source": "development" },
  "permissions": ["document", "files-write"],
  "theme": { "mode": "dark", "tokens": { "--bg": "#111111", "--panel": "#17151b", "--text": "#f7f7f7", "--muted": "#a4a4a4", "--accent": "#f97316", "--border": "#2a2a2a", "--radius": "6px" } },
  "locale": "en"
}
```

`theme.tokens` also carries formwav's own names for the same colours (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--text-primary`, `--text-secondary`, `--accent-color`, `--border-color`), and `--font-ui` and `--font-mono`. `ext.theme` sends the same object whenever the person changes the theme, the accent or light mode. `locale` is the interface language the person chose in Settings (one of formwav's 26).

## document.read

Permission `document`. Positions come both in samples at the session's rate (`at`, `start`, `end`, which `document.apply` takes) and in seconds (`*_s`). Levels are in dB, pans from -1 to 1.

`params.what` is one of:

| `what` | Answer |
|---|---|
| `session` (or nothing) | the whole open session: name, sample rate, length, tracks with routing, sends, effects and clips, buses, VCAs, groups, the master, markers and regions with their ids, the loop, tempo, meter and key, the playhead, the selection, the last undo step and whether there are unsaved changes |
| `selection` | the selected clips and the time range selection, with the playhead |
| `markers` | markers and regions only, with every field (number, comment, colour, the clip a marker follows) |
| `media` | the media in the session: id, name, sample rate, channels, frames, seconds |
| `transport` | the playhead, whether it is playing or recording, and the loop |

Any other value fails with -32602.

A real `session` snapshot, taken from the running window (two imported files, then the `document.apply` example below):

```json
{
  "product": "formwav",
  "name": "Untitled session",
  "sample_rate": 48000,
  "length_s": 30,
  "tracks": [
    {
      "id": "ba2a0a31-2dd0-4c3b-b085-514518654608",
      "name": "Interview",
      "gain_db": 0,
      "pan": 0,
      "mute": false,
      "solo": false,
      "output": "master",
      "sends": [],
      "effects": [],
      "automation_points": {},
      "clips": [{ "id": "902c8e5f-5247-4e74-a29c-c882f18d51b6", "media": "Interview.wav", "start_s": 0, "length_s": 30, "gain_db": 0 }]
    },
    {
      "id": "dab4e5bc-1088-4159-af64-6b15e4f06f71",
      "name": "Theme",
      "gain_db": 0,
      "pan": 0,
      "mute": false,
      "solo": false,
      "output": "master",
      "sends": [],
      "effects": [],
      "automation_points": {},
      "clips": [{ "id": "da576059-5b7f-404c-9f8b-aaec0b726050", "media": "Theme.wav", "start_s": 0, "length_s": 12, "gain_db": 0 }]
    }
  ],
  "buses": [],
  "vcas": [],
  "groups": [],
  "master": { "gain_db": 0, "effects": [], "automation_points": 0 },
  "markers": [
    { "id": "5697ab40-9f07-418f-869c-486fcfa777cf", "at_s": 0, "label": "Intro" },
    { "id": "d93c4931-2581-4312-87d9-16b329ed5f8d", "at_s": 2, "label": "Verse" }
  ],
  "regions": [{ "id": "08be7a08-42e0-4c7e-a429-0f75098b91e9", "label": "Chorus", "start_s": 4, "end_s": 8 }],
  "loop": null,
  "tempo": { "bpm": 120, "meter": "4/4", "changes": [], "meter_changes": [] },
  "key": { "start": null, "changes": [] },
  "playhead_s": 0,
  "selection": { "clips": [], "range": null },
  "undo": "Chapter markers",
  "steps": 3,
  "unsaved": true
}
```

Tracks with effects, sends, buses, automation and notes show them as the agents' `get_session_state` does (`engine/inspect.ts`).

`selection` (the clips selected in the lanes, and a time range dragged on a track, in samples and seconds):

```json
{
  "clips": [{ "track_id": "ba2a0a31-2dd0-4c3b-b085-514518654608", "clip_id": "902c8e5f-5247-4e74-a29c-c882f18d51b6", "name": "Interview", "start_s": 0, "length_s": 30 }],
  "range": null,
  "playhead_s": 0
}
```

`markers` (the same session):

```json
{
  "sample_rate": 48000,
  "markers": [
    { "id": "5697ab40-9f07-418f-869c-486fcfa777cf", "at": 0, "at_s": 0, "label": "Intro", "number": 1 },
    { "id": "d93c4931-2581-4312-87d9-16b329ed5f8d", "at": 96000, "at_s": 2, "label": "Verse", "number": 2 }
  ],
  "regions": [{ "id": "08be7a08-42e0-4c7e-a429-0f75098b91e9", "start": 192000, "end": 384000, "start_s": 4, "end_s": 8, "label": "Chorus", "number": 3 }]
}
```

## document.apply

Permission `document`. `ops` are formwav's own session commands, the reducer's commands that every edit in the window is made of (the same ones the agent tool `apply_document_commands` and the command line's `headless run --cmd` take): each op is `{ "command": "<type>", "args": { ...parameters } }`. All the ops of one call are applied together as one undoable step named `label` in Edit > Undo and the History tab. If the session refuses one op (a locked clip, an unknown id), none is applied and the call fails with -32004. The answer is `{ "applied": <ops applied>, "results": [{ "command", "changed" }], "step": "<the History words>" }`; `applied` is 0 when the ops left the session as it was.

The most useful commands (positions and lengths in samples at the session's `sample_rate`):

| Command | Args |
|---|---|
| `add-marker` | `at`, `label`, `clipId?` |
| `set-marker` | `markerId`, `at?`, `label?`, `number?`, `comment?`, `color?` |
| `remove-marker` | `markerId` |
| `add-region` | `start`, `end`, `label` |
| `set-region` | `regionId`, `start?`, `end?`, `label?`, `number?`, `comment?`, `color?` |
| `remove-region` | `regionId` |
| `set-loop` | `start`, `end`, `enabled` |
| `add-track` | `name?`, `channels?` |
| `rename-track` | `trackId`, `name` |
| `set-track-gain` | `trackId`, `gainDb` |
| `set-track-pan` | `trackId`, `pan` |
| `set-track-mute` | `trackId`, `mute` |
| `set-track-solo` | `trackId`, `solo`, `exclusive?` |
| `set-track-color` | `trackId`, `color` |
| `move-clip` | `trackId`, `clipId`, `start` |
| `split-clip` | `trackId`, `clipId`, `at` |
| `rename-clip` | `trackId`, `clipId`, `name` |
| `set-clip-gain` | `trackId`, `clipId`, `gainDb` |
| `set-clip-fades` | `trackId`, `clipId`, `fadeIn`, `fadeOut` |
| `remove-clip` | `trackId`, `clipId` |
| `set-tempo` | `bpm`, `beatsPerBar` |

Every other command and its parameters is in `engine/catalogue.ts` (the agent tool `list_document_commands` lists them). Example:

```js
await formext.call('document.apply', {
  label: 'Chapter markers',
  ops: [
    { command: 'add-marker', args: { at: 0, label: 'Intro' } },
    { command: 'add-marker', args: { at: 2880000, label: 'Interview' } }
  ]
});
```

## app.commands and app.run

Permission `document`. `app.commands` lists formwav's command catalogue, the one its palette (Cmd or Ctrl K), menus, command line (`./formwav cli list`) and MCP tools use: `[{ "id", "title", "group", "args", "mutates", "risky" }]`, `args` being each parameter's `{ type, required, enum?, minimum?, maximum?, description? }`. `app.run` runs one by id with its args and answers `{ "result", "step" }`, `step` being the History step it made (each command is one undoable step). A command that is not available now, or args it does not take, fail with -32004 and formwav's own words. Extension commands (`extension.*`) cannot be run from `app.run`.

Useful ids:

| Id | Args | Does |
|---|---|---|
| `session.add-marker` | `at_s`, `label` | a marker at a time in seconds |
| `session.set-loop` | `start_s`, `end_s` | the loop range |
| `session.get-session-state` | none | the session as the agents read it |
| `session.split-clip` | `track_id`, `clip_id`, `at_s` | split a clip |
| `session.set-track-gain` | `track_id`, `gain_db` | a track's fader |
| `session.rename-track` | `track_id`, `name` | rename a track |
| `session.set-clip-fades` | `track_id`, `clip_id`, `fade_in_s`, `fade_out_s` | a clip's fades |
| `session.analyze-clip` | `track_id`, `clip_id` | peak, RMS, DC offset, clipped samples |
| `session.get-transcript` | `max_words?` | the session's words with their times |
| `session.mark-speech` | `track_id`, `clip_id` | regions where there is speech |
| `transport.play-or-pause` | none | play or pause |
| `transport.stop` | none | stop |
| `file.save` | none | save the session |
| `edit.undo`, `edit.redo` | none | undo, redo |
| `view.editor` | none | show or hide the editor |

## Events (ext.event)

| Name | Data |
|---|---|
| `document.changed` | `{ "undo": "<last History step or null>", "steps": <undo depth> }`, after any change to the session (an edit, an undo, a redo, opening a session) |
| `selection.changed` | `{ "clips": ["<clip id>"], "range": { "track_id", "start", "end", "start_s", "end_s" } \| null }` when the selected clips or the time range change |
| `transport.changed` | `{ "playing": true, "recording": false, "playhead_s": 12.5 }` when playback or recording starts or stops |

## Files and network

- `files.open` (permission `files-read`): the system's own file chooser, filtered by `accept`; answers `[{ name, type, size, data }]`, `data` base64, at most 200 MB together. A cancelled chooser fails with -32002.
- `files.save` (permission `files-write`): the save dialog where the browser or window offers one (the person picks the place and the name), otherwise formwav asks in its own dialog ("Save this file?", with the name, Cancel and Save) and downloads it into the person's downloads folder (the system names it `name (2).ext` when the name is taken); answers `{ saved: true, name }`, and Cancel fails with -32002.
- `net.fetch` (permission `network`): available, through the engine on this computer: `https://` only, never an address on this computer or the local network, no cookies, answers at most 50 MB.
- `storage.get` and `storage.set`: 256 KB per extension, kept by this window.

## Where extensions appear

- **Extensions menu**, in the menu bar between Transport and Settings: one item per contributed command (`Extension name: Command title`), then Extensions panel, Reload extensions and Manage in FormPortal (opens `formai://extensions?product=formwav`).
- **Extensions panel**: in the editor at the bottom, under More > Extensions (also from the menu). One row per extension: name, version, source (Catalogue, File, Development), permission chips, state (Ready, Needs permission, Refused with the reason), Open for each panel, and for a development extension its folder. With nothing installed it says "No extensions yet. Find them in FormPortal or make one with form.ext." with a Manage in FormPortal button.
- **Contributed panels**: a `dock` panel opens as a tab of the Extensions panel, titled `Extension name: Panel title`, beside Installed; the editor's Float puts it in its own window. A `dialog` panel opens as one of formwav's dialogs, titled the same way.
- **Palette** (Cmd or Ctrl K): every contributed command, as `Extension name: Command title`, group Extensions.
- **Agents**: the window's tools `extensions_list` and `extension_command` (through the engine's `/mcp`, and the MCP server's `formwav_extensions_list` and `formwav_extension_command`); the command line's `./formwav cli extensions` and `./formwav cli extension <id> <command> [key=value ...]`.

The first time a version of an extension opens a panel or runs a command, formwav asks: it lists what the extension asks for in plain words, with Allow and Not now, before the extension's page is loaded, so its first `host.hello` already carries what was granted. Allow is kept for that id, version and set of permissions; Not now is not kept, so the next open asks again.

A command without a panel runs in a hidden frame that closes when the extension calls `ext.done`, or after 120 s in which it has no `files.open`, `files.save`, `app.run`, `document.apply` or `net.fetch` request waiting (time spent in formwav's file dialogs does not count).

## Running an extension

- **From a folder while making it**: form.ext's Run in App writes `extensions/formwav/dev.json` in FormPortal's folder (`FORMPORTAL_ROOT`, else `~/Library/Application Support/studio.formai.portal` on macOS, `%LOCALAPPDATA%\FormPortal` on Windows, `$XDG_DATA_HOME/formportal` or `~/.local/share/formportal` elsewhere):

  ```json
  { "format": "formext-dev-extensions", "format_version": 1, "product": "formwav", "extensions": [ { "id": "podcast-chapters", "path": "/Users/me/podcast-chapters/package", "added": "2026-11-07T10:00:00Z" } ] }
  ```

  formwav checks the file every 2 s while its window has focus and on Extensions > Reload extensions; a change updates only the rows and panels that changed. The extension shows with the source Development and its folder, and reloading the window is never needed.
- **`minimum_app`** is compared with the engine's version (`backend/app/core/version.py`). A source checkout between releases reports the last release, so leave `minimum_app` out while testing against one, or expect "it needs formwav X or newer".
- **Installed**: FormPortal installs a `.formpkg`, unpacks it and lists it in `extensions/formwav/enabled.json`; formwav loads it the same way, as Catalogue or File.

The engine serves an extension's files at `/api/extensions/files/{id}/{version}/{path}` with the contract's headers (a strict Content-Security-Policy for pages, `nosniff`, `no-store`); the list is `GET /api/extensions` and its change stamp `GET /api/extensions/stamp`.
