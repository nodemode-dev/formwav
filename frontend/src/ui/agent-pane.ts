import type { Engine, MediaRef, Track } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

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
  "apply_effect_to_clip. Make the smallest set of changes that does what was asked; every change is undoable. When you " +
  "are done, say in one or two sentences what you changed.";

export function mountAgent(host: HTMLElement, engine: Engine): void {
  const before = host.querySelector<HTMLButtonElement>('[data-action="terminal"]') ?? host.querySelector<HTMLButtonElement>('[data-action="export"]');
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-ibtn";
  button.dataset.action = "agent";
  button.title = "Ask the assistant to edit the open session";
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Agent";
  before?.before(button);

  const dock = document.createElement("section");
  dock.className = "fw-term fw-agent";
  dock.hidden = true;
  dock.setAttribute("aria-label", "Agent");
  dock.innerHTML = `<div class="fw-term-head"><span class="fw-term-title">Agent</span><span class="fw-term-state" aria-live="polite"></span><button type="button" class="fw-ibtn" data-agent="undo" disabled>Undo run</button><button type="button" class="fw-ibtn" data-agent="hide">Hide</button></div><div class="fw-agent-body"><ol class="fw-agent-log" aria-live="polite"></ol><div class="fw-agent-ask"><textarea rows="2" placeholder="Tell the assistant what to do with this session" aria-label="Instruction for the assistant"></textarea><button type="button" class="fw-ibtn fw-agent-run" data-agent="run">Run</button><button type="button" class="fw-ibtn" data-agent="stop" disabled>Stop</button></div></div>`;
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  if (transport) transport.before(dock);
  else host.append(dock);
  const log = dock.querySelector<HTMLOListElement>(".fw-agent-log") as HTMLOListElement;
  const ask = dock.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
  const state = dock.querySelector<HTMLElement>(".fw-term-state");
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
          tracks: doc.tracks.map((t) => ({ id: t.id, name: t.name, gain_db: t.gainDb, pan: t.pan ?? 0, mute: t.mute, solo: t.solo, clips: t.clips.map((c) => ({ id: c.id, media_id: c.mediaId, media: doc.media[c.mediaId]?.name, start_s: sec(c.start), length_s: sec(c.length), gain_db: c.gainDb, fade_in_s: sec(c.fadeIn ?? 0), fade_out_s: sec(c.fadeOut ?? 0) })) })),
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
    else if (act === "run") void run();
    else if (act === "stop") stopAsked = true;
    else if (act === "undo" && runUndo > 0) {
      for (let k = 0; k < runUndo; k++) engine.undo();
      entry("did", `Undid the run (${runUndo} change${runUndo === 1 ? "" : "s"})`);
      runUndo = 0;
      control("undo").disabled = true;
    }
  });
  ask.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
    }
  });
}
