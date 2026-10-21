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
  fw_source_alloc_window(player: number, id: number, rate: number, channels: number, frames: number, window: number): number;
  fw_source_write(player: number, id: number, offset: number, ptr: number, len: number): number;
  fw_clear_clips(player: number): void;
  fw_add_clip(player: number, source: number, start: number, sourceIn: number, length: number, gain: number, pan: number, fadeIn: number, fadeOut: number, fadeShape: number, bus: number, track: number, gainEnv: number, panEnv: number): void;
  fw_clear_envelopes(player: number): void;
  fw_set_master_db(player: number, db: number): void;
  fw_set_master_envelope?(player: number, id: number): void;
  fw_set_bus_out?(player: number, id: number, out: number): void;
  fw_add_envelope(player: number, points: number, count: number, db: number): number;
  fw_free(ptr: number, bytes: number): void;
  fw_clear_buses(player: number): void;
  fw_add_bus(player: number, id: number, gain: number, pan: number): void;
  fw_set_rate(player: number, rate: number): void;
  fw_add_clip_fx(player: number, kind: number, freq: number, gainDb: number, q: number): number;
  fw_add_clip_comp(player: number, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number, makeupDb: number): number;
  fw_add_clip_fx_auto(player: number, stage: number, param: number, envelope: number): number;
  fw_clear_master_fx(player: number): void;
  fw_add_master_fx(player: number, kind: number, freq: number, gainDb: number, q: number): number;
  fw_add_master_stage(player: number, kind: number, a: number, b: number, c: number, d: number, e: number): number;
  fw_add_bus_stage(player: number, kind: number, a: number, b: number, c: number, d: number, e: number): number;
  fw_add_master_processor(player: number, ptr: number, len: number): number;
  fw_add_bus_processor(player: number, ptr: number, len: number): number;
  fw_add_bus_fx_auto(player: number, stage: number, param: number, envelope: number): number;
  fw_set_pan_law(player: number, law: number): void;
  fw_take_reductions(player: number, out: number, max: number): number;
  fw_take_peaks(player: number, out: number): void;
  fw_set_places(player: number, ptr: number, count: number): void;
  fw_set_fold_51(player: number, on: number): void;
  fw_set_surround_format(player: number, format: number): void;
  fw_take_peaks_51(player: number, out: number): void;
  fw_set_surround_layout(player: number, id: number): void;
  fw_set_bus_places(player: number, ptr: number, count: number): void;
  fw_take_peaks_surround(player: number, out: number): number;
  fw_live_note(player: number, pitch: number, velocity: number): void;
  fw_live_patch(player: number, wave: number, attack: number, decay: number, sustain: number, release: number, gain: number, cutoff: number, resonance: number): void;
  fw_live_all_off(player: number): void;
  fw_live_instrument(player: number, kind: number, values: number, count: number): void;
  fw_live_sounding(player: number): number;
  fw_render_idle(player: number, left: number, right: number, frames: number): void;
  fw_take_correlation(player: number): number;
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
  /** Those filters' parameter automation (PT-19): stage, parameter (0 frequency, 1 gain, 2 Q), flat [time, value, ...]. */
  fxAuto?: { stage: number; param: number; points: number[] }[];
  /** PT-33: the clip's own compressor, [filters ahead of it, threshold dB, ratio, attack ms, release ms, makeup dB]. */
  comp?: number[];
}

export interface WorkletBus {
  id: number;
  gain: number;
  pan: number;
  /** S10: the id of the bus this one plays into (absent for the master). */
  out?: number;
  /** The bus's chain as flat [kind, a, b, c, d, e, ...] (core fx.rs Stage::design); a track's own bus carries its compressor. */
  stages?: number[];
  /** Its filters' automation, numbered by the stages above; points flat [time, value, ...]. */
  fxAuto?: { stage: number; param: number; points: number[] }[];
}

