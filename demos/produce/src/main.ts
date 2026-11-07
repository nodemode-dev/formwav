import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "../../../frontend/src/styles/tokens.css";
import "../../../frontend/src/styles/light-mode.css";
import "../../../frontend/src/styles/shell.css";
import "../../../frontend/src/styles/workspace.css";
import "../../../frontend/src/styles/frame.css";
import "../../../frontend/src/styles/surfaces.css";
import "../../../frontend/src/styles/canvas.css";
import "../../../frontend/src/styles/scrollbars.css";
import "../../../frontend/src/styles/form-family.css";
import "../../../demo/src/demo.css";
import "./produce.css";
import logo from "../../../frontend/public/logo-64.png";
import { applyTheme, readChoice, setAccent, setTheme, THEMES } from "../../../frontend/src/vendor/formvis/themes";
import { loudness, peakOf, toDb } from "../../../demo/src/dsp";
import { DEMO_ICONS, mountIcons } from "../../../demo/src/icons";
import { encodeWav, type WavBits } from "../../../demo/src/wav";
import { Arrange, fmtBars, fmtClock } from "./arrange";
import { autoDefs, render } from "./audio";
import { decodeBytes, DEFS, type Group, items, loadAll, register } from "./lib";
import { KIND_GROUPS, KINDS } from "./kinds";
import { type Clip, dbToGain, type Pt, RATE, SPB, Store } from "./model";
import { Effects, Markers, Mixer, placeClip, Sequencer, setText } from "./panels";
import { Player } from "./player";
import { buildSession } from "./session";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

applyTheme();
mountIcons(document);
($("dm-logo") as HTMLImageElement).src = logo;

const store = new Store();
const player = new Player(store);
const arrange = new Arrange($("dm-timeline"), store, player);
const effects = new Effects($("pr-fx"), store);
const mixer = new Mixer($("pr-mixer"), store, player);

const markers = new Markers($("pr-markers"), store, player, (b) => seek(b));
const seq = new Sequencer($("pr-seq"), store, player, (item, beat) => {
  const c = placeClip(store, item, null, beat, "Pattern");
  if (c) store.say(`Pattern placed at ${fmtBars(beat)} on the Pattern track`);
});
void seq;

function seek(beat: number): void {
  player.position = Math.max(0, beat);
  if (player.playing) void player.play(player.position);
}

arrange.onSeek = seek;
arrange.onFx = (id) => { store.select(id, null); setDock("fx"); };
arrange.onDrop = (item, track, beat) => { addItem(item, track, beat); };

const TRACK_OF: Record<string, string> = { drums: "Drums", bass: "Bass", keys: "Keys", loop: "Perc", piano: "Score", saturn: "Texture", "launch-roar": "Texture", pat: "Pattern" };

function addItem(id: string, trackId: number | null, beat: number): void {
  const it = items.get(id);
  if (!it) return;
  const key = Object.keys(TRACK_OF).find((k) => id.startsWith(k));
  const named = trackId == null && key && store.doc.tracks.some((t) => t.name === TRACK_OF[key]) ? TRACK_OF[key] : undefined;
  const target = trackId ?? (named ? null : store.selTrack);
  placeClip(store, id, target, beat, named);
  store.say(`${it.name} placed at ${fmtBars(beat)}`);
}

const GROUPS: Array<[Group, string]> = [["stems", "Stems, 8 bars"], ["loops", "Loops, 1 bar"], ["shots", "One-shots"], ["score", "Score and textures"], ["patterns", "Patterns"], ["yours", "Yours and bounces"]];
const soundHost = $("pr-sounds");
const groupEls = new Map<Group, HTMLElement>();
for (const [g, title] of GROUPS) {
  const wrap = document.createElement("div");
  wrap.className = "pr-group";
  wrap.dataset.group = g;
  wrap.innerHTML = `<div class="dm-group-title">${title}</div><div class="pr-group-rows"></div>`;
  soundHost.append(wrap);
  groupEls.set(g, wrap.querySelector(".pr-group-rows")!);
}
const rendered = new Set<string>();
const rowOf = new Map<string, HTMLElement>();

