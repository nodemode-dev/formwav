import type { Player } from "../audio/player";
import type { Engine } from "../engine";
import { isRecording } from "./arm";

const FLOOR_DB = -60;
const FALL_DB_PER_SECOND = 20;

function toDb(peak: number): number {
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function mountOutputMeter(host: HTMLElement, player: Player): void {
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  const meter = document.createElement("div");
  meter.className = "fw-out-meter";
  meter.setAttribute("role", "group");
  meter.setAttribute("aria-label", "Output level");
  meter.innerHTML =
    `<span class="fw-meter-label">OUT</span>` +
    `<div class="fw-out-track"><div class="fw-out-bar"></div></div>` +
    `<div class="fw-out-track"><div class="fw-out-bar"></div></div>` +
    `<button class="fw-out-clip" type="button" data-clip="false" aria-label="Output clip indicator, click to reset" title="Output reached 0 dBFS (click to reset)"></button>`;
  transport?.append(meter);

  const lufs = document.createElement("output");
  lufs.className = "fw-lufs";
  lufs.title = "Output loudness since play started (BS.1770): momentary 400 ms, short-term 3 s, integrated";
  transport?.append(lufs);
  const show = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v.toFixed(1) : "--").padStart(5, " ");
  let integrated: number | undefined;
  let lastWrite = 0;
  const writeLufs = (m?: number, s?: number) => {
    const text = `M ${show(m)}  S ${show(s)}  I ${show(integrated)} LUFS`;
    if (lufs.textContent !== text) lufs.textContent = text;
  };
  writeLufs();
  player.onOutputLevel((_left, _right, _tracks, loudness) => {
    if (!loudness) {
      writeLufs();
      return;
    }
    integrated = loudness[2];
    const stopped = !Number.isFinite(loudness[0]) && !Number.isFinite(loudness[1]);
    const now = performance.now();
    if (!stopped && now - lastWrite < 200) return;
    lastWrite = now;
    writeLufs(loudness[0], loudness[1]);
  });
  const bars = [...meter.querySelectorAll<HTMLElement>(".fw-out-bar")];
  const clip = meter.querySelector<HTMLButtonElement>(".fw-out-clip");
  const shown = [-Infinity, -Infinity];
  const last = ["", ""];
  let lastTime = performance.now();

  const draw = (i: number) => {
    const v = Math.max(0, Math.min(1, (shown[i] - FLOOR_DB) / -FLOOR_DB));
    const transform = `scaleX(${v.toFixed(3)})`;
    if (transform !== last[i]) {
      last[i] = transform;
      bars[i].style.transform = transform;
    }
  };
  draw(0);
  draw(1);

  player.onOutputLevel((left, right) => {
    const now = performance.now();
    const fall = ((now - lastTime) / 1000) * FALL_DB_PER_SECOND;
    lastTime = now;
    const peaks = [left, right];
    const silent = left === 0 && right === 0;
    for (let i = 0; i < 2; i++) {
      shown[i] = silent ? -Infinity : Math.max(toDb(peaks[i]), shown[i] - fall);
      draw(i);
    }
    if (clip && Math.max(left, right) >= 1 && clip.dataset.clip !== "true") clip.dataset.clip = "true";
  });

  clip?.addEventListener("click", () => {
    if (clip.dataset.clip !== "false") clip.dataset.clip = "false";
  });
}

/** Drives the two bars in each lane head from the per-track peaks, on the same scale and fall-back as the master meter. */
export function mountTrackMeters(host: HTMLElement, engine: Engine, player: Player): void {
  const shown = new Map<string, number[]>();
  const written = new WeakMap<HTMLElement, string>();
  let lastTime = performance.now();
  let barsByKey: Map<string, HTMLElement[]> | null = null;
  const collect = () => {
    const map = new Map<string, HTMLElement[]>();
    for (const bar of host.querySelectorAll<HTMLElement>(".fw-lane-meter .fw-out-bar, .fw-strip-meter .fw-out-bar")) {
      const key = bar.closest<HTMLElement>("[data-key]")?.dataset.key;
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(bar);
      else map.set(key, [bar]);
    }
    return map;
  };
  new MutationObserver(() => {
    barsByKey = null;
  }).observe(host, { childList: true, subtree: true });
  player.onOutputLevel((_left, _right, tracks) => {
    const now = performance.now();
    const fall = ((now - lastTime) / 1000) * FALL_DB_PER_SECOND;
    lastTime = now;
    if (!barsByKey) barsByKey = collect();
    const byKey = barsByKey;
    engine.get("document").tracks.forEach((track, i) => {
      if (isRecording(track.id)) return;
      const bars = byKey.get(track.id);
      if (!bars || bars.length < 2) return;
      const previous = shown.get(track.id) ?? [-Infinity, -Infinity];
      const next = [0, 1].map((c) => (tracks.length === 0 ? -Infinity : Math.max(toDb(tracks[2 * i + c] ?? 0), previous[c] - fall)));
      shown.set(track.id, next);
      bars.forEach((bar, j) => {
        const v = Math.max(0, Math.min(1, (next[j % 2] - FLOOR_DB) / -FLOOR_DB));
        const transform = `scaleX(${v.toFixed(3)})`;
        if (written.get(bar) !== transform) {
          written.set(bar, transform);
          bar.style.transform = transform;
        }
      });
    });
  });
}
