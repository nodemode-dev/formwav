use formwav_dsp::render::{fade_curve, fade_shapes, FADE_EQUAL_POWER, FADE_EXPONENTIAL, FADE_LINEAR, FADE_LOGARITHMIC, FADE_S_CURVE};
use formwav_dsp::{PlayClip, Player};

#[test]
fn every_shape_runs_from_silence_to_full_level() {
    for shape in [FADE_LINEAR, FADE_EQUAL_POWER, FADE_S_CURVE, FADE_EXPONENTIAL, FADE_LOGARITHMIC] {
        assert_eq!(fade_curve(0.0, shape), 0.0, "shape {shape} at its silent end");
        assert!((fade_curve(1.0, shape) - 1.0).abs() < 1e-6, "shape {shape} at full level");
    }
}

#[test]
fn the_logarithmic_shape_is_log10_of_one_plus_nine_x() {
    for (x, want) in [(0.25f32, 0.511_883f32), (0.5, 0.740_363), (0.75, 0.889_302)] {
        assert!((fade_curve(x, FADE_LOGARITHMIC) - want).abs() < 1e-6, "at {x}");
    }
}

#[test]
fn a_fade_code_below_sixteen_is_one_shape_and_above_it_one_per_edge() {
    assert_eq!(fade_shapes(FADE_EQUAL_POWER), (1, 1));
    assert_eq!(fade_shapes(FADE_LOGARITHMIC), (4, 4));
    assert_eq!(fade_shapes(FADE_LINEAR + 16 * (FADE_LOGARITHMIC + 1)), (0, 4));
    assert_eq!(fade_shapes(FADE_S_CURVE + 16 * (FADE_LINEAR + 1)), (2, 0));
}

#[test]
fn a_clip_fades_in_and_out_each_with_its_own_shape() {
    let mut p = Player::new();
    p.set_rate(48000.0);
    p.alloc_source(1, 48000, 1, 1000);
    p.write_source(1, 0, &[1.0f32; 1000]);
    let code = FADE_LINEAR + 16 * (FADE_LOGARITHMIC + 1);
    p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: 1000, gain: 1.0, pan: 0.0, fade_in: 100, fade_out: 200, fade_shape: code, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
    let (mut l, mut r) = (vec![0f32; 1024], vec![0f32; 1024]);
    for (bl, br) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
        p.render(bl, br);
    }
    for k in [10usize, 50, 90] {
        assert!((l[k] - k as f32 / 100.0).abs() < 1e-5, "linear fade-in at {k}: {}", l[k]);
    }
    for k in [850usize, 900, 950] {
        let x = (1000 - k) as f32 / 200.0;
        let want = (1.0 + 9.0 * x).log10();
        assert!((l[k] - want).abs() < 1e-5, "logarithmic fade-out at {k}: {} against {want}", l[k]);
    }
    assert!((l[500] - 1.0).abs() < 1e-6 && l[1000] == 0.0 && l == r);
}