function syncSounds(): void {
  for (const it of items.values()) {
    if (rendered.has(it.id)) continue;
    rendered.add(it.id);
    const row = document.createElement("div");
    row.className = "pr-sound";
    row.draggable = true;
    row.dataset.id = it.id;
    row.dataset.name = `${it.name} ${it.sub}`.toLowerCase();
    row.innerHTML = `<button class="pr-sound-main" type="button" title="Place at the playhead"><span class="dm-sound-name" translate="no"></span><span class="dm-sound-sub" translate="no"></span></button><button class="pr-sound-play" type="button" aria-label="Hear it" title="Hear it"><span class="icon" data-icon="play" data-size="14"></span></button>`;
    row.querySelector(".dm-sound-name")!.textContent = it.name;
    row.querySelector(".dm-sound-sub")!.textContent = it.group === "shots" || it.group === "yours" || it.group === "patterns" ? it.sub : `${it.sub}`;
    mountIcons(row);
    row.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/x-fw-item", it.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"; });
    row.querySelector(".pr-sound-main")!.addEventListener("click", () => addItem(it.id, null, store.snapBeat(player.position)));
    row.querySelector(".pr-sound-play")!.addEventListener("click", () => { if (it.buffer) void player.hear(it.buffer); store.say(`Playing ${it.name}`); });
    groupEls.get(it.group)!.append(row);
    rowOf.set(it.id, row);
  }
}

$("dm-search").addEventListener("input", () => {
  const q = ($("dm-search") as HTMLInputElement).value.trim().toLowerCase();
  for (const row of rowOf.values()) row.hidden = !!q && !row.dataset.name!.includes(q);
  for (const w of soundHost.querySelectorAll<HTMLElement>(".pr-group")) w.hidden = !w.querySelector(".pr-sound:not([hidden])");
});

const fxlib = $("pr-fxlib");
fxlib.innerHTML = KIND_GROUPS.map(([label, kinds]) => `<div class="fw-fxlib-group"><div class="fw-fxlib-label">${label}</div>${kinds.map((k) => `<button type="button" class="fw-fxlib-item" data-kind="${k}"><span>${KINDS[k].label}</span><span class="fw-fxlib-sub">${KINDS[k].sub}</span></button>`).join("")}</div>`).join("");
fxlib.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]");
  if (!b) return;
  effects.add(b.dataset.kind!);
  setDock("fx");
});

for (const tab of document.querySelectorAll<HTMLElement>("[data-ltab]")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll<HTMLElement>("[data-ltab]")) { const on = t === tab; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", String(on)); }
    for (const p of document.querySelectorAll<HTMLElement>("[data-lpanel]")) p.hidden = p.dataset.lpanel !== tab.dataset.ltab;
  });
}

function setDock(name: string): void {
  for (const t of document.querySelectorAll<HTMLElement>("[data-btab]")) t.setAttribute("aria-selected", String(t.dataset.btab === name));
  for (const p of document.querySelectorAll<HTMLElement>("[data-bpanel]")) p.hidden = p.dataset.bpanel !== name;
}
for (const t of document.querySelectorAll<HTMLElement>("[data-btab]")) t.addEventListener("click", () => setDock(t.dataset.btab!));

store.on("notice", () => setText($("dm-notice"), store.notice));
store.on("sel", () => ctx());
store.on("doc", () => { ctx(); queueMeasure(); });
store.on("hist", () => {
  ($("dm-undo") as HTMLButtonElement).disabled = store.index <= 0;
  ($("dm-redo") as HTMLButtonElement).disabled = store.index >= store.history.length - 1;
});

function ctx(): void {
  const t = store.track;
  const c = store.clip;
  setText($("pr-ctx"), t ? `${t.name}${c ? `, ${items.get(c.clip.item)?.name ?? "clip"}` : ""}` : "No track selected");
  const n = store.doc.tracks.length;
  setText($("dm-info-sub"), `${RATE / 1000} kHz · 130 BPM · ${n} track${n === 1 ? "" : "s"} · ${fmtClock(store.endBeat())}`);
  setText($("dm-clock-sub"), `bar ${Math.floor(player.position / 4) + 1} of ${Math.ceil(store.endBeat() / 4) + 1}`);
  const r = store.doc.region;
  setText($("pr-r-region"), r ? `${fmtBars(r[0])} to ${fmtBars(r[1])}` : "none");
}

