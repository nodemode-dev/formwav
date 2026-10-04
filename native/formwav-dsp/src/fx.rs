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
    /// Takes `other`'s coefficients and keeps this filter's state, so an automated parameter moves without a click.
    pub fn retune(&mut self, other: &Biquad) {
        self.b0 = other.b0;
        self.b1 = other.b1;
        self.b2 = other.b2;
        self.a1 = other.a1;
        self.a2 = other.a2;
    }

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

    /// The filter's magnitude in dB at `freq`.
    pub fn magnitude_db(&self, freq: f32, rate: f32) -> f32 {
        let w = 2.0 * std::f32::consts::PI * freq / rate;
        let (c1, s1, c2, s2) = (w.cos(), -w.sin(), (2.0 * w).cos(), -(2.0 * w).sin());
        let (nr, ni) = (self.b0 + self.b1 * c1 + self.b2 * c2, self.b1 * s1 + self.b2 * s2);
        let (dr, di) = (1.0 + self.a1 * c1 + self.a2 * c2, self.a1 * s1 + self.a2 * s2);
        10.0 * ((nr * nr + ni * ni) / (dr * dr + di * di).max(1e-30)).max(1e-30).log10()
    }

    /// A band-pass (RBJ, constant 0 dB peak gain) at `freq` with quality `q`, for the denoiser's bands.
    pub fn bandpass(freq: f32, q: f32, rate: f32) -> Biquad {
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        Biquad { b0: alpha / a0, b1: 0.0, b2: -alpha / a0, a1: -2.0 * w0.cos() / a0, a2: (1.0 - alpha) / a0, state: [[0.0; 2]; 2] }
    }
}

/// RX-24, RX-40, RX-49: the realtime adaptive denoiser's stage kind (a = reduction dB, b = sensitivity dB).
pub const DENOISE: u8 = 7;
/// PT-22: the realtime reverb (Reverb), a = room size, b = damping, c = mix, d = width.
pub const REVERB: u8 = 8;
// sixteen bands from 80 Hz to 45% of the rate, about 0.54 of an octave apart, each a Q of 2.65 so neighbours cross at
// -3 dB and the bands together sum to about unity: bands stopping at 10 kHz left 58% of white noise's power (10 to 24 kHz
// at 48 kHz) where none could reach, and took it down under 1 dB
const DENOISE_BANDS: usize = 16;

/// A zero-latency adaptive denoiser for realtime playback and exports alike (the core has no latency compensation, so
/// no block delay): sixteen analysis band-passes from 80 Hz to 45% of the rate; in each band a fast (10 ms) and a slow
/// (100 ms) power envelope and a noise floor learned from the slow one, following it down at once and rising 3 dB a
/// second, so it settles on the band's quiet moments and follows noise that changes; a spectral-subtraction gain per
/// band (the fast envelope less the floor times the sensitivity), floored at the reduction, opening in 3 ms and closing
/// in 30. The signal runs through a dynamic EQ (a low shelf, peaks and a high shelf at the band centres, retuned every
/// 32 samples, an identity at 0 dB so nothing reduced leaves the input exactly), with neighbours of a band carrying
/// signal held to 80% of its gain and those bands corrected for the others' spill. A tone held steady for seconds looks
/// like noise to a learning floor and is slowly reduced, as adaptive voice denoisers' are; speech and notes are not.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Denoiser {
    bands: [Biquad; DENOISE_BANDS],
    // the signal path: a peaking filter at each band's centre, redesigned every 32 samples to the band's gain (an
    // identity at 0 dB, so nothing reduced leaves the input exactly); subtracting the band-passes from the signal left
    // their phase error behind and cut white noise by under 4 dB
    eq: [Biquad; DENOISE_BANDS],
    centres: [f32; DENOISE_BANDS],
    // spill[k][j]: band j's filter, per dB of its gain, at band k's centre (k != j): the peaks' long skirts added up to
    // over a dB at a tone between open bands, so each retune corrects every band against its neighbours' spill
    spill: [[f32; DENOISE_BANDS]; DENOISE_BANDS],
    rate: f32,
    tick: u32,
    env: [f32; DENOISE_BANDS],
    // the floor learns from a slow (100 ms) envelope: the fast one's dips sit far under band noise's mean power, and a
    // floor following them down would sit 10 dB and more too low
    slow: [f32; DENOISE_BANDS],
    noise: [f32; DENOISE_BANDS],
    gain: [f32; DENOISE_BANDS],
    env_coef: f32,
    slow_coef: f32,
    rise: f32,
    attack: f32,
    release: f32,
    floor: f32,
    over: f32,
}

