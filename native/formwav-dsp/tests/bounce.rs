use formwav_dsp::loudness::true_peak;
use std::f32::consts::TAU;

#[test]
fn the_true_peak_catches_an_intersample_over_that_the_samples_miss() {
    // a sine at a quarter of the rate, phased 45 degrees, has every sample at 0.707 of its height, so the samples read
    // -3.01 dB and the true peak about 0 dBTP
    let x: Vec<f32> = (0..48_000).map(|i| (TAU * 0.25 * (i % 4) as f32 + TAU / 8.0).sin()).collect();
    let sample_db = 20.0 * x.iter().fold(0.0f32, |m, v| m.max(v.abs())).log10();
    assert!((sample_db + 3.01).abs() < 0.01, "{sample_db}");
    let tp = true_peak(&[x.clone(), x], 48_000).expect("a sine is not silent");
    assert!(tp > -0.5 && tp < 0.5, "{tp}");
}

#[test]
fn the_true_peak_of_a_slow_sine_is_its_sample_peak_and_silence_has_none() {
    let x: Vec<f32> = (0..48_000).map(|i| 0.5 * (TAU * 100.0 * i as f32 / 48_000.0).sin()).collect();
    let tp = true_peak(&[x], 48_000).expect("a sine is not silent");
    assert!((tp + 6.02).abs() < 0.05, "{tp}");
    assert_eq!(true_peak(&[vec![0.0; 4800], vec![0.0; 4800]], 48_000), None);
    assert_eq!(true_peak(&[], 48_000), None);
}
