import { rangesOf, sessionWords, type MediaWord, type SessionWord } from "./transcript-pane";
import type { Engine, HistoryEntry, MediaRef, Track } from "../engine";
import type { TrackFx } from "../engine/document";
import { patchList, setText } from "../vendor/nodemode/dom-stable";
import { KINDS } from "./editor-tabs";
import { PANEL_ICONS } from "./shell";

/** The realtime effects a track's chain can hold, with each parameter's range, for the agent's tool description. */
const KIND_SUMMARY = Object.entries(KINDS)
  .map(([id, k]) => `${id} (${k.params.map((p) => `${p[0]} ${p[2]} to ${p[3]}${p[4] ? ` ${p[4]}` : ""}`).join(", ")})`)
  .join("; ");

/**
 * The in-app agent (owner decision, Sprint D: agent actions and controls; DS-02). An instruction goes to the model
 * through the engine (POST /api/agent/step keeps the API key there); the model answers with text and tool calls, the
 * calls run here on the open session (each a session command, so each is undoable) or read from the engine, their
 * results go back, and the loop runs until the model stops or twelve turns pass. Stop ends a run between turns; Undo
 * run takes back everything the last run changed. The dock is made once and only hidden after that; the step log is
 * append-only.
 */
type Json = Record<string, unknown>;
interface AgentTool {
  name: string;
  description: string;
  input_schema: Json;
  run: (input: Json) => unknown;
}
interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Json;
}

const SYSTEM =
  "You are formwav's editing assistant, working inside the user's open audio session through tools. Call get_session " +
  "first to learn the tracks and clips and their ids; times are in seconds and levels in dB. Measure with analyze_clip " +
  "before changing levels or applying repairs, and look up an effect's id and parameters with list_effects before " +
  "apply_effect_to_clip, which renders an effect into a clip. A track's realtime chain, heard live and shown in the " +
  "Effects tab, is set with set_track_effects. Make the smallest set of changes that does what was asked; every change " +
  "is undoable. When you " +
  "are done, say in one or two sentences what you changed.";