export type WorkletMessage =
  | { type: "init"; bytes: ArrayBuffer }
  | { type: "load"; id: number; bytes: ArrayBuffer }
  | { type: "alloc"; id: number; rate: number; channels: number; frames: number; window?: number }
  | { type: "stats" }
  | { type: "write"; id: number; offset: number; data: Float32Array }
  | { type: "clips"; clips: WorkletClip[]; end: number; buses: WorkletBus[]; masterDb: number; masterPoints?: number[]; masterFx?: number[]; processors?: string[]; panLaw?: number; timeTrack?: number[]; timeTrackLog?: boolean; places?: number[]; busPlaces?: number[]; fold?: boolean; surroundFormat?: number }
  | { type: "play" }
  | { type: "speed"; value: number }
  | { type: "rate-ratio"; value: number }
  | { type: "stop" }
  | { type: "seek"; position: number }
  | { type: "live-note"; pitch: number; velocity: number }
  | { type: "live-patch"; wave: number; attack: number; decay: number; sustain: number; release: number; gain: number; cutoff: number; resonance: number }
  | { type: "live-all-off" }
  | { type: "live-instrument"; kind: number; values: number[] }
  | { type: "loop"; start: number; end: number };

export type WorkletReply =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "loaded"; id: number; frames: number }
  | { type: "stats"; bytes: number }
  | { type: "position"; position: number; playing: boolean; peakLeft: number; peakRight: number; correlation?: number | null; trackPeaks: number[]; loudness: number[]; busPeaks: number[]; surroundPeaks?: number[]; reductions?: number[] }
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
  // Play-at-speed (varispeed, pitch following speed): a read buffer the core refills 128 samples at a
  // time, read at `speed` samples per output sample with linear interpolation; unused at 1x.
  private speed = 1;
  // AU-22: session samples per output sample when the output device runs at another rate
  private rateRatio = 1;
  // The time track: [at, speed, at, speed, ...] in session samples, linear between points, held outside them.
  private curve: number[] | null = null;
  // AU-36: between points the speed changes at a steady ratio (logarithmic) instead of a steady step (linear)
  private curveLog = false;
  private curveAt(position: number): number {
    const c = this.curve;
    if (!c) return 1;
    if (position <= c[0]) return c[1];
    for (let i = 2; i < c.length; i += 2) {
      if (position <= c[i]) {
        const f = (position - c[i - 2]) / Math.max(1, c[i] - c[i - 2]);
        return this.curveLog ? c[i - 1] * (c[i + 1] / c[i - 1]) ** f : c[i - 1] + (c[i + 1] - c[i - 1]) * f;
      }
    }
    return c[c.length - 1];
  }
  private readPos = 0;
  private bufLen = 0;
  private bufL = new Float32Array(1024);
  private bufR = new Float32Array(1024);
  private quanta = 0;
  private peaks = 0;
  /** PT-38, AA-11: whether the core folds its six-channel bus, and where the six peaks are read into. */
  private fold51 = false;
  private peaks51 = 0;
  /** Where each processor's gain reduction is read into, in the plan's order. */
  private reductions = 0;
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
    const correlation = core.fw_take_correlation(this.player);
    const tracks = core.fw_take_track_peaks(this.player, this.peaks + 8, MAX_METERED_TRACKS);
    const loudnessAt = this.peaks + 8 + MAX_METERED_TRACKS * 8;
    core.fw_loudness(this.player, loudnessAt);
    const busesAt = loudnessAt + 12;
    const buses = core.fw_take_bus_peaks(this.player, busesAt, MAX_METERED_BUSES);
    const reduced = Math.min(MAX_METERED_BUSES, core.fw_take_reductions(this.player, this.reductions, MAX_METERED_BUSES));
    const peaks = new Float32Array(core.memory.buffer, this.peaks, 2 + tracks * 2);
    this.reply({
      type: "position",
      position: core.fw_position(this.player),
      playing: this.playing,
      peakLeft: peaks[0],
      peakRight: peaks[1],
      correlation: Number.isNaN(correlation) ? null : correlation,
      trackPeaks: Array.from(peaks.subarray(2)),
      loudness: Array.from(new Float32Array(core.memory.buffer, loudnessAt, 3)),
      busPeaks: Array.from(new Float32Array(core.memory.buffer, busesAt, buses * 2)),
      ...(reduced ? { reductions: Array.from(new Float32Array(core.memory.buffer, this.reductions, reduced)) } : {}),
      ...(this.fold51 ? { surroundPeaks: Array.from(new Float32Array(core.memory.buffer, this.peaks51, core.fw_take_peaks_surround(this.player, this.peaks51))) } : {}),
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
      this.peaks51 = core.fw_alloc(64);
      this.reductions = core.fw_alloc(MAX_METERED_BUSES * 4);
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
        // AP-05: a file larger than memory is held as a window around the playhead
        const frames = msg.window ? core.fw_source_alloc_window(this.player, msg.id, msg.rate, msg.channels, msg.frames, msg.window) : core.fw_source_alloc(this.player, msg.id, msg.rate, msg.channels, msg.frames);
        this.reply({ type: "loaded", id: msg.id, frames });
        break;
      }
      case "stats":
        // AP-05: the core's memory, so a long file's bound can be measured
        this.reply({ type: "stats", bytes: core.memory.buffer.byteLength });
        break;
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
        this.curveLog = msg.timeTrackLog === true;
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
        const processor = (master: boolean, k: number): void => {
          const spec = msg.processors?.[k] ?? "";
          const len = Math.max(1, spec.length);
          const ptr = core.fw_alloc(len);
          new Uint8Array(core.memory.buffer, ptr, spec.length).set(Array.from(spec, (ch) => ch.charCodeAt(0) & 0x7f));
          if (master) core.fw_add_master_processor(this.player, ptr, spec.length);
          else core.fw_add_bus_processor(this.player, ptr, spec.length);
          core.fw_free(ptr, len);
        };
        for (const c of msg.clips) {
          const gainEnv = envelope(c.gainPoints, true);
          const panEnv = envelope(c.panPoints, false);
          core.fw_add_clip(this.player, c.source, c.start, c.sourceIn, c.length, c.gain, c.pan, c.fadeIn, c.fadeOut, c.fadeShape, c.bus, c.track, gainEnv, panEnv);
          // PT-33: the clip's own compressor goes in after `at` of its filters (its own EQ, ahead of its track's)
          const n = c.fx ? Math.floor(c.fx.length / 4) : 0;
          const at = c.comp && c.comp.length === 6 ? Math.min(n, Math.max(0, Math.floor(c.comp[0]))) : -1;
          for (let i = 0; i <= n; i++) {
            if (i === at && c.comp) core.fw_add_clip_comp(this.player, c.comp[1], c.comp[2], c.comp[3], c.comp[4], c.comp[5]);
            if (i < n && c.fx) core.fw_add_clip_fx(this.player, c.fx[4 * i], c.fx[4 * i + 1], c.fx[4 * i + 2], c.fx[4 * i + 3]);
          }
          for (const a of c.fxAuto ?? []) {
            const env = envelope(a.points, false);
            if (env) core.fw_add_clip_fx_auto(this.player, a.stage, a.param, env);
          }
        }
        core.fw_clear_buses(this.player);
        for (const b of msg.buses) {
          core.fw_add_bus(this.player, b.id, b.gain, b.pan);
          const st = b.stages ?? [];
          for (let k = 0; k + 5 < st.length; k += 6) {
            if (st[k] === 20) processor(false, st[k + 1]);
            else core.fw_add_bus_stage(this.player, st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
          }
          for (const a of b.fxAuto ?? []) {
            const env = envelope(a.points, false);
            if (env) core.fw_add_bus_fx_auto(this.player, a.stage, a.param, env);
          }
        }
        for (const b of msg.buses) if (b.out) core.fw_set_bus_out?.(this.player, b.id, b.out);
        core.fw_set_pan_law(this.player, msg.panLaw ?? 0);
        core.fw_clear_master_fx(this.player);
        const mfx = msg.masterFx ?? [];
        for (let k = 0; k + 5 < mfx.length; k += 6) {
          if (mfx[k] === 20) processor(true, mfx[k + 1]);
          else core.fw_add_master_stage(this.player, mfx[k], mfx[k + 1], mfx[k + 2], mfx[k + 3], mfx[k + 4], mfx[k + 5]);
        }
        core.fw_set_master_db(this.player, msg.masterDb);
        core.fw_set_master_envelope?.(this.player, envelope(msg.masterPoints, true));
        // PT-38, AA-11: the placements and the fold mode, after the master chain (the core copies it for the C and LFE
        // pair and the surrounds); a session not hearing its fold-down clears both
        const records = msg.fold && msg.places ? msg.places : [];
        const onBuses = msg.fold && msg.busPlaces ? msg.busPlaces : [];
        const placeBytes = Math.max(4, Math.max(records.length, onBuses.length) * 4);
        const placeAt = core.fw_alloc(placeBytes);
        new Float32Array(core.memory.buffer, placeAt, records.length).set(records);
        core.fw_set_surround_layout(this.player, Math.max(0, Math.min(255, msg.surroundFormat ?? 0)));
        core.fw_set_places(this.player, placeAt, records.length / 7);
        new Float32Array(core.memory.buffer, placeAt, onBuses.length).set(onBuses);
        core.fw_set_bus_places(this.player, placeAt, onBuses.length / 7);
        core.fw_free(placeAt, placeBytes);
        const folding = records.length > 0 || onBuses.length > 0;
        core.fw_set_fold_51(this.player, folding ? 1 : 0);
        this.fold51 = folding;
        this.end = msg.end;
        break;
      }
      case "live-note":
        // AU-37: a note on the live instrument (a MIDI input, the on-screen keys), heard playing or stopped
        core.fw_live_note(this.player, msg.pitch, msg.velocity);
        break;
      case "live-patch":
        core.fw_live_patch(this.player, msg.wave, msg.attack, msg.decay, msg.sustain, msg.release, msg.gain, msg.cutoff, msg.resonance);
        break;
      case "live-all-off":
        core.fw_live_all_off(this.player);
        break;
      case "live-instrument": {
        // S14: the live instrument as a note track's subtractive or drum synth
        const bytes = Math.max(4, msg.values.length * 4);
        const at = core.fw_alloc(bytes);
        new Float32Array(core.memory.buffer, at, msg.values.length).set(msg.values);
        core.fw_live_instrument(this.player, msg.kind, at, msg.values.length);
        core.fw_free(at, bytes);
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
      case "rate-ratio": {
        // AU-22: the output device runs at another rate than the session; session samples are read this many per
        // output sample, so the pitch stays true (48 kHz played at 44.1 kHz would otherwise be 8% flat)
        const value = Math.min(4, Math.max(0.25, Number(msg.value) || 1));
        if (value !== this.rateRatio) {
          this.rateRatio = value;
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
    // Above 2x a step can carry readPos past everything buffered; then all of it is spent and readPos, less the
    // buffered length, points into the chunk rendered next, which starts where the buffer ended. (Discarding
    // floor(readPos) whatever the buffer held drove bufLen negative and the processor threw, stalling playback.)
    const keep = Math.min(Math.floor(this.readPos), this.bufLen);
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
    if (core && !this.playing && out && out.length > 0 && core.fw_live_sounding(this.player) > 0) {
      // AU-37: the live instrument heard with the transport stopped (no clips, the position unmoved)
      const idle = Math.min(out[0].length, MAX_FRAMES);
      core.fw_render_idle(this.player, this.left, this.right, idle);
      out[0].set(new Float32Array(core.memory.buffer, this.left, idle));
      if (out[1]) out[1].set(new Float32Array(core.memory.buffer, this.right, idle));
      if (++this.quanta % REPORT_EVERY === 0) this.report();
      return true;
    }
    if (!core || !this.playing || !out || out.length === 0) return true;
    const frames = Math.min(out[0].length, MAX_FRAMES);
    const base = this.speed * this.rateRatio;
    if (base !== 1 || this.curve) {
      const step = this.curve ? Math.min(4, Math.max(0.25, base * this.curveAt(core.fw_position(this.player)))) : base;
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
