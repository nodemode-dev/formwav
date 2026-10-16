import type { Player } from "../audio/player";
import type { Engine, SessionDoc, Track } from "../engine";
import { fxCategory, type Bus, type FxCategory, type Vca } from "../engine/document";
import { patchList, setText } from "../vendor/nodemode/dom-stable";
import { icon as fcIcon } from "../vendor/formcut/icons";
import { knobify, syncKnob } from "./knob";

type Strip = { kind: "track"; item: Track } | { kind: "bus"; item: Bus } | { kind: "vca"; item: Vca } | { kind: "master"; item: { id: string; name: string; gainDb: number } };

function stripNode(kind: Strip["kind"]): HTMLElement {
  const node = document.createElement("div");
  node.className = "fw-strip";
  node.dataset.kind = kind;
  node.innerHTML =
    `<div class="fw-strip-name"></div><span class="fw-strip-kind">${kind === "track" ? "Track" : kind === "bus" ? "Bus" : kind === "vca" ? "VCA" : "Output"}</span>` +
    `<button type="button" class="fw-strip-clip" data-clip="false" aria-label="Clip indicator, click to reset" title="Reached 0 dBFS (click to reset)"${kind === "vca" ? " hidden" : ""}></button>` +
    `<div class="fw-strip-meter" aria-hidden="true"><div class="fw-out-track"><div class="fw-out-bar"></div><span class="fw-out-hold"></span></div><div class="fw-out-track"><div class="fw-out-bar"></div><span class="fw-out-hold"></span></div>${kind === "master" ? ["L", "R", "C", "LFE", "Ls", "Rs"].map((ch) => `<div class="fw-out-track fw-out-51" data-ch="${ch}" title="5.1 ${ch}" hidden><div class="fw-out-bar"></div></div>`).join("") : ""}</div>` +
    `<input class="fw-strip-fader" type="range" min="-60" max="12" step="0.1" data-default="0" aria-label="Volume">` +
    `<output class="fw-strip-db"></output>` +
    `<input class="fw-strip-pan" type="range" min="-1" max="1" step="0.01" data-default="0" aria-label="Pan"${kind === "master" || kind === "vca" ? " hidden" : ""}>` +
    `<div class="fw-strip-buttons"${kind === "master" ? " hidden" : ""}><button type="button" class="fw-strip-mute fw-icon-btn" aria-pressed="false" aria-label="Mute" title="Mute">M</button><button type="button" class="fw-strip-solo fw-icon-btn" aria-pressed="false" aria-label="Solo" title="Solo (Alt-click solos it alone; Cmd or Ctrl-click makes it solo safe)"${kind !== "track" ? " hidden" : ""}>S</button></div>` +
    `<button type="button" class="fw-strip-phase" aria-pressed="false" aria-label="Invert polarity" title="Invert the polarity, ahead of the inserts"${kind !== "track" ? " hidden" : ""}>&#216;</button>` +
    `<output class="fw-strip-lufs" title="Integrated loudness of what plays, LUFS"${kind !== "master" ? " hidden" : ""}>-- LUFS I</output>` +
    `<details class="fw-strip-route"${kind === "master" ? " hidden" : ""}><summary>${kind === "track" ? "Route" : "More"}</summary><div class="fw-route-box">` +
    `<select class="fw-strip-out" aria-label="Output"${kind !== "track" ? " hidden" : ""}></select>` +
    `<select class="fw-strip-vca" aria-label="VCA"${kind !== "track" ? " hidden" : ""}></select>` +
    `<select class="fw-strip-send" aria-label="Send to bus" title="Send this track, after its inserts and fader, to a bus as well"${kind !== "track" ? " hidden" : ""}></select>` +
    `<input class="fw-strip-send-level" type="range" min="-60" max="12" step="0.5" value="-12" data-default="-12" aria-label="Send level" title="Send level, dB"${kind !== "track" ? " hidden" : ""}>` +
    `<select class="fw-strip-auto" aria-label="Automation mode" title="Read plays the automation; Write, Touch, Latch and Trim record the fader into it while playing; Off plays the fader, pan and filters as set and keeps the lanes"${kind !== "track" ? " hidden" : ""}><option value="off">Off</option><option value="read" selected>Read</option><option value="write">Write</option><option value="touch">Touch</option><option value="latch">Latch</option><option value="trim">Trim</option></select>` +
    `<label class="fw-strip-trim-row"${kind !== "track" ? " hidden" : ""}><span>Trim</span><input class="fw-strip-trim" type="range" min="-24" max="24" step="0.5" value="0" data-default="0" aria-label="Input trim" title="Input trim, dB, ahead of the inserts"></label>` +
    `<button type="button" class="fw-ibtn fw-strip-invert" aria-pressed="false" aria-label="Invert polarity" title="Invert the polarity, ahead of the inserts"${kind !== "track" ? " hidden" : ""}>Invert</button>` +
    `<button type="button" class="fw-ibtn fw-strip-coalesce"${kind === "vca" ? "" : " hidden"} title="Write this VCA's level, its lane or its fader, into each of its tracks' volume and set the VCA back to 0 dB; the mix does not change">Coalesce</button>` +
    `<button type="button" class="fw-ibtn fw-strip-remove"${kind === "bus" || kind === "vca" ? "" : " hidden"} title="Remove; its tracks go back to the master or leave the VCA">Remove</button>` +
    `</div></details>`;
  return node;
}

