use formwav_dsp::render::Bus;
use formwav_dsp::{PlayClip, Player};

fn mix(first: u32, second: u32, second_gain: f32, out: Option<(u32, u32)>) -> Vec<f32> {
    let mut p = Player::new();
    p.set_rate(48000.0);
    p.alloc_source(1, 48000, 1, 9600);
    p.write_source(1, 0, &vec![0.25f32; 9600]);
    p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: 9600, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 1, track: 1, gain_env: 0, pan_env: 0 });
    for id in [first, second] {
        p.add_bus(Bus { id, gain: if id == 2 { second_gain } else { 1.0 }, pan: 0.0 });
    }
    if let Some((id, to)) = out {
        p.set_bus_out(id, to);
    }
    let (mut l, mut r) = (vec![0f32; 9600], vec![0f32; 9600]);
    for (bl, br) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
        p.render(bl, br);
    }
    l
}

#[test]
fn a_bus_played_into_another_takes_that_bus_level() {
    let full = mix(1, 2, 1.0, Some((1, 2)));
    let half = mix(1, 2, 0.5, Some((1, 2)));
    let silent = mix(1, 2, 0.0, Some((1, 2)));
    assert!(full[4800].abs() > 0.1, "{}", full[4800]);
    assert!((half[4800] - full[4800] * 0.5).abs() < 1e-6, "{} against {}", half[4800], full[4800]);
    assert!(silent.iter().all(|v| *v == 0.0));
}

#[test]
fn an_unrouted_bus_or_one_routed_backwards_plays_into_the_master() {
    let plain = mix(1, 2, 0.0, None);
    assert!(plain[4800].abs() > 0.1);
    assert_eq!(mix(2, 1, 0.0, Some((1, 2))), mix(2, 1, 0.0, None));
    assert_eq!(mix(1, 2, 0.0, Some((1, 0))), plain);
    assert_eq!(mix(1, 2, 0.0, Some((1, 9))), plain);
}