function setPlayIcon(): void {
  const icon = $("dm-play-icon");
  const name = player.playing ? "pause" : "play";
  if (icon.dataset.icon !== name) { icon.dataset.icon = name; icon.innerHTML = DEMO_ICONS[name]; }
  $("dm-play").setAttribute("aria-label", player.playing ? "Pause" : "Play");
}
player.onStop = () => setPlayIcon();

async function togglePlay(): Promise<void> {
  if (!store.doc.tracks.length) return;
  if (player.playing) { player.stop(); return; }
  const end = store.endBeat();
  const from = player.position >= end - 0.05 ? 0 : player.position;
  await player.play(from);
  setPlayIcon();
}

$("dm-play").addEventListener("click", () => void togglePlay());
$("dm-stop").addEventListener("click", () => { player.stop(); player.position = 0; arrange.t0 = 0; arrange.invalidate(); });
$("dm-home").addEventListener("click", () => { arrange.t0 = 0; arrange.invalidate(); seek(0); });
$("dm-loop").addEventListener("click", () => { player.loop = !player.loop; $("dm-loop").setAttribute("aria-pressed", String(player.loop)); if (player.playing) void player.play(player.tick()); });
$("dm-undo").addEventListener("click", () => store.undo());
$("dm-redo").addEventListener("click", () => store.redo());
$("dm-zoom-in").addEventListener("click", () => arrange.zoom(1.5));
$("dm-zoom-out").addEventListener("click", () => arrange.zoom(1 / 1.5));
$("dm-fit").addEventListener("click", () => arrange.fit());
$("dm-follow").addEventListener("click", () => { arrange.follow = !arrange.follow; $("dm-follow").setAttribute("aria-pressed", String(arrange.follow)); });
($("pr-snap") as HTMLSelectElement).addEventListener("change", () => { store.snap = Number(($("pr-snap") as HTMLSelectElement).value); });
store.snap = 1;

function split(): void {
  const s = store.clip;
  if (!s) { store.say("Select a clip first"); return; }
  const p = store.snapBeat(player.position, true);
  const { track, clip } = s;
  if (p <= clip.start + 0.1 || p >= clip.start + clip.length - 0.1) { store.say("Move the playhead inside the clip to split it"); return; }
  const tail: Clip = { id: store.nextId(), item: clip.item, start: p, offset: clip.offset + (p - clip.start), length: clip.start + clip.length - p, gainDb: clip.gainDb };
  clip.length = p - clip.start;
  track.clips.push(tail);
  store.selClip = tail.id;
  store.commit("Split a clip");
  store.say(`Split at ${fmtBars(p)}`);
}

function duplicate(): void {
  const s = store.clip;
  if (!s) { store.say("Select a clip first"); return; }
  const copy: Clip = { ...s.clip, id: store.nextId(), start: s.clip.start + s.clip.length };
  s.track.clips.push(copy);
  store.selClip = copy.id;
  store.commit("Duplicate a clip");
  store.say(`Duplicated, now at ${fmtBars(copy.start)}`);
}

function remove(): void {
  const s = store.clip;
  if (!s) { store.say("Select a clip first"); return; }
  s.track.clips = s.track.clips.filter((c) => c.id !== s.clip.id);
  store.selClip = null;
  store.commit("Delete a clip");
}

$("pr-split").addEventListener("click", split);
$("pr-dup").addEventListener("click", duplicate);
$("pr-del").addEventListener("click", remove);
$("pr-mark").addEventListener("click", () => markers.addAt(player.position));

