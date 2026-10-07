use crate::delay::{Lfo, Line};
use crate::filters::Smooth;
use crate::Processor;

/// A delay up to two seconds, its time swayed by an oscillator, its repeats through a low pass.
pub struct ModDelay {
    rate: f32,
    lines: [Line; 2],
    time: f32,
    feedback: f32,
    mix: f32,
    depth: f32,
    lfo: Lfo,
    tone: Smooth,
    last: [f32; 2],
}

impl ModDelay {
    pub fn new(rate: f32) -> ModDelay {
        let max = (2.7 * rate) as usize;
        let mut d = ModDelay { rate, lines: [Line::new(max), Line::new(max)], time: 375.0, feedback: 0.3, mix: 0.25, depth: 0.0, lfo: Lfo::default(), tone: Smooth::default(), last: [0.0; 2] };
        d.lfo.set(0.4, rate);
        d.tone.design(8000.0, rate);
        d
    }
}

impl Processor for ModDelay {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.time = v,
            1 => self.feedback = v / 100.0,
            2 => self.tone.design(v, self.rate),
            3 => self.lfo.set(v, self.rate),
            4 => self.depth = v / 100.0,
            5 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        for l in &mut self.lines {
            l.clear();
        }
        self.lfo.reset();
        self.tone.reset();
        self.last = [0.0; 2];
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let base = self.time * 0.001 * self.rate;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let sway = 1.0 + 0.05 * self.depth * self.lfo.value(0.0);
            self.lfo.advance();
            let at = (base * sway).max(1.0);
            let mut io = [*l, *r];
            for (ch, x) in io.iter_mut().enumerate() {
                let wet = self.lines[ch].read(at);
                let toned = self.tone.tick(ch, wet);
                self.lines[ch].push(*x + toned * self.feedback);
                self.last[ch] = wet;
                *x += (wet - *x) * self.mix;
            }
            (*l, *r) = (io[0], io[1]);
        }
    }

    fn tail(&self) -> usize {
        let repeats = if self.feedback.abs() < 0.01 { 1.0 } else { (-60.0 / (20.0 * self.feedback.abs().log10())).min(200.0) + 1.0 };
        (self.time * 0.001 * self.rate * repeats) as usize
    }
}

/// Two voices, one a side, each a short delay swept by an oscillator, the right one's phase offset by the spread.
pub struct Chorus {
    rate: f32,
    lines: [Line; 2],
    lfo: Lfo,
    depth: f32,
    delay: f32,
    feedback: f32,
    mix: f32,
    spread: f32,
    last: [f32; 2],
}

impl Chorus {
    pub fn new(rate: f32) -> Chorus {
        let max = (0.06 * rate) as usize;
        let mut c = Chorus { rate, lines: [Line::new(max), Line::new(max)], lfo: Lfo::default(), depth: 0.4, delay: 18.0, feedback: 0.0, mix: 0.4, spread: 0.75, last: [0.0; 2] };
        c.lfo.set(0.9, rate);
        c
    }
}

impl Processor for Chorus {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.delay = v,
            1 => self.lfo.set(v, self.rate),
            2 => self.depth = v / 100.0,
            3 => self.spread = v / 100.0,
            4 => self.feedback = v / 100.0,
            5 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        for l in &mut self.lines {
            l.clear();
        }
        self.lfo.reset();
        self.last = [0.0; 2];
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let centre = self.delay * 0.001 * self.rate;
        let swing = (centre * 0.45).min(0.008 * self.rate) * self.depth;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let offsets = [0.0, 0.5 * self.spread];
            let mut io = [*l, *r];
            for (ch, x) in io.iter_mut().enumerate() {
                let at = centre + swing * self.lfo.value(offsets[ch]);
                let wet = self.lines[ch].read(at);
                self.lines[ch].push(*x + self.last[ch] * self.feedback);
                self.last[ch] = wet;
                *x += (wet - *x) * self.mix;
            }
            self.lfo.advance();
            (*l, *r) = (io[0], io[1]);
        }
    }
}

/// A very short delay swept between its base time and five milliseconds past it, with feedback of either sign.
pub struct Flanger {
    rate: f32,
    lines: [Line; 2],
    lfo: Lfo,
    depth: f32,
    delay: f32,
    feedback: f32,
    mix: f32,
    last: [f32; 2],
}

impl Flanger {
    pub fn new(rate: f32) -> Flanger {
        let max = (0.025 * rate) as usize;
        let mut f = Flanger { rate, lines: [Line::new(max), Line::new(max)], lfo: Lfo::default(), depth: 0.6, delay: 2.5, feedback: 0.45, mix: 0.5, last: [0.0; 2] };
        f.lfo.set(0.3, rate);
        f
    }
}

impl Processor for Flanger {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.delay = v,
            1 => self.lfo.set(v, self.rate),
            2 => self.depth = v / 100.0,
            3 => self.feedback = v / 100.0,
            4 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        for l in &mut self.lines {
            l.clear();
        }
        self.lfo.reset();
        self.last = [0.0; 2];
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let base = self.delay * 0.001 * self.rate;
        let sweep = 0.005 * self.rate * self.depth;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let mut io = [*l, *r];
            for (ch, x) in io.iter_mut().enumerate() {
                let at = base + sweep * 0.5 * (1.0 + self.lfo.value(0.25 * ch as f32));
                let wet = self.lines[ch].read(at.max(1.0));
                self.lines[ch].push(*x + wet * self.feedback);
                self.last[ch] = wet;
                *x += (wet - *x) * self.mix;
            }
            self.lfo.advance();
            (*l, *r) = (io[0], io[1]);
        }
    }
}

const MOST_STAGES: usize = 12;

/// First-order all-passes in series whose turning frequency sweeps two octaves either side of the centre; the
/// last stage's output fed back to the first.
pub struct Phaser {
    rate: f32,
    lfo: Lfo,
    depth: f32,
    stages: usize,
    feedback: f32,
    centre: f32,
    mix: f32,
    z: [[f32; MOST_STAGES]; 2],
    last: [f32; 2],
}

impl Phaser {
    pub fn new(rate: f32) -> Phaser {
        let mut p = Phaser { rate, lfo: Lfo::default(), depth: 0.65, stages: 6, feedback: 0.3, centre: 600.0, mix: 0.5, z: [[0.0; MOST_STAGES]; 2], last: [0.0; 2] };
        p.lfo.set(0.35, rate);
        p
    }
}

impl Processor for Phaser {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.stages = (4 + 2 * (v.round().max(0.0) as usize)).min(MOST_STAGES),
            1 => self.centre = v,
            2 => self.lfo.set(v, self.rate),
            3 => self.depth = v / 100.0,
            4 => self.feedback = v / 100.0,
            5 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.lfo.reset();
        self.z = [[0.0; MOST_STAGES]; 2];
        self.last = [0.0; 2];
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let nyquist = self.rate * 0.45;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let mut io = [*l, *r];
            for (ch, x) in io.iter_mut().enumerate() {
                let f = (self.centre * 2f32.powf(2.0 * self.depth * self.lfo.value(0.25 * ch as f32))).clamp(20.0, nyquist);
                let t = (std::f32::consts::PI * f / self.rate).tan();
                let a = (t - 1.0) / (t + 1.0);
                let mut y = *x + self.last[ch] * self.feedback;
                for z in &mut self.z[ch][..self.stages] {
                    let out = a * y + *z;
                    *z = y - a * out;
                    y = out;
                }
                self.last[ch] = y;
                *x += (y - *x) * self.mix;
            }
            self.lfo.advance();
            (*l, *r) = (io[0], io[1]);
        }
    }
}
