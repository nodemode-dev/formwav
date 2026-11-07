import { fmtBars, fmtClock } from "./arrange";
import { items } from "./lib";
import { arc, fromT, KINDS, type Param, shown, toT, TRACK_ARC } from "./kinds";
import { type Clip, MARKER_COLORS, type Pattern, type Store, type Track } from "./model";
import { blank, LEVELS, renderPattern, ROWS, STEPS } from "./pattern";
import type { Player } from "./player";
import { patternItem } from "./session";
import { knobify } from "../../../frontend/src/ui/knob";

export function setText(el: Element | null, v: string): void {
  if (el && el.textContent !== v) el.textContent = v;
}

const glyph = (paths: string): string => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">${paths}</svg>`;
const POWER = glyph('<path d="M12 3v8"></path><path d="M6.3 7.3a8 8 0 1011.4 0"></path>');
const CROSS = glyph('<path d="M6 6l12 12"></path><path d="M18 6L6 18"></path>');
const ARROW = '<svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true"><path d="M2 7h20" stroke="currentColor" stroke-width="2"></path><path d="M19 3l5 4-5 4" fill="none" stroke="currentColor" stroke-width="2"></path></svg>';

export class Effects {
  private row: HTMLElement;
  private title: HTMLElement;
  private shape = "";

  constructor(private root: HTMLElement, private store: Store) {
    this.row = root.querySelector(".fw-chain-row")!;
    this.title = root.querySelector(".fw-chain-title")!;
    const add = root.querySelector<HTMLSelectElement>("#pr-fx-add")!;
    add.replaceChildren(new Option("Add an effect", ""), ...Object.entries(KINDS).map(([id, k]) => new Option(k.label, id)));
    add.addEventListener("change", () => { if (add.value) this.add(add.value); add.value = ""; });
    this.row.addEventListener("click", (e) => this.click(e));
    this.row.addEventListener("pointerdown", (e) => this.down(e));
    this.row.addEventListener("keydown", (e) => this.key(e));
    store.on("doc", () => this.render());
    store.on("sel", () => this.render());
    store.on("live", () => this.render());
  }

  add(kind: string): void {
    const t = this.store.track;
    if (!t) { this.store.say("Select a track first"); return; }
    t.fx.push({ id: this.store.nextId(), kind, bypass: false, v: { ...KINDS[kind].init } });
    this.store.commit(`Add ${KINDS[kind].label} to ${t.name}`);
    this.store.say(`${KINDS[kind].label} added to ${t.name}`);
  }

  private card(t: Track, i: number): string {
    const f = t.fx[i];
    const k = KINDS[f.kind];
    const knobs = k.params.map((p) => {
      const v = f.v[p[0]] ?? k.init[p[0]];
      return `<div class="fw-knob" data-i="${i}" data-key="${p[0]}" tabindex="0" role="slider" aria-label="${k.label} ${p[1]}" aria-valuemin="${p[2]}" aria-valuemax="${p[3]}" aria-valuenow="${v}"><svg viewBox="0 0 48 48" aria-hidden="true"><path class="fw-knob-track" d="${TRACK_ARC}"></path><path class="fw-knob-arc" d="${arc(toT(v, p))}"></path><circle cx="24" cy="24" r="11"></circle></svg><span class="fw-knob-value">${shown(v, p)}</span><span class="fw-knob-label">${p[1]}</span></div>`;
    }).join("");
    return `<div class="fw-fx-card" data-i="${i}"><div class="fw-fx-top"><span class="fw-fx-names"><span class="fw-fx-name">${k.label}</span><span class="fw-fx-sub">${k.sub}</span></span><button type="button" class="fw-fx-bypass" data-i="${i}" aria-pressed="${!f.bypass}" aria-label="${k.label} on" title="On or bypassed">${POWER}</button><button type="button" class="fw-fx-remove" data-i="${i}" aria-label="Remove ${k.label}" title="Remove">${CROSS}</button></div><div class="fw-fx-knobs">${knobs}</div></div><span class="fw-fx-link" aria-hidden="true">${ARROW}</span>`;
  }

