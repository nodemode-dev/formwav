/**
 * AA-07, Clip sound: a clip typed as dialogue, music, sound effects or ambience, each type with its own
 * tasks and presets (built in, or saved on this machine). Apply runs the ticked tasks as a chain of the engine's
 * effects on the clip's audio, loudness last so it measures the finished sound, and writes ducking into the clip's
 * gain envelope under the session's dialogue clips; all of it is one change.
 */
import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

type SoundType = "dialogue" | "music" | "effects" | "ambience";
type Task = { id: string; label: string; min: number; max: number; step: number; unit: string; value: number; choices?: [number, string][] };
type Settings = Record<string, { on: boolean; value: number }>;
type Preset = { name: string; settings: Settings };

const loudness = (value: number): Task => ({ id: "loudness", label: "Unify loudness to", min: -36, max: -8, step: 1, unit: "LUFS", value });
const TASKS: Record<SoundType, Task[]> = {
  dialogue: [
    loudness(-23),
    { id: "rumble", label: "Reduce rumble", min: 0, max: 1, step: 1, unit: "", value: 1, choices: [[1, "below 80 Hz"]] },
    { id: "hum", label: "Remove hum", min: 50, max: 60, step: 10, unit: "", value: 60, choices: [[50, "50 Hz"], [60, "60 Hz"]] },
    { id: "noise", label: "Reduce noise by", min: 0, max: 40, step: 1, unit: "dB", value: 12 },
    { id: "dereverb", label: "Reduce reverb", min: 0, max: 100, step: 5, unit: "%", value: 40 },
    { id: "deess", label: "De-ess by", min: 0, max: 24, step: 1, unit: "dB", value: 8 },
    { id: "dynamics", label: "Dynamics", min: 0, max: 100, step: 5, unit: "%", value: 30 },
    { id: "clarity", label: "Clarity (presence)", min: 0, max: 8, step: 0.5, unit: "dB", value: 3 },
  ],
  music: [loudness(-25), { id: "duck", label: "Duck under dialogue by", min: 3, max: 30, step: 1, unit: "dB", value: 12 }],
  effects: [loudness(-21), { id: "reverb", label: "Reverb", min: 0, max: 100, step: 5, unit: "%", value: 25 }],
  ambience: [
    loudness(-30),
    { id: "reverb", label: "Reverb", min: 0, max: 100, step: 5, unit: "%", value: 20 },
    { id: "width", label: "Stereo width", min: 0, max: 200, step: 5, unit: "%", value: 150 },
    { id: "duck", label: "Duck under dialogue by", min: 3, max: 30, step: 1, unit: "dB", value: 6 },
  ],
};
const set = (pairs: [string, number][]): Settings => Object.fromEntries(pairs.map(([id, value]) => [id, { on: true, value }]));
const BUILT_IN: Record<SoundType, Preset[]> = {
  dialogue: [
    { name: "Balanced voice", settings: set([["loudness", -23], ["rumble", 1], ["deess", 6], ["dynamics", 30]]) },
    { name: "Podcast voice", settings: set([["loudness", -16], ["rumble", 1], ["noise", 12], ["deess", 8], ["dynamics", 50], ["clarity", 3]]) },
    { name: "Clean up noisy dialogue", settings: set([["loudness", -23], ["rumble", 1], ["hum", 60], ["noise", 20], ["dereverb", 40]]) },
  ],
  music: [
    { name: "Balanced background music", settings: set([["loudness", -25], ["duck", 12]]) },
    { name: "Music bed under voice", settings: set([["loudness", -28], ["duck", 18]]) },
  ],
  effects: [
    { name: "Balanced effects", settings: set([["loudness", -21]]) },
    { name: "Effects in a room", settings: set([["loudness", -21], ["reverb", 25]]) },
  ],
  ambience: [
    { name: "Balanced ambience", settings: set([["loudness", -30], ["duck", 6]]) },
    { name: "Wide outdoor ambience", settings: set([["loudness", -30], ["width", 150], ["duck", 6]]) },
  ],
};
const STORE = "formwav:essential-sound-presets";

function ownPresets(): Partial<Record<SoundType, Preset[]>> {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Partial<Record<SoundType, Preset[]>>) : {};
  } catch {
    return {};
  }
}