impl Denoiser {
    pub fn design(reduction_db: f32, sensitivity_db: f32, rate: f32) -> Option<Denoiser> {
        if !reduction_db.is_finite() || !sensitivity_db.is_finite() || rate <= 0.0 {
            return None;
        }
        let mut bands = [Biquad::bandpass(1000.0, 2.65, rate); DENOISE_BANDS];
        let mut centres = [0.0f32; DENOISE_BANDS];
        let top = 0.45 * rate;
        for (k, band) in bands.iter_mut().enumerate() {
            centres[k] = 80.0 * (top / 80.0).powf(k as f32 / (DENOISE_BANDS - 1) as f32);
            *band = Biquad::bandpass(centres[k], 2.65, rate);
        }
        let mut eq = [Biquad::bandpass(1000.0, 2.65, rate); DENOISE_BANDS];
        for (k, f) in eq.iter_mut().enumerate() {
            *f = Denoiser::eq_filter(k, &centres, 0.0, rate)?;
        }
        let mut spill = [[0.0f32; DENOISE_BANDS]; DENOISE_BANDS];
        for j in 0..DENOISE_BANDS {
            let probe = Denoiser::eq_filter(j, &centres, -20.0, rate)?;
            for k in 0..DENOISE_BANDS {
                if k != j {
                    spill[k][j] = probe.magnitude_db(centres[k], rate) / -20.0;
                }
            }
        }
        let per = |ms: f32| (-1.0 / (ms * 0.001 * rate)).exp();
        Some(Denoiser {
            bands,
            eq,
            centres,
            spill,
            rate,
            tick: 0,
            // all start at full scale and fall to the real level within a fraction of a second; a start at zero sent the
            // floor to nothing, from where it climbs at 3 dB a second
            env: [1.0; DENOISE_BANDS],
            slow: [1.0; DENOISE_BANDS],
            noise: [1.0; DENOISE_BANDS],
            gain: [1.0; DENOISE_BANDS],
            env_coef: per(10.0),
            slow_coef: per(100.0),
            rise: 10f32.powf(0.3 / rate),
            attack: per(3.0),
            release: per(30.0),
            floor: 10f32.powf(-reduction_db.clamp(0.0, 40.0) / 20.0),
            over: 10f32.powf(sensitivity_db.clamp(-6.0, 12.0) / 10.0),
        })
    }

    /// RX-67: new reduction and sensitivity, set as `design` sets them, with the learned noise floors, envelopes and
    /// band gains kept, so a plugin's knob can move while it plays without the noise being learned again.
    pub fn retune(&mut self, reduction_db: f32, sensitivity_db: f32) {
        if reduction_db.is_finite() {
            self.floor = 10f32.powf(-reduction_db.clamp(0.0, 40.0) / 20.0);
        }
        if sensitivity_db.is_finite() {
            self.over = 10f32.powf(sensitivity_db.clamp(-6.0, 12.0) / 10.0);
        }
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        self.analyse(l, r);
        if self.tick % 32 == 0 {
            // spreading: a band beside one carrying signal is cut no lower than 80% of that one's gain, so the cuts'
            // skirts do not eat into the signal; noise right beside a sounding tone is masked by it
            let mut want = [0.0f32; DENOISE_BANDS];
            for (k, w) in want.iter_mut().enumerate() {
                let beside = if k > 0 { self.gain[k - 1] } else { 0.0 }.max(if k + 1 < DENOISE_BANDS { self.gain[k + 1] } else { 0.0 });
                *w = 20.0 * self.gain[k].max(0.8 * beside).max(1e-6).log10();
            }
            for k in 0..DENOISE_BANDS {
                // one step of correction for the other bands' spill at this band's centre, so the cascade gives each band
                // about what it asked for (the uncorrected skirts summed to 1.4 dB off a tone between open bands)
                // only for bands carrying signal: corrected too, the bands at the floor eased their cuts until the cascade
                // gave exactly the asked reduction at the centres, and the gaps came down 11 dB rather than 17
                let floor_db = 20.0 * self.floor.max(1e-6).log10();
                let spilt: f32 = if want[k] > floor_db + 1.0 { (0..DENOISE_BANDS).filter(|&j| j != k).map(|j| self.spill[k][j] * want[j]).sum() } else { 0.0 };
                let gain_db = (want[k] - spilt).clamp(-60.0, 12.0);
                if let Some(next) = Denoiser::eq_filter(k, &self.centres, gain_db, self.rate) {
                    self.eq[k].retune(&next);
                }
            }
        }
        self.tick = self.tick.wrapping_add(1);
        let (mut out_l, mut out_r) = (l, r);
        for f in &mut self.eq {
            out_l = f.process(0, out_l);
            out_r = f.process(1, out_r);
        }
        (out_l, out_r)
    }

