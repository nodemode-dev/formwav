import type { MediaRef } from "../engine/document";

export interface PeakData {
  samplesPerPeak: number;
  channels: number;
  blocks: number;
  data: Float32Array;
}

/** Imports any audio (or a video's audio), converted to `rate` when the session has one. */
export async function importFile(file: File, rate?: number): Promise<MediaRef> {
  const res = await fetch(`/api/media${rate ? `?rate=${rate}` : ""}`, {
    method: "POST",
    body: file,
    headers: { "X-Filename": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
  });
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
  return body as unknown as MediaRef;
}

/** A stored media file converted to `rate`, as new media. */
export async function resampleMedia(id: string, rate: number): Promise<MediaRef> {
  const res = await fetch(`/api/media/${id}/resample?rate=${rate}`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
  return body as unknown as MediaRef;
}

export async function fetchPeaks(id: string, samplesPerPeak: number): Promise<PeakData> {
  const res = await fetch(`/api/media/${id}/peaks?spp=${samplesPerPeak}`);
  if (!res.ok) throw new Error(`peaks request answered ${res.status}`);
  const data = new Float32Array(await res.arrayBuffer());
  return {
    samplesPerPeak: Number(res.headers.get("X-Samples-Per-Peak")),
    channels: Number(res.headers.get("X-Channels")),
    blocks: Number(res.headers.get("X-Blocks")),
    data,
  };
}
