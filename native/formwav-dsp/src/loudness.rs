use std::f64::consts::PI;

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
    let above_absolute: Vec<f64> = power.into_iter().filter(|&z| z > 0.0 && block_loudness(z) > -70.0).collect();
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