  render(): void {
    const t = this.store.track;
    const fx = t?.fx ?? [];
    setText(this.title, t ? `${t.name}: ${fx.length === 0 ? "no effects yet" : fx.length === 1 ? "one effect, live" : `${fx.length} effects, live`}` : "Select a track to give it effects");
    const next = `${t?.id ?? ""}|${fx.map((f) => `${f.id}${f.kind}`).join(",")}`;
    if (next !== this.shape) {
      this.shape = next;
      const add = this.root.querySelector<HTMLElement>(".fw-fx-add-slot")!;
      for (const c of [...this.row.children]) if (c !== add) c.remove();
      add.insertAdjacentHTML("beforebegin", t ? fx.map((_, i) => this.card(t, i)).join("") : "");
      return;
    }
    if (!t) return;
    fx.forEach((f, i) => {
      const k = KINDS[f.kind];
      this.row.querySelector(`.fw-fx-bypass[data-i="${i}"]`)?.setAttribute("aria-pressed", String(!f.bypass));
      for (const p of k.params) {
        const knob = this.row.querySelector<HTMLElement>(`.fw-knob[data-i="${i}"][data-key="${p[0]}"]`);
        if (!knob || knob.dataset.dragging) continue;
        const v = f.v[p[0]] ?? k.init[p[0]];
        const a = arc(toT(v, p));
        const path = knob.querySelector(".fw-knob-arc");
        if (path && path.getAttribute("d") !== a) path.setAttribute("d", a);
        setText(knob.querySelector(".fw-knob-value"), shown(v, p));
        knob.setAttribute("aria-valuenow", String(v));
      }
    });
  }

  private click(e: MouseEvent): void {
    const t = this.store.track;
    if (!t) return;
    const el = e.target as HTMLElement;
    const by = el.closest<HTMLElement>(".fw-fx-bypass");
    if (by) { const f = t.fx[Number(by.dataset.i)]; f.bypass = !f.bypass; this.store.commit(`${f.bypass ? "Bypass" : "Enable"} ${KINDS[f.kind].label} on ${t.name}`); return; }
    const rm = el.closest<HTMLElement>(".fw-fx-remove");
    if (rm) {
      const f = t.fx[Number(rm.dataset.i)];
      t.fx = t.fx.filter((x) => x !== f);
      for (const k of Object.keys(t.auto)) if (k.startsWith(`${f.id}:`)) delete t.auto[k];
      this.store.commit(`Remove ${KINDS[f.kind].label} from ${t.name}`);
    }
  }

  private set(knob: HTMLElement, p: Param, value: number, commit: boolean): void {
    const t = this.store.track;
    if (!t) return;
    const f = t.fx[Number(knob.dataset.i)];
    f.v[p[0]] = Number(value.toPrecision(4));
    if (commit) this.store.commit(`${p[1]} of ${KINDS[f.kind].label} on ${t.name}`); else this.store.emit("live");
  }

  private paramOf(knob: HTMLElement): Param | undefined {
    const f = this.store.track?.fx[Number(knob.dataset.i)];
    return f ? KINDS[f.kind].params.find((q) => q[0] === knob.dataset.key) : undefined;
  }

  private down(e: PointerEvent): void {
    const knob = (e.target as HTMLElement).closest<HTMLElement>(".fw-knob");
    const p = knob ? this.paramOf(knob) : undefined;
    if (!knob || !p) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    knob.dataset.dragging = "1";
    const y0 = e.clientY;
    const t0 = toT(Number(knob.getAttribute("aria-valuenow")), p);
    let v = fromT(t0, p);
    const move = (ev: PointerEvent): void => {
      v = fromT(t0 + ((y0 - ev.clientY) / 160) * (ev.shiftKey ? 0.1 : 1), p);
      knob.querySelector(".fw-knob-arc")?.setAttribute("d", arc(toT(v, p)));
      setText(knob.querySelector(".fw-knob-value"), shown(v, p));
      knob.setAttribute("aria-valuenow", String(v));
      this.set(knob, p, v, false);
    };
    const up = (): void => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
      delete knob.dataset.dragging;
      this.set(knob, p, v, true);
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
  }

  private key(e: KeyboardEvent): void {
    const knob = (e.target as HTMLElement).closest<HTMLElement>(".fw-knob");
    const p = knob ? this.paramOf(knob) : undefined;
    if (!knob || !p) return;
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.02 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.02 : 0;
    if (!step) return;
    e.preventDefault();
    this.set(knob, p, fromT(toT(Number(knob.getAttribute("aria-valuenow")), p) + step, p), true);
  }
}

export class Sequencer {
  private grid: HTMLElement;
  private saved: HTMLSelectElement;
  private steps: number[][] = blank();
  private loaded = "";

