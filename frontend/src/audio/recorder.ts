import type { Player } from "./player";
import type { RecorderMessage, RecorderReply } from "./recorder-worklet";
import recorderUrl from "./recorder-worklet.ts?worker&url";

export interface Take {
  sampleRate: number;
  channels: Float32Array[];
  frames: number;
  /** The audio context frame of the first captured sample, for aligning takes recorded together; -1 when nothing was captured. */
  startFrame?: number;
}

export interface Recording {
  startPosition: number;
  setMonitor(on: boolean): void;
  stop(): Promise<Take>;
}

function assemble(chunks: Float32Array[][], channels: number, sampleRate: number): Take {
  const frames = chunks.reduce((n, chunk) => n + (chunk[0]?.length ?? 0), 0);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let at = 0;
  for (const chunk of chunks) {
    const n = chunk[0]?.length ?? 0;
    for (let c = 0; c < channels; c++) {
      const src = chunk[Math.min(c, chunk.length - 1)];
      if (src) out[c].set(src, at);
    }
    at += n;
  }
  return { sampleRate, channels: out, frames };
}

export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const ch = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * ch * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * ch * 4, true);
  view.setUint16(32, ch * 4, true);
  view.setUint16(34, 32, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  const samples = new Float32Array(buffer, 44, frames * ch);
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) samples[i * ch + c] = channels[c]?.[i] ?? 0;
  return buffer;
}

/**
 * Inputs open for the current take, one stream and one source node per device, shared by every track recording from
 * it: tracks on one device then hear the very same samples, and their capture start frames align them exactly
 * (separate streams of one device each start with their own jitter, up to 2 ms apart). The last user closes it.
 */
const inputs = new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode | null; users: number }>();

async function openInput(deviceId: string): Promise<MediaStream> {
  const shared = inputs.get(deviceId);
  if (shared) {
    shared.users++;
    return shared.stream;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 32 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  });
  inputs.set(deviceId, { stream, source: null, users: 1 });
  return stream;
}

function closeInput(deviceId: string): void {
  const shared = inputs.get(deviceId);
  if (!shared) return;
  shared.users--;
  if (shared.users > 0) return;
  shared.source?.disconnect();
  for (const track of shared.stream.getTracks()) track.stop();
  inputs.delete(deviceId);
}

/** AU-21's monitor level, linear (1 is unity), for monitoring before and during takes. */
let monitorGain = 1;
const monitorNodes = new Set<AudioWorkletNode>();
export function setMonitorLevel(gain: number): void {
  monitorGain = Math.max(0, Math.min(4, gain));
  for (const node of monitorNodes) node.port.postMessage({ type: "monitor", on: true, level: monitorGain } satisfies RecorderMessage);
}

/** AU-21: the input heard before a take starts: the same input and recorder worklet a take uses, its pass-through on at
 * the monitor level and no take started, until stop(). */
export async function startMonitoring(player: Player, deviceId = ""): Promise<{ stop: () => void; node: AudioWorkletNode }> {
  const stream = await openInput(deviceId);
  const ctx = await player.context();
  await ctx.audioWorklet.addModule(recorderUrl);
  const channels = Math.min(2, Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1));
  const shared = inputs.get(deviceId);
  const source = shared?.source ?? ctx.createMediaStreamSource(stream);
  if (shared && !shared.source) shared.source = source;
  const node = new AudioWorkletNode(ctx, "formwav-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: channels, channelCountMode: "explicit", channelInterpretation: "speakers" });
  source.connect(node);
  node.connect(ctx.destination);
  node.port.postMessage({ type: "monitor", on: true, level: monitorGain } satisfies RecorderMessage);
  monitorNodes.add(node);
  return {
    node,
    stop: () => {
      monitorNodes.delete(node);
      node.port.postMessage({ type: "monitor", on: false } satisfies RecorderMessage);
      try {
        source.disconnect(node);
      } catch {
        // already disconnected
      }
      node.disconnect();
    },
  };
}

