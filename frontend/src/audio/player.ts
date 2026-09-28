import type { Engine, SessionDoc } from "../engine";
import type { WorkletClip, WorkletMessage, WorkletReply } from "./player-worklet";
import workletUrl from "./player-worklet.ts?worker&url";

const CORE_URL = "/core/formwav_dsp.wasm";

export interface ClipPlan {
  clips: WorkletClip[];
  end: number;
  skipped: number;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function planClips(doc: SessionDoc, sources: Map<string, number>): ClipPlan {
  const soloed = doc.tracks.some((t) => t.solo);
  const clips: WorkletClip[] = [];
  let end = 0;
  let skipped = 0;
  for (const track of doc.tracks) {
    if (track.mute || (soloed && !track.solo)) continue;
    for (const clip of track.clips) {
      const media = doc.media[clip.mediaId];
      const source = sources.get(clip.mediaId);
      if (!media || source === undefined) continue;
      if (media.sampleRate !== doc.sampleRate) {
        skipped++;
        continue;
      }
      clips.push({ source, start: clip.start, sourceIn: clip.sourceIn, length: clip.length, gain: dbToGain(track.gainDb + clip.gainDb) });
      end = Math.max(end, clip.start + clip.length);
    }
  }
  return { clips, end, skipped };
}

function send(node: AudioWorkletNode, message: WorkletMessage, transfer: Transferable[] = []): void {
  node.port.postMessage(message, transfer);
}

function request(node: AudioWorkletNode, message: WorkletMessage, match: (reply: WorkletReply) => boolean, transfer: Transferable[] = []): Promise<WorkletReply> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent<WorkletReply>) => {
      if (!match(e.data)) return;
      node.port.removeEventListener("message", onMessage);
      resolve(e.data);
    };
    node.port.addEventListener("message", onMessage);
    node.port.start();
    send(node, message, transfer);
  });
}

async function loadInto(node: AudioWorkletNode, sources: Map<string, number>, mediaId: string, nextId: () => number): Promise<void> {
  if (sources.has(mediaId)) return;
  const res = await fetch(`/api/media/${mediaId}/audio`);
  if (!res.ok) throw new Error(`audio request answered ${res.status}`);
  const bytes = await res.arrayBuffer();
  const id = nextId();
  const reply = await request(node, { type: "load", id, bytes }, (r) => r.type === "loaded" && r.id === id, [bytes]);
  if (reply.type === "loaded" && reply.frames < 0) throw new Error("the audio core could not decode this file");
  sources.set(mediaId, id);
}

async function makeNode(ctx: BaseAudioContext, core: ArrayBuffer): Promise<AudioWorkletNode> {
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, "formwav-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(ctx.destination);
  const bytes = core.slice(0);
  const reply = await request(node, { type: "init", bytes }, (r) => r.type === "ready" || r.type === "error", [bytes]);
  if (reply.type === "error") throw new Error(`the audio core failed to start: ${reply.message}`);
  return node;
}

export class Player {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private module: Promise<ArrayBuffer> | null = null;
  private sources = new Map<string, number>();
  private counter = 0;
  private lastPlan: ClipPlan = { clips: [], end: 0, skipped: 0 };

  constructor(private readonly engine: Engine) {
    engine.subscribe("document", (doc) => {
      if (this.node) this.sendPlan(this.node, doc);
    });
  }

  get skipped(): number {
    return this.lastPlan.skipped;
  }

  private core(): Promise<ArrayBuffer> {
    if (!this.module) {
      this.module = fetch(CORE_URL).then((res) => {
        if (!res.ok) throw new Error(`the audio core is missing (${res.status}); run ./formwav_oc_install`);
        return res.arrayBuffer();
      });
      this.module.catch(() => (this.module = null));
    }
    return this.module;
  }

  private nextId = (): number => ++this.counter;

  private sendPlan(node: AudioWorkletNode, doc: SessionDoc): void {
    this.lastPlan = planClips(doc, this.sources);
    send(node, { type: "clips", clips: this.lastPlan.clips, end: this.lastPlan.end });
  }

  private onReply = (e: MessageEvent<WorkletReply>): void => {
    const reply = e.data;
    if (reply.type === "position") this.engine.setTransport({ positionSamples: reply.position, playing: reply.playing });
    else if (reply.type === "ended") this.engine.setTransport({ positionSamples: reply.position, playing: false });
  };

  private async ensure(): Promise<AudioWorkletNode> {
    const rate = this.engine.get("document").sampleRate;
    if (this.ctx && this.node && this.ctx.sampleRate === rate) return this.node;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.node = null;
      this.sources.clear();
    }
    const ctx = new AudioContext({ sampleRate: rate, latencyHint: "interactive" });
    const node = await makeNode(ctx, await this.core());
    node.port.addEventListener("message", this.onReply);
    this.ctx = ctx;
    this.node = node;
    return node;
  }

  async play(): Promise<void> {
    const node = await this.ensure();
    await this.ctx?.resume();
    const doc = this.engine.get("document");
    await Promise.all(Object.keys(doc.media).map((id) => loadInto(node, this.sources, id, this.nextId)));
    this.sendPlan(node, this.engine.get("document"));
    send(node, { type: "seek", position: this.engine.get("transport").positionSamples });
    send(node, { type: "play" });
    this.engine.setTransport({ playing: true });
  }

  stop(): void {
    if (this.node) send(this.node, { type: "stop" });
    this.engine.setTransport({ playing: false });
  }

  toggle(): Promise<void> {
    if (this.engine.get("transport").playing) {
      this.stop();
      return Promise.resolve();
    }
    return this.play();
  }

  seek(position: number): void {
    const at = Math.max(0, Math.round(position));
    this.engine.setTransport({ positionSamples: at });
    if (this.node) send(this.node, { type: "seek", position: at });
  }

  async bounce(): Promise<Float32Array[]> {
    const doc = this.engine.get("document");
    const sources = new Map<string, number>();
    let counter = 0;
    const length = Math.max(1, planClips(doc, new Map(Object.keys(doc.media).map((id) => [id, 0]))).end);
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: doc.sampleRate });
    const node = await makeNode(ctx, await this.core());
    await Promise.all(Object.keys(doc.media).map((id) => loadInto(node, sources, id, () => ++counter)));
    const plan = planClips(doc, sources);
    send(node, { type: "clips", clips: plan.clips, end: plan.end });
    send(node, { type: "play" });
    await request(node, { type: "seek", position: 0 }, (r) => r.type === "position");
    const rendered = await ctx.startRendering();
    return [rendered.getChannelData(0), rendered.getChannelData(1)];
  }
}
