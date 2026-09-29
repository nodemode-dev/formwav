use std::f64::consts::PI;

#[derive(Debug, Clone)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    fn new(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Self {
        Self { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 }
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

fn k_weighting(rate: f64) -> (Biquad, Biquad) {
    let (f0, gain_db, q) = (1681.974450955533, 3.999843853973347, 0.7071752369554196);
    let k = (PI * f0 / rate).tan();
    let vh = 10f64.powf(gain_db / 20.0);
    let vb = vh.powf(0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad::new(
        (vh + vb * k / q + k * k) / a0,
        2.0 * (k * k - vh) / a0,
        (vh - vb * k / q + k * k) / a0,
        2.0 * (k * k - 1.0) / a0,
        (1.0 - k / q + k * k) / a0,
    );
    let (f0, q) = (38.13547087602444, 0.5003270373238773);
    let k = (PI * f0 / rate).tan();
    let a0 = 1.0 + k / q + k * k;
    let high_pass = Biquad::new(1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0);
    (shelf, high_pass)
}

fn block_loudness(power: f64) -> f64 {
    -0.691 + 10.0 * power.log10()
}

pub fn integrated_loudness(channels: &[Vec<f32>], rate: u32) -> Option<f64> {
    let frames = channels.first()?.len();
    let rate = f64::from(rate);
    let block = (0.4 * rate).round() as usize;
    let step = (0.1 * rate).round() as usize;
    if block == 0 || step == 0 || frames < block {
        return None;
    }
    let count = (frames - block) / step + 1;
    let mut power = vec![0.0f64; count];
    for channel in channels {
        let (mut shelf, mut high_pass) = k_weighting(rate);
        let mut prefix = Vec::with_capacity(frames + 1);
        prefix.push(0.0f64);
        let mut acc = 0.0f64;
        for &x in channel.iter().take(frames) {
            let y = high_pass.process(shelf.process(f64::from(x)));
            acc += y * y;
            prefix.push(acc);
        }
        for (j, p) in power.iter_mut().enumerate() {
            let a = j * step;
            *p += (prefix[a + block] - prefix[a]) / block as f64;
        }
    }
    gated_loudness(&power)
}

/// BS.1770 gating over 400 ms block powers: absolute gate at -70 LUFS, then a relative gate 10 LU below
/// the mean of the blocks that passed. Shared by the offline and the live meters.
fn gated_loudness(power: &[f64]) -> Option<f64> {
    let above_absolute: Vec<f64> = power.iter().copied().filter(|&z| z > 0.0 && block_loudness(z) > -70.0).collect();
    if above_absolute.is_empty() {
        return None;
    }
    let relative = block_loudness(above_absolute.iter().sum::<f64>() / above_absolute.len() as f64) - 10.0;
    let gated: Vec<f64> = above_absolute.into_iter().filter(|&z| block_loudness(z) > relative).collect();
    if gated.is_empty() {
        return None;
    }
    Some(block_loudness(gated.iter().sum::<f64>() / gated.len() as f64))
}

const SHORT_TERM_STEPS: usize = 30;
const BLOCK_STEPS: usize = 4;

/// Streaming loudness of a stereo signal: momentary (the last 400 ms), short-term (the last 3 s) and
/// integrated (gated, since the last reset). It uses the same K-weighting and the same 400 ms blocks at
/// 100 ms steps as `integrated_loudness`, so on the same samples the integrated values agree.
#[derive(Debug, Clone)]
pub struct LiveLoudness {
    filters: [(Biquad, Biquad); 2],
    step: usize,
    filled: usize,
    energy: f64,
    steps: std::collections::VecDeque<f64>,
    blocks: Vec<f64>,
}

impl LiveLoudness {
    pub fn new(rate: u32) -> Self {
        let rate = f64::from(rate.max(1));
        Self {
            filters: [k_weighting(rate), k_weighting(rate)],
            step: ((0.1 * rate).round() as usize).max(1),
            filled: 0,
            energy: 0.0,
            steps: std::collections::VecDeque::with_capacity(SHORT_TERM_STEPS),
            blocks: Vec::new(),
        }
    }

    pub fn process(&mut self, left: &[f32], right: &[f32]) {
        let n = left.len().min(right.len());
        for i in 0..n {
            let (shelf, high_pass) = &mut self.filters[0];
            let l = high_pass.process(shelf.process(f64::from(left[i])));
            let (shelf, high_pass) = &mut self.filters[1];
            let r = high_pass.process(shelf.process(f64::from(right[i])));
            self.energy += l * l + r * r;
            self.filled += 1;
            if self.filled == self.step {
                if self.steps.len() == SHORT_TERM_STEPS {
                    self.steps.pop_front();
                }
                self.steps.push_back(self.energy);
                self.energy = 0.0;
                self.filled = 0;
                if self.steps.len() >= BLOCK_STEPS {
                    let block: f64 = self.steps.iter().rev().take(BLOCK_STEPS).sum();
                    self.blocks.push(block / (BLOCK_STEPS * self.step) as f64);
                }
            }
        }
    }

    fn window(&self, steps: usize) -> Option<f64> {
        if self.steps.len() < steps {
            return None;
        }
        let energy: f64 = self.steps.iter().rev().take(steps).sum();
        let power = energy / (steps * self.step) as f64;
        (power > 0.0).then(|| block_loudness(power))
    }

    /// Loudness of the last 400 ms, once 400 ms have been measured.
    pub fn momentary(&self) -> Option<f64> {
        self.window(BLOCK_STEPS)
    }

    /// Loudness of the last 3 s, once 3 s have been measured.
    pub fn short_term(&self) -> Option<f64> {
        self.window(SHORT_TERM_STEPS)
    }

    /// Gated loudness of everything since the last reset.
    pub fn integrated(&self) -> Option<f64> {
        gated_loudness(&self.blocks)
    }
}
