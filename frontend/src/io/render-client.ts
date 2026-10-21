import type { SessionDoc } from "../engine";

export interface Mix {
  blob: Blob;
  frames: number;
  peakLeft: number;
  peakRight: number;
  loudness: number;
  skipped: number;
  /** The file's extension, from the engine's Content-Disposition (wav, flac, mp3, ogg, m4a, zip). */
  ext: string;
  /** Tracks rendered separately (stems or multichannel), else 0. */
  stems: number;
  /** The mix's true peak in dBTP (4x oversampled in the core); -Infinity when silent or not a mix. */
  truePeak: number;
  /** The gain a peak normalisation applied, in dB (0 without one). */
  normalizeDb: number;
}

export interface ExportOptions {
  format?: string;
  what?: "mix" | "stems" | "multichannel" | "surround51" | "surround" | "ambisonic" | "adm";
  /** A multichannel export's channels by track number, in order, such as "2,1,3" (AU-50); empty is track order. */
  channels?: string;
  /** PLAN_v13 S3: the frames rendered, from start to end (an end past the last clip renders the tails); absent is the
   *  whole session. */
  start?: number;
  end?: number;
  /** The mix's highest sample after a peak normalisation, in dBFS; absent keeps its level. */
  normalize?: number;
  /** TPDF dither on the 16 and 24-bit formats; on unless false. */
  dither?: boolean;
}

function decibels(value: string | null): number {
  if (value === null || value === "-inf") return -Infinity;
  return Number(value);
}

export async function renderMix(doc: SessionDoc, options: ExportOptions = {}): Promise<Mix> {
  const query = new URLSearchParams({ format: options.format ?? "wav", what: options.what ?? "mix" });
  if (options.what === "multichannel" && options.channels?.trim()) query.set("channels", options.channels.trim());
  if (options.start !== undefined) query.set("start", String(Math.max(0, Math.round(options.start))));
  if (options.end !== undefined) query.set("end", String(Math.round(options.end)));
  if (options.normalize !== undefined) query.set("normalize", String(options.normalize));
  if (options.dither === false) query.set("dither", "false");
  const res = await fetch(`/api/render?${query}`, {
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
    ext: /filename="[^"]*\.([a-z0-9]+)"/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "wav",
    stems: Number(res.headers.get("X-Stems") ?? 0),
    truePeak: decibels(res.headers.get("X-True-Peak-dBTP")),
    normalizeDb: Number(res.headers.get("X-Normalize-dB") ?? 0),
  };
}
