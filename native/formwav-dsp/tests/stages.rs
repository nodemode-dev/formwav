use std::f64::consts::PI;

use formwav_dsp::fx::{
    Stage, CHORUS, COMPRESSOR, DECLICK, DEHUM, DENOISE, DEREVERB, ECHO, FLANGER, GATE, HIGHPASS, HIGH_SHELF, LIMITER,
    LOWPASS, LOW_SHELF, PEAK, PHASER, REVERB, TREMOLO, VOICE,
};

const RATE: f32 = 48000.0;

struct Kind {
    kind: u8,
    name: &'static str,
    ranges: [(f32, f32); 5],
    init: [f32; 5],
    neutral: [f32; 5],
    transparent_when_neutral: bool,
}

const fn fixed(v: f32) -> (f32, f32) {
    (v, v)
}

const NONE: (f32, f32) = fixed(0.0);
const FREQ: (f32, f32) = (20.0, 20000.0);

const CATALOGUE: [Kind; 19] = [
    Kind { kind: HIGHPASS, name: "highpass", ranges: [FREQ, NONE, (0.1, 18.0), NONE, NONE], init: [100.0, 0.0, 0.707, 0.0, 0.0], neutral: [20.0, 0.0, 0.707, 0.0, 0.0], transparent_when_neutral: false },
    Kind { kind: LOWPASS, name: "lowpass", ranges: [FREQ, NONE, (0.1, 18.0), NONE, NONE], init: [8000.0, 0.0, 0.707, 0.0, 0.0], neutral: [20000.0, 0.0, 0.707, 0.0, 0.0], transparent_when_neutral: false },
    Kind { kind: PEAK, name: "peak", ranges: [FREQ, (-24.0, 24.0), (0.1, 18.0), NONE, NONE], init: [1000.0, 0.0, 1.0, 0.0, 0.0], neutral: [1000.0, 0.0, 1.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: LOW_SHELF, name: "lowshelf", ranges: [FREQ, (-24.0, 24.0), fixed(0.707), NONE, NONE], init: [200.0, 0.0, 0.707, 0.0, 0.0], neutral: [200.0, 0.0, 0.707, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: HIGH_SHELF, name: "highshelf", ranges: [FREQ, (-24.0, 24.0), fixed(0.707), NONE, NONE], init: [6000.0, 0.0, 0.707, 0.0, 0.0], neutral: [6000.0, 0.0, 0.707, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: COMPRESSOR, name: "compressor", ranges: [(-60.0, 0.0), (1.0, 20.0), fixed(10.0), fixed(150.0), (0.0, 24.0)], init: [-20.0, 4.0, 10.0, 150.0, 0.0], neutral: [-20.0, 1.0, 10.0, 150.0, 0.0], transparent_when_neutral: true },
    Kind { kind: DENOISE, name: "denoise", ranges: [(0.0, 40.0), (-6.0, 12.0), NONE, NONE, NONE], init: [12.0, 0.0, 0.0, 0.0, 0.0], neutral: [0.0, 0.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: REVERB, name: "reverb", ranges: [(0.0, 1.0), (0.0, 1.0), (0.0, 1.0), (0.0, 1.0), NONE], init: [0.5, 0.5, 0.3, 1.0, 0.0], neutral: [0.5, 0.5, 0.0, 1.0, 0.0], transparent_when_neutral: true },
    Kind { kind: ECHO, name: "echo", ranges: [(1.0, 2000.0), (0.0, 0.95), (0.0, 1.0), NONE, NONE], init: [300.0, 0.35, 0.4, 0.0, 0.0], neutral: [300.0, 0.35, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: CHORUS, name: "chorus", ranges: [(0.05, 5.0), (0.0, 10.0), (0.0, 1.0), NONE, NONE], init: [0.8, 3.0, 0.5, 0.0, 0.0], neutral: [0.8, 3.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: LIMITER, name: "limiter", ranges: [(-30.0, 0.0), (1.0, 1000.0), NONE, NONE, NONE], init: [-1.0, 80.0, 0.0, 0.0, 0.0], neutral: [0.0, 80.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: TREMOLO, name: "tremolo", ranges: [(0.05, 20.0), (0.0, 1.0), (0.0, 1.0), NONE, NONE], init: [4.0, 0.5, 0.0, 0.0, 0.0], neutral: [4.0, 0.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: GATE, name: "gate", ranges: [(-80.0, 0.0), (1.0, 2000.0), (-80.0, 0.0), NONE, NONE], init: [-40.0, 100.0, -60.0, 0.0, 0.0], neutral: [-80.0, 100.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: PHASER, name: "phaser", ranges: [(0.05, 10.0), (0.0, 1.0), (0.0, 0.9), NONE, NONE], init: [0.5, 1.0, 0.5, 0.0, 0.0], neutral: [0.5, 0.0, 0.0, 0.0, 0.0], transparent_when_neutral: false },
    Kind { kind: FLANGER, name: "flanger", ranges: [(0.05, 5.0), (0.0, 5.0), (-0.9, 0.9), NONE, NONE], init: [0.25, 3.0, 0.5, 0.0, 0.0], neutral: [0.25, 0.0, 0.0, 0.0, 0.0], transparent_when_neutral: false },
    Kind { kind: VOICE, name: "voice", ranges: [(0.0, 1.0), NONE, NONE, NONE, NONE], init: [1.0, 0.0, 0.0, 0.0, 0.0], neutral: [0.0, 0.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
    Kind { kind: DEHUM, name: "dehum", ranges: [(20.0, 400.0), (1.0, 16.0), (1.0, 200.0), NONE, NONE], init: [60.0, 8.0, 30.0, 0.0, 0.0], neutral: [60.0, 8.0, 30.0, 0.0, 0.0], transparent_when_neutral: false },
    Kind { kind: DECLICK, name: "declick", ranges: [(3.0, 30.0), (0.1, 2.0), NONE, NONE, NONE], init: [8.0, 1.0, 0.0, 0.0, 0.0], neutral: [8.0, 1.0, 0.0, 0.0, 0.0], transparent_when_neutral: false },
    Kind { kind: DEREVERB, name: "dereverb", ranges: [(0.2, 3.0), (0.0, 30.0), NONE, NONE, NONE], init: [0.8, 6.0, 0.0, 0.0, 0.0], neutral: [0.8, 0.0, 0.0, 0.0, 0.0], transparent_when_neutral: true },
];

fn kind(name: &str) -> &'static Kind {
    CATALOGUE.iter().find(|k| k.name == name).expect("a kind in the catalogue")
}

fn design(k: &Kind, p: [f32; 5], rate: f32) -> Stage {
    Stage::design(k.kind, p[0], p[1], p[2], p[3], p[4], rate).unwrap_or_else(|| panic!("{} refused {:?} at {} Hz", k.name, p, rate))
}

fn with(k: &Kind, changes: &[(usize, f32)]) -> [f32; 5] {
    let mut p = k.init;
    for &(i, v) in changes {
        p[i] = v;
    }
    p
}

fn run(stage: &mut Stage, x: &[f32]) -> Vec<f32> {
    x.iter().map(|&s| stage.process(s, s).0).collect()
}

fn secs(s: f32) -> usize {
    (s * RATE) as usize
}

fn noise(n: usize, amp: f32, seed: u64) -> Vec<f32> {
    let mut state = seed | 1;
    (0..n)
        .map(|_| {
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            let v = (state.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 40) as f32 / (1u64 << 24) as f32;
            amp * (2.0 * v - 1.0)
        })
        .collect()
}

fn tone(freq: f32, n: usize, amp: f32) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * PI * freq as f64 * i as f64 / RATE as f64).sin() as f32).collect()
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / x.len().max(1) as f64).sqrt() as f32
}

fn db(v: f32) -> f32 {
    20.0 * v.max(1e-12).log10()
}

fn peak(x: &[f32]) -> f32 {
    x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

fn gain_db(stage_kind: &Kind, p: [f32; 5], freq: f32) -> f32 {
    let mut s = design(stage_kind, p, RATE);
    let x = tone(freq, secs(1.0), 0.25);
    let y = run(&mut s, &x);
    let tail = secs(0.5);
    db(rms(&y[tail..])) - db(rms(&x[tail..]))
}

fn envelope(y: &[f32], window: usize) -> Vec<f32> {
    y.chunks(window).map(rms).collect()
}

fn correlation(x: &[f32], y: &[f32], lag: usize) -> f32 {
    let n = x.len().min(y.len().saturating_sub(lag));
    let (mut xy, mut xx, mut yy) = (0f64, 0f64, 0f64);
    for i in 0..n {
        let (a, b) = (x[i] as f64, y[i + lag] as f64);
        xy += a * b;
        xx += a * a;
        yy += b * b;
    }
    (xy / (xx * yy).sqrt().max(1e-30)) as f32
}

fn hostile_signal() -> Vec<f32> {
    let mut x = noise(secs(0.1), 1.0, 7);
    x.extend(std::iter::repeat_n(0.9, secs(0.05)));
    x.extend(std::iter::repeat_n(0.0, secs(0.05)));
    x.extend((0..secs(0.05)).map(|i| if i % 100 == 0 { if i % 200 == 0 { 4.0 } else { -4.0 } } else { 0.0 }));
    x.extend(tone(3000.0, secs(0.05), 4.0));
    x
}

fn corners(k: &Kind) -> Vec<[f32; 5]> {
    let mut out: Vec<[f32; 5]> = vec![];
    for mask in 0..32u32 {
        let mut p = [0.0; 5];
        for (i, &(lo, hi)) in k.ranges.iter().enumerate() {
            p[i] = if mask & (1 << i) == 0 { lo } else { hi };
        }
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

#[test]
fn every_kind_designs_at_its_default_at_the_session_rates() {
    for k in CATALOGUE.iter() {
        for rate in [44100.0, 48000.0, 96000.0] {
            design(k, k.init, rate);
        }
    }
}

#[test]
fn every_kind_stays_finite_and_bounded_at_every_corner_of_its_ranges() {
    let x = hostile_signal();
    for k in CATALOGUE.iter() {
        for p in corners(k) {
            let mut s = design(k, p, RATE);
            for (i, &v) in x.iter().enumerate() {
                let (l, r) = s.process(v, -v);
                assert!(l.is_finite() && r.is_finite(), "{} at {:?}: not finite at sample {}", k.name, p, i);
                assert!(l.abs() < 1000.0 && r.abs() < 1000.0, "{} at {:?}: ran away to {} at sample {}", k.name, p, l.abs().max(r.abs()), i);
            }
        }
    }
}

#[test]
fn silence_stays_silent_through_every_kind() {
    let zeros = vec![0.0; secs(0.25)];
    for k in CATALOGUE.iter() {
        let mut s = design(k, k.init, RATE);
        let y = run(&mut s, &zeros);
        assert!(peak(&y) < 1e-6, "{} made {} from silence", k.name, peak(&y));
    }
}

#[test]
fn reset_leaves_no_tail_in_any_kind() {
    let loud = noise(secs(0.25), 0.5, 11);
    let zeros = vec![0.0; secs(0.25)];
    for k in CATALOGUE.iter() {
        let mut s = design(k, k.init, RATE);
        run(&mut s, &loud);
        s.reset();
        let y = run(&mut s, &zeros);
        assert!(peak(&y) < 1e-6, "{} kept {} after reset", k.name, peak(&y));
    }
}

#[test]
fn each_kind_delays_its_signal_by_exactly_the_latency_it_reports() {
    let x = noise(secs(0.5), 0.25, 19);
    for k in CATALOGUE.iter() {
        let mut s = design(k, k.neutral, RATE);
        let latency = s.latency();
        let y = run(&mut s, &x);
        let at = correlation(&x, &y, latency);
        assert!(at > 0.3, "{}: correlation {} at its reported latency of {} samples", k.name, at, latency);
        for lag in [latency + 1, latency.saturating_sub(1)].into_iter().filter(|&l| l != latency) {
            assert!(correlation(&x, &y, lag) < at, "{}: lag {} correlates better than the reported {}", k.name, lag, latency);
        }
    }
}

#[test]
fn neutral_settings_give_the_input_back_unchanged() {
    let x = noise(secs(0.5), 0.25, 23);
    for k in CATALOGUE.iter().filter(|k| k.transparent_when_neutral) {
        let mut s = design(k, k.neutral, RATE);
        let latency = s.latency();
        let y = run(&mut s, &x);
        let start = secs(0.1);
        let residual: Vec<f32> = (start..x.len() - latency).map(|i| y[i + latency] - x[i]).collect();
        let left = db(rms(&residual)) - db(rms(&x[start..]));
        assert!(left < -60.0, "{} at {:?}: the input came back with a residual of {:.1} dB", k.name, k.neutral, left);
    }
}

#[test]
fn the_catalogue_latency_promises_hold_at_48_khz() {
    let ms = |name: &str| design(kind(name), kind(name).init, RATE).latency() as f32 * 1000.0 / RATE;
    assert_eq!((ms("dereverb")).round(), 21.0, "De-reverb promises 21 ms behind: {} ms", ms("dereverb"));
    assert_eq!((ms("declick") * 2.0).round() / 2.0, 3.5, "De-click promises 3.5 ms behind: {} ms", ms("declick"));
}

#[test]
fn the_lowpass_cuts_above_and_passes_below() {
    let p = with(kind("lowpass"), &[(0, 2000.0)]);
    assert!(gain_db(kind("lowpass"), p, 8000.0) < -20.0, "two octaves above: {:.1} dB", gain_db(kind("lowpass"), p, 8000.0));
    assert!(gain_db(kind("lowpass"), p, 500.0).abs() < 1.0, "two octaves below: {:.1} dB", gain_db(kind("lowpass"), p, 500.0));
}

#[test]
fn the_shelves_move_their_end_and_leave_the_other() {
    let low = kind("lowshelf");
    for gain in [12.0, -12.0] {
        let p = with(low, &[(0, 200.0), (1, gain)]);
        let lows = gain_db(low, p, 30.0);
        let highs = gain_db(low, p, 5000.0);
        assert!((lows - gain).abs() < 1.5, "low shelf {gain} dB: 30 Hz moved {lows:.1} dB");
        assert!(highs.abs() < 1.0, "low shelf {gain} dB: 5 kHz moved {highs:.1} dB");
    }
    let high = kind("highshelf");
    for gain in [12.0, -12.0] {
        let p = with(high, &[(0, 2000.0), (1, gain)]);
        let highs = gain_db(high, p, 12000.0);
        let lows = gain_db(high, p, 100.0);
        assert!((highs - gain).abs() < 1.5, "high shelf {gain} dB: 12 kHz moved {highs:.1} dB");
        assert!(lows.abs() < 1.0, "high shelf {gain} dB: 100 Hz moved {lows:.1} dB");
    }
}

#[test]
fn the_echo_repeats_at_its_delay_and_each_repeat_is_quieter() {
    let k = kind("echo");
    let mut s = design(k, with(k, &[(0, 300.0), (1, 0.35), (2, 0.4)]), RATE);
    let mut x = vec![0.0; secs(1.2)];
    x[0] = 1.0;
    let y = run(&mut s, &x);
    let around = |t: f32| peak(&y[secs(t) - secs(0.002)..secs(t) + secs(0.002)]);
    let repeats = [around(0.3), around(0.6), around(0.9)];
    assert!(repeats[0] > 0.05, "no repeat at 300 ms: {:?}", repeats);
    assert!(repeats[0] > repeats[1] && repeats[1] > repeats[2] && repeats[2] > 0.0, "the repeats do not fade: {:?}", repeats);
    let ratio = repeats[1] / repeats[0];
    assert!((ratio - 0.35).abs() < 0.05, "each repeat should be the feedback times the last: {ratio:.3}");
    let between = peak(&y[secs(0.1)..secs(0.25)]);
    assert!(between < 1e-6, "sound between the dry hit and the first repeat: {between}");
}

#[test]
fn the_limiter_never_passes_its_ceiling() {
    let k = kind("limiter");
    for ceiling in [-1.0f32, -12.0] {
        let mut s = design(k, with(k, &[(0, ceiling), (1, 80.0)]), RATE);
        let mut x = vec![0.0; secs(0.2)];
        x.extend(tone(1000.0, secs(0.5), 4.0));
        x.extend(noise(secs(0.3), 4.0, 29));
        let y = run(&mut s, &x);
        let over = db(peak(&y)) - ceiling;
        assert!(over <= 0.1, "ceiling {ceiling} dB passed by {over:.2} dB");
    }
}

#[test]
fn the_limiter_leaves_audio_under_its_ceiling_alone() {
    let k = kind("limiter");
    let mut s = design(k, k.init, RATE);
    let x = tone(1000.0, secs(0.5), 0.1);
    let y = run(&mut s, &x);
    assert!((db(rms(&y)) - db(rms(&x))).abs() < 0.01, "a -20 dB tone changed by {:.3} dB", db(rms(&y)) - db(rms(&x)));
}

fn gated(release_ms: f32) -> (Vec<f32>, Vec<f32>) {
    let k = kind("gate");
    let mut s = design(k, with(k, &[(1, release_ms)]), RATE);
    let mut x = tone(1000.0, secs(0.5), 0.1);
    x.extend(tone(1000.0, secs(3.0), 0.001));
    let y = run(&mut s, &x);
    (x, y)
}

fn time_to_fall(x: &[f32], y: &[f32], below_db: f32) -> f32 {
    let window = secs(0.005);
    let start = secs(0.5) / window;
    let fallen = x.chunks(window).zip(y.chunks(window)).skip(start).position(|(a, b)| db(rms(b)) - db(rms(a)) < below_db);
    fallen.map_or(f32::INFINITY, |w| w as f32 * 0.005)
}

#[test]
fn the_gate_silences_the_gaps_to_its_range_and_keeps_the_sound() {
    let (x, y) = gated(100.0);
    let kept = db(rms(&y[secs(0.3)..secs(0.5)])) - db(rms(&x[secs(0.3)..secs(0.5)]));
    let gap = db(rms(&y[secs(3.0)..])) - db(rms(&x[secs(3.0)..]));
    assert!(kept.abs() < 0.5, "the sound above the threshold changed by {kept:.2} dB");
    assert!(gap < -59.0, "a long gap below the threshold came down only {gap:.1} dB (range -60 dB)");
}

#[test]
fn the_gates_release_sets_how_fast_it_closes() {
    let (x, fast) = gated(10.0);
    let (_, slow) = gated(100.0);
    let (t_fast, t_slow) = (time_to_fall(&x, &fast, -20.0), time_to_fall(&x, &slow, -20.0));
    let ratio = t_slow / t_fast;
    assert!(t_fast.is_finite() && t_slow.is_finite(), "the gate never fell 20 dB: {t_fast} s and {t_slow} s");
    assert!((4.0..=20.0).contains(&ratio), "release 100 ms should close about ten times slower than 10 ms: {t_slow:.3} s against {t_fast:.3} s");
}

#[test]
fn the_tremolo_pulses_at_its_rate_and_depth_zero_is_steady() {
    let k = kind("tremolo");
    let x = tone(1000.0, secs(2.0), 0.25);
    let mut s = design(k, with(k, &[(0, 4.0), (1, 1.0), (2, 0.0)]), RATE);
    let env = envelope(&run(&mut s, &x), secs(0.005));
    let top = env.iter().cloned().fold(0.0, f32::max);
    let dips = env.windows(2).filter(|w| w[0] >= 0.5 * top && w[1] < 0.5 * top).count();
    assert!((7..=9).contains(&dips), "4 Hz over 2 s should dip 8 times: {dips}");
    let mut still = design(k, with(k, &[(1, 0.0)]), RATE);
    let steady = envelope(&run(&mut still, &x), secs(0.005));
    let swing = db(steady.iter().cloned().fold(0.0, f32::max)) - db(steady.iter().cloned().fold(f32::MAX, f32::min));
    assert!(swing < 0.1, "depth 0 still pulsed by {swing:.2} dB");
}

fn swing_db(k: &Kind, p: [f32; 5], freq: f32, seconds: f32) -> f32 {
    let mut s = design(k, p, RATE);
    let y = run(&mut s, &tone(freq, secs(seconds), 0.25));
    let env = envelope(&y[secs(0.2)..], secs(0.01));
    db(env.iter().cloned().fold(0.0, f32::max)) - db(env.iter().cloned().fold(f32::MAX, f32::min))
}

#[test]
fn the_chorus_thickens_a_steady_tone_into_one_that_moves() {
    let k = kind("chorus");
    let moving = swing_db(k, k.init, 440.0, 2.6);
    assert!(moving > 6.0, "a 440 Hz tone through the chorus should rise and fall: {moving:.1} dB");
}

#[test]
fn the_phaser_sweeps_a_notch_across_the_band() {
    let k = kind("phaser");
    let swept = [250.0, 500.0, 1000.0, 2000.0].iter().filter(|&&f| swing_db(k, k.init, f, 4.2) > 6.0).count();
    assert!(swept >= 2, "a sweeping notch should pass over at least two of four tones: {swept}");
}

#[test]
fn the_flanger_sweeps_every_tone() {
    let k = kind("flanger");
    for f in [250.0, 500.0, 1000.0, 2000.0] {
        let moving = swing_db(k, k.init, f, 4.2);
        assert!(moving > 6.0, "a {f} Hz tone through the flanger should rise and fall: {moving:.1} dB");
    }
}

fn room_tone(n: usize, amp: f32, seed: u64) -> Vec<f32> {
    let mut low = 0.0f32;
    noise(n, 4.0 * amp, seed).into_iter().map(|v| {
        low = 0.9 * low + 0.1 * v;
        low
    }).collect()
}

#[test]
fn dialogue_isolate_is_rnnoise_itself_aligned_by_its_latency() {
    let k = kind("voice");
    let x = room_tone(secs(1.0), 0.1, 37);
    let mut s = design(k, with(k, &[(0, 1.0)]), RATE);
    let latency = s.latency();
    let y = run(&mut s, &x);
    let mut reference = nnnoiseless::DenoiseState::new();
    let mut expected = vec![];
    for frame in x.chunks_exact(nnnoiseless::DenoiseState::FRAME_SIZE) {
        let scaled: Vec<f32> = frame.iter().map(|v| v * 32768.0).collect();
        let mut out = vec![0.0f32; frame.len()];
        reference.process_frame(&mut out, &scaled);
        expected.extend(out.iter().map(|v| v / 32768.0));
    }
    let frame = nnnoiseless::DenoiseState::FRAME_SIZE;
    assert_eq!(latency, 2 * frame, "a frame of buffering and RNNoise's own frame");
    let worst = (0..expected.len() - frame).map(|i| (y[i + frame] - expected[i]).abs()).fold(0.0f32, f32::max);
    assert!(worst < 1e-5, "the stage differs from RNNoise by up to {worst}");
}

#[test]
fn dialogue_isolate_takes_down_steady_noise_and_strength_zero_keeps_it() {
    let k = kind("voice");
    let x = room_tone(secs(2.0), 0.1, 31);
    let mut full = design(k, with(k, &[(0, 1.0)]), RATE);
    let y = run(&mut full, &x);
    let taken = db(rms(&y[secs(1.0)..])) - db(rms(&x[secs(1.0)..]));
    assert!(taken < -10.0, "steady noise came down only {taken:.1} dB at strength 1");
    let mut none = design(k, with(k, &[(0, 0.0)]), RATE);
    let kept = db(rms(&run(&mut none, &x)[secs(1.0)..])) - db(rms(&x[secs(1.0)..]));
    assert!(kept.abs() < 0.5, "strength 0 changed the level by {kept:.2} dB");
}
