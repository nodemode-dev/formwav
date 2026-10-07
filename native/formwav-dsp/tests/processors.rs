use formwav_dsp::fx::{processors_json, Processor, Stage};
use formwav_dsp::render::Bus;
use formwav_dsp::{PlayClip, Player};
use formwav_studio::{catalog, Unit};

const RATE: f32 = 48000.0;
const FRAMES: usize = 36000;
const BLOCK: usize = 128;

fn signal() -> (Vec<f32>, Vec<f32>) {
    let mut seed = 0x2545_f491u32;
    let mut noise = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f32 / u32::MAX as f32 - 0.5
    };
    let left = (0..FRAMES)
        .map(|i| {
            let t = i as f32 / RATE;
            let burst = if (i / 4800) % 2 == 0 { 0.6 } else { 0.05 };
            burst * (2.0 * std::f32::consts::PI * 220.0 * t).sin() + 0.2 * noise()
        })
        .collect();
    let right = (0..FRAMES).map(|i| 0.4 * (2.0 * std::f32::consts::PI * 6500.0 * i as f32 / RATE).sin() + 0.1 * noise()).collect();
    (left, right)
}

fn spec_and_values(id: &str) -> (String, Vec<(&'static str, f32)>) {
    let info = formwav_studio::spec(id).unwrap();
    let values: Vec<(&'static str, f32)> = info
        .params
        .iter()
        .map(|p| {
            let v = match p.unit {
                Unit::Toggle | Unit::Choice => p.max,
                _ => p.min + 0.3 * (p.max - p.min),
            };
            (p.id, v)
        })
        .collect();
    let spec = std::iter::once(id.to_string()).chain(values.iter().map(|(k, v)| format!("{k}={v}"))).collect::<Vec<_>>().join(";");
    (spec, values)
}

/// The processor run on its own over the input in the blocks the player uses: `first` samples (a bus's read-ahead,
/// in pieces of at most 1024), then 128 at a time.
fn direct(id: &str, values: &[(&str, f32)], left: &[f32], right: &[f32], first: usize) -> (Vec<f32>, Vec<f32>) {
    let info = formwav_studio::spec(id).unwrap();
    let mut p = formwav_studio::build(id, RATE).unwrap();
    for (k, v) in values {
        let i = info.index(k).unwrap_or_else(|| panic!("{id} {k}"));
        p.set(i, info.params[i].clamp(*v));
    }
    p.reset();
    let (mut l, mut r) = (left.to_vec(), right.to_vec());
    let mut blocks: Vec<(usize, usize)> = (0..first).step_by(1024).map(|a| (a, 1024.min(first - a))).collect();
    blocks.extend((first..FRAMES).step_by(BLOCK).map(|a| (a, BLOCK.min(FRAMES - a))));
    for (at, m) in blocks {
        p.run(&mut l[at..at + m], &mut r[at..at + m]);
    }
    (l, r)
}

fn through_player(spec: &str, on_bus: bool, left: &[f32], right: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let mut p = Player::new();
    p.set_rate(RATE);
    p.alloc_source(1, 48000, 2, FRAMES);
    let interleaved: Vec<f32> = left.iter().zip(right).flat_map(|(a, b)| [*a, *b]).collect();
    p.write_source(1, 0, &interleaved);
    let bus = if on_bus {
        p.add_bus(Bus { id: 1, gain: 1.0, pan: 0.0 });
        assert!(p.add_bus_processor(spec), "{spec}");
        1
    } else {
        assert!(p.add_master_processor(spec), "{spec}");
        0
    };
    p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: FRAMES as u64, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus, track: 1, gain_env: 0, pan_env: 0 });
    let (mut l, mut r) = (vec![0f32; FRAMES], vec![0f32; FRAMES]);
    for (bl, br) in l.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        p.render(bl, br);
    }
    (l, r)
}

#[test]
fn every_processor_on_the_master_and_on_a_bus_plays_what_it_makes_of_the_same_input_on_its_own() {
    let (left, right) = signal();
    let mut checked = 0;
    for info in catalog() {
        let (spec, values) = spec_and_values(info.id);
        let (want_l, want_r) = direct(info.id, &values, &left, &right, 0);
        let (master_l, master_r) = through_player(&spec, false, &left, &right);
        assert!(master_l == want_l && master_r == want_r, "{}: the master chain differs from the processor on its own", info.id);
        let latency = Processor::design(&spec, RATE).unwrap().latency();
        let (want_l, want_r) = direct(info.id, &values, &left, &right, latency);
        let (bus_l, bus_r) = through_player(&spec, true, &left, &right);
        assert!(bus_l[..FRAMES - latency] == want_l[latency..] && bus_r[..FRAMES - latency] == want_r[latency..], "{}: the bus chain differs from the processor on its own, read {latency} ahead", info.id);
        checked += 1;
    }
    assert_eq!(checked, 24);
}

#[test]
fn a_spec_is_read_by_name_clamped_and_refused_when_unknown() {
    let ceiling = |spec: &str| {
        let Some(Stage::Processor(p)) = Stage::processor(spec, RATE) else { panic!("{spec}") };
        p
    };
    assert_eq!(ceiling("maximizer;ceiling=40"), ceiling("maximizer;ceiling=0"));
    assert_eq!(ceiling("maximizer; ceiling = -3 ;nonsense;release=x"), ceiling("maximizer;ceiling=-3"));
    assert_ne!(ceiling("maximizer;ceiling=-3"), ceiling("maximizer"));
    assert!(Stage::processor("no_such_effect", RATE).is_none());
    assert!(Stage::processor("", RATE).is_none());
    assert!(Stage::processor("gain", 0.0).is_none());
    let copy = ceiling("seven_band_eq;low_cut=1").clone();
    assert_eq!(copy, ceiling("seven_band_eq;low_cut=1"));
}

#[test]
fn the_processors_are_listed_for_the_interface() {
    let json = processors_json();
    assert_eq!(json.matches("\"short\":").count(), 24);
    for info in catalog() {
        assert!(json.contains(&format!("\"id\":\"{}\",\"name\"", info.id)), "{}", info.id);
    }
    assert!(json.starts_with('[') && json.ends_with(']'));
}

#[test]
fn a_block_through_a_stage_is_the_same_as_frame_by_frame() {
    let (left, right) = signal();
    for (kind, a, b, c, d) in [(1u8, 400.0, 0.0, 0.7, 0.0), (6, -20.0, 4.0, 10.0, 150.0), (8, 0.5, 0.5, 0.3, 1.0), (9, 120.0, 0.35, 0.4, 0.0), (13, -40.0, 100.0, -60.0, 0.0)] {
        let mut a = Stage::design(kind, a, b, c, d, 0.0, RATE).unwrap();
        let mut b = a.clone();
        let (mut l, mut r) = (left.clone(), right.clone());
        a.process_block(&mut l, &mut r);
        for i in 0..FRAMES {
            let (x, y) = b.process(left[i], right[i]);
            assert!(x == l[i] && y == r[i], "kind {kind} at {i}");
        }
    }
}
