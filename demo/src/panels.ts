import { averageSpectrum, loudness, peakOf, rmsOf, toDb } from "./dsp";
import { OPS, type Op, type Param } from "./ops";
import type { Player } from "./player";
import type { Store } from "./state";
import { fmtTime } from "./timeline";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, v: string): void {
  if (el.textContent !== v) el.textContent = v;
}

function db(v: number): string {
  return isFinite(v) ? `${v.toFixed(1)} dB` : "silent";
}

function decimals(step: number): number {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

function fmtParam(p: Param, v: number): string {
  if (p.kind === "select") return p.options.find((o) => o[0] === v)?.[1] ?? String(v);
  const t = v.toFixed(decimals(p.step));
  return p.unit ? `${t} ${p.unit}` : t;
}

export class Panels {
  currentOp: Op | null = null;
  private forms = new Map<string, HTMLElement>();
  private opButtons = new Map<string, HTMLButtonElement>();
  private tab = "clip";
  private statsTimer = 0;
  private statKey = "";
  private specCanvas: HTMLCanvasElement;
  private specCtx: CanvasRenderingContext2D;
  private specW = 0;
  private specH = 0;
  private staticSpec: { key: string; mags: Float32Array } | null = null;
  private liveBuf = new Float32Array(1024);
  private histRows: HTMLLIElement[] = [];

  constructor(private store: Store, private player: Player, private showTab: (t: string) => void) {
    this.specCanvas = $("dm-spec-canvas");
    this.specCtx = this.specCanvas.getContext("2d")!;
    this.buildOps();
    this.buildForms();
    this.wireTabs();
    store.on("selection", () => { this.refreshScope(); this.queueStats(); });
    store.on("tracks", () => { this.refreshScope(); this.queueStats(); });
    store.on("history", () => this.syncHistory());
    new ResizeObserver(() => this.sizeSpec()).observe(this.specCanvas.parentElement!);
    $("dm-search").addEventListener("input", () => this.filter());
    $("dm-apply").addEventListener("click", () => this.apply());
    this.syncHistory();
    this.refreshScope();
  }

  private buildOps(): void {
    const host = $("dm-oplist");
    let group = "";
    let section: HTMLElement | null = null;
    for (const op of OPS) {
      if (op.group !== group) {
        group = op.group;
        section = document.createElement("div");
        section.className = "dm-opgroup";
        section.dataset.group = group;
        const h = document.createElement("div");
        h.className = "dm-group-title";
        h.textContent = group;
        section.append(h);
        host.append(section);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dm-op";
      b.dataset.op = op.id;
      b.innerHTML = `<span class="dm-op-name"></span><span class="dm-op-sub"></span>`;
      b.firstElementChild!.textContent = op.title;
      b.lastElementChild!.textContent = op.blurb;
      b.addEventListener("click", () => this.choose(op.id));
      section!.append(b);
      this.opButtons.set(op.id, b);
    }
  }

  private buildForms(): void {
    const host = $("dm-fx-forms");
    for (const op of OPS) {
      const f = document.createElement("div");
      f.className = "dm-fx-form";
      f.dataset.op = op.id;
      f.hidden = true;
      if (!op.params.length) {
        const n = document.createElement("div");
        n.className = "dm-fx-none";
        n.textContent = op.needsSel ? "No settings. Drag across a track to select the range, then apply." : "No settings.";
        f.append(n);
      }
      for (const p of op.params) {
        const row = document.createElement("label");
        row.className = "dm-fx-row";
        const lab = document.createElement("span");
        lab.className = "dm-fx-label";
        lab.textContent = p.label;
        const out = document.createElement("output");
        out.className = "dm-fx-out";
        row.append(lab);
        if (p.kind === "range") {
          const inp = document.createElement("input");
          inp.type = "range";
          inp.min = String(p.min); inp.max = String(p.max); inp.step = String(p.step); inp.value = String(p.value);
          inp.dataset.param = p.id;
          inp.setAttribute("aria-label", p.label);
          setText(out, fmtParam(p, p.value));
          inp.addEventListener("input", () => setText(out, fmtParam(p, Number(inp.value))));
          row.append(inp, out);
        } else {
          const sel = document.createElement("select");
          sel.dataset.param = p.id;
          sel.setAttribute("aria-label", p.label);
          for (const [v, l] of p.options) sel.append(new Option(l, String(v)));
          sel.value = String(p.value);
          row.append(sel);
        }
        f.append(row);
      }
      host.append(f);
      this.forms.set(op.id, f);
    }
  }

  private wireTabs(): void {
    for (const b of document.querySelectorAll<HTMLElement>("[data-ltab]")) {
      b.addEventListener("click", () => {
        for (const x of document.querySelectorAll<HTMLElement>("[data-ltab]")) {
          const on = x === b;
          x.classList.toggle("is-active", on);
          x.setAttribute("aria-selected", String(on));
        }
        for (const p of document.querySelectorAll<HTMLElement>("[data-lpanel]")) p.hidden = p.dataset.lpanel !== b.dataset.ltab;
      });
    }
    for (const b of document.querySelectorAll<HTMLElement>("[data-btab]")) b.addEventListener("click", () => this.showTab(b.dataset.btab!));
  }

  setTab(name: string): void {
    this.tab = name;
    for (const x of document.querySelectorAll<HTMLElement>("[data-btab]")) {
      const on = x.dataset.btab === name;
      x.classList.toggle("is-active", on);
      x.setAttribute("aria-selected", String(on));
    }
    for (const p of document.querySelectorAll<HTMLElement>("[data-bpanel]")) p.hidden = p.dataset.bpanel !== name;
    if (name === "spectrum") this.sizeSpec();
    this.queueStats();
  }

  choose(id: string): void {
    this.currentOp = OPS.find((o) => o.id === id) ?? null;
    for (const [k, b] of this.opButtons) b.classList.toggle("is-active", k === id);
    for (const [k, f] of this.forms) f.hidden = k !== id;
    const op = this.currentOp;
    setText($("dm-fx-title"), op ? op.title : "Choose a tool");
    setText($("dm-fx-blurb"), op ? op.blurb : "");
    this.setTab("effects");
    this.refreshScope();
  }

  private filter(): void {
    const q = ($("dm-search") as HTMLInputElement).value.trim().toLowerCase();
    for (const op of OPS) {
      const hit = !q || op.title.toLowerCase().includes(q) || op.blurb.toLowerCase().includes(q) || op.group.toLowerCase().includes(q);
      this.opButtons.get(op.id)!.hidden = !hit;
    }
    for (const g of document.querySelectorAll<HTMLElement>(".dm-opgroup")) g.hidden = !g.querySelector(".dm-op:not([hidden])");
  }

  private params(op: Op): Record<string, number> {
    const form = this.forms.get(op.id)!;
    const out: Record<string, number> = {};
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-param]")) out[el.dataset.param!] = Number(el.value);
    return out;
  }

  apply(): void {
    const op = this.currentOp;
    if (!op) return;
    this.store.apply(op.id, this.params(op));
  }

  refreshScope(): void {
    const t = this.store.track;
    const s = this.store.sel;
    setText($("dm-scope"), t ? `${t.name} · ${s ? `selection ${(s[1] - s[0]).toFixed(3)} s` : "whole track"}` : "No track selected");
    const op = this.currentOp;
    const ok = !!(t && op && (!op.needsSel || (s && s[1] - s[0] > 0.0001)));
    const btn = $("dm-apply") as HTMLButtonElement;
    if (btn.disabled !== !ok) btn.disabled = !ok;
    setText($("dm-fx-note"), op && t && op.needsSel && !s ? "Needs a selection" : op && t ? (s ? "Applies to the selection" : "Applies to the whole track") : "");
  }

  private queueStats(): void {
    window.clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => this.stats(), 90);
  }

  private range(): { s: number; e: number; whole: boolean } | null {
    const t = this.store.track;
    if (!t) return null;
    const n = t.chans[0].length, r = this.store.rate;
    const sel = this.store.sel;
    if (sel) return { s: Math.max(0, Math.round(sel[0] * r)), e: Math.min(n, Math.round(sel[1] * r)), whole: false };
    return { s: 0, e: n, whole: true };
  }

  private stats(): void {
    const t = this.store.track;
    const rg = this.range();
    if (!t || !rg || rg.e - rg.s < 2) {
      for (const id of ["dm-s-name", "dm-s-ch", "dm-s-len", "dm-s-rate", "dm-s-peak", "dm-s-rms", "dm-s-lufs", "dm-s-range"]) setText($(id), "-");
      return;
    }
    setText($("dm-s-name"), t.name);
    setText($("dm-s-ch"), t.chans.length > 1 ? "2 (stereo)" : "1 (mono)");
    setText($("dm-s-len"), fmtTime(t.chans[0].length / this.store.rate));
    setText($("dm-s-rate"), `${this.store.rate} Hz`);
    setText($("dm-s-range"), rg.whole ? "Whole track" : `Selection ${fmtTime((rg.e - rg.s) / this.store.rate)}`);
    const key = `${t.chans[0].length}:${rg.s}:${rg.e}:${t.chans[0][rg.s]}:${t.chans[0][Math.max(rg.s, rg.e - 1)]}`;
    if (this.tab === "clip" && key !== this.statKey) {
      this.statKey = key;
      setText($("dm-s-peak"), db(toDb(peakOf(t.chans, rg.s, rg.e))));
      setText($("dm-s-rms"), db(toDb(rmsOf(t.chans, rg.s, rg.e))));
      const l = loudness(t.chans, this.store.rate, rg.s, rg.e);
      setText($("dm-s-lufs"), isFinite(l) ? `${l.toFixed(1)} LUFS` : "too quiet to measure");
    }
  }

  private syncHistory(): void {
    const host = $("dm-history");
    const h = this.store.history;
    while (this.histRows.length > h.length) this.histRows.pop()!.remove();
    h.forEach((entry, i) => {
      let li = this.histRows[i];
      if (!li) {
        li = document.createElement("li");
        li.className = "dm-hist";
        const b = document.createElement("button");
        b.type = "button";
        li.append(b);
        b.addEventListener("click", () => this.store.jump(i));
        host.append(li);
        this.histRows[i] = li;
      }
      const btn = li.firstElementChild as HTMLElement;
      setText(btn, entry.label);
      li.classList.toggle("is-current", i === this.store.index);
      li.classList.toggle("is-future", i > this.store.index);
    });
    const cur = this.histRows[this.store.index];
    if (cur) cur.scrollIntoView({ block: "nearest" });
    (document.getElementById("dm-undo") as HTMLButtonElement).disabled = this.store.index <= 0;
    (document.getElementById("dm-redo") as HTMLButtonElement).disabled = this.store.index >= h.length - 1;
  }

  private sizeSpec(): void {
    const host = this.specCanvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    if (w === this.specW && h === this.specH) return;
    this.specW = w; this.specH = h;
    this.specCanvas.width = Math.round(w * dpr);
    this.specCanvas.height = Math.round(h * dpr);
  }

  private css(v: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  frame(): void {
    if (this.tab !== "spectrum") return;
    const live = this.player.spectrum(this.liveBuf);
    const t = this.store.track;
    const rate = this.store.rate;
    let mags: Float32Array | null = null;
    let binHz = rate / 2048;
    let isDb = true;
    if (live) {
      mags = this.liveBuf;
    } else if (t) {
      const rg = this.range()!;
      const key = `${t.chans[0].length}:${rg.s}:${rg.e}:${t.chans[0][rg.s]}:${t.id}`;
      if (!this.staticSpec || this.staticSpec.key !== key) this.staticSpec = { key, mags: averageSpectrum(t.chans, rg.s, rg.e, 512) };
      mags = this.staticSpec.mags;
      binHz = rate / 1024;
      isDb = false;
    }
    const dpr = window.devicePixelRatio || 1;
    const g = this.specCtx;
    const W = this.specW, H = this.specH;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const padL = 36, padB = 18, plotW = W - padL - 8, plotH = H - padB - 8;
    const fx = (f: number) => padL + (Math.log(f / 20) / Math.log(20000 / 20)) * plotW;
    const dy = (d: number) => 8 + (1 - (d + 100) / 100) * plotH;
    g.font = `10px ${getComputedStyle(document.body).fontFamily}`;
    g.fillStyle = this.css("--text-muted");
    g.strokeStyle = this.css("--line-1");
    g.lineWidth = 1;
    g.textBaseline = "middle";
    for (const d of [-20, -40, -60, -80]) {
      const y = Math.round(dy(d)) + 0.5;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + plotW, y); g.stroke();
      g.fillText(String(d), 6, y);
    }
    g.textBaseline = "top";
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(fx(f)) + 0.5;
      g.beginPath(); g.moveTo(x, 8); g.lineTo(x, 8 + plotH); g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x - 8, H - 14);
    }
    if (!mags) return;
    const accent = this.css("--accent-color");
    g.beginPath();
    let started = false;
    for (let b = 1; b < mags.length; b++) {
      const f = b * binHz;
      if (f < 20 || f > 20000) continue;
      const d = isDb ? mags[b] : 20 * Math.log10(mags[b] + 1e-9);
      const x = fx(f), y = Math.max(8, Math.min(8 + plotH, dy(d)));
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.strokeStyle = accent;
    g.lineWidth = 1.5;
    g.stroke();
    g.lineTo(padL + plotW, 8 + plotH);
    g.lineTo(fx(Math.max(20, binHz)), 8 + plotH);
    g.closePath();
    g.globalAlpha = 0.16;
    g.fillStyle = accent;
    g.fill();
    g.globalAlpha = 1;
  }
}

