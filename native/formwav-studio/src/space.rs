use crate::delay::{Lfo, Line};
use crate::filters::{Cut, Smooth};
use crate::Processor;

/// A Schroeder all-pass of a whole number of samples.
#[derive(Debug, Clone)]
struct AllPass {
    line: Line,
    delay: usize,
}

impl AllPass {
    fn new(delay: usize) -> AllPass {
        AllPass { line: Line::new(delay + 1), delay: delay.max(1) }
    }

    #[inline]
    fn tick(&mut self, x: f32, g: f32) -> f32 {
        let delayed = self.line.at(self.delay - 1);
        let w = x + g * delayed;
        self.line.push(w);
        delayed - g * w
    }

    /// The all-pass with its delay moved by `offset` samples, read between samples.
    #[inline]
    fn tick_moving(&mut self, x: f32, g: f32, offset: f32) -> f32 {
        let delayed = self.line.read(self.delay as f32 - 1.0 + offset);
        let w = x + g * delayed;
        self.line.push(w);
        delayed - g * w
    }

    /// The value written `back` samples ago, for an output tap.
    #[inline]
    fn tap(&self, back: usize) -> f32 {
        self.line.at(back.min(self.delay))
    }

    fn clear(&mut self) {
        self.line.clear();
    }
}

/// The parameters both reverbs share, in their spec's order.
#[derive(Debug, Clone, Copy)]
struct Shared {
    mix: f32,
    pre_delay: f32,
    decay: f32,
    size: f32,
    damping: f32,
    diffusion: f32,
    width: f32,
    low_cut: f32,
}

impl Shared {
    fn set(&mut self, index: usize, v: f32) -> bool {
        match index {
            0 => self.decay = v.max(0.05),
            1 => self.size = v / 100.0,
            2 => self.pre_delay = v,
            3 => self.damping = v,
            4 => self.low_cut = v,
            5 => self.diffusion = v / 100.0,
            6 => self.width = v / 100.0,
            7 => self.mix = v / 100.0,
            _ => return false,
        }
        true
    }

    fn tail(&self, rate: f32) -> usize {
        ((self.decay * 1.4 + self.pre_delay * 0.001) * rate) as usize
    }
}

/// The wet pair through the low cut and the width, mixed with the dry pair.
#[inline]
fn finish(dry: (f32, f32), wet: (f32, f32), cut: &mut Cut, s: &Shared) -> (f32, f32) {
    let (wl, wr) = (cut.tick(0, wet.0), cut.tick(1, wet.1));
    let mid = 0.5 * (wl + wr);
    let side = 0.5 * (wl - wr) * s.width;
    (dry.0 + (mid + side - dry.0) * s.mix, dry.1 + (mid - side - dry.1) * s.mix)
}

const ROOM_MS: [f32; 8] = [31.7, 37.3, 41.9, 45.1, 50.3, 54.7, 60.1, 67.3];
const ROOM_DIFFUSE_MS: [[f32; 4]; 2] = [[4.7, 3.6, 12.7, 9.3], [5.1, 3.3, 12.1, 9.8]];

/// A room: the input diffused by four all-passes a side, then eight delay lines fed back through a Householder
/// matrix, each line damped by a low pass and scaled for the decay time.
pub struct Room {
    rate: f32,
    s: Shared,
    pre: [Line; 2],
    diffusers: [[AllPass; 4]; 2],
    lines: Vec<Line>,
    lengths: [usize; 8],
    gains: [f32; 8],
    damp: [Smooth; 8],
    cut: Cut,
}

impl Room {
    pub fn new(rate: f32) -> Room {
        let max_line = |ms: f32| (ms * 0.001 * rate * 1.7).ceil() as usize + 2;
        let diffusers = ROOM_DIFFUSE_MS.map(|side| side.map(|ms| AllPass::new((ms * 0.001 * rate) as usize)));
        let mut room = Room {
            rate,
            s: Shared { mix: 0.2, pre_delay: 6.0, decay: 1.0, size: 0.4, damping: 6500.0, diffusion: 0.65, width: 1.0, low_cut: 50.0 },
            pre: [Line::new((0.15 * rate) as usize + 2), Line::new((0.15 * rate) as usize + 2)],
            diffusers,
            lines: ROOM_MS.iter().map(|ms| Line::new(max_line(*ms))).collect(),
            lengths: [1; 8],
            gains: [0.0; 8],
            damp: [Smooth::default(); 8],
            cut: Cut::default(),
        };
        room.design();
        room
    }

    fn design(&mut self) {
        let scale = 0.35 + 1.3 * self.s.size.clamp(0.0, 1.0);
        for (i, ms) in ROOM_MS.iter().enumerate() {
            let len = ((ms * scale * 0.001 * self.rate) as usize).clamp(2, self.lines[i].capacity() - 2);
            self.lengths[i] = len;
            self.gains[i] = 10f32.powf(-3.0 * len as f32 / (self.s.decay * self.rate));
            self.damp[i].design(self.s.damping, self.rate);
        }
        self.cut.design(true, self.s.low_cut, 1, self.rate);
    }
}