  constructor(private root: HTMLElement, private store: Store, private player: Player, private place: (item: string, beat: number) => void) {
    this.grid = root.querySelector("#pr-seq-grid")!;
    this.saved = root.querySelector("#pr-seq-saved")!;
    this.draw();
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("input", (e) => { const t = e.target as HTMLElement; if (t.matches("[data-seq-bars], [data-seq-swing]")) this.outputs(); });
    this.saved.addEventListener("change", () => {
      const p = this.store.doc.patterns.find((q) => q.id === this.saved.value);
      if (!p) return;
      this.loaded = p.id;
      this.steps = p.steps.map((r) => [...r]);
      this.num("[data-seq-bars]").value = String(p.bars);
      this.num("[data-seq-swing]").value = String(p.swing);
      this.outputs();
      this.draw();
      this.store.say(`Loaded ${p.name}`);
    });
    store.on("doc", () => this.list());
    this.list();
    this.outputs();
  }

  private num(sel: string): HTMLInputElement { return this.root.querySelector<HTMLInputElement>(sel)!; }

  private outputs(): void {
    setText(this.root.querySelector("[data-seq-bars-out]"), `${this.num("[data-seq-bars]").value} bar${this.num("[data-seq-bars]").value === "1" ? "" : "s"}`);
    setText(this.root.querySelector("[data-seq-swing-out]"), `${Number(this.num("[data-seq-swing]").value).toFixed(0)}%`);
  }

  private level(v: number): string { return v >= 127 ? "hi" : v <= 60 ? "lo" : "mid"; }

  private draw(): void {
    this.grid.innerHTML = ROWS.map((r, ri) => `<div class="fw-steps-row" data-row="${ri}"><span class="pr-seq-name">${r.label}</span>${this.steps[ri].map((v, s) => `<button type="button" class="fw-step" data-row="${ri}" data-step="${s}" aria-pressed="${v > 0}"${v > 0 ? ` data-vel="${this.level(v)}"` : ""} aria-label="${r.label}, step ${s + 1}${v > 0 ? `, velocity ${v}` : ""}"></button>`).join("")}</div>`).join("");
  }

  private list(): void {
    const ps = this.store.doc.patterns;
    const sig = ps.map((p) => p.id + p.name).join("|") + this.loaded;
    if (this.saved.dataset.sig === sig) return;
    this.saved.dataset.sig = sig;
    this.saved.replaceChildren(new Option("Patterns in this session", ""), ...ps.map((p) => new Option(p.name, p.id, false, p.id === this.loaded)));
  }

  current(): Pattern {
    const prev = this.store.doc.patterns.find((p) => p.id === this.loaded);
    return {
      id: this.loaded || `pat-${this.store.nextId()}`,
      name: prev?.name ?? `Pattern ${this.store.doc.patterns.length + 1}`,
      rows: ROWS.map((r) => r.id),
      steps: this.steps.map((r) => [...r]),
      bars: Math.min(4, Math.max(1, Math.round(Number(this.num("[data-seq-bars]").value)))),
      swing: Math.min(75, Math.max(50, Number(this.num("[data-seq-swing]").value))),
    };
  }

  private click(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLButtonElement>(".fw-step");
    if (cell) {
      const r = Number(cell.dataset.row), s = Number(cell.dataset.step);
      const v = this.steps[r][s];
      this.steps[r][s] = e.shiftKey && v > 0 ? LEVELS[(LEVELS.indexOf(v) + 1) % LEVELS.length] ?? 100 : v > 0 ? 0 : 100;
      const now = this.steps[r][s];
      cell.setAttribute("aria-pressed", String(now > 0));
      if (now > 0) cell.dataset.vel = this.level(now); else delete cell.dataset.vel;
      cell.setAttribute("aria-label", `${ROWS[r].label}, step ${s + 1}${now > 0 ? `, velocity ${now}` : ""}`);
      if (now > 0) void this.player.hear(renderOne(r, now));
      return;
    }
    const act = target.closest<HTMLElement>("[data-seq-act]")?.dataset.seqAct;
    if (!act) return;
    if (act === "clear") { this.steps = blank(); this.draw(); return; }
    const lit = this.steps.some((r) => r.some((v) => v > 0));
    if ((act === "hear" || act === "place" || act === "save") && !lit) { this.store.say("Light at least one step first"); return; }
    if (act === "hear") { void this.player.hear(renderPattern(this.current())); this.store.say("Playing the pattern, nothing added"); return; }
    if (act === "place") {
      const p = this.current();
      const id = `pat-${this.store.nextId()}`;
      const n = items.size;
      patternItem({ id, name: `${p.name} ${n}` }, renderPattern(p));
      this.place(id, this.store.snapBeat(this.player.position));
      return;
    }
    if (act === "save") {
      const p = this.current();
      const ps = this.store.doc.patterns;
      const at = ps.findIndex((q) => q.id === p.id);
      if (at >= 0) ps[at] = p; else ps.push(p);
      this.loaded = p.id;
      this.store.commit(`Save ${p.name}`);
      this.saved.dataset.sig = "";
      this.list();
      this.store.say(`${p.name} saved in the session`);
      return;
    }
    if (act === "delete") {
      const id = this.saved.value || this.loaded;
      const ps = this.store.doc.patterns;
      if (!id || !ps.some((q) => q.id === id)) return;
      this.store.doc.patterns = ps.filter((q) => q.id !== id);
      if (this.loaded === id) this.loaded = "";
      this.store.commit("Delete a pattern");
      this.saved.dataset.sig = "";
      this.list();
    }
  }
}

