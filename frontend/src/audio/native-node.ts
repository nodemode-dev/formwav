/**
 * Native output as a stand-in for the worklet node. The Player talks to its node only through `port`, so in native
 * mode the port is a WebSocket to the engine's /api/audio/native, which speaks the worklet's protocol and runs
 * formwav's own Player on an audio device: "clips", "seek", "loop", "play" and "stop" pass through as they are, the
 * "position" report comes back in the worklet's own shape, and a source is named by its media id (the engine reads its
 * own store) where the worklet would be sent the samples. The choice is kept per browser: null plays in the browser,
 * "" on the system's default device, a name on that device.
 */
const OUTPUT_KEY = "formwav.nativeOutput";

type Reply = { type: string; [key: string]: unknown };

export function nativeChoice(): string | null {
  try {
    const v = localStorage.getItem(OUTPUT_KEY);
    return v && v.startsWith("native:") ? v.slice("native:".length) : null;
  } catch {
    return null;
  }
}

export function setOutputChoice(device: string | null): void {
  try {
    if (device === null) localStorage.removeItem(OUTPUT_KEY);
    else localStorage.setItem(OUTPUT_KEY, `native:${device}`);
  } catch {
    /* not kept: the browser plays */
  }
}

class NativePort extends EventTarget {
  onmessage: ((e: MessageEvent<Reply>) => void) | null = null;

  constructor(private readonly ws: WebSocket) {
    super();
    const deliver = (data: Reply) => {
      const event = new MessageEvent<Reply>("message", { data });
      this.dispatchEvent(event);
      this.onmessage?.(event);
    };
    ws.addEventListener("message", (e: MessageEvent) => {
      const data = JSON.parse(String(e.data)) as Reply;
      if (data.type === "loaded") Object.assign(data, { id: data.source, frames: 1 });
      deliver(data);
      // the worklet says "ended" when playback runs out; native output's audio callback marks the end itself and the
      // next report carries the mark once, however quickly playback finished between reports
      if (data.type === "position" && data.ended === true) deliver({ type: "ended", position: data.position });
    });
  }

  postMessage(message: { type: string }): void {
    // the worklet's own start-up and sample transfers have no meaning here: the engine holds the core and the media
    if (message.type === "init" || message.type === "alloc" || message.type === "write" || message.type === "load") return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  start(): void {}
}

export class NativeNode {
  readonly port: NativePort;

  private constructor(private readonly ws: WebSocket) {
    this.port = new NativePort(ws);
  }

  static async open(rate: number, device: string): Promise<NativeNode> {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/api/audio/native`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("the engine's native output did not answer")), { once: true });
    });
    const node = new NativeNode(ws);
    const reply = await node.request({ type: "open", rate, device: device || null }, (r) => r.type === "ready" || r.type === "error");
    if (reply.type === "error") {
      ws.close();
      throw new Error(`native output: ${String(reply.message)}`);
    }
    return node;
  }

  request(message: Record<string, unknown> & { type: string }, match: (reply: Reply) => boolean): Promise<Reply> {
    return new Promise((resolve) => {
      const onMessage = (e: Event) => {
        const data = (e as MessageEvent<Reply>).data;
        if (!match(data)) return;
        this.port.removeEventListener("message", onMessage);
        resolve(data);
      };
      this.port.addEventListener("message", onMessage);
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    });
  }

  async loadSource(id: number, mediaId: string): Promise<void> {
    const reply = await this.request({ type: "source", source: id, mediaId }, (r) => (r.type === "loaded" && r.id === id) || r.type === "error");
    if (reply.type === "error") throw new Error(String(reply.message));
  }

  connect(): void {}

  disconnect(): void {}

  close(): void {
    this.ws.close();
  }
}
