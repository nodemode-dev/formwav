//! S14: note-track instruments beside the built-in synth. A subtractive synth (two oscillators, a resonant low-pass
//! with its own envelope, glide, sixteen voices) and a drum synth on the General MIDI drum map (twenty-four voices).
//! One engine per instrument takes note-on and note-off as they come and adds its voices to a buffer; a note clip is
//! rendered by feeding that same engine the clip's notes, so a clip sounds exactly as the notes played live.

use crate::synth::{oscillator, Note, Wave};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Subtractive,
    Drums,
}

pub struct Param {
    pub id: &'static str,
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub unit: &'static str,
}

const fn p(id: &'static str, name: &'static str, min: f32, max: f32, default: f32, unit: &'static str) -> Param {
    Param { id, name, min, max, default, unit }
}

pub const SUBTRACTIVE: &[Param] = &[
    p("osc1", "Oscillator 1", 0.0, 3.0, 2.0, "wave"),
    p("osc2", "Oscillator 2", 0.0, 3.0, 3.0, "wave"),
    p("semitones", "Oscillator 2 pitch", -24.0, 24.0, 0.0, "st"),
    p("cents", "Oscillator 2 detune", -100.0, 100.0, 7.0, "ct"),
    p("mix", "Oscillator mix", 0.0, 1.0, 0.35, ""),
    p("cutoff", "Cutoff", 20.0, 20000.0, 1800.0, "Hz"),
    p("resonance", "Resonance", 0.0, 1.0, 0.25, ""),
    p("envAmount", "Filter envelope", -1.0, 1.0, 0.4, ""),
    p("attack", "Attack", 0.0, 10.0, 0.005, "s"),
    p("decay", "Decay", 0.0, 10.0, 0.3, "s"),
    p("sustain", "Sustain", 0.0, 1.0, 0.7, ""),
    p("release", "Release", 0.0, 10.0, 0.25, "s"),
    p("filterAttack", "Filter attack", 0.0, 10.0, 0.005, "s"),
    p("filterDecay", "Filter decay", 0.0, 10.0, 0.4, "s"),
    p("filterSustain", "Filter sustain", 0.0, 1.0, 0.2, ""),
    p("filterRelease", "Filter release", 0.0, 10.0, 0.3, "s"),
    p("glide", "Glide", 0.0, 1000.0, 0.0, "ms"),
    p("velocity", "Velocity sensitivity", 0.0, 1.0, 0.7, ""),
    p("level", "Level", 0.0, 1.0, 0.5, ""),
];

pub const DRUMS: &[Param] = &[
    p("level", "Level", 0.0, 1.0, 0.8, ""),
    p("kickTune", "Kick tune", -12.0, 12.0, 0.0, "st"),
    p("kickDecay", "Kick decay", 0.05, 2.0, 0.45, "s"),
    p("snareTune", "Snare tune", -12.0, 12.0, 0.0, "st"),
    p("snappy", "Snare snappy", 0.0, 1.0, 0.6, ""),
    p("snareDecay", "Snare decay", 0.05, 1.0, 0.18, "s"),
    p("closedDecay", "Closed hat decay", 0.01, 0.5, 0.05, "s"),
    p("openDecay", "Open hat decay", 0.05, 2.0, 0.4, "s"),
    p("tomTune", "Tom tune", -12.0, 12.0, 0.0, "st"),
    p("tomDecay", "Tom decay", 0.05, 2.0, 0.35, "s"),
    p("cymbalDecay", "Cymbal decay", 0.2, 6.0, 1.6, "s"),
];

impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        match name {
            "subtractive" => Some(Kind::Subtractive),
            "drums" => Some(Kind::Drums),
            _ => None,
        }
    }

    pub fn from_code(code: u32) -> Option<Kind> {
        match code {
            1 => Some(Kind::Subtractive),
            2 => Some(Kind::Drums),
            _ => None,
        }
    }

    pub fn params(self) -> &'static [Param] {
        match self {
            Kind::Subtractive => SUBTRACTIVE,
            Kind::Drums => DRUMS,
        }
    }

    fn voices(self) -> usize {
        match self {
            Kind::Subtractive => 16,
            Kind::Drums => 24,
        }
    }
}

