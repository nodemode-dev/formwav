/**
 * The editor's Clip tab, after the approved target (research/ui_reference): the selected clip's settings as one grid
 * of fields, each editing through the engine's own command, as the Inspector's fields do: the track's name
 * (rename-track), the clip's name (rename-clip), start (move-clip), gain (set-clip-gain), fades and each one's shape
 * (set-clip-fades), sound type (set-clip-type), mute (set-clips-mute), lock (set-clips-lock) and colour
 * (set-clip-color); its source and length are shown. PT-24: an ARA plug-in analyses the
 * clip, its state kept on the clip (set-clip-ara) so it is saved with the session, and renders it with that state
 * restored (set-clip-media). A field being typed in is never overwritten by an update. A dock panel like the others:
 * its toggle flips its hidden flag.
 */
import type { Engine } from "../engine";
import type { Clip, Command, FadeShape, SessionDoc, Track } from "../engine/document";
import type { MediaRef } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

// A stopwatch, inline and currentColor: the mark on a value that can change over time
const STOPWATCH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7"/><path d="M12 10v4l2.5 1.5M9.5 3h5"/></svg>`;
const COLORS = ["cyan", "violet", "amber", "pink", "slate", "green", "blue", "red"];
const SHAPES: Array<[string, string]> = [["linear", "Linear"], ["equal-power", "Equal power"], ["s-curve", "S-curve"], ["exponential", "Exponential"], ["logarithmic", "Logarithmic"]];
const TYPES: Array<[string, string]> = [["", "Not set"], ["dialogue", "Dialogue"], ["music", "Music"], ["effects", "Effects"], ["ambience", "Ambience"]];