    /// The signal path's filter for band `k` at `gain_db`: a low shelf at the bottom band, a high shelf at the top (a peak
    /// there, near Nyquist, cut 12 to 18 kHz by 12 dB and above 18 kHz by 4, where white noise has most of its power),
    /// peaks of Q 3.5 between (Q 2.65's skirts reached into neighbouring bands).
    fn eq_filter(k: usize, centres: &[f32; DENOISE_BANDS], gain_db: f32, rate: f32) -> Option<Biquad> {
        if k == 0 {
            Biquad::design(LOW_SHELF, centres[0] * 1.2, gain_db, 0.707, rate)
        } else if k == DENOISE_BANDS - 1 {
            Biquad::design(HIGH_SHELF, centres[k - 1] * 1.2, gain_db, 0.707, rate)
        } else {
            Biquad::design(PEAK, centres[k], gain_db, 3.5, rate)
        }
    }

    /// Each band's envelopes, learned floor and gain, from the input.
    #[inline]
    fn analyse(&mut self, l: f32, r: f32) {
        for k in 0..DENOISE_BANDS {
            let bl = self.bands[k].process(0, l);
            let br = self.bands[k].process(1, r);
            let power = 0.5 * (bl * bl + br * br);
            self.env[k] = self.env_coef * self.env[k] + (1.0 - self.env_coef) * power;
            self.slow[k] = self.slow_coef * self.slow[k] + (1.0 - self.slow_coef) * power;
            self.noise[k] = if self.slow[k] < self.noise[k] { self.slow[k] } else { self.noise[k] * self.rise };
            let e = self.env[k].max(1e-20);
            let target = ((e - self.over * self.noise[k]) / e).max(0.0).sqrt().max(self.floor);
            // a gain opens fast and closes more slowly (opening slowly held every onset about 5 dB down for its first 50 ms)
            let c = if target > self.gain[k] { self.attack } else { self.release };
            self.gain[k] = c * self.gain[k] + (1.0 - c) * target;
        }
    }