/** The ticked tasks as effect steps, repairs first and loudness last. */
function chainFor(settings: Settings): { name: string; label: string; params: Record<string, number> }[] {
  const on = (id: string) => settings[id]?.on === true;
  const v = (id: string) => Number(settings[id]?.value ?? 0);
  const steps: { name: string; label: string; params: Record<string, number> }[] = [];
  if (on("rumble")) steps.push({ name: "rumble-cut", label: "Reduce rumble", params: {} });
  if (on("hum")) steps.push({ name: "de-hum-adaptive", label: "Remove hum", params: { mains: v("hum") === 50 ? 50 : 60, harmonics: 4 } });
  if (on("noise") && v("noise") > 0) steps.push({ name: "noise-reduce", label: "Reduce noise", params: { amount: v("noise") } });
  if (on("dereverb") && v("dereverb") > 0) steps.push({ name: "dereverb", label: "Reduce reverb", params: { amount: v("dereverb"), rt60: 0.8, floor: 18 } });
  if (on("deess") && v("deess") > 0) steps.push({ name: "de-ess-spectral", label: "De-ess", params: { threshold: -30, reduce: v("deess") } });
  if (on("dynamics") && v("dynamics") > 0) steps.push({ name: "compress", label: "Dynamics", params: { threshold: -10 - v("dynamics") * 0.2, ratio: 1 + v("dynamics") * 0.05 } });
  if (on("clarity") && v("clarity") > 0) steps.push({ name: "presence-lift", label: "Clarity", params: { freq: 3000, gain: v("clarity") } });
  if (on("reverb") && v("reverb") > 0) steps.push({ name: "reverb", label: "Reverb", params: { size: 1.5, decay: 0.8, mix: v("reverb") * 0.5 } });
  if (on("width") && v("width") !== 100) steps.push({ name: "stereo-width", label: "Stereo width", params: { width: v("width") } });
  if (on("loudness")) steps.push({ name: "loudness-streaming", label: "Unify loudness", params: { target: v("loudness") } });
  return steps;
}

/** Envelope points (at the clip's media frames) ducking it by `db` wherever the session's other dialogue clips play,
 *  fading down over 0.15 s before each and back up over 0.4 s after, overlapping spans joined. */
function duckPoints(doc: SessionDoc, clip: Clip, media: MediaRef, db: number): { at: number; db: number }[] {
  const rate = doc.sampleRate;
  const spans = doc.tracks
    .flatMap((t) => t.clips.filter((c) => c.soundType === "dialogue" && c.id !== clip.id).map((c) => [c.start, c.start + c.length] as [number, number]))
    .filter(([a, b]) => a < clip.start + clip.length && b > clip.start)
    .sort((x, y) => x[0] - y[0]);
  const joined: [number, number][] = [];
  for (const s of spans) {
    const last = joined[joined.length - 1];
    if (last && s[0] <= last[1] + 0.55 * rate) last[1] = Math.max(last[1], s[1]);
    else joined.push([...s]);
  }
  const toMedia = (session: number) => Math.round(clip.sourceIn + ((session - clip.start) * media.sampleRate) / rate);
  const lo = clip.sourceIn;
  const hi = clip.sourceIn + Math.round((clip.length * media.sampleRate) / rate);
  const points: { at: number; db: number }[] = [];
  for (const [a, b] of joined) {
    for (const [at, level] of [[a - 0.15 * rate, 0], [a, -db], [b, -db], [b + 0.4 * rate, 0]] as [number, number][]) {
      points.push({ at: Math.min(hi, Math.max(lo, toMedia(at))), db: level });
    }
  }
  return points;
}

