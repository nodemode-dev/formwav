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
import "./repair.css";
import logo from "../../../frontend/public/logo-64.png";
import { applyTheme, readChoice, setAccent, setTheme, THEMES } from "../../../frontend/src/vendor/formvis/themes";
import { toDb } from "../../../demo/src/dsp";
import { encodeWav, type WavBits } from "../../../demo/src/wav";
import { Bench, PRESETS } from "./bench";
import { ICONS, mountIcons } from "./icons";
import { decodeBytes, decodeSource, SOURCES } from "./media";
import { Panels } from "./panels";
import { AbPlayer, type Side } from "./player";
import { Rack } from "./rack";
import { cloneChain } from "./stages";
import { fmtClock, fmtTime, Views } from "./views";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, v: string): void {
  if (el.textContent !== v) el.textContent = v;
}

applyTheme();
mountIcons(document);
($("dm-logo") as HTMLImageElement).src = logo;

const bench = new Bench();
const player = new AbPlayer(bench.rate);
const views = new Views($("rp-stage"), bench, player);
const panels = new Panels(bench);
const rack = new Rack($("rp-rack"), bench);
panels.range = () => (views.sel && views.sel[1] - views.sel[0] > 0.05 ? views.sel : null);

const sourceSel = $("rp-source") as HTMLSelectElement;
let customCount = 0;
let loadToken = 0;

for (const d of SOURCES) {
  bench.addSource({ id: d.id, name: d.name, sub: d.sub, tags: d.tags, x: null, custom: false }, cloneChain(PRESETS[d.id]));
  sourceSel.append(new Option(d.name, d.id));
}

function describe(): void {
  const s = bench.source;
  setText($("rp-src-sub"), s.sub);
  setText($("rp-session-name"), s.name);
  const tags = $("rp-tags");
  while (tags.children.length > s.tags.length) tags.lastElementChild!.remove();
  s.tags.forEach((t, i) => {
    let el = tags.children[i] as HTMLElement | undefined;
    if (!el) { el = document.createElement("span"); el.className = "rp-tag"; tags.append(el); }
    setText(el, t);
  });
  if (sourceSel.value !== s.id) sourceSel.value = s.id;
}

async function openSource(id: string): Promise<void> {
  const src = bench.sources.find((s) => s.id === id)!;
  const token = ++loadToken;
  player.stop();
  if (!src.x) {
    views.setLoading(true);
    bench.say(`Loading ${src.name}`);
    try {
      const def = SOURCES.find((d) => d.id === id)!;
      src.x = await decodeSource(def, bench.rate);
    } catch (err) {
      views.setLoading(false);
      bench.say(`Could not load the recording (${(err as Error).message})`);
      return;
    }
    if (token !== loadToken) return;
  }
  player.position = 0;
  views.clearSel();
  views.clearBox();
  views.setLoading(false);
  bench.select(id);
}

sourceSel.addEventListener("change", () => void openSource(sourceSel.value));

bench.on("source", () => { describe(); rack.sync(); views.invalidate(); });
bench.on("chain", () => { rack.sync(); setText($("rp-session-sub"), bench.chain.master.on ? "Chain live: every stage can be bypassed and heard against the original" : "Real public-domain recordings. Runs in this page, nothing is uploaded"); });
bench.on("notice", () => setText($("dm-notice"), bench.notice));
bench.on("rendering", () => {
  $("rp-session-name").parentElement!.dataset.busy = String(bench.rendering);
  if (bench.rendering) setText($("dm-info-sub"), "Rendering the chain");
});
bench.on("history", () => {
  ($("dm-undo") as HTMLButtonElement).disabled = bench.index <= 0;
  ($("dm-redo") as HTMLButtonElement).disabled = bench.index >= bench.history.length - 1;
});

let firstRender = true;
bench.on("rendered", () => {
  const res = bench.result!;
  player.setBuffers(bench.orig, res.out);
  views.invalidate();
  panels.invalidate();
  rack.sync();
  const o = bench.measure(bench.orig, null), r = bench.measure(res.out, null);
  views.setChip("orig", `${o.lufs.toFixed(1)} LUFS · peak ${o.peak.toFixed(1)}`);
  views.setChip("rep", `${r.lufs.toFixed(1)} LUFS · peak ${r.peak.toFixed(1)}`);
  syncMatch();
  syncMonitor();
  const n = bench.orig.length;
  setText($("dm-info-sub"), `${bench.rate / 1000} kHz · mono · ${fmtTime(n / bench.rate)} · rendered in ${res.ms} ms`);
  setText($("dm-clock-sub"), `of ${fmtClock(n / bench.rate).slice(0, 8)}`);
  if (firstRender) {
    firstRender = false;
    bench.say(`Repaired: noise ${(o.lufs - o.floor).toFixed(1)} to ${(r.lufs - r.floor).toFixed(1)} dB below the level, ${o.clicks} clicks to ${r.clicks}, loudness ${o.lufs.toFixed(1)} to ${r.lufs.toFixed(1)} LUFS. Press B or Play, then A to hear the original`);
  } else {
    bench.say(`Rendered the chain: ${o.lufs.toFixed(1)} to ${r.lufs.toFixed(1)} LUFS, noise ${(r.lufs - r.floor).toFixed(1)} dB below the level`);
  }
});