    /// Clears the filters, envelopes and gains (a seek); the learned noise floor is kept.
    pub fn reset(&mut self) {
        for band in self.bands.iter_mut().chain(self.eq.iter_mut()) {
            band.reset();
        }
        // the envelopes restart from the learned floor (from zero they would drag it to nothing)
        self.env = self.noise;
        self.slow = self.noise;
        self.gain = [1.0; DENOISE_BANDS];
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

/// PT-22: a realtime reverb after Jezar's Freeverb (released into the public domain): per channel eight damped comb
/// filters in parallel feeding four all-passes in series, the right channel's delays 23 samples longer for width,
/// every length scaled from its 44.1 kHz tuning to the rate. Room size sets the combs' feedback (0.7 to 0.98),
/// damping their low-pass; the dry signal is kept at 1 - mix and the tail added at mix times Freeverb's default wet
/// level, width blending the two tails.
#[derive(Debug, Clone, PartialEq)]
pub struct Reverb {
    combs: [[Vec<f32>; 8]; 2],
    comb_at: [[usize; 8]; 2],
    comb_store: [[f32; 8]; 2],
    allpasses: [[Vec<f32>; 4]; 2],
    allpass_at: [[usize; 4]; 2],
    feedback: f32,
    damp: f32,
    wet1: f32,
    wet2: f32,
    dry: f32,
}

const COMB_TUNING: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING: [usize; 4] = [556, 441, 341, 225];
const STEREO_SPREAD: usize = 23;

impl Reverb {
    /// `room` and `damping` from 0 to 1, `mix` from 0 (dry) to 1 (all reverb), `width` from 0 (mono) to 1; None for
    /// a non-positive rate.
    pub fn design(room: f32, damping: f32, mix: f32, width: f32, rate: f32) -> Option<Reverb> {
        if !(rate > 0.0) {
            return None;
        }
        let scale = |n: usize| ((n as f32 * rate / 44100.0).round() as usize).max(1);
        let spread = |c: usize| if c == 1 { STEREO_SPREAD } else { 0 };
        let combs = [0, 1].map(|c| COMB_TUNING.map(|n| vec![0.0f32; scale(n + spread(c))]));
        let allpasses = [0, 1].map(|c| ALLPASS_TUNING.map(|n| vec![0.0f32; scale(n + spread(c))]));
        let (room, damping, mix, width) = (room.clamp(0.0, 1.0), damping.clamp(0.0, 1.0), mix.clamp(0.0, 1.0), width.clamp(0.0, 1.0));
        // Freeverb's default wet level (its initial wet of 1/3 times its wet scaling of 3) at full mix; its maximum (3)
        // put a send-fed tail 6 dB above the dry burst that fed it
        let wet = mix;
        Some(Reverb {
            combs,
            comb_at: [[0; 8]; 2],
            comb_store: [[0.0; 8]; 2],
            allpasses,
            allpass_at: [[0; 4]; 2],
            feedback: 0.7 + 0.28 * room,
            damp: 0.4 * damping,
            wet1: wet * (0.5 + 0.5 * width),
            wet2: wet * (0.5 - 0.5 * width),
            dry: 1.0 - mix,
        })
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let input = (l + r) * 0.015; // Freeverb's fixed input gain
        let mut out = [0.0f32; 2];
        for c in 0..2 {
            let mut sum = 0.0f32;
            for k in 0..8 {
                let buf = &mut self.combs[c][k];
                let at = self.comb_at[c][k];
                let y = buf[at];
                let store = y * (1.0 - self.damp) + self.comb_store[c][k] * self.damp;
                self.comb_store[c][k] = if store.abs() < 1e-20 { 0.0 } else { store }; // no denormals in the tail
                buf[at] = input + self.comb_store[c][k] * self.feedback;
                self.comb_at[c][k] = if at + 1 == buf.len() { 0 } else { at + 1 };
                sum += y;
            }
            for k in 0..4 {
                let buf = &mut self.allpasses[c][k];
                let at = self.allpass_at[c][k];
                let held = buf[at];
                let y = held - sum;
                let next = sum + held * 0.5;
                buf[at] = if next.abs() < 1e-20 { 0.0 } else { next };
                self.allpass_at[c][k] = if at + 1 == buf.len() { 0 } else { at + 1 };
                sum = y;
            }
            out[c] = sum;
        }
        (l * self.dry + out[0] * self.wet1 + out[1] * self.wet2, r * self.dry + out[1] * self.wet1 + out[0] * self.wet2)
    }

    pub fn reset(&mut self) {
        for c in 0..2 {
            for b in self.combs[c].iter_mut().chain(self.allpasses[c].iter_mut()) {
                b.fill(0.0);
            }
            self.comb_at[c] = [0; 8];
            self.comb_store[c] = [0.0; 8];
            self.allpass_at[c] = [0; 4];
        }
    }
}

/// One stage of a bus or master chain: a filter, a compressor, the de-noiser or a reverb, run a stereo frame at a
/// time. The reverb's delay lines live behind a box, so a filter stage stays small.
#[derive(Debug, Clone, PartialEq)]
pub enum Stage {
    Filter(Biquad),
    Comp(Compressor),
    Denoise(Denoiser),
    Reverb(Box<Reverb>),
}

impl Stage {
    /// Kinds 1 to 5 are filters (a = freq, b = gain dB, c = Q); kind 6 is a compressor (a = threshold dB, b = ratio,
    /// c = attack ms, d = release ms, e = makeup dB). None for an unknown kind.
    pub fn design(kind: u8, a: f32, b: f32, c: f32, d: f32, e: f32, rate: f32) -> Option<Stage> {
        if kind == COMPRESSOR {
            Compressor::design(a, b, c, d, e, rate).map(Stage::Comp)
        } else if kind == DENOISE {
            Denoiser::design(a, b, rate).map(Stage::Denoise)
        } else if kind == REVERB {
            // PT-22: a = room size, b = damping, c = mix, d = width (each 0 to 1)
            Reverb::design(a, b, c, d, rate).map(|r| Stage::Reverb(Box::new(r)))
        } else {
            Biquad::design(kind, a, b, c, rate).map(Stage::Filter)
        }
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        match self {
            Stage::Filter(f) => (f.process(0, l), f.process(1, r)),
            Stage::Comp(c) => c.process(l, r),
            Stage::Denoise(d) => d.process(l, r),
            Stage::Reverb(v) => v.process(l, r),
        }
    }

    pub fn reset(&mut self) {
        match self {
            Stage::Filter(f) => f.reset(),
            Stage::Comp(c) => c.reset(),
            Stage::Denoise(d) => d.reset(),
            Stage::Reverb(v) => v.reset(),
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

    /// RX-24, RX-40, RX-49: 440 Hz bursts (300 ms on, 200 off) over white noise at -40 dBFS rms; after a second of
    /// learning the denoiser takes the noise in the gaps down by 12 dB or more and keeps the bursts' tone within 1 dB,
    /// and at no reduction it returns its input exactly.
    #[test]
    fn the_denoiser_learns_the_noise_and_keeps_the_bursts() {
        let rate = 48000.0f32;
        let n = 4 * 48000;
        let mut seed = 12345u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            ((seed >> 8) as f32 / 16_777_216.0 - 0.5) * 0.0346
        };
        let t = |i: usize| i as f32 / rate;
        let x: Vec<f32> = (0..n).map(|i| if t(i) % 0.5 < 0.3 { 0.3 * (2.0 * std::f32::consts::PI * 440.0 * t(i)).sin() } else { 0.0 } + noise()).collect();
        let mut d = Denoiser::design(20.0, 3.0, rate).unwrap();
        let y: Vec<f32> = x.iter().map(|&v| d.process(v, v).0).collect();
        let rms = |s: &[f32], keep: &dyn Fn(usize) -> bool| {
            let v: Vec<f32> = (48000..s.len()).filter(|&i| keep(i)).map(|i| s[i]).collect();
            (v.iter().map(|a| a * a).sum::<f32>() / v.len() as f32).sqrt()
        };
        let gap = |i: usize| (0.33..0.47).contains(&(t(i) % 0.5));
        let db = |a: f32, b: f32| 20.0 * (a / b).log10();
        let noise_cut = db(rms(&x, &gap), rms(&y, &gap));
        assert!(noise_cut >= 12.0, "the noise came down only {noise_cut} dB");
        let tone = |s: &[f32]| {
            let (mut c, mut q, mut m) = (0.0f32, 0.0f32, 0usize);
            for i in 48000..s.len() {
                if (0.05..0.25).contains(&(t(i) % 0.5)) {
                    let w = 2.0 * std::f32::consts::PI * 440.0 * t(i);
                    c += s[i] * w.cos();
                    q += s[i] * w.sin();
                    m += 1;
                }
            }
            2.0 * (c * c + q * q).sqrt() / m as f32
        };
        let tone_change = db(tone(&y), tone(&x));
        assert!(tone_change.abs() < 1.0, "the bursts' tone moved {tone_change} dB");
        let mut none = Denoiser::design(0.0, 3.0, rate).unwrap();
        assert!(x.iter().all(|&v| (none.process(v, v).0 - v).abs() < 1e-6), "no reduction changed the signal");
    }

    /// The reverb's impulse response, `seconds` long, as left and right.
    fn reverb_ir(room: f32, damping: f32, width: f32, seconds: f32) -> (Vec<f32>, Vec<f32>) {
        let rate = 48000.0;
        let mut v = Reverb::design(room, damping, 1.0, width, rate).unwrap();
        let n = (seconds * rate) as usize;
        (0..n).map(|i| v.process(if i == 0 { 1.0 } else { 0.0 }, if i == 0 { 1.0 } else { 0.0 })).unzip()
    }

    /// Seconds for the response's energy to fall 60 dB, by Schroeder's backward integration (fitted from -5 to -35 dB).
    fn rt60(y: &[f32]) -> f32 {
        let mut tail: Vec<f64> = y.iter().rev().scan(0.0f64, |s, &v| { *s += (v as f64) * (v as f64); Some(*s) }).collect();
        tail.reverse();
        let total = tail[0].max(1e-30);
        let at = |db: f64| tail.iter().position(|&e| 10.0 * (e / total).log10() <= db).unwrap_or(tail.len()) as f32;
        2.0 * (at(-35.0) - at(-5.0)) / 48000.0
    }

    /// PT-22: the reverb leaves the signal dry at mix 0, rings with a finite, decaying tail, longer in a bigger room,
    /// mono at width 0 and wide at 1, stays bounded at its largest room with no damping, and falls silent when reset.
    #[test]
    fn the_reverb_rings_by_its_room_and_stays_stable() {
        let rate = 48000.0;
        let mut dry = Reverb::design(0.8, 0.5, 0.0, 1.0, rate).unwrap();
        assert!((0..4800).all(|i| { let x = ((i as f32) * 0.37).sin(); let (l, r) = dry.process(x, -x); l == x && r == -x }), "mix 0 leaves the signal as it was");
        let (l, r) = reverb_ir(0.8, 0.5, 1.0, 4.0);
        assert!(l.iter().chain(&r).all(|v| v.is_finite()), "the tail is finite");
        let energy = |y: &[f32], a: usize, b: usize| y[a..b].iter().map(|v| v * v).sum::<f32>();
        assert!(energy(&l, 4800, 14400) > 10.0 * energy(&l, 96000, 105600), "the tail decays: 0.1 to 0.3 s holds far more than 2.0 to 2.2 s");
        let (small, big) = (rt60(&reverb_ir(0.3, 0.5, 1.0, 6.0).0), rt60(&reverb_ir(0.9, 0.5, 1.0, 6.0).0));
        assert!(small > 0.2 && big > 1.5 * small, "a bigger room rings longer (RT60 {small:.2} s against {big:.2} s)");
        let (ml, mr) = reverb_ir(0.8, 0.5, 0.0, 1.0);
        assert!(ml.iter().zip(&mr).all(|(a, b)| (a - b).abs() < 1e-6), "width 0 is mono");
        let corr = l.iter().zip(&r).map(|(a, b)| a * b).sum::<f32>() / (energy(&l, 0, l.len()) * energy(&r, 0, r.len())).sqrt();
        assert!(corr < 0.5, "width 1 is wide (left-right correlation {corr:.2})");
        let mut worst = Reverb::design(1.0, 0.0, 1.0, 1.0, rate).unwrap();
        let peak = (0..480000).map(|i| { let x = if (i / 1000) % 2 == 0 { 0.9 } else { -0.9 }; let (a, b) = worst.process(x, x); a.abs().max(b.abs()) }).fold(0.0f32, f32::max);
        assert!(peak.is_finite() && peak < 50.0, "the largest room with no damping stays bounded (peak {peak:.1})");
        worst.reset();
        assert!((0..48000).all(|_| worst.process(0.0, 0.0) == (0.0, 0.0)), "a reset reverb is silent");
        assert!(matches!(Stage::design(REVERB, 0.5, 0.5, 0.3, 1.0, 0.0, rate), Some(Stage::Reverb(_))), "kind 8 designs a reverb stage");
    }
}
