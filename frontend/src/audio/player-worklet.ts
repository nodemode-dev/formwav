declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

interface CoreExports {
  memory: WebAssembly.Memory;
  fw_alloc(bytes: number): number;
  fw_free(ptr: number, bytes: number): void;
  fw_player_new(): number;
  fw_load_wav(player: number, id: number, ptr: number, len: number): number;
  fw_source_alloc(player: number, id: number, rate: number, channels: number, frames: number): number;
  fw_source_write(player: number, id: number, offset: number, ptr: number, len: number): number;
  fw_clear_clips(player: number): void;
  fw_add_clip(player: number, source: number, start: number, sourceIn: number, length: number, gain: number, pan: number, fadeIn: number, fadeOut: number, fadeShape: number, bus: number, track: number, gainEnv: number, panEnv: number): void;
  fw_clear_envelopes(player: number): void;
  fw_set_master_db(player: number, db: number): void;
  fw_add_envelope(player: number, points: number, count: number, db: number): number;
  fw_free(ptr: number, bytes: number): void;
  fw_clear_buses(player: number): void;
  fw_add_bus(player: number, id: number, gain: number, pan: number): void;
  fw_set_rate(player: number, rate: number): void;
  fw_add_clip_fx(player: number, kind: number, freq: number, gainDb: number, q: number): number;
  fw_clear_master_fx(player: number): void;
  fw_add_master_fx(player: number, kind: number, freq: number, gainDb: number, q: number): number;
  fw_add_master_stage(player: number, kind: number, a: number, b: number, c: number, d: number, e: number): number;
  fw_add_bus_stage(player: number, kind: number, a: number, b: number, c: number, d: number, e: number): number;
  fw_take_peaks(player: number, out: number): void;
  fw_take_track_peaks(player: number, out: number, maxTracks: number): number;
  fw_take_bus_peaks(player: number, out: number, maxBuses: number): number;
  fw_loudness_reset(player: number, rate: number): void;
  fw_loudness(player: number, out: number): void;
  fw_seek(player: number, position: number): void;
  fw_set_loop(player: number, start: number, end: number): void;
  fw_position(player: number): number;
  fw_render(player: number, left: number, right: number, frames: number): void;
}

export interface WorkletClip {
  source: number;
  start: number;
  sourceIn: number;
  length: number;
  gain: number;
  pan: number;
  fadeIn: number;
  fadeOut: number;
  fadeShape: number;
  bus: number;
  track: number;
  /** Track volume automation as flat [time, dB, time, dB, ...]; replaces the track fader. */
  gainPoints?: number[];
  /** Track pan automation as flat [time, pan, ...]; replaces the track pan. */
  panPoints?: number[];
  /** The track's realtime filters as flat [kind, freq, gainDb, q, ...] (core codes, fx.rs). */
  fx?: number[];
}

export interface WorkletBus {
  id: number;
  gain: number;
  pan: number;
  /** The bus's chain as flat [kind, a, b, c, d, e, ...] (core fx.rs Stage::design); a track's own bus carries its compressor. */
  stages?: number[];
}

export type WorkletMessage =
  | { type: "init"; bytes: ArrayBuffer }
  | { type: "load"; id: number; bytes: ArrayBuffer }
  | { type: "alloc"; id: number; rate: number; channels: number; frames: number }
  | { type: "write"; id: number; offset: number; data: Float32Array }
  | { type: "clips"; clips: WorkletClip[]; end: number; buses: WorkletBus[]; masterDb: number; masterFx?: number[]; timeTrack?: number[] }
  | { type: "play" }
  | { type: "speed"; value: number }
  | { type: "stop" }
  | { type: "seek"; position: number }
  | { type: "loop"; start: number; end: number };

export type WorkletReply =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "loaded"; id: number; frames: number }
  | { type: "position"; position: number; playing: boolean; peakLeft: number; peakRight: number; trackPeaks: number[]; loudness: number[]; busPeaks: number[] }
  | { type: "ended"; position: number };

/** The AudioWorkletGlobalScope's context sample rate. */
declare const sampleRate: number;
const MAX_FRAMES = 4096;
const MAX_METERED_TRACKS = 256;
const MAX_METERED_BUSES = 64;
const REPORT_EVERY = 8;