for (const b of document.querySelectorAll<HTMLElement>("[data-auto]")) {
  b.addEventListener("click", () => {
    const t = store.track, key = arrange.autoKey();
    if (!t || !key) return;
    const def = autoDefs(t).find((d) => d.key === key);
    if (!def) return;
    if (b.dataset.auto === "clear") { delete t.auto[key]; store.commit(`Clear ${def.label} automation`); return; }
    const [a, z] = arrange.span();
    const [lo, hi] = def.rise;
    const up = b.dataset.auto === "rise";
    const pts: Pt[] = (t.auto[key] ?? []).filter((p) => p.beat < a || p.beat > z);
    pts.push({ beat: a, value: up ? lo : hi }, { beat: z, value: up ? hi : lo });
    pts.sort((x, y) => x.beat - y.beat);
    t.auto[key] = pts;
    store.commit(`${up ? "Rise" : "Fall"} on ${def.label}`);
    store.say(`${def.label} ${up ? "rises" : "falls"} from ${fmtBars(a)} to ${fmtBars(z)}`);
  });
}

const fileInput = $("dm-file") as HTMLInputElement;
let userCount = 0;

async function addFiles(files: FileList | File[]): Promise<void> {
  for (const f of Array.from(files)) {
    store.say(`Decoding ${f.name}`);
    try {
      const buffer = await decodeBytes(await f.arrayBuffer());
      const name = f.name.replace(/\.[^.]+$/, "") || "Audio";
      const id = `user-${++userCount}`;
      register({ id, name, sub: "Your file", group: "yours", buffer });
      syncSounds();
      const c = placeClip(store, id, null, store.snapBeat(player.position), name);
      if (c) store.say(`Opened ${f.name}: ${buffer.duration.toFixed(2)} s on its own track`);
    } catch (err) {
      store.say(`Could not open ${f.name}: ${(err as Error).message || "this browser cannot decode it"}`);
    }
  }
}

$("dm-open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files?.length) void addFiles(fileInput.files); fileInput.value = ""; });
const drop = $("dm-drop");
let depth = 0;
window.addEventListener("dragenter", (e) => { if (!e.dataTransfer?.types.includes("Files")) return; e.preventDefault(); depth++; drop.dataset.on = "true"; });
window.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) drop.dataset.on = "false"; });
window.addEventListener("drop", (e) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); depth = 0; drop.dataset.on = "false"; void addFiles(e.dataTransfer.files); });

const themeBtn = $("dm-theme-btn"), themePop = $("dm-theme-pop"), exBtn = $("dm-export-btn"), exPop = $("dm-export-pop");
function place(pop: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  pop.style.left = `${Math.max(8, Math.min(Math.round(r.right - pop.offsetWidth), window.innerWidth - pop.offsetWidth - 8))}px`;
}
function toggle(pop: HTMLElement, btn: HTMLElement, other: HTMLElement, otherBtn: HTMLElement): void {
  other.hidden = true;
  otherBtn.setAttribute("aria-expanded", "false");
  pop.hidden = !pop.hidden;
  btn.setAttribute("aria-expanded", String(!pop.hidden));
  if (!pop.hidden) place(pop, btn);
}
themeBtn.addEventListener("click", () => toggle(themePop, themeBtn, exPop, exBtn));
exBtn.addEventListener("click", () => toggle(exPop, exBtn, themePop, themeBtn));
document.addEventListener("pointerdown", (e) => {
  const t = e.target as Node;
  for (const [pop, btn] of [[themePop, themeBtn], [exPop, exBtn]] as const) if (!pop.hidden && !pop.contains(t) && !btn.contains(t)) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
});
const themeSel = $("dm-theme-select") as HTMLSelectElement;
themeSel.replaceChildren(...Object.entries(THEMES).map(([id, t]) => new Option(t.label, id)));
themeSel.value = readChoice().theme;
themeSel.addEventListener("change", () => setTheme(themeSel.value));
for (const name of ["orange", "lime", "teal", "blue", "pink", "violet"]) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dm-swatch";
  b.style.color = `var(--fw-swatch-${name})`;
  b.setAttribute("aria-label", `${name} accent`);
  b.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"></circle></svg>';
  b.addEventListener("click", () => setAccent(getComputedStyle(document.documentElement).getPropertyValue(`--fw-swatch-${name}`).trim()));
  $("dm-swatches").append(b);
}

