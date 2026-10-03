/**
 * The curve editor for effects shaped by points (AU-B06's dynamics transfer curve, AU-B07's drawn EQ curve): a canvas
 * over the effect's own point fields that draws the curve they make and lets each point be dragged, writing the values
 * back into those fields with input events (the fields stay, as typed controls, and keep the Inspector's own handling);
 * it stores nothing itself. The filter curve's frequency axis is logarithmic; the dynamics curve shows the unity line.
 * The canvas publishes its points (data-points) so tests can check what it drew and wrote.
 */
interface CurveKind {
  xs: string[];
  ys: string[];
  x: [number, number];
  y: [number, number];
  logX: boolean;
  diagonal: boolean;
  name: string;
}

const KINDS: Record<string, CurveKind> = {
  "filter-curve": { xs: ["f1", "f2", "f3", "f4", "f5", "f6"], ys: ["g1", "g2", "g3", "g4", "g5", "g6"], x: [20, 20000], y: [-24, 24], logX: true, diagonal: false, name: "EQ curve: frequency across, gain up" },
  "dynamics-curve": { xs: ["i1", "i2", "i3", "i4", "i5"], ys: ["o1", "o2", "o3", "o4", "o5"], x: [-80, 0], y: [-80, 0], logX: false, diagonal: true, name: "Transfer curve: input level across, output level up" },
};

export function mountCurveEditor(box: HTMLElement, effect: string): void {
  const kind = KINDS[effect];
  if (!kind) return;
  const xi = kind.xs.map((k) => box.querySelector<HTMLInputElement>(`input[data-param=${k}]`));
  const yi = kind.ys.map((k) => box.querySelector<HTMLInputElement>(`input[data-param=${k}]`));
  if (xi.some((i) => !i) || yi.some((i) => !i)) return;
  const canvas = document.createElement("canvas");
  canvas.className = "fw-curve";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", kind.name);
  box.prepend(canvas);
  const pad = 10;
  const toPx = (vx: number, vy: number, w: number, h: number) => {
    const fx = kind.logX ? Math.log10(vx / kind.x[0]) / Math.log10(kind.x[1] / kind.x[0]) : (vx - kind.x[0]) / (kind.x[1] - kind.x[0]);
    return [pad + fx * (w - 2 * pad), pad + (1 - (vy - kind.y[0]) / (kind.y[1] - kind.y[0])) * (h - 2 * pad)];
  };
  const fromPx = (px: number, py: number, w: number, h: number) => {
    const fx = Math.min(1, Math.max(0, (px - pad) / (w - 2 * pad)));
    const fy = Math.min(1, Math.max(0, 1 - (py - pad) / (h - 2 * pad)));
    const vx = kind.logX ? kind.x[0] * (kind.x[1] / kind.x[0]) ** fx : kind.x[0] + fx * (kind.x[1] - kind.x[0]);
    return [vx, kind.y[0] + fy * (kind.y[1] - kind.y[0])];
  };
  const points = () => xi.map((x, i) => [Number(x?.value), Number(yi[i]?.value)] as [number, number]);
  const draw = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(box);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css.getPropertyValue("--surface-0").trim();
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css.getPropertyValue("--line-1").trim();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (kind.diagonal) {
      const [a, b] = [toPx(kind.x[0], kind.y[0], w, h), toPx(kind.x[1], kind.y[1], w, h)];
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    } else {
      const [, zero] = toPx(kind.x[0], 0, w, h);
      ctx.moveTo(pad, zero);
      ctx.lineTo(w - pad, zero);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const sorted = points().sort((p, q) => p[0] - q[0]);
    ctx.strokeStyle = css.getPropertyValue("--fw-audio").trim();
    ctx.lineWidth = 2;
    ctx.beginPath();
    sorted.forEach(([vx, vy], i) => {
      const [px, py] = toPx(vx, vy, w, h);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = css.getPropertyValue("--text-primary").trim();
    for (const [vx, vy] of sorted) {
      const [px, py] = toPx(vx, vy, w, h);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const text = JSON.stringify(points().map(([vx, vy]) => [Math.round(vx * 10) / 10, Math.round(vy * 10) / 10]));
    if (canvas.dataset.points !== text) canvas.dataset.points = text;
  };
  let dragging = -1;
  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    let best = 14;
    dragging = -1;
    points().forEach(([vx, vy], i) => {
      const [px, py] = toPx(vx, vy, r.width, r.height);
      const d = Math.hypot(px - (e.clientX - r.left), py - (e.clientY - r.top));
      if (d < best) {
        best = d;
        dragging = i;
      }
    });
    if (dragging >= 0) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging < 0) return;
    const r = canvas.getBoundingClientRect();
    const [vx, vy] = fromPx(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    for (const [input, value] of [[xi[dragging], vx], [yi[dragging], vy]] as const) {
      if (!input) continue;
      const step = Number(input.step) || 0.1;
      const v = Math.min(Number(input.max), Math.max(Number(input.min), Math.round(value / step) * step));
      const text = String(Math.round(v * 1000) / 1000);
      if (input.value !== text) {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    draw();
  });
  const release = () => {
    dragging = -1;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  box.addEventListener("input", draw);
  new ResizeObserver(draw).observe(canvas);
  requestAnimationFrame(draw);
}
