import type { Engine } from "../engine";
import type { Player } from "../audio/player";
import { LAYOUT_IDS, layoutTable, type LayoutRow } from "../audio/surround";
import { icon as fvIcon } from "../vendor/formvis/icons";

function writeText(el: Element | null, text: string): void {
  const node = el?.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE) {
    if ((node as Text).data !== text) (node as Text).data = text;
  } else if (el && el.textContent !== text) el.textContent = text;
}

export interface RendererPanel {
  toggle: () => void;
  isOpen: () => boolean;
  onChange: (fn: () => void) => void;
}

const CELLS = 16;
const FALL_DB_PER_S = 20;
const HOLD_MS = 2000;

export function mountRendererPanel(host: HTMLElement, engine: Engine, player: Player): RendererPanel {
  const panel = document.createElement("section");
  panel.className = "fw-renderer";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Renderer panel");
  const cells = Array.from({ length: CELLS }, (_, k) => `<div class="fw-rend-ch" data-rend-ch="${k}" hidden><span class="fw-rend-bar"><span class="fw-rend-fill"></span><span class="fw-rend-hold"></span></span><span class="fw-rend-name" translate="no"> </span><output class="fw-rend-db" data-db="-inf">-inf</output></div>`).join("");
  panel.innerHTML = `<div class="fw-rend-head"><span>Renderer</span><button type="button" class="fw-icon-btn fw-rend-close" aria-label="Close the renderer" title="Close the renderer">${fvIcon("close", 14)}</button></div><div class="fw-rend-room"><canvas data-rend-room width="232" height="232" aria-label="Speakers and their live levels"></canvas>${cells}</div><div class="fw-rend-foot"><span class="fw-rend-layout" data-rend-layout translate="no">5.1</span><label class="fw-sam-opt"><input type="checkbox" data-rend-fold> Fold to stereo</label></div><p class="fw-rend-note" data-rend-note>Levels show while the session plays as a fold-down</p>`;
  host.append(panel);
  const room = panel.querySelector<HTMLCanvasElement>("[data-rend-room]") as HTMLCanvasElement;
  const cellEls = [...panel.querySelectorAll<HTMLElement>(".fw-rend-ch")];
  const fills = cellEls.map((c) => c.querySelector<HTMLElement>(".fw-rend-fill") as HTMLElement);
  const holds = cellEls.map((c) => c.querySelector<HTMLElement>(".fw-rend-hold") as HTMLElement);
  const reads = cellEls.map((c) => c.querySelector<HTMLOutputElement>(".fw-rend-db") as HTMLOutputElement);
  const fold = panel.querySelector<HTMLInputElement>("[data-rend-fold]") as HTMLInputElement;
  const note = panel.querySelector<HTMLElement>("[data-rend-note]") as HTMLElement;
  let rows: LayoutRow[] | null = null;
  let laidOut = "";
  const shown = new Float64Array(CELLS).fill(-Infinity);
  const held = new Float64Array(CELLS).fill(-Infinity);
  const heldAt = new Float64Array(CELLS);
  let last = performance.now();

  const row = (): LayoutRow | null => {
    const format = engine.get("document").spatialFormat ?? "5.1";
    if (format === "foa") return { id: 1, name: "foa", mask: 0, channels: ["W", "Y", "Z", "X"].map((name, k) => ({ name, az: [0, -90, 0, 0][k], el: [0, 0, 90, 0][k], fold: [0, 0] })) };
    return rows?.find((r) => r.id === LAYOUT_IDS[format]) ?? null;
  };

  const drawRoom = () => {
    const g = room.getContext("2d");
    const r = row();
    if (!g || !r) return;
    const { width: w, height: h } = room;
    const style = getComputedStyle(room);
    const ink = style.color;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || ink;
    const radius = w / 2 - 34;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = ink;
    g.globalAlpha = 0.25;
    g.beginPath();
    g.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
    g.stroke();
    if (r.channels.some((c) => c.el > 0)) {
      g.globalAlpha = 0.15;
      g.beginPath();
      g.arc(w / 2, h / 2, radius * 0.55, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 0.9;
    g.fillStyle = accent;
    for (const t of engine.get("document").tracks) {
      if (!t.surround || t.mute) continue;
      g.beginPath();
      g.arc(w / 2 + t.surround.x * radius, h / 2 - t.surround.y * radius, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  const layout = () => {
    const r = row();
    const key = r ? `${r.id}` : "";
    if (!r || key === laidOut) return;
    laidOut = key;
    const radius = 0.5 - 34 / 232;
    let lfeSlot = 0;
    cellEls.forEach((cell, k) => {
      const c = r.channels[k];
      const on = !!c;
      if (cell.hidden === on) cell.hidden = !on;
      if (!c) return;
      writeText(cell.querySelector<HTMLElement>(".fw-rend-name"), c.name);
      reads[k].title = `Speaker ${k + 1} level`;
      const a = (c.az * Math.PI) / 180;
      const ring = c.name === "LFE" ? 0 : c.el > 0 ? radius * 0.55 : radius;
      const x = c.name === "LFE" ? 0.9 - 0.12 * lfeSlot++ : 0.5 + Math.sin(a) * ring;
      const y = c.name === "LFE" ? 0.9 : 0.5 - Math.cos(a) * ring;
      cell.style.setProperty("--x", x.toFixed(4));
      cell.style.setProperty("--y", y.toFixed(4));
    });
    writeText(panel.querySelector<HTMLElement>("[data-rend-layout]"), r.name === "foa" ? "Ambisonics (FOA)" : r.name);
    drawRoom();
  };

  const syncFold = () => {
    const on = !!engine.get("document").surroundFold;
    if (fold.checked !== on) fold.checked = on;
    const quiet = on && engine.get("transport").playing;
    if (note.hidden === quiet) note.hidden = quiet;
  };

  const meter = (peaks: number[] | null) => {
    if (panel.hidden) return;
    const now = performance.now();
    const fall = ((now - last) / 1000) * FALL_DB_PER_S;
    last = now;
    for (let k = 0; k < CELLS; k++) {
      if (cellEls[k].hidden) continue;
      const p = peaks?.[k] ?? 0;
      const db = peaks ? Math.max(p > 0 ? 20 * Math.log10(p) : -Infinity, shown[k] - fall) : -Infinity;
      shown[k] = db;
      const scale = `scaleY(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;
      if (fills[k].style.transform !== scale) fills[k].style.transform = scale;
      if (db >= held[k] || now - heldAt[k] > HOLD_MS) {
        held[k] = db;
        heldAt[k] = now;
        const at = `translateY(${(-Math.max(0, Math.min(1, (db + 60) / 60)) * 100).toFixed(1)}%)`;
        if (holds[k].style.transform !== at) holds[k].style.transform = at;
      }
      const text = Number.isFinite(db) && db > -60 ? db.toFixed(1) : "-inf";
      if (reads[k].dataset.db !== text) {
        reads[k].dataset.db = text;
        writeText(reads[k], text);
      }
    }
  };

  void layoutTable().then((r) => {
    rows = r;
    layout();
  });
  engine.subscribe("document", () => {
    if (panel.hidden) return;
    layout();
    drawRoom();
    syncFold();
  });
  engine.subscribe("transport", () => {
    if (!panel.hidden) syncFold();
  });
  player.onSurroundLevel(meter);
  fold.addEventListener("change", () => engine.dispatch({ type: "set-surround-fold", on: fold.checked }));

  const listeners = new Set<() => void>();
  const setOpen = (on: boolean) => {
    if (panel.hidden === !on) return;
    panel.hidden = !on;
    if (on) {
      layout();
      drawRoom();
      syncFold();
    }
    for (const fn of listeners) fn();
  };
  panel.querySelector(".fw-rend-close")?.addEventListener("click", () => setOpen(false));

  const head = panel.querySelector<HTMLElement>(".fw-rend-head") as HTMLElement;
  let offset = { x: 0, y: 0 };
  let drag: { x: number; y: number; from: { x: number; y: number }; base: DOMRect } | null = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const r = panel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, from: offset, base: new DOMRect(r.left - offset.x, r.top - offset.y, r.width, r.height) };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => {
    const d = drag;
    if (!d) return;
    const x = Math.min(window.innerWidth - d.base.right, Math.max(-d.base.left, d.from.x + e.clientX - d.x));
    const y = Math.min(window.innerHeight - d.base.bottom, Math.max(-d.base.top, d.from.y + e.clientY - d.y));
    offset = { x, y };
    panel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
  const end = () => {
    drag = null;
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);

  return {
    toggle: () => setOpen(panel.hidden !== false),
    isOpen: () => !panel.hidden,
    onChange: (fn) => listeners.add(fn),
  };
}
