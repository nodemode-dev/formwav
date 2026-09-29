import type { Engine, SessionDoc } from "../engine";
import { FADE_SHAPES } from "../engine/document";
import type { WorkletBus, WorkletClip, WorkletMessage, WorkletReply } from "./player-worklet";
import workletUrl from "./player-worklet.ts?worker&url";

const CORE_URL = "/core/formwav_dsp.wasm";

export interface ClipPlan {
  clips: WorkletClip[];
  end: number;
  skipped: number;
  buses: WorkletBus[];
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function planClips(doc: SessionDoc, sources: Map<string, number>): ClipPlan {
  const soloed = doc.tracks.some((t) => t.solo);
  const busIndex = new Map<string, number>();
  const mutedBuses = new Set<string>();
  const buses: WorkletBus[] = [];
  for (const bus of doc.buses ?? []) {
    if (bus.mute) {
      mutedBuses.add(bus.id);
      continue;
    }
    const id = buses.length + 1;
    busIndex.set(bus.id, id);
    buses.push({ id, gain: dbToGain(bus.gainDb), pan: bus.pan ?? 0 });
  }
  const clips: WorkletClip[] = [];
  let end = 0;
  let skipped = 0;
  for (const track of doc.tracks) {
    if (track.mute || (soloed && !track.solo) || (track.busId !== undefined && mutedBuses.has(track.busId))) continue;
    const bus = track.busId !== undefined ? busIndex.get(track.busId) ?? 0 : 0;
    const volumePoints = track.automation?.volume?.length ? track.automation.volume.flatMap((p) => [p.time, p.value]) : undefined;
    const panPoints = track.automation?.pan?.length ? track.automation.pan.flatMap((p) => [p.time, p.value]) : undefined;
    for (const clip of track.clips) {
      const media = doc.media[clip.mediaId];
      const source = sources.get(clip.mediaId);
      if (!media || source === undefined) continue;
      if (media.sampleRate !== doc.sampleRate) {
        skipped++;
        continue;
      }
      clips.push({
        source,
        start: clip.start,
        sourceIn: clip.sourceIn,
        length: clip.length,
        gain: dbToGain((volumePoints ? 0 : track.gainDb) + clip.gainDb),
        pan: panPoints ? 0 : track.pan ?? 0,
        gainPoints: volumePoints,
        panPoints,
        fadeIn: clip.fadeIn ?? 0,
        fadeOut: clip.fadeOut ?? 0,
        fadeShape: FADE_SHAPES[clip.fadeShape ?? "linear"] ?? 0,
        bus,
        track: doc.tracks.indexOf(track) + 1,
      });
      end = Math.max(end, clip.start + clip.length);
    }
  }
  return { clips, end, skipped, buses };
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
  private lastPlan: ClipPlan = { clips: [], end: 0, skipped: 0, buses: [] };
  private pending = new Map<string, Promise<void>>();

  constructor(private readonly engine: Engine) {
    engine.subscribe("document", (doc) => {
      if (this.node) this.sendPlan(this.node, doc);
      this.prefetch(doc);
    });
  }

  private lastIntegrated = Number.NEGATIVE_INFINITY;
  private levelListeners = new Set<(left: number, right: number, tracks: number[], loudness: number[] | null) => void>();

  /** Master peaks, per-track peaks as [left, right] pairs in the document's track order, and [M, S, I] loudness in LUFS (null on stop). */
  onOutputLevel(listener: (left: number, right: number, tracks: number[], loudness: number[] | null) => void): void {
    this.levelListeners.add(listener);
  }

  private emitLevel(left: number, right: number, tracks: number[], loudness: number[] | null): void {
    for (const listener of this.levelListeners) listener(left, right, tracks, loudness);
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

  private load(node: AudioWorkletNode, mediaId: string): Promise<void> {
    let loading = this.pending.get(mediaId);
    if (!loading) {
      loading = loadInto(node, this.sources, mediaId, this.nextId);
      this.pending.set(mediaId, loading);
      loading.catch(() => this.pending.delete(mediaId));
    }
    return loading;
  }

  private prefetch(doc: SessionDoc): void {
    const missing = Object.keys(doc.media).filter((id) => !this.pending.has(id));
    if (!missing.length || !doc.tracks.length) return;
    this.ensure()
      .then((node) => Promise.all(missing.map((id) => this.load(node, id))))
      .then(() => {
        if (this.node) this.sendPlan(this.node, this.engine.get("document"));
      })
      .catch(() => undefined);
  }

  private sendPlan(node: AudioWorkletNode, doc: SessionDoc): void {
    this.lastPlan = planClips(doc, this.sources);
    const loop = doc.loop?.enabled && doc.loop.end > doc.loop.start ? doc.loop : null;
    send(node, { type: "clips", clips: this.lastPlan.clips, end: this.open || loop ? 0 : this.lastPlan.end, buses: this.lastPlan.buses });
    send(node, { type: "loop", start: loop?.start ?? 0, end: loop?.end ?? 0 });
  }

  private onReply = (e: MessageEvent<WorkletReply>): void => {
    const reply = e.data;
    if (reply.type === "position") {
      this.engine.setTransport({ positionSamples: reply.position });
      this.lastIntegrated = reply.loudness[2];
      if (this.engine.get("transport").playing) this.emitLevel(reply.peakLeft, reply.peakRight, reply.trackPeaks, reply.loudness);
      else this.emitLevel(0, 0, [], [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, reply.loudness[2]]);
    }
    else if (reply.type === "ended") {
      this.engine.setTransport({ positionSamples: reply.position, playing: false });
      this.emitLevel(0, 0, [], [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, this.lastIntegrated]);
    }
  };

  private starting: Promise<AudioWorkletNode> | null = null;

  private ensure(): Promise<AudioWorkletNode> {
    const rate = this.engine.get("document").sampleRate;
    if (this.ctx && this.node && this.ctx.sampleRate === rate) return Promise.resolve(this.node);
    if (!this.starting) {
      this.starting = this.start(rate).finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async start(rate: number): Promise<AudioWorkletNode> {
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.node = null;
      this.sources.clear();
      this.pending.clear();
    }
    const ctx = new AudioContext({ sampleRate: rate, latencyHint: "interactive" });
    const node = await makeNode(ctx, await this.core());
    node.port.addEventListener("message", this.onReply);
    this.ctx = ctx;
    this.node = node;
    return node;
  }

  private open = false;

  async play(open = false): Promise<void> {
    this.open = open;
    const node = await this.ensure();
    await this.ctx?.resume();
    const doc = this.engine.get("document");
    await Promise.all(Object.keys(doc.media).map((id) => this.load(node, id)));
    this.sendPlan(node, this.engine.get("document"));
    send(node, { type: "seek", position: this.engine.get("transport").positionSamples });
    send(node, { type: "play" });
    this.engine.setTransport({ playing: true });
  }

  stop(): void {
    this.open = false;
    if (this.node) send(this.node, { type: "stop" });
    this.emitLevel(0, 0, [], null);
    this.engine.setTransport({ playing: false });
  }

  async context(): Promise<AudioContext> {
    await this.ensure();
    if (!this.ctx) throw new Error("the audio context did not start");
    return this.ctx;
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
    send(node, { type: "clips", clips: plan.clips, end: plan.end, buses: plan.buses });
    send(node, { type: "play" });
    await request(node, { type: "seek", position: 0 }, (r) => r.type === "position");
    const rendered = await ctx.startRendering();
    return [rendered.getChannelData(0), rendered.getChannelData(1)];
  }
}