impl Processor for Room {
    fn set(&mut self, index: usize, v: f32) {
        if self.s.set(index, v) {
            self.design();
        }
    }

    fn reset(&mut self) {
        for l in self.pre.iter_mut().chain(self.lines.iter_mut()) {
            l.clear();
        }
        for side in &mut self.diffusers {
            for a in side {
                a.clear();
            }
        }
        for d in &mut self.damp {
            d.reset();
        }
        self.cut.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let pre = (self.s.pre_delay * 0.001 * self.rate) as usize;
        let g = 0.75 * self.s.diffusion.clamp(0.0, 1.0);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let dry = (*l, *r);
            self.pre[0].push(*l);
            self.pre[1].push(*r);
            let mut ins = [self.pre[0].at(pre), self.pre[1].at(pre)];
            for (side, x) in ins.iter_mut().enumerate() {
                for a in &mut self.diffusers[side] {
                    *x = a.tick(*x, g);
                }
            }
            let mut out = [0f32; 8];
            for (i, o) in out.iter_mut().enumerate() {
                *o = self.damp[i].tick(0, self.lines[i].at(self.lengths[i] - 1));
            }
            let sum: f32 = out.iter().sum::<f32>() * 0.25;
            for (i, o) in out.iter().enumerate() {
                let fed = (o - sum) * self.gains[i] + ins[i & 1] * 0.5;
                self.lines[i].push(fed);
            }
            let wl = 0.5 * (out[0] + out[2] - out[4] + out[6]);
            let wr = 0.5 * (out[1] + out[3] + out[5] - out[7]);
            (*l, *r) = finish(dry, (wl, wr), &mut self.cut, &self.s);
        }
    }

    fn tail(&self) -> usize {
        self.s.tail(self.rate)
    }
}

const PLATE_RATE: f32 = 29761.0;
const PLATE_INPUT: [usize; 4] = [142, 107, 379, 277];
const PLATE_TANK: [usize; 8] = [672, 4453, 1800, 3720, 908, 4217, 2656, 3163];
const PLATE_LEFT_TAPS: [(usize, usize, f32); 7] = [(5, 266, 1.0), (5, 2974, 1.0), (6, 1913, -1.0), (7, 1996, 1.0), (1, 1990, -1.0), (2, 187, -1.0), (3, 1066, -1.0)];
const PLATE_RIGHT_TAPS: [(usize, usize, f32); 7] = [(1, 353, 1.0), (1, 3627, 1.0), (2, 1228, -1.0), (3, 2673, 1.0), (5, 2111, -1.0), (6, 335, -1.0), (7, 121, -1.0)];

/// A plate: the figure-of-eight tank of Dattorro's "Effect Design, Part 1" (J. Audio Eng. Soc., 1997), its lengths
/// scaled from his 29761 Hz to the session's rate and by the size, its decay set from the decay time.
pub struct Plate {
    rate: f32,
    s: Shared,
    scale: f32,
    pre: Line,
    input: [AllPass; 4],
    input_len: [usize; 4],
    tank_ap: [AllPass; 4],
    tank_delays: [Line; 4],
    lengths: [usize; 8],
    damp: [Smooth; 2],
    lfo: Lfo,
    excursion: f32,
    decay: f32,
    feedback: [f32; 2],
    cut: Cut,
}

impl Plate {
    pub fn new(rate: f32) -> Plate {
        let most = rate / PLATE_RATE * 1.5;
        let len = |n: usize| (n as f32 * most).ceil() as usize + 4;
        let mut lfo = Lfo::default();
        lfo.set(1.0, rate);
        let mut plate = Plate {
            rate,
            s: Shared { mix: 0.25, pre_delay: 12.0, decay: 2.0, size: 0.55, damping: 10000.0, diffusion: 0.75, width: 1.0, low_cut: 80.0 },
            scale: 1.0,
            pre: Line::new((0.15 * rate) as usize + 2),
            input: PLATE_INPUT.map(|n| AllPass::new(len(n))),
            input_len: [1; 4],
            tank_ap: [AllPass::new(len(672) + 40), AllPass::new(len(1800)), AllPass::new(len(908) + 40), AllPass::new(len(2656))],
            tank_delays: [Line::new(len(4453)), Line::new(len(3720)), Line::new(len(4217)), Line::new(len(3163))],
            lengths: [1; 8],
            damp: [Smooth::default(); 2],
            lfo,
            excursion: 16.0 * rate / PLATE_RATE,
            decay: 0.5,
            feedback: [0.0; 2],
            cut: Cut::default(),
        };
        plate.design();
        plate
    }

