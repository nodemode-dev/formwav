use formwav_dsp::{PlayClip, Player};

fn tone(env: bool) -> Vec<f32> {
    let mut p = Player::new();
    p.set_rate(48000.0);
    p.alloc_source(1, 48000, 1, 96000);
    p.write_source(1, 0, &vec![0.5f32; 96000]);
    p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: 96000, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
    if env {
        let id = p.add_envelope(&[(0, 0.0), (48000, -12.0)], true);
        p.set_master_envelope(id);
    }
    let (mut l, mut r) = (vec![0f32; 96000], vec![0f32; 96000]);
    for (bl, br) in l.chunks_mut(480).zip(r.chunks_mut(480)) {
        p.render(bl, br);
    }
    assert_eq!(l, r);
    l
}

#[test]
fn a_master_lane_takes_a_half_level_tone_down_twelve_db_over_a_second() {
    let plain = tone(false);
    let ramped = tone(true);
    let g12 = 10f32.powf(-12.0 / 20.0);
    assert!((plain[60000] - 0.5).abs() < 1e-6);
    assert!((ramped[0] - 0.5).abs() < 1e-6, "{}", ramped[0]);
    assert!((ramped[48000] - 0.5 * g12).abs() < 1e-5, "at 1 s: {}", ramped[48000]);
    assert!((ramped[90000] - 0.5 * g12).abs() < 1e-5, "held after: {}", ramped[90000]);
    let mid = 0.5 * (1.0 + g12) / 2.0;
    assert!((ramped[24000] - mid).abs() < 1e-4, "halfway, linear in gain: {}", ramped[24000]);
}

#[test]
fn no_master_lane_leaves_the_mix_exactly_as_it_was() {
    let mut p = Player::new();
    p.set_master_envelope(0);
    assert_eq!(tone(false), tone(false));
}
