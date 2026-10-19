//! Transient detection (for groove and timing edits; no code taken).
//!
//! The signal is first-differenced, which emphasises attacks over sustained tones, and cut into short frames whose
//! energy is taken in dB. An onset is a frame whose energy rises from the previous frame by more than a threshold
//! and stands above the local median of the rise curve; candidates closer than a minimum spacing keep the stronger.
//! Each onset is then placed on the largest first-difference sample within its frame, the attack itself.

const HOP: usize = 256;

/// Onset positions in samples of `mono` at `rate`. `sensitivity` from 0 (only strong attacks) to 1 (subtle ones)
/// sets the rise needed, from 18 dB down to 4 dB. Onsets are at least 50 ms apart.
pub fn detect(mono: &[f32], rate: u32, sensitivity: f32) -> Vec<u64> {
    if mono.len() < HOP * 4 || rate == 0 {
        return Vec::new();
    }
    let need_db = 18.0 - 14.0 * sensitivity.clamp(0.0, 1.0);
    let frames = mono.len() / HOP;
    let mut energy = vec![0.0f32; frames];
    for (f, e) in energy.iter_mut().enumerate() {
        let start = f * HOP;
        let mut sum = 0.0f64;
        for i in start.max(1)..start + HOP {
            let d = (mono[i] - mono[i - 1]) as f64;
            sum += d * d;
        }
        *e = (10.0 * (sum / HOP as f64 + 1e-12).log10()) as f32;
    }
    let rise: Vec<f32> = (0..frames).map(|f| if f == 0 { 0.0 } else { (energy[f] - energy[f - 1]).max(0.0) }).collect();
    let spacing = ((rate as usize * 50) / 1000 / HOP).max(1);
    let mut onsets: Vec<(usize, f32)> = Vec::new();
    for f in 1..frames {
        let lo = f.saturating_sub(16);
        let hi = (f + 16).min(frames);
        let mut window: Vec<f32> = rise[lo..hi].to_vec();
        window.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = window[window.len() / 2];
        let is_peak = rise[f] >= rise[f - 1] && (f + 1 >= frames || rise[f] >= rise[f + 1]);
        if !is_peak || rise[f] < need_db || rise[f] < median + need_db * 0.5 || energy[f] < -80.0 {
            continue;
        }
        match onsets.last_mut() {
            Some(last) if f - last.0 < spacing => {
                if rise[f] > last.1 {
                    *last = (f, rise[f]);
                }
            }
            _ => onsets.push((f, rise[f])),
        }
    }
    onsets
        .into_iter()
        .map(|(f, _)| {
            let start = (f * HOP).max(1);
            let (mut best, mut at) = (0.0f32, start);
            for i in start..(f * HOP + HOP).min(mono.len()) {
                let d = (mono[i] - mono[i - 1]).abs();
                if d > best {
                    best = d;
                    at = i;
                }
            }
            at as u64
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_each_click_of_a_train_on_its_sample() {
        let rate = 48000;
        let mut x = vec![0.0f32; rate as usize * 3];
        let clicks = [12000usize, 36000, 60000, 84000, 108000];
        for &c in &clicks {
            for k in 0..200 {
                x[c + k] = 0.8 * (-(k as f32) / 40.0).exp() * if k % 2 == 0 { 1.0 } else { -1.0 };
            }
        }
        let found = detect(&x, rate, 0.5);
        assert_eq!(found.len(), clicks.len(), "{found:?}");
        for (f, c) in found.iter().zip(clicks) {
            assert!((*f as i64 - c as i64).abs() <= 2, "{found:?}");
        }
    }

    #[test]
    fn silence_and_a_steady_tone_have_none() {
        let rate = 48000;
        assert!(detect(&vec![0.0; 96000], rate, 1.0).is_empty());
        let tone: Vec<f32> = (0..96000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin()).collect();
        assert!(detect(&tone[..], rate, 0.5).len() <= 1);
    }
}
