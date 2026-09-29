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
  fw_clear_clips(player: number): void;
  fw_add_clip(player: number, source: number, start: number, sourceIn: number, length: number, gain: number, pan: number, fadeIn: number, fadeOut: number, fadeShape: number, bus: number, track: number, gainEnv: number, panEnv: number): void;
  fw_clear_envelopes(player: number): void;
  fw_add_envelope(player: number, points: number, count: number, db: number): number;
  fw_free(ptr: number, bytes: number): void;
  fw_clear_buses(player: number): void;
  fw_add_bus(player: number, id: number, gain: number, pan: number): void;
  fw_take_peaks(player: number, out: number): void;
  fw_take_track_peaks(player: number, out: number, maxTracks: number): number;
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
}

export interface WorkletBus {
  id: number;
  gain: number;
  pan: number;
}

export type WorkletMessage =
  | { type: "init"; bytes: ArrayBuffer }
  | { type: "load"; id: number; bytes: ArrayBuffer }
  | { type: "clips"; clips: WorkletClip[]; end: number; buses: WorkletBus[] }
  | { type: "play" }
  | { type: "stop" }
  | { type: "seek"; position: number }
  | { type: "loop"; start: number; end: number };

export type WorkletReply =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "loaded"; id: number; frames: number }
  | { type: "position"; position: number; playing: boolean; peakLeft: number; peakRight: number; trackPeaks: number[]; loudness: number[] }
  | { type: "ended"; position: number };

/** The AudioWorkletGlobalScope's context sample rate. */
declare const sampleRate: number;
const MAX_FRAMES = 4096;
const MAX_METERED_TRACKS = 256;
const REPORT_EVERY = 8;

class PlayerProcessor extends AudioWorkletProcessor {
  private core: CoreExports | null = null;
  private player = 0;
  private left = 0;
  private right = 0;
  private playing = false;
  private end = 0;
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
    const peaks = new Float32Array(core.memory.buffer, this.peaks, 2 + tracks * 2);
    this.reply({
      type: "position",
      position: core.fw_position(this.player),
      playing: this.playing,
      peakLeft: peaks[0],
      peakRight: peaks[1],
      trackPeaks: Array.from(peaks.subarray(2)),
      loudness: Array.from(new Float32Array(core.memory.buffer, loudnessAt, 3)),
    });
  }

  private handle(msg: WorkletMessage): void {
    if (msg.type === "init") {
      const core = new WebAssembly.Instance(new WebAssembly.Module(msg.bytes), {}).exports as unknown as CoreExports;
      this.core = core;
      this.player = core.fw_player_new();
      this.left = core.fw_alloc(MAX_FRAMES * 4);
      this.right = core.fw_alloc(MAX_FRAMES * 4);
      this.peaks = core.fw_alloc(8 + MAX_METERED_TRACKS * 8 + 12);
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
      case "clips": {
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
        }
        core.fw_clear_buses(this.player);
        for (const b of msg.buses) core.fw_add_bus(this.player, b.id, b.gain, b.pan);
        this.end = msg.end;
        break;
      }
      case "seek":
        core.fw_seek(this.player, msg.position);
        this.report();
        break;
      case "loop":
        core.fw_set_loop(this.player, msg.start, msg.end);
        break;
      case "play":
        this.playing = true;
        if (this.core) this.core.fw_loudness_reset(this.player, sampleRate);
        break;
      case "stop":
        this.playing = false;
        this.report();
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const core = this.core;
    const out = outputs[0];
    if (!core || !this.playing || !out || out.length === 0) return true;
    const frames = Math.min(out[0].length, MAX_FRAMES);
    core.fw_render(this.player, this.left, this.right, frames);
    const buffer = core.memory.buffer;
    let views = this.views;
    if (!views || views.buffer !== buffer || views.frames !== frames) {
      views = { buffer, frames, left: new Float32Array(buffer, this.left, frames), right: new Float32Array(buffer, this.right, frames) };
      this.views = views;
    }
    out[0].set(views.left);
    if (out[1]) out[1].set(views.right);
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
