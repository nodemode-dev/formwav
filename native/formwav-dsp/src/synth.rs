//! formwav's built-in instrument: a small polyphonic synthesizer that renders a note track to audio. A note clip's
//! notes stay in the document; the instrument renders them to a source the mixer plays like any audio, so the browser
//! and native outputs need nothing new. Each note is an oscillator (sine, triangle, or saw and square band-limited with
//! polyBLEP so high notes do not alias) shaped by an ADSR envelope, scaled by velocity, in equal temperament with A4
//! (note 69) at 440 Hz. The release runs past the note's end, so the rendering is longer than the last note by it.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wave {
    Sine,
    Triangle,
    Saw,
    Square,
}

impl Wave {
    pub fn parse(name: &str) -> Option<Wave> {
        match name {
            "sine" => Some(Wave::Sine),
            "triangle" => Some(Wave::Triangle),
            "saw" => Some(Wave::Saw),
            "square" => Some(Wave::Square),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Patch {
    pub wave: Wave,
    /// seconds
    pub attack: f32,
    /// seconds
    pub decay: f32,
    /// level, 0 to 1
    pub sustain: f32,
    /// seconds
    pub release: f32,
    /// overall level of one full-velocity note
    pub gain: f32,
    /// the low-pass filter's cutoff in Hz; 0, or at or above 0.45 of the rate, leaves the sound unfiltered
    pub cutoff: f32,
    /// the filter's resonance, as the Q of its two poles (0.707 flat at the cutoff)
    pub resonance: f32,
}

impl Default for Patch {
    fn default() -> Self {
        Patch { wave: Wave::Triangle, attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.2, gain: 0.25, cutoff: 0.0, resonance: 0.707 }
    }
}

/// The patch's low-pass: a two-pole resonant filter (the RBJ cookbook's) over the summed voices, in transposed direct
/// form II, so render and the live instrument run the same arithmetic on the same samples.
#[derive(Clone, Copy, Debug)]
struct Lowpass {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Lowpass {
    fn design(patch: &Patch, rate: f64) -> Option<Lowpass> {
        let f = patch.cutoff as f64;
        if !(f > 0.0 && f < 0.45 * rate) {
            return None;
        }
        let q = (patch.resonance as f64).clamp(0.3, 24.0);
        let w0 = std::f64::consts::TAU * f / rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let a0 = 1.0 + alpha;
        Some(Lowpass { b0: (1.0 - cos) / 2.0 / a0, b1: (1.0 - cos) / a0, b2: (1.0 - cos) / 2.0 / a0, a1: -2.0 * cos / a0, a2: (1.0 - alpha) / a0, z1: 0.0, z2: 0.0 })
    }

    /// The same filter with new coefficients and the running state kept, so a live change does not click.
    fn retune(self, patch: &Patch, rate: f64) -> Option<Lowpass> {
        Lowpass::design(patch, rate).map(|f| Lowpass { z1: self.z1, z2: self.z2, ..f })
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Note {
    /// first frame
    pub start: u64,
    /// frames held before the release
    pub length: u64,
    /// MIDI note number, 69 being A4
    pub pitch: u8,
    /// 1 to 127
    pub velocity: u8,
}

pub fn hz(pitch: u8) -> f64 {
    440.0 * 2f64.powf((pitch as f64 - 69.0) / 12.0)
}

fn poly_blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

pub(crate) fn oscillator(wave: Wave, phase: f64, dt: f64) -> f64 {
    match wave {
        Wave::Sine => (std::f64::consts::TAU * phase).sin(),
        Wave::Triangle => 1.0 - 4.0 * (phase - 0.5).abs(),
        Wave::Saw => 2.0 * phase - 1.0 - poly_blep(phase, dt),
        Wave::Square => {
            let naive = if phase < 0.5 { 1.0 } else { -1.0 };
            naive + poly_blep(phase, dt) - poly_blep((phase + 0.5) % 1.0, dt)
        }
    }
}

/// The envelope's level `t` frames into a note held for `held` frames.
fn envelope(patch: &Patch, rate: f64, t: u64, held: u64) -> f64 {
    let attack = (patch.attack as f64 * rate).max(1.0);
    let decay = (patch.decay as f64 * rate).max(1.0);
    let sustain = patch.sustain.clamp(0.0, 1.0) as f64;
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
    let release = (patch.release as f64 * rate).max(1.0);
    let from = level_at(held as f64);
    let into = (t - held) as f64;
    if into >= release {
        0.0
    } else {
        from * (1.0 - into / release)
    }
}

/// The frames a rendering of `notes` needs: the last note's end plus the release.
pub fn length(notes: &[Note], rate: u32, patch: &Patch) -> u64 {
    let release = (patch.release.max(0.0) as f64 * rate as f64).ceil() as u64 + 1;
    notes.iter().map(|n| n.start + n.length + release).max().unwrap_or(0)
}

/// Renders `notes` (mono) at `rate`.
pub fn render(notes: &[Note], rate: u32, patch: &Patch) -> Vec<f32> {
    let total = length(notes, rate, patch) as usize;
    let mut out = vec![0f64; total];
    let rate_f = rate as f64;
    let release = (patch.release.max(0.0) as f64 * rate_f).ceil() as u64 + 1;
    for note in notes.iter().filter(|n| n.velocity > 0 && n.length > 0) {
        let dt = hz(note.pitch) / rate_f;
        if dt >= 0.5 {
            continue; // above Nyquist: nothing to hear, and the oscillator cannot represent it
        }
        let level = patch.gain as f64 * (note.velocity.min(127) as f64 / 127.0);
        let mut phase = 0.0f64;
        let span = note.length + release;
        for t in 0..span {
            let at = (note.start + t) as usize;
            if at >= total {
                break;
            }
            out[at] += level * envelope(patch, rate_f, t, note.length) * oscillator(patch.wave, phase, dt);
            phase += dt;
            if phase >= 1.0 {
                phase -= 1.0;
            }
        }
    }
    if let Some(mut lowpass) = Lowpass::design(patch, rate_f) {
        for v in out.iter_mut() {
            *v = lowpass.process(*v);
        }
    }
    out.into_iter().map(|v| v as f32).collect()
}

/// PT-15: a sampler: each note plays `sample` (mono, at `sample_rate`) re-pitched from `root` (a note at the root plays
/// it at its own speed, an octave up at twice), read with linear interpolation, through the same envelope and velocity
/// as `render`; a note ends when its envelope's release does or the sample runs out.
pub fn render_sampled(notes: &[Note], rate: u32, patch: &Patch, sample: &[f32], sample_rate: u32, root: u8) -> Vec<f32> {
    let total = length(notes, rate, patch) as usize;
    let mut out = vec![0f64; total];
    let rate_f = rate as f64;
    let release = (patch.release.max(0.0) as f64 * rate_f).ceil() as u64 + 1;
    if sample.len() < 2 {
        return vec![0.0; total];
    }
    for note in notes.iter().filter(|n| n.velocity > 0 && n.length > 0) {
        let step = hz(note.pitch) / hz(root) * sample_rate as f64 / rate_f;
        let level = patch.gain as f64 * (note.velocity.min(127) as f64 / 127.0);
        for t in 0..note.length + release {
            let at = (note.start + t) as usize;
            let pos = t as f64 * step;
            let i = pos as usize;
            if at >= total || i + 1 >= sample.len() {
                break;
            }
            let frac = pos - i as f64;
            let s = sample[i] as f64 * (1.0 - frac) + sample[i + 1] as f64 * frac;
            out[at] += level * envelope(patch, rate_f, t, note.length) * s;
        }
    }
    out.into_iter().map(|v| v as f32).collect()
}

/// AU-37: the instrument played live: notes start and end as they arrive (a keyboard, a MIDI input) and each voice
/// follows the same oscillator and envelope as `render`, its phase from 0 at its start and its release from the frame
/// its note ends, voices summed in the order they started, so a voice ended `n` frames in sounds exactly as a rendered
/// note `n` frames long.
#[derive(Debug, Clone)]
pub struct Synth {
    patch: Patch,
    rate: f64,
    voices: Vec<Voice>,
    filter: Option<Lowpass>,
}

#[derive(Debug, Clone)]
struct Voice {
    pitch: u8,
    dt: f64,
    level: f64,
    phase: f64,
    t: u64,
    held: Option<u64>,
}

impl Synth {
    pub fn new(patch: Patch, rate: u32) -> Synth {
        let rate = rate.max(1) as f64;
        Synth { patch, rate, voices: Vec::new(), filter: Lowpass::design(&patch, rate) }
    }

    /// A new patch for the notes to come (and the ones still sounding); the filter keeps its state through the change.
    pub fn set_patch(&mut self, patch: Patch) {
        self.patch = patch;
        self.filter = match self.filter {
            Some(f) => f.retune(&patch, self.rate),
            None => Lowpass::design(&patch, self.rate),
        };
    }

    /// Starts a note; a velocity of 0 ends it, as MIDI's note-on with velocity 0 does.
    pub fn note_on(&mut self, pitch: u8, velocity: u8) {
        if velocity == 0 {
            self.note_off(pitch);
            return;
        }
        let dt = hz(pitch) / self.rate;
        if dt >= 0.5 {
            return; // above Nyquist, as render skips it
        }
        let level = self.patch.gain as f64 * (velocity.min(127) as f64 / 127.0);
        self.voices.push(Voice { pitch, dt, level, phase: 0.0, t: 0, held: None });
    }

    /// Ends the earliest still-held voice of this pitch: its release starts now.
    pub fn note_off(&mut self, pitch: u8) {
        if let Some(v) = self.voices.iter_mut().find(|v| v.pitch == pitch && v.held.is_none()) {
            v.held = Some(v.t);
        }
    }

    /// Ends every voice (the transport stopping, a panic).
    pub fn all_off(&mut self) {
        for v in self.voices.iter_mut().filter(|v| v.held.is_none()) {
            v.held = Some(v.t);
        }
    }

    pub fn sounding(&self) -> usize {
        self.voices.len()
    }

    /// Adds the voices' next frames to `out` (mono), dropping each voice once its release has run out.
    pub fn render(&mut self, out: &mut [f32]) {
        let release = (self.patch.release.max(0.0) as f64 * self.rate).ceil() as u64 + 1;
        for sample in out.iter_mut() {
            let mut sum = 0.0f64;
            for v in self.voices.iter_mut() {
                let held = v.held.unwrap_or(u64::MAX);
                if v.t < held.saturating_add(release) {
                    sum += v.level * envelope(&self.patch, self.rate, v.t, held) * oscillator(self.patch.wave, v.phase, v.dt);
                }
                v.phase += v.dt;
                if v.phase >= 1.0 {
                    v.phase -= 1.0;
                }
                v.t += 1;
            }
            let y = match self.filter.as_mut() {
                Some(f) => f.process(sum),
                None => sum,
            };
            *sample += y as f32;
        }
        self.voices.retain(|v| v.held.map_or(true, |h| v.t < h.saturating_add(release)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peak_hz(samples: &[f32], rate: u32) -> f64 {
        // the zero crossings of a steady stretch, enough for a pure tone
        let mid = &samples[samples.len() / 4..samples.len() / 2];
        let crossings = mid.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        crossings as f64 * rate as f64 / mid.len() as f64
    }

    #[test]
    fn a4_is_440() {
        let patch = Patch { wave: Wave::Sine, ..Patch::default() };
        let notes = [Note { start: 0, length: 48000, pitch: 69, velocity: 127 }];
        let out = render(&notes, 48000, &patch);
        let f = peak_hz(&out, 48000);
        assert!((f - 440.0).abs() < 2.0, "measured {f} Hz");
    }

    #[test]
    fn release_runs_past_the_note_and_ends_silent() {
        let patch = Patch::default();
        let notes = [Note { start: 0, length: 4800, pitch: 60, velocity: 100 }];
        let out = render(&notes, 48000, &patch);
        assert_eq!(out.len() as u64, length(&notes, 48000, &patch));
        assert!(out[4800 + 100].abs() > 0.0, "the release sounds after the note ends");
        assert!(out.last().unwrap().abs() < 1e-3, "it ends silent");
    }

    #[test]
    fn velocity_scales_level() {
        let patch = Patch { wave: Wave::Sine, ..Patch::default() };
        let loud = render(&[Note { start: 0, length: 9600, pitch: 69, velocity: 127 }], 48000, &patch);
        let soft = render(&[Note { start: 0, length: 9600, pitch: 69, velocity: 64 }], 48000, &patch);
        let peak = |v: &[f32]| v.iter().fold(0f32, |m, x| m.max(x.abs()));
        let ratio = peak(&soft) / peak(&loud);
        assert!((ratio - 64.0 / 127.0).abs() < 0.01, "ratio {ratio}");
    }

    /// PT-15: at its root the sampler plays the sample as it is (scaled by gain and velocity), an octave up at twice the
    /// speed (every second sample, exactly), both through a flat envelope here.
    #[test]
    fn the_sampler_plays_its_sample_at_the_notes_pitch() {
        let rate = 48000u32;
        let sample: Vec<f32> = (0..4800).map(|i| ((i as f32) * 0.037).sin() * 0.5).collect();
        let patch = Patch { wave: Wave::Sine, attack: 0.0, decay: 0.0, sustain: 1.0, release: 0.0, gain: 1.0, ..Patch::default() };
        let at_root = render_sampled(&[Note { start: 0, length: 2000, pitch: 60, velocity: 127 }], rate, &patch, &sample, rate, 60);
        assert!((1..2000).all(|i| (at_root[i] - sample[i]).abs() < 1e-6), "at the root the sample plays as it is");
        let octave = render_sampled(&[Note { start: 0, length: 2000, pitch: 72, velocity: 127 }], rate, &patch, &sample, rate, 60);
        assert!((1..2000).all(|i| (octave[i] - sample[2 * i]).abs() < 1e-5), "an octave up plays every second sample");
        let soft = render_sampled(&[Note { start: 0, length: 2000, pitch: 60, velocity: 64 }], rate, &patch, &sample, rate, 60);
        assert!((1..2000).all(|i| (soft[i] - sample[i] * 64.0 / 127.0).abs() < 1e-6), "velocity scales it");
    }

    /// AU-37: notes started and ended live on their frames, through uneven blocks as an audio callback gives them,
    /// sound exactly as render makes them (every sample equal), and no voice is left once the last release ends.
    #[test]
    fn the_live_instrument_plays_exactly_what_render_makes() {
        let rate = 48000u32;
        for (wave, cutoff) in [(Wave::Sine, 0.0), (Wave::Triangle, 0.0), (Wave::Saw, 0.0), (Wave::Square, 0.0), (Wave::Saw, 900.0), (Wave::Square, 2400.0)] {
            let patch = Patch { wave, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.15, gain: 0.3, cutoff, resonance: 4.0 };
            // overlapping notes, a repeated pitch, a soft one, a very short one
            let notes = [
                Note { start: 0, length: 24000, pitch: 60, velocity: 100 },
                Note { start: 6000, length: 12000, pitch: 64, velocity: 80 },
                Note { start: 12000, length: 300, pitch: 67, velocity: 30 },
                Note { start: 20000, length: 9000, pitch: 60, velocity: 127 },
            ];
            let want = render(&notes, rate, &patch);
            let mut synth = Synth::new(patch, rate);
            let mut got = vec![0.0f32; want.len()];
            let mut events: Vec<(u64, bool, u8, u8)> = notes.iter().flat_map(|n| [(n.start, true, n.pitch, n.velocity), (n.start + n.length, false, n.pitch, 0)]).collect();
            events.sort_by_key(|e| (e.0, e.1)); // at one frame, ends before starts
            let (mut at, mut next, mut step) = (0usize, 0usize, 1usize);
            while at < got.len() {
                while next < events.len() && events[next].0 as usize == at {
                    let (_, on, pitch, velocity) = events[next];
                    if on { synth.note_on(pitch, velocity) } else { synth.note_off(pitch) }
                    next += 1;
                }
                let until = events.get(next).map_or(got.len(), |e| e.0 as usize).min(at + step).min(got.len());
                synth.render(&mut got[at..until]);
                at = until;
                step = step % 128 + 7; // uneven block sizes
            }
            assert!(got == want, "{wave:?} at {cutoff} Hz: the live instrument differs from render");
            assert_eq!(synth.sounding(), 0, "{wave:?}: a voice outlived its release");
        }
    }

    /// The low-pass: a saw an octave over the cutoff loses its top (its RMS falls well under the open saw's) while a
    /// sine far under the cutoff passes unchanged within a hair; a cutoff of 0 or past 0.45 of the rate is no filter.
    #[test]
    fn the_cutoff_takes_the_top_off_and_leaves_the_low_end() {
        let rate = 48000u32;
        let rms = |v: &[f32]| (v[4800..36000].iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / 31200.0).sqrt();
        let note = [Note { start: 0, length: 40000, pitch: 69, velocity: 127 }];
        let open = render(&note, rate, &Patch { wave: Wave::Saw, ..Patch::default() });
        let shut = render(&note, rate, &Patch { wave: Wave::Saw, cutoff: 220.0, ..Patch::default() });
        assert!(rms(&shut) < rms(&open) * 0.5, "the saw kept {:.3} of {:.3}", rms(&shut), rms(&open));
        let low = [Note { start: 0, length: 40000, pitch: 33, velocity: 127 }];
        let sine = render(&low, rate, &Patch { wave: Wave::Sine, ..Patch::default() });
        let through = render(&low, rate, &Patch { wave: Wave::Sine, cutoff: 8000.0, ..Patch::default() });
        assert!((rms(&through) / rms(&sine) - 1.0).abs() < 0.01, "a 55 Hz sine under an 8 kHz cutoff changed");
        let past = render(&note, rate, &Patch { wave: Wave::Saw, cutoff: 0.46 * rate as f32, ..Patch::default() });
        assert!(past == open, "a cutoff past 0.45 of the rate filtered");
    }
}
