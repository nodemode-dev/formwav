/**
 * S14: the note-track instruments the audio core plays beside the built-in synth, their parameters in the core's
 * order (native/formwav-dsp/src/instruments.rs; backend/tests/test_instruments.py holds the two tables equal). A track
 * keeps its values by name; the core takes them as numbers in this order.
 */

export type InstrumentKind = "subtractive" | "drums";

export interface InstrumentParam {
  id: string;
  name: string;
  min: number;
  max: number;
  default: number;
  unit: string;
}

const p = (id: string, name: string, min: number, max: number, def: number, unit = ""): InstrumentParam => ({ id, name, min, max, default: def, unit });

export const INSTRUMENT_PARAMS: Record<InstrumentKind, readonly InstrumentParam[]> = {
  subtractive: [
    p("osc1", "Oscillator 1", 0, 3, 2, "wave"),
    p("osc2", "Oscillator 2", 0, 3, 3, "wave"),
    p("semitones", "Oscillator 2 pitch", -24, 24, 0, "st"),
    p("cents", "Oscillator 2 detune", -100, 100, 7, "ct"),
    p("mix", "Oscillator mix", 0, 1, 0.35),
    p("cutoff", "Cutoff", 20, 20000, 1800, "Hz"),
    p("resonance", "Resonance", 0, 1, 0.25),
    p("envAmount", "Filter envelope", -1, 1, 0.4),
    p("attack", "Attack", 0, 10, 0.005, "s"),
    p("decay", "Decay", 0, 10, 0.3, "s"),
    p("sustain", "Sustain", 0, 1, 0.7),
    p("release", "Release", 0, 10, 0.25, "s"),
    p("filterAttack", "Filter attack", 0, 10, 0.005, "s"),
    p("filterDecay", "Filter decay", 0, 10, 0.4, "s"),
    p("filterSustain", "Filter sustain", 0, 1, 0.2),
    p("filterRelease", "Filter release", 0, 10, 0.3, "s"),
    p("glide", "Glide", 0, 1000, 0, "ms"),
    p("velocity", "Velocity sensitivity", 0, 1, 0.7),
    p("level", "Level", 0, 1, 0.5),
  ],
  drums: [
    p("level", "Level", 0, 1, 0.8),
    p("kickTune", "Kick tune", -12, 12, 0, "st"),
    p("kickDecay", "Kick decay", 0.05, 2, 0.45, "s"),
    p("snareTune", "Snare tune", -12, 12, 0, "st"),
    p("snappy", "Snare snappy", 0, 1, 0.6),
    p("snareDecay", "Snare decay", 0.05, 1, 0.18, "s"),
    p("closedDecay", "Closed hat decay", 0.01, 0.5, 0.05, "s"),
    p("openDecay", "Open hat decay", 0.05, 2, 0.4, "s"),
    p("tomTune", "Tom tune", -12, 12, 0, "st"),
    p("tomDecay", "Tom decay", 0.05, 2, 0.35, "s"),
    p("cymbalDecay", "Cymbal decay", 0.2, 6, 1.6, "s"),
  ],
};

export const INSTRUMENT_NAMES: Record<InstrumentKind, string> = { subtractive: "Subtractive synth", drums: "Drum synth" };

export const WAVE_NAMES = ["Sine", "Triangle", "Saw", "Square"] as const;

export const instrumentParams = (kind: InstrumentKind): readonly InstrumentParam[] => INSTRUMENT_PARAMS[kind];

export const isInstrumentKind =(k: unknown): k is InstrumentKind => k === "subtractive" || k === "drums";

/** Values by name, each known one clamped to its range (a wave a whole number), unknown names dropped. */
export function cleanInstrumentValues(kind: InstrumentKind, values: unknown): Record<string, number> {
  const given = typeof values === "object" && values ? (values as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const q of INSTRUMENT_PARAMS[kind]) {
    const v = Number(given[q.id]);
    if (given[q.id] === undefined || !Number.isFinite(v)) continue;
    const c = Math.max(q.min, Math.min(q.max, v));
    out[q.id] = q.unit === "wave" ? Math.round(c) : c;
  }
  return out;
}

/** The values as the core takes them: every parameter in order, a missing one its default. */
export function instrumentValues(kind: InstrumentKind, values: Record<string, number> | undefined): number[] {
  const clean = cleanInstrumentValues(kind, values);
  return INSTRUMENT_PARAMS[kind].map((q) => clean[q.id] ?? q.default);
}