function syncMatch(): void {
  const on = $("rp-match").getAttribute("aria-pressed") === "true";
  if (!bench.result) return;
  const o = bench.measure(bench.orig, null), r = bench.measure(bench.result.out, null);
  const db = on && isFinite(o.lufs) && isFinite(r.lufs) ? Math.max(-30, Math.min(30, o.lufs - r.lufs)) : 0;
  player.setMatch(db);
}

function syncMonitor(): void {
  if (!bench.result) return;
  const m = bench.measure(player.side === "A" ? bench.orig : bench.result.out, null);
  setText($("rp-mon-k"), player.side === "A" ? "Original" : "Repaired");
  setText($("dm-mix-lufs"), isFinite(m.lufs) ? `${m.lufs.toFixed(1)} LUFS` : "-- LUFS");
  setText($("dm-mix-peak"), `${m.peak.toFixed(1)} dBFS`);
}

function setSide(side: Side): void {
  player.setSide(side);
  for (const b of document.querySelectorAll<HTMLElement>("[data-side]")) b.setAttribute("aria-pressed", String(b.dataset.side === side));
  syncMonitor();
}

for (const b of document.querySelectorAll<HTMLElement>("[data-side]")) b.addEventListener("click", () => setSide(b.dataset.side as Side));
$("rp-match").addEventListener("click", () => {
  const b = $("rp-match");
  b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
  syncMatch();
});

for (const b of document.querySelectorAll<HTMLElement>("[data-view]")) {
  b.addEventListener("click", () => {
    views.setView(b.dataset.view as "compare" | "orig" | "rep");
    for (const o of document.querySelectorAll<HTMLElement>("[data-view]")) o.setAttribute("aria-pressed", String(o === b));
  });
}

function syncTool(): void {
  for (const o of document.querySelectorAll<HTMLElement>("[data-tool]")) o.setAttribute("aria-pressed", String(o.dataset.tool === views.tool));
  setText($("rp-hint"), views.tool === "box" ? "Drag a box on a spectrogram, then press Heal selection" : "Drag on a spectrogram to select a range, double-click to select all");
}
for (const b of document.querySelectorAll<HTMLElement>("[data-tool]")) b.addEventListener("click", () => { views.setTool(b.dataset.tool as "range" | "box"); syncTool(); });

views.onSeek = (t) => {
  player.position = t;
  if (player.playing) void player.play(t, null);
};
views.onSel = () => {
  const s = views.sel;
  setText($("dm-r-start"), fmtTime(s ? s[0] : 0));
  setText($("dm-r-end"), fmtTime(s ? s[1] : 0));
  setText($("dm-r-len"), fmtTime(s ? s[1] - s[0] : 0));
  panels.rangeChanged();
};
views.onBox = () => {
  const has = !!views.box && views.box.t1 - views.box.t0 > 0.005 && views.box.f1 - views.box.f0 > 20;
  ($("rp-heal") as HTMLButtonElement).disabled = !has;
  ($("rp-clear-box") as HTMLButtonElement).disabled = !views.box;
};
$("rp-heal").addEventListener("click", () => {
  const b = views.box;
  if (!b) return;
  bench.addHeal({ ...b });
  views.clearBox();
  bench.say("Healed the boxed area from the sound around it");
});
$("rp-clear-box").addEventListener("click", () => views.clearBox());

function setPlayIcon(): void {
  const icon = $("dm-play-icon");
  const name = player.playing ? "pause" : "play";
  if (icon.dataset.icon !== name) { icon.dataset.icon = name; icon.innerHTML = ICONS[name]; }
  $("dm-play").setAttribute("aria-label", player.playing ? "Pause" : "Play");
}
player.onStop = setPlayIcon;

async function togglePlay(): Promise<void> {
  if (!bench.result) return;
  if (player.playing) { player.stop(); return; }
  const sel = panels.range();
  if (sel) await player.play(sel[0], sel[1]);
  else await player.play(player.position >= bench.duration - 0.02 ? 0 : player.position, null);
  setPlayIcon();
}

