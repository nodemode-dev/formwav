import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "../../frontend/src/styles/tokens.css";
import "../../frontend/src/styles/light-mode.css";
import "../../frontend/src/styles/shell.css";
import "../../frontend/src/styles/workspace.css";
import "../../frontend/src/styles/frame.css";
import "../../frontend/src/styles/surfaces.css";
import "../../frontend/src/styles/canvas.css";
import "../../frontend/src/styles/scrollbars.css";
import "../../frontend/src/styles/form-family.css";
import "./demo.css";
import logo from "../../frontend/public/logo-64.png";
import { applyTheme, readChoice, setAccent, setTheme, THEMES } from "../../frontend/src/vendor/formvis/themes";
import { type Chans, loudness, peakOf, toDb } from "./dsp";
import { mountIcons, DEMO_ICONS } from "./icons";
import { CLIP_BY_ID, decodeClip, SESSION_CLIPS } from "./media";
import { mixdown } from "./mix";
import { Panels } from "./panels";
import { Player } from "./player";
import { Store } from "./state";
import { generate, type GenKind, sampleDialogue, sampleDrums, sampleMusic } from "./synth";
import { fmtClock, fmtTime, Timeline } from "./timeline";
import { decodeFile, encodeWav, type WavBits } from "./wav";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, v: string): void {
  if (el.textContent !== v) el.textContent = v;
}

applyTheme();
mountIcons(document);
($("dm-logo") as HTMLImageElement).src = logo;

const store = new Store();
const player = new Player(store);
const timeline = new Timeline($("dm-timeline"), store, player);
const panels = new Panels(store, player, (t) => panels.setTab(t));

function loadSynthetic(): void {
  const rate = store.rate;
  store.reset();
  const specs: Array<[string, () => Chans]> = [
    ["Dialogue", () => sampleDialogue(rate)],
    ["Music", () => sampleMusic(rate)],
    ["Drums", () => sampleDrums(rate)],
  ];
  for (const [name, make] of specs) store.tracks.push(store.newTrack(name, make()));
  store.selected = store.tracks[0].id;
  player.position = 0;
  setText($("dm-session-name"), "Sample session");
  store.commit("Open sample session");
  timeline.fit();
  store.say("Synthetic sample session loaded: three tracks, generated in this page");
}

let loadToken = 0;

async function loadSession(): Promise<void> {
  const rate = store.rate;
  const token = ++loadToken;
  const total = SESSION_CLIPS.length;
  let done = 0;
  store.say(`Loading the session media: 0 of ${total}`);
  try {
    const loaded: Chans[] = [];
    await Promise.all(SESSION_CLIPS.map(async (c, i) => {
      loaded[i] = await decodeClip(c, rate);
      done++;
      store.say(`Loading the session media: ${done} of ${total}`);
    }));
    if (token !== loadToken) return;
    store.reset();
    SESSION_CLIPS.forEach((c, i) => {
      const t = store.newTrack(c.name, loaded[i]);
      t.gain = c.gain;
      t.mute = c.mute;
      t.spec = c.spec;
      store.tracks.push(t);
    });
    store.selected = store.tracks[1].id;
    player.position = 0;
    setText($("dm-session-name"), "Round the Moon, a field report");
    store.commit("Open the Round the Moon session");
    timeline.fit();
    store.say("Round the Moon: launch radio, narration, piano and Saturn plasma waves. Select a track and try a tool");
  } catch (err) {
    if (token !== loadToken) return;
    store.say(`The session media did not load (${(err as Error).message}); using the synthetic samples`);
    loadSynthetic();
  }
}

async function addClip(id: string): Promise<void> {
  const base = CLIP_BY_ID[id];
  store.say(`Decoding ${base.name}`);
  try {
    const chans = await decodeClip({ ...base, offset: 0 }, store.rate);
    const grow = store.tracks.length === 0;
    store.addTrack(base.name, chans, `Add ${base.name}`);
    if (grow) timeline.fit();
    store.say(`Added ${base.name}`);
  } catch (err) {
    store.say(`Could not add ${base.name}: ${(err as Error).message}`);
  }
}

