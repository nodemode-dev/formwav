import type { Bench } from "./bench";
import { mountIcons } from "./icons";
import { type ParamDef, STAGE_ORDER, STAGES, type StageDef } from "./stages";

function setText(el: Element, v: string): void {
  if (el.textContent !== v) el.textContent = v;
}

export function fmtParam(def: ParamDef, v: number): string {
  if (def.options) return def.options.find((o) => o[0] === v)?.[1] ?? String(v);
  const dec = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : 2;
  let t = v.toFixed(dec);
  if (def.id === "lp" && v >= 19000) return "Off";
  if (def.unit === "dB" && v > 0 && def.min < 0) t = `+${t}`;
  return def.unit ? `${t} ${def.unit}` : t;
}

const TARGETS: Array<[string, number, number]> = [["Podcast", -16, -1], ["Streaming", -14, -1], ["EBU R128", -23, -1]];

interface Card {
  def: StageDef;
  el: HTMLElement;
  note: HTMLElement;
  pwr: HTMLButtonElement;
  inputs: Map<string, { input: HTMLInputElement | HTMLSelectElement; out: HTMLElement | null; def: ParamDef }>;
  extra: HTMLElement | null;
}

export class Rack {
  private cards = new Map<string, Card>();

  constructor(private host: HTMLElement, private bench: Bench) {
    for (const id of STAGE_ORDER) this.cards.set(id, this.build(STAGES.find((s) => s.id === id)!));
    mountIcons(host);
  }

  private build(def: StageDef): Card {
    const el = document.createElement("section");
    el.className = "rp-card";
    el.dataset.stage = def.id;
    el.dataset.open = def.id === "denoise" ? "true" : "false";
    const head = document.createElement("div");
    head.className = "rp-card-head";
    const pwr = document.createElement("button");
    pwr.type = "button";
    pwr.className = "rp-pwr";
    pwr.title = "Turn this stage on or bypass it";
    pwr.setAttribute("aria-label", `${def.title} on or bypassed`);
    pwr.innerHTML = '<span class="icon" data-icon="power" data-size="14"></span>';
    const title = document.createElement("button");
    title.type = "button";
    title.className = "rp-card-title";
    const name = document.createElement("span");
    name.className = "rp-card-name";
    name.textContent = def.title;
    const note = document.createElement("span");
    note.className = "rp-card-note";
    title.append(name, note);
    const chev = document.createElement("span");
    chev.className = "icon rp-chev";
    chev.dataset.icon = "chevron";
    chev.dataset.size = "14";
    head.append(pwr, title, chev);
    const body = document.createElement("div");
    body.className = "rp-card-body";
    const blurb = document.createElement("p");
    blurb.className = "rp-card-blurb";
    blurb.textContent = def.blurb;
    body.append(blurb);
    const inputs: Card["inputs"] = new Map();
    for (const p of def.params) {
      const row = document.createElement("div");
      row.className = "rp-prow";
      const label = document.createElement("span");
      label.className = "dm-fx-label";
      label.textContent = p.label;
      const out = document.createElement("span");
      out.className = "dm-fx-out";
      if (p.options) {
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", p.label);
        for (const [v, t] of p.options) sel.append(new Option(t, String(v)));
        sel.addEventListener("change", () => { this.bench.setParam(def.id, p.id, Number(sel.value)); this.bench.commit(`${def.title}: ${p.label}`); });
        row.append(label, sel);
        inputs.set(p.id, { input: sel, out: null, def: p });
      } else {
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = String(p.min); inp.max = String(p.max); inp.step = String(p.step);
        inp.setAttribute("aria-label", p.label);
        inp.addEventListener("input", () => { this.bench.setParam(def.id, p.id, Number(inp.value)); });
        inp.addEventListener("change", () => this.bench.commit(`${def.title}: ${p.label} ${fmtParam(p, Number(inp.value))}`));
        row.append(label, out, inp);
        inputs.set(p.id, { input: inp, out, def: p });
      }
      body.append(row);
    }
    let extra: HTMLElement | null = null;
    if (def.id === "master") {
      extra = document.createElement("div");
      extra.className = "rp-chips";
      for (const [label, target, ceil] of TARGETS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fw-mode";
        b.dataset.target = String(target);
        b.textContent = `${label} ${target}`;
        b.addEventListener("click", () => {
          this.bench.setParam("master", "target", target);
          this.bench.setParam("master", "ceil", ceil);
          this.bench.commit(`Loudness target ${target} LUFS`);
        });
        extra.append(b);
      }
      body.append(extra);
    }
    if (def.id === "heal") {
      extra = document.createElement("div");
      extra.className = "rp-heal";
      const t = document.createElement("span");
      t.className = "rp-heal-text";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fw-mode";
      b.textContent = "Clear boxes";
      b.addEventListener("click", () => this.bench.clearHeal());
      extra.append(t, b);
      body.append(extra);
    }
    pwr.addEventListener("click", () => this.bench.toggle(def.id));
    title.addEventListener("click", () => { el.dataset.open = el.dataset.open === "true" ? "false" : "true"; });
    el.append(head, body);
    this.host.append(el);
    return { def, el, note, pwr, inputs, extra };
  }

  sync(): void {
    if (!this.bench.currentId) return;
    const chain = this.bench.chain;
    const notes = this.bench.result?.notes;
    for (const [id, c] of this.cards) {
      const st = chain[id as keyof typeof chain];
      c.el.dataset.on = String(st.on);
      c.pwr.setAttribute("aria-pressed", String(st.on));
      setText(c.note, notes ? (st.on ? notes[id as keyof typeof notes] ?? "" : "Bypassed") : "");
      for (const [pid, w] of c.inputs) {
        const v = st.p[pid];
        if (document.activeElement !== w.input && w.input.value !== String(v)) w.input.value = String(v);
        if (w.out) setText(w.out, fmtParam(w.def, v));
      }
      if (id === "master" && c.extra) {
        for (const b of c.extra.querySelectorAll<HTMLElement>("[data-target]")) b.setAttribute("aria-pressed", String(Number(b.dataset.target) === st.p.target));
      }
      if (id === "heal" && c.extra) {
        const n = st.boxes.length;
        setText(c.extra.firstElementChild!, n ? `${n} box${n === 1 ? "" : "es"} healed. Make another with the Heal box tool.` : "Choose the Heal box tool, drag a box over a pop or a stray sound on a spectrogram, then press Heal selection.");
        (c.extra.lastElementChild as HTMLButtonElement).disabled = n === 0;
      }
    }
  }
}
