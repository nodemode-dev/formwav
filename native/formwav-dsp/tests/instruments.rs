use formwav_dsp::instruments::{clean, render, Instrument, Kind, DRUMS, SUBTRACTIVE};
use formwav_dsp::synth::Note;

const RATE: u32 = 48000;

fn n(start: u64, length: u64, pitch: u8, velocity: u8) -> Note {
    Note { start, length, pitch, velocity }
}

fn defaults(kind: Kind) -> Vec<f32> {
    kind.params().iter().map(|p| p.default).collect()
}

fn with(kind: Kind, changes: &[(&str, f32)]) -> Vec<f32> {
    let mut v = defaults(kind);
    for (id, value) in changes {
        let i = kind.params().iter().position(|p| p.id == *id).expect("a parameter of the instrument");
        v[i] = *value;
    }
    v
}

fn live(kind: Kind, values: &[f32], notes: &[Note], frames: usize) -> (Vec<f32>, usize) {
    let mut inst = Instrument::new(kind, values, RATE);
    let mut got = vec![0.0f32; frames];
    let mut events: Vec<(u64, bool, u8, u8)> = notes.iter().flat_map(|n| [(n.start, true, n.pitch, n.velocity), (n.start + n.length, false, n.pitch, 0)]).collect();
    events.sort_by_key(|e| (e.0, e.1));
    let (mut at, mut next, mut step) = (0usize, 0usize, 1usize);
    while at < frames {
        while next < events.len() && events[next].0 as usize == at {
            let (_, on, pitch, velocity) = events[next];
            if on {
                inst.note_on(pitch, velocity)
            } else {
                inst.note_off(pitch)
            }
            next += 1;
        }
        let until = events.get(next).map_or(frames, |e| e.0 as usize).min(at + step).min(frames);
        inst.render(&mut got[at..until]);
        at = until;
        step = step % 128 + 7;
    }
    (got, inst.sounding())
}

fn rms(v: &[f32]) -> f64 {
    (v.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / v.len().max(1) as f64).sqrt()
}

fn crossings_hz(v: &[f32]) -> f64 {
    v.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f64 * RATE as f64 / v.len() as f64
}

#[test]
fn both_instruments_play_live_exactly_what_a_clip_renders() {
    let sub_notes = [n(0, 20000, 48, 100), n(5000, 12000, 55, 70), n(9000, 400, 60, 20), n(18000, 9000, 48, 127)];
    for values in [defaults(Kind::Subtractive), with(Kind::Subtractive, &[("glide", 120.0), ("resonance", 0.9), ("envAmount", -0.7), ("osc1", 0.0), ("osc2", 1.0)])] {
        let want = render(Kind::Subtractive, &values, &sub_notes, RATE);
        let (got, left) = live(Kind::Subtractive, &values, &sub_notes, want.len());
        assert!(got == want, "the live subtractive synth differs from its render");
        assert_eq!(left, 0, "a voice outlived its release");
    }
    let drum_notes = [n(0, 100, 36, 120), n(6000, 100, 38, 100), n(6000, 100, 46, 90), n(12000, 100, 42, 80), n(15000, 100, 49, 110), n(20000, 100, 45, 100), n(21000, 100, 39, 100)];
    let values = defaults(Kind::Drums);
    let want = render(Kind::Drums, &values, &drum_notes, RATE);
    let (got, left) = live(Kind::Drums, &values, &drum_notes, want.len());
    assert!(got == want, "the live drum synth differs from its render");
    assert_eq!(left, 0, "a drum voice outlived its decay");
}

#[test]
fn a_note_sounds_from_its_frame_and_decays_to_silence_after_its_end() {
    let values = defaults(Kind::Subtractive);
    let out = render(Kind::Subtractive, &values, &[n(1000, 9600, 57, 110)], RATE);
    assert!(out[..1000].iter().all(|x| *x == 0.0), "sound before the note's frame");
    assert!(out[1001..1200].iter().any(|x| x.abs() > 1e-4), "the note did not start on its frame");
    let held = rms(&out[4000..10000]);
    let release = (values[11] as f64 * RATE as f64) as usize;
    assert!(held > 0.01, "held level {held}");
    assert!(rms(&out[10600 + release + 10..]) == 0.0 || out.len() <= 10600 + release + 10, "sound after the release");
    let quiet = render(Kind::Subtractive, &values, &[n(1000, 9600, 57, 30)], RATE);
    let ratio = rms(&quiet[4000..10000]) / held;
    let sens = values[17] as f64;
    let want = ((1.0 - sens) + sens * 30.0 / 127.0) / ((1.0 - sens) + sens * 110.0 / 127.0);
    assert!((ratio - want).abs() < 0.01, "velocity ratio {ratio}, wanted {want}");
}

