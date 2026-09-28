declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export type RecorderMessage = { type: "start" } | { type: "stop" };

export type RecorderReply =
  | { type: "chunk"; channels: Float32Array[] }
  | { type: "level"; peak: number }
  | { type: "stopped" };

const CHUNK_FRAMES = 8192;
const LEVEL_EVERY = 8;

class RecorderProcessor extends AudioWorkletProcessor {
  private recording = false;
  private buffers: Float32Array[] = [];
  private filled = 0;
  private peak = 0;
  private quanta = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<RecorderMessage>) => {
      if (e.data.type === "start") {
        this.recording = true;
        return;
      }
      this.flush();
      this.recording = false;
      this.reply({ type: "stopped" });
    };
  }

  private reply(message: RecorderReply, transfer: Transferable[] = []): void {
    this.port.postMessage(message, transfer);
  }

  private flush(): void {
    if (!this.filled) return;
    const channels = this.buffers.map((b) => b.subarray(0, this.filled));
    this.reply({ type: "chunk", channels }, this.buffers.map((b) => b.buffer));
    this.buffers = [];
    this.filled = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!this.recording || !input || input.length === 0) return true;
    const frames = input[0].length;
    if (this.filled + frames > CHUNK_FRAMES) this.flush();
    if (!this.buffers.length) this.buffers = input.map(() => new Float32Array(CHUNK_FRAMES));
    for (let c = 0; c < this.buffers.length; c++) {
      const src = input[c] ?? input[0];
      this.buffers[c].set(src, this.filled);
      for (let i = 0; i < frames; i++) {
        const a = Math.abs(src[i]);
        if (a > this.peak) this.peak = a;
      }
    }
    this.filled += frames;
    if (++this.quanta % LEVEL_EVERY === 0) {
      this.reply({ type: "level", peak: this.peak });
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor("formwav-recorder", RecorderProcessor);
