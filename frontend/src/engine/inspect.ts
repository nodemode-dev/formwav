import type { SessionDoc } from "./document";

/** S12: the whole open session as an agent reads it, times in seconds and levels in dB: tracks with their routing,
 *  sends, groups, effects and clips, the buses (and where each plays), VCAs, groups, markers, regions, the loop, the
 *  tempo, meter and key maps, and what the caller adds (the playhead, the undo and redo steps, unsaved changes). */
export function inspectSession(doc: SessionDoc, more: Record<string, unknown> = {}): Record<string, unknown> {
  const s = (n: number) => Math.round((n / doc.sampleRate) * 1e6) / 1e6;
  const lanes = (a: Record<string, readonly unknown[] | undefined> | undefined) =>
    Object.fromEntries(Object.entries(a ?? {}).filter(([, v]) => v?.length).map(([k, v]) => [k, v?.length ?? 0]));
  return {
    sample_rate: doc.sampleRate,
    length_s: s(Math.max(0, ...doc.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)))),
    tracks: doc.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      gain_db: t.gainDb,
      pan: t.pan ?? 0,
      mute: t.mute,
      solo: t.solo,
      ...(t.inactive ? { inactive: true } : {}),
      ...(t.hidden ? { hidden: true } : {}),
      output: t.busId ?? "master",
      ...(t.vcaId ? { vca: t.vcaId } : {}),
      sends: (t.sends ?? []).map((x) => ({ bus: x.busId, gain_db: x.gainDb, ...(x.pre ? { pre: true } : {}), ...(x.mute ? { mute: true } : {}), ...(x.pan !== undefined ? { pan: x.pan } : {}) })),
      effects: (t.fx ?? []).map((f) => f.kind),
      automation_points: lanes(t.automation as Record<string, readonly unknown[] | undefined> | undefined),
      clips: t.clips.map((c) => ({
        id: c.id,
        media: doc.media[c.mediaId]?.name ?? c.mediaId,
        start_s: s(c.start),
        length_s: s(c.length),
        gain_db: c.gainDb,
        ...(c.notes ? { notes: c.notes.length } : {}),
        ...(c.mute ? { mute: true } : {}),
        ...(c.fadeIn ? { fade_in_s: s(c.fadeIn) } : {}),
        ...(c.fadeOut ? { fade_out_s: s(c.fadeOut) } : {}),
      })),
    })),
    buses: (doc.buses ?? []).map((b) => ({ id: b.id, name: b.name, gain_db: b.gainDb, pan: b.pan ?? 0, mute: !!b.mute, output: b.out ?? "master", effects: (b.fx ?? []).map((f) => f.kind) })),
    vcas: (doc.vcas ?? []).map((v) => ({ id: v.id, name: v.name, gain_db: v.gainDb, mute: !!v.mute })),
    groups: (doc.groups ?? []).map((g) => ({ id: g.id, name: g.name, tracks: g.trackIds, links: (["volume", "mute", "solo", "edit"] as const).filter((k) => g[k]), active: g.active })),
    master: { gain_db: doc.masterGainDb ?? 0, effects: (doc.masterFx ?? []).map((f) => f.kind), automation_points: doc.masterAutomation?.length ?? 0 },
    markers: doc.markers.map((m) => ({ id: m.id, at_s: s(m.at), label: m.label })),
    regions: (doc.regions ?? []).map((r) => ({ label: r.label, start_s: s(r.start), end_s: s(r.end) })),
    loop: doc.loop ? { start_s: s(doc.loop.start), end_s: s(doc.loop.end), enabled: doc.loop.enabled } : null,
    tempo: { bpm: doc.tempo?.bpm ?? 120, meter: `${doc.tempo?.beatsPerBar ?? 4}/${doc.tempo?.beatUnit ?? 4}`, changes: doc.tempoChanges ?? [], meter_changes: doc.meterChanges ?? [] },
    key: { start: doc.key?.name ?? null, changes: doc.keyChanges ?? [] },
    ...more,
  };
}