    fn design(&mut self) {
        self.scale = self.rate / PLATE_RATE * (0.6 + 0.8 * self.s.size.clamp(0.0, 1.0));
        for (i, n) in PLATE_INPUT.iter().enumerate() {
            self.input_len[i] = ((*n as f32 * self.scale) as usize).max(1);
            self.input[i].delay = self.input_len[i].min(self.input[i].line.capacity() - 2).max(1);
        }
        for (i, n) in PLATE_TANK.iter().enumerate() {
            self.lengths[i] = ((*n as f32 * self.scale) as usize).max(2);
        }
        for (i, slot) in [0usize, 2, 4, 6].iter().enumerate() {
            let ap = &mut self.tank_ap[i];
            ap.delay = self.lengths[*slot].min(ap.line.capacity() - 40).max(1);
        }
        for (i, slot) in [1usize, 3, 5, 7].iter().enumerate() {
            self.lengths[*slot] = self.lengths[*slot].min(self.tank_delays[i].capacity() - 2);
        }
        let loop_samples: usize = self.lengths.iter().sum();
        let loop_seconds = loop_samples as f32 / self.rate;
        self.decay = 10f32.powf(-3.0 * loop_seconds / (4.0 * self.s.decay)).min(0.9995);
        for d in &mut self.damp {
            d.design(self.s.damping, self.rate);
        }
        self.cut.design(true, self.s.low_cut, 1, self.rate);
    }

    /// An output tap: (tank element, samples back, sign); elements 0, 2, 4, 6 are the all-passes, the rest delays.
    #[inline]
    fn tap(&self, element: usize, back: usize) -> f32 {
        let back = ((back as f32 * self.scale) as usize).max(1);
        match element {
            0 | 2 | 4 | 6 => self.tank_ap[element / 2].tap(back),
            _ => {
                let line = &self.tank_delays[element / 2];
                line.at(back.min(self.lengths[element] - 1))
            }
        }
    }
}

impl Processor for Plate {
    fn set(&mut self, index: usize, v: f32) {
        if self.s.set(index, v) {
            self.design();
        }
    }

    fn reset(&mut self) {
        self.pre.clear();
        for a in self.input.iter_mut().chain(self.tank_ap.iter_mut()) {
            a.clear();
        }
        for l in &mut self.tank_delays {
            l.clear();
        }
        for d in &mut self.damp {
            d.reset();
        }
        self.lfo.reset();
        self.feedback = [0.0; 2];
        self.cut.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let pre = (self.s.pre_delay * 0.001 * self.rate) as usize;
        let d = self.s.diffusion.clamp(0.0, 1.0);
        let (g1, g2) = (0.75 * d / 0.8, 0.625 * d / 0.8);
        let (dd1, dd2) = (0.70f32, 0.5f32);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let dry = (*l, *r);
            self.pre.push(0.5 * (*l + *r));
            let mut x = self.pre.at(pre);
            x = self.input[0].tick(x, g1.min(0.9));
            x = self.input[1].tick(x, g1.min(0.9));
            x = self.input[2].tick(x, g2.min(0.9));
            x = self.input[3].tick(x, g2.min(0.9));
            let wobble = self.lfo.value(0.0) * self.excursion;
            let other = self.lfo.value(0.25) * self.excursion;
            self.lfo.advance();

            let mut a = x + self.feedback[1];
            a = self.tank_ap[0].tick_moving(a, -dd1, wobble);
            self.tank_delays[0].push(a);
            a = self.tank_delays[0].at(self.lengths[1] - 1);
            a = self.damp[0].tick(0, a) * self.decay;
            a = self.tank_ap[1].tick(a, dd2);
            self.tank_delays[1].push(a);
            let left_out = self.tank_delays[1].at(self.lengths[3] - 1) * self.decay;

            let mut b = x + self.feedback[0];
            b = self.tank_ap[2].tick_moving(b, -dd1, other);
            self.tank_delays[2].push(b);
            b = self.tank_delays[2].at(self.lengths[5] - 1);
            b = self.damp[1].tick(0, b) * self.decay;
            b = self.tank_ap[3].tick(b, dd2);
            self.tank_delays[3].push(b);
            let right_out = self.tank_delays[3].at(self.lengths[7] - 1) * self.decay;

            self.feedback = [left_out, right_out];
            let wl: f32 = PLATE_LEFT_TAPS.iter().map(|&(e, back, sign)| sign * self.tap(e, back)).sum::<f32>() * 0.6;
            let wr: f32 = PLATE_RIGHT_TAPS.iter().map(|&(e, back, sign)| sign * self.tap(e, back)).sum::<f32>() * 0.6;
            (*l, *r) = finish(dry, (wl, wr), &mut self.cut, &self.s);
        }
    }

    fn tail(&self) -> usize {
        self.s.tail(self.rate)
    }
}
