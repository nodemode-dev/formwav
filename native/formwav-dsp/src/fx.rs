//! Realtime track effects: biquad filters from Robert Bristow-Johnson's Audio EQ Cookbook (the published formulas;
//! no code taken), for Audacity's realtime effect stacks and Pro Tools' insert EQs as references.
//!
//! A track's chain runs on each of its clips before gain, pan and fades. The filters are linear and time-invariant,
//! so filtering each clip and summing equals filtering the track's sum. Coefficients are designed in f64 and run in
//! f32, transposed direct form II, with separate state per channel.

pub const HIGHPASS: u8 = 1;
pub const LOWPASS: u8 = 2;
pub const PEAK: u8 = 3;
pub const LOW_SHELF: u8 = 4;
pub const HIGH_SHELF: u8 = 5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    state: [[f32; 2]; 2],
}

impl Biquad {
    /// A filter of `kind` at `freq` Hz (clamped below Nyquist), `gain_db` for peak and shelves, `q` (0.707 when
    /// not positive), at `rate` Hz. None for an unknown kind or a non-positive rate or frequency.
    pub fn design(kind: u8, freq: f32, gain_db: f32, q: f32, rate: f32) -> Option<Biquad> {
        if !(rate > 0.0) || !(freq > 0.0) {
            return None;
        }
        let rate = rate as f64;
        let f = (freq as f64).min(rate * 0.49);
        let q = if q > 0.0 { q as f64 } else { std::f64::consts::FRAC_1_SQRT_2 };
        let w0 = 2.0 * std::f64::consts::PI * f / rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let a = 10f64.powf(gain_db as f64 / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            HIGHPASS => ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            LOWPASS => ((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
            PEAK => (1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a),
            LOW_SHELF => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + s),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - s),
                    (a + 1.0) + (a - 1.0) * cos + s,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - s,
                )
            }
            HIGH_SHELF => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + s),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - s),
                    (a + 1.0) - (a - 1.0) * cos + s,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - s,
                )
            }
            _ => return None,
        };
        Some(Biquad {
            b0: (b0 / a0) as f32,
            b1: (b1 / a0) as f32,
            b2: (b2 / a0) as f32,
            a1: (a1 / a0) as f32,
            a2: (a2 / a0) as f32,
            state: [[0.0; 2]; 2],
        })
    }

    /// One sample through the filter on channel `ch` (0 left, 1 right).
    #[inline]
    pub fn process(&mut self, ch: usize, x: f32) -> f32 {
        let s = &mut self.state[ch & 1];
        let y = self.b0 * x + s[0];
        s[0] = self.b1 * x - self.a1 * y + s[1];
        s[1] = self.b2 * x - self.a2 * y;
        y
    }

    /// Clears the filter's memory (after a seek or a loop's wrap, as a fresh render would start).
    pub fn reset(&mut self) {
        self.state = [[0.0; 2]; 2];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gain in dB of a sine through `f`, by RMS over the settled second half against the sine's RMS (1/sqrt 2).
    /// Sample peaks understate high frequencies (6 samples a cycle at 8 kHz read -0.56 dB through a flat filter).
    fn gain_at(mut f: Biquad, freq: f32, rate: f32) -> f32 {
        let n = rate as usize;
        let mut sum = 0.0f64;
        let mut count = 0usize;
        for i in 0..n {
            let y = f.process(0, (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin());
            if i >= n / 2 {
                sum += (y as f64) * (y as f64);
                count += 1;
            }
        }
        (20.0 * ((sum / count as f64).sqrt() * std::f64::consts::SQRT_2).log10()) as f32
    }

    #[test]
    fn highpass_passes_highs_and_cuts_lows() {
        let f = Biquad::design(HIGHPASS, 1000.0, 0.0, 0.707, 48000.0).unwrap();
        assert!(gain_at(f, 8000.0, 48000.0).abs() < 0.5);
        assert!(gain_at(f, 100.0, 48000.0) < -35.0);
    }

    #[test]
    fn peak_boosts_its_frequency_only() {
        let f = Biquad::design(PEAK, 1000.0, 6.0, 1.0, 48000.0).unwrap();
        assert!((gain_at(f, 1000.0, 48000.0) - 6.0).abs() < 0.2);
        assert!(gain_at(f, 60.0, 48000.0).abs() < 0.3);
    }

    #[test]
    fn unknown_kind_or_rate_is_refused() {
        assert!(Biquad::design(99, 1000.0, 0.0, 0.7, 48000.0).is_none());
        assert!(Biquad::design(LOWPASS, 1000.0, 0.0, 0.7, 0.0).is_none());
    }
}