#[test]
fn the_filter_envelope_opens_the_tone_and_glide_slides_between_notes() {
    let shut = with(Kind::Subtractive, &[("cutoff", 300.0), ("envAmount", 0.0), ("osc1", 2.0), ("mix", 0.0)]);
    let swept = with(Kind::Subtractive, &[("cutoff", 300.0), ("envAmount", 1.0), ("filterAttack", 0.0), ("filterDecay", 0.5), ("filterSustain", 0.0), ("osc1", 2.0), ("mix", 0.0)]);
    let note = [n(0, 48000, 45, 127)];
    let a = render(Kind::Subtractive, &shut, &note, RATE);
    let b = render(Kind::Subtractive, &swept, &note, RATE);
    let bright = |v: &[f32]| rms(&v.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>());
    assert!(bright(&b[480..4800]) > 2.0 * bright(&a[480..4800]), "the envelope did not open the filter at the start");
    assert!((bright(&b[40000..47000]) / bright(&a[40000..47000]) - 1.0).abs() < 0.05, "once the envelope has closed the tones should match");
    let sine = with(Kind::Subtractive, &[("osc1", 0.0), ("mix", 0.0), ("cutoff", 20000.0), ("envAmount", 0.0), ("glide", 500.0)]);
    let out = render(Kind::Subtractive, &sine, &[n(0, 24000, 57, 127), n(24000, 48000, 69, 127)], RATE);
    let early = crossings_hz(&out[24000..26400]);
    let late = crossings_hz(&out[52000..64000]);
    assert!(early < 260.0, "the glide should start near A3 (220 Hz), measured {early}");
    assert!((late - 440.0).abs() < 3.0, "after the glide the note is A4, measured {late}");
}

#[test]
fn sixteen_voices_at_most_the_oldest_released_one_giving_way() {
    let values = defaults(Kind::Subtractive);
    let mut inst = Instrument::new(Kind::Subtractive, &values, RATE);
    for p in 40..60u8 {
        inst.note_on(p, 100);
    }
    assert_eq!(inst.sounding(), 16);
    let mut drums = Instrument::new(Kind::Drums, &defaults(Kind::Drums), RATE);
    for _ in 0..30 {
        drums.note_on(36, 100);
    }
    assert_eq!(drums.sounding(), 24);
}

#[test]
fn the_kit_follows_the_general_midi_map_and_the_closed_hat_chokes_the_open_one() {
    let values = defaults(Kind::Drums);
    for (pitch, start) in [(36u8, 0usize), (38, 12000), (42, 24000)] {
        let out = render(Kind::Drums, &values, &[n(start as u64, 10, pitch, 120)], RATE);
        assert!(out[..start].iter().all(|x| *x == 0.0), "note {pitch} sounded before its frame");
        assert!(rms(&out[start..start + 480]) > 0.02, "note {pitch} did not sound on its frame");
    }
    let out = render(Kind::Drums, &values, &[n(0, 10, 36, 120), n(12000, 10, 38, 120), n(24000, 10, 42, 120)], RATE);
    let low = |v: &[f32]| crossings_hz(v);
    assert!(low(&out[200..4800]) < 200.0, "the kick should be low");
    let hat = render(Kind::Drums, &values, &[n(0, 10, 42, 120)], RATE);
    assert!(low(&hat[..480]) > 3000.0, "the hat should be bright, measured {}", low(&hat[..480]));
    assert!(render(Kind::Drums, &values, &[n(0, 10, 70, 120)], RATE).iter().all(|x| *x == 0.0), "a note off the map sounded");
    let open = render(Kind::Drums, &values, &[n(0, 10, 46, 120)], RATE);
    let fade = (0.005 * RATE as f64) as usize + 1;
    assert!(rms(&open[4800 + fade..9600]) > 1e-3, "the open hat rings");
    let mut kit = Instrument::new(Kind::Drums, &values, RATE);
    let mut buf = vec![0.0f32; 4800];
    kit.note_on(46, 120);
    kit.render(&mut buf);
    kit.note_on(44, 100);
    assert_eq!(kit.sounding(), 2);
    kit.render(&mut buf[..fade]);
    assert_eq!(kit.sounding(), 1, "the open hat still sounds 5 ms after the closed hat choked it");
}

#[test]
fn values_are_clamped_to_their_ranges_and_waves_are_whole() {
    let v = clean(Kind::Subtractive, &[9.0, 1.4, 99.0, f32::NAN]);
    assert_eq!(v.len(), SUBTRACTIVE.len());
    assert_eq!(v[0], 3.0);
    assert_eq!(v[1], 1.0);
    assert_eq!(v[2], 24.0);
    assert_eq!(v[3], SUBTRACTIVE[3].default);
    assert_eq!(clean(Kind::Drums, &[]).len(), DRUMS.len());
}
