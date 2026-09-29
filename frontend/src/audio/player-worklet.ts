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
  fw_add_clip(player: number, source: number, start: number, sourceIn: number, length: number, gain: number, pan: number, fadeIn: number, fadeOut: number, fadeShape: number): void;
  fw_seek(player: number, position: number): void;
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
}

export type WorkletMessage =
  | { type: "init"; bytes: ArrayBuffer }
  | { type: "load"; id: number; bytes: ArrayBuffer }
  | { type: "clips"; clips: WorkletClip[]; end: number }
  | { type: "play" }
  | { type: "stop" }
  | { type: "seek"; position: number };

export type WorkletReply =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "loaded"; id: number; frames: number }
  | { type: "position"; position: number; playing: boolean }
  | { type: "ended"; position: number };

const MAX_FRAMES = 4096;
const REPORT_EVERY = 8;

class PlayerProcessor extends AudioWorkletProcessor {
  private core: CoreExports | null = null;
  private player = 0;
  private left = 0;
  private right = 0;
  private playing = false;
  private end = 0;
  private quanta = 0;
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
    if (this.core) this.reply({ type: "position", position: this.core.fw_position(this.player), playing: this.playing });
  }

  private handle(msg: WorkletMessage): void {
    if (msg.type === "init") {
      const core = new WebAssembly.Instance(new WebAssembly.Module(msg.bytes), {}).exports as unknown as CoreExports;
      this.core = core;
      this.player = core.fw_player_new();
      this.left = core.fw_alloc(MAX_FRAMES * 4);
      this.right = core.fw_alloc(MAX_FRAMES * 4);
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
      case "clips":
        core.fw_clear_clips(this.player);
        for (const c of msg.clips) core.fw_add_clip(this.player, c.source, c.start, c.sourceIn, c.length, c.gain, c.pan, c.fadeIn, c.fadeOut, c.fadeShape);
        this.end = msg.end;
        break;
      case "seek":
        core.fw_seek(this.player, msg.position);
        this.report();
        break;
      case "play":
        this.playing = true;
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
      this.playing = false;
      this.reply({ type: "ended", position });
    } else if (this.quanta % REPORT_EVERY === 0) {
      this.report();
    }
    return true;
  }
}

registerProcessor("formwav-player", PlayerProcessor);
