use formwav_dsp::render::Bus;
use formwav_dsp::{PlayClip, Player};

const RATE: f32 = 48000.0;

fn clip(source: u32, length: u64, bus: u32) -> PlayClip {
    PlayClip { source, start: 0, source_in: 0, length, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus, track: 1, gain_env: 0, pan_env: 0 }
}

fn tone(freq: f32, n: usize, amp: f32) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / RATE).sin()).collect()
}

fn render(p: &mut Player, n: usize) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (vec![0f32; n], vec![0f32; n]);
    for (bl, br) in l.chunks_mut(128).zip(r.chunks_mut(128)) {
        p.render(bl, br);
    }
    (l, r)
}

fn rms(s: &[f32]) -> f32 {
    (s.iter().map(|v| v * v).sum::<f32>() / s.len() as f32).sqrt()
}

fn through_bus_lowpass(automate: bool) -> (f32, f32) {
    let mut p = Player::new();
    p.set_rate(RATE);
    p.alloc_source(1, 48000, 1, 48000);
    p.write_source(1, 0, &tone(4000.0, 48000, 0.5));
    let env = p.add_envelope(&[(0, 200.0), (48000, 12000.0)], false);
    p.add_bus(Bus { id: 1, gain: 1.0, pan: 0.0 });
    assert!(p.add_bus_stage(formwav_dsp::fx::LOWPASS, 200.0, 0.0, 0.707, 0.0, 0.0));
    if automate {
        assert!(p.add_bus_fx_auto(0, 0, env));
    }
    p.add_clip(clip(1, 48000, 1));
    let (l, _) = render(&mut p, 48000);
    (rms(&l[2400..7200]), rms(&l[40800..45600]))
}

#[test]
fn an_automated_filter_on_a_bus_opens_over_time_as_it_does_on_a_clip() {
    let (early, late) = through_bus_lowpass(true);
    let (still_early, still_late) = through_bus_lowpass(false);
    assert!(late > 0.33, "automated late {late}");
    assert!(late > 5.0 * early, "automated early {early} late {late}");
    assert!(still_early < 0.02 && still_late < 0.02, "fixed {still_early} {still_late}");
}

#[test]
fn bus_automation_is_refused_for_a_stage_that_is_not_a_filter_or_a_missing_envelope() {
    let mut p = Player::new();
    p.set_rate(RATE);
    let env = p.add_envelope(&[(0, 0.0), (100, 1.0)], false);
    assert!(!p.add_bus_fx_auto(0, 0, env), "no bus yet");
    p.add_bus(Bus { id: 1, gain: 1.0, pan: 0.0 });
    assert!(p.add_bus_stage(formwav_dsp::fx::COMPRESSOR, -20.0, 4.0, 10.0, 100.0, 0.0));
    assert!(p.add_bus_stage(formwav_dsp::fx::PEAK, 1000.0, 3.0, 1.0, 0.0, 0.0));
    assert!(!p.add_bus_fx_auto(0, 0, env), "a compressor is not automated here");
    assert!(!p.add_bus_fx_auto(1, 3, env) && !p.add_bus_fx_auto(1, 0, 9) && !p.add_bus_fx_auto(2, 0, env));
    assert!(p.add_bus_fx_auto(1, 1, env));
}

fn centre_gains(law: u8, channels: usize) -> (f32, f32) {
    let mut p = Player::new();
    p.set_rate(RATE);
    p.set_pan_law(law);
    let n = 4800;
    p.alloc_source(1, 48000, channels, n);
    let one: Vec<f32> = vec![0.5; n * channels];
    p.write_source(1, 0, &one);
    p.add_clip(clip(1, n as u64, 0));
    let (l, r) = render(&mut p, n);
    (l[100] / 0.5, r[100] / 0.5)
}

#[test]
fn the_pan_law_sets_a_centred_mono_sources_level_and_leaves_stereo_alone() {
    let db = |g: f32| 20.0 * g.log10();
    let (l0, r0) = centre_gains(0, 1);
    assert!((l0 - 1.0).abs() < 1e-6 && (r0 - 1.0).abs() < 1e-6, "the balance every session had");
    for (law, want) in [(1u8, -3.0103f32), (2, -4.5154), (3, -6.0206)] {
        let (l, r) = centre_gains(law, 1);
        assert!((db(l) - want).abs() < 0.02 && (l - r).abs() < 1e-6, "law {law}: {} dB", db(l));
        let (sl, sr) = centre_gains(law, 2);
        assert!((sl - 1.0).abs() < 1e-6 && (sr - 1.0).abs() < 1e-6, "law {law} on a stereo source");
    }
    let (l9, _) = centre_gains(9, 1);
    assert!((l9 - 1.0).abs() < 1e-6, "an unknown law is the balance");
}

#[test]
fn each_processor_reports_its_gain_reduction_in_the_order_it_was_added() {
    let mut p = Player::new();
    p.set_rate(RATE);
    p.alloc_source(1, 48000, 1, 24000);
    p.write_source(1, 0, &tone(220.0, 24000, 0.9));
    p.add_bus(Bus { id: 1, gain: 1.0, pan: 0.0 });
    assert!(p.add_bus_processor("gain;gain=-6"));
    assert!(p.add_bus_processor("maximizer;threshold=-18;ceiling=-1"));
    assert!(p.add_master_processor("compressor;threshold=-40;ratio=10;attack=1"));
    p.add_clip(clip(1, 24000, 1));
    render(&mut p, 24000);
    let mut out = [0f32; 8];
    assert_eq!(p.take_reductions(&mut out), 3);
    assert_eq!(out[0], 0.0, "a gain stage reduces nothing");
    assert!(out[1] > 6.0, "the maximizer, driven 18 dB: {}", out[1]);
    assert!(out[2] > 6.0, "the master's compressor: {}", out[2]);
    let mut short = [0f32; 1];
    assert_eq!(p.take_reductions(&mut short), 3, "the count whatever the room");
}
