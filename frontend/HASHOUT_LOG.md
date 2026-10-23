# HASHOUT_LOG · frontend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the frontend. formwav's own source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Files under `src/vendor/` are third-party copies kept verbatim, upstream comments included, so they can be resynced. Read this first, then edit code surgically.

Current build version: v2.20.4
Last updated: 2026-10-23 · v2.20.4, inspector-pane.ts: the Nyquist list loads through `nyqLoad()`; with no plug-ins installed it ends with one option marked `data-nyq-get`, "Get the Nyquist plug-ins (GPL-2.0, downloaded from their publisher)", and choosing it posts /api/nyquist/plugins/install, shows the progress and the count on the notice line and reloads the list (the marked option goes first, so the list never holds it twice). An option, not a new button: the row keeps its size, as the list's own options already change it after the first fetch. Its three strings are in all 25 languages (i18n/added/nyquist-plugins); "GPL-2.0" reaches the tables as GPL{0}; v2.20.1, the UI plan's phases 4 to 9 (the owner's "finish the last 5 still open"). Footer (phase 4): the transport bar keeps its 58 px (it is the transport, not a 28 px status strip) and takes the family's status finish: --space-4 gaps and padding, a --line-0 hairline above and between it and the info column, the info line in --text-muted with tabular figures; no jobs list (the engine reports no job ids to list) and no memory slot (an audio engine's memory is not the page's to read). Home (phase 5, ui/home.ts, styles/home.css): formvis's HomeScreen as a page over the workspace, fixed between the title bar and the transport (so the menus and the transport stay usable over it), under the menus (calc(--z-menu - 1)), built once into the shell's markup (HOME_HTML) and shown or hidden by [hidden], never rebuilt: a 232 px nav (brand, Start and Recent with a count, Create: New session, Open a session, Import audio, Record, Try the demo; foot: Back to session, Preferences, Keyboard shortcuts) and a page with the greeting by the hour (reserved 32 px line, written with setText), a dashed hero card (formats as chips, Import audio as the family's white call to action, Open and New with key caps) and the recent sessions as cards with the saved thumbnail; Recent lists them all. Its actions are proxied to the empty stage's and the title bar's own controls, so each action keeps one path; a session opens through projects.ts (new fw-open-project listener, the unsaved-changes guard included). It shows at launch when no session is open and formwav.homeAtLaunch is not "0" (and the desktop app did not open a file, ?open=), from the brand (now a button, .fw-identity) and View > Home (data-proxy to the brand, so the menu test reaches one control); it hides on Escape (unless a dialog is open), Back to session, any of its actions, and whenever the session has tracks. Preferences (phases 6 and 7, ui/prefs.ts, styles/prefs.css): formvis's SettingsDialog as one native dialog built once (Escape, focus return and the top layer from the platform), the rail inside its left edge rather than floating outside as in formvis, five sections as stacked cards (General: Home at launch, Reset all preferences, which removes every formwav. key and nodemode_ui_settings and reloads, sessions untouched; Interface: theme, follow the system's appearance (formwav.followSystem, a prefers-color-scheme listener switching between light and the last dark theme, formwav.darkTheme as the title bar toggle keeps it), accent colour and Default, accent strength (setIntensity, 0 to 150%), language (setLanguage), reduce motion (formwav.reduceMotion, body.animations-disabled, which tokens.css already honoured and nothing set); Audio: recording latency, pre-roll and post-roll written into the transport's own fields and their change events, so record.ts stays the one owner; Editing: shortcuts and the palette; Agents and devices: their dialogs through the Settings menu's items), scroll spy on the pane (a tab scrolls the pane alone: scrollIntoView also scrolled the dialog's clipped box and hid its head), rows synced in place each time it opens. Opened by Settings > Preferences… (first item, ⌘,), Cmd or Ctrl comma, Home, and the desktop menu (fw-desktop-menu "preferences"). The Settings menu keeps its Language, Theme and colour, Devices and Agents items (the language test and the agents test use them). Desktop (phases 8 and 9, ui/desktop.ts, styles/desktop.css, public/splash.html; the shell's side is in src-tauri/HASHOUT_LOG.md): inert in a browser (only window.__TAURI_INTERNALS__); in the app, macOS gets has-overlay-titlebar (78 px for the traffic lights) and the native menu's events, Windows and Linux get caption buttons at the end of the title bar's actions and a draggable title bar; document.title is mirrored to the window (set_window_title); main.ts's reveal now also calls desktopReady two frames after app-ready, which tells the shell to end the splash. Strings in 25 languages (i18n/added/home-prefs). The owner's logo replaces the waveform mark in the page (the title bar's .fw-logo is now an img of /logo-64.png, 22 px with a 5 px radius; Home's brand; the empty stage's mark from /logo-256.png; the splash), see src-tauri/HASHOUT_LOG.md for how the files are made. The interface tests' _open steps back from Home (Back to session) before a test works the panes, as a person would; that is the one change to the tests. Measured in Chromium: Home at 1280x674, 1440x900 (light) and 980x640, shown at launch, hidden by Escape and by an import, shown by the brand, no overflow, no shift, no page error; Preferences at 1280x674 and 980x640, opened by the key and the menu, theme, reduce motion and latency (read back from the transport's field and storage) applied, the scroll spy following, no overflow, no shift, no page error. · v2.20.0 (second half), the form family look, phases 1 to 3 of the UI gap plan (the sidecar's verification/UI_GAP_PLAN.md: formvfx v0.47.0 for the look, formvis v1.96.4's three maps for the UX; the tokens and the fifteen themes were already formvfx's byte for byte, so the gap was the cascade): canvas.css, loaded after frame.css, had put the title bar back to a flat 44 px bar; its title bar rule now carries the family's own values (40 px from --fw-titlebar-h, now defined once in form-family.css and no longer in frame.css, as is --fw-group-head-h; the gradient from --surface-2 to --surface-1, a --line-0 hairline, --space-3 gaps and padding; the name at --fs-13, 600, 0.2 px tracking; a 20 px logo; menu buttons --ctl-md high, --radius, --fs-12, --space-2 padding). Menu rows take formvfx's finish: radius 7, hover a 10% tint of the text colour in place of the accent wash (the accent stays for the checked tick), key caps at 45% of the text colour, 12 px with 0.04em tracking, separators a 12% hairline with 6 by 10 px margins (the dock's More menu likewise). Dialogs get the family scrim (--fw-scrim rgba(8,6,14,0.45) with --fw-scrim-filter blur 14 px and saturate 0.9). Range, checkbox and radio inputs take the accent (accent-color). JetBrains Mono 700 is loaded (main.ts and fonts.css) and awaited in the reveal race, so the bold transport clock is no longer a synthesised bold. The window's title is written as the family writes it (projects.ts writeTitle: "{name} - formwav", led by "• " while a session with tracks has unsaved changes; written on every document change and as the name is typed, only when it differs). ui/title-tools.ts is new (formvis titlebar-tools, the plan's phase 2): two .fw-tt-btn chips at the head of .fw-topbar-actions (28 px, a --line-2 hairline, radius 7, --surface-1, --surface-raised on hover), in the page from the first frame; the theme toggle switches between the light theme and the dark theme last used (formwav.darkTheme, Studio Dark at first; sand counts as light), its icon the theme it switches to (sun or moon from vendor/formvis/icons) and its words "Switch to a light theme" or "Switch to a dark theme", repainted on nm:ui-settings-changed so Settings > Theme and colour keeps it right; the search chip sends fw-palette, which mountPalette now answers as Cmd or Ctrl K does (open, or focus the open field). Strings in 25 languages (i18n/added/title-tools). Measured at 1280x674: both ways of the toggle, the palette opened with its field focused, the session name unmoved and still ending before the actions, no shift, no page error. Not taken: formvfx's font preloads (they point at /node_modules, which a production build does not serve), the color-scheme meta (it would turn the system controls dark under the light themes). Measured in Chromium at 1280x674 and 1440x900, studio and light: title bar 40 px, no layout shift, no page error, the 700 face loaded. · v2.20.0, sung lyrics L5: engine/align-lyrics.ts is new: assignLyrics(notes, words) sets the words heard in a sung line on its notes, pure. Notes are cut into phrases at rests of REST_S (0.45 s; a breath, while 0.35 s gaps were measured inside phrases, a scoop into the first note); each word goes to the phrase whose span is nearest its middle; within a phrase each word is split by syllabify ("Twin-", "kle") with times spread over the word, and syllables and notes are aligned by dynamic programming on their place in the phrase (0 at its first, 1 at its last, measured in notes: PLACE 0.4 a note) rather than on time, as Whisper's times on singing run early and uneven; a note left without a syllable costs SKIP (0.8), or SKIP_HELD (0.25) when it is shorter than SHORT_S (0.12 s, a slip or a scoop) or carries on the note before at the same pitch with no gap to speak of (a fragment of a held note, or a melisma); a syllable sharing a note costs JOIN (1.2). The phrase's span is taken from its notes of SHORT_S or more, so a slip at either end does not stretch it. Notes without a syllable after a sung one get the hold ("-"), those before the first stay empty. Measured with the L4 references (lyric on the right note, the note matched within 100 ms of the reference onset): soprano 12 of 14 (Whisper did not hear "How"), baritone 12 of 14 (two notes 0.105 and 0.12 s from their reference onsets, their syllables right); before the short-note and span rules the baritone was 4 of 14. Clip.pitchCurve is new (a note clip read from singing keeps the pitch as sung, [at in source samples, MIDI with cents], every 20 ms), set by import-media's pitchCurve (only with notes; non-finite pairs dropped, times rounded, pitches clamped to 0..127 at 0.01). The Inspector's Audio to MIDI has a fourth mode, Sung (notes and lyrics): Convert calls POST /api/midi/vocal-to-notes, assigns the lyrics and imports the note clip with them and the curve at the clip's place; its notice "Sung notes and words on a new track at the clip's place (notes: {0}, words: {1})" (25 languages, i18n/added/vocal-notes). Measured in Chromium on the soprano's sung line: 14 notes, 9 words, the lyrics read back from the session as above and 389 curve points; one layout shift outside input (0.0017), the same as Melodic's Convert on the same clip (the new track's row). · v2.19.9, sung lyrics L4b and L4c: ui/sing.ts is new: mountSinging (mounted by note-events beside the Event menu) sends a note clip's notes as they sound (its trim and its media's rate applied, seconds), each note's lyric and phonemes (words looked up through POST /api/midi/phonemes once each, notePhonemes as the editor uses), the session's singer and rate to POST /api/midi/sing, and dispatches place-sung with the media and where its first sample belongs; one clip at a time from a queue (a Set of clip ids), in the background, the notice saying what it does ("Singing {a}…", "Sang {a}: {0} phrases sung, {1} kept, {2} s", "Not sung: {a}"); a clip whose sung track's key (its notes, start, trim, the singer and the default syllable) matches is skipped. A document subscription sings a clip again 1.5 s after an edit to it, its singer or the syllable, for every note clip that has a sung track (seen holds the key last seen; the first sight of a track takes its stored key, so reopening a session does not sing). chooseSinger asks with the stock singers and the session's own; newSinger takes the selected audio clip (fw-selection), asks a name and the permission (a select that starts at Not confirmed and is not remembered by the dialog: a field with options and text renders as a select whose last value the dialog does not keep, which it does for other selects by title), sends the clip's media, offset and length to POST /api/midi/singers with permission true only when confirmed, and dispatches add-singer. engine/document.ts: Track.sungFrom and sungSig; SessionDoc.singer and singers (each with its permission, when and from which recording); place-sung (the sung track made just under the note clip's track, named "Sung: " and the clip's name, one clip replaced on each sing, the earlier media dropped once nothing plays it), set-singer (a stock id or own_ and 16 hex digits; vocalset_f1 is stored as absent), add-singer (refused without a permission time; it also makes the new singer the session's). ui/note-events.ts: the Event menu's Sing this clip, Singer…, New singer from a recording… (each a command an agent can run through the window's registry). Strings under i18n/added/singing. · v2.19.7, sung lyrics L2, pronunciation: engine/pronounce.ts is new and pure: VOWELS and CONSONANT_CLASS (ARPAbet, SoulX-Singer's phone names without its en_ prefix), CONSONANT_MS (formwav's own defaults by class, not taken from a source: stop 50, affricate 70, fricative 80, aspirate 50, nasal 60, liquid 55, semivowel 45), ONSET_SHARE 0.5 and CODA_SHARE 0.3; parsePhonemes; lyricWords (a syllable ending in "-" runs on into the next note's, so "Twin-" and "kle" are asked for as twinkle; several words on one note, a line longer than its notes, are each their own word sung in turn; a hold belongs to none); splitWord (one vowel a note, the consonants between two vowels split so the later syllable keeps the longest English onset in ONSETS, so twinkle is T W IH1 NG | K AH0 L and singing S IH1 NG | IH0 NG; more notes than vowels leave the last ones empty, fewer put the rest on the last); notePhonemes (a note's own phonemes when edited win, null while its word is unknown); durationSplit (leading consonants end at the note's start within ONSET_SHARE of the note before or the rest before it; what does not fit goes into the note's start up to CODA_SHARE, the vowel after it, which is how a clip's first note at 0 keeps its T W; the vowel, and later vowels sharing equally, from there; closing consonants end where the note ends or the next syllable's consonants start, within CODA_SHARE; all scaled together, never below a frame). engine/lyrics.ts syllabify now ends every syllable but a word's last with "-" (the karaoke convention), so words can be found again; sessions made with v2.19.6's lyrics read each syllable as a word (a day old, never released). engine/document.ts set-note-phonemes (ARPAbet only, else refused; null or empty returns the note to its lyric's); a lyric change still drops edited phonemes (withLyrics), since they were for the old syllable. ui/piano-roll.ts: words' phonemes asked from POST /api/midi/phonemes once each per session (words, asking; a failed ask marks them unknown, source none, so a dead engine is not asked again on every draw); computeSung per clip of the editor, cleared at each draw; the phonemes drawn over a note once rows reach 14 px (edited in the accent, guessed at 55 percent); notes now clipped to the grid, as with the lane they had drawn over it when below the rows in view (they always had spilled into the velocity lane when zoomed); the in-place field has a phonemes mode (data-mode, Shift and double-click, Cmd or Ctrl Alt E by e.code since Alt changes e.key on a Mac), wrong phonemes keep it open with aria-invalid; NoteEditor.sung, editPronunciation, setLyric, setPhonemes. ui/note-events.ts: the event list's Lyric and Phonemes inputs (translate no, placeholders the default syllable and the derived phonemes) and Timing cell (each phoneme's start and length in ms from the note's start), patched in place like the rest; the Event menu's Edit pronunciation. styles/form-family.css: the field's invalid and phonemes looks, the timing cell (wraps at 1280), the phonemes input at 16ch. Strings under i18n/added/pronunciation. · v2.19.6, sung lyrics L1 (DEV_PLAN_sung_lyrics, the owner's "default to da", the other a choice): engine/lyrics.ts is new and pure: SING_SYLLABLES da and la, DEFAULT_SYLLABLE da (chosen from SoulX-Singer renders of both, the sidecar's verification/verify_default_syllable_soulx.json: repeated same-pitch notes 30 dB apart on da against 2 on la), syllablesOf (vowel groups as nuclei; a silent final e and a word-initial y are not; a consonant plus le is its own syllable; one consonant starts the next syllable, a cluster leaves the longest English onset to the next, so mi-cro-phone and to-ge-ther, while yes-ter-day comes out ye-ster-day: a hyphen typed fixes any word), syllabify (a typed hyphen splits a word there, "-" or "_" alone holds the syllable before, a melisma, stored as the lyric "-"), singingOrder (by start, the higher note of a chord first), withLyrics (a line from a note on, one syllable a note; an empty line clears that note; syllables past the last note join it, so nothing typed is lost), shiftLyrics (forward: the last note keeps both its lyric and the one arriving; backward: the note before takes both). engine/document.ts: NoteEvent.lyric and phonemes (optional, so every saved session stays valid), SessionDoc.singSyllable (absent is da), commands set-note-lyrics, shift-lyrics (both leave the clip's media alone: lyrics are not heard by the instrument) and set-sing-syllable; sungFields keeps a lyric (64 characters) and phonemes through set-clip-notes and import-media, which rebuilt every note from its four numbers and would have dropped a lyric at the next drag. ui/piano-roll.ts: a lyric lane (LYR_H 20 px, canvas data lyrH) between the grid and the velocity lane names what each note sings at its start whatever the zoom (in the dock at 1440 by 900 rows are 4 px, too small for text, which is why the lane exists), the higher note of a chord only, the default syllable at 45 percent, the selected in the accent; a press in the lane selects the note it names and never adds one, a double-click there edits it; the lyric is also drawn inside a note once rows reach 12 px. The lane takes 20 px from the grid, so the fitted pitch window now centres on the notes (or C4 to C5 with none) when it cannot show them all, where it used to keep the top: at the dock's height an empty clip had shown no C4. One input made at mount (data-lyric) placed over the edited note's place in the lane, absolutely positioned in the panel (form-family.css .fw-piano-lyric) so nothing moves; double-click a note or Cmd or Ctrl E opens it, Enter keeps, Escape leaves, Tab and Shift Tab keep and move in singing order, a blur keeps; Alt ] and Alt [ shift from the selected note; the editor maps its index to the clip's own note index (inClip) since the editor holds several clips' notes. ui/note-events.ts: the Event menu's Edit lyric, Move lyrics forward and backward, and Notes sing da or la (menuitemradio, kept in step on every change). audio/notes.ts midiFile and engine/smf.ts sessionMidi write a lyric as FF 05 at its note's tick after the note-offs there and before the note-on (sessionMidi's note-on order moved from 3 to 4 for it; a note cut by its clip's trim loses its lyric, as its start is not sung); ui/import.ts carries the lyric the engine reads. Strings under i18n/added/lyrics. · v2.19.3, PLAN_v12 R6 and R7: no interface code changed (the ACE-Step choices reach the local engine through the same route); strings under i18n/added/acestep-local (the new needs line, the engine's install line) and acestep-ready (the six choices and the provenance line, shown once ACE-Step is ready, which no earlier state did). · v2.19.2, PLAN_v12 R5: ui/models-pane.ts, the choice ls-ezaudio (Sound effect on this machine, up to 10 s), offered when the engine lists ezaudio, with the text and duration fields (duration capped at 10 before it is sent); the install choice lists EzAudio like the other local engines. Strings under i18n/added/sound-effects-local, built on each language's frames for the Chatterbox strings. · v2.19.1, the owner's report: ui/import.ts has a .fmw branch (POST /api/projects/upload with X-Filename, then fw-open-project with the session's name after its own notice is written, so ui/projects.ts opens it through its usual path and unsaved-changes guard); ui/projects.ts's open popover has Open a .fmw file (a hidden input, accept .fmw) that hands its pick to the import queue through fw-import-files; ui/shell.ts's picker accepts .fmw; styles/form-family.css .fw-popover-file. engine/document.ts SessionDoc.fadersBeforeInserts, set by the engine on sessions saved before v2.18.5; audio/player.ts keeps such a session's faders on the clips (no own-bus fader, no meter gain). Strings under i18n/added/open-fmw-file. · v2.18.9, PLAN_v12 R12: ui/room.ts, the Devices dialog's second switch (data-d=anywhere) puts /api/remote/tunnel on or off; drawLink shows the state's words in data-d=link and the link's address in its own translate="no" span (data-d=url), so the sentence is translated and the address never is; while the tunnel runs without a link yet it asks again every 500 ms; Show a pairing code is enabled when the network listener is on or the link is up (lanOn, linked). styles/form-family.css: .fw-devices-where holds content-box 2lh (the family's padding of 12 px had left a 34.8 px box one 18 px line, which clipped the second line of a wrapped note), .fw-devices-link 3lh. Seen in Chromium at 1280 by 674 in English and German, off and on, nothing clipped, no page errors. Strings in 25 languages under i18n/added/guests-anywhere. · v2.18.8, PLAN_v12 R3 and R4: ui/models-pane.ts, the choice ls-vc-chatterbox (Change a clip's voice to another clip's on this machine) with a second clip row, voiceclip ("Voice of"), filled with the clip list as the first one is; Dub on this machine speaks with Kokoro or Chatterbox (speaks), and with Chatterbox installed offers the ownvoice check (In the speaker's own voice), sending voice "own". Strings in 25 languages under i18n/added/voice-local, dub-chatterbox and chatterbox-size (the size line now the measured 7.8 GB). audio/player.ts: meterGains, a track's own-bus fader gain by its place in the document; since v2.18.5 the fader of a track with inserts plays on its own bus after them, while the core meters a track at its clips, so a strip read the level ahead of its own fader (the e2e strip test, fader at the top, never latched its clip light); handlePosition scales the track peak pairs by it while playing. · v2.18.6, PLAN_v13 S17 phase C: ui/inspector-pane.ts, a plug-in insert's row has Edit (data-rtfx=edit, .fw-rtfx-edit, one width for Edit and Done in form-family.css so the row does not move): it posts the insert's name and state to /api/plugins/edit and, while the editor is open (editingPlugins, by name, so a re-render keeps Done), Done posts /api/plugins/edit/close; the state that comes back replaces that insert's by commitRtfx, matched by name rather than place in case the chain moved meanwhile. Notices stay fixed sentences (the plug-in's own name and a failure's reason are not interface text: the reason goes to the console). The note track's Instrument title names VST3 instruments. Strings in i18n/added/editors and added/instruments-vst3. Checked in Chromium with the engine on Xvfb: Edit opened the knob fixture's window and read Done with its rectangle unchanged, a drag to x 120 and Done kept gain 0.5, CLS 0; tsc passes; test_interface 36 of 37 (the picture test). · v2.18.5, PLAN_v13 S17 phase B and PLAN_v12 C7: engine/document.ts PluginFx (kind plugin: name plugin:clap:<path>, label, state, values by p<id>), kept by cleanFx only with a CLAP name, its values finite and its state base64; set-fx-automation, lanes.ts and flatFx/flatFxAuto pass it by like the other non-filters. audio/player.ts planClips: a track with any non-filter effect gets its own bus wherever it is routed (C7: out set to the user bus; the core runs buses in route order), and that bus plays at the track's fader and VCA level (faderDb moves to busFaderDb; volumePoints and folded are computed before the branch now), post-fader sends multiplying it back; flatStages takes a MixPlugin list and writes [21, k, ...]; ClipPlan.plugins goes out with both clips messages. The worklet's core refuses kind 21 (no design), so the browser plays the track without the plug-in; native output hosts it, and its plugin-error reply becomes the window event fw-plugin-error, which the Inspector shows as one translated line (the reason, naming the user's file, goes to the console). ui/inspector-pane.ts: Insert on track (data-fx=insert, always present, enabled only for a CLAP pick with a clip selected, so the row never moves) appends the plug-in with its current p<id> values and the state it kept on the clip's media; its effect row shows the plug-in's own name (translate=no) and "Native output and exports" (.fw-rtfx-note in form-family.css). ui/agent-pane.ts set_track_effects takes kind plugin (a plug-in passed back keeps its state). Strings in i18n/added/inserts. Checked in Chromium: the button turns on only for a CLAP plug-in, the row appears with the name untranslated, CLS 0; tsc passes; test_interface 36 of 37 (the picture test). · v2.18.4, PLAN_v13 S17 phase A: each plug-in parameter (p<id>) in the Inspector gets a "Ramp to" row beneath it (.fw-ramp-row: a checkbox, a slider disabled until ticked, its value), built with the parameter's row so nothing appears later; on Apply, each ticked ramp becomes two automation points in the media's seconds, the clip's (or the range's) start at the parameter's value and its end at the ramp's, the clip's session positions taken into media samples by the two rates. A VST3 plug-in's kept state is sent back as a CLAP one's is. Measured in Chromium with the vst3-gain fixture installed in ~/.vst3: the ramp row 17.2 px tall ticked or not, CLS 0; the request carried {"automation": {"p0": [[0, 1], [4, 0.25]]}}; the rendered clip's gain 0.991 over its first 0.1 s, 0.625 at its middle and 0.259 over its last 0.1 s, the averages of the linear ramp; the result carried plugin {name, state}. Strings in i18n/added/plugins (2 keys, 25 languages). Before, v2.18.3, PLAN_v13 S17 begun: MediaRef gains `plugin` ({name, state}), the CLAP plug-in that made the audio and its state after the render, stored by set-clip-media as given, so the session file keeps it; the Inspector's apply sends that state back (`state` in the effect's params, the chosen controls over it) when the same CLAP plug-in is applied to that clip again. tsc passes; the automation lane for plug-in parameters is S17 phase A (sidecar DEV_PLAN_plugins_v2.18.4.md). Before, v2.18.2, PLAN_v13 S16 closed. (1) The v2.18.1 defect was the meter, not the audio: the master strip's surround cells timed their fall from the stereo meters' last report (lastTime), which lands just before them, so they hardly fell and held a compressor's attack peak; rendering the page's own clips message through the wasm core in Node gave C -24.9 dB at 128 and 4096-sample blocks, and with the cells on their own clock (lastSurround) nine plays in three runs read C -24.9 dB and Rs -6.0 dB. (2) ui/renderer-panel.ts, opened from View > Renderer (its menu item makes the command view.renderer): a floating card of fixed size (tokens --fw-renderer-w and --fw-renderer-room in form-family.css) on the companion layer, built once: the room on a canvas (rings, each placed track's dot; redrawn only on a document change), sixteen pooled speaker cells placed by --x and --y from the layout table when the layout changes (unused cells hidden, LFE at the room's lower right), each a bar scaled in place (scaleY), a 2 s hold mark, and a dB readout written into its text node's data so no node is added or removed; the footer's layout chip, Fold to stereo (set-surround-fold), and a note kept in place by visibility while it is not needed. Levels fall at 20 dB/s on the panel's own clock. Measured in Chromium with 4x CPU and a slow network (latency 150 ms, 1.6 Mbit/s): a 0.5 tone near Rs reads -6.0 dB, a compressed track at C -24.9 dB (the export's peak), unused speakers below -60 dB; switching the layout from 5.1 to 7.1.4 while playing leaves the panel's box identical (1152, 96, 264 by 351.7) with zero childList records; CLS for the whole run 0.00009. Strings in i18n/added/renderer (8 keys, 25 languages). Firefox is not installed in this build container, so it was not run. (3) Two regressions of v2.18.0's form family stylesheet, found by tests/e2e/test_interface.py's clipping check at 1280, 1440 and 1710: the drawn select chevron (appearance none and a 22 px end padding) left a select sized to its own text no room for the 15 px the check, and the system arrow, allow, cutting "Claude Code" in the agent column and "Browser" in the status bar; selects now keep the system arrow and take only the family's line, field surface and radius. The agent column's head then cut its New button, the chip tabs being wider than the text tabs before them: its tabs are text again (secondary, the selected one primary at 600) and its select no longer shrinks; the head measures 294 px of content in 294 px at all three sizes. The readouts' "-inf" is marked translate="no" (the languages check had listed it in all 25). After both: the interface file passes 35 of 37 here; the MIDI test passed once its module (mido, music21) was installed into the venv, and the picture test waits for headless Chromium to decode the proxy video, which this container's build does not do (not touched by this release). Before, v2.18.1, PLAN_v13 S16 (surround), the interface's part. audio/surround.ts is now the place record (placeRecord), the layout ids (LAYOUT_IDS, LAYOUTS) and the core's layout table fetched once from /api/surround/layouts (layoutTable, 5.1 alone if the engine is unreachable); its gain maths is gone, the core owns it. audio/player.ts: PLACED_ON_THE_SUM gone, a placed track's own bus sent as busPlaces records, fold on when either kind of place exists, surroundFormat the layout id, surround peaks of 2 to 16 channels accepted. The worklet sets the layout, the places and the bus places, and reads up to 16 peaks. engine/document.ts: SPATIAL_FORMATS and SpatialFormat (13 values, 5.1 stored as nothing), Track.surround gains div and centre, kept only off their defaults so older sessions save unchanged. Inspector: Height (was Elev), Divergence and Centre % beside the place, the layout picker with all 13 layouts, the pad drawing the session layout's speakers (height speakers on an inner ring) and a dim spread circle. Export: "Surround in the session's layout" (what=surround). The master strip's six surround cells take the layout's channel names. catalogue.ts lists the new parameters and formats. Strings: i18n/added/surround/ in 25 languages (14 keys). Measured in Chromium (engine and page here, a 0.5 tone, a track at C with a compressor and one near Rs with a processor, fold on): Rs reads -6.0 dB, L, Ls and LFE at the meter floor; C reads -23.6 dB (the engine's export: -24.9 dB peak after 1 s) in three of five runs, and -7.7 dB in two, about 0.7 of the dry tone plus the compressed one, when play is pressed right after the commands land: an open defect, see BUILD_NOTES. Before, v2.18.0: the form family look, matched to formvfx v0.47.0. The tokens were already the family's (tokens.css, fonts.css and scrollbars.css equal formvfx's), so the difference was in the component layers; src/styles/form-family.css, imported last in main.ts, carries it: panes are bordered cards (line-0 border, radius-md, surface-0) on a 4 px gutter with the resizers as 2 px accent lines on hover; heads are 32 px group heads with 24 px chip tabs (active: line-3 and surface-raised, accent-line while the pane has focus); the pane title is formvfx's title chip; the title bar is 40 px; buttons are line-2 chips on surface-1; selects take the family chevron (two gradients) and every field an accent border on focus; popovers, menus and the palette are glass at 95 percent surface-2 with radius 12 (at the 82 percent glass-bg the menu's words behind it read through in Chromium, measured in a screenshot); dialogs take radius 14 and the line-3 border; the ruler and track bed take the family's ruler and track colours; the main counter in time mode takes the family's timecode blue (#4d93ff, #2f62c9 on light themes); the agent column is a card whose head is a group head with chip tabs, and its "via" chip may shrink with an ellipsis (its head overflowed by 19 px at 1440 before). Every value is a token, so all fifteen themes follow; checked at 1710, 1440, 1280 and 1024 in the default and light themes: no page scroll, no overflow in the title bar, inspector or media list, CLS 0. The EQ match reference select has a fixed 12em inline size and the 28 px control height, so re-listing it can no longer resize its row (workspace.css). Before, v2.17.2: public/favicon-32.png, apple-touch-icon.png and icon-192.png are the new family icon at their previous names and sizes, so index.html is unchanged; no interface code changed (src-tauri/HASHOUT_LOG.md has the icon's reasons). Before, v2.17.1: Claude Code as formlit has it, and an everyday-user pass. ui/terminal-dock.ts, chat-pane.ts and markdown.ts are formlit v0.45.3's dock, chat and Markdown stream on formwav's DOM helpers (formlit's api.cmd calls became fetches of /api/terminal/*, /api/claudecode/open and /api/claude/*, its engine events an EventSource on /api/claude/events, its photo strips dropped); mounted by mountTerminalDock after mountDock, before .fw-dock-anchor, hidden by default, height --fw-tdock-h (min(300px, 40%), at most 75%, kept in formwav.terminalHeight) because 300 px left the lanes a sliver at 720 high with the editor dock open; the tab strip, the Chat pane (made on first use), its bar and the Ask line are built once and only shown or hidden; message text, user text and tool chips are translate="no"; From Claude Code... uses fw-ask with the titles escaped, since that dialog builds options with innerHTML; window events fw-dock-toggle, fw-dock-chat {text?}, fw-dock-claude {prompt?}, fw-dock-new, and fw-terminal kept; Cmd or Ctrl+J, Shift for Claude Code, Alt for Chat, Ctrl+` kept, and inside a terminal these reach the page; ui/toolbar.ts's View items Show Terminal, New Terminal, Claude Code, Chat with Claude replace Terminal and so are commands; the title-bar Terminal button stays hidden by canvas.css and frame.css as before. ui/terminal-pane.ts removed. ui/icons-agent.ts holds formlit's icons; the vendored sparkles are gone (banned). ui/agent-pane.ts: the robot button sends fw-dock-claude; with Claude Code chosen, sendChat sends fw-dock-chat with the text and "(Looking at ...)" as the engine built it from context, the column's own Claude Code stream (its EventSource, runCode, codeDone) is gone, so its Undo run no longer covers Claude Code runs (History does), and a note made once in the template (fw-agent-redirect) is shown or hidden by the select. The everyday pass: File > New session first (projects.ts, emptyDocument at the current rate, Open's question, Ctrl+N free in the app though a browser tab may keep it), the empty state's Record (clicks the transport's) and Try the demo (clicks the File item) with flex-wrap, and the stage scrolls with safe centring in the empty view so a short pane never cuts it; Settings > Theme and colour... opens the Theme select and swatches in a panel under Settings (moved out of the title bar); the notice is a reserved two-line clamp whose title a MutationObserver keeps equal to its text (the bar stays 58 px); Out's meter got a title and A's aria-label is Show automation. Translations in src/i18n/added/dock. Before, v2.17.0: the owner's rule that no competing product is named anywhere in the repository. Eighteen interface strings carried a product's name as an attribution in parentheses (playlists, warp markers, the time track, the Nyquist row, the AAF export's target, the ADM export's object-audio tools, and others); each was rewritten in the source and, since the English is the key, its key and translation were changed in place in all 25 base tables (src/i18n/<code>.json), the one case where a base table is edited rather than a new added/ file written, because leaving the old key would have kept the name in the repository. ui/import.ts posts a zipped .aup or an .aup3 to /api/projects/import-aup and its question and notice say ".aup project". Every comment that named a product now says what the feature does. Coverage row codes (PT-, AU-, RX-nn ...) are kept as codes. Before, v2.16.9: PLAN_v13 S15. engine/document.ts: SessionDoc.picture { id (the movie's SHA-256), name, size, start (session samples), burnIn?, width, height, duration, fps } and set-picture, set-picture-start and set-picture-burn-in. ui/picture.ts: Open video now sends the movie to POST /api/pictures and, in one step, places it at the playhead and its sound (when it has any) on a new track there; the video plays /api/pictures/<id>/movie (the proxy for ProRes and Motion JPEG, measured playing in Chromium), the movie time is the position less the picture's start, a Starts at timecode field and At playhead move it, Timecode burn-in draws formatClock(..., "timecode") over the picture, Remove takes it out, and a movie the engine cannot serve reads "(missing)". Its controls row is laid out from the start (visibility, not hidden) and the video keeps a 16:9 box, so a picture arriving moves nothing: the first version shifted the panel twice and the interface test caught it. ui/picture-lane.ts: a lane under the ruler (a spacer for clicks, a canvas the visible window wide that paints, as the ruler does) with the movie's frames as tiles from its start at the zoom's spacing, fetched sixteen to a strip and kept; a click locates. Opening a session whose picture was not found says so (projects.ts). Translations in src/i18n/added/picture. Before, v2.16.8: PLAN_v13 S14. engine/instruments.ts lists the core's two new instruments and their parameters in its order (backend/tests/test_instruments.py holds the tables equal); a track's Instrument gains { kind: "subtractive" | "drums", values by name }, cleaned by set-track-instrument like a processor's values. audio/notes.ts instrumentBody is now the one place that turns a track's instrument into what /api/midi/render needs, and a MIDI take uses it too, so a take on a sampler, plugin, subtractive or drum track sounds through that instrument (it had always rendered with the session synth). The live instrument follows the armed track's subtractive or drum synth (player.useLiveInstrument, called by each MIDI note-on; the worklet's live-instrument message and the core's fw_live_instrument); any other track plays the session synth as before, and a Synth tab drag returns to it. The Inspector's Instrument row offers Subtractive synth and Drum synth with every value as a field (wrapped so [hidden] hides them; a field is rewritten only when the session's value changes, data-shown, so a doc change between a select's input and change events cannot put the old value back, which a first version did). Clip > Render track effects into clips renders every clip of the selected clips' tracks through its clip effects and the track's live chain (after its clip gain) through the core and bypasses the chain, one undo step. An LFO stage (chorus, tremolo, phaser, flanger) starts from its phase at the media's start in the rendering, where the track's sum had run it from the session's start, and a tail past the media's end is not kept; the test places one clip at 0. Translations in src/i18n/added/instruments. Before, v2.16.7: PLAN_v13 S13's remainder. src/ui/record.ts: Record pressed while playing punches in on the fly (no seek, no pre-roll, no punch range, no restart of the player, which had re-seeked and placed the take by the position read before the input opened); the take's start is the transport position once capture has begun, and Record again punches out with playback going on. src/ui/workspace-layout.ts window configurations: the saved layout last recalled or saved is the active one (marked in the menu), Update writes the current panes into it, Keep up to date writes every change of the panes into it as it happens (both kept on this machine). src/engine/document.ts comp-from-playlist clears the span on the active playlist and pastes the other playlist's pieces of it (engine/editing.ts clipPiece, as Copy Selection to Main Playlist does); src/ui/lanes.ts shows the track's other playlists as lanes under its takes (the takes toggle shows when either exists), and a drag across a playlist's clip comps that span, a click the whole clip. Paste special: merge notes adds the copied note clips' notes into the note clip under the playhead on the copied clip's track (exact duplicates left out) and plays the clip again with its instrument (audio/notes.ts renderNotes). Clip group files: Clip > Export clips as a file keeps the selected clips (a whole group when one member is selected) and their media as a .fwclips zip (POST /api/projects/clips-file), and Import a clips file brings one in at the playhead from the current track down as one new group in one step, adding tracks it needs; paste-clip now takes the clip's media with it, so a clip from elsewhere needs no second command. Not done: Paste special to the current automation type. Translations in src/i18n/added/session2. Before, v2.16.6: PLAN_v13 S13 in part, from the behaviour the study describes. src/ui/record.ts: a Post-roll field beside Pre-roll; a punch keeps rolling to its out point plus the post-roll (the take is still cut at the out point, as before). src/engine/template.ts templateOf keeps a session's shape (tracks, buses, VCAs, groups, routing, sends, effects, automation, tempo and meter, markers, regions) and leaves out clips, other playlists, launcher slots, media, the loop and a sampler that played one of its files, marked template; src/ui/projects.ts File > Save as template (named through the editing dialog, saved as a session) and opening a template starts an unsaved session named Untitled from it, so a save never writes over the template; File > Revert to saved opens the last save again through Open's own guard. src/ui/editing.ts View > Commands Focus (kept on this machine): a capture-phase key listener runs A, S, D, G, F through the menu commands by their words (so they do exactly what the menu does), B separates the selected clips (or the track's) at the playhead, P and ; move the range a track, L and ' tab to clip edges, and stops the lanes' own S; ? opens the shortcuts window. src/ui/shortcuts-panel.ts View > Keyboard shortcuts: every command with a key from the registry, the lanes' keys and the Commands Focus keys, built once at first opening, the filter hiding rows. Clip gain: Clip.gainBypass (set-clips-gain-bypass) plays the clip at 0 dB with no line in the player (planClips swaps the clip before planning) and the export alike; Copy and Paste clip gain carry the gain and the line relative to the clip's start; Render clip gain writes the whole file times the gain line into new media (POST /api/media/{id}/clip-gain) and sets the clip to 0 dB with no line in one step. src/ui/lanes.ts Edit > Paste special: repeat to fill selection lays the copied clips end to end across the range, the last cut at its end. Translations in src/i18n/added/session. Before, v2.16.5: PLAN_v13 S12. src/engine/catalogue.ts lists every engine command's parameters exactly as the Command union types them (the table was taken from the union's lines once; typed as Record<Command["type"], string>, so a new command type does not build until it is listed, the same guard WORDS in describe.ts gives), with the History words each makes. src/engine/inspect.ts is the whole session for an agent in seconds and dB (routing, sends, groups, effects, automation point counts, buses and their outputs, VCAs, master, markers, regions, loop, tempo, meter and key maps); the caller adds the playhead, the undo and redo steps and whether the session is saved. src/ui/agent-pane.ts gains get_session_state, list_document_commands and apply_document_commands (several commands as one undoable step with its own words; a type not in the catalogue is refused before anything runs); being session tools they are commands too, so the engine's relay (/api/commands, POST /mcp) reaches them with the outside-agent consent in front. File > Open the demo session asks the engine for the demo (projects-client openDemo) and opens it as a new unsaved session at the open session's rate. Translations in src/i18n/added/demo. Before, v2.16.4: PLAN_v13 S11, from the behaviour the study describes. src/engine/tempo.ts is the tempo and meter map: ticks at 960 a quarter (MIDI's quarter as the tempo's beat whatever the meter), tempo segments with the sample each starts at (tickToSample and sampleToTick walk them), meters from a bar counted from 0 (a meter change starts on a bar line, so a change written mid-bar would be meaningless), beats of 4 times 960 over the denominator, so a 6/8 bar is 2880 ticks of six beats; barBeatAt, barStartTick and barsBetween answer bar questions for every reader. tempoCurve writes a ramp as steps every 1/4, 1/8 or 1/16 from the range's start, the first step at the start tempo and the last at the end tempo (eased linear, parabolic t squared, or smoothstep for the S-curve), then the tempo that played at the range's end written back there, so a ramp never changes what follows; scaleTempo multiplies each tempo inside the range the same way; Stretch is a scale by one over the length factor. The document keeps tempo (with beatUnit for x/8 at the start) and adds tempoChanges, meterChanges and keyChanges; set-tempo-change at tick 0 changes the session's tempo, withTempos drops a change equal to the tempo before it, set-tempo-map replaces the whole list (the operations' one undo step, with their own words). engine/grid.ts and engine/timebase.ts read the map only when hasMap says the session has one (more than one tempo or meter, or a meter not in quarters), so every S5 and S6 figure stays exactly as it was. engine/midi.ts chordsByBar walks the map's bars (the chord namer of S7 unchanged) and chordsPerBar names the playing note clips for the Chords ruler. engine/smf.ts writes each tempo, meter and key (keySignature turns a key's name into sharps or flats and the minor flag) where it falls, with every position through the map. src/ui/ruler.ts draws bars bar by bar along the map, adds Tempo, Meter, Key and Chords rows (counters.ts lists them with the other rulers) and takes a change on a double-click in the Tempo, Meter or Key row at the bar under the pointer, through the fw-ask dialog. src/ui/note-events.ts: Event > Tempo ramp, Scale and Stretch over the range or the loop. src/ui/import.ts: a MIDI file placed at the start brings its tempo, meter and key changes (a 6/8 file stays 6/8, where S8 kept it as three quarters a bar). engine/score.ts places notes through the map and writes the first meter's beat unit; the score keeps that one meter for every bar. Translations in src/i18n/added/tempo. Before, v2.16.3: PLAN_v13 S10, from the behaviour the study describes. src/engine/document.ts: a send carries pre (taken before the fader, the volume lane and the VCA, after trim, polarity and clip gain, as the export's base_gain is), mute and pan (absent follows the track's pan); set-track-send keeps a send's place and options when only its level changes; Bus.out names the bus a bus plays into, route-bus refuses itself and any bus already downstream (walking out links), remove-bus frees what played into it. TrackGroup links volume (by the same dB, clamped -60 to +12, rounded to 0.01), mute, solo (not an Alt exclusive solo) and edit; set-group takes its tracks out of any other group and drops groups left with fewer than two; remove-track leaves its group. src/audio/player.ts busOrder runs buses longest path first (stable), so a bus always plays after what feeds it, the same order render.py bus_order gives; the plan carries each bus's out as the core's id, and player-worklet.ts sets it with fw_set_bus_out (optional call, an older core plays every bus to the master). src/ui/mixer.ts: every send is a row in the Route box (name, remove, level, Pre, M, pan; double-click the pan to follow the track again), patched by bus id with patchList so a level drag never rebuilds the row; an Add a send select lists only buses not yet sent to; a bus strip's Output select lists the master and every bus that would not make a loop. src/ui/editing.ts: Track > Group selected tracks (tracks with a selected clip or in the range), Ungroup, Group active. src/engine/editing.ts EditRange.more and src/ui/lanes.ts: a range drawn on a track in an edit group covers its group's tracks; Shift on a track's name adds it or takes it out (the lanes' capture pointerdown stops there, so the range is kept); each extra track shows its own range box; Delete clears and S splits on all of them in one step, and editSpan covers them all so copy and the range commands do too. Translations in src/i18n/added/routing. Before, v2.16.2: PLAN_v13 S9, from the behaviour the study describes. src/audio/player.ts trackVolume folds a track's volume (lane or fader), its VCA's (lane or fader), its trim lane and its mute lane into the one gain lane the core plays, so the worklet and the core needed nothing new for them: union of the lanes' breakpoints plus eight steps a span, each lane linear in gain as the core plays one, a mute change as two points at one time (the core takes the later at that sample), muted at -300 dB; without a VCA lane, trim or mute the volume lane passes as before, so older sessions plan exactly as they did, and the clip's gain then leaves out the VCA's fader, which the lane carries. A send's lane goes through clipEnvelope over the track's points (dB-linear like a clip line), its static level then 1. The master lane is the core's own (render.rs master_env), applied after the master chain, since folding it into every clip would put it ahead of a master compressor. Off leaves the track's lanes and its sends' lanes unplayed, never the VCA's. src/engine/document.ts: cleanLane, sameLane and laneAt shared by the new commands; Coalesce VCA samples the members' new lanes as the planner combines them (eight steps a span, linear in gain) so the mix moves under 0.01 dB, and a static VCA becomes the members' faders exactly; mapLanes now carries mute (snapped back to 0 or 1), trim and send lanes through time edits, and a rate change scales the VCA, send and master lanes. src/ui/lanes.ts: the third automation row is no longer hidden without filters; its menu adds MORE_LANES (mute, trim, vca, send:<bus>, master), read through laneDoc since the VCA's, sends' and master's points live outside the track; names in the menu are escaped. src/engine/automation.ts: thinning is Ramer-Douglas-Peucker on the value (0.5 dB, 0.02 pan), glide keeps the lane's values at the range's edges, write puts the value at the playhead across the range with a sample's step at each edge, and the two coalesce commands move the volume into clip gain lines (at the lane's points and the clip's edges) and back. src/ui/i18n.ts merges every added table for a language (added/<topic>/<code>.json), so new strings come as new files. v2.16.1: PLAN_v13 S8, built from the behaviour the study describes, no code taken. src/engine/smf.ts: trackEvents maps each note clip's notes (media frames) through its trim and its media's rate into session frames, cutting notes to the part that plays, muted clips left out; sessionMidi writes format 1 with a first track for the name, tempo, meter and markers, one track per note track, the channel a clip came in on kept (the drums stay on 10) and the rest dealt round the free channels; at each tick controllers come first, then note-offs, then note-ons, so a repeated pitch retriggers. src/engine/score.ts: one voice per part on a sixteenth grid at the session's tempo and quarter-note meter; notes starting together form a chord held until the next start; durations split greedily into whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth and sixteenth, tied across bars and within them; the clef is G when the middle pitch is A3 or above; sharps only, fifths 0; the SVG counts its note heads in data-heads (ties draw a head each) and its bars in data-measures, and it is redrawn only when its text changes. src/ui/score.ts: printing goes through an off-screen iframe (window.open is refused in the desktop WebView); the Score panel sits in the dock's More menu, since another tab would crowd the dock in the longer languages. src/ui/piano-roll.ts: step input's chord window (60 ms) applies only to MIDI notes, which midi-input.ts now raises as fw-midi-note; computer keys never chord, so fast typing stays sequential; turning Step off commits at once. src/engine/document.ts: Clip.controllers and Clip.midiChannel, kept from import-media; src/ui/import.ts makes every track, marker and the tempo one batch. The 32 new strings are translated in src/i18n/added/<code>.json, which src/ui/i18n.ts merges over the base table, so the generated tables are never rewritten. The note editor's zoom buttons became − and + (with aria-labels) to make room for Step; a wrapped head had shrunk the grid to a few rows. v2.16.0: src/ui/i18n.ts follows formvis's and formlit's choice (tables keyed by the English, a MutationObserver translating in place, the English kept per node in a WeakMap, no RTL) so no module changes how it writes text. A write by the interface is told from the translator's own by comparing the node's value with the one it last wrote, so setText writing English again is taken as new English, translated in the same microtask before paint. Lookup order: the whole string; then numbers as {0}, {1} and the session's names (tracks, clips, media, buses, VCAs, markers, regions, the session) and file names as {a}, {b}, the plural form picked by Intl.PluralRules on the first number; then split at " · ", ": ", "; ", " (" or ", " with both halves found; a path (no spaces, a slash) is never looked up. Skipped: [translate="no"], contenteditable, xterm, and the agent log's entries (the log's own data-empty still translates). Translated attributes: title, aria-label, placeholder, data-empty, data-label; the two CSS content strings became data-empty, the empty-state buttons' action moved to data-empty-act and the effects groups gained data-fx-label, since both were read back as display text. The window waits for the chosen table before it is revealed (main.ts), so it never shows English first. The command registry still reads the menus' English, as gather runs at mount before any table loads. The 2025 keys came from walking the interface in Chromium (every pane, panel, the mixer with a bus, History, Settings, Agents, the palette, a note clip), describe.ts's words, and the code's notices with ${} read as {0} for counts and {a} for the rest; 13 keys whose {a} sat against a letter were dropped from every table, since a placeholder never stands inside a word. src/styles/canvas.css: the session name is 100% of a column that shrinks to 96 px, and the swatches fold into Settings below 1400 px. v2.15.5: src/ui/models-pane.ts maps a choice to its provenance row by its id's prefix (el-, ace-, fal, ld-, the local speech engine named at its end, Install a model following the engine picked) rather than a field on every choice; the line is fw-models-origin because fw-models-from was already the From field's input, which value("from") reads (the first name broke ACE-Step's repaint until the test found it); the line is hidden in the template so nothing shows before the engine answers, and the full list is rebuilt only when its ids change. src/ui/terminal-pane.ts no longer says Windows is unsupported. v2.15.4: mixing at scale. src/ui/mixer.ts: linked faders are the mixer's own state (a Set of track ids, not in the session, so a link costs no undo step and is gone on reload), toggled by Cmd or Ctrl-click on a strip's name and drawn with data-linked; while a linked fader is dragged (not while playing, where the automation passes own the fader) the others move on screen by the same dB from their document gain, held with data-dragging so the document's render does not pull them back, and the release dispatches one batch of set-track-gain labelled Moved N faders together, leaving out a fader that follows its automation; render prunes ids of tracks gone or hidden. The polarity button (fw-strip-phase) sits in the strip's kind row because three buttons in fw-strip-buttons overflow the 56 px column at canvas.css's 112 px strip; it dispatches set-track-invert as Route's Invert does and both read item.invert. The master's fw-strip-lufs takes the buttons row (hidden there for the master); src/ui/meter.ts writes the integrated value to it in writeLufs, already throttled to 200 ms, with the template's text the same width as a reading. src/ui/editing.ts: Commit selected tracks bounces the tracks one after another (the engine renders one at a time) and dispatches one batch of commit-track, so one Undo takes them all back; with fewer than two tracks selected, the folder is the clicked track's bus. src/ui/media-pane.ts: the list is entries, media then a folder head then its media, keyed so a head never turns into a row; folded folders are this window's state; assigning goes through fw-ask (right-click) or a drop of the browser's media drag type on a head (dropEffect copy, since the drag allows copy only); src/engine/document.ts keeps mediaFolders and set-media-folder, which ignores media not in the session and drops the field when empty. v2.15.3: src/ui/autosave.ts compares the engine's document by identity (the reducer makes a new object for every change, so an unchanged session is never sent), skips an empty one and one equal to the last saved (projects.ts now raises fw-saved after a save, which also clears the engine's copy); the question goes through the editing dialog (fw-ask), and only when the window starts empty; Recover loads through engine.loadDocument, as Open does, and leaves the session unsaved. src/ui/export.ts: the AAF branch serves OpenTimelineIO too (export-otio, .otioz). v2.15.1: one command registry (src/ui/commands.ts). Commands are the window's because the session lives here (formvis's choice, not formlit's engine registry); params are JSON-Schema fragments (formlit's), checked in `call` with errors written as instructions; `gather` reads the menu bar after every module has mounted (main.ts calls it last), taking each item's words without its kbd, the id menu.slug, run as a click on the item so the module's own handler and its History label apply; risky is a word match (export, delete, clear, open, commit...) shown to agents, not gated; `batch` undoes back to where it began at the first failure; the agent pane registers its 30 tools as session.* and adds list_commands, describe_command, run_command and run_commands, so both the API path and Claude Code see 34; the window answers a consent item from the bridge with Allow, Always allow or Block in the log. The palette: built once on body, twelve rows patched with setText, commands needing parameters left out, Cmd or Ctrl K (Cmd Alt K stays the lanes'), closed on blur. v2.15.0: Claude Code in the Agent column (src/ui/agent-pane.ts: the connection choice, kept in this browser as formwav.agentVia; the chat streamed from /api/claude/events into an append-only log, text deltas appended to one Text node per reply, each tool a row turned failed on its error; the window bridge, which re-posts the tool list every 30 s and answers /api/bridge/next by running the named tool as an agent step; Claude Code in the terminal as an icon button, since a word cut the head at 1280) and in the terminal (src/ui/terminal-pane.ts: ?run=claude, the fw-terminal event, the Claude Code button); Settings > Agents' note on HTTP (src/ui/agents.ts); the select's style (src/styles/canvas.css). v2.14.6: MIDI editing (src/engine/midi.ts, src/ui/note-events.ts, src/ui/piano-roll.ts); the note editor's head wraps only when the dock is narrower than its controls, its state reading No note clip (src/styles/frame.css), as the fit test found it cut at 1280 and 1440. v2.14.5: time formats and counters (src/engine/timebase.ts; the frame rate, inactive tracks and commit-track in src/engine/document.ts and describe.ts; consolidate in src/engine/editing.ts; src/ui/counters.ts; the clock, the tray's readouts and the rate in src/ui/shell.ts; rulers stacked in src/ui/ruler.ts; Consolidate, Commit and Inactive in src/ui/editing.ts; the lanes' and mixer's inactive tracks; the player leaving inactive tracks out). v2.14.4: editing depth (src/engine/grid.ts; clip mute, locks, names, a fade-out's own shape, memory location fields and the track commands in src/engine/document.ts and describe.ts; the builders in src/engine/editing.ts; the Track and Clip menus, nudge, Create fades and memory locations in src/ui/editing.ts and src/ui/shell.ts; the lanes' drawing, range copy and paste and the picked track in src/ui/lanes.ts; src/ui/labels-pane.ts; Snap's dialog in src/ui/musical.ts; src/ui/grid.ts; the Clip tab's new fields; the fade code in src/audio/player.ts; the ruler's colours; the mixer's hidden strips). v2.14.3: the editing commands (src/engine/editing.ts; insert-time, clear-range and clear-ranges with follow in src/engine/document.ts; src/ui/editing.ts and src/ui/big-counter.ts; the Zoom tool in src/ui/toolbar.ts; Identify Beat in src/ui/musical.ts; Fit to selection in src/ui/inspector-pane.ts) and AU-13's page turn (src/ui/lanes.ts, src/ui/ruler.ts, src/ui/transport.ts, src/ui/meter.ts). v2.14.2: the Export dialog's range, twelve formats, dither switch and peak normalisation, and the true peak in its notice (src/ui/export.ts, src/io/render-client.ts, src/styles/workspace.css). v2.14.1: the mixer basics (src/ui/mixer.ts: solo safe and solo alone, Clear solos and mutes, trim, polarity, Off, bypass by kind, the pan law, the peak hold and the clip light; the commands in src/engine/document.ts and describe.ts; every kind but the filters on a track's bus with its filter automation, and gain reduction by insert, in src/audio/player.ts and player-worklet.ts; a dynamics card's reduction in src/ui/editor-tabs.ts; src/styles/canvas.css). v2.14.0: the studio processors, formwav's own library (src/engine/processors.ts; the processor entry in src/engine/document.ts; src/audio/player.ts and player-worklet.ts; the browser's list in src/ui/browser-effects.ts, the cards in src/ui/editor-tabs.ts, the rows in src/ui/inspector-pane.ts, the agent's tool in src/ui/agent-pane.ts; the chain wrapping in src/styles/canvas.css). v2.13.1: the Clip tab's Separate row names speech, music and effects and says which method split them (src/ui/clip-tab.ts), the agent's separate_clip reports its method (src/ui/agent-pane.ts), Sounds > Models installs any model on this machine (src/ui/models-pane.ts). v2.13.0: the interface rebuilt on the agreed canvas (src/styles/canvas.css and the shell's modules), real Synth controls, the agent column's History tab (src/engine/describe.ts), and what the last Firefox check found (the Clip tab's rows, the Inspector's columns, Route, the head's context, the search); 160 older entries still sit under the v0.38.0 heading

---

## Org-navi-map

```
frontend/
├── index.html                   critical inline style, verbatim NodeMode theme boot, three body roots
├── package.json                 exact pins; scripts dev, build, preview, typecheck
├── package-lock.json            lockfile, two version fields
├── tsconfig.json                strict, bundler resolution, noEmit
├── vite.config.ts               3060 and 3061 on loopback, strictPort, /api proxy to 127.0.0.1:8060
├── oc_install / .bat            npm install
├── boot_frontend / .bat         npm run dev
├── public/                      favicons (project artwork)
└── src/
    ├── main.ts                  entry: fonts, styles, theme, engine, extensions, shell, reveal
    ├── engine/
    │   ├── index.ts             headless state with granular events; dispatch, undo, redo, setSelection, the History tab's entries
    │   ├── document.ts          session model and the pure command reducer
    │   ├── editing.ts           the editing commands (Duplicate to Strip silence, fades from a range to memory locations) as pure functions of the session
    │   ├── grid.ts              grid and nudge values: notes, dotted and triplet, seconds, frames, samples; steps, lines, snapping
    │   ├── timebase.ts          the five timebases and the fifteen frame rates: timecode, Feet+Frames, Bars|Beats, Min:Secs, samples
    │   ├── describe.ts          each command in a few plain words for the History tab
    │   └── history.ts           snapshot undo and redo, 200 steps
    ├── extensions/
    │   ├── registry.ts          register, activateAll, disposeAll
    │   └── engine-link/
    │       └── index.ts         asks the engine for health, sets link state
    ├── io/
    │   ├── engine-client.ts     fetchHealth with timeout
    │   ├── media-client.ts      importFile, fetchPeaks
    │   ├── projects-client.ts   listProjects, saveProject, openProject
    │   └── render-client.ts     renderMix: POST /api/render, the WAV with its frames, peaks and loudness
    ├── ui/
    │   ├── icons.ts             fifteen NodeMode icons plus the icon() helper
    │   ├── shell.ts             the canvas's header, browser, arrangement, editor and footer, mounted once; clock and engine chip patched in place
    │   ├── browser.ts           the browser column: one search, the click hint, effect groups, Sounds sections that fold, media rows
    │   ├── browser-effects.ts   the browser's Effects tab: the realtime effects in four groups (FX_GROUPS)
    │   ├── toolbar.ts           the arrangement's toolbar: Add a track, Select, Split, Fade, Draw, Zoom, zoom, Fit, Follow; the hidden store
    │   ├── editing.ts           the Edit, Track and Clip menus' commands, their keys and dialog, Tab, zoom presets, nudge, memory locations
    │   ├── big-counter.ts       the Big Counter, a floating panel with the clock in large figures
    │   ├── counters.ts          the main counter's dialog, the sub counter, the selection's readouts, the timecode rate, the rulers chosen
    │   ├── musical.ts           the footer's Tempo, Meter and Snap with their popovers
    │   ├── dock.ts              the bottom editor: tabs, More, what the open tab works on, Ask the agent, floating panels
    │   ├── editor-tabs.ts       the editor's Effects cards, Synth and Pads
    │   ├── media-pane.ts        the session's media rows, the Sounds library as rows, Generate
    │   ├── status-bar.ts        the footer's rate and length, the toolbar hint
    │   ├── theme-menu.ts        the header's theme picker and accents; Settings repeats the accents when narrow
    │   ├── workspace-layout.ts  the browser and agent columns' widths and visibility, kept between visits
    │   ├── session.ts           wires lanes, import, undo and redo buttons, shortcuts
    │   ├── lanes.ts             keyed track lanes, clip boxes, canvas waveforms
    │   ├── import.ts            Import button, file picker, drop on the stage, notice line
    │   ├── shortcuts.ts         Cmd or Ctrl with Z, Shift Z and Y
    │   ├── transport.ts         transport buttons, playhead, click to seek, Space and Home
    │   ├── loop.ts              Loop button, L key, loop band over the lanes
    │   ├── export.ts            Export button and Cmd or Ctrl Shift E: the engine's mix as a WAV download
    │   ├── ruler.ts             timeline ruler on one canvas: time labels, loop range, regions; click to seek
    │   ├── grid.ts              the ruler's step, Grid mode (button and G) and snapping to its ticks
    │   ├── meter.ts             stereo output meter in the transport bar, 20 dB/s fall-back, latching clip indicator
    │   ├── normalize.ts         Loudness button and popover: BS.1770 normalization of the selected or all clips to a target
    │   ├── arm.ts               record arming: the armed track (interface state) and the track being recorded
    │   ├── mixer.ts             console-style mixer: a strip per track and bus (meter, fader, pan, mute, solo, output)
    │   ├── record.ts            Record button and R key, input meter, takes into the session
    │   ├── projects.ts          session name, Save, Open popover, Cmd or Ctrl S and O
    │   ├── agent-pane.ts        the Agent column: the in-app agent's 30 tools on the open session, its run loop, Undo run
    │   ├── agents.ts            Settings > Agents: formwav's MCP server added to an agent client
    │   ├── launcher.ts          the session view: slots, scenes, launch quantize
    │   ├── step-sequencer.ts    patterns: rows, velocity and swing per step, placed as note clips
    │   ├── clip-tab.ts          the Clip tab: the selected clip's settings and its tools
    │   ├── share.ts             shared editing of one session from several devices
    │   ├── inputs.ts            track inputs, native interfaces among them
    │   └── cloud.ts             File > Cloud: Google Drive and Dropbox
    ├── audio/
    │   ├── player.ts            AudioContext at the session rate, media into the worklet, bounce()
    │   ├── player-worklet.ts    AudioWorklet hosting the wasm player (public/core, built at install)
    │   ├── notes.ts             note clips rendered through the engine with the session's synth (renderNoteMedia)
    │   ├── recorder.ts          microphone into the player's context, take assembly, float32 WAV encoder
    │   └── recorder-worklet.ts  AudioWorklet capturing input chunks and peak levels
    ├── styles/
    │   ├── shell.css            formwav shell, tokens only, no z-index
    │   └── canvas.css           the agreed canvas region by region, loaded after the older layers it overrides
    └── vendor/
        └── nodemode/            verbatim MIT copies (see NOTICE)
            ├── tokens.css       tokens, 14-profile base, declared z scale
            ├── themes.ts        profiles, readChoice, applyTheme, setTheme
            └── dom-stable.ts    delayedIndicator, patchList, setText, reserve, revealApp, mountOnce
```

---

## Table of contents

- [src/engine/timebase.ts · the five timebases and fifteen frame rates (PLAN_v13 S6)](#src-engine-timebase-s6)
- [src/engine/document.ts and src/engine/editing.ts · the frame rate, Make Inactive, Commit and Consolidate (PLAN_v13 S6)](#src-engine-document-s6)
- [src/ui/counters.ts and src/ui/shell.ts · the counters, the selection and the timecode rate (PLAN_v13 S6)](#src-ui-counters-s6)
- [src/ui/ruler.ts · rulers stacked under the main one (PLAN_v13 S6)](#src-ui-ruler-s6)
- [src/ui/editing.ts · Consolidate, Commit and Inactive in the menus (PLAN_v13 S6)](#src-ui-editing-s6)
- [src/engine/grid.ts · grid and nudge values (PLAN_v13 S5)](#src-engine-grid-s5)
- [src/engine/document.ts · editing depth in the session (PLAN_v13 S5)](#src-engine-document-s5)
- [src/engine/editing.ts · editing depth's commands (PLAN_v13 S5)](#src-engine-editing-s5)
- [src/ui/editing.ts · the Track and Clip menus, nudge and memory locations (PLAN_v13 S5)](#src-ui-editing-s5)
- [src/ui/lanes.ts · what the lanes draw and range copy and paste (PLAN_v13 S5)](#src-ui-lanes-s5)
- [src/ui/labels-pane.ts · memory locations (PLAN_v13 S5)](#src-ui-labels-pane-s5)
- [src/ui/musical.ts and src/ui/clip-tab.ts · Snap's dialog and the Clip tab (PLAN_v13 S5)](#src-ui-musical-s5)
- [src/engine/editing.ts · editing commands (PLAN_v13 S4)](#src-engine-editing-s4)
- [src/engine/document.ts · time that carries automation and marks (PLAN_v13 S4)](#src-engine-document-s4)
- [src/ui/editing.ts · the editing commands in the interface (PLAN_v13 S4)](#src-ui-editing-s4)
- [src/ui/toolbar.ts · the Zoom tool (PLAN_v13 S4)](#src-ui-toolbar-s4)
- [src/ui/lanes.ts · AU-13, a page turn moves nothing (PLAN_v13 S4)](#src-ui-lanes-s4)
- [src/ui/export.ts · bounce and files (PLAN_v13 S3)](#src-ui-export-s3)
- [src/ui/mixer.ts · the mixer basics (PLAN_v13 S2)](#src-ui-mixer-s2)
- [src/audio/player.ts · the mixer basics (PLAN_v13 S2)](#src-audio-player-s2)
- [src/ui/editor-tabs.ts · gain reduction (PLAN_v13 S2)](#src-ui-editor-tabs-s2)
- [src/engine/describe.ts](#src-engine-describe)
- [src/styles/canvas.css](#src-styles-canvas)
- [src/styles/tokens.css](#src-styles-tokens)
- [src/audio/notes.ts](#src-audio-notes)
- [src/ui/browser.ts](#src-ui-browser)
- [src/ui/browser-effects.ts](#src-ui-browser-effects)
- [src/ui/dock.ts](#src-ui-dock)
- [src/ui/editor-tabs.ts](#src-ui-editor-tabs)
- [src/ui/file-menu.ts](#src-ui-file-menu)
- [src/ui/media-pane.ts](#src-ui-media-pane)
- [src/ui/midi-input.ts](#src-ui-midi-input)
- [src/ui/musical.ts](#src-ui-musical)
- [src/ui/status-bar.ts](#src-ui-status-bar)
- [src/ui/theme-menu.ts](#src-ui-theme-menu)
- [src/ui/toolbar.ts](#src-ui-toolbar)
- [src/ui/voice-pane.ts](#src-ui-voice-pane)
- [src/ui/workspace-layout.ts](#src-ui-workspace-layout)
- [src/ui/agent-pane.ts](#src-ui-agent-pane)
- [src/ui/agents.ts](#src-ui-agents)
- [src/ui/launcher.ts](#src-ui-launcher)
- [src/ui/step-sequencer.ts](#src-ui-step-sequencer)
- [src/ui/clip-tab.ts](#src-ui-clip-tab)
- [src/ui/share.ts](#src-ui-share)
- [src/ui/inputs.ts](#src-ui-inputs)
- [src/ui/cloud.ts](#src-ui-cloud)
- [index.html](#index-html)
- [vite.config.ts](#vite-config)
- [src/main.ts](#src-main)
- [src/engine/index.ts](#src-engine-index)
- [src/extensions/registry.ts](#src-extensions-registry)
- [src/extensions/engine-link/index.ts](#src-extensions-engine-link)
- [src/io/engine-client.ts](#src-io-engine-client)
- [src/ui/icons.ts](#src-ui-icons)
- [src/ui/shell.ts](#src-ui-shell)
- [src/styles/shell.css](#src-styles-shell)
- [src/engine/document.ts](#src-engine-document)
- [src/engine/history.ts](#src-engine-history)
- [src/io/media-client.ts](#src-io-media-client)
- [src/ui/session.ts](#src-ui-session)
- [src/ui/lanes.ts](#src-ui-lanes)
- [src/ui/import.ts](#src-ui-import)
- [src/ui/shortcuts.ts](#src-ui-shortcuts)
- [src/ui/transport.ts](#src-ui-transport)
- [src/audio/player.ts](#src-audio-player)
- [src/audio/player-worklet.ts](#src-audio-player-worklet)
- [src/ui/record.ts](#src-ui-record)
- [src/audio/recorder.ts](#src-audio-recorder)
- [src/audio/recorder-worklet.ts](#src-audio-recorder-worklet)
- [src/ui/projects.ts](#src-ui-projects)
- [src/io/projects-client.ts](#src-io-projects-client)
- [src/ui/loop.ts](#src-ui-loop)
- [src/ui/export.ts and src/io/render-client.ts](#src-ui-export)
- [src/ui/ruler.ts and the v0.13.0 timeline](#src-ui-ruler)
- [src/ui/grid.ts, the clip gain line and the transport row (v0.15.0)](#src-ui-grid)
- [src/ui/meter.ts and the output level path (v0.17.0)](#src-ui-meter)
- [src/ui/normalize.ts and group trims (v0.24.0)](#src-ui-normalize)
- [src/ui/arm.ts and recording into a track (v0.25.0)](#src-ui-arm)
- [src/ui/mixer.ts and the mute and solo commands (v0.33.0)](#src-ui-mixer)
- [src/vendor/nodemode/](#src-vendor-nodemode)

---

## src/ui/inspector-pane.ts and src/i18n/added/clip-names · Clip sound, Enhance spoken, Remixer (v2.20.3) {#src-ui-clip-names}

### Three labels renamed so no other product's feature name is on screen

- refers-to: src/ui/inspector-pane.ts (the clip section head, the voice button, the effect list, the analyze row's remix button, two notices), backend/app/services/effects.py (`GROUPS`, the "Clean up" group), src/i18n/added/clip-names/<code>.json
- The clip-type section is Clip sound, the one-click voice clean is Enhance spoken and the beat re-arrangement button is Remixer (fit to length); the family IP plan approved by the owner on 2026-10-23 chose the names. The effect id `voice-clean`, the action `remix-length`, `/api/media/{id}/remix`, `mountEssentialSound` and the file name `essential-sound.ts` stay, so sessions, presets and agent calls are unchanged.
- The new strings are in `added/clip-names` in all 25 languages, as the i18n rule asks; the base tables keep their old entries, which nothing looks up any more. Enhance spoken reuses each language's existing words for the voice clean; Remixer is kept as a name.
- Not run: the interface test that lists untranslated strings (it needs the browser rig).

## src/engine/timebase.ts · the five timebases and fifteen frame rates (PLAN_v13 S6) {#src-engine-timebase-s6}

### The timebases for formwav's one tempo and its timecode start in seconds
- refers-to: src/engine/timebase.ts (FRAME_RATES, frameRate, nominal, framesAt, samplesAtFrame, timecodeFromFrames, timecodeToFrames, formatTimecode, parseTimecode, feetFrames, TIME_FORMATS, timeContext, barBeatAt, samplesAtBarBeat, formatPosition, formatLength, parsePosition)
- kind: rationale
- logged: v2.14.5 · 2026-10-08

Frames count real frames (24000/1001 a second at 23.976) in exact integer arithmetic (BigInt for the products, so a floor never slips at a boundary however long the session); drop-frame leaves out the first two labels of each minute (four at 59.94) except every tenth, and the backend test holds it frame for frame against labels walked one at a time from that rule. The session keeps its timecode start in seconds, so it is turned into a whole frame count at the rate in use (a session start is one frame's label) and added to the frames, rather than into samples, which would round a 29.97 start a sample short and read 00:59:59;29 at the session's first sample. Bars|Beats counts quarters at the session's one tempo and meter, 960 ticks a quarter, a position rounded to its tick half away from zero (so positions either side of zero round alike), until S11's maps. Min:Secs is the minutes-first form (0:03.000) for the readouts, the sub counter and the rulers; the main counter keeps the clock's hours-first form. Min:Secs also reads hours typed in, so a clock's own text reads back.

## src/engine/document.ts and src/engine/editing.ts · the frame rate, Make Inactive, Commit and Consolidate (PLAN_v13 S6) {#src-engine-document-s6}

### The rate in the session, an inactive track, a commit as one command, a consolidate as a whole batch
- refers-to: src/engine/document.ts (SessionDoc.frameRate, Track.inactive, set-frame-rate, set-tracks-inactive, commit-track); src/engine/describe.ts; src/engine/editing.ts (consolidate); src/audio/player.ts (planClips skips an inactive track, its solo silencing nothing)
- kind: rationale
- logged: v2.14.5 · 2026-10-08

The rate lives in the session, because a timecode means nothing without it; absent, a session counts 30, what the clock and grid counted before (ui/shell.ts lets this browser's old clock rate stand in). An inactive track is left out of the player's plan and the export's (and of the solo test: an inactive soloed track silences nothing), kept whole, so making it active again restores it exactly. commit-track is one command because the new track's id is made inside the reducer and the original must turn inactive and hidden in the same step: the committed track takes the media the engine rendered, sits right below at 0 dB and centred (the render holds the fader, pan and automation, which the core runs ahead of the inserts), with the original's colour, routing and sends, and no VCA, whose level the render printed; one undo brings the original back as it was. consolidate is a whole batch of clear-range and import-media onto the track, so a lock that refuses the clearing refuses the placing too.

## src/ui/counters.ts and src/ui/shell.ts · the counters, the selection and the timecode rate (PLAN_v13 S6) {#src-ui-counters-s6}

### A dialog over the clock, a sub counter in the length's place, readouts at the toolbar's end
- refers-to: src/ui/counters.ts (RULERS, rulers, mountCounters: the readouts, the sub counter, the dialog); src/ui/shell.ts (ClockMode, CLOCK_MODES, setClockMode, timecodeRate, timeOf, parseTimecodeSeconds, formatClock, the legacy clock modes, the tray's readouts and hint markup); src/ui/status-bar.ts (the hint's inner text); src/ui/big-counter.ts, src/ui/grid.ts (frameRate from the session), src/ui/inspector-pane.ts (TC start at the session's rate); src/main.ts; src/styles/canvas.css
- kind: rationale
- logged: v2.14.5 · 2026-10-08

The clock opens a dialog rather than cycling, as Snap's did in S5: five timebases, a sub counter, fifteen rates and six rulers are too many for a cycle. The timebases and rulers are this browser's choice, kept in localStorage like the old clock mode, since they change how a session is seen, not the session; the rate changes what a timecode means, so it is a command and a History step. A clock saved as tc24, tc25, tc2997df or tc30 becomes the Timecode main counter, its rate kept as this browser's rate for sessions without one. The sub counter takes the session length's place under the clock, a line of fixed height in a column the clock's 12ch holds. The readouts follow the lanes' range or selected clips (their own events), else the playhead, in the main counter's timebase; each column's least width is its timebase's widest usual reading (9ch for Min:Secs and Feet+Frames, 10ch for samples and bars, 11ch for timecode), so figures change without moving anything, and the box is a container whose queries drop End, then Start, as the toolbar narrows (1280 keeps Start and Length in Min:Secs, Length alone in timecode). Its basis is the width it needs, and the select tool's hint, which shared the space at 1710, now sits in a container of its own and hides whole below its 344 px rather than show an ellipsis, which the fit test counts; at 1710 it shows beside Min:Secs and hides beside timecode.

## src/ui/ruler.ts · rulers stacked under the main one (PLAN_v13 S6) {#src-ui-ruler-s6}

### 20 px rows on the one paint canvas, named in the corner column
- refers-to: src/ui/ruler.ts (drawRow, placeRows, the main row's height from the corner, the main counter's timebase on the main row); src/styles/canvas.css (.fw-ruler's rows, .fw-ruler-names)
- kind: rationale
- logged: v2.14.5 · 2026-10-08

The rulers chosen are rows under the main one, painted on the same window-wide canvas (AU-13's design) and taking the same clicks (seek, or drag a loop); the ruler grows by 20 px a row, set before its first paint from the saved list, so a session opens at its full height, and changes only when a ruler is turned on or off. The main row keeps its 35 px, its markers, regions and loop, and now ticks only its own height. Each timebase spaces its labels for itself: Min:Secs at the main ruler's steps, samples at 1, 2 and 5 times a power of ten at least 90 px apart, bars doubling until 60 px with beat ticks from 240 px a bar, timecode on 1, 2, 5 or 10 frames and then whole seconds and minutes, Feet+Frames on half feet, feet and tens of feet, at least 72 px apart. With the main counter in timecode, Feet+Frames or samples, the main row labels in it; Bars on the ruler still wins, as before.

## src/ui/editing.ts · Consolidate, Commit and Inactive in the menus (PLAN_v13 S6) {#src-ui-editing-s6}

### The engine renders, the interface places; the lanes and mixer dim an inactive track
- refers-to: src/ui/editing.ts (bounceTrack, consolidateSelection, commitTrack, Edit > Consolidate, Track > Inactive and Commit, Alt Shift 3 and Alt Shift C, View > Counters and rulers); src/ui/lanes.ts (data-inactive, "Inactive" in the head's line); src/ui/mixer.ts (data-inactive on the strip); src/styles/canvas.css
- kind: rationale
- logged: v2.14.5 · 2026-10-08

Consolidate and Commit post the session to the engine's /api/render/bounce (backend services/bounce.py), which renders through the core as the export does and stores the result as media, then dispatch one step; run() reports a lock in the way. Consolidate takes the range, or the selected clips on one track, and leaves the new clip selected when clips were; Commit acts on the picked track and refuses one placed on the surround pad, whose place a stereo render would lose. Inactive is a checked item on the picked track. An inactive lane and strip are drawn at 45 % with "Inactive" in the head's line, attributes on the nodes the lanes and mixer already keep, so nothing is rebuilt.

## src/engine/grid.ts · grid and nudge values (PLAN_v13 S5) {#src-engine-grid-s5}

### Grid values for one tempo and meter
- refers-to: src/engine/grid.ts (GridValue, GRID_CHOICES, NUDGE_DEFAULT, gridShort, parseGrid, gridStepOf, lineAtOrBefore, nextLine, snapToGrid, gridLines); src/ui/grid.ts (gridDoc, frameRate, fixedGrid, gridCuts, snapSamples)
- kind: rationale
- logged: v2.14.4 · 2026-10-08

For formwav's single tempo and n/4 meter a note value is quarters at the session's tempo and a bar is beatsPerBar quarters; dotted multiplies by 3/2, triplet by 2/3. A note value's lines are counted from the bar line before them, so a value that does not divide the bar starts again on each downbeat (a dotted quarter in 4/4 lies at 0, 1.5 and 3 beats and then at the next bar's start), which keeps a dotted or triplet grid anchored to the music rather than drifting across bars; seconds, frames and samples count from the session start. Positions stay fractional until snapped (a frame at 29.97 is 1601.6 samples) and a small epsilon keeps a position exactly on a line from flooring below it. Ids are strings (1/16, 1/8t, 1/4., bar, 0.5s, 1f, 100smp) kept in the session's snap settings, so they save with it and an undo reaches them; absent, the grid follows the zoom as before and the nudge is 0.1 s. A frame counts at the clock's timecode rate, 30 while it shows time: the session has no frame rate of its own until S6. The Grid button and G still turn snapping on and off; choosing a value turns it on.

## src/engine/document.ts · editing depth in the session (PLAN_v13 S5) {#src-engine-document-s5}

### Clip mute, the locks, names, a fade-out's own shape, memory locations and the track commands
- refers-to: src/engine/document.ts (FADE_SHAPES logarithmic, fadeCurve, fadeCode, Clip.fadeOutShape, name, mute, lock; Track.hidden, height, comments; Marker and Region number, comment, color; snap value and nudge; pasteLane, memoryNumbers, nextMemoryNumber, memoryFields, refusedByLock; a batch's whole; set-clip-fades outShape, set-clips-mute, set-clips-lock, rename-clip, duplicate-track, move-track, set-tracks-hidden, set-track-height, set-track-comments, crossfade's edges); src/engine/describe.ts
- kind: rationale
- logged: v2.14.4 · 2026-10-08

A fade-out's own shape is a field beside the one shape a clip had, so every older session plays as it did; set-clip-fades' shape stays the fade-in's (and the fade-out's while it has none), outShape sets the fade-out's own and null makes it follow again, so the callers that passed the clip's shape back to keep it keep both. The core takes both shapes in its one code (fadeCode, render.rs fade_shapes): below 16 a single shape, as every code was. crossfade now shapes only the edges that meet, each clip's other edge keeping its shape. The locks are one field (time, or edit, which includes time) checked by refusedByLock before any command runs, so every path is held, the agent's and a batch's parts included: either lock refuses a move, a trim that slides the audio against the timeline (a time-locked clip can still be trimmed in place) and time opened or closed ahead of the clip on its track; an edit lock also refuses a split, a removal, fades and any change of the clip's audio, but not its gain, name, colour or mute. A batch whose parts depend on each other carries whole and is refused whole when a lock refuses any part as it comes to it, the session returned as it was: refused part by part it would leave half an edit (a paste on top of a locked clip whose clearing was refused, half a crossfade, copies over audio that did not move aside, a stretched file in a clip that did not move). A plain batch still applies part by part, so an edit made clip by clip skips the locked clips. Memory location numbers are their own field so they stay put; markers made before numbers take the free numbers in time order (memoryNumbers), and a new one takes the lowest free number. duplicate-track copies the track whole below it with new clip ids, out of any group (a group is a selection on one track's clips) and not a stem of anything; set-track-height stores small, large or jumbo and drops medium.

## src/engine/editing.ts · editing depth's commands (PLAN_v13 S5) {#src-engine-editing-s5}

### Fades from a range, range copy and paste, nudge, Space clips, snapping and memory locations
- refers-to: src/engine/editing.ts (nudgeClips, createFades, deleteFades, fadeToPlayhead, RangeClip, copyRange, pasteRange, muteClips, lockClips, spaceClips, snapClips, MemoryLocation, memoryLocations, findMemory, nextMemory; separateOnGrid takes a value's lines)
- kind: rationale
- logged: v2.14.4 · 2026-10-08

createFades works on a selection: at a butt splice inside the range each clip reaches into the other's side as far as the range and its file allow (the left clip's audio after its end, the right clip's before its start, counted in session samples so a file at another rate reaches as far), each fading over the whole overlap, so a linear crossfade of a split adds to one and plays as the unsplit clip; outside crossfades a range from at or before a clip's start into it fades it in, one from inside it past its end fades it out. pasteRange clears what lies there (or, with Shuffle, opens time) and pastes the copied pieces, then writes each lane the source track had through pasteLane: inside the paste the source's values, outside the destination's, a lane made from the destination's fader or pan where it had none; a source without a lane leaves the destination's as it was, so pasting audio from a plain track never rewrites another's automation. A lane keeps 0.01 dB (set-automation), so the pasted second matches its source within that. Space clips lays a track's selected clips out from the first one's start, a gap apart end to start or start to start; snapping moves each selected clip up against its nearest unselected neighbour; both use formwav's layering moves (move-clip), and a locked clip is left out of both. Nudge is Shift's arithmetic by the nudge value, locked clips left out. Create fades, pasteRange, and S4's repeatSpan and fitToRange return whole batches (batch's third argument), their parts depending on each other.

## src/ui/editing.ts · the Track and Clip menus, nudge and memory locations (PLAN_v13 S5) {#src-ui-editing-s5}

### Which track a Track command acts on, the keys, and the dialog's text and choice fields
- refers-to: src/ui/editing.ts (current, latest, trackNow, onTrack, the Track and Clip menus, rename, space, nudge, makeFades, recall, addMemory, the keypad sequence, fw-recall-memory); src/ui/shell.ts (the Track and Clip menus); src/ui/dock.ts (a clip's own name in the head)
- kind: rationale
- logged: v2.14.4 · 2026-10-08

formwav has no track selection of its own, so a Track command acts on the track picked last: a click on its head or an empty stretch of its lane (the lanes' fw-track event), a clip on it, or a range on it. The keys: Alt Shift D duplicates a track; the comma and the full stop nudge, and the keypad's minus and plus too (the main row's minus and plus keep zooming, so the lanes now ignore the keypad's); Cmd or Ctrl F creates fades only with a range drawn, so the browser's find still works otherwise; Enter adds a memory location only with nothing focused but the page or the lanes, so a focused button still takes its own Enter; the keypad's point, digits and point (or Enter) recall a number within three seconds, which a laptop without a keypad does from the list or previous and next instead (Alt and a number switches tabs in some browsers). The small dialog gained text and choice fields: a text field shows the current value rather than the last one typed, and Enter in a choice confirms as in a number. Muting and locking toggle the selection as one: mute all when any is unmuted, unlock when every one has that lock, so a mixed selection always ends in one state. run() says when a command changed nothing while a clip is locked, so a whole batch refused by a lock (Duplicate, Repeat, Create fades) does not report itself done; Fit to selection in the Inspector says the same.

## src/ui/lanes.ts · what the lanes draw and range copy and paste (PLAN_v13 S5) {#src-ui-lanes-s5}

### Mute, locks, names, each fade's curve, heights, hidden tracks, the picked track, a range on the clipboard
- refers-to: src/ui/lanes.ts (clipNode's lock badge, updateClip's name, data-mute and lock, paint's curve per edge, updateLane's height and comments, hideLane, the fade handle's click, the drag refused on a locked clip, the fw-track listener, rangeClip, the keydown's range copy, cut and paste, the zoom keys and the keypad); src/ui/mixer.ts (hidden strips); src/ui/ruler.ts (a memory location's colour); src/styles/canvas.css
- kind: rationale
- logged: v2.14.4 · 2026-10-08

Every new state is an attribute or a field on nodes the lanes already keep (data-mute, the lock badge's hidden flag, data-height, data-current), so nothing is rebuilt; a height change paints the lane's waves again a frame later at the new size. A click on a fade changes that fade's curve alone, the other edge's shape passed back unchanged. A drag that a lock refuses does not start, and the notice says which lock and where it is undone. The clipboard holds whole clips or a range, the last copy winning: with a range drawn, Cmd or Ctrl C and X take the range (X clears it as Delete does, Shuffle closing it); Cmd or Ctrl V pastes a range at the range's start, or at the playhead, on the range's track, else the track picked last (pickedTrack: a click on its head or an empty stretch of it, or a press on one of its clips, whichever came last), else the track it came from, and the range moves onto what was pasted. A paste or cut a lock refuses changes nothing and says so (a cut still copies). A pasted clip keeps its fade-out shape, name and mute. Hidden tracks leave the mixer as well as the lanes.

## src/ui/labels-pane.ts · memory locations (PLAN_v13 S5) {#src-ui-labels-pane-s5}

### Rows patched by id, with number, colour and comment
- refers-to: src/ui/labels-pane.ts (Label number, comment, color; labelRow, updateLabelRow, render with patchList; Previous and Next; fw-recall-memory); src/styles/workspace.css (.fw-label-row's two rows, .fw-label-num)
- kind: rationale
- logged: v2.14.4 · 2026-10-08

The list was rebuilt (replaceChildren) whenever a label came, went or moved, which lost a name being typed in another row; it is now patched by each label's id, rows created once and updated in place, a field being typed in never overwritten. The number recalls its memory location through the editing module (fw-recall-memory), which seeks and, for a region, sets the range again on the picked track. New markers and regions are named after the number they will take.

## src/ui/musical.ts and src/ui/clip-tab.ts · Snap's dialog and the Clip tab (PLAN_v13 S5) {#src-ui-musical-s5}

### Snap opens a dialog; the Clip tab's new fields go under its actions
- refers-to: src/ui/musical.ts (choices, setSnap, the snap, grid and nudge selects; the readout); src/ui/clip-tab.ts (Clip name, Fade-out shape, Mute, Lock under the actions; Fade shape sets both fades); src/ui/inspector-pane.ts (Fade curve sets both, logarithmic listed); src/styles/canvas.css (the selects' width, the readout's reserved width)
- kind: rationale
- logged: v2.14.4 · 2026-10-08

Snap stepped Off, Grid, Beats on each click; it now opens the footer's small dialog with Snap, Grid and Nudge (the G key still toggles), and its readout shows a chosen grid value (1/16, 1/8T, 0.1 s) in a width reserved for it. The Clip tab's four new fields sit under the actions with its source and colour, since the canvas keeps the actions in view at all three sizes (a third row of fields pushed them out, which the fit test caught); its Fade shape sets both fades, as the Inspector's Fade curve does, and Fade-out shape the fade-out's own.

## src/engine/editing.ts · editing commands (PLAN_v13 S4) {#src-engine-editing-s4}

### Each command a pure function of the session, one labelled batch each
- refers-to: src/engine/editing.ts (EditTarget, editSpan, clipPiece, repeatSpan, shiftClips, insertSilence, timeOperation, trimToRange, trimToPlayhead, trimToFile, trimToFill, reach, continues, healSeparations, separateOnGrid, stripGaps, identifyBeat, fitToRange, clipTransients, nextStop); src/engine/describe.ts (a batch's label)
- kind: rationale
- logged: v2.14.3 · 2026-10-08

The commands are built in the engine layer from the lanes' range or selected clips and dispatched by the interface, so each is one undo step with its own words in History and each runs in Node exactly as the interface runs it (backend/tests/editing.mjs). What a command acts on: a range on one track (the Smart Tool's), else the selected clips' tracks from the first start to the last end. Duplicate and Repeat follow the Slip mode: their copies take the place of what lies there (clear-range, then paste-clip), not added to it as formwav's paste adds, and with Shuffle on they open the time first (insert-time on the span's tracks); a range's copy is cut at its edges as split-clip cuts (clipPiece, counting the file's own rate), a clip's copy keeps every property but its id, its group and the launcher's flag; the automation in the span is copied with it (copyLane) through set-automation, so its values keep set-automation's 0.01 dB. Shift moves selected clips only, stopped at the session start by the earliest. Insert silence opens the span's length at its start on its tracks, their automation following; Insert and Cut time do it on every track, with markers, regions and the loop. The trims go through set-clip-bounds, a length to a file's end counted as set-clip-bounds counts its reach (reach): a 44.1 kHz file in a 48 kHz session rounds by a sample, and one sample over was refused without a word. Heal joins neighbours that carry on from one another as a split leaves them: end to start, no fade at the join, the same file read on (within one of the file's samples, since a file at another rate rounds each split by up to one, and pieces of one split made in two orders differ by that), all else equal; so the healed clip plays as the pieces did. With a range it heals the joins in it, with clips selected the pairs both selected, else the join at the playhead. Separate on the grid cuts at every grid line from the session start inside the range, its edges included, or inside each selected clip, on the grid the zoom shows (gridStep in src/ui/grid.ts), refusing a grid finer than a sample or more than 2000 lines. Strip silence's gaps come from the engine's activity regions (the track rendered alone through ffmpeg's silencedetect, the threshold typed or the track's loud level less 20 dB, the minimum length as silencedetect's duration), padded before and after, merged where the pads meet, and cleared without ripple between them inside the selection. Identify Beat is bars times beats times 60 times the rate over the selection's samples. TCE to a selection is the whole-file stretch Fit to length already makes, then set-clip-bounds to the range's start and length as far as the render reaches, in one batch. Tab's stops are the clip edges on the tracks in question, transients mapped from a media's own seconds (clipTransients).

## src/engine/document.ts · time that carries automation and marks (PLAN_v13 S4) {#src-engine-document-s4}

### insert-time, clear-range and clear-ranges with follow
- refers-to: src/engine/document.ts (laneValue, insertLane, cutLane, copyLane, mapLanes, insertMarks, cutMarks; follow on insert-time, clear-range and clear-ranges; batch's label)
- kind: rationale
- logged: v2.14.3 · 2026-10-08

The field is opt-in, so the transcript's word edits, the agent's tools and move-range (whose own closing of the gap would no longer match) still move clips only. Follow "tracks" moves the listed tracks' automation with their clips: volume in gain, pan and the filters' parameters as they are. "session" also moves the markers not on a clip, regions and the loop; a marker on a clip follows its clip already (followClips), and moving it here as well moved it twice. A lane keeps its values on both sides of the edit, so the audio around it plays as before: at an insert across a ramp, a point either side of the opening at the ramp's value there; at a cut, one on the sample before it at its value and one at the cut with the value of the first sample after it, a step where the two differ. Points are read as the core reads them (linear between points, in gain for volume, held outside them); the export after a cut across a ramp equals the export before with the cut taken out to 1e-5 (backend/tests/test_editing.py). A lane flat across the edit, or with no points on one side, just moves. A cut drops the markers inside it and cuts a region or the loop to what lay outside, removing one left empty. Delete with Shuffle passes follow "tracks". A batch's label is what History lists for it; without one, the first command's words, as before.

## src/ui/editing.ts · the editing commands in the interface (PLAN_v13 S4) {#src-ui-editing-s4}

### Menus, keys, the dialog, Tab, zoom presets, Identify Beat, TCE and the Big Counter
- refers-to: src/ui/editing.ts (mountEditing: the fw-range and fw-selection listeners, ask and its dialog, duplicate, repeat, shift, timeOp, needRange, stripSilence, tabTo, preset, zoomToSelection, separateGrid, the menu items, the keydown handler); src/ui/big-counter.ts; src/ui/lanes.ts (fw-select-clips, fw-set-range, zoomToSpan); src/ui/musical.ts (Identify); src/ui/inspector-pane.ts (fit-selection); src/ui/shell.ts (the stage's tabindex); src/ui/transport.ts (Space leaves the stage focused); src/styles/workspace.css (.fw-ask-*); src/styles/canvas.css (.fw-menu-zoom, .fw-big-counter, .fw-stage:focus)
- kind: rationale
- logged: v2.14.3 · 2026-10-08

The commands sit in the Edit menu after Redo, in a module of their own that hears the lanes' range and selection by their events and asks the lanes to select what a command made (fw-select-clips, fw-set-range): a duplicated range moves onto its copy, so a second Duplicate carries on from it, and a strip of selected clips leaves what remains of them selected. Keys: Cmd or Ctrl D Duplicate (taken only with a session open, so the browser keeps its bookmark key otherwise), Alt R Repeat, Alt H Shift, Alt T Trim to selection, read by key code so Option on a Mac works; Cmd T and Cmd H belong to the browser and the Mac, and the Insert Silence key is formwav's Export, so those stay in the menu. One dialog serves every command that asks for values (Repeat's copies, Shift's seconds, Strip silence's threshold, minimum length and pads): its fields are made while it is closed, so nothing flashes; Enter confirms; a command's last values come back; it is centred (margin auto, as a modal dialog is by default), unlike the older dialogs left for the owner at S3. Enter blurs the field before closing: left focused inside the closed dialog until the browser moved focus, the field took the next key, so a shortcut pressed straight after (Alt H after a Repeat) reached nothing, one run in three in the interface test. Tab and Shift Tab move the playhead only while the lanes have focus: the stage takes focus from a click (tabindex -1), so a keyboard user's Tab still walks the controls and is never caught there, and Space no longer blurs the stage. With Tab to transients on (Transport menu), each media's transients come from the engine once and are stops too. Zoom presets 1 to 5: a key recalls, with Shift stores, the View menu's row does both (Shift-click), kept in localStorage, a per-viewer convenience that lasts the visit where storage is refused. Zoom to selection fits the range, the selected clips or the loop with 12 px either side (zoomToSpan). Identify Beat sits in the tempo popover beside Tap, taking the selection from the same events. Fit to selection, in the Inspector's Quantize card beside Fit to length, fits the clip to the range, else the loop, within the half to double the stretch allows. The Big Counter floats at the companion layer with the footer clock's text, in its format and timecode start, at 44 px in tabular figures 13 characters wide so a mode change does not resize it, dragged by its head within the window; its View menu item is checked while it is open.

## src/ui/toolbar.ts · the Zoom tool (PLAN_v13 S4) {#src-ui-toolbar-s4}

### Click, Alt-click and a dragged span; the hint hides before it would be cut
- refers-to: src/ui/toolbar.ts (HINTS.zoom, the Zoom button moved after Draw, zoomBox, zoomGesture, the zoom branch of the stage's capture pointerdown); src/ui/shell.ts (the Zoom button); src/styles/canvas.css (the zoom-in cursor; the hint's 940 px container rule)
- kind: rationale
- logged: v2.14.3 · 2026-10-08

A click zooms in twice, keeping the time under the pointer where it was (the scroll moves by that time over the new samples a pixel less over the old); Alt-click zooms out; a drag of 4 px or more draws a box in the marquee's look and zooms so its span fills the view. The click that follows is swallowed (it would seek or select), and the stage's capture handler stops the lanes' own gestures, so a zoom keeps the range. The fifth tool took 56 px from the toolbar: at 1440 the hint ("Space plays. S splits...") then needed 344 px and had 316, cut by its ellipsis, which the fit test counts; it now hides below a 940 px timeline pane (it hid below 880, a rule the editor's head keeps), so it shows whole at 1710 and not at all at 1440 and 1280. The Zoom tool's own hint is short enough for 1440.

## src/ui/lanes.ts · AU-13, a page turn moves nothing (PLAN_v13 S4) {#src-ui-lanes-s4}

### The waves placed by a transform and painted as the page turns, the ruler too; the phase dot by a transform
- refers-to: src/ui/lanes.ts (peakReady, paint's translateX, the stage's fw-scrolled listener); src/ui/ruler.ts (fw-scrolled draws); src/ui/transport.ts (placePlayhead dispatches fw-scrolled after a page turn); src/ui/meter.ts (place)
- kind: rationale
- logged: v2.14.3 · 2026-10-08

Found at S2: with Follow on, each page turn while playing shifted the ruler's paint canvas and the clip's wave for a frame (0.0106 and 0.0196 a turn at 1440). Both canvases cover only what is in view, and were moved to the new view from the stage's scroll event, a frame after the page itself. Follow now tells them as it turns the page (a synchronous fw-scrolled event), and the waves paint from the peaks already here (peakReady), so the new view is drawn in the frame that scrolls. That left one shift, at the first turn after a clip's start inside the view: the wave canvas's left offset inside its clip jumped from 0 and its width grew, which the layout shift API counts even in the frame of the scroll; the canvas is placed by a transform now, which it never counts. The phase dot moved by its left offset, a shift of about 1e-6 while playing; it moves by a transform from the track's centre. Measured: no layout shift through the page turns at 1440, at 4x CPU too, and the interface test that plays through them with a clip starting inside the view fails with the left offset back (0.0192).

Found, not S4's, and recorded: a Strip silence that removes the selected clip whole (all of it below the threshold) empties the selection when the engine answers, about a second after the click, and the editor head's context (to "No clip selected") and the agent column's context line (gone, its foot 31 px shorter) change then, past an input's half second: 0.0012 in the throttled check. Any edit that removes the selected clip after an engine round trip does the same; holding those two lines' sizes is a canvas change for the owner to decide.

## src/ui/export.ts · bounce and files (PLAN_v13 S3) {#src-ui-export-s3}

### The Export dialog's range, formats, dither and normalise, in rows that never move
- refers-to: src/ui/export.ts (the format list; the range-row, span-row, dither-row and normalize-row; DITHERED, enable, showPlatform, resolveRange, smartRange from fw-range; the notice); src/io/render-client.ts (ExportOptions start, end, normalize, dither; Mix truePeak, normalizeDb); src/styles/workspace.css (.fw-export-span, .fw-export-opt, .fw-export-dialog [data-off])
- kind: rationale
- logged: v2.14.2 · 2026-10-08

The dialog offers the engine's twelve formats as thirteen entries (WAV at 32-bit float, 32, 24 and 16-bit; AIFF at 24 and 16; AIFF-C float; FLAC at 24 and 16; MP3 twice, OGG, M4A), a range (the whole session, the Smart Tool's selected range from the lanes' fw-range events, the loop, or From and To in seconds, To prefilled with the session's length), the dither switch (TPDF, on by default, for the 16 and 24-bit formats of a mix, stems or multichannel) and a peak to normalise a mix to (-0.1 dBFS by default), each kept for the next export as the format is. The range, dither and normalise rows are always there and switched off (disabled, at 0.45 opacity) where they do not apply, rather than hidden: hiding them made every format or range choice move the rows below, which the throttled check counted as shifts without input when a choice came from the keyboard or a script (Playwright's selection); shown and switched off, the dialog's whole path, from opening it through an export and its notice, measured no layout shift at all under 4x CPU and a slow network. The two older rows (the multichannel channel order, the preview's platform) still appear only for their kind of export. The notice adds the true peak, the gain normalising applied, and for MP3, OGG and M4A a warning when the true peak passes -1 dBTP, where the encoder can push it over full scale; the clipping warning now spares both float formats.

Found and left for a later phase: every modal dialog (Export, Agents, Cloud, the latency probe, Devices) sits at the window's top left, because tokens.css's universal reset (`* { margin: 0 }`) removes the browser's own `margin: auto` for a modal dialog. Centring them is one rule, but a centred dialog whose height changes moves its top edge, so each dialog's height is to be held first; the owner sees it before it changes.

## src/ui/mixer.ts · the mixer basics (PLAN_v13 S2) {#src-ui-mixer-s2}

### Solo safe and solo alone, clearing, trim, polarity, Off, bypass by kind, the pan law, the peak hold and the clip light
- refers-to: src/ui/mixer.ts (stripNode, updateStrip, the bar's clear-solos, clear-mutes, .fw-mix-bypass and .fw-mix-panlaw, the strips' click, input and change handlers, hold); src/engine/document.ts (Track.soloSafe, trimDb, invert and autoOff, SessionDoc.panLaw, set-track-solo's exclusive, set-track-solo-safe, set-track-trim, set-track-invert, set-track-automation-off, clear-solos, clear-mutes, set-pan-law, bypass-fx-category, FxCategory, fxCategory); src/engine/describe.ts (their words); src/styles/canvas.css (.fw-dock .fw-mixer-bar as a grid, .fw-out-hold, .fw-strip-clip, .fw-strip-solo[data-safe], .fw-strip-invert, .fw-strip-trim-row)
- kind: rationale
- logged: v2.14.1 · 2026-10-07

formwav's mixer lacked these. Solo keeps its plain click; Alt-click solos the track alone (set-track-solo with exclusive, the others unsoloed in the same step), and Cmd or Ctrl-click makes it solo safe, marked by a line under S and its title; the player and the export leave a solo-safe track in a soloed mix. Clear solos and Clear mutes act on every track at once, one step each. Trim (plus or minus 24 dB, in 0.1 dB) and Invert sit in Route, after the routing, since the strip has no room beside M and S at the dock's height (Route scrolls inside its box, as it did for the send and the automation mode); the trim's slider is held by a dragging flag, like the fader, so an undo while it keeps focus still moves it. Off joins the automation modes: it is the one mode kept in the document (autoOff), because the export must play it too; Read and the recording modes stay the strip's own, as before. With Off the fader, pan and filters play as set and the lanes stay; the fader is usable in every mode but Read. Bypass inserts takes a kind (all, EQ, Dynamics, Reverb, Delay, Modulation; the processors by their library's category) and bypasses it on the selected clips' tracks, or on every track with none selected, or switches it back on when every such insert is already off; the menu returns to its label after. The pan law menu shows the session's law (0 dB, the balance, when none is set).

Each strip's meter has a hold mark per channel: a full-width span whose right edge is the mark, moved with translateX, shown at the highest peak for 2 s, then falling at 20 dB a second, gone at a stop; and a clip light (track, bus and output strips), lit at a peak of 0 dBFS or more until clicked. Both write transforms and data attributes only, so a meter never moves its strip; the light sits in the kind row's free end (for the output strip, the column the pan knob takes on the others, where it no longer covers "Output").

## src/audio/player.ts · the mixer basics (PLAN_v13 S2) {#src-audio-player-s2}

### Every kind but the filters on a track's bus, with its filter automation; gain reduction by insert
- refers-to: src/audio/player.ts (FILTERS, PLACED_ON_THE_SUM, PAN_LAWS, flatStagesAuto, planClips, clipChain, ClipPlan.processorTracks and panLaw, sendPlan, bounce, handlePosition, onReductions); src/audio/player-worklet.ts (WorkletBus.fxAuto, the clips message's panLaw, the position reply's reductions, fw_add_bus_fx_auto, fw_set_pan_law, fw_take_reductions)
- kind: rationale
- logged: v2.14.1 · 2026-10-07

As the export does (backend log, app/services/render.py, S2): a track carrying any kind but the five filters plays through a bus of its own, so an echo's or a gate's tail rings past a clip's end; flatStagesAuto numbers the filters' automation by that bus chain's stages for the core's bus automation, where it was dropped before on a track with a compressor. A track with a surround place keeps the old rule (PLACED_ON_THE_SUM), its time-based effects per clip where its place reaches them. Solo safe, Off (no volume, pan or filter automation sent), the trim and the polarity (both in the clip's gain, ahead of the track's inserts; a clip's own compressor, a clip insert, is not moved by the trim) and the pan law's code are planned here as in the export; tests/test_plan_parity.py holds the two planners equal. processorTracks names whose each processor is, in the order the core reports gain reduction (buses' processors as null), so the reply's reductions come out keyed by track and insert while playing, and empty when stopped.

## src/ui/editor-tabs.ts · gain reduction (PLAN_v13 S2) {#src-ui-editor-tabs-s2}

### A dynamics processor's card shows its gain reduction
- refers-to: src/ui/editor-tabs.ts (the card's .fw-fx-gr, the onReductions listener); src/styles/canvas.css (.fw-fx-gr)
- kind: rationale
- logged: v2.14.1 · 2026-10-07

The five Dynamics processors (compressor, expander/gate, de-esser, maximizer, channel strip) report their gain reduction; their cards show it in the head, "GR -6.2 dB" as it plays and "GR 0.0 dB" stopped, in a mono readout 11ch wide so a changing number never moves the buttons beside it. The listener reads nothing while the Effects tab is hidden or holds no such card.

## src/engine/describe.ts {#src-engine-describe}

### Every command in plain words, for the History tab
- refers-to: frontend/src/engine/describe.ts (WORDS, describeCommand, HistoryEntry); src/engine/index.ts (done, undone, setAuthor, historyEntries)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The agreed canvas (and overdub before it) puts History beside the Agent. The engine's undo stack holds documents only, so each dispatch now also records an entry: the command in a few words, who made it (you, or the agent while its run lasts) and when. WORDS is a Record over Command["type"], so a new command type does not compile until it has its words; `{t}` takes the track's name from the session before the command ran, `{m}` the imported media's name, and mute and solo read Unmuted and Unsoloed when they turn off. A batch reads as its first command (a synth change with the note clips it re-renders is "Changed the synth").

## src/styles/canvas.css {#src-styles-canvas}

### The Inspector as balanced columns that scroll down
- refers-to: frontend/src/styles/canvas.css (.fw-dock .fw-pane-inspector, .fw-dock .fw-inspector-body and its sections)
- kind: removed-code
- logged: v2.13.0 · 2026-10-07

The release's last check in Firefox at 1710 by 940 found the row of cards below cut where the editor ends: Analyze's Spectrogram and Transients cut mid-word, Playlists wholly past the window's edge, and each card's own scroll cutting its last rows at the bottom. The cards are now laid out in columns at least 300 px wide across the editor (two at 1280 and 1440, three at 1710), the body at its own height so the columns balance, inside the pane, which scrolls down. frame.css's columns had split cards because the body had a fixed height (column-fill auto made overflow columns sideways); with the height free and break-inside avoid, each card stays whole, measured at all three sizes: one fragment per card and nothing wider than the editor.

```css
.fw-dock .fw-inspector-body { display: flex; align-items: stretch; gap: 12px; padding: 12px 16px; overflow: auto hidden; columns: auto; column-rule: none; }
.fw-dock .fw-inspector-body > .fw-insp-section { flex: none; display: flex; flex-direction: column; gap: 8px; inline-size: 320px; min-block-size: 0; max-block-size: 100%; margin: 0; padding: 12px; overflow: hidden auto; border: 1px solid var(--border-light); border-radius: 12px; background: var(--bg-tertiary); }
```

### The editor head's context shows whole or not at all
- refers-to: frontend/src/styles/canvas.css (.fw-dock-context and its ::before, .fw-dock-who, .fw-dock-detail); src/ui/dock.ts (the head's markup)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

At 1280 the head had about 40 px left for "Live instrument" and cut it to "Live", and with More reading Inspector the track's name vanished under the clip. The context is now one line of a wrapping row with a fixed height and overflow hidden: what does not fit wraps to the hidden second line, so the swatch and the name (one item, .fw-dock-who) show together or not at all, and the detail goes first. The 1px by 18px ::before holds the first line: a zero-width first item let the name sit beside it however little room there was, and with no height the first line had none, so the second showed in its place.

### Route opens over its strip
- refers-to: frontend/src/styles/canvas.css (.fw-dock .fw-strip position, .fw-dock .fw-strip-route[open], .fw-dock .fw-route-box)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

Route's box (output, VCA, send and its level, automation mode) opened as a new row under the strip, below the editor's height, so at the default height a click on Route only pushed Route out of view. It now covers the strip above its M, S and Route row, opaque, scrolling if a short editor leaves it too little room; Route, still in place, closes it.

### The Clip tab's actions end with a rule
- refers-to: frontend/src/styles/canvas.css (.fw-dock .fw-cf-actions)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

With the canvas's two rows of fields and its four actions filling the editor at its default height, the next row (Source and Colour) showed the top few pixels of its labels at the editor's bottom edge. The actions row now ends with 14 px and a rule, which pushes that row out of view and marks where the tab's further tools begin.

### The agreed canvas, region by region, over the older layers
- refers-to: frontend/src/styles/canvas.css (all of it); src/main.ts (imported last before scrollbars.css)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

The owner's verdict on v2.12.5: the redesign agreed over six turns (the "formwav redesign target" Design artifact) had not been built. This file is that canvas: header 44 px, browser 240 px, track heads 168 px and lanes 78 px, the editor 222 px with its tabs, the agent column 296 px, the footer 58 px, each region with the canvas's own recipes mapped onto formwav's tokens (--bg to --bg-primary, --panel to --bg-secondary, --raised to --bg-tertiary, --node to --bg-node, --line to --border-color, --line2 to --border-light). It loads after shell.css, workspace.css, frame.css and surfaces.css and wins by order and specificity; the rules it overrides there stay as debt for a cleanup pass, so read a region here first. The editor's head hides its detail below 880 px of its own width (a container query), so "Ask the agent" never wraps at 1280.

### Nothing moves when a tab, a label or a list changes
- refers-to: frontend/src/styles/canvas.css (`[data-label]::after`, .fw-browse-hint, .fw-media-list, .fw-synth-knobs .fw-knob, .fw-fx-card .fw-knob, .fw-status .fw-engine, .fw-st-rate)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

Selected tabs are bold, which would widen them: each tab (the editor's, the agent column's, the toolbar's tools and Draw's label) carries its label in data-label, and a hidden bold copy in ::after shares its grid cell, so the box is always the bold width. The browser hint keeps two lines (it reads "Click adds to a new track" or "Click adds to {track}"), the media list keeps one row's height when empty, the knobs split their row evenly whatever their values read, the engine chip is 112 px and the rate 7ch. Measured with CPU at 4x and a 1.6 Mbit/s, 150 ms network, every path of this release driven with real input: no layout shift outside 500 ms of an input.

### The Inspector under More as a row of cards
- refers-to: frontend/src/styles/canvas.css (.fw-dock .fw-inspector-body and its sections)
- kind: removed-code
- logged: v2.13.0 · 2026-10-07

frame.css laid the docked Inspector out in CSS columns, which split a section taller than the dock across columns (Time track's Apply curve at the top of the next one, 5876 px of columns at 1440). The sections are now 320 px cards in a row that scrolls sideways, each scrolling on its own; a section is a flex column whose children do not shrink, because as a grid with a capped height its rows with overflow hidden (the heads among them) collapsed to 0.

```css
.fw-dock .fw-inspector-body { flex: 1 1 auto; min-block-size: 0; overflow: auto hidden; padding: 10px 14px; column-width: 300px; column-gap: 28px; column-rule: 1px solid var(--line-1); column-fill: auto; }
```

### A selected clip shows its border only
- refers-to: frontend/src/styles/canvas.css (.fw-clip[aria-selected="true"]:not(:hover) .fw-gain-line, .fw-fade-handle; .fw-gain-line::after)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

At 0 dB the gain line runs through the clip's name chip, and its dB label sat on the chip too. As on the canvas, a selected clip shows its accent border; the gain line and fade handles appear on hover, and the line's dB label shows at the clip's right only while the line itself is hovered or dragged.

## src/styles/tokens.css {#src-styles-tokens}

### The canvas's two colours as tokens
- refers-to: frontend/src/styles/tokens.css (--fw-agent-ink, --fw-meter, body.theme-light)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The canvas names the agent in blue on its clips and edits and draws the meters in green; both now live here (the light themes take a darker blue), so canvas.css carries no raw colour and the design audit passes (0 FAIL, 0 WARN).

## src/audio/notes.ts {#src-audio-notes}

### Note clips render with the session's synth
- refers-to: frontend/src/audio/notes.ts (renderNoteMedia, renderNotes); src/ui/midi-input.ts; src/ui/step-sequencer.ts
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Every place that renders notes through /api/midi/render (the piano roll, a recorded MIDI take, a step pattern) now sends the session's synth patch, so what the Synth tab sets is what the note clips sound like and what exports. renderNoteMedia returns the media without dispatching, so the Synth tab can commit the patch and every re-rendered clip as one batch.

## src/ui/browser.ts {#src-ui-browser}

### The browser column of the canvas
- refers-to: frontend/src/ui/browser.ts (mountBrowser, SOUNDS_ORDER, filter); src/ui/shell.ts (.fw-pane-media)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Media, Effects and Sounds share one search (the / key reaches it); the hint names where a click adds (the selected clip's track, or a new one); the Media tab lists the session's media, then the effect groups (each opens the Effects tab at its group), then Made by the agent. A media row adds on a click or a drag onto a lane. The Sounds tab's sections (Library, Models, Speech on this computer, Generate, Step sequencer, Clip launcher) fold under their heads, the first open.

## src/ui/browser-effects.ts {#src-ui-browser-effects}

### The effects moved to their own tab
- refers-to: frontend/src/ui/browser-effects.ts (FX_GROUPS, mountBrowserEffects)
- kind: removed-code
- logged: v2.13.0 · 2026-10-07

The groups lived under the media list in the Media tab; they are the Effects tab now, with a note that the other effects render into a clip from the Inspector. FX_GROUPS is exported for the Media tab's group rows.

```ts
// After the media list rather than inside it, so a new file (an import, a render) never pushes it; marked as part of
// the media panel, so the pane's other tabs hide it with the list
section.dataset.panel = "media";
media.after(section);
```

## src/ui/dock.ts {#src-ui-dock}

### The editor of the canvas: seven tabs, More, context, Ask the agent
- refers-to: frontend/src/ui/dock.ts (mountDock, MORE, context, sync)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Clip, Effects, Mixer, Synth, Pads, Spectrum and Transcript are tabs; Inspector, Notes, Labels and Terminal sit under More, whose label becomes the open one. Each panel's hidden flag stays the truth and its module's toggle opens it, so a terminal survives a tab switch. The head's right names what the open tab works on (the selected clip's track and clip with its live effects, or the live instrument for Synth and Pads; "No clip selected" otherwise, the same words before and after an import, so the label does not move on its own) and Ask the agent prefills the agent with it. A tab's label is also in data-label for canvas.css's bold reserve.

## src/ui/editor-tabs.ts {#src-ui-editor-tabs}

### Studio processors: one document kind, cards from the core's table
- refers-to: src/engine/processors.ts (PROCESSORS, PROCESSOR_BY_ID, clampParam, processorValues, processorSpec); src/engine/document.ts (ProcessorFx, FX_KINDS, cleanFx, set-clip-fx, set-fx-automation); src/audio/player.ts (flatFx, flatFxAuto, flatStages, planClips, ClipPlan.processors, sendPlan, bounce); src/audio/player-worklet.ts (the clips message's processors, kind 20); src/ui/editor-tabs.ts (PROCESSOR_GROUPS, processorKind, kindOf, valuesOf, shown, the card, commit, the arrow keys); src/ui/browser-effects.ts (PROCESSOR_ROWS, data-proc); src/ui/inspector-pane.ts (PROCESSOR_OPTIONS, rtKey, the processor rows and presets); src/ui/agent-pane.ts (PROCESSOR_SUMMARY, set_track_effects); src/ui/lanes.ts (no filter automation for a processor); src/styles/canvas.css (.fw-chain-row wrapping, .fw-fx-card-wide)
- kind: rationale
- logged: v2.14.0 · 2026-10-07

The 24 processors are one document kind, processor, with the processor's id and its values by parameter id, rather than 24 new kinds: a new kind is wired by hand in eight places (CLAUDE.md), and formwav-studio's catalogue (names, ranges, units, tapers, choices) already says everything the interface needs. processors.ts is that table as the core writes it (fx.rs processors_json), checked equal by a test, so the interface needs no fetch and no engine to draw a card. cleanFx keeps a processor only with a known id and fills every value in the core's order, held as the core holds it (switches and choices rounded), so the plan's spec is the same in the browser and the export. A processor runs on a sum: a track carrying one plays through a bus of its own (as a compressor's does), a clip refuses one (set-clip-fx drops it; the Inspector's clip menu does not offer them), and a track routed to a user bus does not place one, as the export does not. The Effects tab draws a processor's card from its table: a switch or a choice is a knob stepping through its names (the arrow keys step one name), and a card with more than three controls is wider, five smaller knobs a row, scrolling inside the card when they pass the editor's height. The chain wraps onto a new line rather than scrolling sideways, since the fit test (and the owner) count a control cut at the side of a sideways scroller as cut; with two wide processors the Add card wrapped below at 1440 and the test caught it. The Inspector's rows give each parameter a number field or a menu, and presets for a processor are kept per processor (rt:processor:id), with its values.

### Synth: the session's built-in synth, with real controls
- refers-to: frontend/src/ui/editor-tabs.ts (SYNTH_PARAMS, SYNTH_PRESETS, paintSynth, commitSynth); src/engine/document.ts (SynthPatch, set-synth); src/audio/player.ts (setLivePatch)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The owner found no way to control the synth. The tab now has a preset menu (Soft triangle, Glass pad, Pluck, Warm bass, Square lead, Bell, Custom), the wave (Sine, Triangle, Saw, Square) and the canvas's four knobs, Attack, Release, Cutoff and Resonance (log scales; the top of Cutoff is Open, no filter), beside two octaves of keys. A knob drag is heard at once through the live instrument; letting go commits the patch with every note clip it re-renders as one batch, one undo step; a failed render puts the old patch back. The chip reads "MIDI keyboards play it too" (the full sentence is its title), short enough that the preset name never truncates.

### De-hum's third knob reads Q
- refers-to: frontend/src/ui/editor-tabs.ts (KINDS.dehum)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

The knobs now split a card's row evenly (64 px each with three), and "Narrowness" measured 63 px in 59; Q is what the other filters' cards call the same thing.

## src/ui/file-menu.ts {#src-ui-file-menu}

### mountMenu serves the editor's More too
- refers-to: frontend/src/ui/file-menu.ts (mountMenu, items)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Exported for dock.ts, and its keyboard and click handling take menuitemradio and menuitemcheckbox as well as menuitem, so More's checked panel items move with the arrows like the menu bar's.

## src/ui/media-pane.ts {#src-ui-media-pane}

### The Library as rows, the catalogue without its empty box
- refers-to: frontend/src/ui/media-pane.ts (lib, .fw-snd-list, catSearch, emptyText)
- kind: removed-code
- logged: v2.13.0 · 2026-10-07

The library's ten sounds were one select whose options ran past the column ("Reference tone, 1 kHz at" cut at 1280). They are rows now, grouped by category, as the media rows look: the name and its length on one line, the rest of the name below, a click adding it on a new track at the playhead and a play button previewing it. The Wikimedia results list keeps no reserved 176 px box while empty, and its notes are short enough for the column. The media list's empty words no longer point at the + button the canvas header does not show.

```html
<label class="fw-field fw-field-stack"><span>Sound</span><select data-l="item" aria-label="Library sound"></select></label>
<div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-l="preview" disabled>Preview</button><button type="button" class="fw-ibtn" data-l="add" disabled>Add on a new track</button></div>
```

## src/ui/midi-input.ts {#src-ui-midi-input}

### A recorded MIDI take renders with the session's synth
- refers-to: frontend/src/ui/midi-input.ts (the render request's patch)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The take's notes go to /api/midi/render with the Synth tab's patch at a fixed 0.25 gain, as the piano roll and step patterns send it (src/audio/notes.ts).

## src/ui/musical.ts {#src-ui-musical}

### Tempo, Meter and Snap in the footer
- refers-to: frontend/src/ui/musical.ts (mountMusical)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The canvas's footer shows the tempo, the meter and the snap as small labels over their values. Tempo (with Tap, four taps or more) and Meter open a small dialog above the readout that sets the session's tempo (set-tempo); Snap steps Off, Grid, Beats (set-snap, which Grid and Bars follow). The input meter shows only while a track is armed (.fw-status.is-armed), so the footer otherwise holds what the canvas holds.

## src/ui/status-bar.ts {#src-ui-status-bar}

### The rate always shows
- refers-to: frontend/src/ui/status-bar.ts (render)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

The rate appeared only once a track existed, which moved the output choice after it when the first import landed; the session has a rate from the start, so it shows from the start.

## src/ui/theme-menu.ts {#src-ui-theme-menu}

### Settings no longer repeats the header's theme picker
- refers-to: frontend/src/ui/theme-menu.ts (mountThemeMenu)
- kind: removed-code
- logged: v2.13.0 · 2026-10-07

The header always shows the theme select, so Settings' fifteen theme items (which ran past a 674 px window) are gone; the accents stay in Settings for windows under 1200 px, where the header hides its swatches.

```ts
const themes = Object.entries(THEMES)
  .map(([id, t]) => `<button class="fw-ibtn fw-theme-item" type="button" role="menuitem" data-theme="${id}" aria-checked="${id === choice.theme}"><span class="fw-check" aria-hidden="true"></span><span>${t.label}</span></button>`)
  .join("");
pop.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>(".fw-theme-item");
  if (!item?.dataset.theme) return;
  setTheme(item.dataset.theme);
  markTheme(item.dataset.theme);
});
```

## src/ui/toolbar.ts {#src-ui-toolbar}

### The arrangement's toolbar in words, the older options in a hidden store
- refers-to: frontend/src/ui/toolbar.ts (mountToolbar, HINTS, setTool); src/ui/shell.ts (.fw-tray-store)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Add a track, the Select, Split, Fade and Draw tools, zoom out, in and Fit, and Follow, with the hint for the tool in hand at the right. The older buttons (Grid, Shuffle, Spot, Punch, Bars, Picture, the spectrogram views, layouts, speed, recording settings, the room) keep their modules and bindings inside the hidden store; the menus reach them as items that press the stored button and mirror its state. Draw's label carries data-label for the bold reserve.

## src/ui/voice-pane.ts {#src-ui-voice-pane}

### Speech on this computer lives in the Sounds tab
- refers-to: frontend/src/ui/voice-pane.ts (refresh on the sounds tab)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The local speech engines' list refreshes when the Sounds tab opens, where the section now sits, not on the old Voice tab.

## src/ui/workspace-layout.ts {#src-ui-workspace-layout}

### A new key, so a stale layout cannot hide the columns
- refers-to: frontend/src/ui/workspace-layout.ts (KEY, DEFAULTS, shown)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

On the owner's Mac a layout kept under formwav.layout from an older version hid both side columns. The key is formwav.panes, the defaults are the canvas's 240 px and 296 px, and the right column follows the agent's own hidden flag (0 px when hidden, no strip).

---

## src/ui/agent-pane.ts {#src-ui-agent-pane}

### Agent and History, as the canvas has them
- refers-to: frontend/src/ui/agent-pane.ts (.fw-agent-tabs, renderHistory, the history list's click, run's setAuthor); src/engine/describe.ts
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The column's head is two tabs. History lists the session's edits oldest first from "Session start", each with who made it (you, or Claude for edits made while a run lasts: run sets the engine's author and puts it back when it ends), the current one marked and undone ones dimmed; a click undoes or redoes to that point. Rows are patched by key (patchList), filled in create and update alike. The keys line reads "Enter sends. Cmd / asks from anywhere." so it fits one line of the 296 px column (the full keys are its title).

### The in-app agent does what the MCP server does, in the open session
- refers-to: frontend/src/ui/agent-pane.ts (local_models_status, list_voices, generate_speech, generate_music, generate_sound_effect, mark_speech, separate_clip, dub_clip, transcribe_with_speakers; place, range, postJson); CLAUDE.md; AGENTS.md
- kind: explainer
- logged: v2.12.4 (in progress) · 2026-10-06

PLAN_v11's 3.3. The MCP server works on media and saved sessions from outside; the Agent column works on the open session through the same commands as the interface. Nine tools give it what the server gained, each placing its result in the session as one undo step: the models' status and the voices; speech, music and sound effects on a new track at the playhead or a given time; a clip's speech as Speech regions; a clip split into speech, music and ambience on three tracks under it (its track muted when it was alone there); a clip dubbed into es, fr, it or pt under it (here, or through ElevenLabs with its job polled); and Scribe's words with speakers. Each tool that makes sound reports the new track and clip, so the next tool can work on them, and clip spans are read in the media's own samples (sourceIn) and the session's (length). Checked with a scripted model in Chromium, each step built from the last result: the status (Kokoro installed), a Kokoro sentence on a new track, its Speech region 0.128 to 2.848 s, its three parts with the original muted, its Spanish dub, and ElevenLabs music failing with the key's instruction; five tracks added, one undo taking back only the dub, no page error. The agent's tools: 30.

### The agent edits by transcript: words read, cut and rewritten as the Transcript tab does
- refers-to: frontend/src/ui/agent-pane.ts (get_transcript, delete_words, remove_fillers, rewrite_words); src/ui/transcript-pane.ts (sessionWords, rangesOf exported); sidecar verification/verify_agent_transcript.md
- kind: explainer
- logged: v2.11.2 (in progress) · 2026-10-06

One row of the comparison: the agent could not edit by the words. It now has four tools built on the Transcript tab's own functions, so its edits behave as the person's: get_transcript (every word in session order with index, speaker, times and a filler flag; clips not yet transcribed are transcribed on this machine), delete_words (ranges of indexes cut with clear-ranges across every track, the gap closed, as Delete does), remove_fillers, and rewrite_words (words in one clip spoken again in the speaker's cloned voice through Regenerate, ElevenLabs or a cloning engine installed here, later clips on the track moved by the change). Checked with a scripted model through a scratch engine and the ElevenLabs stand-in: "my fellow" cut (0.8 s), the opening rewritten, two later clips moved, the timeline ending at 10.450 s as computed, two undos restoring the clip, no page error.

---

## src/ui/agents.ts {#src-ui-agents}

### Settings > Agents moved what was below it as its clients arrived
- refers-to: frontend/src/styles/workspace.css (.fw-agents-list)
- kind: fix
- logged: v2.12.3 (in progress) · 2026-10-06

Found by the v2.12.3 gate's interface run: opening Settings > Agents made a layout shift of 0.0108. The dialog opened with a one-line note and grew when the six clients arrived from the engine, moving its status line and Close button down after the input that opened it. The list's height is now reserved from the start (min(56vh, 520px), scrolling inside); opening Settings, the dialog, the list arriving and closing, twice under 4x throttling with each step labelled, make no layout-shift entry.

---

## src/ui/launcher.ts {#src-ui-launcher}

### A session view that plays: slots kept with the session, launch quantize choices, launching starts playback
- refers-to: frontend/src/ui/launcher.ts; src/engine/document.ts (LauncherState, launcher, set-launcher-slot, set-launcher); src/ui/media-pane.ts and src/main.ts (the player passed to the launcher); src/styles/workspace.css (a playing slot)
- kind: explainer
- logged: v2.11.9 (in progress) · 2026-10-06

The comparison's L10. The clip launcher had four scenes, its slots only in the page's lists (lost on reload), every launch on the next bar, and nothing playing until the transport was started. Now the slots, the number of scenes (1 to 16) and the quantize choice are kept in the session (set-launcher-slot and set-launcher, each an undo step); a launch lands now, on the next beat, bar, two bars or four bars; launching while stopped starts playback; a slot is lit while its launched loop is under the playhead. Launches are still written into the arrangement as launched repeats (as a session performance is recorded), and a new launch on a track ends that track's previous loop where it lands, so the player, exports and undo treat them as clips. Checked in Chromium at 120 BPM from a playhead at 1.30 s: landing at 62,400 (now), 72,000 (beat), 96,000 (bar), 192,000 (two bars) and 384,000 (four bars), playback started each time; six scenes and two slots kept through a reload of the document and shown in the cells; a scene launched from zero lighting both its slots while playing, none once stopped; no layout shift without input, no page error. The first scene check counted one lit slot after five launches and undos, the quantize changes being undo steps too; a clean run lights both.

---

## src/ui/step-sequencer.ts {#src-ui-step-sequencer}

### Patterns render with the session's synth
- refers-to: frontend/src/ui/step-sequencer.ts (the render request's patch)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

A placed pattern's notes go to /api/midi/render with the Synth tab's patch (wave, envelope, cutoff, resonance at 0.25 gain), so the pattern sounds as the Synth tab plays.

### Patterns that play: rows, velocity and swing per step, kept with the session, heard before placing
- refers-to: frontend/src/ui/step-sequencer.ts; src/engine/document.ts (StepPattern, patterns, save-pattern, delete-pattern); src/styles/workspace.css (.fw-step velocity levels)
- kind: explainer
- logged: v2.11.7 (in progress) · 2026-10-06

The comparison's L12: the step sequencer had four rows of on-off steps, placed only. Now 1 to 16 rows (8 by default, C6 to C3), a velocity per step (a click lights a step at 100, a Shift-click cycles it through ghost 60, accent 127 and normal 100, shown dimmer or brighter), swing on the off-beat sixteenths (50 straight to 75; 66.7 a triplet feel), Hear (rendered as Place renders, played, nothing added) and patterns kept in the session (save-pattern and delete-pattern, each one undo step, a list bringing one back). Checked in Chromium: rows 8 to 10; a ghost and an accent where Shift-clicked; at 66.7 percent swing and 120 BPM the off-beat notes at 8,004 and 20,004 samples (6,000 a sixteenth plus the 2,004 swing), the velocities 60, 100 and 127 as set; saved, cleared, and loaded back with ten rows, the swing and every level; Hear's play() resolving on the rendered pattern (7.81 s for four bars), the button Stop while it played, no track added; the save undone in one step; no layout shift without input, no page error.

---

## src/ui/clip-tab.ts {#src-ui-clip-tab}

### Speech, music and effects, and which method split them
- refers-to: frontend/src/ui/clip-tab.ts (the Separate row's button, its progress text and the result line); src/ui/agent-pane.ts (separate_clip's description and method); src/ui/models-pane.ts (Install a model on this machine); backend app/services/three_way.py
- kind: rationale
- logged: v2.13.1 · 2026-10-07

With the trained separator (PLAN_v12 R1) the third part is effects, what a film's mix calls sound effects and ambience, so the button reads Speech, music and effects to three tracks. The result line says which method ran, the trained model or the rule, and where the model is installed when the rule ran, in the two lines the state output holds at 1280 wide (at most 96 characters here). The engine's install list now carries a model that is not a speech engine, so Sounds > Models' task reads Install a model on this machine. The agent's separate_clip passes the method on, and its description says the effects part comes back under the key ambience, which the engine keeps for its callers.

### The Clip tab in the canvas's two rows
- refers-to: frontend/src/ui/clip-tab.ts (the grid's field order)
- kind: removed-code
- logged: v2.13.0 · 2026-10-07

The canvas sets the Clip tab as two rows of four fields over its four actions, all inside the editor's default height. The tab had three rows (the track's name and the source two columns wide each), so the fades sat half under the footer and the actions below the fold at 1280, 1440 and 1710. The name now takes one column beside start, length and gain; fades, fade shape and sound type make the second row; the source, which only reads, moved below the actions beside the colour.

```ts
field("Track name", `<input type="text" data-f="name" maxlength="80">`, true),
field("Source", `<output data-f="source"></output>`, true),
field("Start (s)", `<input type="number" data-f="start" min="0" step="0.001">`),
field("Length (s)", `<output data-f="length"></output>`),
field("Gain (dB)", `<input type="number" data-f="gain" min="-60" max="24" step="0.1">`),
field("Sound type", `<select data-f="type">...</select>`),
```

### The canvas's four clip actions, and status lines that never cut a word
- refers-to: frontend/src/ui/clip-tab.ts (.fw-cf-actions and its click handler, the default status texts); src/styles/canvas.css (.fw-cf-ara-state)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Split at the playhead (split-clip, or a notice when the playhead is outside the clip), Normalize (the footer's Loudness), Check the recording and Repair assistant (the Inspector's mic check and repair assistant, the Inspector opened and its findings scrolled into view). The status lines under Separate, Speech, Line up by sound and ARA had one line and an ellipsis; their resting texts are now short enough for 1280, and a longer result shows on up to two reserved lines.

### Speech regions misplaced on media at another rate than the session's
- refers-to: frontend/src/ui/clip-tab.ts (Mark where people speak)
- kind: fix
- logged: v2.11.4 (in progress) · 2026-10-06

Found while writing the three-way split: a clip's sourceIn counts the media's samples and its length the session's (sessionWords in the transcript pane reads them so), and Mark where people speak (1.7, v2.11.1) divided both by the session's rate. For a 44.1 kHz file in a 48 kHz session every region would have been stretched by 8.8 percent; the JFK check, 48 kHz in 48 kHz, could not show it. Now each is read in its own rate. Checked in Chromium: the JFK speech resampled to 44.1 kHz in a 48 kHz session marks the same four stretches as the 48 kHz original, to the hundredth of a second.

---

## src/ui/share.ts {#src-ui-share}

### Shared editing: one session edited from several devices at once
- refers-to: backend/app/routers/share.py; backend/app/main.py; frontend/src/ui/share.ts; src/engine/index.ts (share hooks, applyShared, reportHistory); src/engine/document.ts (RestorePatch, computeRestore, restore); src/main.ts; src/styles/workspace.css (.fw-share-chip); sidecar verification/verify_share.md
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison grades cloud save without shared editing partial; this is the shared editing. formwav's edits are commands applied by one pure reducer, so editors who apply the same commands in the same order hold the same session: the engine is the hub that fixes the order (it keeps the document as sharing began and every command since, numbered as they arrive), every editor applies them in that order, the sender's own edits included, and a late joiner replays them. Two things a snapshot editor does not need were built for it. Commands that create things (an import makes a track) took ids from a random source, so editors applying one command would have made different ids and drifted; a shared command's ids are seeded by its op id, so all make the same. And undo replaced the whole document with an earlier one, which while sharing would wipe everyone else's edits; shared undo is each editor's own: each of their edits keeps what it changed (computeRestore: lists of things with ids by id and order, the media table entry by entry, since putting it back whole would drop media someone else just added), and undoing sends that back as an edit, so another's later edit elsewhere survives (two on one track: the later wins). Desktop: File > Share this session, once Devices on this network is on; a paired device opening formwav joins; a chip in the status bar shows how many are editing, its place kept when off. Checked in two browsers through an engine serving the interface (verification/verify_share.md): the guest joined holding the host's session; after five interleaved edits from both, a file import among them, the documents were identical and the imported track had the same id on both; the guest's two undos took back its import and then its mute and nothing of the host's, redo put the mute back, identical after each; stopping told the guest. The chip first grew past its reserved width as its text filled in (0.0004); with a fixed width, sharing and stopping make no layout-shift entry; no page error on either side.
Moved at the v2.10.8 gate: the chip's reserved width in the status bar left the bar's information (the notices, the engine and the session's rate, tracks and length) 15 px beside the transport, and the bar 10 px over its width; the chip now sits in the menu bar's middle, beside the session's name, where there is room: every bar fits, the information has 157 px again, and sharing and stopping still make no layout-shift entry.

---

## src/ui/inputs.ts {#src-ui-inputs}

### Recording through native capture: tracks on an interface's channels, each take on its own track
- refers-to: frontend/src/ui/inputs.ts (native interfaces in the list); src/audio/recorder.ts (startNativeRecordings); src/ui/record.ts; src/ui/lanes.ts (the arm button's title)
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The input list now offers the engine's native interfaces beside the browser's, labelled with their width and that they record through the engine (ALSA's null device, which is no input, left out). Armed tracks whose input is such an interface record through one engine take per interface, each with the channels it names, and each gets a Recording of the usual shape, so the take is placed as a browser take is (latency, punch, loops); the engine records one interface at a time. Checked in Chromium against the virtual eight-channel interface (verification/native_capture), the engine and page started with it defined: two tracks set to the interface's channels 1 and 2 and armed (a click, then a Shift-click), recorded and stopped: each track's take carried its own channel's tone (the 200 and 300 Hz channels, read as 187.5 and 281.2 Hz through that unclocked device), with the clicks on the same frames, the same length and the same start, and the notice naming both takes; no page error. Found on the way: arming several tracks takes Shift, which nothing said; the arm button's title now does. The harness's own select helper had picked the wrong option once, which set both tracks to one channel; set as the page sets a select, each kept its own.

### Track inputs saved with the session, and why a browser cannot record more than two channels of one interface
- refers-to: frontend/src/engine/document.ts (TrackInput, Track.input, set-track-input); src/ui/inputs.ts (bindInputs, the maps rebuilt from the document); src/main.ts
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison's Multitrack recording row noted the channel choice was held in the page, not the session. A track's input (its device, the device's label, the channels it records) is now Track.input, set by set-track-input: saved with the session, one undo step, and found again on another machine by its label when the device's id is not present there. inputs.ts keeps its getters, so the recorder and the Inspector read as before; its maps are now rebuilt from the document and the devices present. Checked in Chromium with fake inputs: an input chosen in the Inspector reached the document with its label, the session saved and reopened in a fresh page through the projects module's own path came back with it (the Inspector showing it), and an unknown device id with a known label was matched by the label; no page error.
Measured on the way, and sourced: a synthetic eight-channel stream through Chromium's media-stream path delivered its first two channels and silence on the other six. That is the browser, not formwav: Chrome's audio team said on the W3C audio list that getUserMedia does not support more than two channels, a 2024 note on the W3C WebRTC list points to the limit of two in Chromium's source, and Firefox's tracker has the same limit open as bug 1393401. A browser recorder therefore cannot take more than two channels of one interface; recording eight inputs needs capture through the engine (the Rust core and cpal), the next step.

---

## src/ui/cloud.ts {#src-ui-cloud}

### Cloud projects, the interface: File > Cloud, adapted from formcut 2.6.3
- refers-to: frontend/src/ui/cloud.ts; src/ui/projects.ts (savedSessionName, fw-open-project); src/ui/shell.ts (File > Cloud); src/main.ts; src/styles/workspace.css (.fw-cloud-*)
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

formcut's three cloud pieces (a browser, an upload dialog, settings rows) became one dialog in formwav's export-dialog style, opened from File > Cloud: a Google Drive or Dropbox switch; set up with the app's client ID (and Google's desktop secret, and the opt-in full-Drive scope); Connect, with Google finishing in the browser and Dropbox's code pasted back; then the service's files with folders and paging, where a session (.fmw) opens through the projects module's own path (its unsaved-changes guard included, by an fw-open-project event) and any other file comes in as media on a new track at the playhead, and Save this session here sends the saved session up whole, refusing while there are unsaved changes so what goes up is what was saved. Checked in Chromium under 4x throttling against formcut's fake services through a scratch engine, every click on a visible control: set up, Google connected through its redirect, browsed, a file imported onto a new track, an unsaved save refused, Dropbox connected by its pasted code. The check found a Refresh a Google user needed that sat inside the hidden file section (a user would have been stuck; the connect step now has its own), and layout shifts as the dialog's sections changed (up to 0.05 in all): the dialog now holds a fixed height with its title and service switch on top, one scrolling body, and its note and Close pinned below, and More keeps its place, invisible when there is no next page. Re-run: no layout-shift entry over the whole flow, no page error; the design audit at 0 FAIL, 0 WARN.

---

## index.html {#index-html}

### index.html · critical style and theme boot
- refers-to: index.html :: head `style` and inline `script`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

`html` paints the deepest surface before any stylesheet arrives, and `#app` stays hidden until `body.app-ready`. The inline script is `theme-boot.js` from stylized-nodemode, pasted verbatim: it reads `nodemode_ui_settings` from localStorage and writes the profile and accent onto `documentElement` before first paint, adding `body.theme-light` for the two light profiles through a MutationObserver the moment `body` exists. The storage key is NodeMode's own, as formvis keeps it, so the family reads one choice where origins are shared.

### index.html · body roots
- refers-to: index.html :: `#app`, `#overlay-root`, `#toast-root`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

The overlay and toast roots are direct children of `body` so nothing they render can be trapped by an ancestor stacking context. Unused in v0.1.0; menus and dialogs mount there when they arrive.

---

## vite.config.ts {#vite-config}

### vite.config.ts · server and preview
- refers-to: vite.config.ts :: `server`, `preview`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

`host: false` with pinned ports and `strictPort` on both the dev server and the preview server, per dev-rules vite-server-guard. `/api` proxies to the engine on 127.0.0.1:8060 in both. Verified v0.1.0: `/proc/net/tcp` showed 3060 bound to 127.0.0.1 only.

---

## src/main.ts {#src-main}

### src/main.ts · the canvas's modules mounted
- refers-to: src/main.ts :: imports (canvas.css), the mount sequence (mountBrowser, mountDock with the engine, mountMusical, mountToolbar)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

canvas.css is imported after the older style layers; mountBrowser follows mountBrowserEffects (it lists FX_GROUPS), mountDock takes the engine for its context line, and mountMusical and mountToolbar follow mountAgents, once every button they adopt or press exists.

### src/main.ts · boot order
- refers-to: src/main.ts :: module body
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

Order matters: fonts and styles, then `applyTheme()` (idempotent re-apply of what the head boot already wrote, and the owner of every later change), then the engine, the shell mount, extension activation, and the single reveal once `document.fonts.ready` settles so text never reflows after the app becomes visible. Extensions activate after the shell mounts so their first state change reaches a subscribed shell.

---

## src/engine/index.ts {#src-engine-index}

### src/engine/index.ts · the History tab's entries move with the documents
- refers-to: src/engine/index.ts :: `done`, `undone`, `setAuthor`, `historyEntries`, `dispatchLocal`, `undo`, `redo`, `loadDocument`, `setShareHooks`
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Each local dispatch pushes an entry (describeCommand, the author, the time) beside the document it records, trimmed at the same 200 steps; undo moves the last entry to undone and redo moves it back, both before commit fires the history event the tab listens to; loading a session clears both. setShareHooks now also clears the local undo stack and the entries: while shared, undo is each editor's own (ui/share.ts), and after leaving, the reported history was empty while engine.undo() could still pop documents from before the share and drop its edits.

### src/engine/index.ts · granular events
- refers-to: src/engine/index.ts :: `Engine.subscribe`, `Engine.update`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Each slice of state (`link`, `transport`) has its own event and listener set, so a subscriber patches only the nodes bound to that slice. formcut's lesson carried over: subscribers name the event they want, and the event names are the state keys, so a typo is a type error rather than a listener that silently never runs. The engine has no DOM dependency.

### src/engine/index.ts · DEFAULT_SESSION_RATE
- refers-to: src/engine/index.ts :: `DEFAULT_SESSION_RATE`
- kind: todo
- logged: v0.1.0 · 2026-09-28

48 kHz until Phase 2 gives the session document its own rate. The clock formats against the transport's `sampleRate`, so nothing else changes when that lands.

---

## src/extensions/registry.ts {#src-extensions-registry}

### src/extensions/registry.ts · contract
- refers-to: src/extensions/registry.ts :: `register`, `activateAll`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

From the dev-rules template. A feature is a folder under `extensions/` that calls `register` on import; `main.ts` imports it. Duplicate ids throw.

---

## src/extensions/engine-link/index.ts {#src-extensions-engine-link}

### src/extensions/engine-link/index.ts · an audio core older than the engine is named
- refers-to: src/extensions/engine-link/index.ts :: `setup` (coreVersion); src/engine/index.ts :: `LinkState.coreVersion`; src/io/engine-client.ts :: `HealthReply.core`; src/ui/shell.ts :: `writeFinal` (the stale state)
- kind: rationale
- logged: v2.13.0 · 2026-10-07

The audio cores are built at install (the Python module in the engine's venv, the WebAssembly in public/core), so an unpacked release runs on the cores the last install built until formwav_oc_install runs again. /api/health reports the core's version; when it differs from the engine's, the chip's dot turns to the warning colour, its title says which versions differ, and the notice line asks for formwav_oc_install. The engine also renders notes on an older Python core, without the synth's filter (backend/HASHOUT_LOG.md, app/routers/midi.py), and an older WebAssembly core ignores the two extra arguments of fw_live_patch.

### src/extensions/engine-link/index.ts · setup
- refers-to: src/extensions/engine-link/index.ts :: `setup`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

One health request at activation; success sets link `ready` with the engine version, any failure sets `offline`. No retry loop yet: a reconnect policy arrives with the jobs surface in Phase 2.

---

## src/io/engine-client.ts {#src-io-engine-client}

### src/io/engine-client.ts · fetchHealth
- refers-to: src/io/engine-client.ts :: `fetchHealth`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Same-origin `/api/health` through the Vite proxy, aborted after 5 s, and rejected unless the reply names formwav with status ok, so another service on 8060 is not mistaken for the engine.

---

## src/ui/icons.ts {#src-ui-icons}

### src/ui/icons.ts · subset and sizes
- refers-to: src/ui/icons.ts :: `ICONS`, `ICON_SIZE`, `icon`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Twelve icons copied byte for byte from the stylized-nodemode mirror of the NodeMode icon module: play, pause, stop, record, skipBack, skipFwd, loop, waveform, settings, info, folderOpen, upload. Add more by copying the exact line from the mirror, never by redrawing. `icon()` wraps the SVG in the `.icon` box from tokens.css with an explicit size so every icon in a row shares one box. Sizes: 16 for controls, 20 for the transport, 48 for the empty-session mark.

---

## src/ui/shell.ts {#src-ui-shell}

### src/ui/shell.ts · the browser's search reads Search
- refers-to: src/ui/shell.ts :: the browser's `[data-browse-search]` placeholder
- kind: rationale
- logged: v2.13.0 · 2026-10-07

The canvas's placeholder, "Search media, effects, sounds", measured 186 px against the field's 145 and showed cut on every screen (the canvas cuts it too). It reads Search; the three tabs above say what it searches, and its accessible name still says media, effects and sounds.

### src/ui/shell.ts · the canvas's markup
- refers-to: src/ui/shell.ts :: `shellHtml` (header, browser, toolbar and store, ruler title, editor anchor, footer), `PANEL_ICONS`, `writeFinal`, the empty stage's actions
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The header is the canvas's: the waveform mark in the accent (it replaces the favicon image), the menus (formcut has File, Edit and View too), the session name, Theme with its accents, undo and redo, Export and the three panel toggles. The footer holds the transport, the position, Tempo, Meter and Snap, Out, Phase and LUFS, and the status column, whose chip reads "Engine connected" (the version moved to its title). The empty session offers Import audio and Open a session as buttons.

### src/ui/shell.ts · mount once, patch in place
- refers-to: src/ui/shell.ts :: `mountShell`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

The whole shell is written once into the empty, hidden `#app` through `mountOnce`, which refuses to overwrite a rendered host. After that only three things change: the engine chip's `data-state`, its text node, and the clock's text, each through `setText` so unchanged values write nothing. The chip reserves 18ch and sits at the trailing edge, so no text change moves anything.

### src/ui/shell.ts · Connecting indicator
- refers-to: src/ui/shell.ts :: `dismissConnecting`, `writeFinal`, `renderLink`
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

"Connecting" appears only if the engine has not answered after 300 ms, and once shown it holds for 250 ms: the final status is written from the indicator's hide callback. Writing the final status directly after dismissal would cut a shown indicator short and blink. When the indicator never showed, the final status is written immediately. Measured v0.1.0 under 4x CPU and Fast 3G: shown at 2444 ms, replaced at 2690 ms (246 ms by the observer's clock, within its resolution), both before the reveal.

### src/ui/shell.ts · removed first draft
- refers-to: src/ui/shell.ts :: `renderLink` (first draft, never committed)
- kind: removed-code
- logged: v0.1.0 · 2026-09-28

```ts
const dismissConnecting = delayedIndicator(
  () => setText(chipText, "Connecting"),
  () => undefined,
);
```

Its `renderLink` wrote the final status right after calling `dismissConnecting()`, which overwrote a shown indicator before its minimum time. Replaced by the hide-callback version above before the first commit.

### src/ui/shell.ts · transport buttons
- refers-to: src/ui/shell.ts :: `TRANSPORT`, `transportButtons`
- kind: todo
- logged: v0.1.0 · 2026-09-28

Rendered disabled so the transport bar's layout exists from the first build; they enable in Phase 2 when the Rust core plays and records. Each has an `aria-label` because the icon is its only label.

---

## src/styles/shell.css {#src-styles-shell}

### src/styles/shell.css · layout and stacking
- refers-to: src/styles/shell.css :: `.fw-shell`, `.fw-topbar`, `.fw-transport`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Three fixed grid rows (top bar, stage, transport) so no region can resize another. The top bar is `auto 1fr auto`: identity leading, actions trailing. Every colour, spacing, radius, size and font comes from a token in `vendor/nodemode/tokens.css`; the only literals are glyph boxes (20px logo, 8px dot) and 1px borders. No `z-index` anywhere; the declared scale is NodeMode's, in tokens.css (`--z-base` to `--z-debug`), and the first overlapping surface will take its layer from there. The accent colour is used in one place, the empty-session mark.

---

## src/vendor/nodemode/ {#src-vendor-nodemode}

### src/vendor/nodemode · provenance and resync
- refers-to: src/vendor/nodemode/tokens.css, themes.ts, dom-stable.ts
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

Verbatim copies of `assets/site/` from the stylized-nodemode pack v1.0.0 (NodeMode v7.1.0), MIT, confirmed byte-identical with `cmp` when copied. Do not edit them here; resync from the pack and re-run the comparison. Not copied, deliberately: the mirror's `light-mode.css` and `scrollbars.css` style NodeMode app selectors the shell does not use, and light profiles already switch through the token values and the `body.theme-light` block in tokens.css (verified in the `sand` profile, v0.1.0).

---

## src/engine/document.ts {#src-engine-document}

### src/engine/document.ts · the session's synth, an empty track, who made a clip
- refers-to: src/engine/document.ts :: `SynthPatch`, `DEFAULT_SYNTH`, `cleanSynth`, `SessionDoc.synth`, `Clip.by`, commands `set-synth`, `add-track`, `import-media` (by)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

SessionDoc.synth is the built-in synth's patch (wave, attack, decay, sustain, release, cutoff 0 for open, resonance), cleaned into range on every set-synth; Add a track dispatches add-track; media the agent places carries by: "agent", which the clip keeps and the lanes show as "Claude" where yours read "you".

### src/engine/document.ts · units and identity
- refers-to: src/engine/document.ts :: `Clip`, `SessionDoc`, `sessionLength`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

`start` and `length` of a clip are integer samples at the session rate; `sourceIn` is in the source file's own frames. The first import sets the session rate to that file's rate, so a single-rate project never resamples; a later file at another rate gets a length converted to session samples (playback resampling arrives with the Rust playback path). The document is immutable: every command returns a new object or the same object when nothing changed, which is what makes snapshot undo cheap and lets subscribers compare by identity.

### src/engine/document.ts · Selection
- refers-to: src/engine/document.ts :: `Selection`, `FrequencyBand`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

Every selection carries a time range and an optional frequency band from the start, per the plan, so spectral editing in Phase 6 reuses the same selection. Selection is engine state but not part of the document, so undo does not move it.

---

## src/engine/history.ts {#src-engine-history}

### src/engine/history.ts · History
- refers-to: src/engine/history.ts :: `History`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

Stores whole document snapshots, which share every unchanged track and clip with their neighbours. 200 steps (`HISTORY_LIMIT` in index.ts); a new command clears the redo stack. `Engine.dispatch` records only when the reducer returned a different object, so no-op commands never create an undo step.

---

## src/io/media-client.ts {#src-io-media-client}

### src/io/media-client.ts · importFile and fetchPeaks
- refers-to: src/io/media-client.ts :: `importFile`, `fetchPeaks`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

The file goes as the raw body with its name URL-encoded in `X-Filename`, matching the engine route; an error reply's `detail` becomes the error message. Peaks arrive as little-endian f32 read straight into a `Float32Array` (every target platform is little-endian).

---

## src/ui/session.ts {#src-ui-session}

### src/ui/session.ts · mountSession
- refers-to: src/ui/session.ts :: `mountSession`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

Called once from main.ts after the shell mounts. The undo and redo buttons change only their `disabled` property, and only when it differs.

---

## src/ui/lanes.ts {#src-ui-lanes}

### src/ui/lanes.ts · who made a clip, at its top right
- refers-to: src/ui/lanes.ts :: the clip node's `.fw-clip-by` (created with the clip, written in the clip's update)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

As on the canvas, each clip names its author opposite its name: "Claude" for media the agent placed (Clip.by), "you" for the rest; the chip is made once with the clip and only its text and data-by are written after.

### src/ui/lanes.ts · rendering without rebuilds
- refers-to: src/ui/lanes.ts :: `mountLanes`, `updateLane`, `updateClip`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

Lanes and clips are reconciled by key with the vendored `patchList`: an existing lane or clip is updated in place, only new ones are created and only gone ones removed. The empty state and the lanes both exist from first paint; `data-view` on the stage chooses which shows. Clip position and width are written only when their values change (tracked in `data-left` and `data-width`). Verified v0.3.0 under 4x CPU and Fast 3G: an import mutated only the notice text, `data-view`, the lanes container's width variable, one new lane, the undo button's `disabled` and the canvas size, with layout shift 0 in dark and `sand`.

### src/ui/lanes.ts · zoom and canvas limits
- refers-to: src/ui/lanes.ts :: `samplesPerPixel`, `MAX_TIMELINE_PX`
- kind: todo
- logged: v0.3.0 · 2026-09-28

100 pixels per second, coarsened only when the session would exceed 16,000 pixels (browsers cap canvas size). Zoom controls come with editing. Each clip has one canvas as wide as the clip, so very long clips at close zoom will need tiling.

### src/ui/lanes.ts · peaks and painting
- refers-to: src/ui/lanes.ts :: `peaksFor`, `paint`, `schedulePaint`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

The finest level (256 samples per peak) is fetched once per media id and shared; each canvas column folds the blocks under it into one min and max per channel, one row per channel. The colour is the canvas's computed `color`, which CSS sets to `--accent-color`, so theme and accent changes repaint through the `nm:ui-settings-changed` listener without reading tokens in script. A canvas paints once, when its peaks are ready, into a box whose size was set before the fetch, so nothing moves.

---

## src/ui/import.ts {#src-ui-import}

### src/ui/import.ts · queue and notice
- refers-to: src/ui/import.ts :: `importOne`, `importAll`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

Files import one after another through a promise queue, each as its own undo step. The notice shows "Importing" only after 300 ms and holds it for 250 ms before the result, the same pattern as the engine chip. The input's value is cleared after reading so choosing the same file again still fires `change`.

---

## src/ui/shortcuts.ts {#src-ui-shortcuts}

### src/ui/shortcuts.ts · scope
- refers-to: src/ui/shortcuts.ts :: `bindShortcuts`
- kind: warning-context
- logged: v0.3.0 · 2026-09-28

Ignored while focus is in an input, textarea, select or editable element, so typing a name never undoes the session.

---

## src/styles/shell.css · v0.3.0

### src/styles/shell.css · #app height, defect fixed
- refers-to: src/styles/shell.css :: first rule, `html, body, #app`
- kind: warning-context
- logged: v0.3.0 · 2026-09-28

From v0.1.0 to v0.3.0's first pass, `#app` had no height, so the shell was only as tall as its content and the transport bar sat mid-window. v0.1.0 measured no layout shift because nothing changed size; its screenshots, which were not looked at, would have shown it. v0.3.0's import swapped a tall empty state for a short lane and the transport jumped 107 px (layout shift 0.0116, traced through the entry's sources). Adding `#app` to the full-height rule pins the transport to the window bottom: y=744 of 800 before and after an import, layout shift 0.

### src/styles/shell.css · lane head stacking
- refers-to: src/styles/shell.css :: `.fw-lane-head`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

The head is sticky on the left so names stay visible when the timeline scrolls; clips are absolutely positioned later in the DOM and would paint over it, so the head takes `--z-raised` from the declared scale. No raw z-index.

---

## src/ui/transport.ts {#src-ui-transport}

### src/ui/transport.ts · Follow
- refers-to: src/ui/transport.ts :: `setFollow`, the paging condition
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The toolbar's Follow turns the view's paging after the playhead on and off (on by default, as before).

### src/ui/transport.ts · what changes during playback
- refers-to: src/ui/transport.ts :: `placePlayhead`, `renderTransport`
- kind: rationale
- logged: v0.4.0 · 2026-09-28

The playhead moves by `transform` only, written when the value changes, so playback never touches layout; the clock changes its text; Play reflects state through `aria-pressed`. Verified v0.4.0 under 4x CPU and Fast 3G: layout shift 0 during playback, and the only mutations were the clock text, the playhead's style and `aria-pressed` (plus a `style` write on the hidden file input made by Playwright's file chooser, not by formwav). Buttons are found by their `aria-label`, which ties them to the English labels until the interface is translated; a `data-action` on the transport buttons replaces that when the shell next changes.

### src/ui/transport.ts · keys and seeking
- refers-to: src/ui/transport.ts :: keydown listener, lanes click listener
- kind: explainer
- logged: v0.4.0 · 2026-09-28

Space toggles play and Home goes to the start, both ignored in form fields and on focused buttons (where Space already activates the button). A click in a lane body seeks to that point: 150 px at 100 px per second landed on 72,000 samples, 1.500 s, in v0.4.0.

---

## src/audio/player.ts {#src-audio-player}

### src/audio/player.ts · the live instrument plays the session's synth
- refers-to: src/audio/player.ts :: `sendPatch`, `setLivePatch`, the patch sent on start and on a document change; src/audio/player-worklet.ts :: the live-patch message
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The worklet's live instrument (the Synth keys, Pads, the touchpad, a MIDI keyboard) gets the session's patch when it starts and whenever the document's synth changes; setLivePatch sends a draft while a Synth knob is dragged, so the change is heard before it is committed. The core's synth filters the voices' sum with the same low-pass as render(), so the live sound and the rendered note clips match sample for sample (native/HASHOUT_LOG.md).

### src/audio/player.ts · de-click and de-reverb take a track to its own bus
- refers-to: src/audio/player.ts :: `planClips` (the rule sending a track through a bus of its own); backend app/services/render.py :: `plan`; backend tests/test_plan_parity.py, tests/test_restoration.py
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

The core reads a chain ahead by its latency only on a bus (RX-16), and this rule sent a track there for a compressor, a reverb or the dialogue isolate, not for de-click (3.5 ms behind) or de-reverb (1023 samples), which the catalogue offers as running "3.5 ms behind" and "21 ms behind" and the core's L6 entries call compensated. On a track they played and exported that late against the other tracks. They now join the rule, here and in the export's plan (the backend log's render entry has the measurements: the peak against the dry export from 172 and 1023 samples to 0). The backend's parity test loads this module through Vite and holds its plan to the export's on 96 sessions, so the two rules cannot drift apart again unseen. As for the kinds before them, a track sent to its own bus loses its filter automation (bus chains are not automated). Still late, for the owner: these stages in a clip's chain, the master's, or on a track routed to a user bus.

### src/audio/player.ts · contexts and loading
- refers-to: src/audio/player.ts :: `Player.ensure`, `loadInto`, `planClips`
- kind: rationale
- logged: v0.4.0 · 2026-09-28

The AudioContext runs at the session rate, so the core never resamples and the browser converts to the device rate. Media bytes come from `/api/media/{id}/audio` and are transferred, not copied, into the worklet, which decodes them with the Rust decoder. `planClips` turns the document into worklet clips: mute and solo honoured, gains in dB made linear, clips at another sample rate left out and counted (the notice says so). A document change while a context exists re-sends the plan, so gain changes are heard live.

### src/audio/player.ts · first play waits for the transfer
- refers-to: src/audio/player.ts :: `Player.play`
- kind: todo
- logged: v0.4.0 · 2026-09-28

The first play of a file waits for its bytes to reach the worklet: under the Fast 3G profile the 576 KB test file took about 3 s. Prefetching into the worklet on import, and a delayed "Loading audio" indicator, come next.

### src/audio/player.ts · bounce and the offline race
- refers-to: src/audio/player.ts :: `Player.bounce`
- kind: warning-context
- logged: v0.4.0 · 2026-09-28

Renders the session through the same worklet and core in an OfflineAudioContext. The first version posted `clips`, `seek` and `play` and started rendering at once; offline rendering finished before those messages were handled and the result was silent (null-test error equal to the signal peak). Messages are handled in order, so it now posts `clips` and `play`, then waits for the worklet's reply to a final `seek` before rendering. Verified: bit-identical to the source at unity gain, within 3.7e-8 at -6 dB.

---

## src/audio/player-worklet.ts {#src-audio-player-worklet}

### src/audio/player-worklet.ts · live-patch
- refers-to: src/audio/player-worklet.ts :: the `live-patch` message branch
- kind: explainer
- logged: v2.13.0 · 2026-10-07

A live-patch message calls the core's fw_live_patch with the wave index, the envelope, the gain, the cutoff and the resonance; the core's set_patch swaps the patch and retunes its filter without clearing the voices, so a held note is not cut.

### src/audio/player-worklet.ts · starting the core
- refers-to: src/audio/player-worklet.ts :: `PlayerProcessor` constructor, the `init` branch
- kind: warning-context
- logged: v0.4.0 · 2026-09-28

The first version posted a compiled `WebAssembly.Module` to the worklet; Chromium delivered no `init` and gave no error on the page, so playback stalled silently. The worklet now receives the wasm bytes (an ArrayBuffer always clones) and compiles them itself, and every message is handled inside a try that sends any failure back as an `error` reply, which `makeNode` turns into a thrown error.

### src/audio/player-worklet.ts · render loop
- refers-to: src/audio/player-worklet.ts :: `process`
- kind: todo
- logged: v0.4.0 · 2026-09-28

Renders into two wasm-side buffers sized for 4,096 frames and copies them out; posts the position every 8 render quanta and `ended` at the session end. It creates two small typed-array views per quantum, which allocates on the audio thread; caching the views (rebuilt only when memory grows) is the next refinement.

---

## v0.4.1 · playback polish

### src/audio/player.ts · prefetch and one load per file (resolves the v0.4.0 first-play todo)
- refers-to: src/audio/player.ts :: `prefetch`, `load`, `ensure`, `start`
- kind: rationale
- logged: v0.4.1 · 2026-09-28

Every document change checks for media not yet loading and, when the session has tracks, starts the context (suspended until Play, which satisfies autoplay rules) and transfers those files into the worklet. `load` keeps one promise per media id, so prefetch and Play share a transfer; `ensure` shares one in-flight `start`, so two callers never open two contexts; `start` clears the pending loads when it replaces a context. Verified v0.4.1 under 4x CPU and Fast 3G: with the prefetch finished, Play reached playing in 72 ms (about 3,000 ms in v0.4.0); pressed straight after import it took 3,277 ms, and in both cases the file was requested once.

### src/ui/transport.ts · loading notice
- refers-to: src/ui/transport.ts :: `togglePlay`
- kind: explainer
- logged: v0.4.1 · 2026-09-28

The same delayed-indicator pattern as import: "Loading audio" appears only if Play has not resolved after 300 ms, holds at least 250 ms, then gives way to the outcome (empty, the skipped-clip count, or the error). When Play is fast the notice is not touched at all: verified, no notice change after a prefetched Play.

### src/ui/transport.ts and src/ui/shell.ts · data-action (resolves the aria-label todo)
- refers-to: src/ui/shell.ts :: `TRANSPORT`, `transportButtons`; src/ui/transport.ts :: `button`
- kind: explainer
- logged: v0.4.1 · 2026-09-28

Each transport button carries `data-action` (to-start, play, stop, record, loop) and the wiring selects by it, so labels can change or be translated freely. Record and Loop's tooltips say they are not built yet, replacing the stale "arrives in v0.2.0".

### src/audio/player-worklet.ts · cached views (resolves the render-loop todo)
- refers-to: src/audio/player-worklet.ts :: `process`, `views`
- kind: explainer
- logged: v0.4.1 · 2026-09-28

The two output views are kept and rebuilt only when wasm memory grows (its buffer changes) or the block size changes, so the steady-state render loop allocates nothing. The offline null test runs through this loop and stayed bit-identical.

---

## src/ui/record.ts {#src-ui-record}

### src/ui/record.ts · the input meter's label in words
- refers-to: src/ui/record.ts :: the input meter's label
- kind: explainer
- logged: v2.13.0 · 2026-10-07

"In" rather than "IN", as the canvas writes Out; the input meter shows in the footer while a track is armed (src/ui/musical.ts).

### src/ui/record.ts · flow
- refers-to: src/ui/record.ts :: `begin`, `finish`, `toggle`
- kind: explainer
- logged: v0.5.0 · 2026-09-28

Record, or R, asks for the microphone, starts the session playing open-ended (so the clock runs and existing tracks are heard) and arms the recorder at the current position. Record again, R, or Stop ends it: the take is assembled, encoded as a float32 WAV named "Take N", stored through the ordinary import route and dispatched as `import-media` at the position recording began, so it is one undo step like any import. Refused access and other failures are named in the notice. Verified v0.5.0 with Chromium's fake capture device playing a 440 Hz sine at 0.5: the take bounced back at peak 0.5000 and 440 Hz, a take started after seeking to 0.5 s landed at 24,000 samples, and undo removed it.

### src/ui/record.ts · meter and button states
- refers-to: src/ui/record.ts :: `showLevel`, `renderRecording`
- kind: rationale
- logged: v0.5.0 · 2026-09-28

The meter is created once at mount; its bar moves by `scaleX` on a -60 to 0 dBFS scale, written only when the value changes, and `aria-valuenow` changes only in tenths. A 0.5 input (about -6 dBFS) read `scaleX(0.9)`. Record's `aria-pressed` is rendered at mount, not on the first transport event: the lazy version wrote the attribute after reveal. Stop is enabled while recording even in an empty session, where `transport.ts` alone would keep it disabled until the first take lands; both screenshots of the first take found this.

### src/ui/record.ts · not yet
- refers-to: src/ui/record.ts :: module
- kind: todo
- logged: v0.5.0 · 2026-09-28

No latency compensation: a take is placed where recording started, not shifted by input and output latency, so overdubs sit late by the round trip until spike A measures it. No live lane while recording (the empty state stays until the first take lands). Take numbers restart with each page load.

---

## src/audio/recorder.ts {#src-audio-recorder}

### src/audio/recorder.ts · capture in the player's context
- refers-to: src/audio/recorder.ts :: `startRecording`
- kind: rationale
- logged: v0.5.0 · 2026-09-28

The microphone joins the player's AudioContext, so capture and playback share one clock and one sample rate (the session's); the browser converts the device's rate. Echo cancellation, noise suppression and automatic gain are off, because a recording tool must take the signal as it is. The recorder node has one silent output connected to the destination so it is always processed. `encodeWav` writes IEEE float 32 (format tag 3), which the Rust decoder reads, so a take loses no resolution.

---

## src/audio/recorder-worklet.ts {#src-audio-recorder-worklet}

### src/audio/recorder-worklet.ts · chunks and levels
- refers-to: src/audio/recorder-worklet.ts :: `process`, `flush`
- kind: explainer
- logged: v0.5.0 · 2026-09-28

Input is copied into 8,192-frame chunks per channel and transferred, not copied, to the main thread when a chunk fills and when recording stops; `stopped` follows the last chunk, so the take is complete when the main thread resolves. The peak is reported every 8 render quanta. One chunk buffer is allocated per 8,192 frames, not per quantum.

---

## src/audio/player.ts · v0.5.0

### src/audio/player.ts · playing is owned by the main thread (defect fixed)
- refers-to: src/audio/player.ts :: `onReply`
- kind: warning-context
- logged: v0.5.0 · 2026-09-28

Since v0.4.0, `play()` set playing true and then the worklet's reply to the preceding `seek` arrived saying `playing: false`, so the Play button un-pressed for one report interval (about 20 ms) before the next report pressed it again. v0.4.0's verification logged 3 `aria-pressed` changes on starting playback and it was not questioned; v0.5.0's recording run logged 5 where 2 were expected and the cause was traced. Position reports now update the position only; playing changes only through `play`, `stop` and the worklet's `ended`. Verified: 1 change on starting playback, 2 on starting a recording.

### src/audio/player.ts · open-ended play and context()
- refers-to: src/audio/player.ts :: `play(open)`, `sendPlan`, `context`
- kind: explainer
- logged: v0.5.0 · 2026-09-28

`play(true)` sends no end position, so the clock keeps running past the last clip while recording; `stop` clears it. `context()` gives the recorder the running context.

---

## src/ui/projects.ts {#src-ui-projects}

### src/ui/projects.ts · the line under the session's name
- refers-to: src/ui/projects.ts :: `writeState`, `savedAt`
- kind: explainer
- logged: v2.13.0 · 2026-10-07

As the canvas's "Saved two minutes ago": Nothing to save yet, Not saved yet, Unsaved changes, Saved at (the time of the last save) or No changes since opening, written on every document change and after a save or an open.

### src/ui/projects.ts · save and open
- refers-to: src/ui/projects.ts :: `save`, `open`, `withNotice`
- kind: explainer
- logged: v0.6.0 · 2026-09-28

Save (button, Enter in the name field, Cmd or Ctrl S) sends the current document under the field's name, "Untitled session" when empty. Open loads a session through `engine.loadDocument`, which replaces the document, clears undo history and resets the transport; the player then prefetches its media as for any document change. Opening over unsaved changes asks first with the browser's confirm dialog (unsaved means the document differs from the one last saved or opened and has tracks). Both show their pending text only after 300 ms, like import.

### src/ui/projects.ts · the Open popover, the first overlay
- refers-to: src/ui/projects.ts :: `show`, `close`, `popover`
- kind: rationale
- logged: v0.6.0 · 2026-09-28

Created once at mount inside `#overlay-root`, so no ancestor can clip or trap it, on the declared `--z-menu` layer (200). The list is filled by `patchList` while the popover is still hidden, then it is placed under the Open button and shown in one step, and focus moves to the first row. Escape, a pointer down outside it, or opening a session closes it; `aria-expanded` on Open follows. Verified v0.6.0 under 4x CPU and Fast 3G: opening a session after a reload gave layout shift 0, and every mutation was the popover's own position, visibility and list, `aria-expanded`, the lanes, the enabled transport buttons, the notice and the canvases. The same run recorded one `style` write on each of the two form inputs, which no formwav code path makes; its origin was not identified.

### src/ui/shell.ts · name-field class collision, defect fixed
- refers-to: src/ui/shell.ts :: the session-name input; src/styles/shell.css :: `.fw-session-name`
- kind: warning-context
- logged: v0.6.0 · 2026-09-28

The field was first given the class `fw-name`, which the brand label in the top bar already uses. `querySelector('.fw-name')` returned the brand span, so Save would have thrown reading `.value` of a span, and the new CSS restyled the brand label as an input. The harness failed to type into the field and a measurement of its box exposed the collision. The field is now `input.fw-session-name`, selected with its tag. Before naming a class, search the shell for it.

---

## src/io/projects-client.ts {#src-io-projects-client}

### src/io/projects-client.ts · calls
- refers-to: src/io/projects-client.ts :: `listProjects`, `saveProject`, `openProject`
- kind: explainer
- logged: v0.6.0 · 2026-09-28

Names are URL-encoded into the path; the document travels as JSON; an error reply's `detail` becomes the thrown message, which the notice shows.

### src/engine · loadDocument and History.clear
- refers-to: src/engine/index.ts :: `loadDocument`; src/engine/history.ts :: `clear`
- kind: explainer
- logged: v0.6.0 · 2026-09-28

Opening a session is not an undoable edit: history is cleared, so Ctrl Z cannot step back into the previous session. Verified: undo disabled after opening.

---

## v0.7.0 · track pan

### src/engine/document.ts · pan and set-track-pan
- refers-to: src/engine/document.ts :: `Track.pan`, `set-track-pan`
- kind: rationale
- logged: v0.7.0 · 2026-09-28

Pan runs from -1 (left) to 1 (right) and is optional on `Track`, so sessions saved before v0.7.0 open unchanged and read as centred. The command clamps to the range and is a no-op when the value is unchanged, so it never creates an empty undo step; it is undoable like every edit (verified). There is no pan control in the interface yet: the mixer arrives in Phase 3.

### src/audio/player.ts and player-worklet.ts · pan to the core
- refers-to: src/audio/player.ts :: `planClips`; src/audio/player-worklet.ts :: `WorkletClip`, `fw_add_clip`
- kind: warning-context
- logged: v0.7.0 · 2026-09-28

Each clip carries its track's pan (`?? 0`) to `fw_add_clip`; the pan law itself lives only in `render.rs`. `planClips` has a twin in `backend/app/services/render.py`: change both together, and rerun `verify_render.py`, whose null test between the browser's render and the engine's caught nothing in v0.7.0 (0.0 on both channels).

---

## v0.8.0 · fades, crossfades, clips

### src/engine/document.ts · clip commands
- refers-to: src/engine/document.ts :: `add-clip`, `remove-clip`, `set-clip-fades`, `crossfade`, `FadeShape`
- kind: rationale
- logged: v0.8.0 · 2026-09-28

`add-clip` places media already in the session onto a track (kept sorted by start) and `remove-clip` takes a clip off; together they let two clips overlap on one track, which import alone never produced. `set-clip-fades` clamps the fade-in to the clip and the fade-out to what remains, and is a no-op when nothing changes (verified: no undo step). `crossfade` finds the overlap of a left and a right clip on the same track and sets the left clip's fade-out and the right clip's fade-in to it, equal power unless told otherwise; a clip has one shape for both its fades, so a crossfade sets the shape of both clips. Fade fields are optional, so older sessions open without them. All four are undoable (verified for crossfade). No fade handles in the interface yet: fades are drawn and dragged with the editing surface in Phase 3, and the lanes do not show them.

### src/audio/player.ts and player-worklet.ts · fades to the core
- refers-to: src/audio/player.ts :: `planClips`; src/audio/player-worklet.ts :: `WorkletClip`, `fw_add_clip`
- kind: warning-context
- logged: v0.8.0 · 2026-09-28

Each clip carries `fadeIn`, `fadeOut` (0 when absent) and a shape code (1 equal power, 0 linear) to `fw_add_clip`; the curves live only in `render.rs`. The twin in `backend/app/services/render.py` changed in the same commit series; `verify_fades.py` compares the two renders.

---

## src/ui/loop.ts {#src-ui-loop}

### src/ui/loop.ts · Loop button, L key, band
- refers-to: src/ui/loop.ts :: `mountLoop`, `toggle`, `render`
- kind: explainer
- logged: v0.9.0 · 2026-09-28

Loop (button or L) toggles the saved loop range, or the first time loops the whole session. The button is disabled without tracks and pressed while the loop is on. The band is created once at mount inside the lanes, after the playhead, with no z-index: it paints over clips and under the sticky lane heads, lets clicks through, moves by `transform`, and writes its width only when it changes. Verified v0.9.0: after L the band was 300 px wide at 0 over a 3 s session; 4.5 s of playback kept playing, wrapped backwards and never passed the end; layout shift 0; mutations only the clock, playhead and Play's `aria-pressed` (plus the unexplained `style` writes on the two form inputs noted in v0.6.0).

### src/ui/loop.ts · band hard to see
- refers-to: src/ui/loop.ts :: band; src/styles/shell.css :: `.fw-loop-band`
- kind: todo
- logged: v0.9.0 · 2026-09-28

When the loop covers exactly a clip, as in the first-loop default, the band's tint and edges coincide with the clip's and it is barely visible (seen in the v0.9.0 screenshot). Loop markers belong in a timeline ruler, which arrives with the editing surface; there is also no way yet to set a custom range except the `set-loop` command.

### src/engine/document.ts · loop and regions
- refers-to: src/engine/document.ts :: `LoopRange`, `Region`, `set-loop`, `add-region`, `remove-region`
- kind: rationale
- logged: v0.9.0 · 2026-09-28

Both are optional on the document, so older sessions open without them, and both are saved in `.fmw` with the rest of the document. Commands normalise reversed bounds, refuse empty ranges, trim labels ("Region" when empty) and are no-ops when nothing changes. Loop changes are undo steps because the loop range is part of the saved session (verified: undo re-armed a disarmed loop, a second undo removed it). Regions have no interface yet. `sendPlan` sends the loop to the worklet and drops the end-stop while it is on, so a loop reaching past the last clip keeps playing.

---

## src/ui/export.ts and src/io/render-client.ts {#src-ui-export}

### src/ui/export.ts · Export
- refers-to: src/ui/export.ts :: `mountExport`, `run`; src/io/render-client.ts :: `renderMix`
- kind: explainer
- logged: v0.10.0 · 2026-09-28

Export (button or Cmd or Ctrl Shift E, disabled without tracks) posts the document to `/api/render` and downloads the returned WAV under the session name, with characters that file systems refuse replaced by hyphens. The download goes through a detached anchor, so nothing is inserted into the page, and the object URL is released after ten seconds. The notice reports the loudest peak in dBFS and the integrated loudness in LUFS ("silent" when there is none), and counts clips left out for being at another sample rate; "Exporting" appears only after 300 ms. Verified v0.10.0: the file saved by the browser was byte-identical to `/api/render` for the same document, the notice matched the response headers, layout shift 0. `render-client.ts` sits in `io/` beside the other clients; the io lines of the map above were not updated for it in this series.

---

## v0.11.0 · buses

### src/engine/document.ts · buses and routing
- refers-to: src/engine/document.ts :: `Bus`, `Track.busId`, `add-bus`, `remove-bus`, `route-track`, `set-bus-gain`, `set-bus-pan`
- kind: rationale
- logged: v0.11.0 · 2026-09-28

Buses are optional on the document and a track without `busId` feeds master, so older sessions open unchanged. `add-bus` trims the name ("Bus" when empty); `remove-bus` routes its tracks back to master in the same undo step; `route-track` refuses a bus that does not exist (verified: no undo step) and takes `null` for master; gain and pan setters are no-ops when unchanged. Verified: undoing a bus removal restored the bus and its routing. There is no bus strip in the interface yet: the mixer is Phase 3.

### src/audio/player.ts · bus resolution twin
- refers-to: src/audio/player.ts :: `planClips`, `ClipPlan.buses`; src/audio/player-worklet.ts :: `WorkletBus`, the clips handler
- kind: warning-context
- logged: v0.11.0 · 2026-09-28

`planClips` numbers unmuted buses from 1 in document order, drops tracks on muted buses, and gives each clip its bus index (0 for master or an unknown bus), exactly as `plan` in `backend/app/services/render.py`; the clips message carries the bus list and the worklet rebuilds the core's buses on every plan. Change both twins together and rerun `verify_buses.py`. The map gap noted for `render-client.ts` in v0.10.0 is closed above.

---

## v0.12.0 · save conflicts

### src/ui/projects.ts · known revision and the conflict prompt
- refers-to: src/ui/projects.ts :: `known`, `save`, `open`; src/io/projects-client.ts :: `saveProject`, `RevisionConflict`
- kind: rationale
- logged: v0.12.0 · 2026-09-28

Each window remembers the name and revision of the session it last saved or opened. Saving under that name sends its revision as `base`; saving under any other name sends 0, meaning "new". A 409 becomes `RevisionConflict` carrying the server's revision, and the window asks with the browser's confirm dialog: "already exists" for a new name, "saved from another window" otherwise. Declining leaves the saved file untouched and says so; accepting retries once against the server's revision. Verified v0.12.0 with three windows: A saved, B opened and saved over it, A was asked, declined (B's version kept), then accepted on the next save (revision 3, A's content); a fresh window saving under the same name was told it exists and declined. The v0.6.0 round-trip harness also crossed an "already exists" prompt and still null-tested at 0.

---

## src/ui/ruler.ts and the v0.13.0 timeline {#src-ui-ruler}

### src/ui/ruler.ts · the corner's title
- refers-to: src/ui/ruler.ts :: the ruler's corner markup
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The corner above the track heads reads "Sections, time", as on the canvas, naming the ruler's two rows.

### src/ui/ruler.ts · one canvas
- refers-to: src/ui/ruler.ts :: `mountRuler`, `draw`, `label`
- kind: rationale
- logged: v0.13.0 · 2026-09-28

Created once at mount and inserted before the lanes, so it scrolls with them, sticky at the top on `--z-selected` with a sticky corner over the lane heads on `--z-raised`. Everything is drawn on one canvas, so zooming or editing never adds or removes DOM: labels at the first step in the list that leaves 80 px between labels, minor ticks at a fifth of that when they are at least 6 px apart, the loop range as a bar across the top (faded when off), regions as bars with labels along the bottom. Colours come from computed CSS on the canvas (`color`, `border-top-color`, `outline-color`), not tokens read in script. Redraws on document changes, zoom, theme changes and resize. A pointer down seeks. The region label touches the minor ticks (seen in the v0.13.0 screenshot); cosmetic, left for the ruler's next pass.

### src/styles/shell.css · ruler canvas overflow, defect fixed
- refers-to: src/styles/shell.css :: `.fw-ruler` `grid-template-rows`
- kind: warning-context
- logged: v0.13.0 · 2026-09-28

A canvas has an intrinsic height of 150 px. In the ruler's grid the row sized to that content, so the canvas overflowed its 32 px ruler and lay over the first lane, where it swallowed every pointer event: drags never reached the clip. The first timeline harness run surfaced it as a confusing failure (its Ctrl+Z then undid an import instead of a move); a step-by-step replay showed the drag had not committed, and `elementFromPoint` at the clip's centre returned the ruler canvas. `grid-template-rows: minmax(0, 1fr)` pins the row to the ruler's own height (31 px measured after); `overflow: hidden` was avoided because it would stop the sticky corner staying put in horizontal scroll.

### src/ui/lanes.ts · zoom
- refers-to: src/ui/lanes.ts :: `zoom`, `setZoom`, `onZoom`, `samplesPerPixel`
- kind: explainer
- logged: v0.13.0 · 2026-09-28

Zoom is view state, not document state, so it is not saved or undone. It multiplies the base 100 px per second, from 0.25 to 16, and is still capped by the 16,000-pixel timeline limit. `=` doubles, `-` halves, `0` resets; lanes, playhead, loop band and ruler all re-render through `onZoom`. Verified: at 2x clip widths doubled (300 to 600 px, 1000 to 2000 px) and the playhead moved from 100 to 200 px; halving twice gave 150 px; reset gave 300 px. There is no zoom control on screen yet, and zoom does not keep the playhead in view.

### src/ui/lanes.ts · select, slip, delete
- refers-to: src/ui/lanes.ts :: pointer handlers, `markSelected`, keydown handler; src/ui/transport.ts :: lanes click guard
- kind: rationale
- logged: v0.13.0 · 2026-09-28

A pointer down on a clip selects it and captures the pointer; moving more than 3 px starts a slip drag that moves the clip by `transform` only, clamped so it cannot pass time zero; release clears the transform and dispatches one `move-clip`, so a drag is one undo step and the committed position lands in the same frame. Delete or Backspace removes the selected clip (one undo step); Escape or a pointer down on empty lane space deselects. Clicks on clips no longer seek; empty lane space and the ruler do. Verified: a 100 px drag committed exactly 48,000 samples with only transform writes during the drag; undo, delete, undo delete, Escape and empty-lane deselect behaved; layout shift 0. Grid and shuffle modes, the smart tool, split and trim are the next Phase 3 steps.

---

## v0.14.0 · split, trim, fades on the timeline

### src/engine/document.ts · split-clip and set-clip-bounds
- refers-to: src/engine/document.ts :: `split-clip`, `set-clip-bounds`
- kind: rationale
- logged: v0.14.0 · 2026-09-28

`split-clip` cuts a clip at a session position strictly inside it: the left part keeps the clip's id and fade-in, the right part gets a new id, its source offset advanced by the cut (converted to source frames), and the fade-out; either part's fades are clamped to its new length. `set-clip-bounds` sets start, source offset and length together, refusing a negative start or offset, an empty clip, or one running past the end of its media, and clamps the fades. Both are no-ops when nothing changes. Verified: a split at 2.5 s rendered bit-identical to the unsplit clip (difference 0 over 480,000 frames); undo and redo.

### src/ui/lanes.ts · one gesture model
- refers-to: src/ui/lanes.ts :: `GestureKind`, `limits`, `preview`, `restore`, `commit`, pointer handlers
- kind: rationale
- logged: v0.14.0 · 2026-09-28

The pointer-down target decides the gesture: a fade handle is a fade, within 6 px of a side edge is a trim, anything else is a move. Each gesture's limits are worked out first, in pixels, so the preview can never show what the document would refuse (before time zero, before the source's start or past its end, fades crossing). The preview uses `transform`, and for trims the clip's own width; release restores the committed look and dispatches one command, so a gesture is one undo step. Trimming the left edge moves the start and the source offset together, so the audio stays where it was in time. Source offsets are taken as session samples, which holds while clips play at the session rate (other-rate clips are silent until resampling). Verified: a left-edge trim of 50 px gave 144,000 / 336,000 / source 144,000, silence in the gap and the source unchanged elsewhere; a right-edge trim gave 96,000; a trim past the source's start was clamped and recorded nothing; only clip `style` and selection changed during a drag.

### src/ui/lanes.ts and shell.css · handles, trim zones, drawn fades
- refers-to: src/ui/lanes.ts :: `clipNode`, `updateClip`, `paint`; src/styles/shell.css :: `.fw-clip::before`, `.fw-clip::after`, `.fw-fade-handle`, `.fw-wave`
- kind: explainer
- logged: v0.14.0 · 2026-09-28

Each clip is created with two fade handles in its top corners, placed by `transform` at the fade's length and shown on hover or selection. The trim zones are pseudo-elements down the clip's sides below a top band, so their `ew-resize` cursor shows without script and the corners stay with the handles. `paint` shades the cut-away area above each fade curve with the canvas's computed `outline-color` and follows the fade's shape. S splits the selected clip at the playhead. Verified: the fade-in handle dragged 50 px set 24,000 samples and the render ramped k / 24,000 within 2.7e-8; the fade-out handle dragged 100 px set 48,000; the screenshot showed both fades drawn and the handles in place. Grid snapping and shuffle mode are still to come.

---

## src/ui/grid.ts, the clip gain line and the transport row (v0.15.0) {#src-ui-grid}

### src/ui/grid.ts · one step for the ruler and the grid
- refers-to: src/ui/grid.ts :: `labelStep`, `snapSamples`, `mountGrid`; src/ui/ruler.ts :: `draw`
- kind: rationale
- logged: v0.15.0 · 2026-09-28

The step list the ruler used moved here so the ruler's labels and the grid's snap points cannot drift apart. Grid mode (the Grid button in the transport bar, or G) snaps the anchor edge of a move or a trim to the ruler's minor ticks, a fifth of the labelled step at the current zoom, so the grid tightens as you zoom in. Fades and gain are not snapped; seeks are not snapped yet. Verified at 100 px per second (0.2 s grid): a 37 px move landed on 17,760 without the grid and on 19,200 with it; a right-edge trim of -130 px put the end on 441,600.

### src/ui/lanes.ts · the clip gain line
- refers-to: src/ui/lanes.ts :: `gainFraction`, `gainLabel`, `dragGain`, `clipNode`, `updateClip`, the `gain` gesture; src/engine/document.ts :: `set-clip-gain`
- kind: rationale
- logged: v0.15.0 · 2026-09-28

Each clip has a line whose height maps +12 dB at the top to -36 dB at the bottom (0 dB a quarter of the way down), measured against the clip's client height, the same box its `top` percentage uses. Dragging it vertically previews by `transform` with a live dB label and commits one `set-clip-gain` (clamped to -60 to +12 dB, tenths, no-op when unchanged). The waveform is drawn scaled by the clip gain. Verified: a 22 px drag on an 86 px clip gave -12.3 dB (22 / 86 x 48); the render equalled the source times 10^(-12.3 / 20) within 6e-9; undo returned 0 dB. The first expectation of -12.0 dB used the clip's bounding height, borders included; the app's mapping was right.

### src/styles/shell.css · transport bar as a flex row, defect fixed
- refers-to: src/styles/shell.css :: `.fw-transport`
- kind: warning-context
- logged: v0.15.0 · 2026-09-28

The bar was a grid of three columns (`auto auto 1fr`) made for the controls and the clock; the meter appended in v0.5.0 took the third, and the Grid button, a fourth child, fell onto an implicit second row that overflowed the bar and pushed the meter out of it. Only the screenshot showed it. The bar is now a flex row: controls, clock, Grid and meter measured in one row inside the bar after the fix, and the recording regression's meter reading was unchanged.

---

## v0.16.0 · selections of several clips

### src/engine/document.ts · batch
- refers-to: src/engine/document.ts :: `batch`
- kind: rationale
- logged: v0.16.0 · 2026-09-28

`batch` applies a list of commands in order to the running document, so any group edit is one undo step and reuses the single-clip rules exactly; if nothing changes, nothing is recorded (verified: a clamped group move added no step).

### src/ui/lanes.ts · selection as a set, group gestures
- refers-to: src/ui/lanes.ts :: `selectedClipIds`, `Member`, `Gesture.group`, pointer-down, `preview`, `restore`, `commit`, keydown
- kind: rationale
- logged: v0.16.0 · 2026-09-28

Shift-click on a clip's body toggles it in the selection without dragging; a plain press on an unselected clip selects only that clip, on a selected clip keeps the group. Moving any selected clip moves the whole selection by the same amount, previewed by `transform` on every member; the left limit is the tightest across the group, so no member can pass time zero; in Grid mode the grabbed clip's edge snaps and the rest follow. Trims, fades and gain still act on the clip under the pointer. Cmd or Ctrl A selects all; S splits every selected clip the playhead is inside; Delete removes the selection; each is one `batch`. Escape or a plain press on empty lane space clears the selection; with Shift held it is kept. Verified with two clips on two tracks: a group move of 50 px moved both by 24,000 in one step and undo returned both; a -200 px group move held at the earlier clip's zero and recorded nothing; Shift-toggle, select all, Escape and the empty-space rules behaved; a group split made 2 + 2 clips and a group delete removed all, each one step.

### src/ui/transport.ts and ruler.ts · snapped seeks
- refers-to: src/ui/transport.ts :: lanes click; src/ui/ruler.ts :: pointerdown
- kind: explainer
- logged: v0.16.0 · 2026-09-28

In Grid mode a click on empty lane space or on the ruler moves the playhead to the nearest grid tick. Verified at 37 px: 19,200 with the grid, 17,760 without, on both. The first harness run clicked the lane where a clip lay (clicks on clips deliberately do not seek) and read stale positions; the saved harness clicks an empty lane. Each selected clip shows its gain label, and on a long clip it can be cut off at the window's edge (seen in the screenshot); cosmetic.

---

## src/ui/meter.ts and the output level path (v0.17.0) {#src-ui-meter}

### src/ui/meter.ts · Phase in words, in the footer
- refers-to: src/ui/meter.ts :: `mountOutputMeter` (the phase meter's label); src/styles/canvas.css (.fw-status .fw-phase-meter)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The canvas's footer has Out and LUFS; the correlation meter stays between them as "Phase" (it was a bare φ), 44 px wide, green when positive and red when cancelling. Below 1440 px the footer's gaps and the Out bars narrow so the transport fits at 1288 by 683.

### src/audio/player-worklet.ts and player.ts · peaks to listeners
- refers-to: src/audio/player-worklet.ts :: `report`, `peaks`; src/audio/player.ts :: `onOutputLevel`, `emitLevel`, `onReply`, `stop`
- kind: warning-context
- logged: v0.17.0 · 2026-09-28

Every position report (about every 21 ms while playing) takes the master peaks from the core into a two-float buffer allocated once at init and carries them to the main thread, where the player publishes them to its level listeners. Stop publishes silence. The first version froze the meter after stop: the worklet answers the stop message with a position report whose leftover peaks arrived after the silence, and no further report ever lowered them. Levels are now published only while the transport is playing, so that late report, and reports from seeking while stopped, are ignored (verified: both bars at 0 after stop).

### src/ui/meter.ts · the meter
- refers-to: src/ui/meter.ts :: `mountOutputMeter`
- kind: explainer
- logged: v0.17.0 · 2026-09-28

Created once at mount in the transport bar: two bars (left, right) on the input meter's -60 to 0 dBFS scale, moved by `scaleX` only and written only when the value changes; each bar shows the new peak or falls back at 20 dB per second, whichever is higher, and a report of two zeros empties both. A peak at or above 1.0 latches the clip indicator (the danger token) until it is clicked. Verified on the stereo test file: the right bar held exactly scaleX(0.867), which is -7.96 dBFS for its 0.4 sine, while the left bar climbed with its ramp; at +12 dB the clip indicator latched and a click reset it; during playback only the meter, clock, playhead and Play's pressed state changed; layout shift 0. The output and input meters sit side by side without labels (seen in the screenshot); "IN" and "OUT" labels are the next small fix. Loudness is not metered live yet.

---

## v0.18.0 · marquee selection, zoom anchor, meter labels

### src/ui/lanes.ts · marquee selection
- refers-to: src/ui/lanes.ts :: `marquee`, `box`, `updateMarquee`, `endMarquee`, `swallowClick`, pointer handlers
- kind: warning-context
- logged: v0.18.0 · 2026-09-28

A press on empty lane space starts a marquee; once the pointer has moved 4 px, one overlay created at mount is shown and moved by `transform` and its own size, and every clip whose box it touches is selected, live. Shift keeps the existing selection as the base. A marquee press prevents the browser's text selection; the click that follows a marquee release is swallowed so it cannot also move the playhead, and a plain click still seeks and clears. Four defects were caught before release, each by the harness or the screenshot. First, a local `box` in the pointer-down handler shadowed the marquee state; `tsc` failed, while the dev server, which does not type-check, threw at runtime, so the local is now `rect`. Second, capturing the pointer on every empty-space press retargeted the following `click` to the lanes element, where the seek handler found no lane body and did not seek; the pointer is now captured only once a marquee moves. Third, the swallow flag could outlive a release that produced no click and eat the next real one; it now clears once the event sequence finishes. Fourth, the screenshot showed lane-head text highlighted by the drag; the press now prevents default. Verified: a marquee across two lanes selected both clips during and after the drag without moving the playhead; an empty marquee cleared the selection; a Shift-marquee added a clip; no text was selected; a plain empty-space click still sought to 240,000 and cleared; only the overlay and `aria-selected` changed.

### src/ui/lanes.ts · zoom keeps the playhead in place
- refers-to: src/ui/lanes.ts :: `lastSpp`, the `onZoom` listener, `render`
- kind: explainer
- logged: v0.18.0 · 2026-09-28

`render` records the samples per pixel it drew with; on a zoom the playhead's on-screen offset is taken with the old value, and after the new render the stage's scroll is set so the playhead sits at the same offset (scrolling is not a layout shift). Verified: with the playhead at 500 px, zooming in 2x scrolled the stage to 500 and the playhead stayed at x = 692.

### src/ui/meter.ts and record.ts · IN and OUT labels
- refers-to: src/ui/meter.ts :: `mountOutputMeter`; src/ui/record.ts :: meter mount; src/styles/shell.css :: `.fw-meter-label`, `.fw-out-meter`
- kind: explainer
- logged: v0.18.0 · 2026-09-28

The output meter has an OUT label as its first grid column and the input meter an IN label before it, both in the muted mono token. Verified: both inside the transport bar (OUT at 406 px, IN at 563 px). The two-file harnesses report a layout shift of 0.0072 whose single source is the harness's scripted `move-clip` of a clip (no user input), not the app; single-file harnesses report 0.

---

## v0.19.0 · Shuffle mode

### src/ui/grid.ts and lanes.ts · gap-closing delete, rippling trims
- refers-to: src/ui/grid.ts :: `shuffleEnabled`, `mountGrid`; src/ui/lanes.ts :: `Gesture.ripple`, `Gesture.followers`, pointer-down, `preview`, `restore`, `commit`, keydown Delete
- kind: rationale
- logged: v0.19.0 · 2026-09-28

Shuffle mode (a button beside Grid, or H) makes edits keep a track's clips closed up. Delete removes the selection and moves each remaining clip left by the lengths of the removed clips before it on the same track, all in one `batch`. A trim ripples: trimming a clip's end moves every later clip on the track by the same amount; trimming its start keeps the clip where it is, advances the source and moves the later clips by the opposite amount. The followers are gathered at pointer-down and previewed by `transform`, so the drag shows exactly where the commit will put them; the bounds and every move go in one `batch`, one undo step. Moving a clip in Shuffle mode is still a slip move; reordering clips by dragging is not built yet, and neither is rippling across tracks. Verified on a 10 s sine split into three contiguous clips, each render compared with the source's surviving pieces joined end to end: deleting the middle clip gave 0.0 over 336,000 frames with the last clip at 96,000; trimming the first clip's end by 50 px previewed the later two at -50 px during the drag and rendered 0.0 over 456,000 frames; trimming the middle clip's start by 50 px kept it in place, previewed the last at -50 px and rendered 0.0; each was one undo step and undo restored the layout; with Shuffle off, Delete kept the gap; layout shift 0.

---

## v0.19.1 · gain label placement

### src/styles/shell.css · the gain label at the clip's start
- refers-to: src/styles/shell.css :: `.fw-gain-line::after`
- kind: explainer
- logged: v0.19.1 · 2026-09-28

The dB label was anchored to the gain line's right end, so a clip running past the window's right edge had its label cut off (recorded in v0.16.0). It now sits 12 px inside the line's start, clear of the fade-in handle in the top corner. Verified: with a short and a long clip selected, both labels started at x = 213 and x = 313 in a 1,280 px window, the long clip's line running on to x = 1,283; the screenshot showed both fully.

---

## v0.20.0 · clipboard, selection-wide fades and gain

### src/engine/document.ts and src/ui/lanes.ts · cut, copy, paste
- refers-to: src/engine/document.ts :: `paste-clip`; src/ui/lanes.ts :: `clipboard`, `selectedClips`, `removalCommands`, `paste`, keydown
- kind: rationale
- logged: v0.20.0 · 2026-09-28

Cmd or Ctrl C copies the selected clips, keeping their tracks and their offsets from the earliest; X copies and removes them through the same removal commands as Delete, so in Shuffle mode a cut closes the gap. V pastes at the playhead onto the same tracks with `paste-clip`, which keeps gain, fades and fade shape and lets the engine give each copy a new id; the copies become the selection by comparing ids before and after. In Shuffle mode, paste first moves every clip at or after the playhead on the target tracks right by the pasted span. Each is one `batch`, one undo step. Paste skips clips whose track has since been removed. Verified on a 10 s sine split in three: pasting the first clip at 10 s rendered the source followed by that clip, 0.0 over 576,000 frames, in one step with the copy selected; cutting the middle clip in Shuffle mode rendered 0.0 against the remaining pieces joined; pasting it back at 96,000 in Shuffle mode restored the original, 0.0 over 480,000 frames.

### src/ui/lanes.ts · fades and gain across the selection
- refers-to: src/ui/lanes.ts :: pointer-down group, `shiftGain`, `preview`, `restore`, `commit`
- kind: rationale
- logged: v0.20.0 · 2026-09-28

Dragging a fade handle or the gain line of a selected clip applies the same change to every selected clip. For fades the limits are the tightest across the group, so no clip's fades can cross; for gain the grabbed clip's dB change is added to each clip's own gain, clamped to the line's range. Every member's handle or line is previewed, and the commit is one `batch`. Verified with the first and last of three clips selected: a 50 px fade-in drag gave both 24,000 in one step and both rendered the k / 24,000 ramp within 2.7e-8 with the middle clip untouched (0.0); a 22 px gain drag gave both -12.4 dB in one step, both within 5.2e-9 of the source times the gain, the middle clip untouched.

---

## v0.21.0 · fade curves

### src/engine/document.ts, src/audio/player.ts, src/ui/lanes.ts · four curves, click to cycle
- refers-to: src/engine/document.ts :: `FADE_SHAPES`, `FadeShape`, `nextFadeShape`, `fadeCurve`; src/audio/player.ts :: clip plan; src/ui/lanes.ts :: `endDrag`, `paint`, `clipNode`
- kind: rationale
- logged: v0.21.0 · 2026-09-28

`FADE_SHAPES` is the one table of fade names and the core's codes; the `FadeShape` type is derived from it and the player maps through it, so a new shape cannot be half-wired. Clicking a fade handle without dragging cycles linear, equal-power, S-curve, exponential, as one `set-clip-fades` batch across the selected group; the handles' tooltips say so. `paint` draws the envelope with `fadeCurve`, the same formulas the core applies. Verified: each click was one undo step, four clicks returned to linear and undo stepped back to exponential; for each shape the browser's render matched the engine's (0.0 for linear and exponential, within 3e-8 for the sine and cosine curves) and the formula within 8.3e-8; the screenshot showed the four curves distinct.

### src/styles/shell.css · the gain label no longer covers fade handles, defect fixed
- refers-to: src/styles/shell.css :: `.fw-gain-line::after`
- kind: warning-context
- logged: v0.21.0 · 2026-09-28

Moving the gain label to the clip's start in v0.19.1 put it over a fade handle placed roughly 20 to 70 px in; because a pseudo-element's box belongs to its element for hit-testing and the gain line comes later in the clip, a press there started a gain gesture instead. The first harness run showed clicks on the handle doing nothing; a probe found `.fw-gain-line` under the click point. The label now has `pointer-events: none`; the line keeps its own 8 px band.

---

## v0.22.0 · per-track meters

### src/audio/player-worklet.ts, player.ts, src/ui/meter.ts, lanes.ts · track peaks to the lane heads
- refers-to: src/audio/player-worklet.ts :: `report`, `MAX_METERED_TRACKS`; src/audio/player.ts :: clip plan `track`, `onOutputLevel`; src/ui/meter.ts :: `mountTrackMeters`; src/ui/lanes.ts :: lane markup; src/styles/shell.css :: `.fw-lane-meter`
- kind: warning-context
- logged: v0.22.0 · 2026-09-28

The player numbers each clip's track by the document's track order; each worklet report takes the per-track peaks after the master pair from one buffer (up to 256 tracks) and the player passes them to level listeners beside the master peaks. Each lane head is created with a two-bar meter; `mountTrackMeters` drives it on the master meter's scale and 20 dB/s fall-back, writing a bar only when its value changes, and empties every lane on stop. Defect fixed before release: the lane meter reused `.fw-out-track`, whose `grid-column: 2` (from the transport meter's label column) made an empty implicit first column in the lane meter's grid, so each bar was 48 px wide starting at x = 60; the screenshot showed it, a measurement confirmed it, and the lane meter is now a flex column. Verified with two tracks: the 0.5 sine's lane held scaleX(0.9) (-6.02 dBFS) on both bars, the stereo file's right bar held 0.867 while its left climbed with its ramp, every lane emptied on stop, bars start at x = 12 beside the track name at 86 and 83 px wide, only meter bars, clock, playhead and Play's pressed state changed during playback, layout shift 0; master meter, playback null (0.0) and browser-versus-engine (0.0) regressions unchanged.

---

## v0.23.0 · Shuffle reordering and Spot mode

### src/ui/lanes.ts · Shuffle reorder
- refers-to: src/ui/lanes.ts :: `shuffleLayout`, `Gesture.reorder`, pointer-down, `preview`, `commit`
- kind: rationale
- logged: v0.23.0 · 2026-09-28

In Shuffle mode, dragging one clip reorders it by the same rule as Shuffle cut and paste: the clip is lifted out (clips after it close its gap), then inserted at the clip boundary nearest to where it is dropped (clips at or after that boundary move right by its length). Gaps between the other clips are kept. `shuffleLayout` computes every clip's new start; the preview places every clip on the track there by `transform`, so the drag shows the result, and the commit sends only the changed starts as one `batch`. Dropping near the original place changes nothing and records nothing. Moving several selected clips in Shuffle mode is still a slip move. Verified on a 10 s sine split in three: dragging the first clip to the end previewed it at +800 px and the others at -200 px mid-drag, committed in one step, and rendered 0.0 against the pieces in the new order; moving the last clip to the front rendered 0.0; a 10 px nudge recorded nothing.

### src/ui/grid.ts and lanes.ts · Spot mode
- refers-to: src/ui/grid.ts :: `spotEnabled`, `mountGrid`; src/ui/lanes.ts :: `spot`, `openSpot`, `closeSpot`, `parseTime`, `formatTime`, pointer-down
- kind: warning-context
- logged: v0.23.0 · 2026-09-28

Spot mode (a button beside Grid and Shuffle, or T) turns a press on a clip body into a small field over the clip, prefilled with its start as m:ss.mmm and selected. Enter moves the clip to the typed time (seconds or m:ss.mmm, converted to the nearest sample) as one undo step; invalid text is flagged and changes nothing; Escape or leaving the field closes it. Keys typed into the field never reach the global shortcuts. Defect fixed before release: closing the field hid it but left it focused, so every global shortcut, which ignores keys aimed at an input, went dead until the next click; closing now releases focus. Verified: 7.5 moved a clip to exactly 360,000 in one step; 1:00.5 gave 2,904,000; "2t" was flagged, changed nothing, and its "t" did not toggle Spot mode; after Escape the field held no focus and Space started playback; the screenshot showed the field on the clip with its time selected.

---

## src/ui/normalize.ts and group trims (v0.24.0) {#src-ui-normalize}

### src/ui/normalize.ts · Loudness sits in the footer
- refers-to: src/ui/normalize.ts :: the button's place, `open`
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The Loudness button moved from beside Export to the footer, after the LUFS readout it acts on; its dialog opens above the button when the window has no room below it, and stays inside the window's width.

### src/ui/normalize.ts · loudness normalization
- refers-to: src/ui/normalize.ts :: `mountNormalize`; src/io/render-client.ts :: `renderMix`; src/main.ts :: mount
- kind: warning-context
- logged: v0.24.0 · 2026-09-28

A Loudness button after Export opens a popover (created once, fixed, placed by `transform`, on the registered menu layer) with a target of -14, -16 or -23 LUFS. Apply measures the integrated loudness (BS.1770, the engine's meter) of the selected clips, or of every clip when none are selected, as they play in the session, by rendering a copy of the session holding only those clips; it then changes each chosen clip's gain by the difference in one `batch`. Integrated loudness moves one-for-one with gain, so the result lands on the target within the 0.1 dB step that clip gain is stored in; clips that would pass +12 dB stop there and the status says so; silence and an unreachable engine are reported, not guessed. Two defects were fixed before release: the stylesheet named `--z-popover`, which is not in the registry, and would have computed to `auto` (now `--z-menu`, as the Open menu uses); and Escape did not close the popover once Apply's disabled state had dropped focus to the page (Escape is now handled at the document while the popover is open). The button is text-only while its neighbours carry icons; cosmetic. Verified: one selected clip from -6.7 to -23 LUFS measured -23.0 afterwards with the other clip untouched, one undo step, undo restored; every clip from -5.85 to -16 LUFS measured -15.95 (the stored -10.15 dB rounded to -10.1); Escape and an outside click close the popover; layout shift 0.

### src/ui/lanes.ts · group trims
- refers-to: src/ui/lanes.ts :: pointer-down group, `preview`, `restore`, `commit`
- kind: explainer
- logged: v0.24.0 · 2026-09-28

Outside Shuffle mode, dragging either edge of a selected clip trims every selected clip by the same amount, with the tightest limits across the group, every member previewed, and one `batch` of bounds; in Shuffle mode a trim still ripples its own track only. The commit function's unused locals were removed. Verified on a 10 s sine split in three: trimming the starts of the first two by 50 px moved both starts and sources by 24,000 in one step and rendered 0.0 against the expected silence-and-source layout; trimming the ends of the first and last by 50 px did the same, the middle clip untouched. The first run of the second case trimmed all three clips because the selection from the first case was still active; that was correct behaviour and the harness now clears the selection first.

---

## src/ui/arm.ts and recording into a track (v0.25.0) {#src-ui-arm}

### src/ui/arm.ts, lanes.ts, record.ts, meter.ts, src/engine/document.ts · track arming
- refers-to: src/ui/arm.ts :: `armedTrack`, `setArmedTrack`, `onArm`, `recordingTrack`, `setRecordingTrack`; src/ui/lanes.ts :: lane markup, `updateLane`, arm click; src/ui/record.ts :: `showLevel`, `begin`, `finish`; src/ui/meter.ts :: `mountTrackMeters`; src/engine/document.ts :: `import-media` `trackId`
- kind: rationale
- logged: v0.25.0 · 2026-09-28

Each lane head has a record-arm button; one track can be armed at a time, and arming is interface state like the selection, so it never enters undo history or the saved session. Recording starts into the armed track if it still exists (the notice names it); while it runs, the input level that drives the transport IN meter also drives that track's header meter, and the playback meter leaves that track alone so the two never write the same bars. On stop the take is imported with `import-media` naming the track, which adds the take as a clip on it at the recording's start instead of creating a track; with nothing armed recording makes a new track as before. The recording track is cleared on every path, saved, empty or failed. Verified with Chromium's fake microphone fed a continuous 440 Hz file: arming one track then another left exactly one armed and clicking again disarmed, with no undo steps; recording from 5 s showed scaleX(0.9) on the armed track's header, equal to the IN meter (the 0.5-peak tone), and 0 on the other track, whose clip had ended; the take landed on the armed track at exactly 240,000 in one undo step and undo removed it; the header meter reset after stop; unarmed recording made a new track; layout shift 0. The first run used the default fake microphone, which beeps once a second, and read 0 between beeps on both the IN meter and the header; the harness now uses the same capture file as the v0.5.0 recording harness. The unarmed button is faint against the header; cosmetic.

---

## v0.26.0 · punch-in

### src/ui/ruler.ts · drag to set the loop range
- refers-to: src/ui/ruler.ts :: `pending`, pointer handlers, `draw`
- kind: explainer
- logged: v0.26.0 · 2026-09-28

Dragging across the ruler by more than 4 px sets the loop range (snapped to the grid in Grid mode); the band follows the drag on the canvas and the range is committed on release as one `set-loop`, keeping whether looping is on. A plain click still seeks, now on release. Before this the range could only be the whole session. Verified: a drag from 100 to 200 px at 100 px per second set 48,000 to 96,000 in one undo step; a click seeked to 24,000 and left the range alone; `pending` is declared before the ruler's first draw, and the page logged no errors.

### src/ui/record.ts and grid.ts · punch-in on the armed track
- refers-to: src/ui/record.ts :: `punchRange`, `punchCommands`, `begin`, `finish`, the punch auto-stop subscription; src/ui/grid.ts :: `punchEnabled`, `mountGrid`
- kind: rationale
- logged: v0.26.0 · 2026-09-28

With Punch on (button or P), a track armed and a loop range ahead of the playhead, recording is a punch: the take is captured from the playhead as usual, but only the part inside the range is kept; the armed track's clips are cut at the in and out points (the part before keeps its fade-in and loses its fade-out, the part after is re-created at the right source offset, anything inside is removed) and the take goes in between, all in one `batch`. Recording stops by itself at the out point, or if looping wraps the playhead back. Without an armed track, Punch records normally and the notice says a track must be armed. Recording latency is not compensated yet (the latency spike is still pending), so a punched take can sit a device latency late on real hardware; the harness's fake microphone has none. Verified with the fake microphone fed a continuous 440 Hz file, punching 1 to 2 s into the 3 s stereo file: the notice announced the punch, recording stopped by itself, the track became the original 0 to 1 s, the take at 48,000 for 48,000 samples and the original from 96,000 at source offset 96,000; the render equalled the original exactly before and after the range with the 0.5-peak take inside; one undo step, undo restored the single clip; Punch without an armed track recorded a new track with the explanation; layout shift 0.

---

## v0.27.0 · live loudness

### src/audio/player-worklet.ts, player.ts, src/ui/meter.ts · M, S and I in the transport bar
- refers-to: src/audio/player-worklet.ts :: `report`, `play`, the end-of-material branch, `sampleRate`; src/audio/player.ts :: `onOutputLevel`, `emitLevel`, `onReply`, `lastIntegrated`; src/ui/meter.ts :: `mountOutputMeter`; src/styles/shell.css :: `.fw-lufs`
- kind: warning-context
- logged: v0.27.0 · 2026-09-28

Every play resets the core's live meter at the context's rate; every report carries momentary, short-term and integrated loudness beside the peaks; a fixed-width readout after the OUT meter shows them, written at most five times a second and only on change, "--" until 400 ms (M) or 3 s (S) have been measured, M and S blanked when playback stops and I kept. Defect fixed before release: at the natural end of playback the worklet sent only `ended`, which the player turned into a stopped transport without any level update, so the readout kept its last throttled value (I read -8.6 against the engine's -8.24) and the peak bars froze on their last values (a latent fault since v0.17.0, whose harnesses stop with Space). The worklet now reports once more before `ended`, and on `ended` the player publishes silent peaks and the final integrated value, which the readout writes at once. The build also needed a `declare` for the worklet's `sampleRate` global, which the dev server had not type-checked. Verified: over the 3 s stereo file the readout ended at I -8.2 with M and S blanked, 0.04 from the engine's offline -8.24; every bar read 0 after the natural end; the readout kept its 224 px width and was written 13 times in 3 s; no page errors; layout shift 0; playback null, natural end, master meter and track meter regressions unchanged.

---

## v0.28.0 · loop recording with alternate takes

### src/engine/document.ts, src/ui/record.ts, src/ui/lanes.ts · takes as source offsets
- refers-to: src/engine/document.ts :: `Clip.takes`, `Clip.take`, `set-clip-take`, `import-media` `clip`; src/ui/record.ts :: `loopRange`, `begin`, `finish`; src/ui/lanes.ts :: `clipNode`, `updateClip`, take badge click, pointer-down; src/styles/shell.css :: `.fw-take`
- kind: rationale
- logged: v0.28.0 · 2026-09-28

With looping on and Punch off, recording from before or inside a loop range keeps capturing as the playhead wraps. On stop the whole capture is imported once, and every complete pass through the range becomes a take: from before the range pass k starts at (loop start minus recording start) plus k loop lengths; from inside it the partial first pass is skipped. Because all takes cover the same range, a take is just a source offset into the same media, so the clip on the loop range carries `takes` (offsets) and `take` (the one that plays), and switching takes changes only its `sourceIn`: the core, the player and the engine are unchanged. On an armed track the range is replaced the same way as a punch. With no complete pass the recording is kept whole, as before. A badge on the clip ("Take 2/3") plays the next take as one undo step; presses on it never start a drag. Comping between takes needs take lanes and is the next step. Verified with the fake microphone fed the 3 s stereo ramp (a steady sine would make every one-second pass identical): looping 1 to 2 s on an armed 10 s tone and recording from 0 for about 3.8 s gave one undo step, the original 0 to 1 s, a clip at 48,000 with takes [48,000, 96,000] and the second playing, and the original from 2 s; the render inside the range equalled the take media at the active offset exactly and the tone outside was untouched; the badge read Take 2/2, switched to Take 1/2 in one undo step with the render then equal to the media at 48,000 exactly, and undo returned to take 2; no page errors; layout shift 0; punch, arming, edit and clipboard regressions unchanged.

---

## v0.29.0 · takes through edits, comping

### src/engine/document.ts, src/ui/lanes.ts · take offsets follow the source offset
- refers-to: src/engine/document.ts :: `split-clip`, `set-clip-bounds`; src/ui/lanes.ts :: `paste`; src/styles/shell.css :: `.fw-take`, `.fw-gain-line::after`
- kind: warning-context
- logged: v0.29.0 · 2026-09-28

A take clip keeps `sourceIn === takes[take]`, every offset pointing at the same moment of its pass. v0.28.0 broke that under two edits, found by reading the reducers before building comping: `split-clip` gave the right piece a shifted `sourceIn` but copied `takes` unchanged, and `set-clip-bounds` shifted `sourceIn` on a start trim without the takes, so switching takes on such a piece jumped to the wrong place in the capture; and clipboard paste dropped a clip's takes. Now split and trim shift every take offset by the same amount as `sourceIn`, a trim that would put any take outside its media is refused (no change, no undo step), and paste keeps the takes and the active take. That makes comping work with existing tools: split the take clip where the take should change, then choose each piece's take with its badge. A view of all takes as lanes is not built yet. Badges and gain labels no longer wrap onto two lines on narrow pieces (seen in the screenshot). Verified with two loop-recorded takes over 1 to 2 s: a split at 1.5 s gave the right piece takes [72,000, 120,000]; switching the left piece to take 1 rendered media[48,000:72,000] then media[120,000:144,000] exactly, the tone outside untouched, in one undo step; a 10 px start trim of the right piece shifted its takes to [76,800, 124,800] and switching then played the media at 76,800 exactly; extending the right piece past take 2's media was refused with no undo step; a paste kept its takes; every badge measured 16 px (one line); no page errors; layout shift 0; loop take, edit, clipboard, group trim and punch regressions unchanged.

---

## v0.30.0 · take lanes

### src/engine/document.ts, src/ui/lanes.ts, shell.css · every take as a lane, comp by drag
- refers-to: src/engine/document.ts :: `comp-range`; src/ui/lanes.ts :: lane markup, `updateLane`, `updateTakeSegment`, `expandedTracks`, Takes toggle, `takeDrag`, `takeRange`, `startTakeDrag`, `endTakeDrag`, pointer-down; src/styles/shell.css :: `.fw-lanes`, `.fw-lane`, `.fw-take-rows`, `.fw-take-row`, `.fw-takes-toggle`
- kind: warning-context
- logged: v0.30.0 · 2026-09-28

A track with loop-recorded takes shows a Takes toggle; expanded (interface state, like the selection) it adds one row per take under its main row, in the lane grid's body column. Each take segment is the clip drawn by the existing `clipNode` and `updateClip` from that take's offset, without fades or gain and with a synthetic id so it never shows as selected, marked `aria-current` where that take plays; rows and segments are patched by key, written only on change. Dragging across a take segment previews the range with the marquee overlay and commits `comp-range`, which splits the piece at the range edges (each piece's take offsets shifted to its start) and gives the middle the dragged take, one undo step; a click without dragging chooses that take for the whole piece; Grid snaps the range. Presses in the take rows never start clip gestures or the marquee. Two layout defects were found by the harness before release: lanes were fixed at 96 px by the container's `grid-auto-rows`, so expanded rows overflowed (a second track's lane would have been drawn over); lanes may now grow, with the first row pinned so the head, main clips and meters are unchanged; and pinning the row at 96 px made every lane 97 px because the lane's bottom border now added to it, so the row is 96 px less 1 px. The head column beside the take rows has no row labels yet, and a very narrow piece's badge is clipped; cosmetic. Verified with two loop-recorded takes over 1 to 2 s: the toggle showed two rows with the playing take marked, segments aligned with the main clip at x = 292; the lane grew from 96 to 193 px, its rows ending above a second track's lane, and collapsing restored 96; dragging 1.25 to 1.75 s across take 1 gave, in one step, take 2 then take 1 from 60,000 to 84,000 then take 2, each part of the render equal to its take's media exactly and the tone outside exact, the rows' marks following; clicking the middle piece in the take 2 row switched it exactly; undo walked back; no page errors; layout shift 0; timeline, marquee, track meter and selection regressions unchanged.

---

## v0.31.0 · automation

### src/engine/document.ts, src/audio/player.ts, player-worklet.ts · volume and pan automation
- refers-to: src/engine/document.ts :: `AutoPoint`, `Track.automation`, `set-automation`; src/audio/player.ts :: `planClips`; src/audio/player-worklet.ts :: `WorkletClip.gainPoints`, `WorkletClip.panPoints`, the clips handler
- kind: rationale
- logged: v0.31.0 · 2026-09-28

A track may carry volume automation (dB) and pan automation (-1 to 1) as time-sorted points, set a parameter at a time by `set-automation` (rounded times, clamped values, one point per time, an empty list removing it; one undo step). When present, each replaces the track's static fader or pan; clip gain still applies. The player gives each of the track's clips the flattened points, and the worklet loads them as core envelopes as it loads the clips, copying each into core memory and freeing it straight after, so repeated edits do not leak. Verified: browser and engine renders identical with volume automation (0.0) and within 3e-8 with pan automation.

### src/ui/lanes.ts · the volume automation lane
- refers-to: src/ui/lanes.ts :: `autoTracks`, `drawVolumeLane`, `updateLane`, Auto toggle, `autoPointAt`, `startAuto`, `previewAuto`, `endAuto`, pointer-down; src/styles/shell.css :: `.fw-auto-rows`, `.fw-auto-row`, `.fw-auto-svg`, `.fw-auto-line`, `.fw-auto-toggle`
- kind: warning-context
- logged: v0.31.0 · 2026-09-28

The Auto toggle in each lane head shows a volume automation lane under the track, in the same growable lane row as take lanes: an SVG line through the points (held before the first and after the last) with a circle per point, written only on change; with no automation a dashed line shows the static fader level. A click on the lane adds a point and a drag moves it (kept between its neighbours, snapped to the grid), Alt-click deletes one; each gesture is one `set-automation`. Pan automation plays but has no lane yet. Defect fixed before release: the pointer was mapped against the lane container, whose 1 px top border the drawing does not include, so a point landed about 0.7 dB from the cursor (-0.7 instead of 0); it is now mapped against the drawn row. Verified with the 10 s tone at 100 px per second: clicks added (48,000, 0 dB) and (144,000, -12 dB), one step each; a drag moved the second to (168,000, -24 dB) in one step; the browser's render equalled the engine's exactly and the gain equalled f32 interpolation exactly at 355 probes; Alt-click deleted a point; undo walked back to no automation; the lane added 49 px and collapsing restored 96; no page errors; layout shift 0; take lane and browser-versus-engine regressions unchanged.

---

## v0.32.0 · pan automation lane

### src/ui/lanes.ts, shell.css · Volume and Pan rows
- refers-to: src/ui/lanes.ts :: `AutoParam`, `autoFraction`, `autoValue`, `drawAutoLane`, `updateLane`, `autoPointAt`, `startAuto`, `previewAuto`, `endAuto`, lane markup; src/styles/shell.css :: `.fw-auto-row`, `.fw-auto-heads`
- kind: warning-context
- logged: v0.32.0 · 2026-09-28

The Auto panel now holds a Volume row and a Pan row. Drawing and gestures are one implementation keyed by parameter: `autoFraction` and `autoValue` are the only mappings (volume +12 to -36 dB down the row; pan left at the top, centre in the middle, right at the bottom), so drawing and pointer input cannot disagree; each row's press finds its own row and parameter and commits one `set-automation`. With no pan automation a dashed line shows the track's static pan. The labels live in the lane grid's header column beside the rows, sticky on the left like the track head: the first version put them at each row's right end, which is the timeline's right end and off-screen on any session wider than the window (seen in the screenshot). While moving them, an edit dropped the take-rows container from the lane markup; it was restored before any build, and the take-lane harness passed afterwards. A point at an extreme value (hard pan, +12 or -36 dB) is drawn half-clipped by its row's edge; insetting it changes the coordinates the exact-value harnesses use, so it is left for a pass of its own. Verified with the 10 s tone at 100 px per second: clicks at the pan row's top and bottom edges added (48,000, -1) and (144,000, +1), one step each; a drag to mid-height gave (168,000, 0) in one step; the browser's render equalled the engine's (0.0 left, 3e-8 right), the right channel was exactly silent while hard left and the channels exactly equal while centred; Alt-click deleted and undo walked back; the volume row stayed untouched; the labels sat at x = 12 in the header column, each centred on its row; no page errors; layout shift 0; volume lane and take lane regressions unchanged.

---

## src/ui/mixer.ts and the mute and solo commands (v0.33.0) {#src-ui-mixer}

### src/engine/document.ts · mute, solo and bus mute
- refers-to: src/engine/document.ts :: `set-track-mute`, `set-track-solo`, `set-bus-mute`
- kind: rationale
- logged: v0.33.0 · 2026-09-28

Tracks had `mute` and `solo` fields and buses a `mute` field, all honoured by the player and the engine since v0.11.0, but no command could set them; found while building the mixer. Three undoable commands now do, each a no-op when nothing changes.

### src/ui/mixer.ts, meter.ts, main.ts, shell.css · the mixer
- refers-to: src/ui/mixer.ts :: `mountMixer`, `stripNode`, `updateStrip`; src/ui/meter.ts :: `mountTrackMeters`; src/styles/shell.css :: `.fw-mixer`, `.fw-strip`, `.fw-strip-fader`
- kind: warning-context
- logged: v0.33.0 · 2026-09-28

A Mixer button in the transport bar (or X) shows a panel docked over the bottom of the timeline, fixed, so the lanes never reflow. It holds a strip per track (name, stereo meter, vertical fader with a dB readout, pan, mute, solo, output to Master or a bus) and per bus (fader, pan, mute), patched by key and written only on change. A fader or pan drag updates the readout live and commits one command on release; controls that automation drives are disabled and say so. The track meter driver also feeds the strips' bars, so a strip and its lane show the same level. Found and fixed before release: the strips' single grid column sized itself to the range inputs' natural width, so their contents spilled into neighbouring strips (the column is now the strip's width); and in `writing-mode: vertical-lr` a range input's block size is its width, so the fader's intended height made it 128 px wide (its length is now set with `inline-size`, 16 by 128 px). Known gaps: buses are not metered yet, so bus strips hide their meter rather than show a meter that always reads silence; there is no master fader, and no sends or inserts; a focused mixer button handles Space itself (the browser's accessible default) rather than starting playback. Verified with two tracks and a bus: three strips in order, the bus without solo or output, the panel's bottom at the transport's top; a real fader drag was one undo step with the track's gain equal to the fader's value; pan landed exactly; muting, soloing the other track, and routing to a muted bus each left the mix exactly silent where only that track played, the browser's render equal to the engine's; automation disabled the fader and read "auto"; during playback a strip's meter equalled its lane's (0.758 and 0.867); no strip child overflowed its strip; no page errors; layout shift 0; the track meter regression unchanged. The harness first pressed Space with a Mute button still focused, so playback never started and every meter read 0; it now clears focus first.

---

## v0.34.0 · master fader

### src/engine/document.ts, src/audio/player.ts, player-worklet.ts, src/ui/mixer.ts · Master strip
- refers-to: src/engine/document.ts :: `SessionDoc.masterGainDb`, `set-master-gain`; src/audio/player.ts :: `ClipPlan.masterDb`, `planClips`, both clips sends; src/audio/player-worklet.ts :: clips message, handler; src/ui/mixer.ts :: master strip, master meter listener; src/main.ts :: `mountMixer` now takes the player
- kind: warning-context
- logged: v0.34.0 · 2026-09-28

The session carries an optional master fader (`masterGainDb`, absent meaning 0 dB), set by `set-master-gain` (clamped, tenths of a dB, one undo step). The plan carries it, both the live and the bounce sends pass it, and the worklet hands it to the core. The mixer ends with a Master strip holding only a fader, its readout and a meter driven by the output peaks on the same scale and fall-back as the other meters. The first build failed `tsc` because `masterDb` was added to the plan's returned object but not to the `ClipPlan` type (the dev server does not type-check, so the harness ran regardless); the type and the player's initial empty plan now carry it. Bus metering, planned beside the master fader, was split into its own release. Verified: the Master strip came last with pan, mute, solo and output hidden; a -6 dB move was one undo step; the bounce equalled the engine's render exactly and equalled the unity bounce times f32(10^(-6/20)) exactly; during playback the Master strip's meter equalled the OUT meter (0.8, the 0.5 tone at -12 dBFS); undo restored 0 dB; no page errors; layout shift 0; mixer and render-parity regressions unchanged.

---

## v0.35.0 · bus metering

### src/audio/player-worklet.ts, player.ts, src/ui/mixer.ts, shell.css · bus meters on the strips
- refers-to: src/audio/player-worklet.ts :: `MAX_METERED_BUSES`, peaks buffer, `report`, `busPeaks`; src/audio/player.ts :: `onOutputLevel`, `emitLevel`; src/ui/mixer.ts :: meter driver; src/styles/shell.css :: `.fw-strip[data-kind="bus"]`
- kind: warning-context
- logged: v0.35.0 · 2026-09-28

Position replies now carry per-bus peak pairs, taken into the same buffer after the loudness values (up to 64 buses). Level listeners receive them as an optional last argument that defaults to empty, so every stop, end and not-playing path publishes silent bus levels unchanged. The mixer drives the Master and bus strips from one function with the other meters' scale and fall-back, and bus strips show their meter again (v0.33.0 hid it while it could not work). Ordering hazard, checked before wiring: the core reports buses in plan order, and the plan leaves muted buses out, so matching peaks to strips by document index would show a later bus's level on the wrong strip whenever an earlier bus is muted; the mixer walks the document's buses, advancing only past unmuted ones, and a muted bus reads silent. Verified with two tracks each routed to its own bus: bus meters visible; during playback each bus strip equalled its track's lane meter (0.9 and 0.9; 0.753 and 0.867); with the first bus muted it read silent and the second still showed its own track's level (0.756 and 0.867); no page errors; layout shift 0; mixer, master, buses (browser equal to engine), track meter and output meter regressions unchanged.

---

## v0.36.0 · cosmetic polish

### src/ui/lanes.ts, normalize.ts, shell.css · the four recorded cosmetic debts
- refers-to: src/ui/lanes.ts :: `AUTO_INSET`, `drawAutoLane`, `autoPointAt`, lane markup, `updateLane` (take labels); src/ui/normalize.ts :: Loudness button; src/styles/shell.css :: `.fw-arm`, `.fw-take-heads`, `.fw-auto-heads`
- kind: explainer
- logged: v0.36.0 · 2026-09-28

Automation rows now keep a 5 px inset (the point radius plus stroke) above the top value and below the bottom one, applied identically in the drawing and in the pointer mapping, so points at extreme values sit fully inside their row and still land exactly under the cursor; presses beyond the inset clamp to the extreme. The volume harness's click positions were moved onto the inset scale, its expected values unchanged. Take lanes have Take 1 to N labels in the header column, sharing the automation labels' styling, in the row below the automation rows when both are open. The Loudness button carries the waveform icon and a label span, like Export. The unarmed arm button's border uses the secondary text colour on the primary background, so it is visible without looking armed, and previews red on hover. Verified: pan points at hard left and right drew at y 5 and 43, each fully inside the 48 px row with its stroke, still exactly -1 and +1, the right channel exactly silent while hard left; volume points still exactly 0, -12 and -24 dB with the render exact against the engine and f32 interpolation; Take 1 to 3 labels centred on their rows with and without the automation rows open, and the automation labels centred beside take lanes; the Loudness button showed its icon and label (screenshot); the arm button's border matched --text-secondary and turned to the danger colour on hover; no page errors; layout shift 0; loudness normalization, arming and take lane regressions unchanged.

---

## v0.37.0 · Smart Tool

### src/engine/document.ts, src/ui/lanes.ts, shell.css · range selection in a clip's upper half
- refers-to: src/engine/document.ts :: `clear-range`; src/ui/lanes.ts :: `GestureKind` (`range`), `limits`, zone detection, `range`, `rangeDrag`, `startRange`, `drawRange`, `clearRange`, hover zones, `fw-lanes-rendered`, the keyboard handler; src/styles/shell.css :: `.fw-range`, `.fw-clip[data-zone]`
- kind: warning-context
- logged: v0.37.0 · 2026-09-28

The pointer now works as a Smart Tool: on a clip, the edges trim, the top corners set fades, the upper half of the body selects a time range and the lower half moves the clip; hovering shows an I-beam or a grab cursor by zone. A plain click anywhere on the body still selects the clip, and Spot and Shift-click treat both halves alike, so only a drag in the upper half changes meaning. The range is interface state on one track, grid-snapped, drawn as a band that follows zoom through a `fw-lanes-rendered` event fired after each render, and dropped by any press, by Escape, or when it would be empty. With a range, Delete runs `clear-range` (clips straddling it keep their outer parts, with source and take offsets and fades adjusted as `split-clip` does; in Shuffle the rest of the track closes the gap), and S splits at the range's end and then its start in one batch, as a split keeps the left piece's id. The clip gain line keeps priority in the upper half, and it shows no zone cursor. Found while verifying: the harness's first upper-half press landed on the gain line, which is drawn at 0 dB, 25% down the clip, and started a gain gesture; the hover logic had also shown the I-beam over it, promising a range the press would not make; the gain line, fade handles and take badge now keep their own cursors. `tsc` also failed first: `limits` had no case for the new gesture kind (a range never moves the clip, so it returns [0, 0]). No existing harness needed changing, as their gestures were all at mid-height or lower, or on edges and handles. Verified on the 10 s tone at 100 px per second: hover zones range and grab, none on the gain line; an upper-half drag from 100 to 200 px made the range 48,000 to 96,000 with no document change and the clip selected, and the band followed zoom (200 px at 2x); Delete in Slip left the range exactly silent and the rest exactly the tone, one step; Delete in Shuffle rendered the tone with exactly one second removed (432,000 frames), one step; S split at both edges in one step with the render still identical; a plain click in the upper half selected without a range; Escape cleared it; a lower-half drag moved the clip by 48,000 in one step; no page errors; layout shift 0; timeline, edit, grid and gain, selection, marquee, Shuffle, clipboard, group trim, edit mode and comping regressions unchanged.

---

## v0.38.0 · any format, every clip audible

### src/io/media-client.ts, src/ui/import.ts, record.ts, shell.ts, resample.ts, session.ts, src/engine/document.ts · import and sample-rate repair
- refers-to: src/io/media-client.ts :: `importFile` (rate), `resampleMedia`; src/ui/import.ts, src/ui/record.ts :: the session rate on import; src/ui/shell.ts :: the file picker's accept list; src/ui/resample.ts :: `mountResampleRepair`; src/ui/session.ts; src/engine/document.ts :: `resample-session`
- kind: warning-context
- logged: v0.38.0 · 2026-09-29

The owner's session showed the product failing at its basics: import took WAV only, and a clip at another rate than the session was silent ("until resampling arrives"); the session had started at 24 kHz from its first file, so the 48 kHz stereo clip played nothing. The file picker now offers every audio format and video files, and imports and recorded takes carry the session rate so the engine converts them (see the backend log). `mountResampleRepair` keeps every clip audible: whenever a session has files at another rate, or runs below 44.1 kHz, it converts those files in the engine and applies one `resample-session`, which moves the session to its new rate scaling every session-time field (clip starts, lengths and fades, automation times, markers, regions, the loop) and swaps each converted file in with its source and take offsets scaled by that file's own rate change. One undo step; an undo is repaired again at once, as silence is not allowed back. The player already rebuilds its audio context when the session rate changes. Verified with the formats from the backend log, and the owner's case: a 24 kHz file and a 48 kHz file imported together gave a 24 kHz session, then automatically 48 kHz with clips 240,000 to 480,000 and 72,000 to 144,000 long, the notice "Session at 48.0 kHz: converted 1 file, every clip plays", the converted tone still 440 Hz at RMS 0.3535, and the formerly silent stereo clip audible (peak 0.879); no page errors.

### src/ui/transport.ts, lanes.ts, styles/family.css, vendor/nodemode/themes.ts, index.html · transport basics and the family look
- refers-to: src/ui/transport.ts :: keydown (Space), `placePlayhead` (follow); src/ui/lanes.ts :: lane markup, `updateLane`, header mute and solo clicks; src/styles/family.css; src/vendor/nodemode/themes.ts :: `formcut`, `DEFAULT_THEME`, `DEFAULT_ACCENT`; index.html :: the theme boot's `formcut` profile and defaults; src/main.ts
- kind: warning-context
- logged: v0.38.0 · 2026-09-29

Owner-reported, from real use: Space did not play, the view did not follow the playhead, tracks had no mute button, and the look matched neither formcut nor formvis. Space: the transport's key handler returned early for any focused button, and after any toolbar click focus stays on that button, so Space re-clicked it instead of playing; Space now toggles the transport everywhere except text entry, cancelling the focused button's activation and blurring it. Follow: nothing scrolled during playback; `placePlayhead` now pages the view when the playhead passes 92% of the visible timeline or leaves it on the left, only when the playhead moves. Every track header has M and S buttons on the same undoable commands as the mixer. The family look: formcut's palette (v2.2.2 tokens) is a theme profile in both the vendored `themes.ts` and the pre-paint boot in `index.html`, and the default, with its amber cue as the default accent; `family.css` maps the rest of formcut's tokens (hover, input, radii, fonts, danger) and gives clips formcut's audio-tag green. A first attempt set the palette in CSS only and did nothing, as the theme boot writes the palette inline on the root element; a saved explicit theme choice is still honoured. The layout itself (formcut's panes) is not ported yet. Verified in Chromium: after clicking Grid, Space played without toggling Grid, and stopped; Space in the session name typed a space; zoomed to 8x, 2.5 s of playback scrolled the view from 0 to 1,886 px with the playhead in view; header M muted the track in one step (the mixer strip agreed, the track exactly silent) and S soloed; the background measured #121617, the accent #ffae2b and clips #50e2a5; no page errors; layout shift 0; first paint without shifts.

### src/vendor/formcut/, src/ui/lanes.ts, mixer.ts, grid.ts, shell.css, family.css · formcut's icons
- refers-to: src/vendor/formcut/icons.ts, src/vendor/formcut/icons-lucide.ts :: `icon`, `LUCIDE`; src/ui/lanes.ts :: lane markup; src/ui/mixer.ts :: `stripNode`, the Mixer toggle; src/ui/grid.ts :: `makeButton`; src/styles/shell.css :: `.fw-icon-btn`, `.fw-glyph-on`, `.fw-glyph-off`, `.fw-mode`; src/styles/family.css :: `--pane`
- kind: rationale
- logged: v0.38.0 · 2026-09-29

Owner-reported: track mute and solo were the letters M and S, not icons. formcut's icon system is vendored verbatim from formcut v2.2.2 (its own 16 px glyphs plus a Lucide set generated from the bundled IcoLab library, ISC); six glyphs it lacked were packed from the same IcoLab Lucide set with its `icon_search.py pack --format glyphs` (headphones, shuffle, crosshair, scissors-line-dashed as punch, grid-3x3, sliders-horizontal as mixer), none drawn by hand. Mute uses formcut's own track-control pattern, speaker when on and speaker-off when muted, swapped by CSS on `aria-pressed`; solo is headphones; automation is formcut's curve and takes its layers, each with its accessible name and tooltip; mixer strips use the same glyphs; the Grid, Shuffle, Spot, Punch and Mixer buttons carry their glyphs beside their labels. `--pane` is aliased for formcut glyphs that fill with it. Verified in Chromium: header mute, solo, automation and takes controls held SVG glyphs and no text, mute showed speaker-off only when pressed, all five mode buttons and the strip buttons held glyphs; no page errors; Space, follow, header mute and solo audio, mixer, edit mode and automation regressions unchanged.

### src/ui/shell.ts, media-pane.ts, inspector-pane.ts, grid.ts, mixer.ts, normalize.ts, lanes.ts, transport.ts, styles/workspace.css · formcut's workspace
- refers-to: src/ui/shell.ts :: the shell markup; src/ui/media-pane.ts :: `mountMediaPane`; src/ui/inspector-pane.ts :: `mountInspector`; src/ui/lanes.ts :: `markSelected` (`fw-selection`); src/ui/grid.ts, src/ui/mixer.ts :: the tool tray; src/ui/normalize.ts :: Loudness before Export; src/ui/transport.ts :: `placePlayhead`; src/styles/workspace.css
- kind: warning-context
- logged: v0.39.0 · 2026-09-29

Owner-reported: the layout looked nothing like formcut or formvis. The shell now follows formcut v2.2.2 (`app.css` titlebar, workspace, pane, pane header, tool tray and primary action; `containers.css` panes): a 44 px titlebar of three parts (identity and flat menu items, the session name and status, the engine and Loudness beside an amber Export), over a workspace of rounded panes 7 px apart, adapted for audio with the timeline as the centre pane between Media and Inspector. The timeline pane has formcut's tool tray (Grid, Shuffle, Spot, Punch, Mixer), which also keeps the narrower transport from overflowing (it had clipped the loudness readout, Mixer and IN). Media lists the session's files with format and length, imports from its header and adds any file to a new track at the playhead. Inspector shows the selected clip (start, length, gain, fades, curve) and its track (volume, pan), each edit one undoable command through the existing commands, fields refreshed without overwriting one being typed in; the lanes announce selection with `fw-selection`. Every existing class and data-action is kept. Found through the timeline harness: the view paged whenever a stopped playhead passed 92% of it, so a visible click near the right edge scrolled the timeline; paging ahead now happens only while playing, and a stopped playhead scrolls only when it lands out of view. The same harness had to grab its clip in the visible part to the right of the sticky header and in the lower half (the Smart Tool's move zone), as zoom can scroll the clip's start under the header in the narrower pane. Verified at 1440 by 900: Media, Timeline and Inspector left to right with 14 px corners under a 44 px titlebar, Export last and amber; the tool tray held the five modes and nothing overflowed the transport; Media listed both files and added one at the playhead in one step; Inspector showed the clip and applied start 1.5 s, gain -6 dB, fade in 0.5 s, S-curve and track volume -3 dB exactly, one step each, and summarised the session when nothing was selected; no page errors; layout shift 0; basics, mixer (docked at the transport's top), Smart Tool, edit mode and timeline regressions unchanged.

### src/ui/voice-pane.ts, shell.ts, media-pane.ts, main.ts, styles/workspace.css · formwave's voice in a Voice tab
- refers-to: src/ui/voice-pane.ts :: `mountVoicePane`; src/ui/shell.ts :: the left pane's tabs; src/ui/media-pane.ts :: `.fw-media-empty`; src/styles/workspace.css :: `.fw-pane-tabs`, `.fw-pane-tab`, `.fw-voice-body`, `.fw-field-stack`
- kind: warning-context
- logged: v0.40.0 · 2026-09-29

The left pane now has formcut-style tabs, Media and Voice. Voice speaks formwave's own contract at `/api/voice` (vendored in the backend): it lists formwave's Qwen3-TTS checkpoints and loads one; generates speech in the loaded checkpoint's modes (clone a voice from any file in Media with its words, a preset voice with optional notes, or a designed voice from a description) in ten languages, importing the result through the normal path (converted to the session rate, listed in Media) onto a new track at the playhead; and transcribes the selected clip with formwave's Qwen3-ASR or Whisper models. Controls are enabled only when formwave would accept them, and any failure formwave returns is shown and kept until the next action (the first version showed it for an instant before the status refresh overwrote it: found in verification). Verified in this container with CPU PyTorch and no Qwen packages or weights: formwave's routes answered (`/status` with its five checkpoints, four ASR models and the device; `/generate` without a model 400 "Model not loaded. Click 'Load' first."; `/transcribe` with a WAV 503 "Transcription not available."); the Voice tab listed them, disabled Generate and Transcribe, and after Load showed "Load failed: No module named 'qwen_tts'", the server staying healthy; the Media tab returned intact; no page errors; layout shift 0; the workspace regression unchanged. The panel was first cramped by the Inspector's three-column fields and a stacked-field rule that lost to the general one; measured after the fix: pickers 130 px, text 210 px, no field overflowing. The checkpoint picker is 76 px beside Load, its names cut until opened. Not verified here: generation and transcription themselves, which need the Qwen packages and weights on the owner's Mac.

### src/ui/inspector-pane.ts, src/engine/document.ts, styles/workspace.css · formcut's audio effects in the Inspector
- refers-to: src/ui/inspector-pane.ts :: the Effects section, its catalogue fetch and apply handler; src/engine/document.ts :: `set-clip-media`; src/styles/workspace.css :: the Inspector header
- kind: explainer
- logged: v0.41.0 (in progress) · 2026-09-29

The Inspector's Effects section offers formcut's audio effects (see the backend log): a one-click Enhance speech (formcut's voice-clean) and the whole grouped catalogue with Apply. Applying renders a new file in the engine and `set-clip-media` points the clip at it, adding it to the session's media with the clip's timing unchanged: one undo step, and undo returns the original, which is never altered. The Inspector's header now gives a long file name the leftover width, as it had run into the title. Verified in Chromium: the menu held 7 groups and 48 effects under a selected clip; Enhance speech pointed the clip at "mic (Enhance speech).wav" in one undo step with the notice "Applied Enhance speech to the clip", and undo restored the original; no page errors.

### src/ui/workspace-layout.ts, shell.ts, vendor/formvis/icons.ts, styles/workspace.css · formcut's workspace behaviour
- refers-to: src/ui/workspace-layout.ts :: `mountWorkspaceLayout`; src/ui/shell.ts :: the pane toggles and dividers; src/vendor/formvis/icons.ts (formvis v1.52.5, verbatim); src/styles/workspace.css :: the five-column workspace, `.fw-pane-divider`, `.fw-panel-toggle`, the Voice checkpoint row
- kind: warning-context
- logged: v0.42.0 (in progress) · 2026-09-29

After formcut's `workspace-layout.ts`: dividers between the panes resize Media and Inspector in pixels (keyboard: 16 px per arrow on a focused divider), titlebar toggles with formvis's collapse glyphs show or hide them, and the arrangement is kept in local storage and re-clamped on window resize (each side at least 200 px, the timeline at least 360). The workspace became five explicit columns. The Voice tab's checkpoint picker now has its own row, Load beneath it. Found in verification: clamping both panes from the old widths at once let a large Media drag squeeze the Inspector to its minimum (now each is clamped against the other's current width in turn), and hiding a pane left its column at full width because the inline width variable outranks the stylesheet's hidden rule (the script now writes zero for a hidden pane). Verified at 1440 by 900: defaults 240 and 284 px; a 100 px drag gave 340, kept after reload; an arrow gave 356; the Inspector dragged to 344; an oversized drag stopped Media at 708 with the timeline at 360 and the Inspector untouched; hiding Media moved the timeline to x 7 (1,075 px), hiding both gave 1,426 px, restoring returned every width; the checkpoint picker on its own row with Load below; no page errors; workspace and basics regressions unchanged.

### src/ui/mixer.ts, styles/shell.css, styles/workspace.css · containment: nothing floats, overlaps or overflows
- refers-to: src/ui/mixer.ts :: the panel's placement, `setOpen`; src/styles/shell.css :: `.fw-mixer`; src/styles/workspace.css :: the wrapping transport, narrow-window titlebar, number fields
- kind: warning-context
- logged: v0.42.0 · 2026-09-29

Owner-reported from a screenshot: the Mixer was a fixed, window-wide overlay on the menu layer, appended to the page and lying across the Media and Inspector panes, and the Inspector's number fields showed native spinners. The Mixer is now a section of the timeline pane between the tracks and the transport: opening it shrinks the tracks, it scrolls inside its own box, and it no longer measures anything to place itself. A containment test (`verify_containment.py`) now checks at 1440, 1280 and 1024 px wide with a session, a selection and the Mixer open: no page scroll, panes in view and not overlapping, the Mixer, tool tray and transport inside the timeline pane, no overflow in the titlebar, tool tray, transport, Inspector, Media or Voice, and no visible fixed element. It found two more faults before release: the transport overflowed at 1280 (127 px) and 1024 (383 px), and at 1024 the titlebar's menu group ran into the centre, because formcut's `1fr auto 1fr` titlebar gave the centre all the width its status text wanted. The transport now wraps inside a narrow pane (its height follows), and below 1180 px the menu items go icon-only (labels kept for screen readers, tooltips kept) and the titlebar's centre shrinks with an ellipsised status. Number fields dropped their spinners. Verified: all three sizes clean on every check; the mixer regression unchanged (its panel's bottom on the transport's top, strips, silences and meters); screenshot inspected.

### src/ui/media-pane.ts, inspector-pane.ts, styles/workspace.css · Generate and Analyze
- refers-to: src/ui/media-pane.ts :: the Generate section; src/ui/inspector-pane.ts :: the Analyze section (statistics, spectrogram), cleared on selection change; src/styles/workspace.css :: `.fw-generate`, `.fw-stats`, `.fw-spectrogram`
- kind: explainer
- logged: v0.43.0 · 2026-09-29

The Media tab gains a Generate section (tone at any frequency, three noises, silence, chirp, DTMF for typed digits, bleep; fields shown only for the signal that uses them) that adds the signal on a new track at the playhead at the session rate. The Inspector gains an Analyze section under a selected clip: Statistics fills a table (peak, RMS, DC offset, clipped runs) and Spectrogram shows the clip's spectrogram. The Effects menu needed no change: it lists the engine's catalogue, now 85 effects in 11 groups. Verified in Chromium: Generate added a 3 s tone track with its notice; the menu held 11 groups and 85 effects; Statistics read peak -6.02 and RMS -9.03 dBFS on the tone; the spectrogram loaded and fitted the pane; no page errors; the containment test clean at all three sizes.

### src/ui/transcript-pane.ts, src/engine/document.ts, shell.ts, main.ts, styles/workspace.css · transcript editing
- refers-to: src/ui/transcript-pane.ts :: `mountTranscriptPane`, `sessionWords`, `rangesOf`; src/engine/document.ts :: `clear-ranges`; src/ui/shell.ts :: the Transcript tab; src/styles/workspace.css :: `.fw-transcript-*`, `.fw-word`
- kind: rationale
- logged: v0.44.0 (in progress) · 2026-09-29

A Transcript tab beside Media and Voice. Transcribe session transcribes each file used on the timeline once; the words shown are re-derived from the document on every change (a word belongs to a clip when its midpoint lies in the clip's trimmed source range and moves with it), so the transcript follows every edit and undo without bookkeeping. Click a word to seek, shift-click to select a run, Ctrl or Cmd-click to toggle; the word under the playhead is underlined in playback. Delete selected words, Remove filler words and Shorten gaps (over 0.75 s down to 0.3 s) each dispatch one `clear-ranges` command: ripple deletes on every track, latest range first so earlier ranges keep their positions, one undo step. Verified in Chromium on the JFK recording (verify_transcript.py): the exact 22 words and no fillers; clicking "ask" sought to 3.34 s; deleting "so my fellow Americans," removed 1.48 s in one undo step, left 18 words from "And ask not what" and put "ask" at 1.86 s (3.34 minus 1.48); undo restored 22 words and 11.0 s; Shorten gaps removed 1.06 s (the 1.36 s pause kept at 0.3 s) with every word kept; Remove filler words reported none; no page errors; containment clean at three sizes.

### src/ui/transcript-pane.ts, styles/workspace.css · speaker labels by track, retake removal
- refers-to: src/ui/transcript-pane.ts :: `SessionWord.speaker`, `retakeRanges`, `RETAKE_RUN`, `RETAKE_WINDOW`, the speaker labels in `render`; src/styles/workspace.css :: `.fw-speaker`
- kind: rationale
- logged: v0.45.0 (in progress) · 2026-09-29

Speaker labels: each word carries its track's name, and when the transcript spans more than one, a label heads each change of speaker; telling speakers apart inside one recording (diarization) is not attempted yet. Remove retakes: a run of four words said again within the next forty means the first attempt was abandoned; it goes from its first word up to where the retake starts, keeping the last take, in one ripple edit. Four words, because a single take can repeat three (the JFK line has "can do for you" and "can do for your"). Verified in Chromium (verify_retakes.py) on real speech: a single JFK take reported no earlier takes; with the recording again as "guest" from 11 s, the transcript showed 44 words labelled jfk then guest; Remove retakes removed 11.00 s in one undo step, leaving the last take's exact 22 words from 0 s without labels; undo restored 44 words and 22 s; no page errors; the transcript regression unchanged.

### src/ui/inspector-pane.ts · sliders for an effect's controls
- refers-to: src/ui/inspector-pane.ts :: `.fw-fx-params`, `showControls`, `currentParams`, the Apply request's `params`
- kind: explainer
- logged: v0.46.0 (in progress) · 2026-09-29 (entry written the session after its commit, `d4ac11d`)

The engine's catalogue now lists each adjustable effect's controls (see the backend log). Choosing such an effect in the Inspector shows a slider per control with its live value and unit, starting at the default; Apply sends the values, Enhance speech keeps its default. Verified in Chromium (verify_params.py): Amplify showed "Gain 6 dB", the slider moved to -3 read "-3 dB", and Apply produced "mic (Amplify -3dB).wav" at 0.7079 of the original peak (-3 dB); Invert showed no controls; no page errors.

### src/ui/lanes.ts, src/engine/document.ts, src/ui/inspector-pane.ts · effects on a Smart Tool range
- refers-to: src/ui/lanes.ts :: the `fw-range` announcements; src/engine/document.ts :: `set-range-media`; src/ui/inspector-pane.ts :: `range`, `find`'s range fallback, the apply target
- kind: warning-context
- logged: v0.47.0 · 2026-09-29

The timeline announces its Smart Tool range (`fw-range`, null when cleared). While a range exists it is the target of Enhance speech and Apply: the clip the range overlaps on its track, whichever piece is selected (after a first range effect the selected piece is the left one, which the range does not overlap; the first version targeted it and applied a second effect to the wrong piece). `set-range-media` splits that clip at the range edges and puts the middle piece on the processed file, time-aligned because the engine renders the whole file and the piece keeps its source offset; fades stay on the outer edges; one undo step. Effects that change timing (the engine's `retimes` flag: tempo, speed, stretch, truncate silence, reverse) are refused inside a range with a message. The work sat on a branch until verified: two sessions of failures were the harness's own (a drag on the gain line, a comment that disabled the drag, a click-then-drag probe on the Inspector's pane divider, which lies over the clip's unseen part at 1440 px), each found by making the harness report instead of wait. Verified (verify_range_fx.py): a 2 to 4 s range and Amplify -6 dB gave three pieces with the middle starting 2.0 s into the new file at exactly 0.5012 of the peak, one undo step, the range kept; Change tempo inside it refused with the document unchanged; Invert on the same range changed only the middle piece, sample-exact; two undos stepped back to the single original clip; a click then a drag inside the visible clip made a range; no page errors; the Smart Tool regression unchanged.

### src/ui/transcript-pane.ts · Make a clip from selected words
- refers-to: src/ui/transcript-pane.ts :: `SessionWord.mediaId`, `mediaStart`, `mediaEnd`, the `clip` action
- kind: explainer
- logged: v0.48.0 · 2026-09-29

Short clips from the transcript: each transcript word now carries its recording and its times in that recording (clamped to the clip's trimmed range), so the selected words map straight to an excerpt from the first word's start to the last word's end, pauses between them kept; the excerpt lands on a new track at the playhead. A selection spanning two recordings is refused with a message. Verified in Chromium on the JFK recording (verify_wave3b.py): "ask not what your country can do for you," made a 3.98 s clip of 9 words named "jfk (clip 3.34 to 7.32 s)" on a second track; no page errors.

### src/engine/document.ts, src/ui/labels-pane.ts, ruler.ts, shell.ts, main.ts, styles/workspace.css · labels and markers (coverage wave 4)
- refers-to: src/engine/document.ts :: `remove-marker`, `set-marker`, `set-region`; src/ui/labels-pane.ts :: `mountLabelsPane`, `labelsOf`, `cues`, `toWebVtt`, `toSubRip`, `toChapters`, `parseSubRip`; src/ui/ruler.ts :: marker drawing; src/styles/workspace.css :: the left pane's header, `.fw-label-*`
- kind: warning-context
- logged: v0.49.0 (in progress) · 2026-09-29

The document already had markers and regions (with add-marker, add-region, remove-region and a batch command) and the ruler drew regions, but nothing in the interface used them: the work extends them rather than adding a second label system. New commands remove a marker and edit a marker's or region's time and label. A Labels tab adds a marker at the playhead or a region from the Smart Tool range, lists them by time (click to go there, type to rename, delete), exports WebVTT, SubRip and Podcasting 2.0 chapters (version 1.2.0; a marker becomes a cue to the next label, at least 1 s and at most 5 s) and imports SubRip (commas or dots) as regions in one undo step; the ruler now draws markers too. Labels live in the session document, so they save with it and undo like edits. Found in verification: the fourth tab stacked the tabs one per line (the header's three-column grid) and region rows left their name no width; the tabs now have a row of their own that fits 213 of 216 px at the default pane width, and names take their own line. Verified (verify_labels.py): a marker at 1.5 s and a 2 to 4 s region, one step each; the rename; the three downloads exactly (`00:00:01.500 --> 00:00:02.500 Intro`, `00:00:02.000 --> 00:00:04.000 Region 1`, the SubRip twin with commas, chapters startTime 1.5 and 2 to 4); two SubRip cues imported in one step; delete and undo; the third label sought 5.0 s; header 37 px on Labels, tabs overflow 0; containment clean at three sizes; no page errors.

### src/ui/spectrogram-view.ts, main.ts, styles/workspace.css · spectrogram view on the timeline (coverage wave 4)
- refers-to: src/ui/spectrogram-view.ts :: `mountSpectrogramView`; src/styles/workspace.css :: `.is-spectral`, `.fw-spectral-toggle`
- kind: rationale
- logged: v0.50.0 · 2026-09-29

A Spectrogram toggle in the tool tray; with it on, each clip shows its file's spectrogram under it and the waveform is hidden. One bare image of the whole file (2048 by 256, no legend, cached per file) is drawn as the clip's background, sized to the clip's width times file frames over clip frames and offset by the clip's trim, so it follows splits and trims without re-rendering; styles are written only when they change, after each timeline render (`fw-lanes-rendered`). The module does not touch lanes.ts. Verified (verify_spectrogram_view.py): the whole 10 s clip at 1000 px with the image at offset 0; after a 2 to 4 s cut the right 600 px piece showed the 1000 px image at exactly -400 px (its 4 s trim); a 2048 by 256 PNG; the tray without overflow at 1024; off restored the waveform; no page errors; containment clean at three sizes; the timeline regression unchanged. The first run's pass line compared "1000.00px" with the browser's normalized "1000px" and reported FAIL on matching values; it now compares numbers.

### src/ui/export.ts, src/io/render-client.ts, styles/workspace.css · the export dialog
- refers-to: src/ui/export.ts :: the dialog, `choice`, `run`; src/io/render-client.ts :: `ExportOptions`, `Mix.ext`, `Mix.stems`; src/styles/workspace.css :: `.fw-export-dialog`
- kind: explainer
- logged: v0.51.0 (in progress) · 2026-09-29

Export opens a native dialog (the browser's top layer, so no stacking rules): the format (WAV float, 24 or 16-bit, FLAC, MP3 320 or 192, OGG, M4A) and what to export (the mix, stems as a zip, or multichannel). The file is named from what the engine made; Ctrl or Cmd with Shift and E exports straight away with the last choice; Loudness still renders the float mix (the client's defaults are unchanged). Verified in Chromium (verify_export.py): the dialog opened, FLAC chosen, the download was "Untitled session.flac", the dialog closed and the notice reported peak and loudness; no page errors.

### src/ui/import.ts · audio files pasted from the OS clipboard (coverage wave 5)
- refers-to: src/ui/import.ts :: `importOne` (`at`), `importAll` (`at`), the `paste` listener
- kind: explainer
- logged: v0.52.0 (in progress) · 2026-09-29

Audio files are taken from the OS clipboard: a paste carrying files now imports each (converted to the session rate, one after another) onto a new track at the playhead; a paste into a text field is left to the field. Dropping files onto the timeline already existed here and keeps its place at 0; the import path gained a position so both share it. Verified in Chromium (verify_paste_files.py) with real File objects in genuine events: a paste with the playhead at 2 s made a "pasted" track starting at 2 s; the same paste on the session-name field did nothing; a drop still made a track at 0; no page errors.

### src/ui/export.ts · clipping warning on export
- refers-to: src/ui/export.ts :: the `clips` note in `run`
- kind: explainer
- logged: v0.52.0 · 2026-09-29

A mix peaking above full scale clips in every export format except 32-bit float WAV, silently until now. The export notice now says so when it happens and points to the Master fader, Loudness or float WAV. Verified in Chromium (verify_clip_warning.py): a session peaking at -6.0 dBFS exported as FLAC without the warning; one peaking at +1.0 dBFS warned for FLAC and MP3 and not for float WAV.

### src/ui/workspace-layout.ts, styles/workspace.css · saved workspace layouts (coverage wave 5)
- refers-to: src/ui/workspace-layout.ts :: `PRESETS`, `readSaved`, the Layout menu; src/styles/workspace.css :: `.fw-layout-select`
- kind: explainer
- logged: v0.53.0 (in progress) · 2026-09-29

Saved workspaces: a Layout menu in the tool tray applies preset layouts (Default, Timeline only, Editing, Transcript) and named layouts saved with Save current layout (a native prompt for the name, kept in browser storage beside the current layout), through the existing clamp-and-save path. Verified in Chromium (verify_layouts.py): Default 240 and 284 px; Timeline only hid both panes; Editing hid Media; saving as "Mine" added it to the menu; Transcript gave a 380 px left pane and no Inspector; Mine restored the saved arrangement exactly; Default restored 240 and 284; the menu reset after each choice; containment clean at three sizes; no page errors.

### src/ui/projects.ts, spectrogram-view.ts, styles/workspace.css · recent sessions; two visual faults the checks had missed
- refers-to: src/ui/projects.ts :: the recent sessions list (`showRecent`, `emptyStage`); src/ui/spectrogram-view.ts :: the toggle's class; src/styles/workspace.css :: `.fw-recent*`, the transport's height, the empty stage's scrolling
- kind: warning-context
- logged: v0.53.0 · 2026-09-30

A home screen of recent projects: the empty timeline lists the six latest saved sessions (newest first, tracks and date) and opens one through the existing open path (which asks before discarding unsaved changes); it refreshes when the timeline empties. A screenshot of it showed two faults the geometric checks had passed: the Spectrogram button (v0.50.0) carried a class the tool tray does not style (`fw-tool`; the tray's buttons are `fw-mode`), and at 1024 px the transport's wrapped second row (meters, loudness) was clipped, probably since v0.42.0, because a later rule fixed the transport's height over the wrap rule's automatic one and the containment test measured only horizontal overflow. The toggle now uses `fw-mode`, the transport's height is a minimum, and the containment test measures vertical overflow of the titlebar, tray and transport too. Verified: two sessions saved through the app listed newest first with their track counts and opened on click (verify_recent.py); the Spectrogram and Mixer buttons' computed styles equal; the home screen's transport 79 px tall with no vertical overflow at 1024; containment, now with vertical overflow, clean at three sizes.

### src/ui/inspector-pane.ts, styles/workspace.css · effect search and Apply to all clips (coverage wave 6)
- refers-to: src/ui/inspector-pane.ts :: the `search` filter, the `apply-all` handler; src/styles/workspace.css :: `.fw-fx-search`
- kind: explainer
- logged: v0.54.0 (in progress) · 2026-09-30

Module search: a search box filters the Effects menu by effect or group name as you type, hiding empty groups and moving the choice to the first match when the current one is hidden. Batch processing: Apply to all clips runs the chosen effect with its current controls on every clip, rendering each distinct file once and switching every clip in one batch command, one undo step. Verified in Chromium (verify_batch_search.py): "de-" left the nine de- effects; "zzz" left no options and no groups; clearing restored 88; Amplify -6 dB on all clips of a two-track session changed both in one undo step at 0.5012 of their peaks, and undo restored both; no Inspector overflow; containment with vertical overflow clean at three sizes; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · Mic check in Analyze
- refers-to: src/ui/inspector-pane.ts :: the `mic` action, `.fw-mic-findings`, the `data-use` buttons; src/styles/workspace.css :: `.fw-finding`, `.fw-analyze-buttons`
- kind: explainer
- logged: v0.54.0 (in progress) · 2026-09-30

Analyze gains Mic check: the engine's findings for the inspected clip, marked OK, warning or problem, each with a Use button that selects its suggested effect (clearing any effect search) and shows its controls, ready to apply; findings clear when the selection changes. The screenshot showed the third Analyze button's label wrapping inside the button, which the overflow measures could not see: labels in these rows now never wrap and the row wraps whole buttons. Verified in Chromium (verify_mic_check.py) on the hum recording: two OK findings and one warning with Use Hum remover, which selected it, and Apply produced "hum (Hum remover).wav"; every Analyze and Apply button one line (28 px); no overflow; containment with vertical overflow clean at three sizes; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · effect chains (coverage wave 6)
- refers-to: src/ui/inspector-pane.ts :: `chain`, `renderChain`, the `chain-add`, `chain-apply`, `chain-clear` and `data-chain-remove` actions; src/styles/workspace.css :: `.fw-chain`
- kind: explainer
- logged: v0.55.0 (in progress) · 2026-09-30

Module chains: Add to chain keeps the chosen effect with its current controls (labelled with their values), steps can be removed, and Apply chain runs them in order, each on the previous step's file, then changes the document once (the clip, or the range when one exists, as Apply does), so the whole chain is one undo step; a chain with a timing-changing step is refused inside a range. Verified in Chromium (verify_chain.py) on the 440 Hz clip: Amplify -6 dB, Invert and Amplify +12 dB listed, a removed and re-added step reordered; applying gave -1.9953 of every sample (+6 dB inverted, largest deviation 0.000019 across three renders) in one undo step; undo restored the original; with Change tempo added and a range dragged the chain was refused and the document unchanged; Clear hid the chain; containment with vertical overflow clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · Separate into stems
- refers-to: src/ui/inspector-pane.ts :: the `separate` action
- kind: explainer
- logged: v0.56.0 · 2026-09-30

Separate into stems sends the clip's trimmed range to the engine and, in one batch command, puts the four stems on new tracks starting where the clip starts and mutes the original track, so one undo reverses it all; the notice warns that separation takes about three times the clip's length on a CPU. Verified in Chromium (verify_separate.py) on a clip trimmed by 2 s: four tracks named for their stems, each starting at 2.0 s and 9.0 s long, the original muted, one undo step, undo restoring the original track unmuted and alone; no page errors. The separation's quality is in the backend log.

### src/styles/workspace.css · hidden action buttons were still shown
- refers-to: src/styles/workspace.css :: `.fw-ibtn[hidden]`
- kind: warning-context
- logged: v0.56.0 · 2026-09-30

A screenshot showed Apply chain and Clear chain with an empty chain: the buttons carried the hidden attribute, but the button class's display rule overrode it, and the chain harness had read the hidden property, which was true, rather than whether the buttons showed. Hidden action buttons are now never displayed, and the check reads computed display: none with an empty chain, flex with a step, none after Clear; the chain regression unchanged.

### src/ui/export.ts · streaming preview in the export dialog
- refers-to: src/ui/export.ts :: the `preview` choice in the dialog and in `run`
- kind: explainer
- logged: v0.57.0 (in progress) · 2026-09-30

The export dialog's What gains Streaming preview: rather than downloading, the engine's decoded preview lands on a new track at 0 s, to solo against the mix. Verified in Chromium (verify_preview.py): MP3 192 kbps added "Streaming preview (MP3, 192 kbps)" at 0 s, 11.0 s long; FLAC was refused with the engine's message; no page errors.

### src/ui/inspector-pane.ts · Deconstruct
- refers-to: src/ui/inspector-pane.ts :: the `deconstruct` action (sharing the separation handler)
- kind: explainer
- logged: v0.57.0 (in progress) · 2026-09-30

Deconstruct beside Separate into stems, through the same handler with its own route and wait note: the clip's trimmed range becomes tonal, noisy and transient tracks at the clip's start, the original muted, one undo step. Verified in Chromium (verify_deconstruct_ui.py): three tracks at 0 s, 4.0 s long, the original muted, one step, undo restoring it; the Separate regression unchanged through the shared handler; buttons one line; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · automatic ducking (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: the `data-duck` controls, `fillDuck`, the ducking handler
- kind: warning-context
- logged: v0.58.0 (in progress) · 2026-09-30

Auto ducking: in the track section, Duck under (another track) and By (3 to 30 dB) write this track's volume automation from the other track's active regions (merged when closer than attack plus release; 0.15 s down, hold, 0.4 s back), one undo step, editable in the automation lane. Found in verification: the Duck under menu first offered the selected track itself, because it refreshed before the selection listener had updated; it now refreshes after it. Verified in Chromium (verify_duck.py) with the JFK speech over a steady tone: "Ducked bed by 12 dB in 2 places under jfk", the rendered tone at -45.12 dB during speech and -33.12 dB in the pause, 12.0 dB exactly; one undo step; undo removed the envelope; the menu offered only the other track; no overflow; screenshot inspected; containment clean; no page errors.

### src/ui/ruler.ts · a draggable playhead (coverage wave 10)
- refers-to: src/ui/ruler.ts :: `dragHead`, `nearHead`, `seekSoon`, the pointer handlers
- kind: explainer
- logged: v0.59.0 (in progress) · 2026-09-30

A draggable playhead: a press on the ruler within 6 px of the playhead grabs it (the cursor shows ew-resize there) and dragging seeks once a frame, playing on if playing, instead of drawing a loop range; releasing seeks exactly where it was let go. A press anywhere else keeps click-to-seek and drag-for-loop. Verified in Chromium (verify_playhead_drag.py): the cursor at the playhead and not 60 px away; a drag from 2.0 s read 2.5, 3.0 ... 5.0 s as it moved and ended at 5.0 s with the loop unchanged; while playing, the playhead grabbed at 3.68 s and dragged back kept playing from about 1 s; a drag elsewhere still made a loop (0.4 to 1.4 s) and a click still seeked (1.7 s); containment clean; no page errors. The first run's loop and click checks failed because they aimed at 7 to 9 s, past the timeline pane's visible edge under the Inspector (the ruler canvas is 1,100 px wide, wider than the pane), so they never reached the ruler.

### src/engine/document.ts, src/ui/lanes.ts, styles/workspace.css · clip groups (coverage wave 10)
- refers-to: src/engine/document.ts :: `Clip.groupId`, `set-clip-group`; src/ui/lanes.ts :: `groupOf`, `expandGroups`, `markGroups`, the click and Ctrl/Cmd+G handling; src/styles/workspace.css :: `.fw-clip[data-group]`
- kind: explainer
- logged: v0.60.0 (in progress) · 2026-09-30

Clip groups as a persistent selection: Ctrl/Cmd+G groups the selected clips (two or more, across tracks) and Ctrl/Cmd+Shift+G ungroups them, each one undo step; a click on any member selects the whole group and Shift-click toggles it, so the existing multi-clip drag and delete carry the group; grouped clips show a dashed accent outline, kept current on every document change. The first cut of the shortcut replaced the Ctrl/Cmd block's opening line; it was restored at once and Ctrl+A is in the checks. Verified in Chromium (verify_groups.py) on three tracks: A and B grouped in one step with dashed outlines on them only; a click on C selected one clip and on A two; dragging A moved A and B to 1.0 s with C unmoved; Delete removed both and undo restored them; ungrouping cleared the group and a click on A then selected one; undoing back past the grouping removed the outlines; Ctrl+A selected all three; screenshot inspected; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/audio/player-worklet.ts, src/ui/inspector-pane.ts, styles/workspace.css · realtime track effects (coverage wave 8)
- refers-to: src/engine/document.ts :: `TrackFx`, `Track.fx`, `set-track-fx`; src/audio/player.ts :: `planClips` (`fx`); src/audio/player-worklet.ts :: `fw_set_rate`, `fw_add_clip_fx`, `WorkletClip.fx`; src/ui/inspector-pane.ts :: `renderRtfx`, `commitRtfx`, the `data-rtfx` controls; src/styles/workspace.css :: `.fw-rtfx-*`
- kind: warning-context
- logged: v0.61.0 (in progress) · 2026-09-30

A track's realtime effects (high-pass, low-pass, peak EQ, low and high shelf) in the Inspector's track section: Add, frequency, gain for peak and shelves, Q, On (bypass) and Remove, each change one set-track-fx; the list rebuilds only when the track's effects change and never while an input in it has focus. The playback plan sends each clip its track's enabled stages in the core's codes and the worklet tells the core its sample rate, so playback runs the same filters as the export. Found: the served core (public/core, built by oc_install and git-ignored) was stale, without the new exports; the release gate builds the wasm32 target but never copies it, so it was refreshed with oc_install and the gate will compare the served core with the fresh build. Two harness errors on the way: the level hook is onOutputLevel, not onLevel (all peaks read 0), and a focused checkbox took Space, so one run never played; focus is cleared and playing is recorded per run. Verified in Chromium through the worklet on 100 Hz plus 5 kHz sines at 0.25: output peak 0.4969 without effects, 0.2636 with a 1 kHz high-pass (-5.51 dB, the 100 Hz half gone), 0.4969 again bypassed, playing in all three runs (verify_rtfx.py); add and edit two undo steps; Remove emptied the list; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/audio/player-worklet.ts, src/ui/inspector-pane.ts · master effects and reordering (coverage wave 8)
- refers-to: src/engine/document.ts :: `SessionDoc.masterFx`, `set-master-fx`, `cleanFx`; src/audio/player.ts :: `flatFx`, `sendPlan`; src/audio/player-worklet.ts :: `fw_clear_master_fx`, `fw_add_master_fx`, the clips message's `masterFx`; src/ui/inspector-pane.ts :: `fxLists`, `renderFxList`, `commitRtfx`, `scopeOf`, the Master effects section
- kind: explainer
- logged: v0.62.0 (in progress) · 2026-09-30

The effects list is one component in two scopes: the selected track, and a Master effects section shown whenever the session has tracks. Rows gain Up and Down (disabled at the ends) to reorder; every change, the master's included, is one undo step. One `cleanFx` rule serves track and master in the reducer, and one `flatFx` turns stages into the core's codes for both. Verified in Chromium through the worklet (verify_master_fx.py) on the 100 Hz plus 5 kHz mix and a 1 kHz tone: the master section hidden when empty and shown with tracks; output peak 0.6219 without effects and 0.2768 with a 2 kHz master high-pass, playing in both runs; Down swapped Peak EQ and High-pass in one undo step with the rows in the new order, Up disabled on the first row, and undo restored the order; the track-effects regression unchanged (0.4969, 0.2636, 0.4969); no overflow at 1024 px; screenshot inspected; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/audio/player-worklet.ts, src/ui/inspector-pane.ts · the compressor in playback and the Inspector (coverage wave 8)
- refers-to: src/engine/document.ts :: `FilterFx`, `CompressorFx`, `TrackFx`, `cleanFx`; src/audio/player.ts :: `flatFx`, `flatStages`, `planClips` (a track's own bus), `sendPlan`; src/audio/player-worklet.ts :: `WorkletBus.stages`, `fw_add_bus_stage`, `fw_add_master_stage`; src/ui/inspector-pane.ts :: the compressor's label, defaults and fields
- kind: warning-context
- logged: v0.63.0 (in progress) · 2026-09-30

TrackFx becomes a union of filters and the compressor (threshold, ratio, attack, release, makeup), each clamped to the core's ranges. The playback plan mirrors the export's: a track holding an enabled compressor and routed to the master gets its own bus carrying its whole chain as six-wide stages, filters elsewhere still run per clip, and the master chain travels as stages. The Inspector offers Compressor on tracks and the master with its five fields; values fill from the field each input names. Found: the first live reading (0.4898) took the peak over the whole playback, including the onset the compressor lets through during its 10 ms attack; measured after 400 ms of settling, as the export was measured from 1 s. Verified in Chromium through the worklet (verify_comp.py) on a 1 kHz sine at 0.5: output peak 0.5 without effects, 0.1659 (-15.6 dBFS) settled with a -20 dB 4:1 compressor, the export of the same session -15.6 dBFS, 0.5 again at ratio 1, playing in all runs; the track and master filter regressions unchanged; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · Transients in Analyze (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: the `transients` action, `[data-an-sens]`
- kind: explainer
- logged: v0.64.0 (in progress) · 2026-09-30

Transients, with a Sensitivity from 0 to 1, puts a marker at each onset the engine finds inside the selected clip's visible span: file time is mapped through the clip's start, trim and the rate ratio, onsets outside the span are left out, and the markers go in one batch, one undo step. Verified in Chromium (verify_transients.py) on the drum-like clip moved to 1 s with its first 0.5 s cut: "Marked 4 transients" at 1.8018, 2.5509, 3.1005 and 3.7024 s (expected 1.80, 2.55, 3.10, 3.70; 0.5 to 2.4 ms), the cut burst left out, one undo step, undo removing all four; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · Split at transients and Quantize (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: `clipTransients`, `selectedIds`, the `split-transients` and `quantize` actions, the Quantize section, `render` (its visibility); src/styles/workspace.css :: `.fw-q-field`
- kind: warning-context
- logged: v0.65.0 (in progress) · 2026-09-30

Groove edits on transients: Split at transients (in Analyze) cuts the clip at each onset more than 10 ms inside its edges, last to first so every cut targets the original clip, one undo step; Quantize moves the selected clips' starts (or the inspected clip's) to the nearest line of a BPM grid at 1/4, 1/8 or 1/16, one undo step, so split pieces, each starting on its transient, land on the beat. Found in verification: Quantize first lived in Analyze, which the Inspector hides whenever more than one clip is selected, so it was unreachable exactly when it is needed; it now has its own section, shown whenever any clip is selected. Verified in Chromium (verify_groove.py) on the drum-like clip: 6 pieces at 0, 0.301, 0.8018, 1.5509, 2.1005 and 2.7024 s in one step; with all six selected, 120 BPM at 1/8 moved five to 0.25, 0.75, 1.5, 2.0 and 2.75 s in one step; undo reversed each; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · tempo detection for Quantize; styled selects in button rows (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: `estimateBpm`, the `detect-bpm` action; src/styles/workspace.css :: `.fw-analyze-buttons select`
- kind: warning-context
- logged: v0.66.0 (in progress) · 2026-09-30

Detect beside BPM estimates the inspected clip's tempo from its transients: for each candidate from 60 to 180 BPM in 0.1 steps, the onsets' phase alignment at its period (their resultant length), weighted by the share of its beats holding an onset, which keeps hits every second from also reading as 120 BPM. It asks for one clip when several are selected. A screenshot of the new row showed the division menu as an unstyled native select, as the effect-kind menus in the Add rows had been since v0.61.0: selects in the Inspector's button rows now take the field select's tokens. Verified in Chromium (verify_tempo.py) on decaying bursts: 100 BPM with a missing beat and up to 5 ms of jitter read 99.9, hits every second read 60.0 (not 120), and 137 BPM read 137.0; the division and effect-kind menus' computed colours equal the Duck under field's; no overflow at 1024 px; containment clean; screenshot inspected; no page errors.

### src/engine/document.ts, src/ui/grid.ts, src/ui/ruler.ts, src/ui/inspector-pane.ts · a session tempo, a bars ruler and beat snapping (coverage wave 10)
- refers-to: src/engine/document.ts :: `SessionDoc.tempo`, `set-tempo`; src/ui/grid.ts :: `barsEnabled`, `setBeatGrid`, `snapSamples`, the Bars button; src/ui/ruler.ts :: the bars branch of `draw`; src/ui/inspector-pane.ts :: `syncTempo`, `commitTempo`, the Beats field, Detect
- kind: explainer
- logged: v0.67.0 (in progress) · 2026-09-30

A beats and measures ruler: the session holds one tempo (BPM and beats per bar, clamped, each change one undo step), edited by Quantize's BPM and Beats fields, which follow it, and set by Detect. Bars in the tool tray switches the ruler to bar numbers and beat ticks (bars numbered every 1, 2, 4... as zoom allows, beats labelled bar.beat from 48 px apart) and, with Grid on, snaps to the beat halved or doubled by powers of two to at least 12 px, down to a sixteenth. Verified in Chromium (verify_bars.py): 110 BPM in 3 set the session tempo; with Bars and Grid on a drag landed at 1.36365 s, 2.5 beats, on the half-beat subdivision and off the tenth-second grid; with Bars off the next drag landed at 2.0 s on the seconds grid and off the beat grid; Detect set 99.9 BPM keeping 3 beats and undo restored 110 with the fields following; the ruler read 1, 1.2, 1.3, 2, 2.2 (screenshot); containment clean; no page errors.

### src/engine/document.ts, src/ui/inspector-pane.ts · re-timed media keeps its clip in step; Stretch to tempo (coverage wave 10)
- refers-to: src/engine/document.ts :: `set-clip-media` (scaling); src/ui/inspector-pane.ts :: the `stretch-tempo` action
- kind: warning-context
- logged: v0.68.0 (in progress) · 2026-09-30

A fault found while building Stretch to tempo, present since the timing-changing effects arrived: set-clip-media swapped only the media id, so a clip re-timed by Change tempo kept its old length, cutting a slowed clip short and leaving a sped-up one running past its audio. When the new media's length differs, the clip's trim, length and fades now scale by the same ratio. Stretch to tempo (in Quantize) detects the clip's tempo, divides the session's by it and renders the pitch-keeping tempo effect at that factor (0.5 to 2 times), one undo step. Verified in Chromium (verify_stretch.py): Change tempo at -50% took the clip from 8.2 to 16.4 s and undo back to 8.2 (before the fix it stayed 8.2); from 99.9 to 110 BPM the clip became 7.447 s, exactly 8.2 x 99.9 / 110, in one step. Open, to fix before release: re-detection read 107.8 BPM from 5 transients, because Rubber Band at its default options smears these bursts' attacks (6 onsets of 12 at sensitivity 0.5, 26 split ones at 0.9, spacing 0.5601 s against 0.5449); a short window keeps the spacing (0.5435 s, 16 onsets), so a rhythmic stretch with window=short is next.

### src/ui/inspector-pane.ts · Stretch to tempo uses the rhythmic stretch (the open issue above, resolved)
- refers-to: src/ui/inspector-pane.ts :: the `stretch-tempo` action
- kind: explainer
- logged: v0.68.0 (in progress) · 2026-09-30

Stretch to tempo renders with Change tempo, rhythmic (Rubber Band's short window). Verified in Chromium (verify_stretch.py): from 99.9 to 110 BPM the clip became 7.447 s in one step and now re-detects at 109.4 BPM from 16 transients (107.8 from 5 with the default stretch); the half-speed length fix unchanged (8.2 to 16.4 s, undo 8.2); the Quantize section wraps to three rows at 1024 px with no overflow (screenshot); containment clean; no page errors.

### src/ui/import.ts, src/ui/inspector-pane.ts · tempo detection on import (coverage wave 10)
- refers-to: src/ui/import.ts :: `offerTempo`, `importOne`; src/ui/inspector-pane.ts :: `tempoEstimate`, `estimateBpm`
- kind: explainer
- logged: v0.69.0 (in progress) · 2026-09-30

Tempo detection on import: a file imported (chosen, dropped or pasted) into a session without a tempo has its tempo read from its transients, and a confident, regular beat (8 onsets or more, a score of at least 0.7 against Detect's 0.5) becomes the session tempo as its own undo step after the import, the notice saying so. Recordings, generated voice and separated stems are not imports and are left alone; an existing tempo is never replaced. The estimator now returns its score (tempoEstimate), and estimateBpm wraps it unchanged. Verified in Chromium (verify_import_tempo.py): JFK's speech and a file of 15 irregular hits set no tempo; beat100 set 99.9 BPM in a second undo step, one undo clearing the tempo and keeping the track; beat60 set 60.0 from exactly 8 hits; beat137 imported after beat100 left 99.9 in place; the Detect regression unchanged (99.9, 60.0, 137.0); containment clean; no page errors.

### src/audio/player-worklet.ts, src/audio/player.ts, src/ui/shell.ts, src/ui/transport.ts, styles/workspace.css · play-at-speed (coverage wave 10)
- refers-to: src/audio/player-worklet.ts :: `speed`, `readPos`, `bufLen`, `renderAtSpeed`, `refill`, the `speed` message; src/audio/player.ts :: `setSpeed`, `start`; src/ui/shell.ts :: `.fw-speed`; src/ui/transport.ts :: the speed menu; src/styles/workspace.css :: `.fw-speed`
- kind: explainer
- logged: v0.70.0 (in progress) · 2026-09-30

Play at speed: a Speed menu in the transport (0.5 to 2 times) plays faster or slower with pitch following, like tape. The worklet reads a small buffer the core refills 128 samples at a time, advancing `speed` samples per output sample with linear interpolation and keeping the sample before the read position across refills so blocks join without a click; seeks, play, plans and speed changes clear it; at 1x the original path runs untouched. The core, its meters and exports are unchanged, and a node created after a speed was chosen receives it. Verified in Chromium (verify_speed.py) on the JFK recording: the playhead advanced 1.005, 2.008 and 0.501 seconds per second of wall time at 1, 2 and 0.5 times, playing in each run; containment clean; screenshot inspected; no page errors.

### src/main.ts, src/ui/inspector-pane.ts, src/ui/mixer.ts · double-click a slider to reset it (coverage wave 10)
- refers-to: src/main.ts :: the `pointerdown` record and `dblclick` handler; src/ui/inspector-pane.ts and src/ui/mixer.ts :: `data-default` on each slider
- kind: warning-context
- logged: v0.71.0 (in progress) · 2026-09-30

Controls reset on double-click: every slider carrying a default (clip gain, track volume and pan, the duck amount, each effect control's own default, the Mixer's fader and pan) resets through the same input and change events a drag fires. Two faults found in verification: the double-click's first press moves the thumb and records a step, so volume took two undo steps and one undo landed on its midpoint (-24 dB); that press's step is now undone before the reset. The first fix then skipped the reset for pan and clip gain, whose midpoints are their defaults, because the focused slider still read the default after the undo; the reset now always applies (the reducers ignore an unchanged value). Verified in Chromium (verify_reset.py): volume -12, pan 0.5 and clip gain +6 each reset to 0 in one undo step and one undo returned to the value set; an effect control returned to its default; the duck amount to 12 with its label; the Mixer fader to 0; containment clean; no page errors.

### src/audio/player.ts, src/ui/loop.ts · loop regions that behave predictably (coverage wave 10)
- refers-to: src/audio/player.ts :: `play` (the loop rule); src/ui/loop.ts :: `range`, `toggle`
- kind: warning-context
- logged: v0.72.0 (in progress) · 2026-09-30

Loop behaviour, found missing by probing before building: with looping on, playback from a playhead after the loop's end played straight past it and never looped (6.24 to 9.57 s with a 2 to 4 s loop). Playback that starts outside an enabled loop now starts at its beginning; recording's open playback is left alone so punch-in keeps its pre-roll. The Loop button turns a Smart Tool range into the loop, turned on, and otherwise toggles as before. Verified in Chromium (verify_loop.py) with a 2 to 4 s loop: from 6 s playback began at the loop and stayed inside it, wrapping; from 1 s it began at the loop too; with looping off, from 6 s it played on; a 5 to 7 s range and Loop set the loop to exactly 5 to 7 s, on, and Loop again turned it off; containment clean; no page errors.

### src/io/presets-client.ts, src/ui/inspector-pane.ts, styles/workspace.css · one preset system for rendered and realtime effects (coverage wave 8)
- refers-to: src/io/presets-client.ts :: `Preset`, `loadPresets`, `savePresets`; src/ui/inspector-pane.ts :: `presets`, `fillPresets`, `refreshPresets`, `storePresets`, the `data-preset` controls; src/styles/workspace.css :: `.fw-rtfx-row select`
- kind: explainer
- logged: v0.73.0 (in progress) · 2026-09-30

Presets from one engine store, wherever an effect's settings appear: the Effects section has a preset menu, Save preset (by name, replacing a same-named one) and Delete, loading through the same input events a drag fires; every realtime row, on a track or the master, has a preset menu and Save for its kind, a load being one undo step. Verified in Chromium (verify_presets.py): Amplify at -9 dB saved as "Quiet 9" into the store and loaded back from +3; offered again after a reload; a track high-pass at 250 Hz saved as "Rumble 250" and loaded onto a second high-pass in one undo step; the master's high-pass offered it too; deleting "Quiet 9" cleared it from the store and the menu; the rows fit at 1024 px with no overflow; containment clean; screenshots inspected (a first capture of a list taller than the viewport failed and was retaken per element); no page errors.

### src/engine/document.ts, src/ui/lanes.ts, styles/workspace.css · free clip placement across mono and stereo tracks (coverage wave 10)
- refers-to: src/engine/document.ts :: `move-clip-to-track`; src/ui/lanes.ts :: `lastPointerY`, `laneAt`, `markDropLane`, `endDrag`; src/styles/workspace.css :: `.fw-lane[data-drop]`
- kind: warning-context
- logged: v0.74.0 (in progress) · 2026-09-30

Free clip placement, found missing by a probe (a clip dragged onto another lane moved in time and stayed on its track): a single clip released over another lane now goes to that track, mono or stereo, as one undo step, and overlap replaces what lay under it through the same trim clear-range makes; the target lane is outlined while dragging. A dragged group still moves within its own tracks. The first build failed typechecking (clear-range requires its ripple flag, left out) while the dev server, which does not typecheck, ran the test; the flag is now given and the test was rerun on the built code. Verified in Chromium (verify_place.py): the JFK clip dragged onto the stereo track at 1 s left its track, trimmed the stereo clip to 0 to 1 s, in one undo step, with the target lane outlined only during the drag; a render of 1.5 to 2.5 s had a side signal of exactly 0 (the stereo material replaced, not mixed); undo restored both tracks; the stereo clip dragged onto the mono track at 5 s split JFK around it (0 to 5 s and 8 s on); a move within one track stayed a time move; the clip-group drag unchanged; containment clean; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/ui/inspector-pane.ts · non-destructive clip pitch (coverage wave 10)
- refers-to: src/engine/document.ts :: `Clip.pitch`, `Clip.pitchMediaId`, `set-clip-pitch`, `set-clip-media` (clearing the pitch); src/audio/player.ts :: `planClips` (`playId`); src/ui/inspector-pane.ts :: `[data-pitch]`, `syncPitch`
- kind: warning-context
- logged: v0.75.0 (in progress) · 2026-09-30

Non-destructive clip pitch: a Pitch slider in the clip section (-12 to +12 semitones, double-click to 0) renders the ORIGINAL media at that pitch with Rubber Band, which keeps length, and the clip plays that render while `mediaId` stays the original; a new pitch renders from the original again, so pitches never compound, 0 drops the render, and each change is one undo step. A render finishing after the selection moved is dropped rather than applied to another clip. Applying an effect to a pitched clip processes the original and clears the pitch, whose render was made from the old media; the pitch is set again after. Verified in Chromium (verify_pitch.py) by FFT of exports of the 440 Hz clip: +12 gave 880.0 Hz with the original media id unchanged, length 10 s and one undo step; -12 gave 220.5 Hz (bins 0.5 Hz wide), rendered from the original, not from the +12 render; 0 gave 440.0 Hz with no render left; undo returned to -12 with the slider following; an effect cleared the pitch; the production build passes; containment clean; screenshot inspected; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/ui/inspector-pane.ts · effects on a bus, processing a routed group (coverage wave 10)
- refers-to: src/engine/document.ts :: `Bus.fx`, `set-bus-fx`; src/audio/player.ts :: `planClips` (bus stages); src/ui/inspector-pane.ts :: the `bus` scope, `currentBus`, `.fw-insp-bus`
- kind: explainer
- logged: v0.76.0 (in progress) · 2026-09-30

The processing half of routing folders: a user bus carries its own effects (filters and compressors, in order), run on the sum of every track routed to it, in playback and export alike through the core's bus chains. The Inspector shows Bus effects, titled with the bus, when the selected clip's track is routed to one, with the same rows, reordering and presets as tracks and master. Folder collapsing in the timeline is still to come. Verified in Chromium (verify_busfx.py): with a 100 Hz and 5 kHz track routed to a bus "Stems" and a 1 kHz track not routed, the section was hidden for the unrouted clip and titled "Bus effects · Stems" for the routed one; a 2000 Hz high-pass on the bus cut 100 Hz by 52.14 dB in the export, 5 kHz by 0.1 dB, and left the unrouted 1 kHz at 0.0 dB; production build passes; containment clean; screenshot inspected; no page errors.

### src/ui/lanes.ts, styles/workspace.css, styles/shell.css · the folder view (coverage wave 10, completing PT-20)
- refers-to: src/ui/lanes.ts :: `folderNode`, `updateFolder`, `folded`, the rows given to `patchList`; src/styles/workspace.css :: `.fw-folder`, `.fw-lane[hidden]`; src/styles/shell.css :: `.fw-lanes` `grid-auto-rows`
- kind: warning-context
- logged: v0.77.0 (in progress) · 2026-09-30

The folder half of folder tracks: a header row before the first track routed to each bus ("Stems · 2 tracks"), whose toggle folds the bus's tracks out of the timeline and back. Folding is view state kept in the lanes, not saved with the session and not an undo step; the header follows routing (the count updates, a newly routed track folds with the rest) and goes when the bus is removed. The first screenshot showed an empty band under a folded header that the height checks missed: the lanes grid gave every row a 96 px minimum, so the 26 px header took a full lane's row. Rows now size to their content; each lane sets its own 96 px, measured unchanged. Verified in Chromium (verify_folder.py): rows ordered folder, then its two tracks, then the unrouted one; folding hid the two tracks and kept the third, marked "(folded)" with aria-expanded false, with no undo step; unfolding restored them; routing the third track while folded made "3 tracks (folded)" and hid it; removing the bus removed the header and showed every lane; header 26 px with no gap to the next lane, open and folded; lanes 96 px with and without a bus; cross-track placement and group drags unchanged; production build passes; containment clean; screenshots inspected; no page errors.

### src/ui/inspector-pane.ts · EQ match from another clip (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: `fillEqm`, the `data-eqm` controls
- kind: explainer
- logged: v0.78.0 (in progress) · 2026-09-30

In the Effects section, a menu of the session's other clips (track and start) and Match EQ: the selected clip takes the tonal balance of the chosen clip's visible region (its trim point for its length), swapped in as one undo step; a result arriving after the selection moved is dropped, and with no other clip the button is disabled. Verified in Chromium (verify_eqmatch.py): the menu listed the bright clip; Match EQ gave new media in one undo step with the clip's start and length unchanged, and moved the band deviation from the reference from 8.54 dB to 0.38 dB; undo restored the original; production build passes; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · EQ match between Smart Tool ranges (coverage wave 10, completing RX-20)
- refers-to: src/ui/inspector-pane.ts :: `learned`, `rangeOnClip`, the `data-eqm="learn"` control, the Match EQ handler
- kind: explainer
- logged: v0.79.0 (in progress) · 2026-09-30

Learn and Apply: Learn reference takes the part of the current Smart Tool range that lies on its clip as the reference, listed first in the menu as "Learned range · from to s"; with a range active, Match EQ targets that range on its clip, measured there and replaced there only through set-range-media, and otherwise the whole selected clip as before. Verified in Chromium (verify_eqmatch_range.py) on one clip of 3 s bright then 3 s dark noise: a 0.5 to 2.5 s range learned and chosen; a 3.5 to 5.5 s range matched in one undo step, splitting the clip at 3.5 and 5.5 s; in the export the matched span sat 0.58 dB from the reference while the untouched dark tail stayed 8.48 dB from it; undo restored the single clip; the whole-clip match unchanged (8.54 to 0.38 dB); the row fits at 1024 px (screenshot); production build passes; containment clean; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/ui/mixer.ts, styles/shell.css · VCA mixing; Add bus and Add VCA (coverage wave 10)
- refers-to: src/engine/document.ts :: `Vca`, `SessionDoc.vcas`, `Track.vcaId`, `add-vca`, `remove-vca`, `assign-vca`, `set-vca-gain`, `set-vca-mute`; src/audio/player.ts :: `planClips` (the VCA gain and mute); src/ui/mixer.ts :: the `vca` strip kind, `.fw-strip-vca`, `.fw-mixer-bar`
- kind: warning-context
- logged: v0.80.0 (in progress) · 2026-09-30

VCA masters: a VCA is a fader and mute for a group of tracks with no audio through it; a member plays at its own fader (or automation) plus the VCA's gain and its own fader never moves; removing a VCA unassigns its members. The Mixer gets VCA strips (fader and mute, no pan or output) and a VCA menu on each track strip. Found while building it: nothing in the interface created buses (only tests dispatched add-bus), so the routing, bus effects and folders shipped in v0.76.0 and v0.77.0 were unreachable without one; the Mixer now has Add bus and Add VCA. The first build failed typechecking (the strip update read pan on a VCA) while the dev server ran the test; fixed and rerun on the built code. Verified in Chromium (verify_vca.py): Add bus and Add VCA made "Bus 1" and "VCA 1" with a strip; two tracks assigned through their menus; the VCA fader at -6.0 dB with the tracks' faders still 0; the export moved the members 6.00 dB and the unassigned track 0.00 dB; the VCA's mute silenced the members; production build passes; containment clean with the Mixer open; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, src/ui/mixer.ts, src/ui/media-pane.ts · the reachability audit: a control for every command
- refers-to: src/ui/inspector-pane.ts :: `[data-track-name]`, `[data-track-act="delete"]`, `[data-clip-act="crossfade"]`, `overlapOf`, `syncTrackControls`; src/ui/mixer.ts :: `.fw-strip-remove`; src/ui/media-pane.ts :: `.fw-media-place`
- kind: warning-context
- logged: v0.81.0 (in progress) · 2026-09-30

An audit of every command in the document's Command union against the frontend code that dispatches it found six that nothing in the interface issued: rename-track, remove-track, crossfade, remove-bus, remove-vca and add-clip. Each now has a control: the Inspector's track section has Name (committed on change or Enter) and Delete track (undoable); the clip section has Crossfade overlap, enabled only while the clip overlaps another on its track, making equal-power fades across the overlap; bus and VCA strips have Remove; each media item has Place on the selected clip's track at the playhead. The rerun audit finds all 51 commands dispatched. Two mistakes in the harness, not the app, were caught: a click on a clip that playback had scrolled under the media pane hit the pane, so the selection stayed and Delete removed the track the Inspector showed (the harness now checks the Inspector names the intended track first); and forcing a scroll slid a clip under the sticky track header, whose meter took the click (the harness now clicks right of the header). Verified in Chromium (verify_reach.py): rename to "Dialogue" in one step; k1 placed on Dialogue's track at 9 s in one step; Crossfade overlap enabled and giving 2 s equal-power fades on both clips in one step; with the Inspector showing "Track · k1", Delete removed k1 and undo restored it; Remove took the bus and VCA strips away; production build passes; no page errors.

### src/ui/inspector-pane.ts, src/ui/import.ts · tempo from the engine's route (AU-45 on real music)
- refers-to: src/ui/inspector-pane.ts :: `clipTempo`, `TEMPO_CONFIDENCE`, the Detect and Stretch to tempo actions; src/ui/import.ts :: `offerTempo`
- kind: explainer
- logged: v0.82.0 (in progress) · 2026-09-30

Detect, Stretch to tempo and tempo on import now ask the engine's tempo route (backend log) for a clip's visible region or the whole file; Detect and Stretch need confidence 0.1, import 0.2 (twice, as it acts unasked). The onset-comb functions estimateBpm and tempoEstimate are removed. Verified in Chromium: the owner's song imported with "its tempo, 126.9 BPM, is now the session tempo" and Detect read 126.9 at confidence 0.47 (verify_song_tempo.py); Detect read 100.0, 60.0 and 137.0 on the synthetic beats (verify_tempo.py, where the old method gave 99.9); tempo on import still set nothing for speech and irregular hits, 100.0 and 60.0 for the beats, kept an existing tempo, and undid (verify_import_tempo.py); Stretch to tempo went from exactly 100.0 to 110.0, 7.455 s = 8.2 x 100 / 110, and re-detected at 110.0 (109.4 before) (verify_stretch.py, whose expectation is updated from 99.9); production build passes; no page errors. No markup changed.

### src/engine/document.ts, src/ui/inspector-pane.ts, styles/workspace.css · Detect key and the session key (owner-requested)
- refers-to: src/engine/document.ts :: `SessionDoc.key`, `set-key`; src/ui/inspector-pane.ts :: the `detect-key` action, `[data-key-out]`; src/styles/workspace.css :: `.fw-key-readout`
- kind: explainer
- logged: v0.83.0 (in progress) · 2026-09-30

Detect key in the Quantize section asks the engine's key route (backend log) for the selected clip's visible region and sets the session key, name and Camelot code, as one undo step; the readout "Key F minor · 4A" follows the document; a confidence under 0.05 is called out as low. The reachability audit counts 52 commands, all with controls. Verified in Chromium (verify_key.py) on the owner's song: "Detected F minor (Camelot 4A), confidence 0.24", the readout and session key set in one undo step, undo clearing both; the Quantize section fits at 1024 px beside the imported tempo 126.9 (screenshot); production build passes; containment clean; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · Isolate sound (SAM-Audio, owner addition)
- refers-to: src/ui/inspector-pane.ts :: `[data-sam]`, `[data-sam-status]`, the Isolate handler; src/styles/workspace.css :: `.fw-sam-desc`, `.fw-sam-status`
- kind: warning-context
- logged: v0.84.0 (in progress) · 2026-09-30

Under Separate into stems: a description field, Isolate sound, and the engine's SAM-Audio status line. Isolate sends the selected clip's trimmed range and the description, and a Smart Tool range on that clip as where the sound occurs; the sound and everything else land on new tracks at the clip's start with the original muted, one undo step, as stems do; the engine's refusals reach the notice as written. A first screenshot showed the status prefix doubled ("SAM-Audio: SAM-Audio is not installed") and the placeholder cut off; the engine's messages are now self-contained and shown as they are, and the placeholder fits. Verified in Chromium (verify_isolate.py) to the model boundary with a stand-in of the package (not on real weights): with a 2 to 4 s range and "Man Speaking", the stand-in received "man speaking" and the anchor ("+", 2.0, 4.0); "jfk (man speaking)" and "jfk (without man speaking)" landed at the clip's start at its exact 528000 frames, the original muted, in one undo step; the target matched the original inside the range, was silent outside (-200 dB), and target plus residual reconstructed the original to -183 dB; undo restored the single track; as installed here the status line reads "SAM-Audio is not installed" with the install command; no overflow at 1024 px; production build passes; containment clean; screenshots inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · Isolate sound's span prediction and candidate re-ranking controls (FW-05, FW-07)
- refers-to: src/ui/inspector-pane.ts :: `[data-sam="predict"]`, `[data-sam="candidates"]`, the Isolate handler's `predict` and `candidates`; src/styles/workspace.css :: `.fw-sam-opt`
- kind: explainer
- logged: v0.85.0 (in progress) · 2026-09-30

Under the description row: Find where it occurs (a checkbox) sends `predict_spans` so the model locates the described sound from the text alone, and Candidates (1, 2, 4 or 8) sends `candidates` so the model separates that many and keeps the one its judge ranks best. Both were already parameters of `POST /api/media/{id}/isolate`; the route clamps candidates to 1 to 8 and the service ignores span prediction when a Smart Tool range supplies anchors, so the checkbox is sent as false whenever a range is on the clip and the notice says which applies ("finding where it occurs", "in the selected range", "from 4 candidates"). The row is static markup in the section; the handler still writes only the notice's text and the button's disabled state. Verified in Chromium with the stand-in of the package (not on real weights): the unchanged verify_isolate.py still passes with candidates 1 and predictSpans false by default; with no range, the box checked and 4 candidates, the stand-in received predictSpans true and candidates 4 for "car horn"; with a 2 to 4 s range and the box still checked, it received the anchor ("+", 2.0, 4.0), candidates 4 and predictSpans false; the controls kept their values across an undo; the row fits at 1024 px with no overflow (screenshot inspected); containment clean at three sizes; under 4x CPU throttling and a 150 ms, 200 kB/s network, a hard reload and an Isolate run mutated only the Isolate button's disabled attribute, the EQ match reference select's options (re-listed for the two new clips, a v0.78.0 path) and Match EQ's disabled attribute inside the section, and the only layout shift was that EQ match row changing height by 2 px (CLS 0.006), which Separate into stems has triggered the same way since v0.78.0 and is recorded in BUILD_NOTES; production build passes; no page errors.

### src/ui/record.ts, src/ui/shell.ts, styles/workspace.css · recording latency compensation (coverage wave 9; the v6 page's second build item)
- refers-to: src/ui/shell.ts :: the `[data-latency]` label in the transport; src/ui/record.ts :: `LATENCY_KEY`, `latencyMs`, `lag`, `drop`, `origin` in `finish`; src/styles/workspace.css :: `.fw-speed input[type="number"]`
- kind: explainer
- logged: v0.87.0 (in progress) · 2026-09-30

A take's samples reach the recorder late by the round trip from playback to the performer's ear to the microphone, so a take placed at the position recording started plays late by it. The transport's Latency field (0 to 500 ms, remembered in localStorage under formwav.recordLatencyMs, 0 by default so nothing changes until a value is typed) is that round trip as measured by the owner with a loopback (spikes/latency in the planning docs) or their interface's own figure; the container cannot measure it, so the field is a number and not an automatic estimate. On stop the take's origin is the start position minus the latency in samples at the take's rate; a take that would start before zero drops that many leading frames and starts at zero; the punch slice and the loop-take offsets are taken from the origin rather than the start position, so every recording mode shifts the same way; the notice says "shifted N ms earlier for latency". No source comment carries this: the empty catch blocks mark the field with data-storage="none" when storage is refused so the value still holds for the session. At 1024 px the label wraps the transport from two rows to three (79 to 97 px) because the timeline pane's first row has no room for a fourth item; at 1280 and 1440 the transport stays one row (69 px); a static wrap, recorded here. Verified in Chromium with the fake microphone (ad hoc checks, not a harness): at 0 ms a take from 1.0 s landed at 48000; at 100 ms it landed at 43200 with all its frames; at 100 ms from 0 it landed at 0 with 4800 frames dropped (67904 of 72704); each one undo step, one track added, the notice naming the shift; the field read 100 after a reload; verify_punch.py and verify_loop_takes.py unchanged and passing at the default; containment clean at three sizes; under 4x CPU and 150 ms, 200 kB/s network throttling a hard reload with 100 saved showed the field at 100 in every frame it existed (never 0) and CLS 0.00001; production build passes; no page errors.

### src/ui/shell.ts · MXF in the file picker (PT-30, partial)
- refers-to: src/ui/shell.ts :: the `.fw-file` input's accept list
- kind: explainer
- logged: v0.90.0 (in progress) · 2026-09-30

Field recorders and broadcast systems deliver MXF; the engine's import decodes any container ffmpeg reads, so the only gate was the picker's accept list, which now includes `.mxf` (drops and pastes never filtered). Verified on the engine: an MXF made from a 4 s tone with a black video stream and 24-bit PCM imported at 48 kHz, mono, 192000 frames, within 1.2e-7 of its WAV source (24-bit quantisation); production build passes. OMF and AAF stay open: they are edit-decision containers, not media, and need their own readers.

### src/ui/inspector-pane.ts · Fit to length (AA-09, partial)
- refers-to: src/ui/inspector-pane.ts :: the Quantize row's `[data-q="target"]` field and `[data-an="fit-length"]`, the `fit-length` branch of the analyze handler
- kind: explainer
- logged: v0.91.0 (in progress) · 2026-09-30

Remix re-arranges a music clip to a target duration; the honest piece formwav can do today is to re-time the clip to that duration keeping pitch, through the same rubberband stretch Stretch to tempo uses: the factor is the clip's length over the typed length, refused outside half to double, and set-clip-media scales the clip with its new media. Verified in Chromium: a 4.00 s tone fitted to 3 s became exactly 144000 frames and a 3.000 s clip in one undo step ("tone (Change tempo, rhythmic 33.3333%).wav"), undo restored 192000, 1 s was refused with "beyond the half to double the stretch allows", the row has no overflow at 1024 px (screenshot), no page errors. Stated: a stretch, not a remix; a beat-aware re-arrangement stays missing.

### src/ui/inputs.ts, src/ui/inspector-pane.ts, src/ui/record.ts, src/audio/recorder.ts · input device per track (AU-22, partial)
- refers-to: src/ui/inputs.ts :: `refreshInputs`, `trackInput`, `setTrackInput`, `onInputsChanged`; src/ui/inspector-pane.ts :: `[data-track-input]`, `fillInputs`, the `refresh-inputs` track action; src/ui/record.ts :: the `startRecording` call; src/audio/recorder.ts :: `startRecording`'s `deviceId`
- kind: explainer
- logged: v0.92.0 (in progress) · 2026-09-30

Device setup lists inputs, refreshes the list and follows the system's device changes; formwav's Track section now has an Input select (System default first, then every audio input the browser enumerates, labelled as the browser reports or "Input n" before permission), a Refresh inputs button that asks permission once so labels appear, and a devicechange listener that re-lists on its own. The choice is per track for this session (device ids are machine-specific, so it is not saved in the .fmw) and reaches getUserMedia as `deviceId: {exact}` when that track is armed and recorded. The select's options are rebuilt only when the device list's signature changes; selecting another track sets the value alone, so the option nodes survive. Verified in Chromium with the fake devices: the select listed System default, Fake Audio Input 1 and 2 before and after Refresh ("2 inputs listed"); choosing Input 2 for a track and recording sent that exact device id to getUserMedia and the take landed on the track; a second track showed System default until given Input 1, and each track showed its own choice when reselected; the option nodes were the same objects across selections; no overflow at 1024 px (screenshot); verify_punch.py unchanged and passing; production build passes; no page errors. Stated: no output device choice, no channel mapping inside a device (the browser gives the device's mix), no sample-rate choice, and ASIO is outside a browser.

### src/audio/recorder-worklet.ts, src/audio/recorder.ts, src/ui/inputs.ts, src/ui/inspector-pane.ts, src/ui/record.ts · input monitoring per track (AU-21, partial)
- refers-to: src/audio/recorder-worklet.ts :: the `monitor` message and the pass-through at the top of `process`; src/audio/recorder.ts :: `startRecording`'s `monitor`, `Recording.setMonitor`; src/ui/inputs.ts :: `trackMonitor`, `setTrackMonitor`, `onMonitorChanged`; src/ui/inspector-pane.ts :: `[data-track-monitor]`; src/ui/record.ts :: the `onMonitorChanged` forward
- kind: explainer
- logged: v0.92.0 (in progress) · 2026-09-30

Software playthrough and per-track input monitoring: the recorder worklet's output had always been silence (it never wrote its output buffers), so the pass-through is a copy of the input to the mono output, the two channels averaged for a stereo input, gated by a flag the main thread sets by message at start and whenever the Track section's Monitor input box changes for the armed track. The flag is per track for the session, like the input device. Verified in Chromium with the fake microphone, tapping the recorder node's output with an analyser: monitoring off gave 0 RMS through a take; on gave 0.353 (the fixture's level) through a take; unchecking the box during a take took the output from 0.354 to 0 within 700 ms while the take kept recording; three takes landed; no page errors; production build passes. Stated: through the speakers, with the round trip's latency and no feedback guard, so it is for headphones; no monitoring before recording starts (the worklet exists only during a take), no per-track monitor mix level.

### src/ui/shell.ts, styles/shell.css · the clock reads timecode (PT-26, partial)
- refers-to: src/ui/shell.ts :: `formatClock`'s `mode`, `CLOCK_MODES`, `cycleClock`, the `.fw-clock` output's role, tabindex and data-mode; src/styles/shell.css :: `.fw-clock` pointer, focus ring and the accent colour off the time mode
- kind: explainer
- logged: v0.93.0 (in progress) · 2026-09-30

Timecode for sound to picture: the transport clock now cycles on click, Enter or Space between time (HH:MM:SS.mmm) and non-drop timecode at 24, 25 and 30 frames (HH:MM:SS:FF, the frame being the whole frames into the second), remembered in localStorage under formwav.clockMode and coloured with the accent off the time mode so a timecode reading is never mistaken for one in milliseconds. The output element keeps its type (its width is fixed at 13ch so neither reading shifts the transport) and gains role="button" and tabindex. Verified in Chromium at 1 h 1 m 1.25 s: 01:01:01.250, then 01:01:01:06 at 24, 01:01:01:06 at 25, 01:01:01:07 at 30 (6, 6.25 and 7.5 frames floored), back to time; the mode read tc24 after a reload; Enter cycled to tc25; the clock stayed 104 px wide; no page errors; production build passes. Stated: non-drop only (no 29.97 drop-frame), no picture, no timecode offset for the session start, and the ruler still reads seconds.

### src/audio/player.ts, src/ui/lanes.ts · sessions of 512 and 2048 tracks measured (PT-01, PT-02); playback at scale is the open finding
- refers-to: src/audio/player.ts :: the per-clip preparation at play; src/audio/player-worklet.ts :: the mix callback; src/ui/lanes.ts :: one lane node per track
- kind: warning-context
- logged: v0.93.0 · 2026-09-30

Protocol, in Chromium at 1280 px on the one-core container: import a 4 s tone, dispatch one `batch` of N-1 `import-media` commands for the same media (each on a new track at i times a spread), then time the dispatch, sample 30 requestAnimationFrame gaps, press Space and poll the transport position every 250 ms for 2 s, and undo the batch. Findings: 512 tracks built in 250 ms and 2048 in 1140 ms, one undo step each; frames 15.8 to 16.1 ms mean (29 ms worst) with every lane in the DOM (512 lane nodes, 49152 px of lanes); undo of 2048 in 103 ms; heap 10 MB. Playback: with a 2400-sample spread (80 clips overlapping) play started 12 ms after Space but the transport read 48128 samples 1.5 s later (1.0 s of audio) and the page stopped answering keys, so the stop had to wait; with a 192000-sample spread (clips end to end, a 34-minute session) the transport never reported playing within 20 s of Space, while the overlapping layout started at once, so the track count is not the cause; suspects are per-clip media preparation before play and the ruler and lanes drawing a 34-minute session. `setTransport({playing: true})` only sets state; the transport control starts the audio, which the protocol learned the hard way. No code changed for this entry; the rows are partial on the half that holds, and BUILD_NOTES carries the investigation as Next step 2.

### src/ui/meter.ts · the track meters scan the DOM once, not once per track per level event (playback at scale, first cause)
- refers-to: src/ui/meter.ts :: `mountTrackMeters`'s `barsByKey`, `collect`, the childList MutationObserver
- kind: warning-context
- logged: v0.94.0 (in progress) · 2026-09-30

The v0.93.0 finding, traced: with 512 tracks the main thread blocked about one second on every level event (rAF gaps of 950 to 1130 ms, continuously, from the moment playback started). Each level event ran one `host.querySelectorAll` per track, each a scan of the whole document for that track's two bars, so 512 scans of a 512-lane DOM per event. The bars are now collected in one scan into a map by data-key and the map is dropped whenever any childList mutation lands under the host (a lane or strip added or removed), so a level event costs a map lookup per track. Verified with the v0.93.0 protocol: 512 tracks laid end to end (a 34-minute session) now start playing 161 ms after Space and hold real time (ratio 0.99 over 2 s, trail 17408 to 113664 samples) where before playback never reported within 20 s; 512 tracks with 80 clips overlapping start in 165 ms at 0.99 where before the transport advanced 1.0 s of audio in 1.5 s; the stop answers in 0.5 to 0.7 s; verify_track_meters.py unchanged and passing (bars rise to scaleX(0.9), fall to scaleX(0) after stop, boxes fixed, CLS 0). Stated: 2048 tracks still hang the page past 250 s in both layouts and the kernel logs "sched: RT throttling activated", so the next cost is per clip per audio block in the core (render::mix looks up every clip's source and pan gains before the overlap test, meter_tracks visits every clip again) and the worklet's per-track peak report, 2048 pairs per level event; unmeasured which dominates.

### src/audio/player.ts · position reports coalesced to the latest, at most every 16 ms
- refers-to: src/audio/player.ts :: `latestPosition`, `positionTimer`, `handlePosition`, the `position` branch of `onReply`
- kind: warning-context
- logged: v0.95.0 (in progress) · 2026-10-01

The worklet reports position and peaks every 1024 samples, 47 times a second, and each report ran every transport subscriber (clock, playhead with its layout reads, transcript follow, recording) and the meters for every track. Once a report cost more than 21 ms, which it does with 2048 tracks, the message queue grew without bound, and the page's responsiveness decayed as playback ran (at v0.95.0's first 2048 measurement each poll took longer than the last: 0.5, 1.2, 2, 2.8, 4, 5.8 s). The handler now keeps only the latest position report and handles it at most once every 16 ms through a timer (setTimeout rather than requestAnimationFrame so a hidden tab still advances); ended and loaded replies pass straight through. Verified with the v0.93.0 protocol: 2048 tracks with 80 clips overlapping poll at a steady 300 ms with no decay, play starts 129 ms after Space, the position tracks wall time (118784 samples at 2.63 s, the start included) and the stop answers in 1.3 s; 512 with 80 overlapping starts in 68 ms at 0.98 with the stop in 210 ms; verify_track_meters.py (162 bar writes over the run, bars to scaleX(0) after stop, CLS 0), verify_play.py (seek, home, click, ran to the end) and verify_loop.py unchanged and passing; production build passes. Stated: the clock and playhead now move at most 60 times a second instead of 47 reports a second, which is the same or better in practice; the peaks shown are the latest report's, not a maximum over the reports dropped, so a transient shorter than 16 ms can escape a lane meter.

### src/ui/inspector-pane.ts · Learn noise (AU-B15, RX-16, AP-01 and the denoiser rows)
- refers-to: src/ui/inspector-pane.ts :: `[data-fx="learn-noise"]`, `learnsNoise`, `learnedNoise`, `noiseParams`, the `withNoise` notice in the apply handler
- kind: explainer
- logged: v0.96.0 (in progress) · 2026-10-01

Learn noise takes the Smart Tool range on a clip (through the same `rangeOnClip` as the EQ match reference) as media seconds, keeps it for that clip's media, and with no range forgets it. Every apply of an effect the catalogue marks `learnsNoise` on that media sends the range as `noise_from` and `noise_to`, whole clip or range alike (the range path renders the whole media and slices the range, so the profile applies to both), and the notice ends "with the learned noise profile"; other effects and other clips ignore it. Verified in Chromium on the noisy fixture: with no range the button asks for one; a drag from 0.2 to 1.8 s then Learn noise reported the range; Denoise at -40 applied in one undo step as "noisy (Denoise -40dB).wav" with the profile named, the clip's 288000 frames kept, the learned range at -45.1 dB and the click still at 192000; Amplify afterwards applied without the profile; no page errors; production build passes.

### src/engine/document.ts, src/ui/inspector-pane.ts · feathered range renders (RX-65)
- refers-to: src/engine/document.ts :: `set-range-media`'s `feather`, the `fl` and `fr` overlaps; src/ui/inspector-pane.ts :: `[data-feather]`, the range branch of the apply handler
- kind: explainer
- logged: v0.97.0 (in progress) · 2026-10-01

Range renders feather the edges of a selection so a repair is not heard switching on and off. A range render had placed three hard-edged pieces (original, rendered, original); with a feather the rendered piece now extends into its neighbours by the feather on each side (clamped to half the range and to each neighbour's length) with a fade in and a fade out of that length, and the neighbours take the matching fade out and fade in, so the overlap is an equal-gain crossfade (linear fades, which sum to unity for the same material, as the engine already mixes overlapping clips on a track). The Effects row's Feather field (0 to 500 ms, 0 by default so nothing changes until typed, which also keeps verify_range_fx.py's geometry) rides on the command in samples and the notice says "feathered N ms". Verified in Chromium on the tone fixture with Amplify -6 dB on 0.5 to 1.5 s and a 100 ms feather: the pieces read 0 to 0.5 s with a 4800-sample fade out, 0.4 to 1.6 s with 4800 in and out on the amplified media, and 1.5 to 4.0 s with 4800 in; the mix rendered through the engine ramps 0.423, 0.339, 0.255 into the -6 dB piece (0.213) and back out symmetrically, with 0.424 untouched on both sides; one undo step restored the single clip; verify_range_fx.py unchanged and passing at 0; production build passes; no page errors. Stated: a feather in time for the selections formwav has (time ranges); a drawn spectral selection and its frequency feather are AA-05's.

### src/audio/player.ts · a 30-minute file measured (AP-05)
- refers-to: src/audio/player.ts :: `loadInto` (the whole file fetched and decoded into the core before play)
- kind: warning-context
- logged: v0.97.0 · 2026-10-01

A 30-minute stereo 16-bit WAV (345 MB, 86400000 frames) imported through the engine in 1.6 s (WAV passes through; the level-0 peaks took 1.1 s) and through the interface to a drawn lane in 3.0 s with two frame gaps over 100 ms (121 and 131 ms); from 25 minutes in, playback held real time (1501.6 s after 1.5 s), but it started 5.4 s after Space because the player fetches and decodes the whole file into the core's memory before the first play, with three main-thread stalls of 569, 969 and 957 ms while the bytes crossed to the worklet. No code changed for this entry. Stated: files are held whole in the audio core, so the first play of a long file waits for all of it and a file larger than memory cannot play; streaming the core's sources from disk is the fix, and a two-hour file is unmeasured.

### src/ui/import.ts, src/ui/shell.ts · an .aup project zip opens as the session
- refers-to: src/ui/import.ts :: the `.zip` and `.aup` branches of `importOne`; src/ui/shell.ts :: the picker's accept list
- kind: explainer
- logged: v0.99.0 (in progress) · 2026-10-01

The picker takes .aup and .zip; a bare .aup is refused with what to zip, and a .zip goes to the engine's .aup import, which replaces the session (after a confirm when one is open) and the notice names the tracks, clips and labels and that envelopes and effects were not carried over. Verified in Chromium: the hand-built project zip opened as two lanes and two clips at 44.1 kHz with the marker and region, and a WAV imported afterwards still landed; no page errors; production build passes.

### src/engine/document.ts, src/audio/player-worklet.ts, src/audio/player.ts, src/ui/inspector-pane.ts, styles/workspace.css · a time track: playback speed over session time (AU-36)
- refers-to: src/engine/document.ts :: `TimePoint`, `SessionDoc.timeTrack`, the `set-time-track` command; src/audio/player-worklet.ts :: `curve`, `curveAt`, the `clips` handler's curve, `renderAtSpeed`'s `step`, the step in `process`; src/audio/player.ts :: `timeTrack` in `sendPlan`; src/ui/inspector-pane.ts :: the Master section's `[data-tt]` fields and buttons, their sync in `renderRtfx`; src/styles/workspace.css :: `.fw-sam-opt input[type="number"]`
- kind: explainer
- logged: v1.0.0 (in progress) · 2026-10-01

The time track warps playback speed over time, pitch following. The session document gains `timeTrack`, points of (sample position, speed 0.25 to 4), linear between points and held outside them, set by one undoable command (an empty list clears it) and saved with the session. The plan sent to the worklet carries the points; the worklet's existing varispeed path (a read buffer the core refills 128 samples at a time, read with linear interpolation) now takes its step per block from the transport speed times the curve at the core's position, and stays on that path for as long as a curve is set so the read buffer is never stale when the curve passes 1. The Master section's Time track row sets two points, Start % at 0 and End % at the end of the session's audio, and Clear removes them; an opened session's curve fills the fields unless one is being typed in. Verified in Chromium with a 4 s tone, polling the transport every 20 ms: without a time track the session played in 3.964 s with local speeds 0.99 to 1.01; with 100 to 200% it played in 2.720 s against 2.686 from the integral of 1/(1 + p/L), with local speeds 1.108, 1.358, 1.635 and 1.827 at 0.57, 1.5, 2.51 and 3.4 s against 1.142, 1.374, 1.627 and 1.851 on the line; one undo step to set; Clear removed it and undo restored it; a session saved through the engine with a 100 to 150% curve reopened with it; verify_play.py (its offline bounce still nulls to 0.0), verify_loop.py and verify_track_meters.py unchanged and passing; the reachability audit counts 53 commands, all dispatched; no page errors. The fields share the option labels' number style, and so does the Feather field from v0.97.0, which had shipped with the browser's default number input because its row was not looked at in a screenshot then; it now reads 56 px with a 6 px radius like the transport's. Stated: playback only, as the notice says (the engine's export and the offline bounce do not apply the curve), two points from the Inspector rather than a drawn envelope, linear only.

### src/ui/inspector-pane.ts, styles/workspace.css · Draw samples, a magnifier at single-sample zoom (AU-13, partial)
- refers-to: src/ui/inspector-pane.ts :: the clip section's `[data-draw]` canvas and `[data-draw-act]` buttons, `drawing`, `stroke`, `paintDraw`, `pointAt`, `drawRun`; src/styles/workspace.css :: `.fw-draw-canvas`
- kind: explainer
- logged: v1.1.0 (in progress) · 2026-10-01

Drawing samples in the track needs single-sample zoom; formwav's lanes stop at 16 times their base zoom (30 samples per pixel at 48 kHz) and draw from peaks, so the honest way to single samples here is a magnifier: the clip section's Draw samples canvas shows 256 samples of the selected clip around the playhead (the original as a grey line, the drawn values in the accent colour with a point per sample), a drag sets the samples under the pointer and every sample between successive pointer positions by straight-line interpolation, and Apply sends only the changed run to the engine and swaps the clip's media in one undo step; Revert puts the window back. The canvas is mount-time markup drawn with the theme's tokens; the runtime writes are the canvas pixels, the buttons' disabled state and the notice. Verified in Chromium at 1024 px with the 4 s tone: the window opened at 47872 to 48127 around a 1.0 s playhead; a level stroke at a quarter of the height from a quarter of the width plus one pixel to three quarters enabled Apply and Revert, and Apply wrote exactly 128 samples, 47937 to 48064, every one at 0.5, the other 191872 samples byte-identical, in one undo step as "a440 (drawn).wav" with the clip's length kept; undo restored the original media; the clip section has no overflow (screenshot) and containment is clean at three sizes; 53 commands all dispatched; no page errors. Corrected before commit: the first wording said "one every 2 pixels", true of the canvas's 512-pixel buffer but not of the screen, where 256 samples span about 250 CSS pixels at 1024; the notice and label now say each sample is a point. Stated: a magnifier beside the lanes rather than drawing in the lane, one channel shown and every channel written alike, 256 samples at a time.

### src/ui/lanes.ts, src/ui/inspector-pane.ts · a marquee spectral selection in the spectrogram view (AA-05, AU-31, PT-28)
- refers-to: src/ui/lanes.ts :: `range.band`, `rangeBand`, the vertical fields of `rangeDrag`, the band in the range drag, the band box in `drawRange`, the spectral zone in the hover and pointerdown; src/ui/inspector-pane.ts :: `syncBand`, the `band` in the inspector's `range`
- kind: explainer
- logged: v1.2.0 (in progress) · 2026-10-01

A marquee selects a rectangle of time and frequency in the spectrogram. With the Spectrogram view on, the whole clip body (not only its upper half) now starts a selection, and a drag with any height selects frequencies as well: the spectrogram image is ffmpeg's showspectrumpic with a linear frequency axis, 0 Hz at the bottom and the file's Nyquist at the top, stretched to the clip's height, so a pixel's frequency is Nyquist times one minus its fraction of the height; the range event carries the band, the range box covers only the selected frequencies, and Band gain's From and To follow the band when it is chosen or when the band changes. In the waveform view nothing changes (the upper half selects, the lower half moves). Verified in Chromium at 1280 px with a 4 s mix of 500 Hz and 5 kHz tones: a drag from (1 s, 7 kHz) to (3 s, 3 kHz) gave the range 1.000 to 3.000 s with the band 3000 to 7000 Hz, the box 62 px down an 87 px clip and 15 px tall (the arithmetic gives 61.6 and 14.5), Band gain's sliders read From 3000 Hz and To 7000 Hz, and Apply rendered in one undo step; in the engine's render of the mix the 5 kHz tone inside 1.3 to 2.7 s fell exactly 30 dB below the 500 Hz tone, and both tones before and after the range were unchanged; the box is visible over the 5 kHz line (screenshot); verify_range_fx.py, verify_band_gain.py and verify_spectrogram_view.py unchanged and passing; no page errors. Stated: clips cannot be dragged to move while the spectrogram view is on (the body selects there; toggle back to move them), only Band gain takes the band, the axis is linear (a log axis would favour speech), and lasso and paintbrush selections are not built.

### src/ui/inspector-pane.ts · Learn room tone and Fill with room tone (RX-01, partial)
- refers-to: src/ui/inspector-pane.ts :: the `[data-rt]` row under Learn noise, `roomTone`, the learn and fill handlers
- kind: explainer
- logged: v1.3.0 (in progress) · 2026-10-01

Two buttons beside the effects: Learn room tone keeps the Smart Tool range on a clip (through `rangeOnClip`, at least 0.1 s) as the background to match, and Fill with room tone sends the learned range and the current range to the engine and swaps the clip's media in one undo step; filling before learning, or without a range, says what to do. Verified in Chromium at 1024 px with the gap fixture: Fill before Learn named the missing step; a drag over 0.2 to 1.8 s and Learn reported the range; a drag over 2.5 to 3.5 s and Fill changed exactly the samples from 2.500 to 3.500 s in one undo step ("gap (room tone).wav", the clip's 288000 frames kept), the gap's middle at -39.88 dB against -39.77 learned; undo restored the media; the row wraps to two lines in the narrow Inspector with no overflow (screenshot); 53 commands all dispatched; no page errors. Stated: fills inside a clip (a gap between clips has no media to fill), from one learned range at a time.

### src/ui/arm.ts, src/ui/record.ts, src/audio/recorder.ts, src/audio/recorder-worklet.ts, src/ui/lanes.ts, src/ui/meter.ts · several armed tracks record at once (PT-03, partial)
- refers-to: src/ui/arm.ts :: the armed and recording sets, `armedTracks`, `isArmed`, `toggleArmed`, `isRecording`, `addRecordingTrack`; src/ui/record.ts :: `laneLevel`, `extras`, the extra recorders in `begin`, `place` in `finish`; src/audio/recorder.ts :: `Take.startFrame`, `startRecording`'s `playAlong`; src/audio/recorder-worklet.ts :: `firstFrame` from `currentFrame`, the `stopped` reply's `startFrame`; src/ui/lanes.ts :: Shift-click on the arm button; src/ui/meter.ts :: `isRecording`
- kind: explainer
- logged: v1.4.0 (in progress) · 2026-10-01

Many inputs record at once. A click on a track's arm button still arms that track alone; Shift-click adds or removes tracks, and every armed track records from its own input (AU-22's choice) in the same take. The first armed track is the primary: punch, loop takes, the transport's input meter and the notice follow it, and each other armed track gets its own recorder (opened without restarting playback) and its own lane meter. Each recorder's worklet notes the audio context frame of its first captured sample (`currentFrame`), and on stop every take is placed by the same rules as before (latency, punch slicing, loop takes) at the primary's position plus its start-frame difference, all in one undo step. Verified in Chromium: three tracks armed with one click and two Shift-clicks all showed pressed; recording from the fake microphone said "Recording into tone and 2 more tracks", saving said "Recorded Take 1.wav and 2 more takes on their tracks" in one undo step, and the extra takes sat 512 and 896 samples after the first, their inputs having opened that much later; with one live source of irregular clicks shared by every input (a WebAudio stream in place of getUserMedia) and all inputs opening together, the clicks of the three takes landed on the same timeline samples; with the second and third inputs opening 40 and 80 ms late, their takes were placed 1920 and 5760 samples later and their clicks landed 96 samples (2 ms) early, the same for both, which points at a fresh input source's own start-up rather than the start-frame arithmetic; verify_punch.py, verify_loop_takes.py and verify_record.py unchanged and passing through the refactored placement; 53 commands all dispatched; no page errors. Stated: a 2 ms residue between inputs opened at different moments (sharing one stream per device would remove it for tracks on the same device), no channel mapping inside a device, three inputs measured rather than 256, and punch and loop takes apply alike to every armed track.

### src/ui/record.ts · correction to the v1.4.0 alignment claim
- refers-to: the v1.4.0 entry above, "several armed tracks record at once"
- kind: warning-context
- logged: v1.4.0 · 2026-10-01

The entry above says three takes opened together put every click on the same timeline sample. That held in one run; the release gate's run of the same test on the fresh 1.4.0 engine put the second and third tracks' clicks 32 samples late and 64 samples early against the first (every click of each track offset alike, so a constant per input). Alignment by capture start frame therefore lands within about 1.3 ms for inputs opened together and within 2 ms (96 samples) for inputs opened 40 and 80 ms late, varying between runs; the cause is consistent with each input opening its own stream, whose start carries some jitter. The fix in BUILD_NOTES (one stream per device shared by its tracks) stands, and the record now says "within about 2 ms".

### src/ui/projects.ts, src/io/projects-client.ts, styles/workspace.css · session lists show thumbnails
- refers-to: src/ui/projects.ts :: the `.fw-session-thumb` image in the Open popover's rows (`updateRow`) and in the Recent sessions rows; src/io/projects-client.ts :: `ProjectSummary.thumbnail`; src/styles/workspace.css :: `.fw-session-thumb`
- kind: explainer
- logged: v1.5.0 (in progress) · 2026-10-01

Both session lists show a saved session's thumbnail above its name when it has one: the image has its 160 by 32 box reserved by width and height attributes and CSS, so nothing moves when it loads, and its address carries the session's revision so a new save shows a new picture. Verified in Chromium at 1280 px: the Open list showed thumbnails for the two sessions saved with them (each loaded at 320 by 64 into a 160-pixel box) and none for a session saved before this release, and the picture of the room-tone session shows the tone, the two bursts and the gap (screenshot); no page errors; production build passes.

### src/ui/transcript-pane.ts, styles/workspace.css · word timing and word gaps in the transcript (DS-11, partial)
- refers-to: src/ui/transcript-pane.ts :: `.fw-word-timing` and its `[data-wt]` fields, the timing fill in `paintSelection`, the `timing` and `gap` actions; src/styles/workspace.css :: `.fw-word-timing`
- kind: explainer
- logged: v1.6.0 (in progress) · 2026-10-01

With exactly one word selected, the transcript's actions show its Start, End and Gap after in session seconds (filled from the word, never into a field being typed in). Set word timing converts the new edges to the media's seconds and sends them to the engine, which keeps the word between its neighbours; the pane takes the returned transcript and re-derives the words. Set gap shortens the gap to the next word to the typed length by removing its middle with the same ripple cut the other transcript edits use, so everything after closes up in one undo step. Verified in Chromium with the seeded four-burst transcript: selecting word one showed 0.520, 0.850 and 0.550; setting 0.5 to 0.9 stored those times and said so; deleting the word then left nothing between 0.45 and 0.95 s (peak 0.0) and moved the later bursts' onsets from 1.4, 3.0 and 3.6 to 1.0, 2.6 and 3.2 s, one undo step; the gap after word two read 1.100, and setting 0.3 removed 0.800 s so its next burst started at 1.8 s, 0.3 s after the word's end, one undo step. The first screenshot caught the row cramped (three-decimal values clipped in 56-pixel fields, "s" running into "End"), so the row became a wrapping flex row with 76-pixel fields; at 1024 px every field shows its value whole and nothing overflows. Stated: typed edges rather than dragged ones, gaps can be shortened but not lengthened, one word at a time.

### src/ui/inspector-pane.ts · Stretch selected clips, several clips across tracks re-timed together (AA-10, partial)
- refers-to: src/ui/inspector-pane.ts :: the Quantize section's `[data-q="stretch"]` field and `[data-an="stretch-group"]` button, the `stretch-group` action
- kind: explainer
- logged: v1.7.0 (in progress) · 2026-10-01

Several clips on several tracks stretch together. The Quantize section gains a Stretch field (50 to 200% of length) and Stretch selected clips: every selected clip (the lanes' selection, or the one clip) is re-timed by the same stretch render Fit to length uses (rubberband, pitch kept), each media rendered once even when several clips share it, and every clip's start is scaled from the earliest selected start by the same ratio, so material that lined up across tracks still lines up; the media swaps (which scale each clip's trim, length and fades) and the moves go in one batch, one undo step. Verified in Chromium at 1280 px with two clips on two tracks, 20 ms 1 kHz bursts at 0.5, 1.0 and 1.5 s of a 2 s clip placed at 1.0 s and at 0.25 and 0.75 s of a 1 s clip placed at 2.0 s, selected with a click and a Shift-click and stretched to 150%: the first clip stayed at 1.0 s and became 3.0 s long, the second moved to 2.5 s and became 1.5 s; the rendered mix's onsets read 1.742, 2.491, 2.866, 3.241 and 3.616 s against 1.75, 2.5, 2.875, 3.25 and 3.625 by the arithmetic, every one 8 to 9 ms early, so the spacing across both tracks matched (0.749, 0.375, 0.375, 0.375 s against 0.75 and three 0.375s) and the common offset is the stretch's smearing of each burst's attack; one undo step; undo restored the original onsets; the row looked at in a screenshot; no page errors; production build passes. Stated: a typed percentage rather than dragging a clip edge, positions scaled from the earliest selected clip, and a stretched clip that now overlaps an unselected one on its track is left overlapping.

### src/ui/media-pane.ts · the Library section in the Media pane (DS-14, partial)
- refers-to: src/ui/media-pane.ts :: the `.fw-library` section, `libPick`, `libAudio`, its click handler
- kind: explainer
- logged: v1.8.0 (in progress) · 2026-10-01

Under Generate, a Library section lists the engine's stock sounds by category (optgroups built once when the list arrives), Preview plays an item through an audio element from the preview route, and Add on a new track stores the item at the session's rate and imports it at the playhead in one undo step. Verified in Chromium at 1024 px: 10 sounds in five groups; the bell's preview loaded, played and ended at 3.0 s; the reference tone added as one new track named for it in one undo step; the section has no overflow (screenshot; a long name truncates in the closed select as native selects do, whole in its list) and hides when another tab of the pane is shown; no page errors; production build passes.

### src/engine/document.ts, src/audio/player.ts, src/ui/inspector-pane.ts, src/ui/lanes.ts, styles/workspace.css · clip gain envelopes (AU-12)
- refers-to: src/engine/document.ts :: `Clip.envelope`, the `set-clip-envelope` command, the envelope scaled in `set-clip-media`; src/audio/player.ts :: `envGain`, `clipEnvelope`, the clip's `gainPoints`; src/ui/inspector-pane.ts :: the Gain envelope rows, the `env-add` and `env-clear` actions, the `[data-env-out]` readout; src/ui/lanes.ts :: the `.fw-clip-env` overlay; src/styles/workspace.css :: `.fw-clip-env`
- kind: explainer
- logged: v1.9.0 (in progress) · 2026-10-01

The clip volume envelope. A clip gains `envelope`, dB points at its media's frames, so they stay with the audio through trims and splits (a split copies them; each half reads its own span) and a time stretch scales them with the rest of the clip; one command sets them, undoable, an empty list clears them. Playback feeds the core's per-clip gain envelope with them, merged with the track's volume automation as the export planner does. The Inspector's clip section adds a point at the playhead at a typed level, clears the envelope, and lists the points in session seconds; the lane draws the envelope over the clip as an SVG polyline in clip-relative units (written only when the points change, hidden without them), so zooming never redraws it. Verified in Chromium at 1280 px with a 4 s 440 Hz tone: three points at 1, 2 and 3 s of 0, -20 and 0 dB added in three undo steps and read back "3 points: 1.00 s at 0 dB, 2.00 s at -20 dB, 3.00 s at 0 dB"; the playback bounce through the worklet read 0, -0.10, -5.18, -18.19, -5.18 and 0 dB in the same windows as the export, both on the line's values; the overlay drew the V at 142.9, 428.6 and 714.3 of 1000 across the trimmed clip (screenshot); Clear removed the envelope and hid the overlay; verify_play.py's bounce still nulls (0.0, 0.0); 54 commands all dispatched; no page errors. Stated: points are added at the playhead and cleared together, not dragged on the lane; the overlay draws straight lines in the lane's dB scale while the gain between points is linear in amplitude.

### src/ui/lanes.ts · Alt-drag on a clip's right edge stretches it and its selection (AU-02)
- refers-to: src/ui/lanes.ts :: `Gesture.stretch`, the stretch drag's bounds in the pointerdown, `stretchGroup`, the stretch branch in `commit`
- kind: explainer
- logged: v1.10.0 (in progress) · 2026-10-01

A clip stretches by dragging its edge. A drag on a clip's right edge with Alt held is a stretch rather than a trim: it draws like a trim, bounded to half and double the clip's length (the stretch render's range) and never rippling, and on release every clip in the gesture (the grabbed clip and the clips selected with it) is re-timed by the dropped ratio with the pitch-keeping render Fit to length uses, each media rendered once, the media swaps in one batch, each clip keeping its start; a plain drag still trims. Verified in Chromium at 1280 px with a 2 s clip of 20 ms bursts at 0.5, 1.0 and 1.5 s: an Alt-drag of half the clip's width made it 3.0 s with the bursts at 0.742, 1.491 and 2.241 s (0.75, 1.5 and 2.25 by the arithmetic, each attack 8 to 9 ms early alike as the stretch smears it) in one undo step, and undo restored 2.0 s and the original onsets; an Alt-drag of twice the width clamped at 200% (4.0 s); a plain drag of a quarter width trimmed the clip to 1.5 s on the same media; with two clips on two tracks selected, one Alt-drag on the first's edge made them 3.0 and 1.5 s together, their five onsets spaced as the arithmetic says, one undo step; no page errors; production build passes. Stated: Alt held at the start of the drag (no distinct cursor), the right edge only, and each clip keeps its start (Stretch selected clips in the Inspector scales positions instead).

### src/audio/player.ts, src/audio/player-worklet.ts · long files stream in, the playhead's pieces first (AP-05)
- refers-to: src/audio/player.ts :: `StreamInfo`, `streamInfo`, `streamProgress`, `StreamCtl`, `focusStream`, `pump`, `streamInto`, `focusAll`, the streamed branch of `loadInto`, the focus in `play` and `seek`; src/audio/player-worklet.ts :: the `alloc` and `write` messages
- kind: explainer
- logged: v1.11.0 (in progress) · 2026-10-01

A file over a minute no longer has to arrive whole before it plays. The worklet allocates it silent at full length; the player fetches 2 s pieces from the engine's PCM route and posts each (a short copy on the audio thread); a queue per streamed file starts at the frame under the playhead, and play and seek refocus it so the two pieces at the playhead come first, play waiting only for those; the rest fills ahead, then behind; a fill that fails says so in the console rather than stopping silently. The offline bounce streams too but waits for every piece. Verified in Chromium: a 70 s stereo file streamed and bounced matched the engine's export to 0.0 at 3371 points; a 10-minute file played from 7:30 started 94 ms after Space with no frame gap over 100 ms and filled all 300 pieces; the 30-minute file played from 25:00 started 445 ms after Space (5.4 s before this release) with one 135 ms frame gap (three of about a second before), held real time (1501.98 s two seconds after 1500), and filled all 900 pieces in 44 s; verify_play.py's bounce still nulls (0.0, 0.0), verify_loop.py and verify_automation_parity.py pass; no warnings, no page errors. Stated: the file is still held whole in the audio core once filled, so a file larger than memory still cannot play, and a seek into a stretch not yet filled plays silence until its pieces arrive (they are fetched next).

### src/audio/recorder.ts · one stream and one source per input device for a take (PT-03)
- refers-to: src/audio/recorder.ts :: `inputs`, `openInput`, `closeInput`, the shared source in `startRecording`, `source.disconnect(node)` on stop
- kind: explainer
- logged: v1.12.0 (in progress) · 2026-10-01

v1.4.0 aligned several armed tracks by the frame each capture began, but every track opened its own stream, and separate streams of one device start with their own jitter, so takes landed up to 2 ms apart. A take now opens each device once: tracks recording from the same device share one stream and one source node, each with its own recorder node, so they hear the very same samples and the start-frame arithmetic is exact by construction; a stopping recorder detaches only its own node, and the last one closes the device. Verified in Chromium with one live click source standing in for the microphone and the second and third recorders' start messages held back 40 and 80 ms: three tracks on the default device made one getUserMedia call, the late takes were placed 2944 and 4864 samples after the first, and all 13 clicks of each take fell on the same timeline samples, 0 apart (v1.4.0's separate streams had them 32 to 96 samples apart); verify_punch.py, verify_loop_takes.py and verify_record.py unchanged and passing; no page errors; production build passes. Stated: tracks on different devices still open their own streams, so alignment between devices keeps that jitter (one clock across devices needs an aggregate device or the interface's own driver); two tracks monitoring the same device sum their monitoring.

### src/ui/inspector-pane.ts · the marquee fills Spot heal's box; time controls to the millisecond (AA-06)
- refers-to: src/ui/inspector-pane.ts :: `syncBand` (Spot heal's From and To from the marquee's time on its clip, in the media's seconds), the effect control builder's type and step for long time spans
- kind: explainer
- logged: v1.14.0 (in progress) · 2026-10-01

A marquee drawn in the spectrogram view already filled Band gain's Low and High; it now fills Spot heal's too, with From and To converted from the session's time to the clip's media seconds, whether the marquee comes before or after the effect is picked. The first run showed From and To both reading 2: every effect control was a slider stepped by 1 over spans wider than 20, so 1.98 and 2.24 seconds rounded to a zero-width box and the heal changed nothing (66.36 to 66.34 dB); a time control over a span longer than a minute is now a number field stepped to the millisecond, and every other control keeps its slider and step (Reverb's size and decay, Truncate silence and De-reverb's reverb time unchanged). Verified in Chromium at 1280 px: a marquee from 1.98 to 2.24 s and 2400 to 3600 Hz over a 3 kHz whistle filled 2400, 3600, 1.98 and 2.24; Apply took the whistle's band in the mix from 66.36 to -0.47 dB (the clean band 4.25), left the 440 Hz tone at 61.92 dB and everything outside 1.90 to 2.32 s unchanged to 0.0, in one undo step; the controls looked at in a screenshot; no page errors; production build passes.

### src/ui/inspector-pane.ts · De-bleed in the clip section, the leaking clip chosen from the overlapping ones (RX-05)
- refers-to: src/ui/inspector-pane.ts :: the De-bleed rows (`[data-debleed]`), the overlapping-clip list in `render` (rebuilt only when its signature changes), the `debleed` clip action; the clip action handler is now async
- kind: explainer
- logged: v1.16.0 (in progress) · 2026-10-01

With one clip selected, the Inspector lists the clips on other tracks that overlap it as the possible source of a leak; De-bleed sends the chosen one as the reference, with the offset taken from where both clips sit in the session (the reference's frame at this clip's media frame 0) and the Amount, and swaps this clip's media for the result in one undo step. Verified in Chromium at 1280 px with a backing track on track 1 from 0 s and the recording it bled into on track 2 at 0.5 s: the backing's clip was the only choice offered, De-bleed took the bleed left in the recording from -15.81 to -48.78 dB relative to the line it carries (the engine's own figure), one undo step, the clip's start (0.5 s) and length (8 s) unchanged; the row looked at in a screenshot; 54 commands all dispatched; no page errors; production build passes.

### src/ui/inspector-pane.ts · a time selection fills Dialogue contour's span (RX-17)
- refers-to: src/ui/inspector-pane.ts :: `syncBand` (Dialogue contour takes From and To from any range, no frequency band needed)
- kind: explainer
- logged: v1.18.0 (in progress) · 2026-10-01

A range drawn on a clip (its upper half, in the waveform view) fills Dialogue contour's From and To in the clip's media seconds, the way a marquee fills Spot heal's box, so a ramp or a flattening applies to the selected phrase. Verified in Chromium at 1280 px: a range from 1.8 to 2.95 s filled 1.8 and 2.95; with Shift at end 3 semitones, Apply reported 1.15 s of the clip in one undo step; the five syllables outside the span stayed at 0 cents and the three inside rose 72, 166 and 257 cents against 55, 149 and 243 by the ramp; no page errors. (The first attempt drew the range 30% down the clip, onto the gain line at 25%, and adjusted the gain instead: no range was made, which a capture of the range events showed; the drag was moved to 10%.)

### index.html, src/main.ts, src/styles/*, src/vendor/formvis/themes.ts · the family's design tokens, shared (owner decision, Sprint D)
- refers-to: index.html (the suite theme boot), src/main.ts (the sheet order, the theme module, the reveal), src/styles/tokens.css, fonts.css, light-mode.css, scrollbars.css (vendored), shell.css and workspace.css (re-pointed rules), src/vendor/formvis/themes.ts; retired: src/styles/family.css, src/vendor/nodemode/tokens.css and themes.ts
- kind: explainer
- logged: v1.19.0 (in progress) · 2026-10-01

The owner asked for the form family's tokens shared 100%. Following the formai-design-lang pack (token-keeper, formwav crosswalk): formvis's tokens.css replaces the NodeMode base, its app block replaced by formwav's (the suite's audio-clip green and its shade, and the toast band); formvis's themes.ts (the same 14 profiles and storage key, plus accent intensity and the appearance generation) replaces the NodeMode module; fonts.css (Inter and JetBrains Mono through @fontsource, OFL), light-mode.css and scrollbars.css (last) come in verbatim; family.css, which painted formcut's palette over every surface with :root:root, is deleted and its two component rules move into workspace.css on the suite's names (clips on --fw-audio, lane beds alternating --surface-1 and --surface-2); two raw status colours read --ok and --danger, a pressed mute button's text --text-on-accent, the export dialog's backdrop --bg-scrim; the boot is the suite boot (studio default, 14 profiles, appearance generation 3), byte for byte the pack's asset. A throttled run (4x CPU, slow network) found a new 0.0195 layout shift: the reveal waited on document.fonts.ready, which resolved before Inter had been requested, so the app showed in a fallback face and shifted when Inter arrived; the reveal now loads the suite's faces by name first, at most 4 s. Verified: the pack's audit 22 FAIL and 13 WARN before, 0 FAIL and 0 WARN after; its parity inventory 7 of 32 recipe markers before (coverage 22), 14 of 32 after (coverage 44), the token section 8 of 8; the crosswalk report shows no legacy --fc-* name read anywhere; under 4x CPU and a slow network every sampled frame from 0.4 s was the studio ground #111111, and two throttled loads after the reveal fix shifted 0 with Inter loaded at reveal; verify_record.py (CLS 0.0061 as before), verify_loop.py and verify_play.py (bounce null 0.0) pass; production build passes. The pack's parity_inventory.py could not run (a double-escaped regex, an unterminated group), so it was run from a copy with that one pattern fixed. Stated: the shell, panels, controls and overlays recipes (18 of 32 markers) are the later passes; the Media pane's Library section sits on a different surface from the Generate card, for the panels pass.

### src/ui/terminal-pane.ts, src/main.ts, styles/workspace.css, vite.config.ts · the embedded terminal dock (owner decision, Sprint D)
- refers-to: src/ui/terminal-pane.ts :: `mountTerminal`; src/main.ts :: its mount after Loudness; src/styles/workspace.css :: `.fw-term*`; vite.config.ts :: `ws: true` on both /api proxies; package.json :: @xterm/xterm 5.5 and @xterm/addon-fit (MIT)
- kind: explainer
- logged: v1.20.0 (in progress) · 2026-10-01

A Terminal button in the title bar (between Loudness and Export) and Ctrl+` open a dock between the lanes and the transport holding xterm.js on the engine's shell socket; the dock and the terminal are made once, on first open, and only hidden after that, so the shell keeps running while it is closed; Restart opens a new shell; its colours (surface, text, the accent cursor) and the mono face come from the suite's tokens. The dev and preview proxies now pass WebSockets. Verified in Chromium at 1280 px: Ctrl+` opened it; typed `tty; stty size; echo formwav-$((6*7))` returned /dev/pts/0, "15 87" (exactly xterm's 15 rows and 87 columns after fitting) and formwav-42; the dock took its height from the lanes (605 to 297 px) and the transport stayed at 724; a Space typed into the terminal did not start playback; a variable set before Hide was still there after showing it again, and gone after Restart; no shell left running after the page closed; the dock looked at in a screenshot; the design-language audit stays at 0 FAIL, 0 WARN; 54 commands all dispatched; no page errors. (The first check typed "\n" inside the text and read nothing back; pressed as the Enter key, every keystroke arrived, so the fault was the test's.)

### src/ui/agent-pane.ts, src/main.ts, styles/workspace.css · the in-app agent: actions and controls on the open session (owner decision, Sprint D; DS-02)
- refers-to: src/ui/agent-pane.ts :: `mountAgent`, its 16 tools, the run loop, Stop and Undo run; src/main.ts :: its mount after the terminal; src/styles/workspace.css :: `.fw-agent*`
- kind: explainer
- logged: v1.22.0 (in progress) · 2026-10-01

An Agent button (title bar: Loudness, Agent, Terminal, Export) opens a dock with an instruction box; Run (or Ctrl+Enter) sends it with a system prompt and 16 tool definitions through /api/agent/step, runs the model's tool calls here and returns their results, up to twelve turns, until the model stops. Tools: get_session (tracks, clips and markers with their ids, in seconds and dB), analyze_clip, list_effects, apply_effect_to_clip (the engine processes, the clip's media is swapped), track gain, pan, mute, solo and rename, clip move, split, remove, gain and fades, add_marker, set_loop; every action is one session command, so undoable; inputs are checked (ranges, ids, a split inside its clip, fades that fit) and a failure goes back to the model as an error result to recover from. Stop ends a run between turns; Undo run takes back every change the last run made. The log is append-only (you, says, did, failed). Verified in Chromium against a recording stand-in of the Messages API (no key here): on an imported clip, the run read the session, then set the track to -6 dB, the clip's fades to 0.5 and 1 s and a marker at 1 s using the ids it was given, logging each step and the summary; the session read back exactly those values (undo depth 1 to 4); Undo run restored gain 0, no fades, no markers, depth 1; no page errors; the dock looked at in a screenshot; the design audit stays at 0 FAIL, 0 WARN. Stated: the stand-in proves the loop, the tool execution and the chaining by id, not a model's judgement; a model's error recovery path (an is_error result) was not exercised by the script.

### src/ui/agent-pane.ts · the agent's recovery from a failed tool call, verified
- refers-to: src/ui/agent-pane.ts :: the run loop's error result (`is_error`) and its log entry
- kind: explainer
- logged: v1.22.0 (in progress) · 2026-10-01

The entry above left the error path unexercised; the stand-in gained a scenario whose first action names a track that does not exist. Verified in Chromium: started with Ctrl+Enter, the log showed the failed call with its reason ("No track with id no-such-track; call get_session for the ids."), the stand-in received exactly that text as an is_error tool result, retried with the id from the session it had read, and the track ended at -3 dB; the failed call changed nothing, so the run held one change and Undo run would take back exactly that one.

### src/ui/models-pane.ts, src/main.ts, styles/workspace.css · the Models section: speech, sound effects, music and dubbing through the provider layer (DS-13)
- refers-to: src/ui/models-pane.ts :: `mountModelsPane`; src/main.ts :: its mount after the Media pane; src/styles/workspace.css :: `.fw-models*`
- kind: explainer
- logged: v1.23.0 (in progress) · 2026-10-01

A Models section after the Library offers what the engine's /api/providers reports: ElevenLabs speech in a listed voice, sound effects and dubbing a clip; fal's ACE-Step presets and any other fal model with its input as JSON; the open-weight models listed in backend/models/local_models.json. A provider without its key or file is listed but off, naming what it needs. Each result lands on a new track at the playhead; a dub lands at its clip's start, so it lines up with what it translates. The section and every field row are built once; choosing a kind only hides and shows rows, and the clip picker is refilled only when the clips have changed. Verified in Chromium at 1280 px against the engine on the recording stand-in: seven choices on and the local one off with its file named; speech with a voice from the list, an ACE-Step 1.5 song and a Spanish dub of a clip moved to 2 s each landed on a new track, the dub at 2.0 s; no page errors; the design audit stays at 0 FAIL, 0 WARN. Stated: no provider was really called (the first real calls are the owner's), and voice-matched regeneration of transcript words (DS-09) is the next step on this layer.

### src/ui/models-pane.ts · Regenerate the selected words in their speaker's voice (DS-09)
- refers-to: src/ui/models-pane.ts :: the `el-regen` choice, `regenTarget`, the prefill in `show`, the go handler's done result
- kind: explainer
- logged: v1.24.0 (in progress) · 2026-10-01

A Models choice regenerates the time selection: the clip under it is found, the selection turned into seconds of its source, the engine regenerates, and one batch command swaps the clip's media, lengthens or shortens the clip by the difference and moves the track's later clips by the same amount, so the edit is one undo step and nothing after it overlaps. When the clip has a transcript, choosing it fills the text with the words under the selection to edit. Verified in Chromium on the recording stand-in: 0.6 to 1.2 s of a 3.0 s clip replaced with 2.0 s, the clip 4.38 s on the regenerated media, the later clip moved from 4.0 to 5.38 s, the state saying so, one undo step restoring both; with a fixture transcript (removed after) the box filled with exactly the words inside the selection ("two three", not the neighbours ending at 0.5 s and starting at 1.3 s); without one it says to type the words. No page errors; the design audit at 0 FAIL, 0 WARN.

### src/main.ts · every change the app asks of the engine carries x-formwav-local
- refers-to: src/main.ts :: the fetch wrapper installed before the first mount
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

The engine now refuses a POST, PUT, PATCH or DELETE under /api without `x-formwav-local: 1` (backend app/core/security.py). Every request this app makes goes through fetch (no XMLHttpRequest, beacons or event streams: 60 call sites), so one wrapper installed before any mount adds the header to its own origin's mutating /api requests and leaves everything else untouched. Verified: the record and play harnesses (imports, edits, renders through the app) pass, the record harness's layout shift 0.0036, no page errors.

### src/ui/projects.ts · the session the desktop app was asked to open
- refers-to: src/ui/projects.ts :: the ?open= handling at the end of `mountProjects`
- kind: explainer
- logged: v1.25.0 (in progress) · 2026-10-01

The desktop shell passes a .fmw the user opened with formwav as ?open=<path> on the page's address (the page has no Tauri API); at start-up the address is cleaned (a reload does not open it again) and the file opened through the engine, loaded like a saved session with its name in the name field. Verified in Chromium: opened with ?open= on an exported session, its Music and Voice tracks loaded, the name field read "My Take (2)" (the right copy, as a different file had the plain name), the address came back to /, no page errors.

### src/ui/latency-probe.ts, public/latency-probe.html, src/ui/shell.ts · spike A's latency probe inside the app
- refers-to: src/ui/latency-probe.ts :: `mountLatencyProbe`; public/latency-probe.html (the sidecar's spikes/latency probe, copied unchanged); src/ui/shell.ts :: the Latency field's tooltip; src/main.ts :: its mount after recording
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

Spike A measures the webview's output and round-trip latency on the owner's machines, which the build container cannot (no audio device), and its probe lived only in the planning docs, out of reach of the desktop app (no address bar). It now ships in the interface (public/latency-probe.html, so the desktop engine serves it from its own origin) and a Measure button beside the transport's Latency field opens it in a dialog (the iframe allowed the microphone and the clipboard); the round trip it reports goes in that field, which already moves each take back by that much. Verified in Chromium: the button beside the field; the dialog opened with the probe (its title and three steps); its first step read this browser's context (AudioWorklet available, 44.1 kHz, base latency 10 ms, output latency 0 ms); the dialog closed; a desktop-mode engine served the probe (200); no page errors; the design audit at 0 FAIL, 0 WARN. The round trip itself needs a loopback cable and a microphone, the owner's.

### (no code) · third-party plugins in the Inspector, through the effect catalogue
- refers-to: the Inspector's clip effect picker, which lists /api/effects (backend app/services/plugins.py adds the "Plugins" group)
- kind: explainer
- logged: v1.28.0 (in progress) · 2026-10-02

Plugins reach the interface without interface code: the engine lists installed CLAP and VST3 plugins as the catalogue's "Plugins" group, and every picker built from the catalogue offers them. Verified in Chromium with a test folder on FORMWAV_PLUGIN_PATH: the clip's effect picker showed the group (formwav test gain (CLAP), Airwindows Consolidated (VST3) and (CLAP)); choosing the test gain and "Apply to this clip" swapped the clip to "phrase (formwav test gain).wav"; no page errors. The master effects picker does not offer them, rightly: master effects run live in the browser's audio worklet, where a native plugin cannot, which waits for native playback.

### src/ui/shell.ts, media-pane.ts, models-pane.ts · every section in exactly one tab, every tab scrolling (owner's report)
- refers-to: src/ui/shell.ts :: the Create tab and its panel; src/ui/media-pane.ts :: Generate and Library placed in the Create panel, their `data-panel="media"` tags removed; src/ui/models-pane.ts :: the offline state and retry
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

The owner's screenshot showed the Models section under the Transcript tab with every field visible and a column that would not scroll. The left pane's tabs switch elements marked data-panel, and its bodies scroll (flex 1, min-block-size 0, overflow auto), but Generate and Library had been inserted after the media panel as siblings and tagged data-panel="media" so the switcher would hide them, and Models was inserted after Library untagged: under any other tab they (or Models alone) stacked outside every scrolling body, squeezed the real panel toward nothing, and could not themselves scroll. Generate, Library and Models now live in a Create tab's panel (making new audio, apart from the media pool), untagged, so they scroll with it; Models, until the engine lists its models, shows one line and no fields, and asks again every 4 s. Verified in Chromium at the owner's window (1288 by 683 CSS pixels): engine offline, Media showed only the media list, Transcript only its own content, Create the Models note with no fields; engine running, Create showed Generate, Library and Models, its content (543 px) overflowing its body (499 px) and a wheel scrolling it by 44 px; no page errors; the design audit at 0 FAIL, 0 WARN. A first attempt hid Generate and Library on their new tab through the stale data-panel tags; the computed styles of the chain showed it.

### src/styles/frame.css, src/ui/status-bar.ts, src/ui/shell.ts · the frame, first pass (owner: "a UI for audio")
- refers-to: src/styles/frame.css (new, loaded last); src/ui/status-bar.ts :: `mountStatusBar`; src/ui/shell.ts :: the status bar row, the engine chip moved into it; src/styles/workspace.css :: the island pass's tab rule
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

The owner judged the interface a better-looking shell around the same faults, rightly: v1.19.0 took the suite's tokens but not its frame. This pass lays formvis's frame onto formwav from formai-design-lang's shell-composer (frame-anatomy, app-frame-maps) and media-adapter (audio-surfaces): a 40 px title bar on its gradient with the session as a centred document title and Export the one primary; the columns on hairlines (no gutters, no outer radius, no islands) with 6 px resizers; pane heads as group heads with chip tabs that wrap rather than hide; the options row (the timeline's modes and views) on surface-0; the transport row on surface-1 that never wraps (a container query drops the Speed and Latency labels, keeping the latency's unit, and the detailed LUFS readout before anything would clip); a full-width 28 px status bar with fixed slots (the engine chip, moved from the title bar, the sample rate, tracks and clips, the session's length, and hints naming only keys the handlers bind: Space, S, Delete, Cmd or Ctrl+Z; an R for recording was dropped when the handlers showed none); media rows with a compact place button. Verified in Chromium at the owner's window (1288 by 683) with a session: every region where the frame puts it, all five tabs inside the pane with Create reachable, the transport one 44 px row, no page overflow, no page errors. Corrected after the commit: this entry first said the design audit read 0 FAIL, 0 WARN; at e78838d it read 3 FAIL, 1 WARN (the record and playhead colours declared in frame.css rather than the token sheet, and a literal white on the armed record button), fixed in the next commit (the colours moved into the token sheet's app block, the glyph on --text-on-accent), after which it reads 0 FAIL, 0 WARN. Found on the way: two misses read from computed styles rather than guessed (the island pass's more specific tab rule kept one hidden-scrolling row; it is fixed where it lives); the transport still overflows its row by 12 px at this width. Not yet done, and next: the lanes and track headers (media-adapter's lane bed and header cards), the options row's mixed contents (edit modes beside view toggles), the tool rail, the File menu, the dock for Mixer, Terminal and Agent, and the side column's strip.

### src/styles/surfaces.css, shell.css · the lane bed and track headers as cards (media-adapter audio-surfaces)
- refers-to: src/styles/surfaces.css (new, after frame.css); src/styles/shell.css :: `.fw-auto-toggle`, `.fw-lane-ms`, `.fw-lane-meter` (their absolute corner placement and fixed width removed); src/styles/tokens.css app block
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

Lanes alternate surface-1 and surface-2 on line-1 hairlines (nth-child of .fw-lane, since the playhead and ruler share the parent), with surface-0 below the last; a track header is a card with the audio colour bar at its left, the name (13 px, 600) over its facts, then one row of the lane's meter, mute and solo, and the automation toggle, the arm a 20 px circle at the top right that fills record red with a ring when armed; header toggles are bordered squares, accent-soft when on; clips take radius 6; the playhead is the now-line red, never the accent. Meters stay solid --ok because their bars are scaled with transforms (no layout per frame), and a gradient on a scaled bar would stretch with the level; the track instead marks where the meter's own scale (linear from -60 dBFS) puts -12 dB (80 percent) and -3 dB (95 percent). Verified in Chromium at 1288 by 683 with three tracks, lane 2 muted and lane 3 armed, playing: the beds alternate, the header's seven elements do not overlap, the takes toggle stays hidden on tracks without takes, mute and arm show their states, the meters move, no page errors; the design audit at 0 FAIL, 0 WARN (read after this edit, not assumed). Three of my own faults found by measuring rather than looking: the toggle rule's display overrode the hidden attribute (the takes toggle showed everywhere); older rules placed mute and solo and the automation toggle absolutely in the corner, outside any grid (removed where they live); and a grid area named auto, which CSS reads as automatic placement (renamed curve).

### src/ui/file-menu.ts, shell.ts, grid.ts, mixer.ts, spectrogram-view.ts, workspace-layout.ts, projects.ts · the File menu and the options row's groups
- refers-to: src/ui/file-menu.ts :: `mountFileMenu`; src/ui/shell.ts :: the File menu (Save, Open, Import moved in intact) and the options row's Edit and View groups; grid.ts, mixer.ts, spectrogram-view.ts, workspace-layout.ts :: each appends to its group, falling back to the row; src/ui/projects.ts :: the Open list's anchor; src/styles/frame.css :: groups, the menu, icon-only chips on a narrow stage
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

Save, Open and Import were loose title-bar buttons; they are now a File menu (shell-composer's menu button, its pop in the suite's glass by the cv-menu class), the same buttons moved in so every handler bound by data-action is untouched; ⌘S and ⌘O shown because projects.ts binds them, Import without a shortcut because none exists. The options row mixed editing options with views; it is now an Edit group (Grid, Shuffle, Spot, Punch, Bars) and a View group (Mixer, Spectrogram, Layout) pushed right, each named by a small label; on a narrow stage chips with an icon show only the icon, keeping their titles. No tool rail was added: a rail of tools that do not change the pointer's behaviour would be decoration; it waits for tool modes in the lanes. Verified in Chromium at 1288 by 683: the groups hold the right chips; File opens in glass with three items; Escape (after a click on File, the focus on the button) and an outside click close it; arrow keys move between items; Save from the menu saved ("Saved Untitled session"), Import opened the file chooser, Open showed the projects list, which first appeared at the window's corner (it measured the Open item after the menu had closed) and now anchors under File from the menu and from Ctrl+O alike; the options row overflows by 0 px with nothing off screen, labels returning on a wide window; no page errors; the design audit read 0 FAIL, 0 WARN before committing (36f61fc). This sentence was wrongly rewritten by a sed edit meant for the dock entry (be27af9) and restored by hand.

### src/ui/dock.ts · Mixer, Terminal and Agent in one tabbed bottom dock
- refers-to: src/ui/dock.ts :: `mountDock`; src/main.ts (mounted after the three panels exist); src/styles/frame.css :: the dock
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

Mixer, Terminal and Agent each inserted a panel above the transport and stacked over the lanes when opened together. They now share one dock (panel-architect's dock group): a group-head tab strip, the open panel filling the body, a close button, the height dragged from the top edge (140 px to 75 percent of the pane, kept in localStorage). The modules are unchanged: each panel's hidden flag stays the truth and each keeps its toggle (the View chip, the title-bar buttons, the X key); the dock adopts the panels and watches the flag, so a panel that opens takes the dock and any other open panel is hidden the way its module hides it (the flag and its toggle's pressed state, nothing torn down, so a terminal session survives a tab switch), and a tab opens its panel through the module's own toggle (the terminal refits and takes focus). The close glyph is formvis's close icon, not a symbol. Verified in Chromium at 1288 by 683 with a session: the Mixer chip, the Terminal and Agent buttons and the tabs each opened the dock on the right tab with exactly one panel open and one toggle pressed; text typed into the terminal before a switch to Agent was still in its buffer after switching back; the X key (focus outside any text field; in the terminal it rightly types) moved the dock from Agent to Mixer and then closed it; dragging the grip up 80 px took it from 260 to 340 px, kept after a reload; the close button closed it and released every toggle; the mixer scrolls inside the dock at the default height (its 373 px of strips in 225 px), so every strip's buttons can be reached; no page errors. Corrected after the commit: the design audit read 0 FAIL, 1 WARN at 479fda4 (a raw z-index 1 on the dock grip), fixed in the next commit with var(--z-raised); it then reads 0 FAIL, 0 WARN.

### src/ui/workspace-layout.ts, shell.ts, workspace.css, frame.css · the Inspector's strip, and the selected track's header
- refers-to: src/ui/workspace-layout.ts :: the hidden Inspector's width (the strip, not 0); src/ui/shell.ts :: `.fw-insp-strip`; src/styles/workspace.css :: the collapsed pane no longer display:none; src/styles/frame.css :: the strip and the selected header
- kind: explainer
- logged: v1.28.0 (in progress) · 2026-10-02

A hidden Inspector vanished entirely; it now stays a 46 px strip (shell-composer's side column collapsed to its strip) with an expand button and its name set vertically, so it can be found again where it was. The expand button carries the column toggle's class and data-pane, so the existing delegated handler serves it and the state stays one. The track holding the selected clip takes the active card (an accent wash over its header, the name in accent ink), by :has() on the clip's aria-selected; formwav has no separate track selection, the Inspector's Track section follows the selected clip too. Verified in Chromium at 1288 by 683 with three tracks: collapsing took the Inspector from 284 to 46 px and the stage from 752 to 996; the strip showed its button and label; it stayed collapsed after a reload; its button and the title-bar toggle each restored 284 px; selecting a clip on lane 2 lit only lane 2's header; no page errors; the design audit 0 FAIL, 0 WARN before committing.

### src/ui/inspector-pane.ts · a plugin's own controls in the Inspector, sending only what the user moved (AU-29)
- refers-to: src/ui/inspector-pane.ts :: the picker's plugin listener (GET /api/plugins/params on first pick, drawn after Tail), `Control.step`, the touched mark, `currentParams`; backend app/services/plugins.py :: the fine step for continuous parameters
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

Picking a plugin in the Inspector fetches its parameters once and draws them as sliders after Tail with the same rows as any effect, named as the plugin names them. Measured from the interface on Airwindows Consolidated (its Galactic): moving Dry/Wet to 0 and applying sent only Tail and that value, and the clip's new audio matched the source within -143.7 dB; applying with nothing moved sent only Tail and gave the plugin's own default sound (+0.6 dB relative, as through the API). A first version sent every slider's value: sliders round a default to their step (0.1 for a 0-to-1 range), so an untouched parameter of Consolidated arrived changed and the output was 37 dB away from the dry signal instead of 144; a plugin's parameter is now sent only once the user has moved it, controls may carry their own step, and continuous plugin parameters get a thousandth of their range. Found by capturing the request the Inspector sent, after the API path had passed.

### src/audio/native-node.ts, player.ts, src/ui/output-select.ts · native output from the interface (in progress)
- refers-to: src/audio/native-node.ts :: `NativeNode`, `NativePort`, `nativeChoice`, `setOutputChoice`; src/audio/player.ts :: `makeNode` (native when chosen), `loadInto` (a source named by media id), `Player.resetOutput`; src/ui/output-select.ts :: `mountOutputSelect`; src/ui/shell.ts :: the status bar's Output slot; src/main.ts
- kind: warning-context
- logged: v1.30.0 (in progress) · 2026-10-02

The Player talks to its node only through `port`, so native output is a stand-in node whose port is the engine's native WebSocket: worklet messages pass through, the worklet's start-up and sample transfers are dropped (the engine holds the core and the media), a source is named by media id, and replies come back in the worklet's shapes ("loaded" given the worklet's id). The status bar's Output lists Browser and, when the engine has native output, the system default and each device; switching drops the current output (Player.resetOutput) without touching the session. Verified in Chromium at 1288 by 683: the menu listed Browser, the system default and the null device; choosing the null device and playing the phrase opened /api/audio/native through the dev server, the transport's position followed the native reports to the end (144000), and the master meter saw 0.6286, the file's own peak; no page errors. Open, stated: at the end the transport still reads playing, because the stand-in infers the worklet's "ended" from a report going from playing to stopped, and on the null device the whole phrase plays inside one 33 ms report interval so no playing report is ever seen; the fix is an ended flag set by the audio callback and reported once. The switch back to Browser was not verified: the test pressed Space while the Output menu held focus.

### native/formwav-dsp/src/native.rs, src/audio/native-node.ts · native output's end of play, and the switch back verified
- refers-to: native/formwav-dsp/src/native.rs :: `Shared.ended` (set by the callback at the end, cleared by play, carried once by `report`); src/audio/native-node.ts :: "ended" from the report's mark
- kind: warning-context
- logged: v1.30.0 (in progress) · 2026-10-02

The previous entry's open issue: the stand-in inferred the worklet's "ended" from a report going from playing to stopped, which never happened when playback finished inside one report interval. The audio callback now marks the end itself, play clears a stale mark, and the next report carries it once ("ended": true); the stand-in turns that into the worklet's "ended" reply, on which the Player stops the transport. Verified in Chromium at 1288 by 683: on native output the phrase played to the end and the transport read stopped at 144000; switched back to Browser (focus moved off the Output menu before Space, the previous test's fault), the worklet played in real time (24576 frames in half a second at 48 kHz) and no new native socket opened; the choice cleared to the browser; no page errors; the core's tests pass.

### src/ui/import.ts, shell.ts · a MIDI file imported and played by the built-in instrument
- refers-to: src/ui/import.ts :: the .mid and .midi branch (POST /api/midi/import at the session's rate); src/ui/shell.ts :: the file input accepts .mid and .midi
- kind: explainer
- logged: v1.31.0 (in progress) · 2026-10-02

Importing a .mid file sends it to the engine, which reads its notes and renders them with the built-in instrument, and the rendering is placed like any imported audio; the notice names the note count and tempo. The notes are not yet kept in the document (a note field on clips, drawing them in the lane and re-rendering after edits come next), so for now the clip is its rendering. Verified in Chromium at 1288 by 683 with a hand-built MIDI file: the notice read "Imported test-song.mid: 3 notes at 120 BPM, played by the built-in instrument", the clip held the 4.2 s rendering, playing it moved the master meter to 0.266, no page errors; the design and reach audits clean before committing.

### src/engine/document.ts, src/ui/lanes.ts, import.ts · note clips keep their notes and draw them
- refers-to: src/engine/document.ts :: `NoteEvent`, `Clip.notes`, `import-media` (notes); src/ui/import.ts :: the MIDI branch passes the notes in frames; src/ui/lanes.ts :: `paint` (the piano roll for a note clip, the waveform skipped)
- kind: explainer
- logged: v1.31.0 (in progress) · 2026-10-02

A note clip keeps its notes in the document as the truth its media renders: frames in the clip's media (the rendering starts at media frame 0), the convention of the clip volume envelope, so notes stay with the audio through trims and moves; importing a MIDI file converts the engine's seconds at the media's rate. The lane draws a note clip's notes as a small piano roll (at least an octave tall, opacity by velocity, mapped through the clip's trim) instead of its rendering's waveform; audio clips draw as before. Verified in Chromium at 1288 by 683: the hand-built MIDI file's clip held A4 at 0 for 24000 frames, C5 at 24000 and E5 at 144000 (3.0 s) for 48000, with their velocities; the screenshot shows the three notes rising at their times against the ruler while an audio clip below draws its waveform; saved under a unique name, the stored project read back from the engine holds the three notes (a first save hit an existing name and was declined by the test browser's dialog); no page errors; the audits clean before committing.

### src/engine/document.ts, src/audio/notes.ts · editing notes: set-clip-notes and renderNotes (the piano roll's foundation)
- refers-to: src/engine/document.ts :: the `set-clip-notes` command and its reducer case; src/audio/notes.ts :: `renderNotes`; src/main.ts :: the dev-only test handle exposes renderNotes
- kind: explainer
- logged: v1.31.0 (in progress) · 2026-10-02

Before an editor can change notes, a change must be one undoable step: `set-clip-notes` replaces a note clip's notes and its rendering together (the clip untrimmed and as long as the new rendering, release included), and `renderNotes` sends edited notes to POST /api/midi/render in seconds at the clip media's own rate and dispatches the command with the new media. Verified in Chromium: on the imported MIDI clip, changing the first note from A4 to G4 through renderNotes gave the clip the new notes and new media (4.2 s), whose strongest partial over that note's time is 393.3 Hz (G4 is 392.0, within the 3.3 Hz resolution of a 0.3 s window); one undo restored both the A4 note and the original media; no page errors; the audits clean before committing. Next: the piano-roll editor itself (PT-17) on these two pieces.

### src/ui/piano-roll.ts, dock.ts · the note editor (PT-17)
- refers-to: src/ui/piano-roll.ts :: `mountPianoRoll` (canvas, layout, draw, hit, the pointer gestures, Delete); src/ui/dock.ts :: the Notes tab; src/main.ts (mounted before the dock adopts panels); src/styles/frame.css :: the editor in the dock
- kind: warning-context
- logged: v1.31.0 (in progress) · 2026-10-02

The selected note clip's notes on a canvas in the dock's Notes tab (toggled by the View group's Notes chip): a keyboard column naming the C rows, a pitch-by-time grid with beat lines (120 BPM until formwav has a tempo map), notes at velocity opacity with the selected in the accent, and a velocity lane. Click empty grid adds a note (the snap's length, velocity 100), drag a note moves it, its right edge resizes it, a velocity bar drags, Delete removes the selection; a drag only redraws, and letting go commits through renderNotes, so each gesture is one re-render and one undo step. Snap is off, 1/4, 1/8 or 1/16 of a beat. The canvas publishes its geometry as data attributes so tests aim real pointer events at notes. Verified in Chromium at 1288 by 683 on the imported MIDI clip: dragging A4 up two rows made B4; dragging C5's right edge one beat made it 48000 frames from 24000; a click on empty grid added E4 at 2.0 s as a 1/16 note at velocity 100; dragging E5's velocity bar down took it from 127 to 6; clicking the first note and pressing Delete removed it; one undo restored it; no page errors; the audits clean before committing. Found on the way: the editor's Delete bubbled to the lanes' window handler, which deleted the whole selected clip; the editor now stops Delete and Backspace from leaving it while it has focus.

### src/ui/piano-roll.ts, src/engine/document.ts · the note editor's zoom and quantize; superseded renders out of the media list
- refers-to: src/ui/piano-roll.ts :: `layout` (explicit row height and scrolled top pitch, fit otherwise), `zoom`, `quantize`, the wheel and Q, the head's Zoom −, Zoom +, Fit and Quantize; src/engine/document.ts :: `set-clip-notes` drops the replaced rendering from the media map when no clip plays it
- kind: explainer
- logged: v1.32.0 (in progress) · 2026-10-02

The editor fitted every note into the dock's height, about 6 px a row at the default; Ctrl or Cmd with the wheel, or Zoom − and +, now set the row height (4 to 28 px), the wheel scrolls pitch, and Fit returns to fitting. Quantize (or Q) moves the selected notes' starts, or all notes' when none is selected, to the snap grid as one gesture, and does nothing when snap is off or nothing would move. Each edit used to leave its predecessor's rendering in the media list (five entries after five edits); set-clip-notes now drops the replaced rendering once no clip plays it, and undo restores it with the whole earlier session. Verified in Chromium at 1288 by 683: fit read 24 rows of 5.96 px; two zoom-ins 15 rows of 9.31 px (1.25 squared); two wheel steps up scrolled the bottom row from 70 to 74; Fit restored 24 rows of 5.96 px; a note placed at 61500 with snap off quantized at 1/16 to 60000 with the other notes unmoved, and undo put it back at 61500; after three renders the media list held one entry, and undo restored the earlier notes with one entry; no page errors; the audits clean before committing. A first quantize check placed its note on the grid already (60000) and proved nothing; it was repeated off the grid.

### src/audio/notes.ts, src/ui/piano-roll.ts · MIDI export (AU-37)
- refers-to: src/audio/notes.ts :: `midiFile` (SMF format 0); src/ui/piano-roll.ts :: the Export MIDI button
- kind: explainer
- logged: v1.32.0 (in progress) · 2026-10-02

A note clip leaves formwav as a Standard MIDI File: format 0, one track, 480 ticks per quarter at 120 BPM (formwav has no tempo map yet), frames converted to ticks at the media's rate, note-offs ordered before note-ons at the same tick so a repeated pitch retriggers; the Notes editor's Export MIDI downloads it the way the audio export delivers its file. Verified by a round trip through independent code: the clip edited (A4 to G4 at velocity 90, a C4 added at 1.5 s), exported through the button (test-song.mid, 71 bytes), and read back by the engine's own MIDI reader, every note's pitch, start, length and velocity identical and the tempo 120; no page errors; the audits clean before committing. The first build failed type-checking (a Uint8Array not typed to a plain ArrayBuffer, which Blob requires), fixed in midiFile's return type.

### src/ui/piano-roll.ts · several note clips in one editor (PT-17's last gap)
- refers-to: src/ui/piano-roll.ts :: `Target`, `wanted`, `targets`, `owner`, `origin`, `findClips`, `load`, `commit` (per clip, from a snapshot), `xOf` from the origin, the add owner, delete keeping owners, export from the origin, the selection listener
- kind: warning-context
- logged: v1.33.0 (in progress) · 2026-10-02

Selecting several note clips edits them together on one grid in session time, so clips at different places line up as they play: each note keeps its owning clip and converts back into that clip's media frames when a gesture commits, only clips whose notes changed are re-rendered, a new note goes to the clip whose span holds it, and Export MIDI writes the selection from its first clip's start. The commit works from a snapshot because each render updates the document, which reloads the editor in the middle of the loop. Verified in Chromium at 1288 by 683 with the MIDI file imported twice and the second clip moved to 5 s: the state read "2 clips · 6 notes"; dragging the second clip's A4 up two made its note B4 at media frame 0, gave only that clip a new rendering, and left the first clip's notes and media as they were; a click inside the second clip's span at 7 s added E4 to it at media frame 96000; no page errors; the audits clean before committing. The two clips had shared one rendering (the same file renders the same audio), and set-clip-notes rightly kept it, since the first clip still played it.

### src/engine/document.ts, src/ui/lanes.ts, inspector-pane.ts, styles · track and clip colours (AU-10)
- refers-to: src/engine/document.ts :: `PALETTE`, `Track.color`, `Clip.color`, `set-track-color`, `set-clip-color`; src/ui/lanes.ts :: `updateLane` (--fw-lane-color), `updateClip` (--fw-clip-color); src/ui/inspector-pane.ts :: the track's and the clip's Colour menus, their sync and handlers; src/styles/tokens.css :: --fw-color-<key>; workspace.css :: the clip's colour chain; surfaces.css :: the header bar
- kind: explainer
- logged: v1.35.0 (in progress) · 2026-10-02

A track can take a colour, and a clip its own over it, from an eight-key palette (green, blue, amber, red, violet, cyan, pink, slate) whose shades are tokens, so the session stores keys and themes own the colours; an unknown key clears. The colours reach the lanes as CSS variables written only when they change: a clip's --fw-c is its own colour, else its track's, else the audio green, for its border, its fill (mixed 20% into the surface) and its text colour, which the waveform painter draws with; the header's bar takes the track's. An uncoloured clip keeps today's exact fill. Verified in Chromium at 1288 by 683: before any change both lanes read the audio green with the fill at rgb(21, 55, 41), the old shade; track 1 set to blue turned its bar, clip and waveform canvas rgb(91, 157, 255) while track 2 stayed green; its clip set to amber turned the clip and waveform rgb(245, 177, 61) with the bar still blue; the screenshot shows the waveform's pixels repainted amber (computed colour alone would not prove it); the document held blue and amber; two undos stepped back to no colours and the default fill; no page errors; the audits clean before committing.

### src/ui/record.ts, shell.ts · punch and roll, lead-in recording (AU-19)
- refers-to: src/ui/record.ts :: `prerollSeconds` (remembered like the latency), `leadIn`, `begin` (the roll point, the seek before startRecording), `place` (the lead-in cut); src/ui/shell.ts :: the transport's Pre-roll field
- kind: warning-context
- logged: v1.35.0 (in progress) · 2026-10-02

Punch-in existed (the take cut to the punch range); the roll did not. A Pre-roll time in the transport now starts playback and capture that long before the punch point or, with no punch or loop range, before the playhead (lead-in recording), so the performer hears the lead-in; the punch keeps only its range, as before, and a lead-in recording keeps only what follows the playhead where Record was pressed. A pre-roll of 0 changes nothing. Found by the first test: startRecording plays from the player's current position and only labels the take with the position it is given, so passing an earlier position without moving the player played from the playhead and labelled the take a second early (a lead-in recording silently lost a second of real audio; the punch roll never reached its range); the player is now moved to the roll point first. Verified in Chromium at 1288 by 683 recording through a fake microphone with a 1 s pre-roll: lead-in from a playhead at 2.0 s rolled from 1.0 s (the transport at 1.23 s a quarter second in) and placed the take at exactly 2.0 s, 1.867 s long (2.87 s captured less the pre-roll); punch and roll into 3.0 to 4.0 s from a playhead at 0 rolled from 2.0 s and placed the take at exactly 3.0 s for 1.000 s, the 6 s clip split at 3 and 4 around it; with no pre-roll the take started at the playhead with nothing dropped (2.864 s); no page errors; the audits clean before committing.

### src/ui/knob.ts, mixer.ts, shortcuts.ts · rotary controls with fine adjustment (AU-14); undo from a focused slider
- refers-to: src/ui/knob.ts :: `knobify`, `syncKnob`, `render`; src/ui/mixer.ts :: each strip's pan as a knob; src/ui/shortcuts.ts :: only text entry owns undo and redo; src/styles/frame.css :: the knob
- kind: warning-context
- logged: v1.36.0 (in progress) · 2026-10-02

A rotary control is a range input drawn as a knob: the input stays the truth (value, default, keyboard, its input and change events, so the Mixer's handlers and one undo step per gesture hold), and the knob draws the value as an arc over 270 degrees from the default (a pan's centre), turns a vertical drag into value (the full range over 150 px, ten times finer with Shift), and resets to the default on double-click; the Mixer's pan is one. Two faults found while testing. The first test missed the knob: the Mixer strip is 327 px tall in a 225 px dock, so pan sits below the fold until the Mixer scrolls (it does scroll; a more compact strip is worth doing). The second is older than the knob: the shortcut handler ignored every focused input, sliders included, so Ctrl+Z did nothing after dragging any slider until focus moved; only text entry (text fields, number fields, text areas, menus, editable text) now keeps the keys. Verified in Chromium at 1288 by 683 with the knob scrolled into view: a 30 px drag set pan 0.40 in one undo step with the arc drawn; a 30 px Shift-drag the other way set 0.36; a double-click reset 0 in one step; Ctrl+Z on the focused knob returned 0.36, then 0.40; ArrowRight stepped 0.01; a clip-gain slider clicked to +12 dB undid to 0 with Ctrl+Z while focused; Ctrl+Z typed in the session name left the history unchanged; no page errors; the audits clean before committing.

### src/ui/transport.ts, ruler.ts, shell.ts · a continuous speed slider and scrubbing (AU-42)
- refers-to: src/ui/shell.ts :: the Speed slider and its readout; src/ui/transport.ts :: `applySpeed`; src/ui/ruler.ts :: `scrubStart`, `scrubMove`, `scrubEnd`, called from the playhead drag, its release and cancel
- kind: explainer
- logged: v1.36.0 (in progress) · 2026-10-02

The Speed menu (0.5 to 2 times in six steps) is a continuous slider over the player's whole range, 0.25 to 4 times, on a powers-of-two scale so halving and doubling travel equally, applied while it moves and reset to 1 times by the page's double-click reset. Dragging the playhead in the ruler now scrubs: it plays what passes under it at the drag's own speed, seeks back and plays forward when moving back, goes quiet when held still for 120 ms, and on release restores the slider's speed and keeps playing only if playback was running before the grab. Verified in Chromium at 1288 by 683: the slider at log2(1.5) read 1.49 times (its 0.01 steps) and playback advanced 1.499 s a second; its ends read 0.25 and 4.00 times; a double-click returned 1.00 times; a scrub from a stopped transport played while dragging, the position following the cursor (0.53, 0.78, 1.03 s) at 0.75 to 0.77 times, the drag's measured speed; held still it went quiet; released, it stopped at 1.01 s with the speed back at 1; grabbed while playing, it kept playing after the release; no page errors; the audits clean before committing.

### src/ui/envelope-edit.ts, lanes.ts · clip envelope points added and dragged on the clip (AU-12)
- refers-to: src/ui/envelope-edit.ts :: `mountEnvelopeEdit` (the handles' sync, the capture-phase pointer handler); src/ui/lanes.ts :: `GAIN_TOP_DB` and `GAIN_SPAN_DB` exported; src/main.ts; src/styles/workspace.css :: the handles
- kind: explainer
- logged: v1.36.0 (in progress) · 2026-10-02

A clip's volume envelope could only gain points at the playhead from the Inspector. Its points now draw as handles on the clip, placed in percentages so zoom and scroll need nothing, at the envelope line's height (the clip gain plus the point's dB on the lanes' scale, now exported rather than copied): a handle drags to move its point between its neighbours, Alt-click on a clip's body adds a point at that time and level, and Alt-click on a handle removes it, as on an automation row; presses within 8 px of a clip's edges are left to Alt-drag time-stretch. Each gesture dispatches set-clip-envelope once. The presses are taken in the capture phase and stopped, so the lanes' select, move and trim gestures never start beneath them, without threading a new gesture kind through the lanes' own handler. Verified in Chromium at 1288 by 683 on a 6 s clip: Alt-click at 25% and mid-height added -12.0 dB (the scale's middle); at 75% and a quarter height 0.0 dB; dragging the first handle to 40% and three-eighths height made it -6.0 dB; dragging it past the second stopped it a frame short; Alt-click on a handle removed its point; an Alt press at the right edge left the envelope alone; every gesture one undo step, one undo restoring the removed point; the clip's start stayed 0 throughout; the screenshot shows the line and both handles; no page errors; the audits clean before committing.

### src/styles/frame.css · a compact Mixer strip in the dock
- refers-to: src/styles/frame.css :: `.fw-dock .fw-strip` and its grid areas
- kind: explainer
- logged: v1.37.0 (in progress) · 2026-10-02

Found while testing the pan knob (v1.36.0): a Mixer strip stood 329 px in the dock's 201 px, so pan sat below the fold until the Mixer scrolled. Measured row by row (a 128 px fader, nine rows at 8 px gaps), it could not be fixed by shrinking alone, so in the dock the strip is two columns in its middle: the fader (76 px) beside the pan knob, its readout and the buttons, the name and meter above, the output and VCA menus below, at 4 px gaps. Verified in Chromium at 1288 by 683: the track and master strips stand 173 px in the Mixer's 225 px, the fader 76 px long, the pan knob inside the visible area and the element under the pointer at its centre with no scrolling; the screenshot shows every control in view (the Add bus and Add VCA row above leaves a few pixels to scroll); the audit clean before committing.

### src/ui/lanes.ts · an automation row for effect parameters (PT-19, last part)
- refers-to: src/ui/lanes.ts :: the effect row and its head's menu, `AutoScale`, `autoFraction` and `autoValue` (frequency and Q logarithmic, gain linear), `rowScale`, `rowFilter`, `rowPoints`, `rowStatic`, `syncFxRow`, `commitAuto`, the menu's change handler; src/styles/frame.css :: the menu
- kind: explainer
- logged: v1.38.0 (in progress) · 2026-10-02

The track's automation view holds a third row beneath Volume and Pan, shown when the track has a filter: its head is a menu of the track's filter parameters (frequency and Q for every filter, gain where it acts, marked when automated), and the row draws and edits the chosen one with the volume and pan rows' own gestures (click to add, drag, Alt-click to remove), on frequency's and Q's log scales or gain's linear one, dispatching set-fx-automation through one commitAuto. Verified in Chromium at 1288 by 683 on a 4 kHz tone track with a low-pass: the menu offered "1 Low-pass · Frequency" and "1 Low-pass · Q" (no gain for a low-pass); two clicks placed frequency points at exactly 0.1 and 1.9 s (20 Hz at the row's floor, 17419 Hz near its top) and the menu marked the parameter automated; the export swept from 0.0092 early to 0.3535 late; choosing Q switched the row to an unautomated Q; Alt-click removed a point and undo restored it; the screenshot shows the curve; no page errors; the reach audit's unreached commands back to none; the design audit clean.

### a running phase meter (AA-02); the transport bar fitted again
- refers-to: native/formwav-dsp/src/render.rs :: `corr`, `take_correlation`, the test `the_running_correlation_reads_identical_inverted_unrelated_and_silent_channels`; src/wasm.rs :: `fw_take_correlation`; src/native.rs :: the report's `correlation`; frontend src/audio/player-worklet.ts, player.ts :: the position reply's `correlation`, the level listeners; src/ui/meter.ts :: the phase meter; src/ui/shell.ts :: the Rec button and its popover; src/styles/frame.css
- kind: warning-context
- logged: v1.40.0 (in progress) · 2026-10-02

The core sums the master's left times right and each side's energy as it renders; take_correlation returns their correlation since the last read (NaN with nothing playing, null on the wire) and resets, beside take_peaks, so the browser worklet and native output report it with the peaks and the player hands it to the level listeners. A meter after OUT shows it, -1 at the left to +1 at the right, lightly smoothed, idle when nothing plays. Checking that the meter fit found an older fault: the transport bar ran 233 px past its 752 px (the speed slider of v1.36.0 and the pre-roll of v1.35.0 had widened it, unchecked), so the IN meter sat out of view; the recording settings (latency, Measure, pre-roll) moved into a Rec popover in the top layer, and the output meter's bar column (its width is its grid column's, which a first rule on the bars missed) and the phase track narrowed. Verified: the core's 13 tests pass (identical channels 1, inverted -1, independent noise within 0.05 of 0, silence NaN, the sums reset on reading); in Chromium at 1288 by 683 the meter read 1.00 (dot at 100%) on identical channels, -1.00 (dot at 0%, the negative state) on inverted ones and -0.01 on independent noise, idle before play and after stop; the transport overflows 0 px with the OUT, phase and IN meters in view; the Rec popover opens holding latency, Measure and pre-roll, keeps a pre-roll set in it, and closes on Escape; no page errors; the audits clean before committing.

### Restore original over a range (RX-61), Find similar marking (RX-22), any effect limited to a band (AU-31), ducking's fades and sensitivity (AU-47, AA-08), chosen word-gap shortening (DS-05, not yet verified)
- refers-to: src/engine/document.ts :: `Clip.original` (set by set-clip-media and set-range-media, dropped by a re-timing effect); src/ui/inspector-pane.ts :: Find similar, Restore original, the band query on a range's effect, the duck's Fade down, Fade up and Sensitivity; src/ui/transcript-pane.ts :: Gaps over and Keep; backend app/routers/media.py :: the effect route's band; app/services/effects.py :: `limit_to_band`; app/routers/render.py :: the activity route's sensitivity
- kind: warning-context
- logged: v1.42.0 (in progress) · 2026-10-02

A clip remembers the media it held before any effect, so Restore original splices it back over a range (set-range-media, the splice range effects use) or the whole clip; Find similar marks the engine's matches for the range on the timeline; a range drawn with a frequency band now limits any effect to it (the effect's change kept only inside the band, out = dry + band(wet - dry), timing effects refused); the duck takes its fade down and up lengths and a sensitivity (how far under the other track's loud level counts as active, 20 dB the old fixed value); the transcript's Shorten gaps takes its threshold and kept length. Verified: in Chromium at 1288 by 683, after Amplify -6 dB on a clip, Restore original over 2 to 3 s left the clip in three pieces (processed, original, processed) and one undo made it whole; Find similar over a drawn event marked 0.491, 1.696 and 3.093 s at 100, 93 and 94% (the events at 0.5, 1.7 and 3.1 s, two decoys passed over); through the engine an Amplify -6 dB limited to 2 to 4 kHz took a 3 kHz component down 6.00 dB with 300 Hz unchanged (0.3000) and a tempo effect with a band was refused; activity at sensitivity 10 found only the loud passages and at 40 the -38 dB one too; no page errors; the audits clean. Not verified: the word-gap fields, since transcription does not run in this container (no speech model), so DS-05 stays partial. The first browser run sent the test's range event to the body, outside the app's host, so the Inspector never saw it (it then restored the whole clip, as it should without a range); sent from the lanes it arrived.

### src/engine/document.ts, index.ts · markers attached to clips (AA-13)
- refers-to: src/engine/document.ts :: `Marker.clipId`, `followClips`, add-marker's `clipId`; src/engine/index.ts :: dispatch runs followClips; src/ui/inspector-pane.ts :: Find similar's markers belong to their clip
- kind: warning-context
- logged: v1.43.0 (in progress) · 2026-10-02

A marker can belong to a clip: after every change, followClips moves an attached marker by however far its clip moved (any kind of move with one rule), leaves it in place unattached when the clip is gone, and returns the same document when nothing moved; Find similar's markers belong to the clip they were found in. Verified in Chromium at 1288 by 683: three clip markers at 0.491, 1.696 and 3.093 s moved to 1.491, 2.696 and 4.093 s with their clip while a session marker stayed at 5 s; one undo restored them; removing the clip left them unattached in place; no page errors. The test found that a command the reducer does not know returns nothing and crashes dispatch (the test had used a wrong command name; the interface cannot send one, being typed); followClips passes such a nothing through rather than adding a crash of its own.

### src/ui/spectrum.ts and the engine's spectrum · the Spectrum panel: live, averaged, FFT size (RX-43, RX-63, AA-01, AA-03); mid and side views (RX-54)
- refers-to: src/ui/spectrum.ts (new); src/audio/player.ts :: `analyser()`; src/ui/dock.ts, src/main.ts :: the Spectrum tab; src/ui/inspector-pane.ts :: the spectrogram's View; backend app/services/tools.py :: `_view_channel`, `spectrum`, `spectrogram_png`'s channel; app/routers/media.py :: `GET /api/media/{id}/spectrum`, the spectrogram's channel
- kind: explainer
- logged: v1.43.0 (in progress) · 2026-10-02

A Spectrum tab in the dock draws the output live while playing (an analyser on the player's output, remade when its audio context is rebuilt; native output has no browser node, and says so) or the selected clip's or drawn range's average (the engine's Welch average at half overlap, in dB against a full-scale sine), at an FFT size from 512 to 32768, log frequency from 20 Hz and 0 to -100 dB; the averaged view and the Inspector's spectrogram show L+R, the mid or the side of a stereo clip. Verified: through the engine a -6.02 dBFS 1 kHz sine peaked at 1031.2 Hz with 93.75 Hz bins at FFT 512 and 1000.5 Hz with 1.46 Hz bins at FFT 32768, reading -6.65 dB (the Hann window's loss between bins); on a file with 500 Hz in its mid and 3 kHz in its side, mid read 500 Hz at -11.1 dB with 3 kHz at -178, side 3 kHz at -14.0 with 500 Hz at -198, and the three spectrogram views differ; in Chromium at 1288 by 683 the panel's live view peaked at 996 Hz while playing (the bin at FFT 4096), the average at 996 Hz, the side view at 3000 Hz and the mid at 504 Hz, drawn as a single peak; no page errors; the audits clean.

### split variants (AU-05) and monitoring before a take with a monitor level (AU-21): built, not yet verified
- refers-to: src/ui/lanes.ts :: Ctrl+Alt+X split-cut, Ctrl+Alt+K split-delete, Ctrl+Alt+I split to a new track (on a range); src/ui/inspector-pane.ts :: Split at silences, the Monitor level slider; src/audio/recorder.ts :: `startMonitoring`, `setMonitorLevel`; src/audio/recorder-worklet.ts :: the monitor level; src/ui/record.ts :: the pre-take monitor
- kind: warning-context
- logged: v1.44.0 (in progress) · 2026-10-02

On a range: split-cut puts the range's audio on the clip clipboard and leaves a gap, split-delete leaves a gap whatever Shuffle says, split to a new track moves the range's audio to a new track at the same time (import-media without a track), each one undo step; Split at silences splits the selected clip's track where the engine's activity (ducking's) says sound starts and stops. Monitor input now works before a take: on the armed track, with no take running, the take's own input and worklet pass the input through with no take started, stopped when monitoring is turned off or a take starts; a Monitor level (-30 to +6 dB) scales the pass-through before and during takes. The interface builds and type-checks and the audits are clean; the browser test (a drawn range and the three shortcuts, Split at silences on a clip with a silence, the monitor's level measured on a fake input) has not run yet, so AU-05 and AU-21 stay partial until it passes.

### split variants (AU-05) and pre-take monitoring (AU-21), verified
- refers-to: the previous entry's code, unchanged
- kind: explainer
- logged: v1.44.0 (in progress) · 2026-10-02

The browser test the previous entry left pending, in Chromium at 1288 by 683 with a fake microphone: a range drawn over 0.75 to 1.5 s of a 3 s clip; Ctrl+Alt+I left [0, 0.75] and [1.5, 3] on the track and [0.75, 1.5] on a new track, one undo restoring [0, 3]; Ctrl+Alt+K left the gap; Ctrl+Alt+X left the gap and Ctrl+V pasted the cut 0.75 s at 0 s; Split at silences cut a tone, a second of silence and a tone at 1.0 and 2.0 s; Monitor input on the armed track with no take running passed the input at 0.483 RMS, 0.0483 at -20 dB (a ratio of exactly 0.100), and unchecking stopped it; no page errors. Two of the test's own faults on the way: the servers were down at first, and a drag at a quarter of the clip's height landed on its gain line (a gain drag, no range), so the shortcuts saw no range and each undo took back the import; drags above the gain line drew the range.

### alignment guides and per-project snap settings (AU-07)
- refers-to: src/ui/lanes.ts :: the move's edge alignment and `showGuide`; src/styles/frame.css :: `.fw-align-guide`; src/engine/document.ts :: `SessionDoc.snap`, `set-snap`; src/ui/grid.ts :: Grid and Bars through set-snap and the document; src/main.ts :: mountGrid gets the engine
- kind: explainer
- logged: v1.44.0 (in progress) · 2026-10-02

A moved clip's start or end within 6 px of another clip's edge on any track, or of the playhead, snaps to it, with a guide line drawn through the lanes there while dragging; Grid and Bars are now the project's snap settings, kept in the document (saved with the session, restored when it opens, and by undo). Verified in Chromium at 1288 by 683: Grid wrote snap {grid: true, bars: false} into the document with the button pressed, and undo took both back; a clip dragged until its start passed near another clip's end at 3 s showed a guide in both lanes at 300 px mid-drag and landed at exactly 3.000 s, the guides gone after; no page errors; the audits clean (the reach audit counts set-snap as dispatched).

### stereo clips mixed down when they land on a mono track (AU-06): built, not yet verified
- refers-to: src/ui/lanes.ts :: `adaptToTrack`, called after paste and after a drag to another track
- kind: warning-context
- logged: v1.45.0 (in progress) · 2026-10-02

A stereo clip pasted or dragged onto a mono track gets the engine's Downmix as its media (a second undo step after the paste or move). The interface builds and the audits are clean. Not verified: the browser test's drag of a stereo clip from its lane onto the mono lane did not move it to that track at all (both tracks unchanged after the drop), so the adaptation was never exercised; the gesture the cross-track drop needs must be found first. AU-06 stays partial. Also seen this turn: the development engine was found down twice between steps, cause not yet looked into.

### stereo clips mixed down on mono tracks (AU-06), verified
- refers-to: the previous entry's code, unchanged
- kind: explainer
- logged: v1.45.0 (in progress) · 2026-10-02

The test the previous entry left pending, with the gesture the cross-track drop needs (a move counts only once it has travelled sideways, so the earlier purely vertical drag never became a move): in Chromium at 1288 by 683 a stereo clip carrying 500 Hz in its mid and 3 kHz in its side, dragged onto a mono track, landed there at 3.3 s with one-channel media holding the 500 Hz at full level and the 3 kHz at -240 dB (the side cancelled exactly); one undo took back the mixdown and left the move, the two steps as stated; no page errors.

### selections drawn on the spectrogram (RX-23, RX-62): gaps found already closed, re-verified
- refers-to: the spectrogram marquee (since v1.2.0) and Band gain's band from it
- kind: explainer
- logged: v1.45.0 (in progress) · 2026-10-02

Both rows still listed a selection drawn on the spectrogram as missing, though the marquee in the Spectrogram view has drawn one since v1.2.0. Re-verified now in Chromium at 1288 by 683: a box drawn over 0.5 to 1.5 s and about 3 to 7 kHz on a clip of 500 Hz and 5 kHz selected 0.5 to 1.5 s with a 3207 to 7115 Hz band, which filled Band gain's band; -30 dB applied left three pieces, the 5 kHz inside the box down 30.0 dB, the 500 Hz there at -0.00 dB, and the 5 kHz before the box unchanged; no page errors.

### per-track spectrogram view with a frequency ruler and guides (AU-30)
- refers-to: src/engine/document.ts :: `Track.view`, `set-track-view`; src/ui/spectrogram-view.ts :: per-lane spectral state, `scale` (the ruler and guides); src/ui/inspector-pane.ts :: Spectrogram view in the Track section; src/styles/frame.css :: `.fw-freq-scale`, `.fw-freq-guide`
- kind: explainer
- logged: v1.45.0 (in progress) · 2026-10-02

A track can show its clips as spectrograms whatever the session-wide view is (the Track section's Spectrogram view box, kept in the document), and every spectral clip carries a frequency ruler with dashed guides at 1, 5, 10, 15 and 20 kHz on the image's linear axis. Verified in Chromium at 1288 by 683: with the session-wide toggle off, the box on the second of two tracks made only its lane spectral (the first kept its waveform), its clip showing the spectrogram and guides at 95.83, 79.17, 58.33, 37.5 and 16.67% from the top for 1, 5, 10, 15 and 20 kHz of 24 kHz (the 5 kHz tone's band on the 5k guide in the screenshot); the document held view spectrogram on that track; undo restored the waveform; no page errors; the audits clean (60 commands, set-track-view dispatched).

### the curve editor verified in the browser (AU-B06, AU-B07)
- refers-to: src/ui/curve-editor.ts and the curve effects, unchanged
- kind: explainer
- logged: v1.45.0 (in progress) · 2026-10-02

The test the previous entry left pending, with both servers started by a helper that checks their health first (processes do not survive between turns here, and the dev server has also been found gone mid-turn with nothing in its log; the kernel log shows no out-of-memory kill, so that cause is ruled out and the deaths stay unexplained): in Chromium, Filter curve EQ's editor showed its six points flat; dragging the 2.5 kHz point down wrote -12 into its gain field and drew the dip; applied, it took 2.5 kHz down 11.84 dB with 200 Hz and 12 kHz at 0.00; the Dynamics curve's editor wrote -20 into the -10 dB point's output field when that point was dragged down; no page errors.

### stretching to the playhead, and later clips moved off a lengthening stretch (AA-10)
- refers-to: src/ui/inspector-pane.ts :: Stretch to playhead, the ripple in Stretch selected clips; src/ui/lanes.ts :: the ripple in `stretchGroup` (the Alt edge drag)
- kind: explainer
- logged: v1.45.0 (in progress) · 2026-10-02

Stretch to playhead finds the percentage that makes the selection end at the playhead and runs Stretch selected clips with it; a stretch that lengthens clips, typed, to the playhead or by an Alt drag of a right edge (which already stretched; that part of the gap was stale), now moves the later clips on the track that it would overlap right by the overlap, spacing kept, in the same undo step. Verified in Chromium: two copies of a 3 s clip at 0 and 3.5 s; Stretch to playhead at 4.5 s took the first to 0 to 4.5 s and moved the second to 4.5 s in one undo step; after undo, an Alt drag of the first clip's right edge out by half did the same; no page errors; the audits clean.

### sample chop, stretch, transpose and reverse in the editor (PT-12): the gap found already closed, measured
- refers-to: Split at transients, Stretch selected clips (and its edge drag), Change pitch's semitone control and Reverse, all in the Inspector
- kind: explainer
- logged: v1.45.0 (in progress) · 2026-10-02

The row listed chop and in-editor controls as missing, though all four sample edits have controls in the editor's Inspector. Measured now: Split at transients cut a clip with clicks at 1, 2 and 3 s into four pieces there (in Chromium); Change pitch at +12 semitones took a 440 Hz tone to 880 Hz and Reverse matched the input backwards within 1.5e-08 (through the engine); stretching as verified for AA-10 above.

### floating panels (AU-08) carried by saved layouts (AU-09)
- refers-to: src/ui/dock.ts :: Float, `float`, `dockBack`, `FloatState`, `dockFloating`, `applyDockFloating`; src/ui/workspace-layout.ts :: saved layouts' `floating`; src/styles/frame.css :: `.fw-float`
- kind: explainer
- logged: v1.46.0 (in progress) · 2026-10-02

The dock's Float button moves the shown panel into its own window, dragged by its title bar and resized from its corner, several at once; a floating panel is left out of the dock's one-at-a-time rule, its window follows the panel's own toggle, and its Dock button returns it. The floating set and places are kept between visits (restored closed until opened), and a saved layout captures them and restores them exactly. Verified in Chromium at 1288 by 800: Spectrum floated (its tab hidden); Notes opened in the dock beside it with both open; the window dragged from 364, 96 to 164, 206; a layout saved; Dock returned Spectrum to its tab; choosing the saved layout floated it again at 164, 206; no page errors; the audits clean.

### automation write modes on the mixer fader (PT-43): Touch, Latch and Write verified, Trim faulty
- refers-to: src/ui/mixer.ts :: the strip's automation mode menu, `passes`, `record`, the commit at stop, the release handling
- kind: warning-context
- logged: v1.46.0 (in progress) · 2026-10-02

While playing, a track strip's fader in Write, Touch, Latch or Trim records into the volume automation, each pass replacing the automation in its span at stop, one undo step. Verified with real playback in Chromium on an 8 s tone: Touch wrote 39 points from the first touch at 0.98 s to the release at 1.79 s, stepping -3 to -12, and one undo removed them; Latch wrote from 0.99 s through the release to the stop at 2.99 s, holding -12; Write wrote from the start of play (0 s) to the stop, -12 then -6 after the move; no page errors. Fault, not yet fixed: Trim changed nothing, because its offset is taken from the fader's value before the touch, read in the input event after the fader has already moved, so the offset is always zero; the fix is to remember each fader's last committed value and offset from it. PT-43 stays partial until Trim is fixed and verified.

### Trim's offset fixed; the four automation modes verified (PT-43)
- refers-to: src/ui/mixer.ts :: `lastFader`, Trim's `trimFrom`
- kind: explainer
- logged: v1.46.0 (in progress) · 2026-10-02

The fault the previous entry recorded: Trim measured its offset from the fader after it had moved. Each fader's last value is now kept (after every input and release), and a Trim touch measures from it. Verified with real playback in Chromium: over a Write pass at -6 dB, Trim moving the fader from -6 to -3 wrote its span (1.08 to 1.27 s) at -3, the existing -6 plus 3, with every point outside the span unchanged; no page errors. With Touch, Latch and Write as verified before, the four modes all record.

### post-fader sends to buses (PT-18)
- refers-to: src/engine/document.ts :: `Track.sends`, `set-track-send`; src/audio/player.ts :: planClips' send duplicates; backend app/services/render.py :: the same for exports; src/ui/mixer.ts :: the strip's send menu and level; src/styles/frame.css :: the strip's full-width rows
- kind: explainer
- logged: v1.46.0 (in progress) · 2026-10-02

A track's send feeds its signal, after its inserts and fader, to a bus at a level while the track keeps its own output. No core change: the player plans, and the renderer builds, each clip again into the send's bus at the send level, with its own insert state and automation (rendering one clip twice into two places would have run its insert filters twice per block), and not metered as the track. Verified: an engine export of a 0.2 tone peaked 0.2000 with no send, 0.3002 with a -6 dB send to a unity bus (0.2 times 1.501) and 0.4000 at 0 dB; in Chromium the strip's send menu and level set the send in the document, the player's plan held the main clip (master, gain 1, track 1) and the send (the bus, 0.5012, unmetered), and No send removed it; no page errors; the audits clean (set-track-send dispatched). Found on the way: the strip, a named-area grid, auto-placed the new controls into one column's leftover cells (the send level 6 px wide); they now take full-width rows. With the realtime insert stack already in place, sends and inserts are both there.

### varispeed playback above 2x no longer stalls; the time track verified end to end (AU-36)
- refers-to: src/audio/player-worklet.ts :: `refill`; src/audio/player.ts :: `timeTrackLength`, `bounce`
- kind: explainer
- logged: v1.47.0 (in progress) · 2026-10-02

Found while checking the drawn time track: playback stalled whenever the speed passed 2x (a curve peaking at 300% stopped moving at 1.6 s, where the speed reached 2.2x, and every play after it stayed at 0 s). Above 2x one step can carry the read position past everything buffered; refill then discarded floor(readPos) samples whatever the buffer held, drove bufLen negative, and writing the next chunk at a negative offset threw inside the processor, killing it. It now discards at most what is buffered; the read position then falls inside the next chunk, which starts where the buffer ended. Measured in Chromium with real playback, timed to the transport's stop, against the export and the integral of 1 / speed: peaks of 200, 300 and 400% played 3.383, 3.093 and 2.927 s against 3.386, 3.099 and 2.924; the curve drawn in the Inspector (100, 100, 400, 100, 100%) played 2.924 s linear (2.924) and 3.093 s logarithmic (3.082); the exports 2.924 and 3.082 exactly. The player's offline bounce (unused by the interface; exports go through the engine) now carries the time track and is as long as the warped session: timeTrackLength gave 2.773, 2.885, 2.924, 3.082 and 4.000 s, exactly the integrals, and a bounce under 100 to 200% ended its sound at 2.773 s with the pitch near 845 Hz at the end (440 Hz at almost 2x). Noted, not changed: the bounce sends no master effects, unlike playback. No page errors; the audits clean.

### the heal brush (AA-06): built, not working yet
- refers-to: src/ui/lanes.ts :: the brush stroke (dabs, `fw-heal-stroke`); src/ui/inspector-pane.ts :: Heal brush toggle and the stroke's Spot heal boxes; src/styles/frame.css :: `.fw-brush-dot`
- kind: warning-context
- logged: v1.47.0 (in progress) · 2026-10-02

With Heal brush on, a drag in the spectrogram view paints dabs; on release the stroke's dabs are grouped into boxes of at most 40 ms, widened by the brush's 8 px, healed through Spot heal box by box and committed as one media change. Not working yet: a stroke painted along a 3 kHz whistle over a 440 Hz tone, on a track switched to its own spectrogram view (set-track-view), changed nothing within 90 s. To check first: whether a drag on a per-track spectrogram view is marked spectral (rangeDrag.spectral may follow only the session-wide view), whether the pointerdown reached startRange at all, and whether the stroke event reached the Inspector. AA-06 stays partial; the brush does nothing unless its toggle is pressed.

### a track's own spectrogram view takes spectral drags; the heal brush heals a stroke in one pass (AU-30, AA-06)
- refers-to: src/ui/lanes.ts :: `spectralTrack`; src/ui/inspector-pane.ts :: the heal stroke's one call; backend app/services/effects.py :: `_spot_heal_mask`, `heal_painted`; app/routers/media.py :: POST /media/{id}/heal-painted
- kind: explainer
- logged: v1.47.0 (in progress) · 2026-10-02

Why the brush did nothing: on a track switched to its own spectrogram view (AU-30) the lanes still asked only whether the session's view was the spectrogram, so the bottom half of a clip was a move zone and the stroke moved the clip; the marquee there could not select a band either. spectralTrack now asks both, for the hover zone, the press and the drag. Then the heal itself: healing the stroke's boxes one at a time let each predict from neighbours still holding the sound, and a 3 kHz whistle came down only from -10.5 to -28.3 dB. The stroke is now healed in one engine pass: its boxes become one mask over the STFT, and in each bin every run of masked frames is capped at the level the unmasked frames around that run predict. Verified in Chromium on a track's own spectrogram view: a stroke over the whistle (0.95 to 2.05 s) took it from -10.5 to -143.7 dB, the 440 Hz tone under it and outside it unchanged at -10.5 dB, the audio before the stroke unchanged to 4.0e-17, the clip unmoved, one undo restoring the original, no page errors; the marquee on that view selected 1.0 to 2.0 s and 1 to 5 kHz. Still missing for AA-06: filling a dropout (the heal only attenuates).

### a logarithmic frequency axis for spectrograms, rulers and selections (AA-05)
- refers-to: src/ui/spectrogram-view.ts :: Log Hz, `spectralFraction`, `spectralHz`, the log ruler; src/ui/lanes.ts :: the marquee's and the brush's frequencies; src/ui/inspector-pane.ts :: the brush's per-dab reach; src/styles/frame.css :: the gain line in spectral views; backend app/services/tools.py :: `_log_spectrogram_png`; app/routers/media.py :: fscale
- kind: explainer
- logged: v1.48.0 (in progress) · 2026-10-03

Log Hz beside the Spectrogram toggle puts every spectrogram, its ruler and its selections on a logarithmic axis, 20 Hz at the bottom. Measured first: ffmpeg's own log scale strayed from any pure log curve below 2 kHz, the error doubling each octave down to 69 px at 125 Hz on a 1024-row image, too far for selections, so the engine draws the log image itself (an 8192-point STFT per column, each row the strongest bin of its band) with f = 20 Hz x (nyquist / 20) ^ fraction, the mapping the interface shares; octave tones from 125 Hz to 16 kHz landed within 1.1 px of it. Found on the way: in a spectrogram view the clip's gain line took presses across its height, so a selection or brush stroke drawn there started a gain drag (3 kHz on the log axis sits on it); in spectral views it now takes none. Verified in Chromium: the log image requested and the 1 kHz guide at 44.82% (the formula's 44.82%); a marquee drawn from 200 to 2000 Hz on the log axis read back as 200 to 2000 Hz; the heal brush took a 3 kHz whistle from -10.5 to -143.7 dB on both axes with the 440 Hz tone unchanged; no page errors.

### lasso and paint selections in the spectrogram, for any effect (AA-05)
- refers-to: src/ui/spectrogram-view.ts :: the selection tool menu; src/ui/lanes.ts :: the lasso's columns and the paint patches, the range's mask; src/ui/inspector-pane.ts :: the masked apply; backend app/services/effects.py :: `limit_to_boxes`; app/routers/media.py :: POST /media/{id}/effect-masked
- kind: explainer
- logged: v1.48.0 (in progress) · 2026-10-03

Beside Log Hz, a menu picks how a drag selects in a spectrogram: a box (the marquee), a lasso drawn around a sound, or a paintbrush. A lasso's outline is cut into 3 px columns, each column's spans inside it (even-odd) a box; a paint stroke's dabs are patches at the brush's reach; either becomes the range's mask, its dots kept as the selection's mark until it is cleared. Applying an effect to it runs the effect and keeps its change only inside the boxes, dry + mask(wet - dry) through the STFT (limit_to_boxes, the drawn counterpart of the band limit). Verified in Chromium on a 440 Hz plus 3 kHz phrase, measured on whole-session renders before and after: a lasso around 3 kHz from 1 to 2 s on the log axis (33 boxes) and a paint stroke along it on the linear axis each took 3 kHz inside from -10.5 to -22.5 dB with Amplify at -12, left 3 kHz before the selection at -10.5 and 440 Hz inside at -10.5; no page errors; the audits clean. (A first run waited on the first clip's media, which a range result never changes, since set-range-media splits the clip; the measurement now renders the session.)

### realtime clip effects, EQ and dynamics ahead of the track's (PT-33)
- refers-to: native/formwav-dsp/src/render.rs :: clip chains of `Stage`, `add_clip_comp`; python.rs, wasm.rs, native.rs :: the clip compressor in each binding; src/audio/player.ts :: `clipChain`; src/audio/player-worklet.ts :: the compressor's place; src/engine/document.ts :: `Clip.fx`, `set-clip-fx`; src/ui/inspector-pane.ts :: Clip effects; backend app/services/render.py :: the same chain for exports
- kind: explainer
- logged: v1.48.0 (in progress) · 2026-10-03

A clip carries its own realtime effects, edited in the Inspector's Clip effects like a track's: filters and a compressor, ahead of the track's inserts. The core's clip chains became stages, so a compressor is one more stage in a clip's chain, after the clip's own filters and before its track's; every binding places it there. The core applies a clip's gain after its chain, so the planner lowers the compressor's threshold by the clip gain: compressing the clip at its clip gain is compressing the file at that threshold with the gain after, so louder clips compress harder and the track fader stays after. Verified: a core test (a 4:1 compressor after a lowpass takes a loud tone down and leaves a filtered tone below its threshold untouched; 14 core tests pass); engine exports of a -6.02 dBFS tone came down 9.73 dB with a -20 dB 4:1 clip compressor, rose only 1.56 dB for +6 dB of clip gain into it and fell exactly 6.00 dB for a -6 dB fader after it; in Chromium, Add in Clip effects put the compressor on the clip and the plan carried [0, -20, 4, 10, 150, 0], the realtime engine's bounce fell from -6.02 to -15.60 dBFS and 6.0 dB more with the fader at -6, its row showed and edited the threshold to -30, at which the realtime bounce and the engine's export both measured -23.00 dBFS; two undos removed it; no page errors; the audits clean (62 commands, all dispatched).

### the offline bounce applies the master effects
- refers-to: src/audio/player.ts :: `bounce`
- kind: explainer
- logged: v1.48.0 (in progress) · 2026-10-03

Recorded at v1.47.0 and fixed: the player's offline bounce sent no master effects, unlike playback. It now sends them as playback does. Verified: with a 2 kHz high-pass on the master, a 440 Hz tone's bounce fell from -6.02 to -32.43 dBFS, the engine's export of the same document -32.43, a difference of 0.000 dB; no page errors.

### DS-05 found already closed: the gap threshold and the length kept are the user's to choose
- refers-to: src/ui/transcript-pane.ts :: Gaps over, Keep, Shorten gaps
- kind: explainer
- logged: v1.49.0 (in progress) · 2026-10-03

COVERAGE still listed DS-05 as missing a chosen threshold and target, but the transcript pane has carried both (Gaps over, Keep) since an earlier batch, and Shorten gaps reads them. Measured through the pane (sidecar verification/verify_gap_choice.py): a 5.4 s recording of five tone words with gaps of 0.4, 0.9, 1.5 and 0.6 s, its transcript seeded in the engine's transcript cache (faster-whisper is not installed in this container; the cache is what a transcription writes), lost exactly 1.8 s at the default 0.75 and 0.3 s, came back to 5.4 s with one undo, and lost exactly 2.7 s at 0.5 and 0.1 s (the 0.6 s gap now caught too); no page errors.

### live preview for effects and plugins (AU-29)
- refers-to: src/ui/inspector-pane.ts :: Preview (`runPreview`, `stopPreview`)
- kind: explainer
- logged: v1.49.0 (in progress) · 2026-10-03

Preview beside Apply plays the picked effect, built in or a plugin, at its current settings on 5 s of the selected clip from the playhead (or its start): the span is cut from the clip's file, processed by the engine and looped beside the session, which does not change; while it plays, a changed setting renders it again and the new render takes over; Preview again, picking another effect or changing the selection stops it. Plugin parameters are drawn in the same fields as built-in ones, so the same re-render follows them. Verified in Chromium with real playback calls: Amplify at +6 dB previewed a 0.2 tone at 0.399 and, changed to -6 dB while playing, re-rendered at 0.100 (play, pause, play); Preview again stopped it; the session's tracks were unchanged throughout; the CLAP test gain plugin (a fixed -6.02 dB, no parameters of its own) previewed at 0.1000 against 0.0998; no page errors; the audits clean.

### warp markers on the clip (PT-09)
- refers-to: src/engine/document.ts :: `Clip.warp`, `set-clip-warp`; src/ui/lanes.ts :: `syncWarpMarkers`, the marker drag, `renderWarp`; src/ui/inspector-pane.ts :: Warp markers; src/styles/frame.css :: `.fw-warp-marker`
- kind: explainer
- logged: v1.50.0 (in progress) · 2026-10-03

Add warp marker at playhead pins that point of the selected clip's audio where it plays now, changing nothing yet; the clip's first marker records its original (media and span). Dragging a marker on the clip re-times the audio on either side of it, each side kept within half to twice its speed; on release the clip is rendered again from its original by the engine's warp and the new media and markers land in one step (set-clip-warp; set-clip-media would have scaled the trim by the whole file's length). Double-clicking a marker removes it; removing the last, or Clear warp, restores the original. Verified in Chromium on a 4 s click train (sidecar verification/verify_warp_markers.py): a marker added at 1.0 s left the audio unchanged; dragged to 1.2000 s it rendered a clip of exactly 4.0000 s whose clicks all fell within 2.7 ms of where the warp puts them; one undo brought back the original audio with the marker; double-clicking it restored the original span; no page errors; the audits clean (63 commands, all dispatched). With Alt-drag on a clip's right edge as the stretch handle, PT-09 is complete.

### a macro script for chains (AU-39)
- refers-to: src/ui/inspector-pane.ts :: Macro script (`parseMacro`, Load into chain, Write chain as script)
- kind: explainer
- logged: v1.50.0 (in progress) · 2026-10-03

Under the chain, Macro script takes one effect per line, its name and any setting=value pairs, # starting a comment; each name and setting is checked against the Effects menu and the effect's own settings, errors reported by line, settings not given taking their defaults, and Load into chain makes it the chain, so Apply chain runs it on the clip in one undo step, Save chain keeps it as a named macro and Run chain on files runs it over files; Write chain as script turns any chain back into text. Verified in Chromium: "nosuch x=1" reported Line 1: no effect named "nosuch", a misspelt setting reported Line 2: amplify-up has no setting "dbb"; a commented script of Amplify +6 then -12 dB loaded as two steps and applied took a 0.2 tone to 0.1002 (0.1002 expected); the chain written back read "amplify-up db=6" and "amplify-up db=-12"; no page errors; the audits clean.

### a macro recorder (AA-14)
- refers-to: src/ui/inspector-pane.ts :: Record (`macroRecording`, `recordMacroStep`), the apply path
- kind: explainer
- logged: v1.50.0 (in progress) · 2026-10-03

Record, beside the macro script, writes each effect applied to a clip into the script with the settings used, so a task done once becomes a macro, which Load into chain, Save chain and Run chain on files then take. Verified in Chromium: with Record on, Amplify +6 then -12 dB applied by hand took a 0.2 tone to 0.1002 and recorded "amplify-up db=6" and "amplify-up db=-12"; both undone, the recorded macro loaded and applied gave 0.1002 again; no page errors; the audits clean.

### filler removal: cut, silence in place or hide in the transcript, smoothed cuts, other languages (DS-04)
- refers-to: src/ui/transcript-pane.ts :: the filler mode and Smooth cuts, `cut`; src/engine/document.ts :: clear-ranges' `smooth`; src/styles/frame.css :: `.is-hiding-fillers`; backend app/services/transcript.py :: `_norm`, `FILLERS_BY_LANGUAGE`, `mark_fillers`, cached transcripts re-marked
- kind: explainer
- logged: v1.51.0 (in progress) · 2026-10-03

Remove filler words now cuts them out (as before), silences them in place (the timeline kept, for picture), or hides them in the transcript only (the session untouched); Smooth cuts, on by default, fades 10 ms either side of every join, in the same undo step as the cut (clear-ranges' smooth). Fillers are marked for Spanish, French, German, Italian and Portuguese as well as English, by the transcript's language, and a cached transcript is marked again when read. Found on the way: words were normalised to a to z only, so "Äh" became "h" and no filler outside English could ever match; letters of any language are kept now. Verified in Chromium on a German transcript seeded in the engine's cache (faster-whisper is not installed here): "äh" marked as the one filler; hide hid it with the session unchanged; silence kept 2.2 s with 0.0 in the span; cut left 1.9 s. Smoothing was measured on a 441 Hz tone, where the 0.3 s cut cannot meet in phase: without Smooth cuts the join stepped 0.2795 (a click), with it the pieces faded 480 samples and the largest step was 0.0173, the tone's own steepest. (A first run at 440 Hz cut exactly 132 cycles, so even the rough cut met in phase and proved nothing.) No page errors; the audits clean.

### word edges dragged on the clip, gaps lengthened, on a real transcript (DS-11)
- refers-to: src/ui/transcript-pane.ts :: `fw-word-span`, `fw-word-edge`, Gap after; src/ui/lanes.ts :: the word span and its edges; src/engine/document.ts :: `insert-time`; src/styles/frame.css :: `.fw-word-span`, `.fw-word-edge`
- kind: explainer
- logged: v1.51.0 (in progress) · 2026-10-03

The transcript's one selected word is drawn on its clip with an edge to drag at each end; a drag hands the edge's new place to the transcript pane, which applies it as a typed Start or End (kept between the neighbours as before). Gap after now lengthens as well as shortens: a longer value inserts the difference as silence at the gap's middle on every track (insert-time, which splits a clip across the point and moves what follows, one undo step). Verified in Chromium on a transcript faster-whisper wrote here (requirements_transcript.txt installed in the dev venv, pip check clean; base.en downloaded into backend/models, which the packages exclude) of the JFK recording, 22 words, the text exact: "Americans," (1.540 to 1.980 s, 1.380 s gap after) drawn 44.0 px wide (44.0 expected); its end edge dragged about 0.1 s left set End to 1.880 s; its gap lengthened by 0.5 s took the session from 11.000 to 11.500 s; no page errors; the audits clean. Found on the way: the dev engine's command line carries --reload flags, so a stop pattern of "uvicorn app.main:app --host" never matched it and an engine started before the install kept answering with the old huggingface_hub loaded; match "app.main:app --reload" (the release gate's engine, started without --reload, did match).

### editing by text: typed corrections, a text cursor, moving words (DS-01)
- refers-to: src/ui/transcript-pane.ts :: the cursor (`caret`, `placeCaret`, arrow keys), double-click correction, Move to cursor; src/engine/document.ts :: `move-range`; src/styles/frame.css :: `.fw-caret`, `.fw-word-edit`, the timing row's kept space; backend app/services/transcript.py :: `set_word`'s text; app/routers/media.py
- kind: explainer
- logged: v1.52.0 (in progress) · 2026-10-03

Double-clicking a word corrects its text in the engine's transcript, the audio untouched. A click between words, or after the last, places a text cursor, and Left and Right move it a word at a time. Move to cursor moves the selected words and their audio on every track to the cursor in one step (move-range: split at both ends, lifted out with the gap closed, time opened at the destination, set in). Found on the way: selecting a word revealed the timing row above the transcript and pushed the text down under the pointer, so a double-click's second click landed on the row; the row now keeps its place while hidden, and the correction opens for the selected word whatever the second click hits. Verified in Chromium on the JFK transcript faster-whisper wrote (sidecar verification/verify_text_editing.py): "Americans," corrected to "Americans!" with the session unchanged; the cursor placed after the last word and moved two words left to stand before "your"; "And so" moved to the end with the session still 528000 samples, the pane reading "... your country. And so", and faster-whisper, run again on the moved audio, heard "... for your country, and so"; one undo restored the order; no page errors; the audits clean. Its re-transcription also began "So my fellow": whisper's own boundary for "so" ends a little early, leaving a sliver of it behind, which the word's edges (DS-11) can correct.

### retakes reworded as well as repeated, and the best take kept (DS-07)
- refers-to: src/ui/transcript-pane.ts :: `phraseSpans`, `overlap`, `retakeRanges`
- kind: explainer
- logged: v1.52.0 (in progress) · 2026-10-03

Remove retakes groups phrases (runs of words between pauses of 0.3 s) within three of each other when they share 70% of their words or the shorter, of four or more, is 90% inside the longer, and keeps the best take of each group: the most complete, less a point a filler, a quarter more for ending a sentence, the last on a tie; the four-word restart rule judges its two takes the same way, the retake found by alignment with the earlier attempt. Three faults found by testing on real speech, each fixed: the model's punctuation split a spliced take at a stray period ("Ask, not."), so phrases now end at pauses only; the model can stretch a word over the pause between takes, so the four-word rule had to judge as well; and bounding a retake by pauses cut it at the speaker's own pause, so its extent comes from alignment. Verified in Chromium on takes cut from the JFK recording at faster-whisper's word times, each transcribed for real, retakes removed, and what remained rendered and transcribed again (sidecar verification/verify_best_take.py): a reworded retake ("Ask what you can do for your country" then "Ask not what your country can do for you", no four-word run shared) lost its earlier take, 3.06 s, leaving "Ask not what your country can do for you."; a complete take followed by one abandoned at "Ask not what your country" lost the abandoned one, 3.30 s, the complete one kept; verify_retakes.py (its upload given the engine's local header, which it predated) still removed 11.00 s from a doubled take and found nothing to remove in a single take, whose "ask not ... ask what" rhetoric is one phrase; no page errors; the audits clean.

### playback's output device, rate and channel map (AU-22)
- refers-to: src/audio/player.ts :: `OutputChoice`, `loadOutput`, `setSink`, `route`, `setOutput`, `outputNode`, start and ensure; src/audio/player-worklet.ts :: `rate-ratio`; src/ui/inspector-pane.ts :: Browser output, Rate, Channels; src/main.ts :: `fw-output`
- kind: explainer
- logged: v1.54.0 (in progress) · 2026-10-03

The Track section now chooses where the browser's playback goes, kept on this machine: the output device (setSinkId; a device that has gone falls back to the default), the output's rate (the session's, or 44.1 to 96 kHz, the worklet reading session samples at the rate's ratio so the pitch stays true) and the device channels left and right go to (as is, swapped, both to one, or 3 and 4 up to 7 and 8 on devices with them, through a splitter and merger). The status bar's Output still chooses between the browser and native output. Found on the way: the status bar's chooser takes the first [data-output] element on the page, and the new controls, first named data-output, sat ahead of it, so it filled one of them with its native outputs and listened to it; they are data-play-out now. And ensure() compared the context's rate with the session's, which would have rebuilt a context at a chosen rate on every play. Verified in Chromium with its fake devices (sidecar verification/verify_output_device.py), measured by channel on the player's own output with a 1 kHz tone on the left only: by default the tone sat on channel 1 (0.212 rms, 999 Hz) and channel 2 was silent; Fake Audio Output 1 with the channels swapped put the context on that device and the tone on channel 2; 44.1 kHz for a 48 kHz session ran the context at 44100 with the tone at 1001 Hz (8% flat, 919 Hz, without the ratio); the choice was stored; the status bar's Output kept Browser and its native outputs; no page errors; the audits clean. The fake devices have two channels, so the maps beyond two were checked as routing, not on a device with more.

### a note editor for pitch correction, and formants kept (PT-10, still partial)
- refers-to: backend app/services/effects.py :: `detect_notes`, `retune_notes`, pitch correction's formants; app/routers/media.py :: GET /media/{id}/notes, POST /media/{id}/retune-notes; src/ui/inspector-pane.ts :: Notes (Find notes, the canvas, Apply note changes, Keep formants); src/ui/lanes.ts :: `selectedClips`; src/styles/workspace.css :: `.fw-notes-canvas`
- kind: explainer
- logged: v1.55.0 (in progress) · 2026-10-03

Find notes, in the Inspector, tracks the selected clip's pitch (YIN every 5 ms) and shows its notes on a semitone grid over the pitch curve: voiced frames grouped while within half a semitone of the note's running median, 60 ms or more, frames 50 dB under the loudest ignored (YIN reads digital silence as a pitch near its 1 kHz ceiling, which first added a false note in every gap). Dragging a note moves its target a semitone at a time from its nearest semitone; Apply note changes retunes only the notes moved, gliding over 30 ms, through rubberband with the formants kept unless Keep formants is unticked, as one undo step. Pitch correction also gains Keep formants. Verified on a four-note melody with known detunings and a vowel-like formant at 800 Hz (sidecar verification/verify_note_editor.py, verify_note_retune_engine.py; an FFT instrument searching near each expected pitch, after a first one read the strong second harmonic as the first note): the engine found the four notes at 57.301, 59.801, 64.105 and 66.602 (57.30, 59.80, 64.10, 66.60 expected); in Chromium, C4 20 cents flat dragged up two rows took target 62 and rendered at 293.60 Hz (D4 293.66) with the others within 0.04 Hz; one undo restored it; a note moved up four semitones landed at 282.0 Hz with its formant peak at 850 Hz kept (893 before) against 1133 Hz unkept; no page errors; the audits clean. Still missing for PT-10: chords, and correcting a chosen set of clips at once (Apply to all clips covers every clip; shift-click in the lanes turned out not to select several clips, so a selection path was built, found unreachable, and taken out again before commit).

### effects on a chosen set of clips, and pitch correction to a chord's tones (PT-10, still partial)
- refers-to: src/ui/inspector-pane.ts :: render (effects for several clips), the batch apply; backend app/services/effects.py :: pitch correction's chord-tone sets
- kind: explainer
- logged: v1.55.0 (in progress) · 2026-10-03

Several clips selected with a marquee (a box dragged from an empty part of a lane; shift-click is not multi-selection here) now keep the effects: the batch button reads "Apply to N selected clips" and applies to exactly those, one undo step, while Apply to this clip and Preview wait for a single clip; with none or one selected it still applies to every clip. The unused lanes export from the first attempt is gone. Pitch correction's scale also takes a chord's tones on the key (major, minor, seventh, minor seventh, major seventh), its search widened to six semitones as chord tones lie up to five apart. Verified: in Chromium (sidecar verification/verify_pitch_selected_clips.py), a marquee over two of three detuned melody clips showed "Apply to 2 selected clips" with the single apply disabled; chromatic pitch correction through it changed those two only, their notes at 219.97, 261.60, 329.47 and 391.86 Hz (220, 261.63, 329.63, 392), the third untouched at 223.85, 258.62, 331.54 and 383.05; one undo restored both; no page errors. On the engine, key A with minor chord tones took the melody to 219.97, 261.60, 329.47 and 439.85 Hz, G4 40 cents flat going to the chord's A4, and chromatic correction was unchanged. PT-10 stays partial on one question for the owner: whether its "chords" means these chord-tone targets or editing notes inside a played chord (polyphonic), which is not attempted.

### the realtime adaptive denoiser in the rack, playback and exports (RX-24, RX-40, RX-49)
- refers-to: src/engine/document.ts :: `DenoiseFx`, cleanFx, set-fx-automation; src/audio/player.ts :: flatFx, flatFxAuto, flatStages; src/ui/inspector-pane.ts :: Denoise in the track and clip racks (Reduce dB, Sens dB); src/ui/lanes.ts :: automation rows; backend app/services/render.py :: FX_KINDS, `_stage`
- kind: explainer
- logged: v1.57.0 (in progress) · 2026-10-03

Denoise joins the track and clip effects racks: reduction 0 to 40 dB (12 by default) and sensitivity -6 to 12 dB (3). It reaches the core as stage kind 7 in clip chains (its reduction and sensitivity in a filter's frequency and gain slots) and in bus and master chains, counts as a stage in automation's numbering without being automatable, and the export renderer builds the same chains. Verified in Chromium (sidecar verification/verify_realtime_denoise.py) on 440 Hz bursts over white noise at -40 dBFS: Denoise added through the track rack and set to 20 dB took the gaps down 13.4 dB with the tone within 0.54 dB in the player's realtime engine (its offline bounce), the engine's export measured the same 13.4 and 0.54, the two differed by -80.2 dB, and with the denoiser switched off playback returned the input exactly; no page errors; the audits clean.

### Essential sound: clip types with their tasks and presets (AA-07)
- refers-to: src/ui/essential-sound.ts (`mountEssentialSound`, TASKS, BUILT_IN, `chainFor`, `duckPoints`); src/engine/document.ts :: Clip.soundType, set-clip-type; src/ui/inspector-pane.ts :: the Essential sound rows, mounting and sync; backend app/services/effects.py :: stereo-width, noise-reduce
- kind: explainer
- logged: v1.63.0 (in progress) · 2026-10-03

The Essential Sound panel in the clip section: a Type (dialogue, music, sound effects or ambience) kept on the clip, its own tasks drawn as ticks and amounts (dialogue: loudness, rumble, hum at 50 or 60 Hz, noise, reverb, sibilance, dynamics, clarity; music: loudness, ducking under dialogue; effects: loudness, reverb; ambience: loudness, reverb, stereo width, ducking), built-in presets for each type and presets saved on this machine. Apply tasks runs the ticked ones as a chain of the engine's effects, repairs first and loudness last so it measures the finished sound, and writes ducking into the clip's gain envelope across the session's dialogue-typed clips (0.15 s down before each, 0.4 s up after, spans joined), all as one change; ducking writes nothing when no dialogue overlaps, so a hand-drawn envelope is never cleared by it. Two effects were added for it: Stereo width (ffmpeg extrastereo, the side scaled 0 to 200%) and Noise reduction (afftdn's reduction with its noise floor tracked, since Denoise's one control sets only the floor's estimate, which a "reduce noise by" amount cannot honestly map to). Verified in Chromium (sidecar verification/verify_essential_dialogue.py, verify_essential_music.py): JFK with 60 Hz hum, 30 Hz rumble and noise, typed dialogue with Clean up noisy dialogue applied, measured -23.0 LUFS, hum against speech from -11.9 to -41.0 dB, rumble from -7.8 to -26.0, loud frames over quiet from 13.6 to 29.2 dB; a saved preset was offered again after a reload; a music bed typed music and ducked 12 dB under a dialogue line at 2 to 4 s dropped 12.06 dB while it played (rendered alone) and came back to +0.03, one undo clearing it; an ambience clip at 50% width went from side level with mid to 6.01 dB under; Stereo width alone at 0, 50 and 200% gave mono, -6.02 and +6.02 dB; no page errors; the audits clean.

### track playlists, MIDI tracks among them (PT-14)
- refers-to: src/engine/document.ts :: Track.playlist, Track.playlists, new-playlist, switch-playlist; src/ui/inspector-pane.ts :: the Playlists section (its own, following the last track a clip was selected on), its picker, New and Duplicate
- kind: explainer
- logged: v1.67.0 (in progress) · 2026-10-03

Playlists: a track's clips are its active playlist (so playback, exports and every tool work on them unchanged) and its other playlists are stashed beside them by name. New playlist keeps the playing clips as a playlist and starts an empty one; Duplicate playlist carries on with a copy (fresh clip ids, the same media and notes); picking another in the Playlists section switches it in; each is one undo step. Playlists are named with the track's name and a number (piano_chord.02). The section is its own rather than part of the track section, which shows only through a selected clip: an empty playlist leaves nothing to select, and the controls would have vanished with no way back but undo; it follows the last track a clip was selected on. It works on note tracks (the row's subject) and audio tracks alike. Verified in Chromium (sidecar verification/verify_playlists.py) on a MIDI file's note track: Duplicate made piano_chord.02 (fresh ids, the same three notes), New made piano_chord.03 empty with the section still shown and all three listed, a render with the empty one active was silent (-240 dBFS), switching back to piano_chord.01 through the picker brought the original clip back (its own id) and the render to -18.3 dBFS, and undo returned to piano_chord.03; no page errors; 68 commands each dispatched by the interface; the audits clean.