function addSample(kind: string): void {
  if (CLIP_BY_ID[kind]) { void addClip(kind); return; }
  const rate = store.rate;
  const make = kind === "dialogue" ? sampleDialogue : kind === "music" ? sampleMusic : sampleDrums;
  const name = kind[0].toUpperCase() + kind.slice(1);
  const grow = store.tracks.length === 0;
  store.addTrack(name, make(rate), `Add ${name}`);
  if (grow) timeline.fit();
  store.say(`Added ${name}`);
}

async function addFiles(files: FileList | File[]): Promise<void> {
  for (const f of Array.from(files)) {
    store.say(`Decoding ${f.name}`);
    try {
      const chans = await decodeFile(f, store.rate);
      if (!chans.length || !chans[0].length) throw new Error("no audio in the file");
      const was = store.duration();
      const name = f.name.replace(/\.[^.]+$/, "") || "Audio";
      store.addTrack(name, chans, `Open ${f.name}`);
      if (store.duration() > was) timeline.fit();
      setText($("dm-session-name"), store.tracks.length > 1 ? "Your session" : name);
      store.say(`Opened ${f.name}: ${(chans[0].length / store.rate).toFixed(2)} s, ${chans.length === 2 ? "stereo" : "mono"}, ${store.rate} Hz`);
    } catch (err) {
      store.say(`Could not open ${f.name}: ${(err as Error).message || "this browser cannot decode it"}`);
    }
  }
}

store.on("notice", () => setText($("dm-notice"), store.notice));
store.on("history", () => player.stop());
store.on("tracks", () => {
  player.refreshGains();
  queueMix();
  const n = store.tracks.length;
  setText($("dm-info-sub"), `${store.rate / 1000} kHz · ${n} track${n === 1 ? "" : "s"} · ${fmtTime(store.duration())}`);
  setText($("dm-clock-sub"), `of ${fmtClock(store.duration()).slice(0, 8)}`);
});
store.on("selection", () => {
  const s = store.sel;
  setText($("dm-r-start"), fmtTime(s ? s[0] : 0));
  setText($("dm-r-end"), fmtTime(s ? s[1] : 0));
  setText($("dm-r-len"), fmtTime(s ? s[1] - s[0] : 0));
});

let mixTimer = 0;
function queueMix(): void {
  window.clearTimeout(mixTimer);
  mixTimer = window.setTimeout(() => {
    if (!store.tracks.length) { setText($("dm-mix-lufs"), "-- LUFS"); setText($("dm-mix-peak"), "-- dBFS"); return; }
    const m = mixdown(store);
    const l = loudness(m, store.rate);
    setText($("dm-mix-lufs"), isFinite(l) ? `${l.toFixed(1)} LUFS` : "-- LUFS");
    setText($("dm-mix-peak"), `${toDb(peakOf(m)).toFixed(1)} dBFS`);
  }, 160);
}

timeline.onTrackAction = (id, what, value) => {
  const t = store.tracks.find((x) => x.id === id);
  if (!t) return;
  if (what === "remove") { store.removeTrack(id); return; }
  if (what === "mute") t.mute = !t.mute;
  if (what === "solo") t.solo = !t.solo;
  if (what === "spec") { t.spec = !t.spec; if (t.spec) store.say("Drawing the spectrogram"); }
  if (what === "gain" && value !== undefined) t.gain = value;
  store.edited();
  timeline.invalidate();
  player.refreshGains();
};

function setPlayIcon(): void {
  const icon = $("dm-play-icon");
  const name = player.playing ? "pause" : "play";
  if (icon.dataset.icon !== name) {
    icon.dataset.icon = name;
    icon.innerHTML = DEMO_ICONS[name];
  }
  $("dm-play").setAttribute("aria-label", player.playing ? "Pause" : "Play");
}

