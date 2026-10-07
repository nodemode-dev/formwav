use formwav_studio::{build, catalog, spec, Processor, Unit};

const RATE: f32 = 48000.0;

fn tone(freq: f32, amp: f32, n: usize) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / RATE).sin()).collect()
}

fn make(id: &str, values: &[(&str, f32)]) -> Box<dyn Processor> {
    let s = spec(id).unwrap();
    let mut p = build(id, RATE).unwrap();
    for (k, v) in values {
        let i = s.index(k).unwrap_or_else(|| panic!("{id} has no {k}"));
        p.set(i, s.params[i].clamp(*v));
    }
    p
}

fn run(p: &mut dyn Processor, left: &[f32], right: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (left.to_vec(), right.to_vec());
    for (a, b) in l.chunks_mut(512).zip(r.chunks_mut(512)) {
        p.run(a, b);
    }
    (l, r)
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

fn db(v: f32) -> f32 {
    20.0 * v.max(1e-12).log10()
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0, |m, v| m.max(v.abs()))
}

/// The amplitude of `freq` in `x`, by correlation with a sine and a cosine.
fn amplitude(x: &[f32], freq: f32) -> f32 {
    let (mut s, mut c) = (0f64, 0f64);
    for (i, v) in x.iter().enumerate() {
        let w = 2.0 * std::f64::consts::PI * f64::from(freq) * i as f64 / f64::from(RATE);
        s += f64::from(*v) * w.sin();
        c += f64::from(*v) * w.cos();
    }
    (2.0 * (s * s + c * c).sqrt() / x.len() as f64) as f32
}

#[test]
fn the_catalog_describes_every_processor_and_each_builds() {
    let all = catalog();
    assert_eq!(all.len(), 24);
    let mut ids: Vec<&str> = all.iter().map(|s| s.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), 24, "ids are unique");
    for s in all {
        for p in s.params {
            assert!(p.min <= p.default && p.default <= p.max, "{}.{} default in range", s.id, p.id);
            match p.unit {
                Unit::Choice => assert_eq!(p.choices.len() as f32, p.max + 1.0, "{}.{} one choice a step", s.id, p.id),
                Unit::Toggle => assert!(p.min == 0.0 && p.max == 1.0),
                _ => assert!(p.choices.is_empty()),
            }
        }
        for rate in [22050.0, 44100.0, 48000.0, 96000.0, 192000.0] {
            assert!(build(s.id, rate).is_some(), "{} at {rate}", s.id);
        }
    }
    assert!(build("nothing", RATE).is_none());
    assert!(build("gain", 500.0).is_none() && build("gain", f32::NAN).is_none());
    let p = &spec("compressor").unwrap().params[1];
    assert_eq!((p.clamp(500.0), p.clamp(f32::NAN), p.clamp(0.0)), (30.0, 3.0, 1.0));
}

#[test]
fn silence_stays_silent_and_noise_stays_finite_whatever_the_settings() {
    let n = 48000;
    let mut seed = 0x1234_5678u32;
    let mut rand = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f32 / u32::MAX as f32
    };
    let noise: Vec<f32> = (0..n).map(|_| (rand() * 2.0 - 1.0) * 0.5).collect();
    for s in catalog() {
        if s.id != "tone" {
            let mut p = build(s.id, RATE).unwrap();
            let (l, r) = run(p.as_mut(), &vec![0.0; n], &vec![0.0; n]);
            assert!(peak(&l) == 0.0 && peak(&r) == 0.0, "{} in silence", s.id);
        }
        for _ in 0..6 {
            let mut p = build(s.id, RATE).unwrap();
            for (i, param) in s.params.iter().enumerate() {
                p.set(i, param.clamp(param.min + rand() * (param.max - param.min)));
            }
            let (l, r) = run(p.as_mut(), &noise, &noise);
            assert!(l.iter().chain(r.iter()).all(|v| v.is_finite() && v.abs() < 1e5), "{} on noise", s.id);
        }
    }
}

#[test]
fn a_bell_gives_its_gain_at_its_frequency_and_a_notch_takes_its_frequency_out() {
    let n = 48000;
    let bell = [("type", 2.0), ("freq", 1000.0), ("gain", 6.0), ("q", 1.0)];
    let x = tone(1000.0, 0.1, n);
    let (l, _) = run(make("band_eq", &bell).as_mut(), &x, &x);
    assert!((db(rms(&l[24000..])) - db(rms(&x[24000..])) - 6.0).abs() < 0.05);
    let low = tone(60.0, 0.1, n);
    let (l, _) = run(make("band_eq", &bell).as_mut(), &low, &low);
    assert!((db(rms(&l[24000..])) - db(rms(&low[24000..]))).abs() < 0.3);
    let notch = [("type", 3.0), ("freq", 1000.0), ("q", 4.0)];
    let (l, _) = run(make("band_eq", &notch).as_mut(), &x, &x);
    assert!(db(rms(&l[24000..])) - db(rms(&x[24000..])) < -30.0);
    let near = tone(300.0, 0.1, n);
    let (l, _) = run(make("band_eq", &notch).as_mut(), &near, &near);
    assert!((db(rms(&l[24000..])) - db(rms(&near[24000..]))).abs() < 1.0);
}

