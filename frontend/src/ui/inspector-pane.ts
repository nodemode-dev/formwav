import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import type { FadeShape } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

const BODY = `
<p class="fw-empty-note fw-insp-empty"></p>
<div class="fw-insp-section fw-insp-clip" hidden>
  <div class="fw-insp-head">Clip</div>
  <label class="fw-field"><span>Start</span><input type="number" step="0.001" min="0" data-f="start"><output>s</output></label>
  <div class="fw-field"><span>Length</span><output data-o="length"></output><span></span></div>
  <label class="fw-field"><span>Clip gain</span><input type="range" min="-24" max="24" step="0.1" data-f="gain"><output data-o="gain"></output></label>
  <label class="fw-field"><span>Fade in</span><input type="number" step="0.01" min="0" data-f="fadeIn"><output>s</output></label>
  <label class="fw-field"><span>Fade out</span><input type="number" step="0.01" min="0" data-f="fadeOut"><output>s</output></label>
  <label class="fw-field"><span>Fade curve</span><select data-f="shape"><option value="linear">Linear</option><option value="equal-power">Equal power</option><option value="s-curve">S-curve</option><option value="exponential">Exponential</option></select><span></span></label>
</div>
<div class="fw-insp-section fw-insp-effects" hidden>
  <div class="fw-insp-head">Effects</div>
  <button type="button" class="fw-ibtn fw-btn-export fw-voice-go" data-fx="enhance" title="formcut's voice-clean: rumble cut, denoise, gentle compression and a limiter">Enhance speech</button>
  <input type="search" class="fw-fx-search" data-fx="search" placeholder="Search effects" aria-label="Search effects">
  <label class="fw-field fw-field-stack"><span>Effect</span><select data-fx="pick"></select></label>
  <div class="fw-fx-params"></div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-fx="apply">Apply to this clip</button><button type="button" class="fw-ibtn" data-fx="apply-all">Apply to all clips</button></div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-fx="chain-add">Add to chain</button><button type="button" class="fw-ibtn" data-fx="chain-apply" hidden>Apply chain</button><button type="button" class="fw-ibtn" data-fx="chain-clear" hidden>Clear chain</button></div>
  <ol class="fw-chain" hidden></ol>
</div>
<div class="fw-insp-section fw-insp-analyze" hidden>
  <div class="fw-insp-head">Analyze</div>
  <div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-an="stats">Statistics</button><button type="button" class="fw-ibtn" data-an="spectrogram">Spectrogram</button><button type="button" class="fw-ibtn" data-an="mic">Mic check</button></div>
  <ul class="fw-mic-findings" hidden></ul>
  <dl class="fw-stats"></dl>
  <img class="fw-spectrogram" alt="Spectrogram of the selected clip" hidden>
</div>
<div class="fw-insp-section fw-insp-track" hidden>
  <div class="fw-insp-head fw-insp-track-name">Track</div>
  <label class="fw-field"><span>Volume</span><input type="range" min="-60" max="12" step="0.1" data-f="volume"><output data-o="volume"></output></label>
  <label class="fw-field"><span>Pan</span><input type="range" min="-1" max="1" step="0.01" data-f="pan"><output data-o="pan"></output></label>
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