function renderOne(row: number, v: number): AudioBuffer {
  const steps = blank();
  steps[row][0] = v;
  return renderPattern({ id: "", name: "", rows: [], steps, bars: 1, swing: 50 });
}

export class Mixer {
  private strips: HTMLElement;
  private shape = "";
  private master: HTMLElement;
  private hold = new Map<number, number>();

  constructor(private root: HTMLElement, private store: Store, private player: Player) {
    this.strips = root.querySelector(".fw-mixer-strips")!;
    this.master = root.querySelector('.fw-strip[data-kind="master"]')!;
    this.master.addEventListener("input", (e) => this.masterInput(e));
    this.master.addEventListener("change", () => this.store.commit("Master level"));
    this.strips.addEventListener("input", (e) => this.input(e));
    this.strips.addEventListener("change", (e) => this.change(e));
    this.strips.addEventListener("click", (e) => this.click(e));
    store.on("doc", () => this.render());
    store.on("live", () => this.render());
    store.on("sel", () => this.render());
  }

  private strip(t: Track): string {
    return `<div class="fw-strip" data-kind="track" data-id="${t.id}"><div class="fw-strip-name" translate="no"></div><span class="fw-strip-kind">Track</span><input class="fw-strip-pan" type="range" min="-1" max="1" step="0.01" data-default="0" aria-label="Pan" value="${t.pan}"><div class="fw-strip-meter" aria-hidden="true"><div class="fw-out-track"><div class="fw-out-bar"></div></div></div><input class="fw-strip-fader" type="range" min="-60" max="12" step="0.1" data-default="0" aria-label="Volume"><output class="fw-strip-db"></output><div class="fw-strip-buttons"><button type="button" class="fw-strip-mute fw-icon-btn" aria-pressed="false" aria-label="Mute" title="Mute">M</button><button type="button" class="fw-strip-solo fw-icon-btn" aria-pressed="false" aria-label="Solo" title="Solo">S</button></div></div>`;
  }

  render(): void {
    const doc = this.store.doc;
    const shape = doc.tracks.map((t) => t.id).join(",");
    if (shape !== this.shape) {
      this.shape = shape;
      this.strips.innerHTML = doc.tracks.map((t) => this.strip(t)).join("");
      for (const pan of this.strips.querySelectorAll<HTMLInputElement>(".fw-strip-pan")) knobify(pan);
    }
    for (const t of doc.tracks) {
      const s = this.strips.querySelector<HTMLElement>(`.fw-strip[data-id="${t.id}"]`);
      if (!s) continue;
      s.style.setProperty("--fw-strip-color", `var(${t.color})`);
      setText(s.querySelector(".fw-strip-name"), t.name);
      const f = s.querySelector<HTMLInputElement>(".fw-strip-fader")!;
      const pan = s.querySelector<HTMLInputElement>(".fw-strip-pan")!;
      const auto = !!t.auto.vol?.length;
      if (document.activeElement !== f && Number(f.value) !== t.vol) f.value = String(t.vol);
      if (document.activeElement !== pan && Number(pan.value) !== t.pan) { pan.value = String(t.pan); pan.dispatchEvent(new Event("input")); }
      f.disabled = auto;
      pan.disabled = !!t.auto.pan?.length;
      setText(s.querySelector(".fw-strip-db"), auto ? "Auto" : `${t.vol > 0 ? "+" : ""}${t.vol.toFixed(1)} dB`);
      s.querySelector(".fw-strip-mute")!.setAttribute("aria-pressed", String(t.mute));
      s.querySelector(".fw-strip-solo")!.setAttribute("aria-pressed", String(t.solo));
    }
    const m = this.master;
    const mf = m.querySelector<HTMLInputElement>(".fw-strip-fader")!;
    const cf = m.querySelector<HTMLInputElement>("[data-ceiling]")!;
    if (document.activeElement !== mf) mf.value = String(doc.master.gainDb);
    if (document.activeElement !== cf) cf.value = String(doc.master.ceilingDb);
    setText(m.querySelector(".fw-strip-db"), `${doc.master.gainDb > 0 ? "+" : ""}${doc.master.gainDb.toFixed(1)} dB`);
    setText(m.querySelector("[data-ceiling-out]"), `Ceiling ${doc.master.ceilingDb.toFixed(1)} dB`);
  }

