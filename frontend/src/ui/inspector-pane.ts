import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import type { FadeShape, TrackFx } from "../engine/document";
import { loadPresets, savePresets, type Preset } from "../io/presets-client";
import { setText } from "../vendor/nodemode/dom-stable";

const BODY = `
<p class="fw-empty-note fw-insp-empty"></p>
<div class="fw-insp-section fw-insp-clip" hidden>
  <div class="fw-insp-head">Clip</div>
  <label class="fw-field"><span>Start</span><input type="number" step="0.001" min="0" data-f="start"><output>s</output></label>
  <div class="fw-field"><span>Length</span><output data-o="length"></output><span></span></div>
  <label class="fw-field"><span>Clip gain</span><input type="range" min="-24" max="24" step="0.1" data-f="gain" data-default="0"><output data-o="gain"></output></label>
  <label class="fw-field"><span>Pitch</span><input type="range" min="-12" max="12" step="1" value="0" data-pitch data-default="0" title="Non-destructive: the original is kept"><output data-pitch-out>0 st</output></label>
  <label class="fw-field"><span>Fade in</span><input type="number" step="0.01" min="0" data-f="fadeIn"><output>s</output></label>
  <label class="fw-field"><span>Fade out</span><input type="number" step="0.01" min="0" data-f="fadeOut"><output>s</output></label>
  <label class="fw-field"><span>Fade curve</span><select data-f="shape"><option value="linear">Linear</option><option value="equal-power">Equal power</option><option value="s-curve">S-curve</option><option value="exponential">Exponential</option></select><span></span></label>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-clip-act="crossfade" title="Fade this clip and the one it overlaps on its track across each other, equal power" disabled>Crossfade overlap</button></div>
</div>
<div class="fw-insp-section fw-insp-effects" hidden>
  <div class="fw-insp-head">Effects</div>
  <button type="button" class="fw-ibtn fw-btn-export fw-voice-go" data-fx="enhance" title="formcut's voice-clean: rumble cut, denoise, gentle compression and a limiter">Enhance speech</button>
  <input type="search" class="fw-fx-search" data-fx="search" placeholder="Search effects" aria-label="Search effects">
  <label class="fw-field fw-field-stack"><span>Effect</span><select data-fx="pick"></select></label>
  <div class="fw-fx-params"></div>
  <div class="fw-analyze-buttons"><select data-preset="fx" aria-label="Preset for this effect"><option value="">Presets</option></select><button type="button" class="fw-ibtn" data-preset="fx-save">Save preset</button><button type="button" class="fw-ibtn" data-preset="fx-delete">Delete</button></div>
  <div class="fw-analyze-buttons"><select data-eqm="ref" aria-label="Reference clip for EQ match"></select><button type="button" class="fw-ibtn" data-eqm="go" title="Give this clip (or the selected range) the tonal balance of the reference">Match EQ</button><button type="button" class="fw-ibtn" data-eqm="learn" title="Use the selected range as the EQ match reference">Learn reference</button></div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-fx="apply">Apply to this clip</button><button type="button" class="fw-ibtn" data-fx="apply-all">Apply to all clips</button></div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-fx="chain-add">Add to chain</button><button type="button" class="fw-ibtn" data-fx="chain-apply" hidden>Apply chain</button><button type="button" class="fw-ibtn" data-fx="chain-clear" hidden>Clear chain</button></div>
  <ol class="fw-chain" hidden></ol>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-fx="separate" title="Split into vocals, drums, bass and other on new tracks (Demucs)">Separate into stems</button><button type="button" class="fw-ibtn" data-fx="deconstruct" title="Split into tonal, noisy and transient parts on new tracks">Deconstruct</button></div>
  <div class="fw-analyze-buttons"><input type="text" class="fw-sam-desc" data-sam="desc" maxlength="80" placeholder="Describe a sound" title="What to isolate, for example: man speaking, car horn" aria-label="Sound to isolate"><button type="button" class="fw-ibtn" data-sam="go" title="Put the described sound and everything else on new tracks (SAM-Audio); a selected range marks where the sound occurs">Isolate sound</button></div>
  <div class="fw-sam-status" data-sam-status></div>
</div>
<div class="fw-insp-section fw-insp-analyze" hidden>
  <div class="fw-insp-head">Analyze</div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-an="stats">Statistics</button><button type="button" class="fw-ibtn" data-an="spectrogram">Spectrogram</button><button type="button" class="fw-ibtn" data-an="mic">Mic check</button><button type="button" class="fw-ibtn" data-an="transients" title="Put a marker at each transient in this clip">Transients</button></div>
  <label class="fw-field"><span>Sensitivity</span><input type="number" min="0" max="1" step="0.05" value="0.5" data-an-sens aria-label="Transient sensitivity, 0 strong attacks only to 1 subtle ones"><span></span></label>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-an="split-transients" title="Cut this clip at each transient">Split at transients</button></div>
  <ul class="fw-mic-findings" hidden></ul>
  <dl class="fw-stats"></dl>
  <img class="fw-spectrogram" alt="Spectrogram of the selected clip" hidden>
</div>
<div class="fw-insp-section fw-insp-track" hidden>
  <div class="fw-insp-head fw-insp-track-name">Track</div>
  <label class="fw-field"><span>Name</span><input type="text" maxlength="60" data-track-name aria-label="Track name"><span></span></label>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-track-act="delete" title="Delete this track and its clips (undo brings it back)">Delete track</button></div>
  <label class="fw-field"><span>Volume</span><input type="range" min="-60" max="12" step="0.1" data-f="volume" data-default="0"><output data-o="volume"></output></label>
  <label class="fw-field"><span>Pan</span><input type="range" min="-1" max="1" step="0.01" data-f="pan" data-default="0"><output data-o="pan"></output></label>
  <label class="fw-field"><span>Duck under</span><select data-duck="control"></select><span></span></label>
  <label class="fw-field"><span>By</span><input type="range" min="3" max="30" step="1" value="12" data-duck="amount" data-default="12"><output data-duck-out>12 dB</output></label>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-duck="go" title="Lower this track while the chosen track is active, as volume automation you can edit">Duck this track</button></div>
  <div class="fw-insp-head fw-rtfx-head">Realtime effects</div>
  <div class="fw-rtfx-list" data-scope="track"></div>
  <div class="fw-analyze-buttons" data-scope="track"><select data-rtfx="kind" aria-label="Realtime effect to add to the track"><option value="highpass">High-pass</option><option value="lowpass">Low-pass</option><option value="peak">Peak EQ</option><option value="lowshelf">Low shelf</option><option value="highshelf">High shelf</option><option value="compressor">Compressor</option></select><button type="button" class="fw-ibtn" data-rtfx="add">Add</button></div>
</div>
<div class="fw-insp-section fw-insp-bus" hidden>
  <div class="fw-insp-head fw-bus-head">Bus effects</div>
  <div class="fw-rtfx-list" data-scope="bus"></div>
  <div class="fw-analyze-buttons" data-scope="bus"><select data-rtfx="kind" aria-label="Realtime effect to add to the bus"><option value="highpass">High-pass</option><option value="lowpass">Low-pass</option><option value="peak">Peak EQ</option><option value="lowshelf">Low shelf</option><option value="highshelf">High shelf</option><option value="compressor">Compressor</option></select><button type="button" class="fw-ibtn" data-rtfx="add">Add</button></div>
</div>
<div class="fw-insp-section fw-insp-master" hidden>
  <div class="fw-insp-head">Master effects</div>
  <div class="fw-rtfx-list" data-scope="master"></div>
  <div class="fw-analyze-buttons" data-scope="master"><select data-rtfx="kind" aria-label="Realtime effect to add to the master"><option value="highpass">High-pass</option><option value="lowpass">Low-pass</option><option value="peak">Peak EQ</option><option value="lowshelf">Low shelf</option><option value="highshelf">High shelf</option><option value="compressor">Compressor</option></select><button type="button" class="fw-ibtn" data-rtfx="add">Add</button></div>
</div>
<div class="fw-insp-section fw-insp-quantize" hidden>
  <div class="fw-insp-head">Quantize</div>
  <div class="fw-analyze-buttons"><label class="fw-q-field">BPM <input type="number" min="30" max="300" step="0.1" value="120" data-q="bpm"></label><button type="button" class="fw-ibtn" data-an="detect-bpm" title="Estimate the tempo from this clip's transients">Detect</button><label class="fw-q-field">Beats <input type="number" min="1" max="16" step="1" value="4" data-q="bpb" aria-label="Beats per bar"></label><select data-q="division" aria-label="Quantize division"><option value="4">1/4</option><option value="8" selected>1/8</option><option value="16">1/16</option></select><button type="button" class="fw-ibtn" data-an="quantize" title="Move the selected clips' starts to the nearest grid line">Quantize</button><button type="button" class="fw-ibtn" data-an="stretch-tempo" title="Re-time this clip from its detected tempo to the session tempo, keeping pitch">Stretch to tempo</button></div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-an="detect-key" title="Find this clip's musical key and its Camelot code">Detect key</button><span class="fw-key-readout" data-key-out>Key not set</span></div>
</div>`;