player.onStop = () => setPlayIcon();

async function togglePlay(): Promise<void> {
  if (!store.tracks.length) return;
  if (player.playing) { player.stop(); return; }
  const sel = store.sel;
  if (sel && sel[1] - sel[0] > 0.01) {
    await player.play(sel[0], sel[1]);
  } else {
    const dur = store.duration();
    const from = player.position >= dur - 0.02 ? 0 : player.position;
    await player.play(from, null);
  }
  setPlayIcon();
}

timeline.onSeek = (t) => {
  player.position = t;
  if (player.playing) void player.play(t, null);
};

$("dm-play").addEventListener("click", () => void togglePlay());
$("dm-stop").addEventListener("click", () => { player.stop(); player.position = store.sel ? store.sel[0] : 0; });
$("dm-home").addEventListener("click", () => { timeline.t0 = 0; timeline.invalidate(); timeline.onSeek(0); });
$("dm-loop").addEventListener("click", () => {
  player.loop = !player.loop;
  $("dm-loop").setAttribute("aria-pressed", String(player.loop));
});
$("dm-undo").addEventListener("click", () => store.undo());
$("dm-redo").addEventListener("click", () => store.redo());
$("dm-zoom-in").addEventListener("click", () => timeline.zoom(1.5));
$("dm-zoom-out").addEventListener("click", () => timeline.zoom(1 / 1.5));
$("dm-fit").addEventListener("click", () => timeline.fit());
$("dm-follow").addEventListener("click", () => {
  timeline.follow = !timeline.follow;
  $("dm-follow").setAttribute("aria-pressed", String(timeline.follow));
});
$("dm-selall").addEventListener("click", () => {
  if (store.track) store.setSel([0, store.track.chans[0].length / store.rate]);
});
$("dm-reset").addEventListener("click", () => loadSession());
for (const b of document.querySelectorAll<HTMLElement>("[data-sample]")) b.addEventListener("click", () => addSample(b.dataset.sample!));

const fileInput = $("dm-file") as HTMLInputElement;
const pick = () => fileInput.click();
$("dm-open").addEventListener("click", pick);
$("dm-open2").addEventListener("click", pick);
fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) void addFiles(fileInput.files);
  fileInput.value = "";
});

const drop = $("dm-drop");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  drop.dataset.on = "true";
});
window.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) drop.dataset.on = "false";
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.dataset.on = "false";
  if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
});

const gen = (id: string) => $(id) as HTMLInputElement;
const genSync = () => {
  setText($("dm-gen-freq-out"), `${gen("dm-gen-freq").value} Hz`);
  setText($("dm-gen-len-out"), `${Number(gen("dm-gen-len").value).toFixed(1)} s`);
  setText($("dm-gen-lvl-out"), `${gen("dm-gen-lvl").value} dB`);
  const kind = ($("dm-gen-kind") as HTMLSelectElement).value;
  gen("dm-gen-freq").disabled = kind !== "tone";
};
for (const id of ["dm-gen-freq", "dm-gen-len", "dm-gen-lvl", "dm-gen-kind"]) $(id).addEventListener("input", genSync);
$("dm-gen-add").addEventListener("click", () => {
  const kind = ($("dm-gen-kind") as HTMLSelectElement).value as GenKind;
  const secs = Number(gen("dm-gen-len").value);
  const chans = generate(kind, store.rate, secs, Number(gen("dm-gen-freq").value), Math.pow(10, Number(gen("dm-gen-lvl").value) / 20));
  const names: Record<GenKind, string> = { tone: `Tone ${gen("dm-gen-freq").value} Hz`, sweep: "Sweep", noise: "Pink noise", clicks: "Click track" };
  const was = store.duration();
  store.addTrack(names[kind], chans, `Generate ${names[kind]}`);
  if (store.duration() > was) timeline.fit();
  store.say(`Generated ${names[kind]}, ${secs.toFixed(1)} s`);
});
genSync();

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
  for (const [pop, btn] of [[themePop, themeBtn], [exPop, exBtn]] as const) {
    if (!pop.hidden && !pop.contains(t) && !btn.contains(t)) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  }
});