  private find(e: Event): { t: Track; el: HTMLElement } | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".fw-strip");
    const t = el ? this.store.doc.tracks.find((x) => x.id === Number(el.dataset.id)) : undefined;
    return el && t ? { t, el } : null;
  }

  private input(e: Event): void {
    const f = this.find(e);
    if (!f) return;
    const tgt = e.target as HTMLInputElement;
    if (tgt.classList.contains("fw-strip-fader")) f.t.vol = Number(tgt.value);
    if (tgt.classList.contains("fw-strip-pan")) f.t.pan = Number(tgt.value);
    this.store.emit("live");
  }

  private change(e: Event): void {
    const f = this.find(e);
    if (!f) return;
    const tgt = e.target as HTMLElement;
    this.store.commit(`${tgt.classList.contains("fw-strip-pan") ? "Pan" : "Volume"} of ${f.t.name}`);
  }

  private click(e: MouseEvent): void {
    const f = this.find(e);
    if (!f) return;
    const b = (e.target as HTMLElement).closest("button");
    if (b?.classList.contains("fw-strip-mute")) { f.t.mute = !f.t.mute; this.store.commit(`${f.t.mute ? "Mute" : "Unmute"} ${f.t.name}`); }
    else if (b?.classList.contains("fw-strip-solo")) { f.t.solo = !f.t.solo; this.store.commit(`${f.t.solo ? "Solo" : "Unsolo"} ${f.t.name}`); }
    else this.store.select(f.t.id, null);
  }

  private masterInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains("fw-strip-fader")) this.store.doc.master.gainDb = Number(t.value);
    if (t.hasAttribute("data-ceiling")) this.store.doc.master.ceilingDb = Number(t.value);
    this.store.emit("live");
  }

  frame(): void {
    const dbBar = (v: number): number => (v > 0.0005 ? Math.max(0, Math.min(1, (20 * Math.log10(v) + 60) / 60)) : 0);
    for (const t of this.store.doc.tracks) {
      const bar = this.strips.querySelector<HTMLElement>(`.fw-strip[data-id="${t.id}"] .fw-out-bar`);
      if (!bar) continue;
      const lv = this.player.playing ? this.player.trackLevel(t.id) : 0;
      const h = Math.max(lv, (this.hold.get(t.id) ?? 0) * 0.88);
      this.hold.set(t.id, h);
      bar.style.transform = `scaleX(${dbBar(h)})`;
    }
  }

  setLoudness(text: string): void { setText(this.master.querySelector(".fw-strip-lufs"), text); }
}

export class Markers {
  private list: HTMLElement;
  private shape = "";