const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const panText = (v: number) => (v === 0 ? "C" : `${v < 0 ? "L" : "R"} ${Math.round(Math.abs(v) * 100)}`);

/** The selected clip and its track, as formcut's inspector shows the selected clip's properties. */
export function mountInspector(host: HTMLElement, engine: Engine): void {
  const body = host.querySelector<HTMLElement>(".fw-inspector-body");
  const meta = host.querySelector<HTMLElement>(".fw-pane-inspector .fw-pane-meta");
  if (!body) return;
  body.innerHTML = BODY;
  const field = <T extends HTMLElement>(name: string) => body.querySelector<T>(`[data-f="${name}"]`);
  const out = (name: string) => body.querySelector<HTMLElement>(`[data-o="${name}"]`);
  let selected: string[] = [];
  let range: { trackId: string; start: number; end: number } | null = null;

  const find = (doc: SessionDoc): { track: Track; clip: Clip } | null => {
    if (selected.length !== 1) {
      // A Smart Tool range with no single selected clip inspects the clip under the range's start.
      const r = range;
      if (!r) return null;
      const track = doc.tracks.find((t) => t.id === r.trackId);
      const clip = track?.clips.find((c) => c.start <= r.start && r.start < c.start + c.length);
      return track && clip ? { track, clip } : null;
    }
    for (const track of doc.tracks) {
      const clip = track.clips.find((c) => c.id === selected[0]);
      if (clip) return { track, clip };
    }
    return null;
  };
  const put = (el: HTMLInputElement | HTMLSelectElement | null, value: string) => {
    if (el && document.activeElement !== el && el.value !== value) el.value = value;
  };
  const show = (el: Element | null, on: boolean) => {
    if (el instanceof HTMLElement && el.hidden === on) el.hidden = !on;
  };

  const render = () => {
    const doc = engine.get("document");
    const hit = find(doc);
    show(body.querySelector(".fw-insp-empty"), !hit);
    show(body.querySelector(".fw-insp-clip"), !!hit);
    show(body.querySelector(".fw-insp-track"), !!hit);
    show(body.querySelector(".fw-insp-effects"), !!hit);
    show(body.querySelector(".fw-insp-analyze"), !!hit);
    show(body.querySelector(".fw-insp-quantize"), !!hit || selected.length > 0);
    if (!hit) {
      const seconds = doc.tracks.reduce((end, t) => Math.max(end, ...t.clips.map((c) => (c.start + c.length) / doc.sampleRate)), 0);
      setText(body.querySelector(".fw-insp-empty"), selected.length > 1 ? `${selected.length} clips selected. Select one clip to edit its properties.` : doc.tracks.length ? `Session: ${doc.tracks.length} track${doc.tracks.length === 1 ? "" : "s"}, ${(doc.sampleRate / 1000).toFixed(1)} kHz, ${seconds.toFixed(1)} s. Select a clip to edit its properties.` : "Import audio to begin. Selecting a clip shows its properties here.");
      setText(meta, "");
      return;
    }
    const { track, clip } = hit;
    const rate = doc.sampleRate;
    setText(meta, doc.media[clip.mediaId]?.name ?? "");
    put(field<HTMLInputElement>("start"), (clip.start / rate).toFixed(3));
    setText(out("length"), `${(clip.length / rate).toFixed(3)} s`);
    put(field<HTMLInputElement>("gain"), String(clip.gainDb));
    setText(out("gain"), db(clip.gainDb));
    put(field<HTMLInputElement>("fadeIn"), ((clip.fadeIn ?? 0) / rate).toFixed(2));
    put(field<HTMLInputElement>("fadeOut"), ((clip.fadeOut ?? 0) / rate).toFixed(2));
    put(field<HTMLSelectElement>("shape"), clip.fadeShape ?? "linear");
    setText(body.querySelector(".fw-insp-track-name"), `Track · ${track.name}`);
    const automated = track.automation;
    const volume = field<HTMLInputElement>("volume");
    const pan = field<HTMLInputElement>("pan");
    put(volume, String(track.gainDb));
    put(pan, String(track.pan ?? 0));
    if (volume && volume.disabled !== !!automated?.volume?.length) volume.disabled = !!automated?.volume?.length;
    if (pan && pan.disabled !== !!automated?.pan?.length) pan.disabled = !!automated?.pan?.length;
    setText(out("volume"), automated?.volume?.length ? "auto" : db(track.gainDb));
    setText(out("pan"), automated?.pan?.length ? "auto" : panText(track.pan ?? 0));
  };

  body.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.f === "gain") setText(out("gain"), db(Number(el.value)));
    else if (el.dataset.f === "volume") setText(out("volume"), db(Number(el.value)));
    else if (el.dataset.f === "pan") setText(out("pan"), panText(Number(el.value)));
  });
  body.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const doc = engine.get("document");
    const hit = find(doc);
    if (!hit) return;
    const { track, clip } = hit;
    const rate = doc.sampleRate;
    const num = Number(el.value);
    const trackId = track.id;
    const clipId = clip.id;
    switch (el.dataset.f) {
      case "start":
        if (Number.isFinite(num)) engine.dispatch({ type: "move-clip", trackId, clipId, start: Math.max(0, Math.round(num * rate)) });
        break;
      case "gain":
        engine.dispatch({ type: "set-clip-gain", trackId, clipId, gainDb: num });
        break;
      case "fadeIn":
      case "fadeOut": {
        const fadeIn = el.dataset.f === "fadeIn" ? Math.round(Math.max(0, num) * rate) : clip.fadeIn ?? 0;
        const fadeOut = el.dataset.f === "fadeOut" ? Math.round(Math.max(0, num) * rate) : clip.fadeOut ?? 0;
        if (Number.isFinite(num)) engine.dispatch({ type: "set-clip-fades", trackId, clipId, fadeIn, fadeOut, shape: clip.fadeShape });
        break;
      }
      case "shape":
        engine.dispatch({ type: "set-clip-fades", trackId, clipId, fadeIn: clip.fadeIn ?? 0, fadeOut: clip.fadeOut ?? 0, shape: el.value as FadeShape });
        break;
      case "volume":
        engine.dispatch({ type: "set-track-gain", trackId, gainDb: num });
        break;
      case "pan":
        engine.dispatch({ type: "set-track-pan", trackId, pan: num });
        break;
    }
    render();
  });

  const pick = body.querySelector<HTMLSelectElement>('[data-fx="pick"]');
  const paramsBox = body.querySelector<HTMLElement>(".fw-fx-params");
  type Control = { id: string; label: string; min: number; max: number; default: number; unit: string };
  const controls = new Map<string, Control[]>();
  const showControls = () => {
    const list = controls.get(pick?.value ?? "") ?? [];
    paramsBox?.replaceChildren(
      ...list.map((c) => {
        const row = document.createElement("label");
        row.className = "fw-field";
        const name = document.createElement("span");
        name.textContent = c.label;
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(c.min);
        input.max = String(c.max);
        input.step = c.max - c.min > 20 ? "1" : "0.1";
        input.value = String(c.default);
        input.dataset.default = String(c.default);
        input.dataset.param = c.id;
        const out = document.createElement("output");
        out.textContent = `${c.default} ${c.unit}`;
        input.addEventListener("input", () => {
          out.textContent = `${input.value} ${c.unit}`;
        });
        row.append(name, input, out);
        return row;
      }),
    );
  };
  const currentParams = () => Object.fromEntries([...(paramsBox?.querySelectorAll<HTMLInputElement>("input[data-param]") ?? [])].map((i) => [i.dataset.param, Number(i.value)]));
  const retiming = new Set<string>();
  host.addEventListener("fw-range", (e) => {
    range = (e as CustomEvent<{ trackId: string; start: number; end: number } | null>).detail;
    render();
  });
  pick?.addEventListener("change", showControls);
  // iZotope RX's module search: filter the Effects menu by name or group.
  const search = body.querySelector<HTMLInputElement>('[data-fx="search"]');
  search?.addEventListener("input", () => {
    if (!pick) return;
    const q = search.value.trim().toLowerCase();
    let first: HTMLOptionElement | null = null;
    for (const group of pick.querySelectorAll("optgroup")) {
      let any = false;
      for (const option of group.querySelectorAll("option")) {
        const hit = !q || (option.textContent ?? "").toLowerCase().includes(q) || group.label.toLowerCase().includes(q);
        if (option.hidden === hit) option.hidden = !hit;
        if (hit) {
          any = true;
          first ??= option;
        }
      }
      if (group.hidden === any) group.hidden = !any;
    }
    const current = pick.selectedOptions[0];
    if ((!current || current.hidden) && first) {
      pick.value = first.value;
      showControls();
    }
  });
  // Batch processing (Adobe Podcast's queue, RX's batch processor): the chosen effect on every clip, one undo step.
  body.addEventListener("click", async (e) => {
    if ((e.target as HTMLElement).closest<HTMLElement>("[data-fx]")?.dataset.fx !== "apply-all") return;
    const name = pick?.value;
    const doc = engine.get("document");
    const clips = doc.tracks.flatMap((t) => t.clips.map((c) => ({ track: t, clip: c })));
    if (!name || !clips.length) return;
    const label = pick?.selectedOptions[0]?.textContent ?? name;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>("button[data-fx]")];
    for (const b of buttons) b.disabled = true;
    const params = encodeURIComponent(JSON.stringify(currentParams()));
    const made = new Map<string, MediaRef>();
    setText(notice, `Applying ${label} to ${clips.length} clips...`);
    try {
      for (const id of new Set(clips.map((x) => x.clip.mediaId))) {
        const res = await fetch(`/api/media/${id}/effect?name=${encodeURIComponent(name)}&params=${params}`, { method: "POST" });
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        made.set(id, out as unknown as MediaRef);
      }
      const commands = clips.map((x) => ({ type: "set-clip-media" as const, trackId: x.track.id, clipId: x.clip.id, media: made.get(x.clip.mediaId) as MediaRef }));
      engine.dispatch({ type: "batch", commands } as Parameters<Engine["dispatch"]>[0]);
      setText(notice, `Applied ${label} to ${clips.length} clip${clips.length === 1 ? "" : "s"}`);
    } catch (err) {
      setText(notice, `Could not apply ${label} to all clips: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  });
  void fetch("/api/effects")
    .then((res) => (res.ok ? res.json() : []))
    .then((groups: { group: string; effects: { id: string; label: string; params?: Control[]; retimes?: boolean }[] }[]) => {
      if (!pick) return;
      for (const g of groups)
        for (const fx of g.effects) {
          if (fx.params?.length) controls.set(fx.id, fx.params);
          if (fx.retimes) retiming.add(fx.id);
        }
      pick.replaceChildren(
        ...groups.map((g) => {
          const group = document.createElement("optgroup");
          group.label = g.group;
          group.append(...g.effects.map((fx) => new Option(fx.label, fx.id)));
          return group;
        }),
      );
      showControls();
    })
    .catch(() => undefined);
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  body.addEventListener("click", async (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-fx]")?.dataset.fx;
    if (action !== "enhance" && action !== "apply") return;
    const hit = find(engine.get("document"));
    const name = action === "enhance" ? "voice-clean" : pick?.value;
    if (!hit || !name) return;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>("button[data-fx]")];
    for (const b of buttons) b.disabled = true;
    const label = action === "enhance" ? "Enhance speech" : pick?.selectedOptions[0]?.textContent ?? name;
    setText(notice, `Applying ${label}...`);
    try {
      // While a Smart Tool range exists it is the target (as Audacity processes its selection): the clip it overlaps on
      // its track, whichever piece is selected; otherwise the selected clip, whole.
      const r = range;
      const rangeTrack = r ? engine.get("document").tracks.find((t) => t.id === r.trackId) : undefined;
      const rangeClip = r && rangeTrack ? rangeTrack.clips.find((c) => c.start < r.end && r.start < c.start + c.length) : undefined;
      const target = rangeTrack && rangeClip ? { track: rangeTrack, clip: rangeClip } : hit;
      const inRange = rangeClip && r ? r : null;
      if (inRange && retiming.has(name)) throw new Error(`${label} changes timing, so it applies to whole clips: clear the range first`);
      const params = action === "apply" ? currentParams() : {};
      const res = await fetch(`/api/media/${target.clip.mediaId}/effect?name=${encodeURIComponent(name)}&params=${encodeURIComponent(JSON.stringify(params))}`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      if (inRange) {
        engine.dispatch({ type: "set-range-media", trackId: target.track.id, clipId: target.clip.id, start: inRange.start, end: inRange.end, media: out as unknown as MediaRef });
        const rate = engine.get("document").sampleRate;
        setText(notice, `Applied ${label} to ${((Math.min(inRange.end, target.clip.start + target.clip.length) - Math.max(inRange.start, target.clip.start)) / rate).toFixed(2)} s of the clip`);
      } else {
        engine.dispatch({ type: "set-clip-media", trackId: target.track.id, clipId: target.clip.id, media: out as unknown as MediaRef });
        setText(notice, `Applied ${label} to the clip`);
      }
    } catch (err) {
      setText(notice, `Could not apply ${label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  });

  const statsList = body.querySelector<HTMLElement>(".fw-stats");
  const spectrogram = body.querySelector<HTMLImageElement>(".fw-spectrogram");
  const STAT_LABELS: [string, string, (v: number) => string][] = [
    ["peakDb", "Peak", (v) => `${v.toFixed(2)} dBFS`],
    ["rmsDb", "RMS", (v) => `${v.toFixed(2)} dBFS`],
    ["dcOffset", "DC offset", (v) => v.toFixed(5)],
    ["crestFactor", "Crest factor", (v) => v.toFixed(2)],
    ["dynamicRangeDb", "Dynamic range", (v) => `${v.toFixed(1)} dB`],
    ["flatFactor", "Clipped runs", (v) => v.toFixed(1)],
  ];
  const clearAnalysis = () => {
    statsList?.replaceChildren();
    if (spectrogram && !spectrogram.hidden) spectrogram.hidden = true;
  };
  host.addEventListener("fw-selection", clearAnalysis);
  body.addEventListener("click", async (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-an]")?.dataset.an;
    const hit = find(engine.get("document"));
    if (!action || !hit) return;
    try {
      if (action === "stats") {
        const res = await fetch(`/api/media/${hit.clip.mediaId}/stats`);
        if (!res.ok) throw new Error(`the engine answered ${res.status}`);
        const s = (await res.json()) as Record<string, number | boolean>;
        statsList?.replaceChildren(
          ...STAT_LABELS.filter(([key]) => typeof s[key] === "number").flatMap(([key, label, fmt]) => {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = fmt(s[key] as number);
            return [dt, dd];
          }),
        );
      } else if (action === "spectrogram" && spectrogram) {
        const res = await fetch(`/api/media/${hit.clip.mediaId}/spectrogram.png`);
        if (!res.ok) throw new Error(`the engine answered ${res.status}`);
        if (spectrogram.src.startsWith("blob:")) URL.revokeObjectURL(spectrogram.src);
        spectrogram.src = URL.createObjectURL(await res.blob());
        spectrogram.hidden = false;
      }
    } catch (err) {
      setText(notice, `Could not analyze the clip: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Module chains (iZotope RX): effects with their controls run in order, each on the last one's output; the document
  // changes once, so the whole chain is one undo step.
  type ChainStep = { name: string; label: string; params: Record<string, number> };
  let chain: ChainStep[] = [];
  const chainList = body.querySelector<HTMLElement>(".fw-chain");
  const renderChain = () => {
    if (!chainList) return;
    chainList.replaceChildren(
      ...chain.map((s, i) => {
        const item = document.createElement("li");
        item.className = "fw-chain-step";
        const text = document.createElement("span");
        text.textContent = s.label;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "fw-ibtn";
        remove.dataset.chainRemove = String(i);
        remove.textContent = "Remove";
        item.append(text, remove);
        return item;
      }),
    );
    const has = chain.length > 0;
    if (chainList.hidden === has) chainList.hidden = !has;
    for (const key of ["chain-apply", "chain-clear"]) {
      const b = body.querySelector<HTMLElement>(`[data-fx="${key}"]`);
      if (b && b.hidden === has) b.hidden = !has;
    }
  };
  body.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const remove = t.closest<HTMLElement>("[data-chain-remove]")?.dataset.chainRemove;
    if (remove !== undefined) {
      chain = chain.filter((_, i) => i !== Number(remove));
      renderChain();
      return;
    }
    const action = t.closest<HTMLElement>("[data-fx]")?.dataset.fx;
    if (action === "chain-add" && pick?.value) {
      const params = currentParams() as Record<string, number>;
      const base = (pick.selectedOptions[0]?.textContent ?? pick.value).replace(/\.+$/, "");
      const detail = (controls.get(pick.value) ?? []).map((c) => `${params[c.id] ?? c.default}${c.unit}`).join(" ");
      chain = [...chain, { name: pick.value, label: detail ? `${base} ${detail}` : base, params }];
      renderChain();
      return;
    }
    if (action === "chain-clear") {
      chain = [];
      renderChain();
      return;
    }
    if (action !== "chain-apply" || !chain.length) return;
    const hit = find(engine.get("document"));
    if (!hit) return;
    const r = range;
    const rangeTrack = r ? engine.get("document").tracks.find((tr) => tr.id === r.trackId) : undefined;
    const rangeClip = r && rangeTrack ? rangeTrack.clips.find((c) => c.start < r.end && r.start < c.start + c.length) : undefined;
    const target = rangeTrack && rangeClip ? { track: rangeTrack, clip: rangeClip } : hit;
    const inRange = rangeClip && r ? r : null;
    if (inRange && chain.some((s) => retiming.has(s.name))) {
      setText(notice, "This chain changes timing, so it applies to whole clips: clear the range first");
      return;
    }
    const buttons = [...body.querySelectorAll<HTMLButtonElement>("button[data-fx]")];
    for (const b of buttons) b.disabled = true;
    let mediaId = target.clip.mediaId;
    let last: MediaRef | null = null;
    try {
      for (const [i, s] of chain.entries()) {
        setText(notice, `Chain ${i + 1} of ${chain.length}: ${s.label}...`);
        const res = await fetch(`/api/media/${mediaId}/effect?name=${encodeURIComponent(s.name)}&params=${encodeURIComponent(JSON.stringify(s.params))}`, { method: "POST" });
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) throw new Error(`${s.label}: ${typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`}`);
        last = out as unknown as MediaRef;
        mediaId = last.id;
      }
      if (last && inRange) engine.dispatch({ type: "set-range-media", trackId: target.track.id, clipId: target.clip.id, start: inRange.start, end: inRange.end, media: last });
      else if (last) engine.dispatch({ type: "set-clip-media", trackId: target.track.id, clipId: target.clip.id, media: last });
      setText(notice, `Applied a chain of ${chain.length} effect${chain.length === 1 ? "" : "s"}${inRange ? " to the range" : " to the clip"}`);
    } catch (err) {
      setText(notice, `Could not apply the chain: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  });

  // Music separation (Audacity's AI separation, RX's Music Rebalance): the clip's trimmed range split into four stems on
  // new tracks at the clip's start, the original track muted, all one undo step.
  body.addEventListener("click", async (e) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>("[data-fx]")?.dataset.fx;
    if (kind !== "separate" && kind !== "deconstruct") return;
    const doc = engine.get("document");
    const hit = find(doc);
    const source = hit ? doc.media[hit.clip.mediaId] : undefined;
    if (!hit || !source) return;
    const start = hit.clip.sourceIn / source.sampleRate;
    const end = start + hit.clip.length / doc.sampleRate;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>("button[data-fx]")];
    for (const b of buttons) b.disabled = true;
    setText(notice, kind === "separate" ? "Separating into stems (about three times the clip's length on a CPU)..." : "Deconstructing into tonal, noisy and transient parts...");
    try {
      const res = await fetch(`/api/media/${source.id}/${kind}?start=${start}&end=${end}`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown } | { source: string; media: MediaRef }[];
      if (!res.ok || !Array.isArray(out)) throw new Error(!Array.isArray(out) && typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const commands = [
        ...out.map((s) => ({ type: "import-media" as const, media: s.media, at: hit.clip.start })),
        { type: "set-track-mute" as const, trackId: hit.track.id, mute: true },
      ];
      engine.dispatch({ type: "batch", commands } as Parameters<Engine["dispatch"]>[0]);
      setText(notice, `Separated into ${out.map((s) => s.source).join(", ")} on new tracks; the original track is muted`);
    } catch (err) {
      setText(notice, `Could not separate: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  });

  // Isolate sound (SAM-Audio, an owner addition): the clip's trimmed range, a description and, when a Smart Tool range
  // lies on the clip, that range as where the sound occurs; the sound and everything else land on new tracks at the
  // clip's start with the original muted, one undo step, as stems do. The status line names what is missing.
  const samStatus = body.querySelector<HTMLElement>("[data-sam-status]");
  const samDesc = body.querySelector<HTMLInputElement>('[data-sam="desc"]');
  const samGo = body.querySelector<HTMLButtonElement>('[data-sam="go"]');
  void fetch("/api/sam-audio/status")
    .then((r) => (r.ok ? r.json() : null))
    .then((s: { message?: string } | null) => setText(samStatus, s?.message ?? "SAM-Audio: status unavailable"))
    .catch(() => setText(samStatus, "SAM-Audio: status unavailable"));
  samDesc?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") samGo?.click();
  });
  samGo?.addEventListener("click", async () => {
    const doc = engine.get("document");
    const hit = find(doc);
    const source = hit ? doc.media[hit.clip.mediaId] : undefined;
    const description = samDesc?.value.trim() ?? "";
    if (!hit || !source) return;
    if (!description) {
      setText(notice, "Describe the sound to isolate, for example: man speaking");
      return;
    }
    const start = hit.clip.sourceIn / source.sampleRate;
    const end = start + hit.clip.length / doc.sampleRate;
    const on = rangeOnClip();
    const spans = on && on.clip.id === hit.clip.id ? [[(on.from - hit.clip.start) / doc.sampleRate, (on.to - hit.clip.start) / doc.sampleRate]] : null;
    samGo.disabled = true;
    setText(notice, `Isolating "${description}"${spans ? " in the selected range" : ""} (slow without a GPU)...`);
    try {
      const q = `description=${encodeURIComponent(description)}&start=${start}&end=${end}${spans ? `&spans=${encodeURIComponent(JSON.stringify(spans))}` : ""}`;
      const res = await fetch(`/api/media/${source.id}/isolate?${q}`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown } | { source: string; media: MediaRef }[];
      if (!res.ok || !Array.isArray(out)) throw new Error(!Array.isArray(out) && typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const commands = [
        ...out.map((s) => ({ type: "import-media" as const, media: s.media, at: hit.clip.start })),
        { type: "set-track-mute" as const, trackId: hit.track.id, mute: true },
      ];
      engine.dispatch({ type: "batch", commands } as Parameters<Engine["dispatch"]>[0]);
      setText(notice, `Isolated "${description}" and everything else on new tracks; the original track is muted`);
    } catch (err) {
      setText(notice, `Could not isolate: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      samGo.disabled = false;
    }
  });

  // Automatic ducking (Audacity's Auto Duck, Audition's content-based ducking): this track's volume envelope lowered
  // while another track is active, written as editable automation in one undo step.
  const duckControl = body.querySelector<HTMLSelectElement>('[data-duck="control"]');
  const duckAmount = body.querySelector<HTMLInputElement>('[data-duck="amount"]');
  const duckOut = body.querySelector<HTMLElement>("[data-duck-out]");
  const DUCK_ATTACK = 0.15;
  const DUCK_RELEASE = 0.4;
  const fillDuck = () => {
    if (!duckControl) return;
    const doc = engine.get("document");
    const own = find(doc)?.track.id;
    const others = doc.tracks.filter((t) => t.id !== own);
    const signature = others.map((t) => `${t.id}:${t.name}`).join("|");
    if (duckControl.dataset.sig === signature) return;
    duckControl.dataset.sig = signature;
    const keep = duckControl.value;
    duckControl.replaceChildren(...others.map((t) => new Option(t.name, t.id)));
    if (others.some((t) => t.id === keep)) duckControl.value = keep;
  };
  engine.subscribe("document", fillDuck);
  // After the selection listener below has updated `selected`, so the track being ducked is left out.
  host.addEventListener("fw-selection", () => queueMicrotask(fillDuck));
  duckAmount?.addEventListener("input", () => setText(duckOut, `${duckAmount.value} dB`));
  body.addEventListener("click", async (e) => {
    if ((e.target as HTMLElement).closest<HTMLElement>("[data-duck]")?.dataset.duck !== "go") return;
    fillDuck();
    const doc = engine.get("document");
    const hit = find(doc);
    const control = duckControl?.value;
    const controlName = doc.tracks.find((t) => t.id === control)?.name ?? "the other track";
    if (!hit || !control) {
      setText(notice, "Add another track to duck this one under");
      return;
    }
    const amount = Number(duckAmount?.value ?? 12);
    setText(notice, `Finding where ${controlName} is active...`);
    try {
      const res = await fetch(`/api/render/activity?trackId=${encodeURIComponent(control)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown; regions?: [number, number][] };
      if (!res.ok || !out.regions) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const merged: [number, number][] = [];
      for (const [s, end] of out.regions) {
        const last = merged[merged.length - 1];
        if (last && s - last[1] < DUCK_ATTACK + DUCK_RELEASE) last[1] = end;
        else merged.push([s, end]);
      }
      const rate = doc.sampleRate;
      const points = merged.flatMap(([s, end]) => [
        { time: Math.max(0, s - DUCK_ATTACK) * rate, value: 0 },
        { time: s * rate, value: -amount },
        { time: end * rate, value: -amount },
        { time: (end + DUCK_RELEASE) * rate, value: 0 },
      ]);
      engine.dispatch({ type: "set-automation", trackId: hit.track.id, param: "volume", points });
      setText(notice, merged.length ? `Ducked ${hit.track.name} by ${amount} dB in ${merged.length} place${merged.length === 1 ? "" : "s"} under ${controlName}` : `${controlName} is silent; nothing to duck`);
    } catch (err) {
      setText(notice, `Could not duck: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Controls for commands the interface never issued (the reachability audit at v0.80.0 found them): rename and delete
  // a track, and crossfade the selected clip with the clip it overlaps on its track.
  const nameInput = body.querySelector<HTMLInputElement>("[data-track-name]");
  const crossBtn = body.querySelector<HTMLButtonElement>('[data-clip-act="crossfade"]');
  const overlapOf = (doc: SessionDoc) => {
    const hit = find(doc);
    if (!hit) return null;
    const c = hit.clip;
    const other = hit.track.clips.find((o) => o.id !== c.id && o.start < c.start + c.length && c.start < o.start + o.length);
    if (!other) return null;
    const [left, right] = other.start <= c.start ? [other, c] : [c, other];
    return { track: hit.track, left, right };
  };
  const syncTrackControls = () => {
    const doc = engine.get("document");
    const hit = find(doc);
    if (nameInput && hit && document.activeElement !== nameInput && nameInput.value !== hit.track.name) nameInput.value = hit.track.name;
    const can = !!overlapOf(doc);
    if (crossBtn && crossBtn.disabled === can) crossBtn.disabled = !can;
  };
  engine.subscribe("document", syncTrackControls);
  host.addEventListener("fw-selection", () => queueMicrotask(syncTrackControls));
  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nameInput.blur();
  });
  nameInput?.addEventListener("change", () => {
    const hit = find(engine.get("document"));
    const name = nameInput.value.trim();
    if (hit && name && name !== hit.track.name) engine.dispatch({ type: "rename-track", trackId: hit.track.id, name });
    else if (hit) nameInput.value = hit.track.name;
  });
  body.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-track-act], [data-clip-act]");
    if (!b) return;
    const doc = engine.get("document");
    if (b.dataset.trackAct === "delete") {
      const hit = find(doc);
      if (!hit) return;
      engine.dispatch({ type: "remove-track", trackId: hit.track.id });
      setText(notice, `Deleted track ${hit.track.name}; undo brings it back`);
    } else if (b.dataset.clipAct === "crossfade") {
      const o = overlapOf(doc);
      if (!o) return;
      engine.dispatch({ type: "crossfade", trackId: o.track.id, leftClipId: o.left.id, rightClipId: o.right.id });
      setText(notice, "Crossfaded the overlap, equal power");
    }
  });

  // Non-destructive clip pitch (Audacity's clip pitch shift): a render of the ORIGINAL media at the chosen pitch is
  // what plays; the original is never altered, so pitches never compound, and 0 drops the render.
  const pitchInput = body.querySelector<HTMLInputElement>("[data-pitch]");
  const pitchOut = body.querySelector<HTMLElement>("[data-pitch-out]");
  const label = (st: number) => `${st > 0 ? "+" : ""}${st} st`;
  const syncPitch = () => {
    const st = find(engine.get("document"))?.clip.pitch ?? 0;
    if (pitchInput && document.activeElement !== pitchInput && pitchInput.value !== String(st)) pitchInput.value = String(st);
    setText(pitchOut, label(Number(pitchInput?.value ?? st)));
  };
  engine.subscribe("document", syncPitch);
  host.addEventListener("fw-selection", () => queueMicrotask(syncPitch));
  pitchInput?.addEventListener("input", () => setText(pitchOut, label(Number(pitchInput.value))));
  pitchInput?.addEventListener("change", async () => {
    const hit = find(engine.get("document"));
    if (!hit || !pitchInput) return;
    const st = Math.round(Number(pitchInput.value));
    if (st === (hit.clip.pitch ?? 0)) return;
    if (st === 0) {
      engine.dispatch({ type: "set-clip-pitch", trackId: hit.track.id, clipId: hit.clip.id, semitones: 0, media: null });
      setText(notice, "Pitch reset: the clip plays its original");
      return;
    }
    setText(notice, `Pitching the clip ${label(st)}...`);
    try {
      const params = encodeURIComponent(JSON.stringify({ semitones: st }));
      const res = await fetch(`/api/media/${hit.clip.mediaId}/effect?name=pitch-up-semitone&params=${params}`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const now = find(engine.get("document"));
      if (!now || now.clip.id !== hit.clip.id) return; // the selection moved on while rendering; do not pitch another clip
      engine.dispatch({ type: "set-clip-pitch", trackId: hit.track.id, clipId: hit.clip.id, semitones: st, media: out as unknown as MediaRef });
      setText(notice, `Pitched ${label(st)}; the original is kept`);
    } catch (err) {
      setText(notice, `Could not pitch the clip: ${err instanceof Error ? err.message : String(err)}`);
      syncPitch();
    }
  });

  // EQ match (iZotope RX's EQ Match): the selected clip takes the tonal balance of another clip's visible region.
  const eqmRef = body.querySelector<HTMLSelectElement>('[data-eqm="ref"]');
  const eqmGo = body.querySelector<HTMLButtonElement>('[data-eqm="go"]');
  // A reference learned from a Smart Tool range (RX's Learn), kept as its media and media-seconds region.
  let learned: { mediaId: string; start: number; end: number; label: string } | null = null;
  /** The part of the current Smart Tool range that lies on a clip of its track, in session samples and media seconds. */
  const rangeOnClip = () => {
    const doc = engine.get("document");
    const r = range;
    const track = r ? doc.tracks.find((t) => t.id === r.trackId) : undefined;
    const clip = r && track ? track.clips.find((c) => c.start < r.end && r.start < c.start + c.length) : undefined;
    const media = clip ? doc.media[clip.mediaId] : undefined;
    if (!r || !track || !clip || !media) return null;
    const from = Math.max(r.start, clip.start);
    const to = Math.min(r.end, clip.start + clip.length);
    const toMedia = (s: number) => clip.sourceIn / media.sampleRate + (s - clip.start) / doc.sampleRate;
    return { track, clip, from, to, mediaStart: toMedia(from), mediaEnd: toMedia(to), rate: doc.sampleRate };
  };
  const fillEqm = () => {
    const doc = engine.get("document");
    const hit = find(doc);
    if (!eqmRef) return;
    const others = doc.tracks.flatMap((t) => t.clips.filter((c) => c.id !== hit?.clip.id).map((c) => ({ id: c.id, label: `${t.name} · ${(c.start / doc.sampleRate).toFixed(2)} s` })));
    const options = [...(learned ? [{ id: "learned", label: learned.label }] : []), ...others];
    const sig = options.map((o) => `${o.id}=${o.label}`).join("|");
    if (eqmRef.dataset.sig !== sig) {
      const keep = eqmRef.value;
      eqmRef.dataset.sig = sig;
      eqmRef.replaceChildren(...(options.length ? options.map((o) => new Option(o.label, o.id)) : [new Option("No other clip", "")]));
      if (options.some((o) => o.id === keep)) eqmRef.value = keep;
    }
    if (eqmGo && eqmGo.disabled === options.length > 0) eqmGo.disabled = options.length === 0;
  };
  engine.subscribe("document", fillEqm);
  host.addEventListener("fw-selection", () => queueMicrotask(fillEqm));
  const eqmLearn = body.querySelector<HTMLButtonElement>('[data-eqm="learn"]');
  eqmLearn?.addEventListener("click", () => {
    const on = rangeOnClip();
    if (!on) {
      setText(notice, "Select a range on a clip to learn from");
      return;
    }
    learned = { mediaId: on.clip.mediaId, start: on.mediaStart, end: on.mediaEnd, label: `Learned range · ${(on.from / on.rate).toFixed(2)} to ${(on.to / on.rate).toFixed(2)} s` };
    fillEqm();
    if (eqmRef) eqmRef.value = "learned";
    setText(notice, "Learned the range as the EQ match reference");
  });
  eqmGo?.addEventListener("click", async () => {
    const doc = engine.get("document");
    // The reference: a learned range, or another clip's visible region.
    let reference: { mediaId: string; start: number; end: number } | null = null;
    if (eqmRef?.value === "learned" && learned) reference = learned;
    else {
      const ref = doc.tracks.flatMap((t) => t.clips).find((c) => c.id === eqmRef?.value);
      const refMedia = ref ? doc.media[ref.mediaId] : undefined;
      if (ref && refMedia) {
        const s = ref.sourceIn / refMedia.sampleRate;
        reference = { mediaId: ref.mediaId, start: s, end: s + ref.length / doc.sampleRate };
      }
    }
    // The target: while a Smart Tool range exists, its part of its clip (measured there, and only that span replaced);
    // otherwise the selected clip, whole.
    const on = rangeOnClip();
    const target = on ? { track: on.track, clip: on.clip } : find(doc);
    if (!reference || !target) return;
    setText(notice, "Matching the EQ...");
    try {
      let q = `reference=${encodeURIComponent(reference.mediaId)}&start=${reference.start.toFixed(6)}&end=${reference.end.toFixed(6)}`;
      if (on) q += `&tstart=${on.mediaStart.toFixed(6)}&tend=${on.mediaEnd.toFixed(6)}`;
      const res = await fetch(`/api/media/${target.clip.mediaId}/eq-match?${q}`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const still = engine.get("document").tracks.find((t) => t.id === target.track.id)?.clips.some((c) => c.id === target.clip.id);
      if (!still) return; // the clip changed while matching
      if (on) engine.dispatch({ type: "set-range-media", trackId: target.track.id, clipId: target.clip.id, start: on.from, end: on.to, media: out as unknown as MediaRef });
      else engine.dispatch({ type: "set-clip-media", trackId: target.track.id, clipId: target.clip.id, media: out as unknown as MediaRef });
      setText(notice, on ? "EQ matched in the range; undo to go back" : "EQ matched to the reference; undo to go back");
    } catch (err) {
      setText(notice, `Could not match the EQ: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Presets (Audacity's one preset system across built-in, destructive and realtime effects): one store in the engine,
  // rendered effects keyed "fx:<id>" and realtime ones "rt:<kind>", each preset the settings that effect's controls hold.
  let presets: Preset[] = [];
  const fillPresets = (select: HTMLSelectElement | null, effect: string) => {
    if (!select) return;
    const names = presets.filter((p) => p.effect === effect).map((p) => p.name);
    const keep = select.value;
    select.replaceChildren(new Option(names.length ? "Presets" : "No presets", ""), ...names.map((n) => new Option(n, n)));
    if (names.includes(keep)) select.value = keep;
  };
  const fxPresetSelect = body.querySelector<HTMLSelectElement>('[data-preset="fx"]');
  const refreshPresets = () => {
    fillPresets(fxPresetSelect, `fx:${pick?.value ?? ""}`);
    renderRtfx(true);
  };
  const storePresets = async (next: Preset[], message: string) => {
    try {
      presets = await savePresets(next);
      refreshPresets();
      setText(notice, message);
    } catch (err) {
      setText(notice, `Could not save presets: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  void loadPresets()
    .then((list) => {
      presets = list;
      refreshPresets();
    })
    .catch(() => undefined);
  pick?.addEventListener("change", () => fillPresets(fxPresetSelect, `fx:${pick.value}`));
  fxPresetSelect?.addEventListener("change", () => {
    const p = presets.find((x) => x.effect === `fx:${pick?.value}` && x.name === fxPresetSelect.value);
    if (!p) return;
    for (const input of body.querySelectorAll<HTMLInputElement>(".fw-fx-params input[data-param]")) {
      const v = p.params[input.dataset.param ?? ""];
      if (v === undefined) continue;
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setText(notice, `Loaded preset ${p.name}`);
  });
  body.addEventListener("change", (e) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-preset="rt"]');
    const scope = select ? scopeOf(select) : null;
    const index = Number(select?.closest<HTMLElement>(".fw-rtfx-row")?.dataset.index);
    const f = scope && Number.isInteger(index) ? getFx(scope)[index] : undefined;
    const p = f && select ? presets.find((x) => x.effect === `rt:${f.kind}` && x.name === select.value) : undefined;
    if (!scope || !p) return;
    commitRtfx(scope, (fx) => fx.map((x, k) => (k === index ? ({ ...x, ...p.params } as TrackFx) : x)));
    select?.blur();
    setText(notice, `Loaded preset ${p.name}`);
  });
  body.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-preset]");
    const action = button?.dataset.preset;
    if (action === "fx-save" && pick?.value) {
      const name = window.prompt("Preset name", fxPresetSelect?.value || "")?.trim();
      if (!name) return;
      const effect = `fx:${pick.value}`;
      void storePresets([...presets.filter((p) => !(p.effect === effect && p.name === name)), { name, effect, params: currentParams() as Record<string, number> }], `Saved preset ${name}`);
    } else if (action === "fx-delete" && pick?.value) {
      const name = fxPresetSelect?.value;
      if (!name) return;
      void storePresets(presets.filter((p) => !(p.effect === `fx:${pick.value}` && p.name === name)), `Deleted preset ${name}`);
    } else if (action === "rt-save" && button) {
      const scope = scopeOf(button);
      const index = Number(button.closest<HTMLElement>(".fw-rtfx-row")?.dataset.index);
      const f = scope && Number.isInteger(index) ? getFx(scope)[index] : undefined;
      if (!f) return;
      const name = window.prompt("Preset name", "")?.trim();
      if (!name) return;
      const effect = `rt:${f.kind}`;
      const params = Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== "kind" && k !== "bypass" && typeof v === "number")) as Record<string, number>;
      void storePresets([...presets.filter((p) => !(p.effect === effect && p.name === name)), { name, effect, params }], `Saved preset ${name}`);
    }
  });

  // Realtime effects (Audacity's realtime stacks): filters the core runs live, in playback and export alike, on the
  // selected track (run per clip) or on the master (the summed mix, before the master fader); rows can be reordered.
  type FxScope = "track" | "master" | "bus";
  const fxLists: { scope: FxScope; list: HTMLElement | null; sig: string }[] = [
    { scope: "track", list: body.querySelector<HTMLElement>('.fw-rtfx-list[data-scope="track"]'), sig: "" },
    { scope: "bus", list: body.querySelector<HTMLElement>('.fw-rtfx-list[data-scope="bus"]'), sig: "" },
    { scope: "master", list: body.querySelector<HTMLElement>('.fw-rtfx-list[data-scope="master"]'), sig: "" },
  ];
  const masterSection = body.querySelector<HTMLElement>(".fw-insp-master");
  const busSection = body.querySelector<HTMLElement>(".fw-insp-bus");
  /** The bus the selected clip's track is routed to (Pro Tools' routing folder), if any. */
  const currentBus = () => {
    const doc = engine.get("document");
    const busId = find(doc)?.track.busId;
    return busId !== undefined ? (doc.buses ?? []).find((b) => b.id === busId) ?? null : null;
  };
  const RTFX_LABEL: Record<TrackFx["kind"], string> = { highpass: "High-pass", lowpass: "Low-pass", peak: "Peak EQ", lowshelf: "Low shelf", highshelf: "High shelf", compressor: "Compressor" };
  const RTFX_DEFAULT: Record<TrackFx["kind"], TrackFx> = {
    highpass: { kind: "highpass", freq: 100, gainDb: 0, q: 0.707 },
    lowpass: { kind: "lowpass", freq: 8000, gainDb: 0, q: 0.707 },
    peak: { kind: "peak", freq: 1000, gainDb: 0, q: 1 },
    lowshelf: { kind: "lowshelf", freq: 200, gainDb: 0, q: 0.707 },
    highshelf: { kind: "highshelf", freq: 6000, gainDb: 0, q: 0.707 },
    compressor: { kind: "compressor", thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 150, makeupDb: 0 },
  };
  const getFx = (scope: FxScope): readonly TrackFx[] => {
    const doc = engine.get("document");
    return scope === "master" ? doc.masterFx ?? [] : scope === "bus" ? currentBus()?.fx ?? [] : find(doc)?.track.fx ?? [];
  };
  const renderFxList = (entry: (typeof fxLists)[number], force: boolean) => {
    const list = entry.list;
    if (!list) return;
    const fx = getFx(entry.scope);
    const sig = JSON.stringify(fx);
    if (!force && (sig === entry.sig || list.contains(document.activeElement))) return;
    entry.sig = sig;
    list.replaceChildren(
      ...fx.map((f, i) => {
        const row = document.createElement("div");
        row.className = "fw-rtfx-row";
        row.dataset.index = String(i);
        const shaped = f.kind === "peak" || f.kind === "lowshelf" || f.kind === "highshelf";
        const num = (label: string, p: string, min: number, max: number, step: number) => `<label>${label} <input type="number" min="${min}" max="${max}" step="${step}" data-p="${p}"></label>`;
        const fields =
          f.kind === "compressor"
            ? num("Thr dB", "thresholdDb", -60, 0, 0.5) + num("Ratio", "ratio", 1, 20, 0.5) + num("Atk ms", "attackMs", 0.1, 200, 1) + num("Rel ms", "releaseMs", 1, 2000, 10) + num("Gain dB", "makeupDb", 0, 24, 0.5)
            : num("Hz", "freq", 20, 20000, 1) + (shaped ? num("dB", "gainDb", -24, 24, 0.5) : "") + num("Q", "q", 0.1, 18, 0.1);
        row.innerHTML = `<span class="fw-rtfx-name"></span>${fields}<label><input type="checkbox" data-p="on"> On</label><button type="button" class="fw-ibtn" data-rtfx="up">Up</button><button type="button" class="fw-ibtn" data-rtfx="down">Down</button><button type="button" class="fw-ibtn" data-rtfx="remove">Remove</button><select data-preset="rt" aria-label="Preset for this effect"></select><button type="button" class="fw-ibtn" data-preset="rt-save">Save</button>`;
        fillPresets(row.querySelector<HTMLSelectElement>('[data-preset="rt"]'), `rt:${f.kind}`);
        const name = row.querySelector<HTMLElement>(".fw-rtfx-name");
        if (name) name.textContent = RTFX_LABEL[f.kind];
        for (const input of row.querySelectorAll<HTMLInputElement>("input[data-p]")) {
          const p = input.dataset.p;
          if (p === "on") input.checked = !f.bypass;
          else if (p) input.value = String((f as unknown as Record<string, number>)[p] ?? "");
        }
        const up = row.querySelector<HTMLButtonElement>('[data-rtfx="up"]');
        const down = row.querySelector<HTMLButtonElement>('[data-rtfx="down"]');
        if (up) up.disabled = i === 0;
        if (down) down.disabled = i === fx.length - 1;
        return row;
      }),
    );
  };
  const renderRtfx = (force = false) => {
    for (const entry of fxLists) renderFxList(entry, force);
    const show = engine.get("document").tracks.length > 0;
    if (masterSection && masterSection.hidden === show) masterSection.hidden = !show;
    const bus = currentBus();
    if (busSection && busSection.hidden === !!bus) busSection.hidden = !bus;
    setText(body.querySelector(".fw-bus-head"), bus ? `Bus effects · ${bus.name}` : "Bus effects");
  };
  engine.subscribe("document", () => renderRtfx());
  host.addEventListener("fw-selection", () => queueMicrotask(() => renderRtfx(true)));
  const commitRtfx = (scope: FxScope, mutate: (fx: TrackFx[]) => TrackFx[]) => {
    if (scope === "master") {
      engine.dispatch({ type: "set-master-fx", fx: mutate([...(engine.get("document").masterFx ?? [])]) });
      return;
    }
    if (scope === "bus") {
      const bus = currentBus();
      if (bus) engine.dispatch({ type: "set-bus-fx", busId: bus.id, fx: mutate([...(bus.fx ?? [])]) });
      return;
    }
    const hit = find(engine.get("document"));
    if (hit) engine.dispatch({ type: "set-track-fx", trackId: hit.track.id, fx: mutate([...(hit.track.fx ?? [])]) });
  };
  const scopeOf = (el: HTMLElement): FxScope | null => {
    const s = el.closest<HTMLElement>("[data-scope]")?.dataset.scope;
    return s === "track" || s === "master" || s === "bus" ? s : null;
  };
  body.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.closest(".fw-rtfx-list")) return;
    const scope = scopeOf(input);
    const index = Number(input.closest<HTMLElement>(".fw-rtfx-row")?.dataset.index);
    const p = input.dataset.p;
    if (!scope || !Number.isInteger(index) || !p) return;
    commitRtfx(scope, (fx) => fx.map((f, k) => (k !== index ? f : p === "on" ? { ...f, bypass: !input.checked } : { ...f, [p]: Number(input.value) })));
  });
  body.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-rtfx]");
    const action = button?.dataset.rtfx;
    const scope = button ? scopeOf(button) : null;
    if (!button || !scope || !action || action === "kind") return;
    if (action === "add") {
      const kind = button.closest<HTMLElement>("[data-scope]")?.querySelector<HTMLSelectElement>('[data-rtfx="kind"]')?.value as TrackFx["kind"] | undefined;
      if (kind && RTFX_DEFAULT[kind]) commitRtfx(scope, (fx) => [...fx, { ...RTFX_DEFAULT[kind] }]);
      renderRtfx(true);
      return;
    }
    const index = Number(button.closest<HTMLElement>(".fw-rtfx-row")?.dataset.index);
    if (!Number.isInteger(index)) return;
    button.blur();
    if (action === "remove") commitRtfx(scope, (fx) => fx.filter((_, k) => k !== index));
    else if (action === "up" || action === "down") {
      const to = action === "up" ? index - 1 : index + 1;
      commitRtfx(scope, (fx) => {
        if (to < 0 || to >= fx.length) return fx;
        const next = [...fx];
        [next[index], next[to]] = [next[to], next[index]];
        return next;
      });
    }
    renderRtfx(true);
  });

  // Transient detection (Pro Tools' groove and timing edits start from it): a marker at each onset inside the
  // selected clip's visible span, file time mapped through the clip's start, trim and rates; one undo step.
  body.addEventListener("click", async (e) => {
    if ((e.target as HTMLElement).closest<HTMLElement>("[data-an]")?.dataset.an !== "transients") return;
    const doc = engine.get("document");
    const hit = find(doc);
    const source = hit ? doc.media[hit.clip.mediaId] : undefined;
    if (!hit || !source) return;
    const sens = Number(body.querySelector<HTMLInputElement>("[data-an-sens]")?.value ?? 0.5);
    setText(notice, "Finding transients...");
    try {
      const res = await fetch(`/api/media/${source.id}/transients?sensitivity=${Number.isFinite(sens) ? sens : 0.5}`);
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown; seconds?: number[] };
      if (!res.ok || !out.seconds) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const toSession = doc.sampleRate / source.sampleRate;
      const { start, length, sourceIn } = hit.clip;
      const at = out.seconds.map((s) => start + Math.round((s * source.sampleRate - sourceIn) * toSession)).filter((t) => t >= start && t < start + length);
      if (!at.length) {
        setText(notice, "No transients in this clip at this sensitivity");
        return;
      }
      const commands = at.map((t, i) => ({ type: "add-marker" as const, at: t, label: `Transient ${i + 1}` }));
      engine.dispatch({ type: "batch", commands } as Parameters<Engine["dispatch"]>[0]);
      setText(notice, `Marked ${at.length} transient${at.length === 1 ? "" : "s"}`);
    } catch (err) {
      setText(notice, `Could not find transients: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  /** The engine's tempo of a clip's visible region, with its confidence (services/tempo.py). Detect needs 0.1; speech
   * and irregular hits score about 0.03, synthetic beats 0.32 and up, the owner's song 0.47. */
  const TEMPO_CONFIDENCE = 0.1;
  const clipTempo = async (clip: Clip, doc: SessionDoc): Promise<{ bpm: number; confidence: number }> => {
    const media = doc.media[clip.mediaId];
    const start = clip.sourceIn / media.sampleRate;
    const end = start + clip.length / doc.sampleRate;
    const res = await fetch(`/api/media/${clip.mediaId}/tempo?start=${start.toFixed(6)}&end=${end.toFixed(6)}`);
    const out = (await res.json().catch(() => ({}))) as { bpm?: number; confidence?: number; detail?: unknown };
    if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return { bpm: out.bpm ?? 0, confidence: out.confidence ?? 0 };
  };

  // The session tempo (the bars ruler, beat snapping and Quantize share it): BPM and Beats edit it, and follow it.
  const bpmField = body.querySelector<HTMLInputElement>('[data-q="bpm"]');
  const bpbField = body.querySelector<HTMLInputElement>('[data-q="bpb"]');
  const syncTempo = () => {
    const tempo = engine.get("document").tempo;
    if (!tempo) return;
    if (bpmField && document.activeElement !== bpmField && bpmField.value !== tempo.bpm.toFixed(1)) bpmField.value = tempo.bpm.toFixed(1);
    if (bpbField && document.activeElement !== bpbField && bpbField.value !== String(tempo.beatsPerBar)) bpbField.value = String(tempo.beatsPerBar);
  };
  engine.subscribe("document", syncTempo);
  const keyOut = body.querySelector<HTMLElement>("[data-key-out]");
  engine.subscribe("document", () => {
    const k = engine.get("document").key;
    setText(keyOut, k ? `Key ${k.name} · ${k.camelot}` : "Key not set");
  });
  const commitTempo = () => engine.dispatch({ type: "set-tempo", bpm: Number(bpmField?.value), beatsPerBar: Number(bpbField?.value) });
  bpmField?.addEventListener("change", commitTempo);
  bpbField?.addEventListener("change", commitTempo);

  // Timing edits on transients (Pro Tools' groove edits, as a reference): cut a clip at its transients, then quantize
  // clip starts to a musical grid; each one undo step. After a split each piece starts on its transient.
  let selectedIds: string[] = [];
  host.addEventListener("fw-selection", (e) => {
    selectedIds = [...((e as CustomEvent<string[]>).detail ?? [])];
  });
  const clipTransients = async (): Promise<{ hit: { track: Track; clip: Clip }; at: number[] } | null> => {
    const doc = engine.get("document");
    const hit = find(doc);
    const source = hit ? doc.media[hit.clip.mediaId] : undefined;
    if (!hit || !source) return null;
    const sens = Number(body.querySelector<HTMLInputElement>("[data-an-sens]")?.value ?? 0.5);
    const res = await fetch(`/api/media/${source.id}/transients?sensitivity=${Number.isFinite(sens) ? sens : 0.5}`);
    const out = (await res.json().catch(() => ({}))) as { detail?: unknown; seconds?: number[] };
    if (!res.ok || !out.seconds) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    const toSession = doc.sampleRate / source.sampleRate;
    const { start, length, sourceIn } = hit.clip;
    const guard = Math.round(doc.sampleRate * 0.01);
    const at = out.seconds.map((s) => start + Math.round((s * source.sampleRate - sourceIn) * toSession)).filter((t) => t > start + guard && t < start + length - guard);
    return { hit, at };
  };
  body.addEventListener("click", async (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-an]")?.dataset.an;
    if (action === "split-transients") {
      setText(notice, "Finding transients...");
      try {
        const found = await clipTransients();
        if (!found) return;
        if (!found.at.length) {
          setText(notice, "No transients inside this clip to split at");
          return;
        }
        // Last to first, so each cut targets the original clip, which still holds every earlier transient.
        const commands = [...found.at].reverse().map((t) => ({ type: "split-clip" as const, trackId: found.hit.track.id, clipId: found.hit.clip.id, at: t }));
        engine.dispatch({ type: "batch", commands } as Parameters<Engine["dispatch"]>[0]);
        setText(notice, `Split into ${found.at.length + 1} pieces at the transients`);
      } catch (err) {
        setText(notice, `Could not split at transients: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (action === "detect-key") {
      const doc = engine.get("document");
      const hit = find(doc);
      if (!hit) {
        setText(notice, "Select one clip to detect its key");
        return;
      }
      setText(notice, "Detecting the key...");
      try {
        const media = doc.media[hit.clip.mediaId];
        const start = hit.clip.sourceIn / media.sampleRate;
        const res = await fetch(`/api/media/${hit.clip.mediaId}/key?start=${start.toFixed(6)}&end=${(start + hit.clip.length / doc.sampleRate).toFixed(6)}`);
        const out = (await res.json().catch(() => ({}))) as { key?: string | null; camelot?: string | null; confidence?: number; detail?: unknown };
        if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        if (!out.key || !out.camelot) {
          setText(notice, "No pitched material in this clip to find a key");
          return;
        }
        engine.dispatch({ type: "set-key", name: out.key, camelot: out.camelot });
        const low = (out.confidence ?? 0) < 0.05 ? "; low confidence, another key is nearly as likely" : "";
        setText(notice, `Detected ${out.key} (Camelot ${out.camelot}), confidence ${(out.confidence ?? 0).toFixed(2)}${low}`);
      } catch (err) {
        setText(notice, `Could not detect the key: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (action === "detect-bpm") {
      const doc = engine.get("document");
      if (!find(doc)) {
        setText(notice, "Select one clip to detect its tempo");
        return;
      }
      setText(notice, "Detecting the tempo...");
      try {
        const hit = find(doc);
        const found = hit ? await clipTempo(hit.clip, doc) : null;
        if (!found || found.confidence < TEMPO_CONFIDENCE) {
          setText(notice, "Not enough steady rhythm in this clip to find a tempo");
          return;
        }
        const bpm = found.bpm;
        const field = body.querySelector<HTMLInputElement>('[data-q="bpm"]');
        if (field) field.value = bpm.toFixed(1);
        commitTempo();
        setText(notice, `Detected ${bpm.toFixed(1)} BPM (confidence ${found.confidence.toFixed(2)})`);
      } catch (err) {
        setText(notice, `Could not detect the tempo: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (action === "stretch-tempo") {
      // Audacity's stretch to tempo: the clip's detected tempo against the session's gives the tempo factor for the
      // pitch-keeping tempo effect (0.5 to 2 times); the clip's placement scales with the new length.
      const doc = engine.get("document");
      const hit = find(doc);
      if (!hit || !doc.tempo) {
        setText(notice, hit ? "Set a session tempo first (BPM, or Detect on the reference clip)" : "Select one clip to stretch");
        return;
      }
      setText(notice, "Detecting this clip's tempo...");
      try {
        const found = await clipTempo(hit.clip, doc);
        if (found.confidence < TEMPO_CONFIDENCE) {
          setText(notice, "Not enough steady rhythm in this clip to find its tempo");
          return;
        }
        const own = found.bpm;
        const factor = doc.tempo.bpm / own;
        if (factor < 0.5 || factor > 2) {
          setText(notice, `From ${own.toFixed(1)} to ${doc.tempo.bpm.toFixed(1)} BPM is beyond the 0.5 to 2 times the stretch allows`);
          return;
        }
        if (Math.abs(factor - 1) < 0.001) {
          setText(notice, `This clip is already at ${doc.tempo.bpm.toFixed(1)} BPM`);
          return;
        }
        setText(notice, `Stretching from ${own.toFixed(1)} to ${doc.tempo.bpm.toFixed(1)} BPM...`);
        const params = encodeURIComponent(JSON.stringify({ percent: (factor - 1) * 100 }));
        const res = await fetch(`/api/media/${hit.clip.mediaId}/effect?name=stretch-rhythmic&params=${params}`, { method: "POST" });
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        engine.dispatch({ type: "set-clip-media", trackId: hit.track.id, clipId: hit.clip.id, media: out as unknown as MediaRef });
        setText(notice, `Stretched from ${own.toFixed(1)} to ${doc.tempo.bpm.toFixed(1)} BPM`);
      } catch (err) {
        setText(notice, `Could not stretch: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (action === "quantize") {
      const doc = engine.get("document");
      const bpm = Number(body.querySelector<HTMLInputElement>('[data-q="bpm"]')?.value);
      const division = Number(body.querySelector<HTMLSelectElement>('[data-q="division"]')?.value);
      if (!(bpm >= 30 && bpm <= 300) || ![4, 8, 16].includes(division)) {
        setText(notice, "Set a tempo from 30 to 300 BPM");
        return;
      }
      const step = (60 / bpm) * (4 / division) * doc.sampleRate;
      const current = find(doc);
      const ids = new Set(selectedIds.length ? selectedIds : current ? [current.clip.id] : []);
      const commands = doc.tracks.flatMap((t) =>
        t.clips
          .filter((c) => ids.has(c.id))
          .map((c) => ({ type: "move-clip" as const, trackId: t.id, clipId: c.id, start: Math.max(0, Math.round(Math.round(c.start / step) * step)) }))
          .filter((m) => t.clips.find((c) => c.id === m.clipId)?.start !== m.start),
      );
      if (!commands.length) {
        setText(notice, "The selected clips already sit on the grid");
        return;
      }
      engine.dispatch({ type: "batch", commands } as Parameters<Engine["dispatch"]>[0]);
      setText(notice, `Quantized ${commands.length} clip${commands.length === 1 ? "" : "s"} to 1/${division} at ${bpm} BPM`);
    }
  });

  // Mic check (Adobe Podcast's mic analysis, RX's Repair Assistant): findings with the effect that addresses each.
  const findingsList = body.querySelector<HTMLElement>(".fw-mic-findings");
  host.addEventListener("fw-selection", () => {
    if (findingsList && !findingsList.hidden) {
      findingsList.hidden = true;
      findingsList.replaceChildren();
    }
  });
  body.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const use = target.closest<HTMLElement>("[data-use]")?.dataset.use;
    if (use && pick) {
      if ([...pick.options].some((o) => o.value === use)) {
        if (search && search.value) {
          search.value = "";
          search.dispatchEvent(new Event("input"));
        }
        pick.value = use;
        showControls();
        pick.focus();
      }
      return;
    }
    if (target.closest<HTMLElement>("[data-an]")?.dataset.an !== "mic") return;
    const hit = find(engine.get("document"));
    if (!hit || !findingsList) return;
    setText(notice, "Checking the recording...");
    try {
      const res = await fetch(`/api/media/${hit.clip.mediaId}/mic-check`);
      if (!res.ok) throw new Error(`the engine answered ${res.status}`);
      const report = (await res.json()) as { findings: { level: string; text: string; suggest: string | null }[] };
      findingsList.replaceChildren(
        ...report.findings.map((f) => {
          const item = document.createElement("li");
          item.className = `fw-finding is-${f.level}`;
          const text = document.createElement("span");
          text.textContent = f.text;
          item.append(text);
          const option = f.suggest && pick ? [...pick.options].find((o) => o.value === f.suggest) : undefined;
          if (option && f.suggest) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "fw-ibtn";
            button.dataset.use = f.suggest;
            button.textContent = `Use ${(option.textContent ?? f.suggest).replace(/\.+$/, "")}`;
            item.append(button);
          }
          return item;
        }),
      );
      findingsList.hidden = false;
      const open = report.findings.filter((f) => f.level !== "ok").length;
      setText(notice, open ? `Mic check: ${open} thing${open === 1 ? "" : "s"} to look at` : "Mic check: the recording looks good");
    } catch (err) {
      setText(notice, `Could not check the recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail;
    render();
  });
  engine.subscribe("document", render);
  render();
}