#[test]
fn a_cut_falls_by_its_slope_an_octave() {
    let n = 96000;
    for (slope, per_octave) in [(0.0, 6.0), (1.0, 12.0), (2.0, 18.0), (3.0, 24.0)] {
        let cut = [("low_cut", 1.0), ("low_cut_freq", 400.0), ("low_cut_slope", slope)];
        let x = tone(50.0, 0.1, n);
        let (l, _) = run(make("seven_band_eq", &cut).as_mut(), &x, &x);
        let fall = db(rms(&x[48000..])) - db(rms(&l[48000..]));
        assert!((fall - 3.0 * per_octave).abs() < 3.5, "slope {slope}: {fall} dB three octaves down");
        let y = tone(8000.0, 0.1, n);
        let (l, _) = run(make("seven_band_eq", &cut).as_mut(), &y, &y);
        assert!((db(rms(&l[48000..])) - db(rms(&y[48000..]))).abs() < 0.2);
    }
}

#[test]
fn a_compressor_settles_on_its_curve_and_its_lookahead_is_its_latency() {
    let n = 48000;
    let mut c = make("compressor", &[("threshold", -24.0), ("ratio", 4.0), ("knee", 6.0), ("attack", 1.0), ("release", 300.0)]);
    let x = tone(500.0, 0.5, n);
    let (l, _) = run(c.as_mut(), &x, &x);
    let want = -24.0 + (db(0.5) + 24.0) / 4.0;
    assert!((db(peak(&l[36000..])) - want).abs() < 1.0, "peak {} dB, the curve {want}", db(peak(&l[36000..])));
    assert!((c.reduction_db() - (db(0.5) - want)).abs() < 1.0, "reduction {}", c.reduction_db());
    let quiet = tone(500.0, 0.01, n);
    let (l, _) = run(make("compressor", &[("threshold", -24.0), ("knee", 0.0)]).as_mut(), &quiet, &quiet);
    assert!((rms(&l) - rms(&quiet)).abs() < 1e-6, "below the threshold nothing changes");
    let mut c = make("compressor", &[("lookahead", 5.0)]);
    assert_eq!(c.latency(), 240);
    let mut impulse = vec![0.0; 1000];
    impulse[0] = 0.01;
    let (l, _) = run(c.as_mut(), &impulse, &impulse);
    assert_eq!(l.iter().position(|v| *v != 0.0), Some(240));
}

#[test]
fn a_gate_closes_to_its_floor_below_the_threshold_and_opens_above_it() {
    let n = 48000;
    let soft = tone(300.0, 0.001, n);
    let (l, _) = run(make("gate", &[("threshold", -45.0), ("ratio", 40.0), ("floor", 60.0), ("release", 100.0)]).as_mut(), &soft, &soft);
    let closed = db(rms(&soft[40000..])) - db(rms(&l[40000..]));
    assert!((closed - 60.0).abs() < 0.5, "{closed} dB");
    let loud = tone(300.0, 0.1, n);
    let (l, _) = run(make("gate", &[("threshold", -45.0)]).as_mut(), &loud, &loud);
    assert!((db(rms(&l[24000..])) - db(rms(&loud[24000..]))).abs() < 0.05);
}

#[test]
fn a_de_esser_turns_down_the_band_above_its_frequency_and_leaves_the_rest() {
    let n = 48000;
    let settings = [("freq", 5000.0), ("threshold", -30.0), ("depth", 12.0)];
    let ess = tone(8000.0, 0.3, n);
    let (l, _) = run(make("de_esser", &settings).as_mut(), &ess, &ess);
    assert!(db(rms(&ess[24000..])) - db(rms(&l[24000..])) > 6.0);
    let voice = tone(300.0, 0.3, n);
    let (l, _) = run(make("de_esser", &settings).as_mut(), &voice, &voice);
    assert!((db(rms(&l[24000..])) - db(rms(&voice[24000..]))).abs() < 0.1);
}

