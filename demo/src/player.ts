import type { Store, Track } from "./state";

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private analysers: AnalyserNode[] = [];
  private fft: AnalyserNode | null = null;
  private nodes: Array<{ src: AudioBufferSourceNode; gain: GainNode; id: number }> = [];
  private cache = new WeakMap<object, AudioBuffer>();
  private startCtx = 0;
  private startPos = 0;
  private endPos = 0;
  playing = false;
  loop = false;
  position = 0;
  onStop: () => void = () => {};

  constructor(private store: Store) {}

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ sampleRate: this.store.rate });
    const master = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const fft = ctx.createAnalyser();
    fft.fftSize = 2048;
    fft.smoothingTimeConstant = 0.8;
    master.connect(ctx.destination);
    master.connect(splitter);
    master.connect(fft);
    for (let i = 0; i < 2; i++) {
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      splitter.connect(a, i);
      this.analysers.push(a);
    }
    this.ctx = ctx;
    this.master = master;
    this.splitter = splitter;
    this.fft = fft;
    return ctx;
  }

  private bufferFor(t: Track): AudioBuffer {
    const key = t.chans[0];
    let b = this.cache.get(key);
    if (!b) {
      const ctx = this.ensure();
      b = ctx.createBuffer(t.chans.length, t.chans[0].length, this.store.rate);
      t.chans.forEach((c, i) => b!.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      this.cache.set(key, b);
    }
    return b;
  }

  private audible(t: Track): boolean {
    const anySolo = this.store.tracks.some((x) => x.solo);
    return anySolo ? t.solo : !t.mute;
  }

  refreshGains(): void {
    if (!this.playing) return;
    for (const n of this.nodes) {
      const t = this.store.tracks.find((x) => x.id === n.id);
      n.gain.gain.value = t && this.audible(t) ? Math.pow(10, t.gain / 20) : 0;
    }
  }

  async play(from: number, to: number | null): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    this.halt();
    const dur = this.store.duration();
    const end = to !== null && to > from ? to : dur;
    if (from >= end - 0.01) from = to !== null ? from : 0;
    this.startPos = from;
    this.endPos = end;
    this.startCtx = ctx.currentTime;
    for (const t of this.store.tracks) {
      const src = ctx.createBufferSource();
      src.buffer = this.bufferFor(t);
      const gain = ctx.createGain();
      gain.gain.value = this.audible(t) ? Math.pow(10, t.gain / 20) : 0;
      src.connect(gain).connect(this.master!);
      if (this.loop && to !== null) {
        src.loop = true;
        src.loopStart = from;
        src.loopEnd = end;
      }
      src.start(0, from);
      this.nodes.push({ src, gain, id: t.id });
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
    if (this.loop && this.endPos > this.startPos && this.nodes.some((n) => n.src.loop)) {
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

  levels(out: Float32Array): void {
    const buf = new Float32Array(1024);
    for (let i = 0; i < 2; i++) {
      let p = 0;
      if (this.playing && this.analysers[i]) {
        this.analysers[i].getFloatTimeDomainData(buf);
        for (let k = 0; k < buf.length; k++) p = Math.max(p, Math.abs(buf[k]));
      }
      out[i] = p;
    }
  }

  spectrum(out: Float32Array): boolean {
    if (!this.playing || !this.fft) return false;
    this.fft.getFloatFrequencyData(out);
    return true;
  }
}
