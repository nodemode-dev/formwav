/// SplitMix64: a fixed seed gives the same noise on every run, so a render repeats exactly.
#[derive(Debug, Clone)]
pub struct Noise {
    seed: u64,
    state: u64,
}

impl Noise {
    pub fn new(seed: u64) -> Noise {
        Noise { seed, state: seed }
    }

    pub fn reset(&mut self) {
        self.state = self.seed;
    }

    #[inline]
    pub fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    #[inline]
    pub fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// Uniform in [-1, 1).
    #[inline]
    pub fn bipolar(&mut self) -> f32 {
        self.unit() * 2.0 - 1.0
    }
}