export function mountClipTab(host: HTMLElement, engine: Engine): void {
  const anchor = host.querySelector<HTMLElement>(".fw-pane-timeline .fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]');
  if (!anchor || !view) return;
  const panel = document.createElement("section");
  panel.className = "fw-editor-panel fw-cliptab";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Clip");
  const field = (label: string, control: string, wide = false) => `<label class="fw-cf${wide ? " fw-cf-wide" : ""}"><span class="fw-cf-label">${label}</span>${control}</label>`;
  panel.innerHTML = `<p class="fw-cliptab-empty">Select a clip to see its settings here.</p><div class="fw-cliptab-grid">${[
    // Grouped as the approved inspector is: label left, value right, a head over each group
    `<h3 class="fw-cf-group">Clip</h3>`,
    field("Clip name", `<input type="text" data-f="clipName" maxlength="80">`),
    field("Track name", `<input type="text" data-f="name" maxlength="80">`),
    field("Start (s)", `<input type="number" data-f="start" min="0" step="0.001">`),
    field("Length (s)", `<output data-f="length"></output>`),
    field("Source", `<output data-f="source"></output>`, true),
    `<h3 class="fw-cf-group">Level and fades</h3>`,
    field("Gain (dB)", `<input type="number" data-f="gain" min="-60" max="24" step="0.1">`).replace('<span class="fw-cf-label">', `<span class="fw-cf-label"><button type="button" class="fw-stopwatch" data-auto-gain aria-label="Automate the gain over time" title="Automate the gain over time: opens the track's volume automation">${STOPWATCH}</button>`),
    field("Fade in (s)", `<input type="number" data-f="fadeIn" min="0" step="0.01">`),
    field("Fade out (s)", `<input type="number" data-f="fadeOut" min="0" step="0.01">`),
    field("Fade shape", `<select data-f="shape" title="Both fades' shape">${SHAPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`),
    field("Fade-out shape", `<select data-f="outShape" title="The fade-out's own shape">${SHAPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`),
    `<h3 class="fw-cf-group">Clip sound</h3>`,
    field("Sound type", `<select data-f="type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`),
    field("Mute", `<select data-f="mute"><option value="">Plays</option><option value="on">Muted</option></select>`),
    field("Lock", `<select data-f="lock"><option value="">None</option><option value="time">Time lock</option><option value="edit">Edit lock</option></select>`),
    `<h3 class="fw-cf-group">Colour</h3>`,
    `<div class="fw-cf fw-cf-wide"><span class="fw-cf-label">Colour</span><div class="fw-cf-colors" role="group" aria-label="Clip colour"><button type="button" class="fw-cf-color" data-color="" aria-label="The track's colour" title="The track's colour"></button>${COLORS.map((c) => `<button type="button" class="fw-cf-color" data-color="${c}" aria-label="${c}" title="${c}" style="color: var(--fw-color-${c})"></button>`).join("")}</div></div>`,
    `<div class="fw-cf-actions" role="group" aria-label="Clip actions"><button type="button" class="fw-ibtn" data-clip-act="split" title="Split this clip where the playhead is">Split at the playhead</button><button type="button" class="fw-ibtn" data-clip-act="normalize" title="Normalize the selected clips to a loudness target">Normalize</button><button type="button" class="fw-ibtn" data-clip-act="check" title="Measure the recording and list what it needs, in the Inspector">Check the recording</button><button type="button" class="fw-ibtn" data-clip-act="repair" title="Find the clip's problems and propose a repair chain, in the Inspector">Repair assistant</button></div>`,
    `<div class="fw-cf fw-cf-wide fw-cf-three"><span class="fw-cf-label">Separate</span><div class="fw-cf-ara-row"><button type="button" class="fw-ibtn" data-three>Speech, music and effects to three tracks</button></div><output class="fw-cf-ara-state" data-three-state>Three tracks that add up to this clip exactly</output></div>`,
    `<div class="fw-cf fw-cf-wide fw-cf-speech"><span class="fw-cf-label">Speech</span><div class="fw-cf-ara-row"><button type="button" class="fw-ibtn" data-speech>Mark where people speak</button></div><output class="fw-cf-ara-state" data-speech-state>Marks speech as regions, even under music</output></div>`,
    `<div class="fw-cf fw-cf-wide fw-cf-sync"><span class="fw-cf-label">Line up by sound</span><div class="fw-cf-ara-row"><button type="button" class="fw-ibtn" data-sync>Line up other tracks' takes to this one</button></div><output class="fw-cf-ara-state" data-sync-state>Overlapping takes move to match this clip's sound</output></div>`,
    `<div class="fw-cf fw-cf-wide fw-cf-ara"><span class="fw-cf-label">ARA plug-in</span><div class="fw-cf-ara-row"><select data-ara-plugin aria-label="ARA plug-in"><option value="">Looking for ARA plug-ins</option></select><button type="button" class="fw-ibtn" data-ara="analyze" disabled>Analyse</button><button type="button" class="fw-ibtn" data-ara="render" disabled>Render</button></div><output class="fw-cf-ara-state" data-ara-state></output></div>`,
  ].join("")}</div>`;
  anchor.before(panel);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.dataset.cliptab = "";
  toggle.setAttribute("aria-pressed", "false");
  toggle.hidden = true;
  toggle.textContent = "Clip";
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-pressed", String(!panel.hidden));
  });
  view.append(toggle);

  const f = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-f="${name}"]`) as T;
  let selected: string[] = [];
  const find = (doc: SessionDoc): { track: Track; clip: Clip } | null => {
    for (const track of doc.tracks) {
      const clip = track.clips.find((c) => c.id === selected[0]);
      if (clip) return { track, clip };
    }
    return null;
  };
  const sec = (samples: number, doc: SessionDoc) => samples / doc.sampleRate;
  const put = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    if (document.activeElement !== el && el.value !== value) el.value = value;
  };
  let araBusy = false;
  const render = () => {
    const doc = engine.get("document");
    const hit = find(doc);
    panel.classList.toggle("is-empty", !hit);
    if (!hit) return;
    const { track, clip } = hit;
    const media = doc.media[clip.mediaId];
    put(f<HTMLInputElement>("name"), track.name);
    setText(f("source"), media ? `${media.name}, ${media.format}, ${(media.sampleRate / 1000).toFixed(1)} kHz` : "");
    put(f<HTMLInputElement>("start"), sec(clip.start, doc).toFixed(3));
    setText(f("length"), sec(clip.length, doc).toFixed(3));
    put(f<HTMLInputElement>("gain"), clip.gainDb.toFixed(1));
    put(f<HTMLSelectElement>("type"), clip.soundType ?? "");
    put(f<HTMLInputElement>("fadeIn"), sec(clip.fadeIn ?? 0, doc).toFixed(2));
    put(f<HTMLInputElement>("fadeOut"), sec(clip.fadeOut ?? 0, doc).toFixed(2));
    put(f<HTMLSelectElement>("shape"), clip.fadeShape ?? "linear");
    put(f<HTMLSelectElement>("outShape"), clip.fadeOutShape ?? clip.fadeShape ?? "linear");
    const clipName = f<HTMLInputElement>("clipName");
    put(clipName, clip.name ?? "");
    const fileName = (media?.name ?? "").replace(/\.[a-z0-9]+$/i, "");
    if (clipName.placeholder !== fileName) clipName.placeholder = fileName;
    put(f<HTMLSelectElement>("mute"), clip.mute ? "on" : "");
    put(f<HTMLSelectElement>("lock"), clip.lock ?? "");
    for (const b of panel.querySelectorAll<HTMLElement>(".fw-cf-color")) b.setAttribute("aria-pressed", String((b.dataset.color ?? "") === (clip.color ?? "")));
    const ara = clip.ara;
    if (!araBusy) {
      setText(panel.querySelector("[data-ara-state]"), ara ? `${ara.label}: ${ara.notes} ${ara.notes === 1 ? "note" : "notes"} found; its state is saved with the session` : "Its analysis is saved with the session");
    }
    const select = panel.querySelector<HTMLSelectElement>("[data-ara-plugin]");
    if (select && ara && document.activeElement !== select && [...select.options].some((o) => o.value === ara.plugin) && select.value !== ara.plugin) select.value = ara.plugin;
  };

  panel.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const doc = engine.get("document");
    const hit = find(doc);
    if (!hit) return;
    const { track, clip } = hit;
    const ids = { trackId: track.id, clipId: clip.id };
    const samples = (v: string) => Math.max(0, Math.round(Number(v) * doc.sampleRate));
    const value = el.value;
    if (!Number.isFinite(Number(value)) && el instanceof HTMLInputElement && el.type === "number") return render();
    switch (el.dataset.f) {
      case "name":
        if (value.trim()) engine.dispatch({ type: "rename-track", trackId: track.id, name: value.trim() });
        break;
      case "start":
        engine.dispatch({ type: "move-clip", ...ids, start: samples(value) });
        break;
      case "gain":
        engine.dispatch({ type: "set-clip-gain", ...ids, gainDb: Math.min(24, Math.max(-60, Number(value))) });
        break;
      case "type":
        engine.dispatch({ type: "set-clip-type", ...ids, soundType: (value || null) as "dialogue" | "music" | "effects" | "ambience" | null });
        break;
      case "fadeIn":
      case "fadeOut":
      case "shape":
      case "outShape": {
        const fadeIn = el.dataset.f === "fadeIn" ? samples(value) : (clip.fadeIn ?? 0);
        const fadeOut = el.dataset.f === "fadeOut" ? samples(value) : (clip.fadeOut ?? 0);
        const shape = (el.dataset.f === "shape" ? value : (clip.fadeShape ?? "linear")) as FadeShape;
        // Fade shape sets both fades, Fade-out shape the fade-out's own; a fade's length leaves both shapes as they are
        const outShape = el.dataset.f === "shape" ? null : el.dataset.f === "outShape" ? (value as FadeShape) : undefined;
        engine.dispatch({ type: "set-clip-fades", ...ids, fadeIn: Math.min(fadeIn, clip.length), fadeOut: Math.min(fadeOut, clip.length), shape, ...(outShape !== undefined ? { outShape } : {}) });
        break;
      }
      case "clipName":
        engine.dispatch({ type: "rename-clip", ...ids, name: value });
        break;
      case "mute":
        engine.dispatch({ type: "set-clips-mute", clipIds: [clip.id], mute: value === "on" });
        break;
      case "lock":
        engine.dispatch({ type: "set-clips-lock", clipIds: [clip.id], lock: value === "time" || value === "edit" ? value : null });
        break;
    }
    render();
  });
  panel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".fw-cf-color");
    const hit = b ? find(engine.get("document")) : null;
    if (!b || !hit) return;
    engine.dispatch({ type: "set-clip-color", trackId: hit.track.id, clipId: hit.clip.id, color: b.dataset.color ?? "" });
  });

  // The canvas's four clip actions: a split through the engine, the rest through the controls that already do them
  // (the footer's Loudness, the Inspector's recording check and repair assistant, whose findings show in the Inspector)
  panel.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-clip-act]")?.dataset.clipAct;
    const hit = act ? find(engine.get("document")) : null;
    if (!act || !hit) return;
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    if (act === "split") {
      const at = engine.get("transport").positionSamples;
      const { track, clip } = hit;
      if (at > clip.start && at < clip.start + clip.length) engine.dispatch({ type: "split-clip", trackId: track.id, clipId: clip.id, at });
      else setText(notice, "Move the playhead into the clip to split it there");
      return;
    }
    if (act === "normalize") return void host.querySelector<HTMLButtonElement>(".fw-loud-btn")?.click();
    const inspector = host.querySelector<HTMLElement>(".fw-pane-inspector");
    if (inspector?.hidden) host.querySelector<HTMLButtonElement>(".fw-tool-tray [data-inspector]")?.click();
    const button = host.querySelector<HTMLButtonElement>(act === "check" ? '.fw-pane-inspector [data-an="mic"]' : '.fw-pane-inspector [data-repair-act="analyse"]');
    button?.click();
    const card = button?.closest<HTMLElement>(".fw-insp-section");
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    card?.querySelectorAll<HTMLElement>(".fw-mic-findings")[act === "check" ? 0 : 1]?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  });

  // The stopwatch on Gain: the track's volume automation opens under its lane (the lane's own A button), which is where
  // the gain over time is drawn
  panel.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-auto-gain]")) return;
    const hit = find(engine.get("document"));
    const toggle = hit ? [...host.querySelectorAll<HTMLElement>(".fw-lane")].find((l) => l.dataset.key === hit.track.id)?.querySelector<HTMLButtonElement>(".fw-auto-toggle") : null;
    if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  });

  // Speech, music and effects (services/three_way.py, a trained model where installed): three tracks under the clip that sum to it exactly, one undo step
  panel.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-three]");
    const hit = b ? find(engine.get("document")) : null;
    if (!b || !hit) return;
    const state = panel.querySelector("[data-three-state]");
    const doc = engine.get("document");
    const { clip, track } = hit;
    const mediaRate = doc.media[clip.mediaId]?.sampleRate ?? doc.sampleRate;
    const start = clip.sourceIn / mediaRate;
    b.disabled = true;
    setText(state, "Separating speech, music and effects...");
    try {
      const res = await fetch(`/api/media/${clip.mediaId}/three-way`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start, end: start + clip.length / doc.sampleRate }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const alone = track.clips.length === 1;
      engine.dispatch({ type: "batch", commands: [
        ...(["speech", "music", "ambience"] as const).map((k) => ({ type: "import-media" as const, media: out[k], at: clip.start })),
        ...(alone ? [{ type: "set-track-mute" as const, trackId: track.id, mute: true }] : []),
      ] });
      const how = out.method === "trained" ? "by the trained model" : "music by rule; trained model in Sounds > Models";
      setText(state, alone ? `On three new tracks, the original muted (${how})` : `On three new tracks; lower or mute the original (${how})`);
    } catch (err) {
      setText(state, err instanceof Error ? err.message : String(err));
    } finally {
      b.disabled = false;
    }
  });

  // Where people speak (services/vad.py, Silero VAD ported from formcut): the clip's speech marked as regions, in one undo step
  panel.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-speech]");
    const hit = b ? find(engine.get("document")) : null;
    if (!b || !hit) return;
    const state = panel.querySelector("[data-speech-state]");
    const rate = engine.get("document").sampleRate;
    const clip = hit.clip;
    b.disabled = true;
    setText(state, "Listening for speech...");
    try {
      const res = await fetch(`/api/media/${clip.mediaId}/speech`);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      // sourceIn counts the media's samples, length the session's: a 44.1 kHz file in a 48 kHz session differs
      const mediaRate = engine.get("document").media[clip.mediaId]?.sampleRate ?? rate;
      const inS = clip.sourceIn / mediaRate;
      const outS = inS + clip.length / rate;
      const marks = (out.regions as { start: number; end: number }[])
        .map((r) => ({ start: Math.max(r.start, inS), end: Math.min(r.end, outS) }))
        .filter((r) => r.end > r.start)
        .map((r) => ({ type: "add-region" as const, start: Math.round(clip.start + (r.start - inS) * rate), end: Math.round(clip.start + (r.end - inS) * rate), label: "Speech" }));
      if (marks.length) engine.dispatch({ type: "batch", commands: marks });
      const seconds = marks.reduce((n, m) => n + (m.end - m.start), 0) / rate;
      setText(state, marks.length ? `Marked ${marks.length} stretch${marks.length === 1 ? "" : "es"} of speech, ${seconds.toFixed(1)} s in all.` : "No speech found in this clip.");
    } catch (err) {
      setText(state, err instanceof Error ? err.message : String(err));
    } finally {
      b.disabled = false;
    }
  });

  // The comparison's Multitrack recording row: takes from different devices (or a remote room) lined up by their sound
  // (services/sync.py). The selected clip is the reference; every clip on another track that overlaps it is measured over
  // the stretch both cover, and those with a strong match move, all in one undo step; weak matches are named and stay.
  panel.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-sync]");
    const hit = b ? find(engine.get("document")) : null;
    if (!b || !hit) return;
    const doc = engine.get("document");
    const rate = doc.sampleRate;
    const ref = hit.clip;
    const others = doc.tracks.filter((t) => t.id !== hit.track.id).flatMap((t) => t.clips.filter((c) => c.start < ref.start + ref.length && ref.start < c.start + c.length).map((c) => ({ track: t, clip: c })));
    const state = panel.querySelector("[data-sync-state]");
    if (!others.length) return setText(state, "No clip on another track overlaps this one.");
    b.disabled = true;
    setText(state, `Listening to ${others.length} take${others.length === 1 ? "" : "s"}...`);
    try {
      const lags: { lag: number; confidence: number; aligned: boolean }[] = [];
      for (const o of others) {
        const from = Math.max(ref.start, o.clip.start);
        const span = Math.min(ref.start + ref.length, o.clip.start + o.clip.length) - from;
        const res = await fetch("/api/media/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rate, seconds: Math.min(120, span / rate), reference: { media: ref.mediaId, in: (ref.sourceIn + from - ref.start) / rate }, others: [{ media: o.clip.mediaId, in: (o.clip.sourceIn + from - o.clip.start) / rate }] }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        lags.push(out.lags[0]);
      }
      // A late take moves earlier; one that would cross the session's start stays at zero and slips its sound instead
      const moves: Command[] = others.flatMap((o, i): Command[] => {
        if (!lags[i].aligned) return [];
        const to = Math.round(o.clip.start - lags[i].lag * rate);
        if (to >= 0) return [{ type: "move-clip", trackId: o.track.id, clipId: o.clip.id, start: to }];
        return [{ type: "set-clip-bounds", trackId: o.track.id, clipId: o.clip.id, start: 0, sourceIn: o.clip.sourceIn - to, length: Math.max(1, o.clip.length + to) }];
      });
      if (moves.length) engine.dispatch({ type: "batch", commands: moves });
      const said = others.map((o, i) => (lags[i].aligned ? `${o.track.name} ${lags[i].lag >= 0 ? "earlier" : "later"} by ${(Math.abs(lags[i].lag) * 1000).toFixed(2)} ms` : `${o.track.name} left (no clear match)`));
      setText(state, `Lined up: ${said.join("; ")}.`);
    } catch (err) {
      setText(state, err instanceof Error ? err.message : String(err));
    } finally {
      b.disabled = false;
    }
  });

  // PT-24: the installed ARA plug-ins (the engine's scan, each asked whether it offers ARA); a clip analysed with one,
  // its state kept on the clip so it is saved with the session, and rendered through it with that state restored.
  // Both work on the clip's original audio: the state describes the audio it analysed, not a render of it.
  const araSelect = panel.querySelector<HTMLSelectElement>("[data-ara-plugin]") as HTMLSelectElement;
  const araButtons = [...panel.querySelectorAll<HTMLButtonElement>("[data-ara]")];
  const engineJson = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return out;
  };
  void (async () => {
    try {
      const listed = (await engineJson("/api/ara/plugins")) as { plugins: { name: string; label: string; version?: string }[] };
      araSelect.replaceChildren(...(listed.plugins.length ? listed.plugins.map((p) => new Option(`${p.label}${p.version ? ` ${p.version}` : ""}`, p.name)) : [new Option("No ARA plug-ins installed", "")]));
      for (const b of araButtons) b.disabled = listed.plugins.length === 0;
      render();
    } catch {
      araSelect.replaceChildren(new Option("ARA plug-ins unavailable while the engine is offline", ""));
    }
  })();
  panel.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ara]");
    const hit = b ? find(engine.get("document")) : null;
    if (!b || !hit || !araSelect.value || araBusy) return;
    const { track, clip } = hit;
    const name = araSelect.value;
    const label = (araSelect.selectedOptions[0]?.textContent ?? name).replace(/ [0-9.]+$/, "");
    const source = clip.original ?? clip.mediaId;
    const state = panel.querySelector("[data-ara-state]");
    araBusy = true;
    for (const x of araButtons) x.disabled = true;
    try {
      if (b.dataset.ara === "analyze") {
        setText(state, `Analysing with ${label}...`);
        const out = (await engineJson(`/api/media/${source}/ara/analyze?name=${encodeURIComponent(name)}`, { method: "POST" })) as { notes: number; archiveId: string; archive: string };
        araBusy = false;
        engine.dispatch({ type: "set-clip-ara", trackId: track.id, clipId: clip.id, ara: { plugin: name, label, archiveId: out.archiveId, archive: out.archive, notes: out.notes } });
      } else {
        setText(state, `Rendering through ${label}...`);
        const archive = clip.ara && clip.ara.plugin === name ? clip.ara.archive : undefined;
        const media = (await engineJson(`/api/media/${source}/ara/render?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(archive ? { archive } : {}) })) as MediaRef;
        araBusy = false;
        engine.dispatch({ type: "set-clip-media", trackId: track.id, clipId: clip.id, media });
      }
      render();
    } catch (err) {
      araBusy = false;
      setText(state, err instanceof Error ? err.message : String(err));
    } finally {
      for (const x of araButtons) x.disabled = araSelect.value === "";
    }
  });
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail ?? [];
    render();
  });
  engine.subscribe("document", render);
  render();
}