export function mountAgent(host: HTMLElement, engine: Engine): void {
  const toggles = host.querySelector<HTMLElement>(".fw-panel-toggles");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-ibtn";
  button.dataset.action = "agent";
  button.title = "Show or hide the agent";
  button.setAttribute("aria-label", "Show or hide the agent");
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = PANEL_ICONS.agent;
  if (toggles) toggles.append(button);
  else host.querySelector('[data-action="export"]')?.before(button);

  const dock = document.createElement("section");
  dock.className = "fw-term fw-agent";
  dock.hidden = !host.querySelector(".fw-agent-anchor");
  dock.setAttribute("aria-label", "Agent");
  dock.innerHTML = `<div class="fw-term-head"><span class="fw-agent-tabs" role="tablist" aria-label="Agent and history"><button type="button" role="tab" class="fw-agent-tab" data-agent-tab="agent" data-label="Agent" aria-selected="true">Agent</button><button type="button" role="tab" class="fw-agent-tab" data-agent-tab="history" data-label="History" aria-selected="false" title="Every edit in this session, yours and the agent's; click one to go back to it">History</button></span><span class="fw-term-state" aria-live="polite"></span><span class="fw-agent-who">Claude</span><button type="button" class="fw-ibtn fw-agent-quiet" data-agent="undo" disabled title="Undo every change the last run made">Undo run</button><button type="button" class="fw-ibtn fw-agent-quiet" data-agent="new" title="Clear the conversation and start again">New</button></div><div class="fw-agent-body"><ol class="fw-agent-log" aria-live="polite"></ol><div class="fw-agent-foot"><div class="fw-agent-suggest" role="group" aria-label="Suggestions"><button type="button" class="fw-agent-chip" data-suggest="Clean up the dialogue on the selected track">Clean up the dialogue</button><button type="button" class="fw-agent-chip" data-suggest="Measure each track and set their gains so the voices sit evenly">Even out the voices</button><button type="button" class="fw-agent-chip" data-suggest="Make the session ready for a podcast at -16 LUFS">Podcast-ready loudness</button></div><span class="fw-agent-context" hidden></span><label class="fw-agent-ask"><textarea rows="2" placeholder="Ask, or describe how it should sound" aria-label="Message the agent"></textarea><button type="button" class="fw-ibtn fw-agent-run" data-agent="run">Send</button><button type="button" class="fw-ibtn fw-agent-stop" data-agent="stop" disabled>Stop</button></label><span class="fw-agent-keys" title="Enter sends, Shift Enter adds a line, Cmd or Ctrl / asks from anywhere">Enter sends. Cmd / asks from anywhere.</span></div></div><div class="fw-agent-history" hidden><ol class="fw-history-list" aria-label="Edits in this session"></ol><p class="fw-history-empty">Each edit, yours or the agent's, is listed here. Click one to go back to it.</p></div>`;
  const transport = host.querySelector<HTMLElement>(".fw-agent-anchor") ?? host.querySelector<HTMLElement>(".fw-dock-anchor");
  if (transport) transport.before(dock);
  else host.append(dock);
  button.setAttribute("aria-pressed", String(!dock.hidden));
  const log = dock.querySelector<HTMLOListElement>(".fw-agent-log") as HTMLOListElement;
  const ask = dock.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
  const state = dock.querySelector<HTMLElement>(".fw-term-state");
  dock.querySelector(".fw-agent-suggest")?.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-suggest]");
    if (!chip) return;
    ask.value = chip.dataset.suggest ?? "";
    ask.focus();
  });
  const control = (name: string) => dock.querySelector<HTMLButtonElement>(`[data-agent="${name}"]`) as HTMLButtonElement;

  const rate = () => engine.get("document").sampleRate;
  const sec = (samples: number) => Math.round((samples / rate()) * 1000) / 1000;
  const samples = (seconds: number) => Math.round(seconds * rate());
  const num = (value: unknown, name: string, lo: number, hi: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be a number from ${lo} to ${hi}.`);
    return n;
  };
  const track = (id: unknown): Track => {
    const t = engine.get("document").tracks.find((x) => x.id === id);
    if (!t) throw new Error(`No track with id ${String(id)}; call get_session for the ids.`);
    return t;
  };
  const clipOf = (trackId: unknown, clipId: unknown) => {
    const t = track(trackId);
    const c = t.clips.find((x) => x.id === clipId);
    if (!c) throw new Error(`No clip ${String(clipId)} on track ${t.name}; call get_session for the ids.`);
    return { t, c };
  };
  const engineJson = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return out;
  };
  const obj = (properties: Json, required: string[] = []) => ({ type: "object", properties, required });
  const id = (what: string) => ({ type: "string", description: `The ${what}'s id from get_session` });

  // 3.3: engine calls and placement for the tools that make sound: media lands on a new track (one undo step), and the
  // new track and clip are reported so the next tool can work on them
  const postJson = (url: string, body: unknown) => engineJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const at = (seconds: unknown) => (seconds === undefined || seconds === null ? engine.get("transport").positionSamples : samples(num(seconds, "at_seconds", 0, 86400)));
  const place = (media: MediaRef, where: number) => {
    engine.dispatch({ type: "import-media", media, at: where, by: "agent" });
    const t = engine.get("document").tracks.find((x) => x.clips.some((c) => c.mediaId === media.id && c.start === where));
    const c = t?.clips.find((x) => x.mediaId === media.id && x.start === where);
    return { track_id: t?.id, clip_id: c?.id, name: media.name, seconds: Math.round((media.frames / media.sampleRate) * 1000) / 1000 };
  };
  // a clip's span in its media's seconds: sourceIn counts the media's samples, length the session's
  const range = (c: { mediaId: string; sourceIn: number; length: number }) => {
    const mediaRate = engine.get("document").media[c.mediaId]?.sampleRate ?? rate();
    const inS = c.sourceIn / mediaRate;
    return { inS, outS: inS + c.length / rate(), mediaRate };
  };

  // The transcripts the agent's word tools read, kept per media as the Transcript tab keeps them
  const transcripts = new Map<string, MediaWord[]>();
  const allWords = async () => {
    const doc = engine.get("document");
    for (const id of new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.mediaId)))) {
      if (transcripts.has(id)) continue;
      const res = await fetch(`/api/media/${id}/transcript`, { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `transcribing answered ${res.status}`);
      transcripts.set(id, out.words as MediaWord[]);
    }
    return sessionWords(engine.get("document"), transcripts);
  };
  const cutWords = (words: SessionWord[], pick: (w: SessionWord) => boolean) => {
    const ranges = rangesOf(words, pick);
    const doc = engine.get("document");
    engine.dispatch({ type: "clear-ranges", trackIds: doc.tracks.map((t) => t.id), ranges, ripple: true });
    return { deleted_words: words.filter(pick).length, ranges: ranges.length, removed_s: sec(ranges.reduce((n, r) => n + (r.end - r.start), 0)) };
  };

  const tools: AgentTool[] = [
    {
      name: "get_session",
      description: "The open session: sample rate, playhead, and each track (id, name, gain_db, pan, mute, solo) with its clips (id, media_id, media name, start_s, length_s, gain_db, fades), plus markers. Call this first.",
      input_schema: obj({}),
      run: () => {
        const doc = engine.get("document");
        return {
          sample_rate: doc.sampleRate,
          playhead_s: sec(engine.get("transport").positionSamples),
          tracks: doc.tracks.map((t) => ({ id: t.id, name: t.name, gain_db: t.gainDb, pan: t.pan ?? 0, mute: t.mute, solo: t.solo, effects: t.fx ?? [], clips: t.clips.map((c) => ({ id: c.id, media_id: c.mediaId, media: doc.media[c.mediaId]?.name, start_s: sec(c.start), length_s: sec(c.length), gain_db: c.gainDb, fade_in_s: sec(c.fadeIn ?? 0), fade_out_s: sec(c.fadeOut ?? 0) })) })),
          markers: doc.markers.map((m) => ({ id: m.id, at_s: sec(m.at), label: m.label })),
        };
      },
    },
    {
      name: "analyze_clip",
      description: "Measured levels of a clip's audio: peak and RMS in dBFS, DC offset, clipped samples.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip") }, ["track_id", "clip_id"]),
      run: async (i) => engineJson(`/api/media/${clipOf(i.track_id, i.clip_id).c.mediaId}/stats`),
    },
    {
      name: "list_effects",
      description: "Effects and repairs that apply_effect_to_clip can use, each with its id and parameters (id, min, max, default, unit). query keeps those whose id or label contains it.",
      input_schema: obj({ query: { type: "string", description: "A word to filter by, such as reverb, noise, click or pitch" } }),
      run: async (i) => {
        const q = String(i.query ?? "").toLowerCase();
        const groups = (await engineJson("/api/effects")) as { group: string; effects: { id: string; label: string; params?: unknown[] }[] }[];
        return groups.flatMap((g) => g.effects.filter((e) => !q || e.id.includes(q) || e.label.toLowerCase().includes(q)).map((e) => ({ group: g.group, id: e.id, label: e.label, params: e.params ?? [] })));
      },
    },
    {
      name: "apply_effect_to_clip",
      description: "Applies an effect or repair (an id from list_effects, with its parameters) to a clip: the clip's audio is replaced by the processed copy, the original kept for undo.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), effect: { type: "string" }, params: { type: "object", description: "Parameter ids to numbers; missing ones take their defaults" } }, ["track_id", "clip_id", "effect"]),
      run: async (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        const params = i.params && typeof i.params === "object" ? `&params=${encodeURIComponent(JSON.stringify(i.params))}` : "";
        const media = (await engineJson(`/api/media/${c.mediaId}/effect?name=${encodeURIComponent(String(i.effect))}${params}`, { method: "POST" })) as MediaRef;
        engine.dispatch({ type: "set-clip-media", trackId: t.id, clipId: c.id, media });
        return { applied: i.effect, clip: c.id, new_media: media.name };
      },
    },
    {
      name: "set_track_effects",
      description: `Replaces a track's realtime effect chain, heard live and shown in the Effects tab (an empty list clears it). Each effect is an object with kind and any parameters (the rest take their defaults), and bypass: true to keep it but switch it off. Kinds and parameter ranges: ${KIND_SUMMARY}.`,
      input_schema: obj({ track_id: id("track"), effects: { type: "array", items: { type: "object" }, description: 'The chain in order, e.g. [{ "kind": "highpass", "freq": 90 }, { "kind": "compressor", "thresholdDb": -20, "ratio": 3 }]' } }, ["track_id", "effects"]),
      run: (i) => {
        const t = track(i.track_id);
        const list = Array.isArray(i.effects) ? (i.effects as Record<string, unknown>[]) : [];
        const fx = list.map((e, n) => {
          const kind = String(e?.kind ?? "");
          const k = KINDS[kind];
          if (!k) throw new Error(`effect ${n + 1}: unknown kind "${kind}"; the kinds are ${Object.keys(KINDS).join(", ")}`);
          const out: Record<string, unknown> = { kind, ...k.init };
          for (const p of k.params) if (e[p[0]] !== undefined) out[p[0]] = num(e[p[0]], p[0], p[2], p[3]);
          if (e.bypass === true) out.bypass = true;
          return out as unknown as TrackFx;
        });
        engine.dispatch({ type: "set-track-fx", trackId: t.id, fx });
        return { track: t.name, effects: fx.map((f) => f.kind) };
      },
    },
    {
      name: "set_track_gain",
      description: "Sets a track's gain in dB (-60 to 12).",
      input_schema: obj({ track_id: id("track"), gain_db: { type: "number" } }, ["track_id", "gain_db"]),
      run: (i) => {
        const t = track(i.track_id);
        engine.dispatch({ type: "set-track-gain", trackId: t.id, gainDb: num(i.gain_db, "gain_db", -60, 12) });
        return { track: t.name, gain_db: Number(i.gain_db) };
      },
    },
    {
      name: "set_track_pan",
      description: "Sets a track's pan from -1 (left) to 1 (right).",
      input_schema: obj({ track_id: id("track"), pan: { type: "number" } }, ["track_id", "pan"]),
      run: (i) => {
        const t = track(i.track_id);
        engine.dispatch({ type: "set-track-pan", trackId: t.id, pan: num(i.pan, "pan", -1, 1) });
        return { track: t.name, pan: Number(i.pan) };
      },
    },
    {
      name: "set_track_mute",
      description: "Mutes or unmutes a track.",
      input_schema: obj({ track_id: id("track"), mute: { type: "boolean" } }, ["track_id", "mute"]),
      run: (i) => {
        const t = track(i.track_id);
        engine.dispatch({ type: "set-track-mute", trackId: t.id, mute: Boolean(i.mute) });
        return { track: t.name, mute: Boolean(i.mute) };
      },
    },
    {
      name: "set_track_solo",
      description: "Solos or unsolos a track.",
      input_schema: obj({ track_id: id("track"), solo: { type: "boolean" } }, ["track_id", "solo"]),
      run: (i) => {
        const t = track(i.track_id);
        engine.dispatch({ type: "set-track-solo", trackId: t.id, solo: Boolean(i.solo) });
        return { track: t.name, solo: Boolean(i.solo) };
      },
    },
    {
      name: "rename_track",
      description: "Renames a track.",
      input_schema: obj({ track_id: id("track"), name: { type: "string" } }, ["track_id", "name"]),
      run: (i) => {
        const t = track(i.track_id);
        engine.dispatch({ type: "rename-track", trackId: t.id, name: String(i.name).slice(0, 80) });
        return { track: t.id, name: String(i.name).slice(0, 80) };
      },
    },
    {
      name: "move_clip",
      description: "Moves a clip so it starts at start_s seconds on its track.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), start_s: { type: "number" } }, ["track_id", "clip_id", "start_s"]),
      run: (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        engine.dispatch({ type: "move-clip", trackId: t.id, clipId: c.id, start: samples(num(i.start_s, "start_s", 0, 86400)) });
        return { clip: c.id, start_s: Number(i.start_s) };
      },
    },
    {
      name: "split_clip",
      description: "Splits a clip in two at at_s seconds on the timeline (inside the clip).",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), at_s: { type: "number" } }, ["track_id", "clip_id", "at_s"]),
      run: (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        const at = samples(num(i.at_s, "at_s", 0, 86400));
        if (at <= c.start || at >= c.start + c.length) throw new Error(`at_s must fall inside the clip, between ${sec(c.start)} and ${sec(c.start + c.length)} s.`);
        engine.dispatch({ type: "split-clip", trackId: t.id, clipId: c.id, at });
        return { split: c.id, at_s: Number(i.at_s) };
      },
    },
    {
      name: "remove_clip",
      description: "Removes a clip from its track.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip") }, ["track_id", "clip_id"]),
      run: (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        engine.dispatch({ type: "remove-clip", trackId: t.id, clipId: c.id });
        return { removed: c.id };
      },
    },
    {
      name: "set_clip_gain",
      description: "Sets a clip's gain in dB (-60 to 24).",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), gain_db: { type: "number" } }, ["track_id", "clip_id", "gain_db"]),
      run: (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        engine.dispatch({ type: "set-clip-gain", trackId: t.id, clipId: c.id, gainDb: num(i.gain_db, "gain_db", -60, 24) });
        return { clip: c.id, gain_db: Number(i.gain_db) };
      },
    },
    {
      name: "set_clip_fades",
      description: "Sets a clip's fade-in and fade-out lengths in seconds (together no longer than the clip).",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), fade_in_s: { type: "number" }, fade_out_s: { type: "number" } }, ["track_id", "clip_id", "fade_in_s", "fade_out_s"]),
      run: (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        const fin = samples(num(i.fade_in_s, "fade_in_s", 0, 3600));
        const fout = samples(num(i.fade_out_s, "fade_out_s", 0, 3600));
        if (fin + fout > c.length) throw new Error(`The fades together must fit the clip's ${sec(c.length)} s.`);
        engine.dispatch({ type: "set-clip-fades", trackId: t.id, clipId: c.id, fadeIn: fin, fadeOut: fout });
        return { clip: c.id, fade_in_s: Number(i.fade_in_s), fade_out_s: Number(i.fade_out_s) };
      },
    },
    {
      name: "add_marker",
      description: "Adds a named marker at at_s seconds.",
      input_schema: obj({ at_s: { type: "number" }, label: { type: "string" } }, ["at_s", "label"]),
      run: (i) => {
        engine.dispatch({ type: "add-marker", at: samples(num(i.at_s, "at_s", 0, 86400)), label: String(i.label).slice(0, 80) });
        return { marker: String(i.label).slice(0, 80), at_s: Number(i.at_s) };
      },
    },
    {
      name: "set_loop",
      description: "Sets and turns on the loop between start_s and end_s seconds.",
      input_schema: obj({ start_s: { type: "number" }, end_s: { type: "number" } }, ["start_s", "end_s"]),
      run: (i) => {
        const start = samples(num(i.start_s, "start_s", 0, 86400));
        const end = samples(num(i.end_s, "end_s", 0, 86400));
        if (end <= start) throw new Error("end_s must be after start_s.");
        engine.dispatch({ type: "set-loop", start, end, enabled: true });
        return { loop_s: [Number(i.start_s), Number(i.end_s)] };
      },
    },
    // Editing by transcript (the comparison's Descript row): the words as the Transcript tab has them, cut and rewritten the same way
    {
      name: "get_transcript",
      description: "Every transcribed word in the session in order: index, text, speaker, start_s, end_s, filler (um, uh and the like). Clips not yet transcribed are transcribed first on this machine, which takes a while for long audio. Use the indexes with delete_words and rewrite_words, from the latest call: indexes change after an edit.",
      input_schema: obj({ max_words: { type: "integer", description: "At most this many words (default 2000)" } }),
      run: async (i) => {
        const words = await allWords();
        const cap = Math.max(1, Math.min(10000, Number(i.max_words ?? 2000)));
        return { count: words.length, words: words.slice(0, cap).map((w, k) => ({ index: k, text: w.text, speaker: w.speaker, start_s: sec(w.start), end_s: sec(w.end), filler: w.filler })) };
      },
    },
    {
      name: "delete_words",
      description: "Cut words out by their get_transcript indexes (from and to, inclusive; several ranges at once), closing the gap as the Transcript tab's Delete does, across every track.",
      input_schema: obj({ ranges: { type: "array", description: "Word ranges to cut", items: obj({ from: { type: "integer" }, to: { type: "integer" } }, ["from", "to"]) } }, ["ranges"]),
      run: async (i) => {
        const words = await allWords();
        const keys = new Set<string>();
        for (const r of (i.ranges ?? []) as { from: number; to: number }[]) for (let k = Math.max(0, r.from); k <= Math.min(words.length - 1, r.to); k++) keys.add(words[k].key);
        if (!keys.size) throw new Error("no words in those ranges: call get_transcript for the current indexes");
        return cutWords(words, (w) => keys.has(w.key));
      },
    },
    {
      name: "remove_fillers",
      description: "Cut every filler word (um, uh and the like, as the transcript marks them) out of the session, closing the gaps.",
      input_schema: obj({}),
      run: async () => {
        const words = await allWords();
        if (!words.some((w) => w.filler)) return { deleted_words: 0, note: "no filler words in the transcript" };
        return cutWords(words, (w) => w.filler);
      },
    },
    {
      name: "rewrite_words",
      description: "Replace words (from and to, inclusive, within one clip) with new text spoken in the speaker's cloned voice, as Regenerate does: engine elevenlabs (needs ELEVENLABS_API_KEY), pocket or chatterbox (installed on this machine). Later clips on that track move by the change in length.",
      input_schema: obj({ from: { type: "integer" }, to: { type: "integer" }, text: { type: "string", description: "What to say instead" }, engine: { type: "string", enum: ["elevenlabs", "pocket", "chatterbox"], description: "Default elevenlabs" } }, ["from", "to", "text"]),
      run: async (i) => {
        const words = await allWords();
        const a = words[Number(i.from)];
        const b = words[Number(i.to)];
        if (!a || !b || Number(i.to) < Number(i.from)) throw new Error("no such words: call get_transcript for the current indexes");
        const clipId = a.key.split(":")[0];
        if (b.key.split(":")[0] !== clipId) throw new Error("rewrite words within one clip at a time");
        const doc = engine.get("document");
        const t = doc.tracks.find((x) => x.clips.some((c) => c.id === clipId));
        const c = t?.clips.find((x) => x.id === clipId);
        if (!t || !c) throw new Error("that clip is gone");
        const which = String(i.engine ?? "elevenlabs");
        const url = which === "elevenlabs" ? "/api/providers/elevenlabs/regenerate" : `/api/providers/local-speech/${which}/regenerate`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_id: c.mediaId, start_s: a.mediaStart, end_s: b.mediaEnd, text: String(i.text ?? "") }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        const ratio = (doc.media[c.mediaId]?.sampleRate ?? doc.sampleRate) / doc.sampleRate;
        const delta = Math.round(out.delta_frames / ratio);
        const later = t.clips.filter((x) => x.id !== c.id && x.start >= c.start + c.length);
        engine.dispatch({ type: "batch", commands: [
          { type: "set-clip-media", trackId: t.id, clipId: c.id, media: out.media },
          { type: "set-clip-bounds", trackId: t.id, clipId: c.id, start: c.start, sourceIn: c.sourceIn, length: c.length + delta },
          ...later.map((x) => ({ type: "move-clip" as const, trackId: t.id, clipId: x.id, start: x.start + delta })),
        ] });
        return { replaced_s: sec(b.end - a.start), inserted_s: out.inserted_s, engine: which, later_clips_moved: later.length };
      },
    },
    // 3.3: what the MCP server reaches, done in the open session: results land on tracks and regions, each an undo step
    {
      name: "local_models_status",
      description: "What can make sound here: the local speech engines and whether each is installed, the dubbing languages installed, and which providers (ElevenLabs, ACE-Step, fal) are ready. Call it before generating and choose an engine that is ready.",
      input_schema: obj({}),
      run: async () => {
        const speech = (await engineJson("/api/providers/local-speech")).engines as { id: string; installed: boolean }[];
        const dub = (await engineJson("/api/providers/local-dub")) as { languages: { code: string; installed: boolean }[] };
        const prov = (await engineJson("/api/providers")).providers as { id: string; ready: boolean; needs: string }[];
        return { local_speech: speech.map((e) => ({ engine: e.id, installed: e.installed })), dubbing_languages: dub.languages.filter((l) => l.installed).map((l) => l.code), providers: prov.map((x) => ({ id: x.id, ready: x.ready, needs: x.needs })) };
      },
    },
    {
      name: "list_voices",
      description: "The voices generate_speech accepts for an engine: kokoro (on this machine, once installed) or elevenlabs (needs ELEVENLABS_API_KEY).",
      input_schema: obj({ engine: { type: "string", enum: ["kokoro", "elevenlabs"] } }, ["engine"]),
      run: async (i) =>
        i.engine === "elevenlabs"
          ? ((await engineJson("/api/providers/elevenlabs/voices")).voices as { voice_id: string; name: string }[]).map((v) => ({ voice: v.voice_id, name: v.name }))
          : (await engineJson("/api/providers/local-speech/kokoro/voices")).voices,
    },
    {
      name: "generate_speech",
      description: "Speech from text on a new track at at_seconds (default the playhead): engine kokoro (on this machine) or elevenlabs (a voice_id, needs ELEVENLABS_API_KEY). Returns the new track and clip ids.",
      input_schema: obj({ text: { type: "string" }, engine: { type: "string", enum: ["kokoro", "elevenlabs"] }, voice: { type: "string", description: "From list_voices; empty for the default" }, at_seconds: { type: "number" } }, ["text"]),
      run: async (i) => {
        const media = i.engine === "elevenlabs" ? await postJson("/api/providers/elevenlabs/speech", { text: i.text, voice_id: i.voice ?? "" }) : await postJson("/api/providers/local-speech/kokoro/speak", { text: i.text, voice: i.voice ?? "" });
        return place(media, at(i.at_seconds));
      },
    },
    {
      name: "generate_music",
      description: "Music or a song (lyrics sung when given) on a new track at at_seconds (default the playhead): engine elevenlabs (needs ELEVENLABS_API_KEY) or acestep (ACE-Step's server on this machine). Returns the new track and clip ids.",
      input_schema: obj({ prompt: { type: "string" }, lyrics: { type: "string" }, seconds: { type: "number" }, engine: { type: "string", enum: ["elevenlabs", "acestep"] }, at_seconds: { type: "number" } }, ["prompt"]),
      run: async (i) => {
        const seconds = i.seconds === undefined ? 30 : num(i.seconds, "seconds", 3, 600);
        const media = i.engine === "acestep" ? await postJson("/api/providers/acestep/generate", { task: "text2music", prompt: i.prompt, lyrics: i.lyrics ?? "", seconds }) : await postJson("/api/providers/elevenlabs/music", { prompt: i.prompt, lyrics: i.lyrics ?? "", seconds });
        return place(media, at(i.at_seconds));
      },
    },
    {
      name: "generate_sound_effect",
      description: "A sound effect from a description on a new track at at_seconds (default the playhead), 0.5 to 30 s, looping when asked (ElevenLabs, needs ELEVENLABS_API_KEY).",
      input_schema: obj({ description: { type: "string" }, seconds: { type: "number" }, loop: { type: "boolean" }, at_seconds: { type: "number" } }, ["description"]),
      run: async (i) => place(await postJson("/api/providers/elevenlabs/sound", { text: i.description, duration_s: i.seconds === undefined ? 5 : num(i.seconds, "seconds", 0.5, 30), loop: !!i.loop }), at(i.at_seconds)),
    },
    {
      name: "mark_speech",
      description: "Marks where people speak in a clip as Speech regions on the timeline (Silero VAD on this machine, under music too). Returns the stretches in session seconds.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip") }, ["track_id", "clip_id"]),
      run: async (i) => {
        const { c } = clipOf(i.track_id, i.clip_id);
        const { inS, outS } = range(c);
        const regions = ((await engineJson(`/api/media/${c.mediaId}/speech`)).regions as { start: number; end: number }[]).map((r) => ({ start: Math.max(r.start, inS), end: Math.min(r.end, outS) })).filter((r) => r.end > r.start);
        const marks = regions.map((r) => ({ type: "add-region" as const, start: c.start + samples(r.start - inS), end: c.start + samples(r.end - inS), label: "Speech" }));
        if (marks.length) engine.dispatch({ type: "batch", commands: marks });
        return { regions: marks.map((m) => ({ start: sec(m.start), end: sec(m.end) })) };
      },
    },
    {
      name: "separate_clip",
      description: "Splits a clip into speech, music and effects on three new tracks under it that add up to it exactly (on this machine; music by a trained model where it is installed, by rule otherwise, and the effects part is returned as ambience); the original track is muted when the clip is alone on it. Returns the three tracks and the method.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip") }, ["track_id", "clip_id"]),
      run: async (i) => {
        const { t, c } = clipOf(i.track_id, i.clip_id);
        const { inS, outS } = range(c);
        const out = await postJson(`/api/media/${c.mediaId}/three-way`, { start: inS, end: outS });
        const parts = (["speech", "music", "ambience"] as const).map((k) => ({ part: k, ...place(out[k], c.start) }));
        if (t.clips.length === 1) engine.dispatch({ type: "set-track-mute", trackId: t.id, mute: true });
        return { parts, method: out.method, original_muted: t.clips.length === 1 };
      },
    },
    {
      name: "dub_clip",
      description: "Dubs a clip's speech into another language on a new track under it, each sentence where it was said: engine local (Whisper, Argos Translate and Kokoro on this machine; es, fr, it or pt once installed) or elevenlabs (needs ELEVENLABS_API_KEY; waits for the job).",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), language: { type: "string", description: "es, fr, it or pt" }, engine: { type: "string", enum: ["local", "elevenlabs"] } }, ["track_id", "clip_id", "language"]),
      run: async (i) => {
        const { c } = clipOf(i.track_id, i.clip_id);
        const lang = String(i.language);
        if (i.engine === "elevenlabs") {
          const job = await postJson("/api/providers/elevenlabs/dub", { media_id: c.mediaId, target_lang: lang });
          for (let k = 0; k < 240; k++) {
            const st = await engineJson(`/api/providers/elevenlabs/dub/${encodeURIComponent(job.job)}?lang=${encodeURIComponent(lang)}`);
            if (st.status === "dubbed") return place(st.media, c.start);
            if (st.status === "failed" || st.status === "error") throw new Error(`ElevenLabs could not dub it: ${st.error ?? st.status}`);
            await new Promise((r) => setTimeout(r, 5000));
          }
          throw new Error("ElevenLabs had not finished after 20 minutes");
        }
        const { inS, outS } = range(c);
        const out = await postJson(`/api/providers/local-dub/${encodeURIComponent(lang)}`, { media_id: c.mediaId, start: inS, end: outS });
        return { ...place(out.media, c.start), sentences: (out.sentences as { start: number; translated?: string }[]).map((x) => ({ at: x.start, translated: x.translated })) };
      },
    },
    {
      name: "transcribe_with_speakers",
      description: "A clip's words with who said each and sounds such as laughter, through ElevenLabs Scribe v2 (needs ELEVENLABS_API_KEY); times in the media's seconds. get_transcript is the free, on-machine way to the words alone.",
      input_schema: obj({ track_id: id("track"), clip_id: id("clip"), speakers: { type: "integer", description: "How many speakers, when known" } }, ["track_id", "clip_id"]),
      run: async (i) => {
        const { c } = clipOf(i.track_id, i.clip_id);
        const out = await postJson("/api/providers/elevenlabs/transcribe", { media_id: c.mediaId, speakers: i.speakers || undefined });
        return { language: out.language, words: out.words };
      },
    },
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const definitions = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

  const entry = (kind: string, text: string) => {
    const li = document.createElement("li");
    li.className = `fw-agent-${kind}`;
    li.textContent = text;
    log.append(li);
    li.scrollIntoView({ block: "nearest" });
  };
  let running = false;
  let stopAsked = false;
  let runUndo = 0;

  const run = async () => {
    const instruction = ask.value.trim();
    if (!instruction || running) return;
    running = true;
    stopAsked = false;
    control("run").disabled = true;
    control("stop").disabled = false;
    control("undo").disabled = true;
    const depth0 = engine.get("history").undoDepth;
    engine.setAuthor("agent");
    entry("you", instruction);
    ask.value = "";
    const messages: { role: string; content: unknown }[] = [{ role: "user", content: instruction }];
    try {
      for (let turn = 0; turn < 12 && !stopAsked; turn++) {
        setText(state, "Thinking...");
        const reply = (await engineJson("/api/agent/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system: SYSTEM, messages, tools: definitions }) })) as { content: Block[]; stop_reason: string };
        messages.push({ role: "assistant", content: reply.content });
        for (const b of reply.content) if (b.type === "text" && b.text) entry("says", b.text);
        const calls = reply.content.filter((b) => b.type === "tool_use");
        if (!calls.length || reply.stop_reason !== "tool_use") break;
        const results = [];
        for (const call of calls) {
          const tool = byName.get(String(call.name));
          try {
            if (!tool) throw new Error(`There is no tool named ${String(call.name)}.`);
            setText(state, `Running ${tool.name}...`);
            const out = await tool.run(call.input ?? {});
            entry("did", `${tool.name} ${JSON.stringify(call.input ?? {})}`);
            results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            entry("failed", `${String(call.name)}: ${message}`);
            results.push({ type: "tool_result", tool_use_id: call.id, content: message, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
      }
      setText(state, stopAsked ? "Stopped" : "");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry("failed", message);
      setText(state, "");
    } finally {
      engine.setAuthor("you");
      runUndo = engine.get("history").undoDepth - depth0;
      control("undo").disabled = runUndo <= 0;
      control("run").disabled = false;
      control("stop").disabled = true;
      running = false;
    }
  };

  const open = () => {
    dock.hidden = false;
    button.setAttribute("aria-pressed", "true");
    ask.focus();
  };
  const hide = () => {
    dock.hidden = true;
    button.setAttribute("aria-pressed", "false");
  };
  button.addEventListener("click", () => (dock.hidden ? open() : hide()));
  dock.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-agent]")?.dataset.agent;
    if (act === "hide") hide();
    else if (act === "new" && !running) {
      log.replaceChildren();
      runUndo = 0;
      control("undo").disabled = true;
      setText(state, "");
      ask.focus();
    } else if (act === "run") void run();
    else if (act === "stop") stopAsked = true;
    else if (act === "undo" && runUndo > 0) {
      for (let k = 0; k < runUndo; k++) engine.undo();
      entry("did", `Undid the run (${runUndo} change${runUndo === 1 ? "" : "s"})`);
      runUndo = 0;
      control("undo").disabled = true;
    }
  });
  ask.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void run();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "/" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    e.preventDefault();
    if (dock.hidden) open();
    else ask.focus();
  });
  host.addEventListener("fw-ask-agent", (e) => {
    const text = (e as CustomEvent<string>).detail ?? "";
    if (dock.hidden) open();
    if (text && !ask.value.trim()) ask.value = text;
    ask.focus();
    ask.setSelectionRange(ask.value.length, ask.value.length);
  });
  const context = dock.querySelector<HTMLElement>(".fw-agent-context");
  const describe = (ids: string[]) => {
    const doc = engine.get("document");
    for (const t of doc.tracks) {
      const c = t.clips.find((x) => x.id === ids[0]);
      if (c) return `Looking at ${t.name}, ${(doc.media[c.mediaId]?.name ?? "a clip").replace(/\.[^.]+$/, "")}`;
    }
    return "";
  };
  let looking: string[] = [];
  const renderContext = () => {
    const text = describe(looking);
    setText(context, text);
    if (context && context.hidden !== !text) context.hidden = !text;
  };
  host.addEventListener("fw-selection", (e) => {
    looking = (e as CustomEvent<string[]>).detail ?? [];
    renderContext();
  });
  engine.subscribe("document", renderContext);

  // History: the session's edits oldest first, each with who made it; a click undoes or redoes to that point
  const body = dock.querySelector<HTMLElement>(".fw-agent-body") as HTMLElement;
  const historyView = dock.querySelector<HTMLElement>(".fw-agent-history") as HTMLElement;
  const historyList = dock.querySelector<HTMLOListElement>(".fw-history-list") as HTMLOListElement;
  const historyEmpty = dock.querySelector<HTMLElement>(".fw-history-empty");
  interface Row {
    key: string;
    label: string;
    by: HistoryEntry["by"] | null;
    step: number;
  }
  const renderHistory = () => {
    if (historyView.hidden) return;
    const { done, undone } = engine.historyEntries();
    const rows: Row[] = [
      { key: "start", label: "Session start", by: null, step: 0 },
      ...done.map((e, i) => ({ key: String(e.id), label: e.label, by: e.by, step: i + 1 })),
      ...[...undone].reverse().map((e, j) => ({ key: String(e.id), label: e.label, by: e.by, step: done.length + 1 + j })),
    ];
    const now = done.length;
    const fill = (li: HTMLElement, r: Row) => {
      const btn = li.firstElementChild as HTMLElement;
      if (btn.dataset.step !== String(r.step)) btn.dataset.step = String(r.step);
      setText(li.querySelector(".fw-history-label"), r.label);
      const by = li.querySelector<HTMLElement>(".fw-history-by");
      setText(by, r.by === "agent" ? "Claude" : r.by === "you" ? "you" : "");
      if (by && by.dataset.by !== (r.by ?? "")) by.dataset.by = r.by ?? "";
      const state = r.step === now ? "now" : r.step > now ? "undone" : "done";
      if (li.dataset.state !== state) li.dataset.state = state;
      if (state === "now") btn.setAttribute("aria-current", "step");
      else btn.removeAttribute("aria-current");
    };
    patchList(historyList, rows, {
      key: (r) => r.key,
      create: (r) => {
        const li = document.createElement("li");
        li.className = "fw-history-row";
        li.innerHTML = `<button type="button" class="fw-history-btn"><span class="fw-history-label"></span><span class="fw-history-by"></span></button>`;
        fill(li, r);
        return li;
      },
      update: fill,
    });
    if (historyEmpty && historyEmpty.hidden !== rows.length > 1) historyEmpty.hidden = rows.length > 1;
  };
  historyList.addEventListener("click", (e) => {
    const step = Number((e.target as HTMLElement).closest<HTMLElement>(".fw-history-btn")?.dataset.step);
    if (!Number.isFinite(step)) return;
    const now = engine.historyEntries().done.length;
    for (let k = now; k > step; k--) engine.undo();
    for (let k = now; k < step; k++) engine.redo();
  });
  dock.querySelector(".fw-agent-tabs")?.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-agent-tab]");
    if (!tab) return;
    const showHistory = tab.dataset.agentTab === "history";
    for (const t of dock.querySelectorAll<HTMLElement>("[data-agent-tab]")) t.setAttribute("aria-selected", String(t === tab));
    if (body.hidden !== showHistory) body.hidden = showHistory;
    if (historyView.hidden !== !showHistory) historyView.hidden = !showHistory;
    renderHistory();
    if (showHistory) historyList.lastElementChild?.scrollIntoView({ block: "nearest" });
  });
  engine.subscribe("history", renderHistory);
}