  constructor(private root: HTMLElement, private store: Store, private player: Player, private seek: (beat: number) => void) {
    this.list = root.querySelector(".fw-labels-list")!;
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.change(e));
    store.on("doc", () => this.render());
    store.on("live", () => this.render());
    this.render();
  }

  addAt(beat: number): void {
    const doc = this.store.doc;
    const n = doc.markers.length + 1;
    doc.markers.push({ id: this.store.nextId(), beat: this.store.snapBeat(beat), name: `Marker ${n}`, color: MARKER_COLORS[n % MARKER_COLORS.length], comment: "" });
    doc.markers.sort((a, b) => a.beat - b.beat);
    this.store.commit("Add a marker");
    this.store.say(`Marker ${n} at ${fmtBars(beat)}`);
  }

  private row(): HTMLElement {
    const r = document.createElement("div");
    r.className = "fw-label-row";
    r.setAttribute("role", "listitem");
    r.dataset.kind = "marker";
    r.innerHTML = `<button type="button" class="fw-label-num" title="Go to this marker"></button><button type="button" class="fw-label-time" title="Go to this marker"></button><input type="text" class="fw-label-text" translate="no"><select class="fw-label-color" aria-label="Colour">${MARKER_COLORS.map((c) => `<option value="${c}">${c[0].toUpperCase()}${c.slice(1)}</option>`).join("")}</select><input type="text" class="fw-label-comment" placeholder="Comment" maxlength="200" translate="no"><button type="button" class="fw-ibtn fw-label-remove">Delete</button>`;
    return r;
  }

  render(): void {
    const ms = this.store.doc.markers;
    const shape = ms.map((m) => m.id).join(",");
    if (shape !== this.shape) {
      this.shape = shape;
      this.list.replaceChildren(...ms.map(() => this.row()));
    }
    ms.forEach((m, i) => {
      const r = this.list.children[i] as HTMLElement;
      if (!r) return;
      r.dataset.id = String(m.id);
      const num = r.querySelector<HTMLElement>(".fw-label-num")!;
      setText(num, String(i + 1));
      num.style.setProperty("--fw-label-color", `var(--fw-color-${m.color})`);
      setText(r.querySelector(".fw-label-time"), `${fmtBars(m.beat)}  ${fmtClock(m.beat)}`);
      const text = r.querySelector<HTMLInputElement>(".fw-label-text")!;
      if (document.activeElement !== text && text.value !== m.name) text.value = m.name;
      const col = r.querySelector<HTMLSelectElement>(".fw-label-color")!;
      if (document.activeElement !== col && col.value !== m.color) col.value = m.color;
      const com = r.querySelector<HTMLInputElement>(".fw-label-comment")!;
      if (document.activeElement !== com && com.value !== m.comment) com.value = m.comment;
    });
    const reg = this.store.doc.region;
    setText(this.root.querySelector("[data-region-out]"), reg ? `Region ${fmtBars(reg[0])} to ${fmtBars(reg[1])}` : "No region");
  }

  private click(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    const act = el.closest<HTMLElement>("[data-mk-act]")?.dataset.mkAct;
    if (act === "add") { this.addAt(this.player.position); return; }
    if (act === "region") {
      const ms = this.store.doc.markers;
      const pos = this.player.position;
      const i = ms.map((m) => m.beat).filter((b) => b <= pos + 0.01).length - 1;
      const a = ms[Math.max(0, i)];
      if (!a) return;
      const next = ms.find((m) => m.beat > a.beat);
      this.store.doc.region = [a.beat, next ? next.beat : Math.max(a.beat + 4, this.store.endBeat())];
      this.store.commit(`Region from ${a.name}`);
      return;
    }
    if (act === "clear") { this.store.doc.region = null; this.store.commit("Clear the region"); return; }
    const row = el.closest<HTMLElement>(".fw-label-row");
    const m = row ? this.store.doc.markers.find((q) => q.id === Number(row.dataset.id)) : undefined;
    if (!row || !m) return;
    if (el.closest(".fw-label-remove")) { this.store.doc.markers = this.store.doc.markers.filter((q) => q !== m); this.store.commit("Delete a marker"); return; }
    if (el.closest(".fw-label-num, .fw-label-time")) this.seek(m.beat);
  }

  private change(e: Event): void {
    const el = e.target as HTMLInputElement;
    const row = el.closest<HTMLElement>(".fw-label-row");
    const m = row ? this.store.doc.markers.find((q) => q.id === Number(row.dataset.id)) : undefined;
    if (!m) return;
    if (el.classList.contains("fw-label-text")) m.name = el.value.trim() || m.name;
    if (el.classList.contains("fw-label-color")) m.color = el.value;
    if (el.classList.contains("fw-label-comment")) m.comment = el.value;
    this.store.commit(`Edit marker ${m.name}`);
  }
}

export function placeClip(store: Store, itemId: string, trackId: number | null, beat: number, namedTrack?: string): Clip | null {
  const it = items.get(itemId);
  if (!it) return null;
  let t = trackId != null ? store.doc.tracks.find((x) => x.id === trackId) ?? null : null;
  if (namedTrack) t = store.doc.tracks.find((x) => x.name === namedTrack) ?? null;
  if (!t) t = store.newTrack(namedTrack ?? it.name);
  const c: Clip = { id: store.nextId(), item: itemId, start: beat, offset: 0, length: it.beats, gainDb: 0 };
  t.clips.push(c);
  store.selTrack = t.id;
  store.selClip = c.id;
  store.commit(`Place ${it.name}`);
  return c;
}
