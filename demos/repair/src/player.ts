export type Side = "A" | "B";

export class AbPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analysers: AnalyserNode[] = [];
  private nodes: Array<{ src: AudioBufferSourceNode; gain: GainNode; side: Side }> = [];
  private buffers = new WeakMap<Float32Array, AudioBuffer>();
  private a: Float32Array | null = null;
  private b: Float32Array | null = null;
  private startCtx = 0;
  private startPos = 0;
  private endPos = 0;
  playing = false;
  loop = false;
  position = 0;
  side: Side = "B";
  matchDb = 0;
  onStop: () => void = () => {};

  constructor(private rate: number) {}

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ sampleRate: this.rate });
    const master = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    master.connect(ctx.destination);
    master.connect(splitter);
    for (let i = 0; i < 2; i++) {
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      splitter.connect(an, i);
      this.analysers.push(an);
    }
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  private bufferFor(x: Float32Array): AudioBuffer {
    let b = this.buffers.get(x);
    if (!b) {
      b = this.ensure().createBuffer(1, x.length, this.rate);
      b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(x, b);
    }
    return b;
  }

  private gainFor(side: Side): number {
    if (side !== this.side) return 0;
    return side === "B" ? Math.pow(10, this.matchDb / 20) : 1;
  }

  setBuffers(a: Float32Array, b: Float32Array): void {
    const changed = this.a !== a || this.b !== b;
    this.a = a;
    this.b = b;
    if (changed && this.playing) {
      const pos = this.now();
      void this.play(pos, this.loop ? this.endPos : null, this.startPos);
    }
  }

  setSide(side: Side): void {
    this.side = side;
    this.refresh();
  }

  setMatch(db: number): void {
    this.matchDb = db;
    this.refresh();
  }

  private refresh(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const n of this.nodes) n.gain.gain.setTargetAtTime(this.gainFor(n.side), t, 0.008);
  }

  async play(from: number, to: number | null, loopStart = from): Promise<void> {
    if (!this.a || !this.b) return;
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    this.halt();
    const dur = this.a.length / this.rate;
    const end = to !== null && to > from ? to : dur;
    if (from >= end - 0.01) from = 0;
    this.startPos = loopStart;
    this.endPos = end;
    this.startCtx = ctx.currentTime - (from - loopStart);
    for (const [x, side] of [[this.a, "A"], [this.b, "B"]] as Array<[Float32Array, Side]>) {
      const src = ctx.createBufferSource();
      src.buffer = this.bufferFor(x);
      const gain = ctx.createGain();
      gain.gain.value = this.gainFor(side);
      src.connect(gain).connect(this.master!);
      if (this.loop && to !== null) { src.loop = true; src.loopStart = loopStart; src.loopEnd = end; }
      src.start(0, from);
      this.nodes.push({ src, gain, side });
    }
    this.playing = true;
  }

  private halt(): void {
    for (const n of this.nodes) {
      try { n.src.stop(); } catch { void 0; }
      n.src.disconnect();
      n.gain.disconnect();
    }
    this.nodes = [];
  }

  stop(): void {
    if (!this.playing) return;
    this.position = this.now();
    this.halt();
    this.playing = false;
    this.onStop();
  }

  now(): number {
    if (!this.ctx || !this.playing) return this.position;
    let t = this.startPos + (this.ctx.currentTime - this.startCtx);
    if (this.nodes.some((n) => n.src.loop) && this.endPos > this.startPos) {
      const len = this.endPos - this.startPos;
      t = this.startPos + ((t - this.startPos) % len);
    }
    return t;
  }

  tick(): number {
    if (this.playing) {
      const t = this.now();
      if (!this.nodes.some((n) => n.src.loop) && t >= this.endPos) {
        this.position = this.endPos;
        this.halt();
        this.playing = false;
        this.onStop();
        return this.position;
      }
      this.position = t;
    }
    return this.position;
  }

  level(): number {
    if (!this.playing || !this.analysers.length) return 0;
    const buf = new Float32Array(1024);
    this.analysers[0].getFloatTimeDomainData(buf);
    let p = 0;
    for (let k = 0; k < buf.length; k++) p = Math.max(p, Math.abs(buf[k]));
    return p;
  }
}