let lastBounce: AudioBuffer | null = null;
const hearBtn = $("pr-ex-hear") as HTMLButtonElement;

function bounceSpan(src: string): { from: number; to: number; only: number | null } | null {
  const end = store.endBeat();
  if (src === "region") { const r = store.doc.region; return r ? { from: r[0], to: r[1], only: null } : null; }
  if (src === "track") {
    const t = store.track;
    if (!t || !t.clips.length) return null;
    return { from: Math.min(...t.clips.map((c) => c.start)), to: Math.max(...t.clips.map((c) => c.start + c.length)), only: t.id };
  }
  return { from: 0, to: end, only: null };
}

async function bounce(): Promise<void> {
  const note = $("pr-ex-note");
  const src = ($("pr-ex-src") as HTMLSelectElement).value;
  const span = bounceSpan(src);
  if (!span) { setText(note, src === "region" ? "Set a region first (drag on the ruler)" : "Select a track with clips first"); return; }
  const tail = Number(($("pr-ex-tail") as HTMLSelectElement).value);
  const target = Number(($("pr-ex-lufs") as HTMLSelectElement).value);
  const bits = Number(($("pr-ex-fmt") as HTMLSelectElement).value) as WavBits;
  setText(note, "Rendering the mix through the same graph that plays");
  const t0 = performance.now();
  const chans = await render(store.doc, { ...span, tail, master: span.only == null });
  let gainNote = "";
  const l0 = loudness(chans, RATE);
  if (target !== 0 && isFinite(l0)) {
    let g = dbToGain(target - l0);
    const pk = peakOf(chans);
    const cap = dbToGain(-1) / Math.max(pk, 1e-6);
    if (g > cap) { g = cap; gainNote = ", limited by a -1 dBFS peak"; }
    for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g;
  }
  const l1 = loudness(chans, RATE);
  const pk1 = toDb(peakOf(chans));
  const blob = encodeWav(chans, RATE, bits);
  const base = (($("pr-ex-name") as HTMLInputElement).value.trim() || "cold-open").replace(/[^\w.\- ]+/g, "_");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.wav`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  const b = new AudioBuffer({ length: chans[0].length, numberOfChannels: 2, sampleRate: RATE });
  b.copyToChannel(chans[0] as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel(chans[1] as Float32Array<ArrayBuffer>, 1);
  lastBounce = b;
  hearBtn.disabled = false;
  const msg = `${base}.wav, ${(chans[0].length / RATE).toFixed(1)} s, ${isFinite(l1) ? l1.toFixed(1) : "--"} LUFS, peak ${pk1.toFixed(1)} dBFS${gainNote}, ${Math.round(performance.now() - t0)} ms`;
  setText(note, `Saved ${msg}`);
  store.say(`Bounced ${msg}`);
  setText($("dm-mix-lufs"), `${isFinite(l1) ? l1.toFixed(1) : "--"} LUFS`);
  setText($("dm-mix-peak"), `${pk1.toFixed(1)} dBFS`);
  mixer.setLoudness(`${isFinite(l1) ? l1.toFixed(1) : "--"} LUFS I`);
}

$("pr-ex-go").addEventListener("click", () => void bounce());
hearBtn.addEventListener("click", () => { if (lastBounce) { player.stop(); void player.hear(lastBounce); store.say("Playing the bounce"); } });

let bounceCount = 0;
async function bounceTrack(): Promise<void> {
  const t = store.track;
  if (!t || !t.clips.length) { store.say("Select a track with clips first"); return; }
  const from = Math.min(...t.clips.map((c) => c.start)), to = Math.max(...t.clips.map((c) => c.start + c.length));
  store.say(`Rendering ${t.name} through its effects`);
  const chans = await render(store.doc, { from, to, tail: 2, master: false, only: t.id });
  const buffer = new AudioBuffer({ length: chans[0].length, numberOfChannels: 2, sampleRate: RATE });
  buffer.copyToChannel(chans[0] as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(chans[1] as Float32Array<ArrayBuffer>, 1);
  const id = `bounce-${++bounceCount}`;
  register({ id, name: `${t.name}, bounced`, sub: "Bounce in place", group: "yours", buffer });
  syncSounds();
  const nt = store.newTrack(`${t.name}, bounced`);
  const it = items.get(id)!;
  nt.clips.push({ id: store.nextId(), item: id, start: from, offset: 0, length: it.beats, gainDb: 0 });
  t.mute = true;
  store.selTrack = nt.id;
  store.selClip = null;
  store.commit(`Bounce ${t.name} in place`);
  store.say(`${t.name} rendered with its effects into a new track; the original is muted`);
}
$("pr-bouncetrack").addEventListener("click", () => void bounceTrack());

let measureTimer = 0;
let measuring = false;
function queueMeasure(): void {
  window.clearTimeout(measureTimer);
  measureTimer = window.setTimeout(() => void measure(), 1600);
}
async function measure(): Promise<void> {
  if (player.playing || measuring || !store.doc.tracks.length) { if (player.playing) queueMeasure(); return; }
  measuring = true;
  const chans = await render(store.doc, { from: 0, to: store.endBeat(), tail: 0, master: true });
  measuring = false;
  const l = loudness(chans, RATE);
  setText($("dm-mix-lufs"), `${isFinite(l) ? l.toFixed(1) : "--"} LUFS`);
  setText($("dm-mix-peak"), `${toDb(peakOf(chans)).toFixed(1)} dBFS`);
  mixer.setLoudness(`${isFinite(l) ? l.toFixed(1) : "--"} LUFS I`);
}

document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  const typing = (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (e.key === " ") { e.preventDefault(); void togglePlay(); }
  else if (k === "s") split();
  else if (k === "d") duplicate();
  else if (k === "m") markers.addAt(player.position);
  else if (k === "l") $("dm-loop").click();
  else if (e.key === "Delete" || e.key === "Backspace") { if (store.clip) { e.preventDefault(); remove(); } }
});

const lv = new Float32Array(2);
const held = [0, 0];
const bars = [$("dm-m0"), $("dm-m1"), $("pr-mm0"), $("pr-mm1")];
function loop(): void {
  arrange.frame();
  const pos = player.position;
  setText($("dm-clock"), fmtClock(pos));
  setText($("pr-r-pos"), fmtBars(pos));
  if (player.playing) setText($("dm-clock-sub"), `bar ${Math.floor(pos / 4) + 1} of ${Math.ceil(store.endBeat() / 4) + 1}`);
  player.levels(lv);
  for (let i = 0; i < 2; i++) {
    held[i] = Math.max(lv[i], held[i] * 0.9);
    const d = held[i] > 0.0005 ? toDb(held[i]) : -80;
    const s = `scaleX(${Math.max(0, Math.min(1, (d + 60) / 60))})`;
    bars[i].style.transform = s;
    bars[i + 2].style.transform = s;
  }
  mixer.frame();
  requestAnimationFrame(loop);
}

const total = DEFS.length;
setText($("dm-empty"), `Loading the session media: 0 of ${total}`);
($("dm-empty") as HTMLElement).hidden = false;
store.say(`Loading the session media: 0 of ${total}`);
setDock("fx");
requestAnimationFrame(() => {
  arrange.measure();
  document.body.classList.add("app-ready");
  loop();
});

void loadAll((done, n) => {
  setText($("dm-empty"), `Loading the session media: ${done} of ${n}`);
  store.say(`Loading the session media: ${done} of ${n}`);
}).then(() => {
  const doc = buildSession();
  store.reset(doc);
  store.selTrack = doc.tracks[3].id;
  syncSounds();
  store.commit("Open Cold Open");
  effects.render();
  mixer.render();
  markers.render();
  arrange.sync();
  arrange.fit();
  arrange.setAutoKey(Object.keys(doc.tracks[3].auto)[0] ?? "vol");
  ctx();
  document.body.classList.add("pr-loaded");
  store.say("Cold Open: press Space to play. Try the Sequencer tab, add an effect, or draw automation");
}).catch((err: Error) => {
  document.body.classList.add("pr-loaded");
  setText($("dm-empty"), `The session media did not load: ${err.message}`);
  store.say(`The session media did not load: ${err.message}`);
});
