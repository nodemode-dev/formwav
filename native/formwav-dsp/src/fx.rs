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

pub const COMPRESSOR: u8 = 6;

/// A feed-forward compressor, stereo-linked: the louder channel's absolute level drives one gain for both. Hard knee;
/// the gain reduction in dB follows its target with an attack coefficient when rising and a release one when falling.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Compressor {
    threshold_db: f32,
    slope: f32,
    attack: f32,
    release: f32,
    makeup_db: f32,
    reduction_db: f32,
}

impl Compressor {
    /// `ratio` at least 1; attack and release in milliseconds (at least 0.1); None for a non-positive rate.
    pub fn design(threshold_db: f32, ratio: f32, attack_ms: f32, release_ms: f32, makeup_db: f32, rate: f32) -> Option<Compressor> {
        if !(rate > 0.0) {
            return None;
        }
        let coef = |ms: f32| (-1.0 / (ms.max(0.1) * 0.001 * rate)).exp();
        Some(Compressor {
            threshold_db: threshold_db.clamp(-60.0, 0.0),
            slope: 1.0 - 1.0 / ratio.clamp(1.0, 20.0),
            attack: coef(attack_ms),
            release: coef(release_ms),
            makeup_db: makeup_db.clamp(0.0, 24.0),
            reduction_db: 0.0,
        })
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let level = l.abs().max(r.abs());
        let level_db = if level > 1e-9 { 20.0 * level.log10() } else { -180.0 };
        let target = (level_db - self.threshold_db).max(0.0) * self.slope;
        let coef = if target > self.reduction_db { self.attack } else { self.release };
        self.reduction_db = target + coef * (self.reduction_db - target);
        let gain = 10f32.powf((self.makeup_db - self.reduction_db) / 20.0);
        (l * gain, r * gain)
    }

    pub fn reset(&mut self) {
        self.reduction_db = 0.0;
    }
}

/// One stage of a bus or master chain: a filter or a compressor, run a stereo frame at a time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Stage {
    Filter(Biquad),
    Comp(Compressor),
}

impl Stage {
    /// Kinds 1 to 5 are filters (a = freq, b = gain dB, c = Q); kind 6 is a compressor (a = threshold dB, b = ratio,
    /// c = attack ms, d = release ms, e = makeup dB). None for an unknown kind.
    pub fn design(kind: u8, a: f32, b: f32, c: f32, d: f32, e: f32, rate: f32) -> Option<Stage> {
        if kind == COMPRESSOR {
            Compressor::design(a, b, c, d, e, rate).map(Stage::Comp)
        } else {
            Biquad::design(kind, a, b, c, rate).map(Stage::Filter)
        }
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        match self {
            Stage::Filter(f) => (f.process(0, l), f.process(1, r)),
            Stage::Comp(c) => c.process(l, r),
        }
    }

    pub fn reset(&mut self) {
        match self {
            Stage::Filter(f) => f.reset(),
            Stage::Comp(c) => c.reset(),
        }
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

    /// Output peak in dBFS over the settled second half of a 1 kHz sine of `amp` through a compressor.
    fn comp_peak(amp: f32, threshold: f32, ratio: f32) -> f32 {
        let rate = 48000.0;
        let mut c = Compressor::design(threshold, ratio, 5.0, 200.0, 0.0, rate).unwrap();
        let mut peak = 0.0f32;
        for i in 0..48000 {
            let x = amp * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / rate).sin();
            let (y, _) = c.process(x, x);
            if i >= 24000 {
                peak = peak.max(y.abs());
            }
        }
        20.0 * peak.log10()
    }

    #[test]
    fn compressor_follows_its_static_curve() {
        // -6 dBFS is 14 dB over a -20 dB threshold; 4:1 keeps a quarter, so about 10.5 dB of reduction.
        let out = comp_peak(0.5, -20.0, 4.0);
        assert!((out - (-16.5)).abs() < 1.0, "{out}");
    }

    #[test]
    fn compressor_leaves_quiet_signals_alone() {
        let out = comp_peak(0.05, -20.0, 4.0);
        assert!((out - 20.0 * 0.05f32.log10()).abs() < 0.05, "{out}");
    }
}
