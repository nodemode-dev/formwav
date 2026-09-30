/** A named set of settings for one effect: rendered effects are keyed "fx:<effect id>", realtime ones "rt:<kind>". */
export interface Preset {
  name: string;
  effect: string;
  params: Record<string, number>;
}

export async function loadPresets(): Promise<Preset[]> {
  const res = await fetch("/api/presets");
  if (!res.ok) throw new Error(`the engine answered ${res.status}`);
  return (await res.json()) as Preset[];
}

export async function savePresets(presets: Preset[]): Promise<Preset[]> {
  const res = await fetch("/api/presets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(presets) });
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
  return body as unknown as Preset[];
}
