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
}

impl Default for Patch {
    fn default() -> Self {
        Patch { wave: Wave::Triangle, attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.2, gain: 0.25 }
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

fn oscillator(wave: Wave, phase: f64, dt: f64) -> f64 {
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
    out.into_iter().map(|v| v as f32).collect()
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
}
