import { audible, buildChain, type Chain, closeChain, scheduleRange, sig } from "./audio";
import { dbToGain, RATE, SPB, type Store } from "./model";

export class Player {
  ctx: AudioContext | null = null;
  chain: Chain | null = null;
  playing = false;
  loop = false;
  position = 0;
  onStop: () => void = () => {};
  private t0 = 0;
  private from = 0;
  private end = 0;
  private loopA = 0;
  private loopB = 0;
  private looping = false;
  private sigAt = "";
  private restartTimer = 0;
  private audition: AudioBufferSourceNode | null = null;
  private fb = new Float32Array(1024);

  constructor(private store: Store) {
    store.on("doc", () => this.docChanged());
    store.on("live", () => this.applyLive());
  }

  ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: RATE });
    return this.ctx;
  }

  async play(from: number): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    this.halt();
    const doc = this.store.doc;
    const chain = buildChain(ctx, doc, { live: true, master: true });
    this.chain = chain;
    const t0 = ctx.currentTime + 0.08;
    const reg = doc.region;
    this.looping = this.loop && !!reg && reg[1] - reg[0] > 0.5;
    const end = this.store.endBeat() + 0.0;
    if (this.looping && reg) {
      this.loopA = reg[0]; this.loopB = reg[1];
      const first = from >= reg[0] && from < reg[1] ? from : reg[0];
      scheduleRange(chain, doc, first, reg[1], t0);
      let t = t0 + (reg[1] - first) * SPB;
      for (let i = 0; i < 5; i++) { scheduleRange(chain, doc, reg[0], reg[1], t); t += (reg[1] - reg[0]) * SPB; }
      this.from = first;
      this.end = Infinity;
    } else {
      scheduleRange(chain, doc, from, end, t0);
      this.from = from;
      this.end = end;
    }
    this.t0 = t0;
    this.sigAt = sig(doc);
    this.playing = true;
  }

  halt(): void {
    window.clearTimeout(this.restartTimer);
    if (this.chain) { closeChain(this.chain); this.chain = null; }
    this.playing = false;
  }

  stop(): void {
    if (!this.playing) return;
    this.position = this.tick();
    this.halt();
    this.onStop();
  }

  tick(): number {
    if (!this.playing || !this.ctx) return this.position;
    const el = Math.max(0, this.ctx.currentTime - this.t0) / SPB;
    let pos: number;
    if (this.looping) {
      const first = this.loopB - this.from;
      pos = el < first ? this.from + el : this.loopA + ((el - first) % (this.loopB - this.loopA));
      if (el > first + (this.loopB - this.loopA) * 5.5) { this.position = this.loopA; this.halt(); this.onStop(); return this.position; }
    } else {
      pos = this.from + el;
      if (pos >= this.end) { this.position = this.end; this.halt(); this.onStop(); return this.position; }
    }
    this.position = pos;
    return pos;
  }

  private docChanged(): void {
    if (!this.playing) return;
    if (sig(this.store.doc) !== this.sigAt) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(() => { if (this.playing) void this.play(this.tick()); }, 120);
      return;
    }
    this.applyLive(true);
  }

  applyLive(final = false): void {
    const ch = this.chain;
    if (!ch || !this.ctx) return;
    const doc = this.store.doc;
    const on = audible(doc);
    ch.master.gain.value = dbToGain(doc.master.gainDb);
    ch.limiter.threshold.value = doc.master.ceilingDb - 0.3;
    for (const t of doc.tracks) {
      const tn = ch.tracks.get(t.id);
      if (!tn) continue;
      if (!t.auto.vol?.length) tn.vol.gain.value = dbToGain(t.vol);
      if (!t.auto.pan?.length) tn.pan.pan.value = t.pan;
      tn.mute.gain.value = on.has(t.id) ? 1 : 0;
      for (const f of t.fx) {
        const fn = tn.fx.find((x) => x.id === f.id);
        if (!fn) continue;
        const driven = Object.keys(fn.node.params).some((k) => t.auto[`${f.id}:${k}`]?.length);
        fn.node.bypass(f.bypass);
        if (!driven) fn.node.set({ ...f.v }, final);
      }
    }
  }

  levels(out: Float32Array): void {
    out[0] = out[1] = 0;
    const ch = this.chain;
    if (!ch) return;
    for (let i = 0; i < 2; i++) {
      const a = ch.meters[i];
      if (!a) continue;
      a.getFloatTimeDomainData(this.fb);
      let m = 0;
      for (let k = 0; k < this.fb.length; k++) { const v = Math.abs(this.fb[k]); if (v > m) m = v; }
      out[i] = m;
    }
  }

  trackLevel(id: number): number {
    const m = this.chain?.tracks.get(id)?.meter;
    if (!m) return 0;
    m.getFloatTimeDomainData(this.fb);
    let p = 0;
    for (let k = 0; k < this.fb.length; k++) { const v = Math.abs(this.fb[k]); if (v > p) p = v; }
    return p;
  }

  async hear(b: AudioBuffer): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    this.silence();
    const s = ctx.createBufferSource();
    s.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    s.connect(g).connect(ctx.destination);
    s.start();
    s.onended = () => { if (this.audition === s) this.audition = null; };
    this.audition = s;
  }

  silence(): void {
    if (this.audition) { try { this.audition.stop(); } catch {} this.audition = null; }
  }
}
