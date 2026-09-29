import type { SessionDoc } from "../engine";

export interface Mix {
  blob: Blob;
  frames: number;
  peakLeft: number;
  peakRight: number;
  loudness: number;
  skipped: number;
}

function decibels(value: string | null): number {
  if (value === null || value === "-inf") return -Infinity;
  return Number(value);
}

export async function renderMix(doc: SessionDoc): Promise<Mix> {
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
  }
  return {
    blob: await res.blob(),
    frames: Number(res.headers.get("X-Frames")),
    peakLeft: decibels(res.headers.get("X-Peak-Left-dBFS")),
    peakRight: decibels(res.headers.get("X-Peak-Right-dBFS")),
    loudness: decibels(res.headers.get("X-Loudness-LUFS")),
    skipped: Number(res.headers.get("X-Skipped-Clips")),
  };
}