export async function startRecording(player: Player, startPosition: number, onLevel: (peak: number) => void, deviceId = "", monitor = false, playAlong = true, pick: number[] | null = null): Promise<Recording> {
  const stream = await openInput(deviceId);
  try {
    const ctx = await player.context();
    await ctx.audioWorklet.addModule(recorderUrl);
    const deviceChannels = Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1);
    const picked = (pick ?? []).filter((c) => c >= 0 && c < deviceChannels);
    const channels = picked.length ? picked.length : Math.min(2, deviceChannels);
    const shared = inputs.get(deviceId);
    const source = shared?.source ?? ctx.createMediaStreamSource(stream);
    if (shared && !shared.source) shared.source = source;
    const node = new AudioWorkletNode(ctx, "formwav-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: channels,
      channelCountMode: "explicit",
      channelInterpretation: picked.length ? "discrete" : "speakers",
    });
    const split = picked.length ? ctx.createChannelSplitter(deviceChannels) : null;
    const feed: AudioNode = split ? ctx.createChannelMerger(picked.length) : source;
    if (split) {
      source.connect(split);
      picked.forEach((c, i) => split.connect(feed, c, i));
    }
    feed.connect(node);
    node.connect(ctx.destination);
    const chunks: Float32Array[][] = [];
    let startFrame = -1;
    let onStopped: (() => void) | null = null;
    node.port.onmessage = (e: MessageEvent<RecorderReply>) => {
      const reply = e.data;
      if (reply.type === "chunk") chunks.push(reply.channels);
      else if (reply.type === "level") onLevel(reply.peak);
      else {
        startFrame = reply.startFrame;
        onStopped?.();
      }
    };
    if (playAlong) await player.play(true);
    node.port.postMessage({ type: "monitor", on: monitor, level: monitorGain } satisfies RecorderMessage);
    node.port.postMessage({ type: "start" } satisfies RecorderMessage);
    return {
      startPosition,
      setMonitor: (on: boolean) => node.port.postMessage({ type: "monitor", on, level: monitorGain } satisfies RecorderMessage),
      stop: () =>
        new Promise<Take>((resolve) => {
          onStopped = () => {
            if (split) {
              source.disconnect(split);
              feed.disconnect();
            } else source.disconnect(node);
            node.disconnect();
            closeInput(deviceId);
            resolve({ ...assemble(chunks, channels, ctx.sampleRate), startFrame });
          };
          node.port.postMessage({ type: "stop" } satisfies RecorderMessage);
        }),
    };
  } catch (err) {
    closeInput(deviceId);
    throw err;
  }
}


/**
 * Native capture (the engine's /api/audio/record routes): armed tracks whose input is an interface the engine captures
 * in full, one engine take per interface (the engine records one interface at a time). Each track gets a Recording of
 * the usual shape: stop() ends the engine's take once and hands back that track's channels as an ordinary Take, so
 * placing it (latency, punch, loops) is the same as for a browser take.
 */
export async function startNativeRecordings(
  player: Player,
  startPosition: number,
  wants: { trackId: string; device: string; channels: number[]; name: string; width?: number }[],
  playAlong: boolean,
  rate: number,
): Promise<Map<string, Recording>> {
  const out = new Map<string, Recording>();
  const byDevice = new Map<string, typeof wants>();
  for (const w of wants) {
    const list = byDevice.get(w.device) ?? [];
    list.push(w);
    byDevice.set(w.device, list);
  }
  for (const [device, list] of byDevice) {
    const res = await fetch("/api/audio/record/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device, rate, deviceChannels: list[0].width ?? null, tracks: list.map((w) => ({ trackId: w.trackId, channels: w.channels, name: w.name })) }),
    });
    const started = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof started.detail === "string" ? started.detail : `the engine answered ${res.status}`);
    let stopping: Promise<Map<string, string>> | null = null;
    const stopOnce = () =>
      (stopping ??= fetch("/api/audio/record/stop", { method: "POST" })
        .then((r) => r.json())
        .then((d: { takes: { trackId: string; media: { id: string } }[] }) => new Map(d.takes.map((t) => [t.trackId, t.media.id]))));
    for (const w of list) {
      out.set(w.trackId, {
        startPosition,
        setMonitor: () => undefined, // the interface's own monitoring; the engine does not loop input back
        stop: async () => {
          const id = (await stopOnce()).get(w.trackId);
          if (!id) return { sampleRate: rate, channels: [], frames: 0 };
          const ctx = await player.context();
          const audio = await ctx.decodeAudioData(await (await fetch(`/api/media/${id}/audio`)).arrayBuffer());
          const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
          return { sampleRate: audio.sampleRate, channels, frames: audio.length };
        },
      });
    }
  }
  if (playAlong) await player.play(true);
  return out;
}