class PlayerProcessor extends AudioWorkletProcessor {
  private core: CoreExports | null = null;
  private player = 0;
  private left = 0;
  private right = 0;
  private playing = false;
  private end = 0;
  // Play-at-speed (Audacity's varispeed, pitch following speed): a read buffer the core refills 128 samples at a
  // time, read at `speed` samples per output sample with linear interpolation; unused at 1x.
  private speed = 1;
  // Audacity's time track: [at, speed, at, speed, ...] in session samples, linear between points, held outside them.
  private curve: number[] | null = null;
  private curveAt(position: number): number {
    const c = this.curve;
    if (!c) return 1;
    if (position <= c[0]) return c[1];
    for (let i = 2; i < c.length; i += 2) {
      if (position <= c[i]) return c[i - 1] + ((c[i + 1] - c[i - 1]) * (position - c[i - 2])) / Math.max(1, c[i] - c[i - 2]);
    }
    return c[c.length - 1];
  }
  private readPos = 0;
  private bufLen = 0;
  private bufL = new Float32Array(1024);
  private bufR = new Float32Array(1024);
  private quanta = 0;
  private peaks = 0;
  private views: { buffer: ArrayBuffer; frames: number; left: Float32Array; right: Float32Array } | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      try {
        this.handle(e.data);
      } catch (err) {
        this.reply({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    };
  }

  private reply(message: WorkletReply): void {
    this.port.postMessage(message);
  }

  private report(): void {
    const core = this.core;
    if (!core) return;
    core.fw_take_peaks(this.player, this.peaks);
    const tracks = core.fw_take_track_peaks(this.player, this.peaks + 8, MAX_METERED_TRACKS);
    const loudnessAt = this.peaks + 8 + MAX_METERED_TRACKS * 8;
    core.fw_loudness(this.player, loudnessAt);
    const busesAt = loudnessAt + 12;
    const buses = core.fw_take_bus_peaks(this.player, busesAt, MAX_METERED_BUSES);
    const peaks = new Float32Array(core.memory.buffer, this.peaks, 2 + tracks * 2);
    this.reply({
      type: "position",
      position: core.fw_position(this.player),
      playing: this.playing,
      peakLeft: peaks[0],
      peakRight: peaks[1],
      trackPeaks: Array.from(peaks.subarray(2)),
      loudness: Array.from(new Float32Array(core.memory.buffer, loudnessAt, 3)),
      busPeaks: Array.from(new Float32Array(core.memory.buffer, busesAt, buses * 2)),
    });
  }

  private handle(msg: WorkletMessage): void {
    if (msg.type === "init") {
      const core = new WebAssembly.Instance(new WebAssembly.Module(msg.bytes), {}).exports as unknown as CoreExports;
      this.core = core;
      this.player = core.fw_player_new();
      // The worklet scope's own sampleRate: filters are designed at the rate that actually plays.
      core.fw_set_rate(this.player, sampleRate);
      this.left = core.fw_alloc(MAX_FRAMES * 4);
      this.right = core.fw_alloc(MAX_FRAMES * 4);
      this.peaks = core.fw_alloc(8 + MAX_METERED_TRACKS * 8 + 12 + MAX_METERED_BUSES * 8);
      this.reply({ type: "ready" });
      return;
    }
    const core = this.core;
    if (!core) return;
    switch (msg.type) {
      case "load": {
        const bytes = new Uint8Array(msg.bytes);
        const ptr = core.fw_alloc(bytes.length);
        new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
        const frames = core.fw_load_wav(this.player, msg.id, ptr, bytes.length);
        core.fw_free(ptr, bytes.length);
        this.reply({ type: "loaded", id: msg.id, frames });
        break;
      }
      case "alloc": {
        const frames = core.fw_source_alloc(this.player, msg.id, msg.rate, msg.channels, msg.frames);
        this.reply({ type: "loaded", id: msg.id, frames });
        break;
      }
      case "write": {
        const bytes = msg.data.length * 4;
        const ptr = core.fw_alloc(bytes);
        new Float32Array(core.memory.buffer, ptr, msg.data.length).set(msg.data);
        core.fw_source_write(this.player, msg.id, msg.offset, ptr, msg.data.length);
        core.fw_free(ptr, bytes);
        break;
      }
      case "clips": {
        const next = msg.timeTrack && msg.timeTrack.length >= 2 ? msg.timeTrack : null;
        if ((next === null) !== (this.curve === null)) {
          this.readPos = 0;
          this.bufLen = 0;
        }
        this.curve = next;
        core.fw_clear_clips(this.player);
        core.fw_clear_envelopes(this.player);
        const envelope = (flat: number[] | undefined, db: boolean): number => {
          if (!flat || flat.length < 2) return 0;
          const bytes = flat.length * 8;
          const ptr = core.fw_alloc(bytes);
          new Float64Array(core.memory.buffer, ptr, flat.length).set(flat);
          const id = core.fw_add_envelope(this.player, ptr, flat.length / 2, db ? 1 : 0);
          core.fw_free(ptr, bytes);
          return id;
        };
        for (const c of msg.clips) {
          const gainEnv = envelope(c.gainPoints, true);
          const panEnv = envelope(c.panPoints, false);
          core.fw_add_clip(this.player, c.source, c.start, c.sourceIn, c.length, c.gain, c.pan, c.fadeIn, c.fadeOut, c.fadeShape, c.bus, c.track, gainEnv, panEnv);
          if (c.fx) for (let k = 0; k + 3 < c.fx.length; k += 4) core.fw_add_clip_fx(this.player, c.fx[k], c.fx[k + 1], c.fx[k + 2], c.fx[k + 3]);
        }
        core.fw_clear_buses(this.player);
        for (const b of msg.buses) {
          core.fw_add_bus(this.player, b.id, b.gain, b.pan);
          const st = b.stages ?? [];
          for (let k = 0; k + 5 < st.length; k += 6) core.fw_add_bus_stage(this.player, st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
        }
        core.fw_clear_master_fx(this.player);
        const mfx = msg.masterFx ?? [];
        for (let k = 0; k + 5 < mfx.length; k += 6) core.fw_add_master_stage(this.player, mfx[k], mfx[k + 1], mfx[k + 2], mfx[k + 3], mfx[k + 4], mfx[k + 5]);
        core.fw_set_master_db(this.player, msg.masterDb);
        this.end = msg.end;
        break;
      }
      case "seek":
        core.fw_seek(this.player, msg.position);
        this.readPos = 0;
        this.bufLen = 0;
        this.report();
        break;
      case "loop":
        core.fw_set_loop(this.player, msg.start, msg.end);
        break;
      case "play":
        this.playing = true;
        this.readPos = 0;
        this.bufLen = 0;
        if (this.core) this.core.fw_loudness_reset(this.player, sampleRate);
        break;
      case "speed": {
        const value = Math.min(4, Math.max(0.25, Number(msg.value) || 1));
        if (value !== this.speed) {
          this.speed = value;
          this.readPos = 0;
          this.bufLen = 0;
        }
        break;
      }
      case "stop":
        this.playing = false;
        this.report();
        break;
    }
  }

  private chunk: { buffer: ArrayBuffer; left: Float32Array; right: Float32Array } | null = null;

  /** Varispeed: each output sample interpolated at the read position, which advances by `speed`; the buffer keeps
   * the sample before the read position across refills, so blocks join without a click. */
  private renderAtSpeed(core: CoreExports, out: Float32Array[], frames: number, step: number): void {
    const left = out[0];
    const right = out[1];
    for (let i = 0; i < frames; i++) {
      while (this.readPos + 1 >= this.bufLen) this.refill(core);
      const k = Math.floor(this.readPos);
      const a = this.readPos - k;
      left[i] = this.bufL[k] + (this.bufL[k + 1] - this.bufL[k]) * a;
      if (right) right[i] = this.bufR[k] + (this.bufR[k + 1] - this.bufR[k]) * a;
      this.readPos += step;
    }
  }

  private refill(core: CoreExports): void {
    const keep = Math.floor(this.readPos);
    if (keep > 0) {
      this.bufL.copyWithin(0, keep, this.bufLen);
      this.bufR.copyWithin(0, keep, this.bufLen);
      this.bufLen -= keep;
      this.readPos -= keep;
    }
    const n = 128;
    core.fw_render(this.player, this.left, this.right, n);
    const buffer = core.memory.buffer;
    let chunk = this.chunk;
    if (!chunk || chunk.buffer !== buffer) {
      chunk = { buffer, left: new Float32Array(buffer, this.left, n), right: new Float32Array(buffer, this.right, n) };
      this.chunk = chunk;
    }
    this.bufL.set(chunk.left, this.bufLen);
    this.bufR.set(chunk.right, this.bufLen);
    this.bufLen += n;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const core = this.core;
    const out = outputs[0];
    if (!core || !this.playing || !out || out.length === 0) return true;
    const frames = Math.min(out[0].length, MAX_FRAMES);
    if (this.speed !== 1 || this.curve) {
      const step = this.curve ? Math.min(4, Math.max(0.25, this.speed * this.curveAt(core.fw_position(this.player)))) : this.speed;
      this.renderAtSpeed(core, out, frames, step);
    } else {
      core.fw_render(this.player, this.left, this.right, frames);
      const buffer = core.memory.buffer;
      let views = this.views;
      if (!views || views.buffer !== buffer || views.frames !== frames) {
        views = { buffer, frames, left: new Float32Array(buffer, this.left, frames), right: new Float32Array(buffer, this.right, frames) };
        this.views = views;
      }
      out[0].set(views.left);
      if (out[1]) out[1].set(views.right);
    }
    this.quanta++;
    const position = core.fw_position(this.player);
    if (this.end > 0 && position >= this.end) {
      this.report();
      this.playing = false;
      this.reply({ type: "ended", position });
    } else if (this.quanta % REPORT_EVERY === 0) {
      this.report();
    }
    return true;
  }
}

registerProcessor("formwav-player", PlayerProcessor);