export function mountEssentialSound(body: HTMLElement, engine: Engine, find: (doc: SessionDoc) => { track: Track; clip: Clip } | null, notice: HTMLElement | null): { sync: () => void } {
  const typePick = body.querySelector<HTMLSelectElement>('[data-es="type"]');
  const presetPick = body.querySelector<HTMLSelectElement>('[data-es="preset"]');
  const tasksBox = body.querySelector<HTMLElement>('[data-es="tasks"]');
  const say = (text: string) => notice && setText(notice, text);
  let shownType: SoundType | "" = "";

  const presetsFor = (type: SoundType): Preset[] => [...BUILT_IN[type], ...(ownPresets()[type] ?? [])];
  const drawTasks = (type: SoundType | "", settings?: Settings) => {
    if (!tasksBox || !presetPick) return;
    shownType = type;
    tasksBox.replaceChildren();
    presetPick.replaceChildren();
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = type ? "Custom" : "Choose a type first";
    presetPick.append(custom);
    if (!type) return;
    for (const p of presetsFor(type)) {
      const option = document.createElement("option");
      option.value = p.name;
      option.textContent = p.name;
      presetPick.append(option);
    }
    for (const task of TASKS[type]) {
      const row = document.createElement("label");
      row.className = "fw-field";
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.dataset.esOn = task.id;
      tick.checked = settings?.[task.id]?.on ?? false;
      const name = document.createElement("span");
      name.textContent = task.label;
      let input: HTMLInputElement | HTMLSelectElement;
      if (task.choices) {
        const select = document.createElement("select");
        for (const [value, text] of task.choices) {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = text;
          select.append(option);
        }
        input = select;
      } else {
        const number = document.createElement("input");
        number.type = "number";
        number.min = String(task.min);
        number.max = String(task.max);
        number.step = String(task.step);
        input = number;
      }
      input.dataset.esVal = task.id;
      input.value = String(settings?.[task.id]?.value ?? task.value);
      const unit = document.createElement("span");
      unit.textContent = task.unit;
      row.append(tick, name, input, unit);
      tasksBox.append(row);
    }
  };
  const readSettings = (): Settings => {
    const out: Settings = {};
    for (const tick of body.querySelectorAll<HTMLInputElement>("[data-es-on]")) {
      const id = tick.dataset.esOn ?? "";
      const input = body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-es-val="${id}"]`);
      out[id] = { on: tick.checked, value: Number(input?.value ?? 0) };
    }
    return out;
  };

  typePick?.addEventListener("change", () => {
    const hit = find(engine.get("document"));
    const type = (typePick.value || null) as SoundType | null;
    if (hit) engine.dispatch({ type: "set-clip-type", trackId: hit.track.id, clipId: hit.clip.id, soundType: type });
    drawTasks(type ?? "");
    say(type ? `Typed as ${typePick.selectedOptions[0]?.textContent ?? type}: pick a preset or tick its tasks, then Apply` : "Type cleared");
  });
  presetPick?.addEventListener("change", () => {
    const type = shownType;
    const preset = type ? presetsFor(type).find((p) => p.name === presetPick.value) : undefined;
    if (!type || !preset) return;
    drawTasks(type, preset.settings);
    presetPick.value = preset.name;
    say(`Preset ${preset.name}: Apply to run it on the clip`);
  });
  body.addEventListener("click", async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-es-act]")?.dataset.esAct;
    if (!act) return;
    const doc = engine.get("document");
    const hit = find(doc);
    const type = shownType;
    if (!hit || !type) {
      say("Select a clip and give it a type first");
      return;
    }
    const settings = readSettings();
    if (act === "save") {
      const name = window.prompt("Name this preset")?.trim();
      if (!name) return;
      const all = ownPresets();
      all[type] = [...(all[type] ?? []).filter((p) => p.name !== name), { name, settings }];
      try {
        localStorage.setItem(STORE, JSON.stringify(all));
      } catch {
        say("Could not save the preset on this machine");
        return;
      }
      drawTasks(type, settings);
      if (presetPick) presetPick.value = name;
      say(`Saved the preset ${name}`);
      return;
    }
    const media = doc.media[hit.clip.mediaId];
    const steps = chainFor(settings);
    const duck = settings.duck?.on ? Number(settings.duck.value) : 0;
    if (!steps.length && !duck) {
      say("Tick at least one task");
      return;
    }
    const commands: Parameters<Engine["dispatch"]>[0][] = [];
    try {
      let mediaId = hit.clip.mediaId;
      let last: MediaRef | null = null;
      for (const [i, s] of steps.entries()) {
        say(`Task ${i + 1} of ${steps.length}: ${s.label}...`);
        const res = await fetch(`/api/media/${mediaId}/effect?name=${encodeURIComponent(s.name)}&params=${encodeURIComponent(JSON.stringify(s.params))}`, { method: "POST" });
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) throw new Error(`${s.label}: ${typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`}`);
        last = out as unknown as MediaRef;
        mediaId = last.id;
      }
      if (last) commands.push({ type: "set-clip-media", trackId: hit.track.id, clipId: hit.clip.id, media: last });
      // an empty point list would clear an envelope drawn by hand, so ducking writes only when dialogue overlaps
      const points = duck && media ? duckPoints(doc, hit.clip, last ?? media, duck) : [];
      if (points.length) commands.push({ type: "set-clip-envelope", trackId: hit.track.id, clipId: hit.clip.id, points });
      if (commands.length) engine.dispatch({ type: "batch", commands });
      say(`Applied ${steps.length} task${steps.length === 1 ? "" : "s"}${points.length ? `, ducked ${duck} dB under dialogue` : duck ? "; no dialogue clip overlaps this one, so nothing was ducked" : ""}`);
    } catch (err) {
      say(`Could not apply the tasks: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return {
    /** The type picker follows the selected clip; its tasks are drawn afresh when the type shown changes. */
    sync: () => {
      const hit = find(engine.get("document"));
      const type = (hit?.clip.soundType ?? "") as SoundType | "";
      if (typePick && typePick.value !== type) typePick.value = type;
      if (type !== shownType) drawTasks(type);
    },
  };
}