/// Values in the table's order, each clamped to its range; a missing or non-finite one is its default, a wave a
/// whole number.
pub fn clean(kind: Kind, values: &[f32]) -> Vec<f32> {
    kind.params()
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let v = values.get(i).copied().filter(|v| v.is_finite()).unwrap_or(p.default).clamp(p.min, p.max);
            if p.unit == "wave" {
                v.round()
            } else {
                v
            }
        })
        .collect()
}

pub fn params_json(kind: Kind) -> String {
    let items: Vec<String> = kind
        .params()
        .iter()
        .map(|p| format!("{{\"id\":\"{}\",\"name\":\"{}\",\"min\":{},\"max\":{},\"default\":{},\"unit\":\"{}\"}}", p.id, p.name, p.min, p.max, p.default, p.unit))
        .collect();
    format!("[{}]", items.join(","))
}

fn wave(code: f32) -> Wave {
    match code as u32 {
        0 => Wave::Sine,
        1 => Wave::Triangle,
        3 => Wave::Square,
        _ => Wave::Saw,
    }
}

fn adsr(a: f32, d: f32, s: f32, rate: f64, t: u64, held: u64, release: u64) -> f64 {
    let attack = (a as f64 * rate).max(1.0);
    let decay = (d as f64 * rate).max(1.0);
    let sustain = s.clamp(0.0, 1.0) as f64;
    let level_at = |t: f64| -> f64 {
        if t < attack {
            t / attack
        } else if t < attack + decay {
            1.0 - (1.0 - sustain) * (t - attack) / decay
        } else {
            sustain
        }
    };
    if t < held {
        return level_at(t as f64);
    }
    let into = (t - held) as f64;
    if into >= release as f64 {
        0.0
    } else {
        level_at(held as f64) * (1.0 - into / release as f64)
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct Svf {
    a1: f64,
    a2: f64,
    a3: f64,
    k: f64,
    ic1: f64,
    ic2: f64,
}

impl Svf {
    fn tune(&mut self, freq: f64, k: f64, rate: f64) {
        let g = (std::f64::consts::PI * freq.clamp(10.0, 0.45 * rate) / rate).tan();
        self.k = k;
        self.a1 = 1.0 / (1.0 + g * (g + k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;
    }

    /// (low, band, high)
    fn run(&mut self, x: f64) -> (f64, f64, f64) {
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        (v2, v1, x - self.k * v1 - v2)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Part {
    Kick,
    Snare,
    Clap,
    Closed,
    Pedal,
    Open,
    Tom,
    Crash,
    Ride,
}

fn part(pitch: u8) -> Option<(Part, f64)> {
    Some(match pitch {
        35 | 36 => (Part::Kick, 1.0),
        37 | 39 => (Part::Clap, 1.0),
        38 | 40 => (Part::Snare, if pitch == 40 { 1.06 } else { 1.0 }),
        42 => (Part::Closed, 1.0),
        44 => (Part::Pedal, 1.0),
        46 => (Part::Open, 1.0),
        41 => (Part::Tom, 82.0),
        43 => (Part::Tom, 98.0),
        45 => (Part::Tom, 110.0),
        47 => (Part::Tom, 131.0),
        48 => (Part::Tom, 147.0),
        50 => (Part::Tom, 165.0),
        49 | 57 => (Part::Crash, if pitch == 57 { 1.06 } else { 1.0 }),
        51 | 59 => (Part::Ride, if pitch == 59 { 1.05 } else { 1.0 }),
        _ => return None,
    })
}

const METAL: [f64; 6] = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

#[derive(Clone, Debug)]
struct Voice {
    pitch: u8,
    t: u64,
    held: Option<u64>,
    amp: f64,
    phase: [f64; 6],
    from: f64,
    glide: u64,
    filter: Svf,
    part: Option<Part>,
    tone: f64,
    tau: f64,
    length: u64,
    choke: Option<u64>,
    noise: u32,
}

impl Voice {
    fn noise(&mut self) -> f64 {
        let mut x = self.noise;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.noise = x;
        x as f64 / u32::MAX as f64 * 2.0 - 1.0
    }
}

/// An instrument played by note events, adding its voices to a mono buffer.
#[derive(Clone, Debug)]
pub struct Instrument {
    kind: Kind,
    v: Vec<f32>,
    rate: f64,
    voices: Vec<Voice>,
    last: Option<f64>,
    hits: u32,
}

impl Instrument {
    pub fn new(kind: Kind, values: &[f32], rate: u32) -> Instrument {
        Instrument { kind, v: clean(kind, values), rate: rate.max(1) as f64, voices: Vec::new(), last: None, hits: 0 }
    }

    pub fn kind(&self) -> Kind {
        self.kind
    }

    /// New values for the notes to come; the sounding ones keep theirs where they were fixed at their start.
    pub fn set_values(&mut self, values: &[f32]) {
        self.v = clean(self.kind, values);
    }

    pub fn note_on(&mut self, pitch: u8, velocity: u8) {
        if velocity == 0 {
            self.note_off(pitch);
            return;
        }
        let vel = velocity.min(127) as f64 / 127.0;
        let rate = self.rate;
        let mut voice = Voice { pitch, t: 0, held: None, amp: 0.0, phase: [0.0; 6], from: pitch as f64, glide: 0, filter: Svf::default(), part: None, tone: 1.0, tau: 1.0, length: 0, choke: None, noise: 1 };
        match self.kind {
            Kind::Subtractive => {
                let v = &self.v;
                let sens = v[17] as f64;
                voice.amp = v[18] as f64 * 0.5 * ((1.0 - sens) + sens * vel);
                if v[16] > 0.0 {
                    if let Some(last) = self.last {
                        voice.from = last;
                        voice.glide = (v[16] as f64 / 1000.0 * rate).round() as u64;
                    }
                }
                self.last = Some(pitch as f64);
            }
            Kind::Drums => {
                let Some((part, tone)) = part(pitch) else { return };
                let v = &self.v;
                let semis = |st: f32| 2f64.powf(st as f64 / 12.0);
                let (tau, gain, tone) = match part {
                    Part::Kick => (v[2] as f64, 1.0, 52.0 * semis(v[1])),
                    Part::Snare => (v[5] as f64, 0.8, tone * semis(v[3])),
                    Part::Clap => (v[5] as f64, 0.7, 1.0),
                    Part::Closed => (v[6] as f64, 0.35, 1.0),
                    Part::Pedal => (v[6] as f64 * 0.6, 0.3, 1.0),
                    Part::Open => (v[7] as f64, 0.35, 1.0),
                    Part::Tom => (v[9] as f64, 0.8, tone * semis(v[8])),
                    Part::Crash => (v[10] as f64, 0.3, tone),
                    Part::Ride => (v[10] as f64 * 1.3, 0.25, tone),
                };
                voice.part = Some(part);
                voice.tone = tone;
                voice.tau = tau * rate;
                voice.length = (9.0 * tau * rate).ceil() as u64 + if part == Part::Clap { (0.03 * rate) as u64 } else { 0 };
                voice.amp = v[0] as f64 * gain * vel;
                match part {
                    Part::Snare => voice.filter.tune(1500.0, 1.4, rate),
                    Part::Clap => voice.filter.tune(1100.0, 0.5, rate),
                    Part::Closed | Part::Pedal | Part::Open => voice.filter.tune(7000.0, 1.4, rate),
                    Part::Crash => voice.filter.tune(4500.0, 1.4, rate),
                    Part::Ride => voice.filter.tune(3000.0, 1.4, rate),
                    _ => {}
                }
                self.hits = self.hits.wrapping_add(1);
                voice.noise = (0x9E37_79B9u32 ^ (pitch as u32).wrapping_mul(0x85EB_CA6B) ^ self.hits.wrapping_mul(0xC2B2_AE35)).max(1);
                if matches!(part, Part::Closed | Part::Pedal) {
                    for o in self.voices.iter_mut().filter(|o| o.part == Some(Part::Open) && o.choke.is_none()) {
                        o.choke = Some(o.t);
                    }
                }
            }
        }
        if self.voices.len() >= self.kind.voices() {
            let oldest = self.voices.iter().position(|o| o.held.is_some()).unwrap_or(0);
            self.voices.remove(oldest);
        }
        self.voices.push(voice);
    }

    pub fn note_off(&mut self, pitch: u8) {
        if let Some(v) = self.voices.iter_mut().find(|v| v.pitch == pitch && v.held.is_none()) {
            v.held = Some(v.t);
        }
    }

    pub fn all_off(&mut self) {
        for v in self.voices.iter_mut().filter(|v| v.held.is_none()) {
            v.held = Some(v.t);
        }
    }

    pub fn sounding(&self) -> usize {
        self.voices.len()
    }

    fn release(&self) -> u64 {
        (self.v[11].max(0.0) as f64 * self.rate).ceil() as u64 + 1
    }

    fn filter_release(&self) -> u64 {
        (self.v[15].max(0.0) as f64 * self.rate).ceil() as u64 + 1
    }

    fn done(&self, v: &Voice) -> bool {
        match self.kind {
            Kind::Subtractive => v.held.is_some_and(|h| v.t >= h.saturating_add(self.release())),
            Kind::Drums => v.t >= v.length || v.choke.is_some_and(|c| v.t >= c + (0.005 * self.rate) as u64),
        }
    }

    pub fn render(&mut self, out: &mut [f32]) {
        let mut voices = std::mem::take(&mut self.voices);
        for sample in out.iter_mut() {
            let mut sum = 0.0f64;
            for v in voices.iter_mut() {
                if !self.done(v) {
                    sum += match self.kind {
                        Kind::Subtractive => self.sub_sample(v),
                        Kind::Drums => self.drum_sample(v),
                    };
                }
                v.t += 1;
            }
            *sample += sum as f32;
        }
        voices.retain(|v| !self.done(v));
        self.voices = voices;
    }

    fn sub_sample(&self, v: &mut Voice) -> f64 {
        let p = &self.v;
        let rate = self.rate;
        let to = v.pitch as f64;
        let semis = if v.t < v.glide { v.from + (to - v.from) * v.t as f64 / v.glide as f64 } else { to };
        let dt1 = 440.0 * 2f64.powf((semis - 69.0) / 12.0) / rate;
        let dt2 = dt1 * 2f64.powf((p[2] as f64 + p[3] as f64 / 100.0) / 12.0);
        let mix = p[4] as f64;
        let o1 = if dt1 < 0.5 { oscillator(wave(p[0]), v.phase[0], dt1) } else { 0.0 };
        let o2 = if dt2 < 0.5 { oscillator(wave(p[1]), v.phase[1], dt2) } else { 0.0 };
        v.phase[0] = (v.phase[0] + dt1).fract();
        v.phase[1] = (v.phase[1] + dt2).fract();
        let held = v.held.unwrap_or(u64::MAX);
        let amp = adsr(p[8], p[9], p[10], rate, v.t, held, self.release());
        let fenv = adsr(p[12], p[13], p[14], rate, v.t, held, self.filter_release());
        let cutoff = p[5] as f64 * 2f64.powf(p[7] as f64 * fenv * 6.0);
        v.filter.tune(cutoff, 2.0 - 1.96 * p[6] as f64, rate);
        let (low, _, _) = v.filter.run((1.0 - mix) * o1 + mix * o2);
        v.amp * amp * low
    }

    fn drum_sample(&self, v: &mut Voice) -> f64 {
        let rate = self.rate;
        let ts = v.t as f64 / rate;
        let env = (-(v.t as f64) / v.tau).exp();
        let tau = std::f64::consts::TAU;
        let step = |v: &mut Voice, i: usize, f: f64| {
            let s = (tau * v.phase[i]).sin();
            v.phase[i] = (v.phase[i] + f / rate).fract();
            s
        };
        let metal = |v: &mut Voice, scale: f64| -> f64 {
            let mut m = 0.0;
            for (i, f) in METAL.iter().enumerate() {
                m += if v.phase[i] < 0.5 { 1.0 } else { -1.0 };
                v.phase[i] = (v.phase[i] + f * scale / rate).fract();
            }
            m / 6.0
        };
        let snappy = self.v[4] as f64;
        let out = match v.part.unwrap_or(Part::Kick) {
            Part::Kick => {
                let f = v.tone * (1.0 + 2.5 * (-ts / 0.035).exp());
                step(v, 0, f) * env + 0.35 * v.noise() * (-ts / 0.003).exp()
            }
            Part::Snare => {
                let drop = 1.0 + 0.3 * (-ts / 0.02).exp();
                let body = 0.6 * step(v, 0, 185.0 * v.tone * drop) + 0.4 * step(v, 1, 330.0 * v.tone * drop);
                let n = v.noise();
                let (_, _, high) = v.filter.run(n);
                body * (-(v.t as f64) / (0.5 * v.tau)).exp() * (1.0 - 0.5 * snappy) + high * env * snappy * 0.9
            }
            Part::Clap => {
                let n = v.noise();
                let (_, band, _) = v.filter.run(n);
                let mut e = 0.0;
                for k in 0..3 {
                    let at = k as f64 * 0.011;
                    if ts >= at {
                        e += (-(ts - at) / 0.005).exp();
                    }
                }
                if ts >= 0.022 {
                    e += 0.6 * (-(ts - 0.022) * rate / v.tau).exp();
                }
                band * e * 2.0
            }
            Part::Closed | Part::Pedal | Part::Open => {
                let m = metal(v, 1.6);
                let n = v.noise();
                let (_, _, high) = v.filter.run(0.6 * m + 0.4 * n);
                high * env
            }
            Part::Tom => {
                let f = v.tone * (1.0 + 0.6 * (-ts / 0.04).exp());
                step(v, 0, f) * env + 0.2 * v.noise() * (-ts / 0.004).exp()
            }
            Part::Crash => {
                let m = metal(v, 2.3 * v.tone);
                let n = v.noise();
                let (_, _, high) = v.filter.run(0.5 * m + 0.5 * n);
                high * env
            }
            Part::Ride => {
                let m = metal(v, 1.4 * v.tone);
                let n = v.noise();
                let (_, _, high) = v.filter.run(0.7 * m + 0.3 * n);
                let bell = 0.25 * (tau * 2400.0 * v.tone * ts).sin() * (-(v.t as f64) / (0.3 * v.tau)).exp();
                high * env + bell
            }
        };
        let choke = v.choke.map_or(1.0, |c| (1.0 - (v.t - c) as f64 / (0.005 * rate)).max(0.0));
        v.amp * out * choke
    }
}

/// `notes` (mono) rendered by a new instrument of `kind` fed their note-ons and note-offs on their frames (at one
/// frame, ends before starts), until the last voice ends.
pub fn render(kind: Kind, values: &[f32], notes: &[Note], rate: u32) -> Vec<f32> {
    let mut inst = Instrument::new(kind, values, rate);
    let mut events: Vec<(u64, bool, u8, u8)> = notes.iter().filter(|n| n.velocity > 0 && n.length > 0).flat_map(|n| [(n.start, true, n.pitch, n.velocity), (n.start + n.length, false, n.pitch, 0)]).collect();
    events.sort_by_key(|e| (e.0, e.1));
    let cap = events.last().map_or(0, |e| e.0) + 60 * rate as u64;
    let mut out: Vec<f32> = Vec::new();
    let (mut at, mut next) = (0u64, 0usize);
    loop {
        while next < events.len() && events[next].0 == at {
            let (_, on, pitch, velocity) = events[next];
            if on {
                inst.note_on(pitch, velocity)
            } else {
                inst.note_off(pitch)
            }
            next += 1;
        }
        if next >= events.len() && inst.sounding() == 0 || at >= cap {
            break;
        }
        let until = events.get(next).map_or(at + 256, |e| e.0).min(cap);
        let from = out.len();
        out.resize(from + (until - at) as usize, 0.0);
        inst.render(&mut out[from..]);
        at = until;
    }
    out
}

/// The live instrument: the built-in synth or one of these.
#[derive(Clone, Debug)]
pub enum Live {
    Synth(crate::synth::Synth),
    Other(Instrument),
}

impl Live {
    pub fn note_on(&mut self, pitch: u8, velocity: u8) {
        match self {
            Live::Synth(s) => s.note_on(pitch, velocity),
            Live::Other(i) => i.note_on(pitch, velocity),
        }
    }

    pub fn all_off(&mut self) {
        match self {
            Live::Synth(s) => s.all_off(),
            Live::Other(i) => i.all_off(),
        }
    }

    pub fn sounding(&self) -> usize {
        match self {
            Live::Synth(s) => s.sounding(),
            Live::Other(i) => i.sounding(),
        }
    }

    pub fn render(&mut self, out: &mut [f32]) {
        match self {
            Live::Synth(s) => s.render(out),
            Live::Other(i) => i.render(out),
        }
    }
}