const dbText = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

function setAttr(el: Element | null, name: string, value: string): void {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function updateStrip(node: HTMLElement, strip: Strip, doc: SessionDoc): void {
  setText(node.querySelector(".fw-strip-name"), strip.item.name);
  const palette = ["cyan", "violet", "amber", "pink", "slate", "green", "blue", "red"];
  const color = strip.kind === "track" ? `var(--fw-color-${strip.item.color ?? palette[Math.max(0, doc.tracks.indexOf(strip.item)) % 8]})` : strip.kind === "master" ? "var(--accent-color)" : "var(--text-muted)";
  if (node.style.getPropertyValue("--fw-strip-color") !== color) node.style.setProperty("--fw-strip-color", color);
  if (strip.kind === "master") {
    const masterFader = node.querySelector<HTMLInputElement>(".fw-strip-fader");
    if (masterFader && node.dataset.dragging !== "fader") {
      const value = String(strip.item.gainDb);
      if (masterFader.value !== value) masterFader.value = value;
      setText(node.querySelector(".fw-strip-db"), dbText(strip.item.gainDb));
    }
    return;
  }
  const fader = node.querySelector<HTMLInputElement>(".fw-strip-fader");
  const pan = node.querySelector<HTMLInputElement>(".fw-strip-pan");
  const off = strip.kind === "track" && strip.item.autoOff === true;
  const automation = strip.kind === "track" && !off ? strip.item.automation : undefined;
  const mode = node.querySelector<HTMLSelectElement>(".fw-strip-auto");
  if (strip.kind === "track" && mode) {
    if (off && mode.value !== "off") mode.value = "off";
    else if (!off && mode.value === "off") mode.value = "read";
  }
  const volumeAuto = !!automation?.volume?.length;
  const panAuto = !!automation?.pan?.length;
  // the fader follows the automation in Read; in Write, Touch, Latch and Trim it records over it
  const followed = volumeAuto && (mode?.value ?? "read") === "read";
  if (fader && node.dataset.dragging !== "fader") {
    const value = String(strip.item.gainDb);
    if (fader.value !== value) fader.value = value;
    if (fader.disabled !== followed) fader.disabled = followed;
    setAttr(fader, "title", followed ? "Volume follows this track's automation (choose Touch, Latch, Write or Trim to record over it)" : "Volume");
    setText(node.querySelector(".fw-strip-db"), followed ? "auto" : dbText(strip.item.gainDb));
  }
  if (pan && strip.kind !== "vca") {
    knobify(pan);
    const value = String(strip.item.pan ?? 0);
    if (pan.value !== value) pan.value = value;
    if (pan.disabled !== panAuto) pan.disabled = panAuto;
    setAttr(pan, "title", panAuto ? "Pan follows this track's automation" : `Pan ${(strip.item.pan ?? 0).toFixed(2)}`);
    syncKnob(pan);
  }
  setAttr(node.querySelector(".fw-strip-mute"), "aria-pressed", String(!!strip.item.mute));
  if (strip.kind === "track") {
    if ((node.dataset.inactive !== undefined) !== !!strip.item.inactive) {
      if (strip.item.inactive) node.dataset.inactive = "";
      else delete node.dataset.inactive;
    }
    setAttr(node.querySelector(".fw-strip-solo"), "aria-pressed", String(strip.item.solo));
    const solo = node.querySelector<HTMLElement>(".fw-strip-solo");
    if (solo && (solo.dataset.safe === "true") !== !!strip.item.soloSafe) solo.dataset.safe = String(!!strip.item.soloSafe);
    setAttr(solo, "title", strip.item.soloSafe ? "Solo safe: plays through other tracks' solos (Cmd or Ctrl-click to clear)" : "Solo (Alt-click solos it alone; Cmd or Ctrl-click makes it solo safe)");
    setAttr(node.querySelector(".fw-strip-invert"), "aria-pressed", String(!!strip.item.invert));
    setAttr(node.querySelector(".fw-strip-phase"), "aria-pressed", String(!!strip.item.invert));
    const trim = node.querySelector<HTMLInputElement>(".fw-strip-trim");
    if (trim && node.dataset.dragging !== "trim") {
      const value = String(strip.item.trimDb ?? 0);
      if (trim.value !== value) trim.value = value;
      setAttr(trim, "title", `Input trim ${dbText(strip.item.trimDb ?? 0)}, ahead of the inserts`);
    }
    const out = node.querySelector<HTMLSelectElement>(".fw-strip-out");
    if (out) {
      const options = [["", "Master"], ...(doc.buses ?? []).map((b) => [b.id, b.name])];
      const signature = JSON.stringify(options);
      if (out.dataset.options !== signature) {
        out.dataset.options = signature;
        out.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
      }
      const value = strip.item.busId ?? "";
      if (out.value !== value) out.value = value;
    }
    // PT-18: the strip shows the track's first send (the document allows several)
    const send = node.querySelector<HTMLSelectElement>(".fw-strip-send");
    if (send) {
      const options = [["", "No send"], ...(doc.buses ?? []).map((b) => [b.id, `Send: ${b.name}`])];
      const signature = JSON.stringify(options);
      if (send.dataset.options !== signature) {
        send.dataset.options = signature;
        send.replaceChildren(...options.map(([v, label]) => new Option(label, v)));
      }
      const first = strip.item.sends?.[0];
      if (send.value !== (first?.busId ?? "")) send.value = first?.busId ?? "";
      const level = node.querySelector<HTMLInputElement>(".fw-strip-send-level");
      if (level && first && Number(level.value) !== first.gainDb) level.value = String(first.gainDb);
    }
    const vcaSel = node.querySelector<HTMLSelectElement>(".fw-strip-vca");
    if (vcaSel) {
      const options = [["", "No VCA"], ...(doc.vcas ?? []).map((v) => [v.id, v.name])];
      const signature = JSON.stringify(options);
      if (vcaSel.dataset.options !== signature) {
        vcaSel.dataset.options = signature;
        vcaSel.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
      }
      const value = strip.item.vcaId ?? "";
      if (vcaSel.value !== value) vcaSel.value = value;
    }
  }
}

/** A console-style mixer docked over the bottom of the timeline, toggled from the transport bar or with X. */
export function mountMixer(host: HTMLElement, engine: Engine, player: Player): void {
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.innerHTML = `${fcIcon("mixer")}<span>Mixer</span>`;
  toggle.title = "Show the mixer (X)";
  toggle.setAttribute("aria-pressed", "false");
  (host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray") ?? transport)?.append(toggle);

  const panel = document.createElement("section");
  panel.className = "fw-mixer";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Mixer");
  const strips = document.createElement("div");
  strips.className = "fw-mixer-strips";
  // Buses and VCAs are made here: buses had routing but no way to be created from the interface.
  const bar = document.createElement("div");
  bar.className = "fw-mixer-bar";
  bar.innerHTML =
    `<button type="button" class="fw-ibtn" data-mix="add-bus">Add bus</button><button type="button" class="fw-ibtn" data-mix="add-vca" title="A fader for a group of tracks, with no audio through it">Add VCA</button>` +
    `<button type="button" class="fw-ibtn" data-mix="clear-solos" title="Unsolo every track">Clear solos</button><button type="button" class="fw-ibtn" data-mix="clear-mutes" title="Unmute every track">Clear mutes</button>` +
    `<select class="fw-mix-bypass" aria-label="Bypass inserts" title="Bypass or switch on a kind of insert on every track (the selected clip's tracks when clips are selected)"><option value="">Bypass inserts</option><option value="all">All inserts</option><option value="eq">EQ</option><option value="dynamics">Dynamics</option><option value="reverb">Reverb</option><option value="delay">Delay</option><option value="modulation">Modulation</option></select>` +
    `<select class="fw-mix-panlaw" aria-label="Pan law" title="How loud a mono track panned to the centre plays: 0 dB balance, or -3, -4.5 or -6 dB in each side"><option value="0">Pan law 0 dB</option><option value="-3">Pan law -3 dB</option><option value="-4.5">Pan law -4.5 dB</option><option value="-6">Pan law -6 dB</option></select>`;
  let selectedClips: string[] = [];
  host.addEventListener("fw-selection", (e) => {
    selectedClips = (e as CustomEvent<string[]>).detail ?? [];
  });
  bar.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-mix]")?.dataset.mix;
    const doc = engine.get("document");
    if (action === "add-bus") engine.dispatch({ type: "add-bus", name: `Bus ${(doc.buses ?? []).length + 1}` });
    else if (action === "add-vca") engine.dispatch({ type: "add-vca", name: `VCA ${(doc.vcas ?? []).length + 1}` });
    else if (action === "clear-solos") engine.dispatch({ type: "clear-solos" });
    else if (action === "clear-mutes") engine.dispatch({ type: "clear-mutes" });
  });
  bar.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    const doc = engine.get("document");
    if (el.classList.contains("fw-mix-panlaw")) {
      const law = el.value === "-3" || el.value === "-4.5" || el.value === "-6" ? el.value : "0";
      engine.dispatch({ type: "set-pan-law", law });
    } else if (el.classList.contains("fw-mix-bypass") && el.value) {
      const category = el.value as FxCategory;
      const chosen = doc.tracks.filter((t) => t.clips.some((c) => selectedClips.includes(c.id)));
      const tracks = chosen.length ? chosen : doc.tracks;
      // bypass when any matching insert is on; when all are already off, switch them back on
      const anyOn = tracks.some((t) => (t.fx ?? []).some((f) => !f.bypass && (category === "all" || fxCategory(f) === category)));
      engine.dispatch({ type: "bypass-fx-category", trackIds: tracks.map((t) => t.id), category, bypass: anyOn });
      el.value = "";
      el.blur();
    }
  });
  panel.append(bar, strips);
  const linked = new Set<string>();
  const markLinked = () => {
    for (const node of strips.querySelectorAll<HTMLElement>(".fw-strip[data-kind=\"track\"]")) {
      const on = linked.has(node.dataset.key ?? "");
      if ((node.dataset.linked !== undefined) !== on) {
        if (on) node.dataset.linked = "";
        else delete node.dataset.linked;
      }
      setAttr(node.querySelector(".fw-strip-name"), "title", on ? "Linked: its fader moves with the other linked faders (Cmd or Ctrl-click to unlink)" : "Cmd or Ctrl-click to link this fader with others");
    }
  };
  if (transport) transport.before(panel);
  else host.append(panel);

  const render = (doc: SessionDoc) => {
    if (panel.hidden) return;
    const law = bar.querySelector<HTMLSelectElement>(".fw-mix-panlaw");
    if (law && law.value !== (doc.panLaw ?? "0")) law.value = doc.panLaw ?? "0";
    const items: Strip[] = [
      ...doc.tracks.filter((t) => !t.hidden).map((item) => ({ kind: "track" as const, item })),
      ...(doc.buses ?? []).map((item) => ({ kind: "bus" as const, item })),
      ...(doc.vcas ?? []).map((item) => ({ kind: "vca" as const, item })),
      { kind: "master" as const, item: { id: "master", name: "Master", gainDb: doc.masterGainDb ?? 0 } },
    ];
    patchList(strips, items, {
      key: (s) => s.item.id,
      create: (s) => {
        const node = stripNode(s.kind);
        updateStrip(node, s, doc);
        return node;
      },
      update: (node, s) => updateStrip(node, s, doc),
    });
    for (const id of linked) if (!doc.tracks.some((t) => t.id === id && !t.hidden)) linked.delete(id);
    markLinked();
  };
  engine.subscribe("document", render);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
    render(engine.get("document"));
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden !== false));
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "x") return;
    e.preventDefault();
    setOpen(panel.hidden !== false);
  });

  const stripOf = (el: EventTarget | null) => {
    const node = (el as HTMLElement | null)?.closest<HTMLElement>(".fw-strip");
    const id = node?.dataset.key;
    return node && id ? { node, id, bus: node.dataset.kind === "bus" } : null;
  };
  // PT-43, automation modes on a track's fader while playing: Write records it from the start of play, Touch while it
  // is held, Latch from the first touch until stop (holding the last value), Trim offsets the existing automation by the
  // fader's move; at stop each pass replaces the automation in the span it covered, one undo step for all tracks
  type Pass = { mode: string; points: { time: number; value: number }[]; from: number; to: number | null; touching: boolean; touchedOnce: boolean; trimFrom: number; base: { time: number; value: number }[]; staticDb: number };
  const passes = new Map<string, Pass>();
  /** Each fader's value after its last input or release, so a Trim touch measures its offset from where it began. */
  const lastFader = new Map<string, number>();
  const modeOf = (id: string) => panel.querySelector<HTMLSelectElement>(`.fw-strip[data-key="${id}"] .fw-strip-auto`)?.value ?? "read";
  const faderOf = (id: string) => Number(panel.querySelector<HTMLInputElement>(`.fw-strip[data-key="${id}"] .fw-strip-fader`)?.value ?? 0);
  const valueAt = (pts: { time: number; value: number }[], t: number, fallback: number) => {
    if (!pts.length) return fallback;
    if (t <= pts[0].time) return pts[0].value;
    for (let i = 1; i < pts.length; i++) if (t <= pts[i].time) return pts[i - 1].value + ((pts[i].value - pts[i - 1].value) * (t - pts[i - 1].time)) / Math.max(1, pts[i].time - pts[i - 1].time);
    return pts[pts.length - 1].value;
  };
  const passFor = (id: string, mode: string, at: number) => {
    let p = passes.get(id);
    if (!p) {
      const track = engine.get("document").tracks.find((t) => t.id === id);
      p = { mode, points: [], from: at, to: null, touching: false, touchedOnce: false, trimFrom: faderOf(id), base: [...(track?.automation?.volume ?? [])], staticDb: track?.gainDb ?? 0 };
      passes.set(id, p);
    }
    return p;
  };
  const record = (id: string, p: Pass, at: number) => {
    const last = p.points[p.points.length - 1];
    if (last && at - last.time < engine.get("document").sampleRate * 0.02) return;
    const fader = faderOf(id);
    const value = p.mode === "trim" ? valueAt(p.base, at, p.staticDb) + (fader - p.trimFrom) : fader;
    p.points.push({ time: Math.round(at), value: Math.round(value * 100) / 100 });
  };
  panel.addEventListener("input", (e) => {
    const s = stripOf(e.target);
    if (s && (e.target as HTMLElement).classList.contains("fw-strip-trim")) s.node.dataset.dragging = "trim";
    if (!s || !(e.target as HTMLElement).classList.contains("fw-strip-fader")) return;
    s.node.dataset.dragging = "fader";
    const now = Number((e.target as HTMLInputElement).value);
    // the fader's value before this input (the input event comes after the slider has moved)
    const before = lastFader.get(s.id);
    lastFader.set(s.id, now);
    setText(s.node.querySelector(".fw-strip-db"), dbText(now));
    if (linked.has(s.id) && linked.size > 1 && !engine.get("transport").playing) {
      const doc = engine.get("document");
      const delta = now - (doc.tracks.find((t) => t.id === s.id)?.gainDb ?? 0);
      for (const id of linked) {
        if (id === s.id) continue;
        const node = strips.querySelector<HTMLElement>(`.fw-strip[data-key="${id}"]`);
        const other = node?.querySelector<HTMLInputElement>(".fw-strip-fader");
        if (!node || !other || other.disabled) continue;
        const db = Math.max(-60, Math.min(12, (doc.tracks.find((t) => t.id === id)?.gainDb ?? 0) + delta));
        node.dataset.dragging = "fader";
        other.value = String(db);
        setText(node.querySelector(".fw-strip-db"), dbText(db));
      }
    }
    const mode = s.node.dataset.kind === "track" ? modeOf(s.id) : "read";
    const transport = engine.get("transport");
    if (mode === "read" || !transport.playing) return;
    const p = passFor(s.id, mode, transport.positionSamples);
    if (!p.touching) {
      p.touching = true;
      p.to = null;
      if (mode === "trim") p.trimFrom = before ?? p.staticDb;
      if (!p.touchedOnce && mode !== "write") p.from = transport.positionSamples;
      p.touchedOnce = true;
    }
    record(s.id, p, transport.positionSamples);
  });
  let wasPlaying = false;
  engine.subscribe("transport", () => {
    const transport = engine.get("transport");
    const doc = engine.get("document");
    if (transport.playing) {
      if (!wasPlaying) for (const t of doc.tracks) if (modeOf(t.id) === "write") passFor(t.id, "write", transport.positionSamples);
      for (const [id, p] of passes) if (p.mode === "write" || (p.mode === "latch" && p.touchedOnce) || p.touching) record(id, p, transport.positionSamples);
    } else if (wasPlaying && passes.size) {
      const commands = [...passes.entries()].flatMap(([id, p]) => {
        const end = p.to ?? transport.positionSamples;
        const kept = p.base.filter((q) => q.time < p.from || q.time > end);
        const written = p.points.filter((q) => q.time >= p.from && q.time <= end);
        if (!written.length) return [];
        return [{ type: "set-automation" as const, trackId: id, param: "volume" as const, points: [...kept, ...written].sort((a, b) => a.time - b.time) }];
      });
      passes.clear();
      if (commands.length) engine.dispatch({ type: "batch", commands });
    }
    wasPlaying = transport.playing;
  });
  panel.addEventListener("change", (e) => {
    const s = stripOf(e.target);
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (!s) return;
    if (el.classList.contains("fw-strip-fader")) {
      delete s.node.dataset.dragging;
      lastFader.set(s.id, Number(el.value));
      const pass = s.node.dataset.kind === "track" ? passes.get(s.id) : undefined;
      if (pass) {
        // PT-43: the fader was recording: Touch and Trim stop writing at release, Latch keeps the last value until stop
        pass.touching = false;
        if (pass.mode === "touch" || pass.mode === "trim") pass.to = engine.get("transport").positionSamples;
        return;
      }
      const gainDb = Number(el.value);
      if (linked.has(s.id) && linked.size > 1) {
        const doc = engine.get("document");
        const delta = gainDb - (doc.tracks.find((t) => t.id === s.id)?.gainDb ?? 0);
        const commands = doc.tracks
          .filter((t) => linked.has(t.id) && (t.id === s.id || !(t.automation?.volume?.length && t.autoOff !== true)))
          .map((t) => ({ type: "set-track-gain" as const, trackId: t.id, gainDb: t.id === s.id ? gainDb : Math.round(Math.max(-60, Math.min(12, t.gainDb + delta)) * 10) / 10 }));
        for (const id of linked) if (id !== s.id) delete strips.querySelector<HTMLElement>(`.fw-strip[data-key="${id}"]`)?.dataset.dragging;
        engine.dispatch({ type: "batch", commands, label: `Moved ${commands.length} faders together` });
        return;
      }
      if (s.node.dataset.kind === "master") engine.dispatch({ type: "set-master-gain", gainDb });
      else if (s.node.dataset.kind === "vca") engine.dispatch({ type: "set-vca-gain", vcaId: s.id, gainDb });
      else engine.dispatch(s.bus ? { type: "set-bus-gain", busId: s.id, gainDb } : { type: "set-track-gain", trackId: s.id, gainDb });
    } else if (el.classList.contains("fw-strip-pan")) {
      const pan = Number(el.value);
      engine.dispatch(s.bus ? { type: "set-bus-pan", busId: s.id, pan } : { type: "set-track-pan", trackId: s.id, pan });
    } else if (el.classList.contains("fw-strip-send") || el.classList.contains("fw-strip-send-level")) {
      // PT-18: one send per strip here: choosing a bus replaces the old send, No send removes it, the level updates it
      const track = engine.get("document").tracks.find((t) => t.id === s.id);
      const busId = s.node.querySelector<HTMLSelectElement>(".fw-strip-send")?.value ?? "";
      const gainDb = Number(s.node.querySelector<HTMLInputElement>(".fw-strip-send-level")?.value ?? -12);
      const commands: { type: "set-track-send"; trackId: string; busId: string; gainDb: number | null }[] = (track?.sends ?? [])
        .filter((x) => x.busId !== busId)
        .map((x) => ({ type: "set-track-send", trackId: s.id, busId: x.busId, gainDb: null }));
      if (busId) commands.push({ type: "set-track-send", trackId: s.id, busId, gainDb });
      if (commands.length) engine.dispatch({ type: "batch", commands });
    } else if (el.classList.contains("fw-strip-trim")) {
      delete s.node.dataset.dragging;
      engine.dispatch({ type: "set-track-trim", trackId: s.id, trimDb: Number(el.value) });
    } else if (el.classList.contains("fw-strip-auto")) {
      // Off is kept in the document (the export plays it too); Read and the recording modes live in the strip
      const doc = engine.get("document");
      const track = doc.tracks.find((t) => t.id === s.id);
      if (!track) return;
      if (!!track.autoOff !== (el.value === "off")) engine.dispatch({ type: "set-track-automation-off", trackId: s.id, off: el.value === "off" });
      else updateStrip(s.node, { kind: "track", item: track }, doc);
    } else if (el.classList.contains("fw-strip-out")) {
      engine.dispatch({ type: "route-track", trackId: s.id, busId: el.value || null });
    } else if (el.classList.contains("fw-strip-vca")) {
      engine.dispatch({ type: "assign-vca", trackId: s.id, vcaId: el.value || null });
    }
  });
  panel.addEventListener("click", (e) => {
    const s = stripOf(e.target);
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!s || !button) return;
    if (button.classList.contains("fw-strip-clip")) {
      if (button.dataset.clip !== "false") button.dataset.clip = "false";
      return;
    }
    const on = button.getAttribute("aria-pressed") !== "true";
    const vca = s.node.dataset.kind === "vca";
    if (button.classList.contains("fw-strip-coalesce")) {
      if (vca) engine.dispatch({ type: "coalesce-vca", vcaId: s.id });
      return;
    }
    if (button.classList.contains("fw-strip-remove")) {
      if (vca) engine.dispatch({ type: "remove-vca", vcaId: s.id });
      else if (s.bus) engine.dispatch({ type: "remove-bus", busId: s.id });
      return;
    }
    if (button.classList.contains("fw-strip-mute")) {
      if (vca) engine.dispatch({ type: "set-vca-mute", vcaId: s.id, mute: on });
      else engine.dispatch(s.bus ? { type: "set-bus-mute", busId: s.id, mute: on } : { type: "set-track-mute", trackId: s.id, mute: on });
    } else if (button.classList.contains("fw-strip-solo") && !s.bus && !vca) {
      if (e.metaKey || e.ctrlKey) engine.dispatch({ type: "set-track-solo-safe", trackId: s.id, soloSafe: button.dataset.safe !== "true" });
      else if (e.altKey) engine.dispatch({ type: "set-track-solo", trackId: s.id, solo: true, exclusive: true });
      else engine.dispatch({ type: "set-track-solo", trackId: s.id, solo: on });
    } else if ((button.classList.contains("fw-strip-invert") || button.classList.contains("fw-strip-phase")) && !s.bus && !vca) engine.dispatch({ type: "set-track-invert", trackId: s.id, invert: on });
  });
  panel.addEventListener("click", (e) => {
    const name = (e.target as HTMLElement).closest(".fw-strip-name");
    const s = stripOf(e.target);
    if (!name || !s || s.node.dataset.kind !== "track" || !(e.metaKey || e.ctrlKey)) return;
    if (linked.has(s.id)) linked.delete(s.id);
    else linked.add(s.id);
    markLinked();
  });

  const shown = new Map<string, number[]>();
  let lastTime = performance.now();
  const drive = (key: string, selector: string, pair: number[], silent: boolean, fall: number) => {
    const previous = shown.get(key) ?? [-Infinity, -Infinity];
    const next = pair.map((peak, c) => (silent ? -Infinity : Math.max(peak > 0 ? 20 * Math.log10(peak) : -Infinity, (previous[c] ?? -Infinity) - fall)));
    shown.set(key, next);
    const bars = panel.querySelectorAll<HTMLElement>(selector);
    next.forEach((db, c) => {
      const bar = bars[c];
      if (!bar) return;
      const transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;
      if (bar.style.transform !== transform) bar.style.transform = transform;
    });
  };
  // PLAN_v13 S2: a strip's peak hold marks its highest peak for 2 s, then falls at 20 dB/s; its clip latch lights at
  // 0 dBFS and stays lit until clicked
  const holds = new Map<string, { db: number; at: number }[]>();
  const marked = new WeakMap<HTMLElement, string>();
  const hold = (key: string, pair: number[], now: number, fall: number) => {
    const node = panel.querySelector<HTMLElement>(`.fw-strip[data-key="${key}"]`);
    if (!node) return;
    const stopped = !engine.get("transport").playing && pair.every((p) => p === 0);
    const previous = holds.get(key) ?? [];
    const next = pair.map((peak, c) => {
      const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      const p = previous[c] ?? { db: -Infinity, at: now };
      if (stopped) return { db: -Infinity, at: now };
      if (db >= p.db) return { db, at: now };
      return now - p.at < 2000 ? p : { db: Math.max(db, p.db - fall), at: p.at };
    });
    holds.set(key, next);
    node.querySelectorAll<HTMLElement>(".fw-strip-meter > .fw-out-track > .fw-out-hold").forEach((mark, c) => {
      const db = next[c]?.db ?? -Infinity;
      const transform = `translateX(${((Math.max(0, Math.min(1, (db + 60) / 60)) - 1) * 100).toFixed(1)}%)`;
      if (marked.get(mark) !== transform) {
        marked.set(mark, transform);
        mark.style.transform = transform;
      }
      const on = String(db > -60);
      if (mark.dataset.on !== on) mark.dataset.on = on;
    });
    const clip = node.querySelector<HTMLElement>(".fw-strip-clip");
    if (clip && pair.some((p) => p >= 1) && clip.dataset.clip !== "true") clip.dataset.clip = "true";
  };
  // PT-38, AA-11: the 5.1 bus's six channels (L R C LFE Ls Rs) on the master strip while it plays, from the core's own
  // six-channel peaks; hidden when the session plays plain stereo
  player.onSurroundLevel((six) => {
    // PT-42: an ambisonic session meters its four channels, W Y Z X
    const foa = engine.get("document").spatialFormat === "foa";
    const names = foa ? ["W", "Y", "Z", "X"] : ["L", "R", "C", "LFE", "Ls", "Rs"];
    const tracks = panel.querySelectorAll<HTMLElement>('.fw-strip[data-kind="master"] .fw-out-51');
    tracks.forEach((t, i) => {
      const show = !!six && i < names.length;
      if (t.hidden === show) t.hidden = !show;
      const title = i < names.length ? `${foa ? "Ambisonic" : "5.1"} ${names[i]}` : "";
      if (t.title !== title) t.title = title;
    });
    const now = performance.now();
    drive("master51", '.fw-strip[data-kind="master"] .fw-out-51 .fw-out-bar', six ?? [0, 0, 0, 0, 0, 0], !six, ((now - lastTime) / 1000) * 20);
  });
  player.onOutputLevel((left, right, tracks, _loudness, buses) => {
    const now = performance.now();
    const fall = ((now - lastTime) / 1000) * 20;
    lastTime = now;
    drive("master", '.fw-strip[data-kind="master"] .fw-strip-meter .fw-out-bar', [left, right], left === 0 && right === 0, fall);
    hold("master", [left, right], now, fall);
    engine.get("document").tracks.forEach((track, i) => hold(track.id, [tracks[2 * i] ?? 0, tracks[2 * i + 1] ?? 0], now, fall));
    // The core meters buses in plan order, which leaves muted buses out; walk the document's buses the same way.
    let k = 0;
    for (const bus of engine.get("document").buses ?? []) {
      const live = !bus.mute;
      const pair: [number, number] = live ? [buses[2 * k] ?? 0, buses[2 * k + 1] ?? 0] : [0, 0];
      if (live) k++;
      drive(bus.id, `.fw-strip[data-key="${bus.id}"] .fw-strip-meter .fw-out-bar`, pair, !live || buses.length === 0, fall);
      hold(bus.id, pair, now, fall);
    }
  });
}
