import type { Player } from "./player";
import type { RecorderMessage, RecorderReply } from "./recorder-worklet";
import recorderUrl from "./recorder-worklet.ts?worker&url";

export interface Take {
  sampleRate: number;
  channels: Float32Array[];
  frames: number;
}

export interface Recording {
  startPosition: number;
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

export async function startRecording(player: Player, startPosition: number, onLevel: (peak: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  try {
    const ctx = await player.context();
    await ctx.audioWorklet.addModule(recorderUrl);
    const channels = Math.min(2, Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1));
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "formwav-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: channels,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    source.connect(node);
    node.connect(ctx.destination);
    const chunks: Float32Array[][] = [];
    let onStopped: (() => void) | null = null;
    node.port.onmessage = (e: MessageEvent<RecorderReply>) => {
      const reply = e.data;
      if (reply.type === "chunk") chunks.push(reply.channels);
      else if (reply.type === "level") onLevel(reply.peak);
      else onStopped?.();
    };
    await player.play(true);
    node.port.postMessage({ type: "start" } satisfies RecorderMessage);
    return {
      startPosition,
      stop: () =>
        new Promise<Take>((resolve) => {
          onStopped = () => {
            source.disconnect();
            node.disconnect();
            for (const track of stream.getTracks()) track.stop();
            resolve(assemble(chunks, channels, ctx.sampleRate));
          };
          node.port.postMessage({ type: "stop" } satisfies RecorderMessage);
        }),
    };
  } catch (err) {
    for (const track of stream.getTracks()) track.stop();
    throw err;
  }
}