#[test]
fn a_maximizer_never_passes_its_ceiling() {
    let n = 48000;
    let mut m = make("maximizer", &[("threshold", -18.0), ("ceiling", -1.0)]);
    assert_eq!(m.latency(), 72);
    let x = tone(220.0, 0.9, n);
    let y: Vec<f32> = x.iter().enumerate().map(|(i, v)| if i % 9000 == 4500 { 1.0 } else { *v }).collect();
    let (l, r) = run(m.as_mut(), &y, &x);
    let ceiling = 10f32.powf(-1.0 / 20.0);
    assert!(peak(&l) <= ceiling + 1e-6 && peak(&r) <= ceiling + 1e-6);
    assert!(m.reduction_db() > 15.0);
    assert!(db(peak(&l[24000..])) > -1.2, "it brings the level up to the ceiling");
}

/// The level of `x` in 20 ms windows, in dB.
fn envelope(x: &[f32]) -> Vec<f32> {
    x.chunks(960).map(|c| db(rms(c))).collect()
}

#[test]
fn the_reverbs_decay_by_sixty_db_about_their_decay_time() {
    for id in ["room", "plate"] {
        for decay in [0.8f32, 2.0] {
            let mut v = make(id, &[("mix", 100.0), ("decay", decay), ("pre_delay", 0.0), ("low_cut", 20.0), ("damping", 16000.0)]);
            let n = (RATE * (decay * 2.0 + 0.5)) as usize;
            let mut x = vec![0.0; n];
            x[0] = 1.0;
            let (l, r) = run(v.as_mut(), &x, &x);
            let both: Vec<f32> = l.iter().zip(&r).map(|(a, b)| 0.5 * (a + b)).collect();
            let e = envelope(&both);
            let top = e[..20].iter().copied().fold(f32::MIN, f32::max);
            let cross = |level: f32| e.iter().enumerate().skip(5).find(|(_, v)| **v < top + level).map(|(i, _)| i as f32 * 0.02).unwrap_or(f32::MAX);
            let rt = (cross(-35.0) - cross(-5.0)) * 2.0;
            assert!((rt / decay - 1.0).abs() < 0.35, "{id} at {decay} s decays in {rt} s");
            assert!(v.tail() >= (decay * RATE) as usize);
        }
    }
}

#[test]
fn a_pitch_shift_of_an_octave_puts_440_hz_at_880() {
    let n = 48000;
    let x = tone(440.0, 0.3, n);
    let (l, _) = run(make("pitch", &[("semitones", 12.0)]).as_mut(), &x, &x);
    let tail = &l[12000..];
    assert!(db(amplitude(tail, 880.0)) - db(amplitude(tail, 440.0)) > 15.0);
    let (l, _) = run(make("pitch", &[("semitones", -12.0)]).as_mut(), &x, &x);
    let tail = &l[12000..];
    assert!(db(amplitude(tail, 220.0)) - db(amplitude(tail, 440.0)) > 15.0);
    let (l, _) = run(make("pitch", &[]).as_mut(), &x, &x);
    assert_eq!(l, x, "no shift leaves the signal alone");
}

#[test]
fn rectifying_a_tone_doubles_it_full_wave_and_keeps_it_half_wave() {
    let n = 48000;
    let x = tone(100.0, 0.5, n);
    let (l, _) = run(make("rectify", &[("mode", 0.0)]).as_mut(), &x, &x);
    let tail = &l[24000..];
    assert!(db(amplitude(tail, 200.0)) - db(amplitude(tail, 100.0)) > 30.0);
    assert!(tail.iter().sum::<f32>().abs() / (tail.len() as f32) < 0.01, "no offset left");
    let (l, _) = run(make("rectify", &[("mode", 1.0)]).as_mut(), &x, &x);
    let tail = &l[24000..];
    assert!(amplitude(tail, 100.0) > amplitude(tail, 200.0));
}

#[test]
fn the_utilities_do_exactly_what_they_say() {
    let mut impulse = vec![0.0; 2000];
    impulse[3] = 0.5;
    let (l, _) = run(make("offset", &[("ms", 10.0), ("samples", 7.0)]).as_mut(), &impulse, &impulse);
    assert_eq!(l.iter().position(|v| *v != 0.0), Some(3 + 487));
    let x = tone(1000.0, 0.25, 4800);
    let (l, _) = run(make("gain", &[("gain", -6.0)]).as_mut(), &x, &x);
    assert!(l.iter().zip(&x).all(|(a, b)| (a - b * 10f32.powf(-0.3)).abs() < 1e-7));
    let (l, _) = run(make("trim", &[("gain", 0.0), ("invert", 1.0)]).as_mut(), &x, &x);
    assert!(l.iter().zip(&x).all(|(a, b)| *a == -*b));
    let (l, _) = run(make("polarity", &[]).as_mut(), &x, &x);
    assert!(l.iter().zip(&x).all(|(a, b)| *a == -*b));
    let offset = vec![0.5; 48000];
    let (l, _) = run(make("dc_block", &[("cutoff", 5.0)]).as_mut(), &offset, &offset);
    assert!(l[47999].abs() < 0.005);
}