$("dm-play").addEventListener("click", () => void togglePlay());
$("dm-stop").addEventListener("click", () => { player.stop(); player.position = panels.range()?.[0] ?? 0; });
$("dm-home").addEventListener("click", () => views.onSeek(0));
$("dm-loop").addEventListener("click", () => { player.loop = !player.loop; $("dm-loop").setAttribute("aria-pressed", String(player.loop)); });
$("dm-undo").addEventListener("click", () => bench.undo());
$("dm-redo").addEventListener("click", () => bench.redo());
$("rp-all").addEventListener("click", () => {
  const b = $("rp-all");
  const next = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(next));
  setText(b, next ? "All on" : "All off");
  bench.setAll(next);
});
$("rp-reset").addEventListener("click", () => { bench.reset(); $("rp-all").setAttribute("aria-pressed", "true"); setText($("rp-all"), "All on"); });

async function addFile(f: File): Promise<void> {
  bench.say(`Decoding ${f.name}`);
  try {
    const x = await decodeBytes(await f.arrayBuffer(), bench.rate, 120);
    if (!x.length) throw new Error("no audio in the file");
    const id = `file-${++customCount}`;
    const name = f.name.replace(/\.[^.]+$/, "") || "Your audio";
    bench.addSource({ id, name, sub: `Your file, first ${Math.min(120, Math.round(x.length / bench.rate))} s, mixed to mono. Nothing leaves this page`, tags: ["Your audio"], x, custom: true }, cloneChain(PRESETS.custom));
    sourceSel.append(new Option(name, id));
    player.stop();
    player.position = 0;
    views.clearSel();
    views.clearBox();
    bench.select(id);
    bench.commit(`Open ${f.name}`);
  } catch (err) {
    bench.say(`Could not open ${f.name}: ${(err as Error).message || "this browser cannot decode it"}`);
  }
}

const fileInput = $("dm-file") as HTMLInputElement;
$("dm-open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) void addFile(fileInput.files[0]); fileInput.value = ""; });
const drop = $("dm-drop");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { if (!e.dataTransfer?.types.includes("Files")) return; e.preventDefault(); dragDepth++; drop.dataset.on = "true"; });
window.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.dataset.on = "false"; });
window.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; drop.dataset.on = "false"; if (e.dataTransfer?.files[0]) void addFile(e.dataTransfer.files[0]); });

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
  const note = $("dm-ex-note");
  if (!bench.result) { setText(note, "Nothing to export"); return; }
  const which = ($("dm-ex-src") as HTMLSelectElement).value;
  const rng = ($("dm-ex-range") as HTMLSelectElement).value;
  const bits = Number(($("dm-ex-fmt") as HTMLSelectElement).value) as WavBits;
  const x = which === "orig" ? bench.orig : bench.result.out;
  const sel = panels.range();
  if (rng === "sel" && !sel) { setText(note, "Select a range first"); return; }
  const a = rng === "sel" ? Math.round(sel![0] * bench.rate) : 0;
  const b = rng === "sel" ? Math.min(x.length, Math.round(sel![1] * bench.rate)) : x.length;
  const blob = encodeWav([x.slice(a, b)], bench.rate, bits);
  const base = (($("dm-ex-name") as HTMLInputElement).value.trim() || "formwav-repaired").replace(/[^\w.\- ]+/g, "_");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}.wav`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  const msg = `${base}.wav, ${((b - a) / bench.rate).toFixed(2)} s, mono, ${bits === 32 ? "32-bit float" : `${bits}-bit`}, ${(blob.size / 1024).toFixed(0)} KB`;
  setText(note, `Saved ${msg}`);
  bench.say(`Exported ${msg}`);
}
$("dm-ex-go").addEventListener("click", exportWav);

document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  const typing = (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) bench.redo(); else bench.undo(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === " ") { e.preventDefault(); void togglePlay(); }
  else if (k === "a") setSide("A");
  else if (k === "b") setSide("B");
  else if (e.key === "Escape") { views.clearSel(); views.clearBox(); }
});

const meter = $("dm-m0");
let held = 0;
function loop(): void {
  views.frame();
  panels.frame();
  setText($("dm-clock"), fmtClock(player.tick()));
  held = Math.max(player.level(), held * 0.9);
  const d = held > 0.0005 ? toDb(held) : -80;
  meter.style.transform = `scaleX(${Math.max(0, Math.min(1, (d + 60) / 60))})`;
  requestAnimationFrame(loop);
}

syncTool();
panels.setTab("measure");
views.setView("compare");
views.setTool("range");
rack.sync();
requestAnimationFrame(() => {
  views.measure();
  document.body.classList.add("app-ready");
  loop();
});
void openSource("onestep").then(() => bench.commit("Open the recording"));