const themeSel = $("dm-theme-select") as HTMLSelectElement;
themeSel.replaceChildren(...Object.entries(THEMES).map(([id, t]) => new Option(t.label, id)));
themeSel.value = readChoice().theme;
themeSel.addEventListener("change", () => setTheme(themeSel.value));
const swatchHost = $("dm-swatches");
for (const name of ["orange", "lime", "teal", "blue", "pink", "violet"]) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dm-swatch";
  b.style.color = `var(--fw-swatch-${name})`;
  b.setAttribute("aria-label", `${name} accent`);
  b.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"></circle></svg>`;
  b.addEventListener("click", () => setAccent(getComputedStyle(document.documentElement).getPropertyValue(`--fw-swatch-${name}`).trim()));
  swatchHost.append(b);
}

function exportWav(): void {
  const src = ($("dm-ex-src") as HTMLSelectElement).value;
  const rng = ($("dm-ex-range") as HTMLSelectElement).value;
  const bits = Number(($("dm-ex-fmt") as HTMLSelectElement).value) as WavBits;
  const note = $("dm-ex-note");
  if (!store.tracks.length) { setText(note, "Nothing to export"); return; }
  if (rng === "sel" && !store.sel) { setText(note, "Make a selection first"); return; }
  const a = rng === "sel" ? Math.round(store.sel![0] * store.rate) : 0;
  let chans: Chans;
  let b: number;
  if (src === "track") {
    const t = store.track;
    if (!t) { setText(note, "Select a track first"); return; }
    b = rng === "sel" ? Math.round(store.sel![1] * store.rate) : t.chans[0].length;
    chans = t.chans.map((c) => c.subarray(a, Math.min(b, c.length)));
  } else {
    b = rng === "sel" ? Math.round(store.sel![1] * store.rate) : -1;
    chans = mixdown(store, a, b);
  }
  const blob = encodeWav(chans, store.rate, bits);
  const base = (($("dm-ex-name") as HTMLInputElement).value.trim() || "formwav-demo").replace(/[^\w.\- ]+/g, "_");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}.wav`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  const msg = `${base}.wav, ${(chans[0].length / store.rate).toFixed(2)} s, ${bits === 32 ? "32-bit float" : `${bits}-bit`}, ${(blob.size / 1024).toFixed(0)} KB`;
  setText(note, `Saved ${msg}`);
  store.say(`Exported ${msg}`);
}
$("dm-ex-go").addEventListener("click", exportWav);

document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  const typing = el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (typing) return;
  if (e.key === " ") { e.preventDefault(); void togglePlay(); }
  if (e.key === "Delete" || e.key === "Backspace") { if (store.sel) { e.preventDefault(); store.apply("delete", {}); } }
  if (e.key === "Escape") { store.setSel(null); }
});

const meters = [$("dm-m0"), $("dm-m1")];
const levels = new Float32Array(2);
const held = [0, 0];
function loop(): void {
  timeline.frame();
  panels.frame();
  const pos = player.position;
  setText($("dm-clock"), fmtClock(pos));
  player.levels(levels);
  for (let i = 0; i < 2; i++) {
    held[i] = Math.max(levels[i], held[i] * 0.9);
    const d = held[i] > 0.0005 ? toDb(held[i]) : -80;
    meters[i].style.transform = `scaleX(${Math.max(0, Math.min(1, (d + 60) / 60))})`;
  }
  requestAnimationFrame(loop);
}

void loadSession().then(() => setText($("dm-empty"), "No tracks. Open an audio file or use the Sounds tab."));
panels.choose("dehum");
panels.setTab("clip");
requestAnimationFrame(() => {
  timeline.measure();
  timeline.fit();
  document.body.classList.add("app-ready");
  loop();
});
