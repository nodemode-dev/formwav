import type { Engine } from "../engine";
import type { Player } from "../audio/player";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * The Spectrum panel (RX-43's spectrum analyzer, RX-63 and AA-01's spectral display, AA-03's frequency analysis): Live
 * draws the output while it plays, from an analyser on the player (browser output; native output has none), and
 * Average draws the selected clip's averaged spectrum (or the drawn range's), measured by the engine (Welch, half
 * overlap); the FFT size is chosen from 512 to 32768, and the averaged view can show L+R, the mid or the side of a
 * stereo clip (RX-54). Log frequency from 20 Hz, 0 to -100 dB. The canvas publishes the frequency at its curve's
 * highest point (data-peak-hz) so tests can check what it drew.
 */
const FFTS = [512, 1024, 2048, 4096, 8192, 16384, 32768];

export function mountSpectrum(host: HTMLElement, engine: Engine, player: Player): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const transport = pane?.querySelector<HTMLElement>(".fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  if (!pane || !transport || !view) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.dataset.spectrum = "";
  toggle.setAttribute("aria-pressed", "false");
  toggle.title = "Show the spectrum analyzer";
  toggle.innerHTML = "<span>Spectrum</span>";
  view.append(toggle);

  const panel = document.createElement("section");
  panel.className = "fw-spectrum";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Spectrum analyzer");
  panel.innerHTML = `<div class="fw-piano-head"><label class="fw-piano-opt">Mode <select data-sp="mode"><option value="live">Live</option><option value="avg">Average</option></select></label><label class="fw-piano-opt">FFT <select data-sp="fft">${FFTS.map((n) => `<option value="${n}"${n === 4096 ? " selected" : ""}>${n}</option>`).join("")}</select></label><label class="fw-piano-opt">View <select data-sp="channel"><option value="both">L+R</option><option value="mid">Mid</option><option value="side">Side</option></select></label><span class="fw-piano-state" role="status"></span></div><canvas class="fw-spectrum-canvas" aria-label="Spectrum"></canvas>`;
  transport.before(panel);
  const canvas = panel.querySelector("canvas") as HTMLCanvasElement;
  const state = panel.querySelector<HTMLElement>(".fw-piano-state");
  const pickValue = (key: string) => panel.querySelector<HTMLSelectElement>(`[data-sp="${key}"]`)?.value ?? "";

  let clipId: string | null = null;
  let range: { trackId: string; start: number; end: number } | null = null;
  let raf = 0;
  let avg: { db: number[]; binHz: number } | null = null;

  const draw = (db: ArrayLike<number>, binHz: number) => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(panel);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css.getPropertyValue("--surface-0").trim();
    ctx.fillRect(0, 0, w, h);
    const nyq = binHz * (db.length - 1);
    const span = Math.log10(Math.max(40, nyq) / 20);
    ctx.fillStyle = css.getPropertyValue("--line-1").trim();
    for (const f of [100, 1000, 10000]) if (f < nyq) ctx.fillRect(Math.round((Math.log10(f / 20) / span) * w), 0, 1, h);
    ctx.strokeStyle = css.getPropertyValue("--fw-audio").trim();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let peak = -Infinity;
    let peakHz = 0;
    for (let i = 1; i < db.length; i++) {
      const f = i * binHz;
      if (f < 20) continue;
      const v = Math.max(-100, Math.min(0, db[i]));
      if (db[i] > peak) {
        peak = db[i];
        peakHz = f;
      }
      const x = (Math.log10(f / 20) / span) * w;
      const y = (-v / 100) * h;
      if (i === 1 || f - binHz < 20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const hz = String(Math.round(peakHz));
    if (canvas.dataset.peakHz !== hz) canvas.dataset.peakHz = hz;
  };

  const live = () => {
    raf = 0;
    if (panel.hidden || pickValue("mode") !== "live") return;
    const an = player.analyser();
    if (!an) {
      setText(state, "Play to see the live spectrum (it needs the browser output)");
    } else {
      const fft = Number(pickValue("fft"));
      if (an.fftSize !== fft) an.fftSize = fft;
      const buf = new Float32Array(an.frequencyBinCount);
      an.getFloatFrequencyData(buf);
      // the analyser's dB are of the raw FFT; a full-scale sine reads about -6 dB at its bin with the Blackman window
      draw(buf, an.context.sampleRate / an.fftSize);
      setText(state, engine.get("transport").playing ? `Live, FFT ${fft}` : "Live (stopped)");
    }
    raf = requestAnimationFrame(live);
  };

  const average = async () => {
    if (panel.hidden || pickValue("mode") !== "avg") return;
    const doc = engine.get("document");
    let track = range ? doc.tracks.find((t) => t.id === range?.trackId) : undefined;
    let clip = track && range ? track.clips.find((c) => c.start < (range?.end ?? 0) && (range?.start ?? 0) < c.start + c.length) : undefined;
    if (!clip && clipId) {
      for (const t of doc.tracks) {
        const c = t.clips.find((x) => x.id === clipId);
        if (c) {
          track = t;
          clip = c;
        }
      }
    }
    if (!clip) {
      setText(state, "Select a clip (or draw a range) to see its average spectrum");
      return;
    }
    const rate = doc.sampleRate;
    const from = range && track && range.trackId === track.id ? Math.max(range.start, clip.start) : clip.start;
    const to = range && track && range.trackId === track.id ? Math.min(range.end, clip.start + clip.length) : clip.start + clip.length;
    const q = new URLSearchParams({ fft: pickValue("fft"), start: String((clip.sourceIn + from - clip.start) / rate), end: String((clip.sourceIn + to - clip.start) / rate), channel: pickValue("channel") });
    setText(state, "Measuring...");
    const res = await fetch(`/api/media/${clip.mediaId}/spectrum?${q}`);
    const out = (await res.json().catch(() => ({}))) as { db?: number[]; binHz?: number; frames?: number; fft?: number; detail?: unknown };
    if (!res.ok || !out.db || !out.binHz) {
      setText(state, typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      return;
    }
    avg = { db: out.db, binHz: out.binHz };
    draw(avg.db, avg.binHz);
    setText(state, `Average of ${out.frames} windows, FFT ${out.fft}, ${pickValue("channel") === "both" ? "L+R" : pickValue("channel")}`);
  };

  const refresh = () => {
    if (panel.hidden) return;
    if (pickValue("mode") === "live") {
      if (!raf) raf = requestAnimationFrame(live);
    } else void average();
  };
  panel.addEventListener("change", refresh);
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-pressed", String(!panel.hidden));
    refresh();
  });
  host.addEventListener("fw-selection", (e) => {
    const ids = (e as CustomEvent<string[]>).detail ?? [];
    if (ids.length) clipId = ids[0];
    if (pickValue("mode") === "avg") void average();
  });
  host.addEventListener("fw-range", (e) => {
    range = (e as CustomEvent<{ trackId: string; start: number; end: number } | null>).detail;
    if (pickValue("mode") === "avg") void average();
  });
  new ResizeObserver(() => {
    if (avg && pickValue("mode") === "avg") draw(avg.db, avg.binHz);
  }).observe(canvas);
}