#[test]
fn the_test_tone_plays_its_wave_at_its_level_in_place_of_the_input() {
    let x = tone(50.0, 0.5, 48000);
    let (l, r) = run(make("tone", &[("waveform", 0.0), ("freq", 1000.0), ("level", -18.0)]).as_mut(), &x, &x);
    assert!((peak(&l) - 10f32.powf(-0.9)).abs() < 1e-3 && l == r);
    assert!(amplitude(&l, 50.0) < 1e-4, "the input is replaced");
    for wave in [1.0, 2.0, 3.0] {
        let (l, _) = run(make("tone", &[("waveform", wave), ("freq", 1000.0), ("level", -6.0)]).as_mut(), &x, &x);
        assert!((peak(&l) - 10f32.powf(-0.3)).abs() < 1e-3, "wave {wave}");
    }
    let (pink, _) = run(make("tone", &[("waveform", 4.0), ("level", 0.0)]).as_mut(), &x, &x);
    let (white, _) = run(make("tone", &[("waveform", 5.0), ("level", 0.0)]).as_mut(), &x, &x);
    assert!(rms(&white) > 0.4 && peak(&white) <= 1.0);
    let low_band = |s: &[f32]| amplitude(s, 100.0) + amplitude(s, 110.0) + amplitude(s, 120.0);
    let high_band = |s: &[f32]| amplitude(s, 8000.0) + amplitude(s, 8800.0) + amplitude(s, 9600.0);
    assert!(db(low_band(&pink)) - db(high_band(&pink)) > db(low_band(&white)) - db(high_band(&white)) + 6.0, "pink falls with frequency");
}

#[test]
fn dither_lands_on_the_words_steps_keeps_silence_and_keeps_a_tone_below_a_step() {
    let step = 1.0 / 32768.0;
    let x = tone(1000.0, 0.3 * step, 48000);
    let (l, _) = run(make("dither", &[("bits", 2.0)]).as_mut(), &x, &x);
    assert!(l.iter().all(|v| ((v / step) - (v / step).round()).abs() < 1e-3));
    assert!(amplitude(&l, 1000.0) > 0.2 * step, "the tone survives as the noise's average");
    let rounded: Vec<f32> = x.iter().map(|v| (v / step).round() * step).collect();
    assert_eq!(peak(&rounded), 0.0, "rounding alone loses it");
    let (z, _) = run(make("dither", &[("bits", 2.0), ("shaping", 1.0)]).as_mut(), &vec![0.0; 4800], &vec![0.0; 4800]);
    assert_eq!(peak(&z), 0.0);
}

#[test]
fn the_time_effects_delay_sweep_and_colour() {
    let mut impulse = vec![0.0; 9600];
    impulse[0] = 1.0;
    let (l, _) = run(make("delay", &[("time", 100.0), ("feedback", 0.0), ("mix", 100.0), ("mod_depth", 0.0), ("tone", 20000.0)]).as_mut(), &impulse, &impulse);
    let first = l.iter().position(|v| v.abs() > 0.5).unwrap();
    assert!((first as i64 - 4800).abs() <= 1, "the repeat at 100 ms: {first}");
    let x = tone(700.0, 0.3, 48000);
    for id in ["chorus", "flanger", "phaser"] {
        let (l, r) = run(make(id, &[("mix", 50.0)]).as_mut(), &x, &x);
        let moved = l.iter().zip(&x).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(moved > 0.01 && l != r, "{id} changes the signal and spreads it");
    }
    let small = tone(500.0, 0.01, 4800);
    for character in [0.0, 2.0] {
        let (s, _) = run(make("drive", &[("drive", 0.0), ("character", character)]).as_mut(), &small, &small);
        assert!((rms(&s) - rms(&small)).abs() < 2e-5, "a small signal passes curve {character} at its own level");
    }
    let hot = tone(500.0, 0.9, 48000);
    let (s, _) = run(make("drive", &[("drive", 24.0), ("character", 1.0)]).as_mut(), &hot, &hot);
    assert!(peak(&s[24000..]) < 1.5 && amplitude(&s[24000..], 1000.0) > 0.01, "bounded, with an even harmonic");
    let (s, _) = run(make("drive", &[("drive", 24.0), ("character", 0.0)]).as_mut(), &hot, &hot);
    assert!(amplitude(&s[24000..], 1000.0) < 1e-3, "the centred curves add odd harmonics only");
    let (lo, _) = run(make("bitcrush", &[("bits", 4.0), ("downsample", 1000.0)]).as_mut(), &hot, &hot);
    assert!(lo.iter().all(|v| (v * 8.0 - (v * 8.0).round()).abs() < 1e-5));
    assert!(lo[480..960].windows(2).filter(|w| w[0] != w[1]).count() <= 11, "held for 48 samples at a time");
}
