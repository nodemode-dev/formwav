pub const MAX_CH: usize = 16;

#[derive(Debug, Clone, Copy)]
pub struct Speaker {
    pub name: &'static str,
    pub az: f32,
    pub el: f32,
    pub lfe: bool,
    pub bit: u32,
}

#[derive(Debug)]
pub struct Layout {
    pub id: u8,
    pub name: &'static str,
    pub speakers: &'static [Speaker],
    pub mask: u32,
    pub ambisonic: bool,
}

const fn s(name: &'static str, az: f32, el: f32, bit: u32) -> Speaker {
    Speaker { name, az, el, lfe: false, bit }
}

const LFE: Speaker = Speaker { name: "LFE", az: 0.0, el: 0.0, lfe: true, bit: 0x8 };
const L30: Speaker = s("L", -30.0, 0.0, 0x1);
const R30: Speaker = s("R", 30.0, 0.0, 0x2);
const C: Speaker = s("C", 0.0, 0.0, 0x4);

static L_51: [Speaker; 6] = [L30, R30, C, LFE, s("Ls", -110.0, 0.0, 0x200), s("Rs", 110.0, 0.0, 0x400)];
static L_FOA: [Speaker; 4] = [s("W", 0.0, 0.0, 0), s("Y", 0.0, 0.0, 0), s("Z", 0.0, 0.0, 0), s("X", 0.0, 0.0, 0)];
static L_20: [Speaker; 2] = [L30, R30];
static L_LCR: [Speaker; 3] = [L30, R30, C];
static L_QUAD: [Speaker; 4] = [s("L", -45.0, 0.0, 0x1), s("R", 45.0, 0.0, 0x2), s("Lb", -135.0, 0.0, 0x10), s("Rb", 135.0, 0.0, 0x20)];
static L_50: [Speaker; 5] = [L30, R30, C, s("Ls", -110.0, 0.0, 0x200), s("Rs", 110.0, 0.0, 0x400)];
static L_61: [Speaker; 7] = [L30, R30, C, LFE, s("Cs", 180.0, 0.0, 0x100), s("Lss", -90.0, 0.0, 0x200), s("Rss", 90.0, 0.0, 0x400)];
static L_71: [Speaker; 8] = [L30, R30, C, LFE, s("Lrs", -135.0, 0.0, 0x10), s("Rrs", 135.0, 0.0, 0x20), s("Lss", -90.0, 0.0, 0x200), s("Rss", 90.0, 0.0, 0x400)];
static L_512: [Speaker; 8] = [L30, R30, C, LFE, s("Ls", -110.0, 0.0, 0x200), s("Rs", 110.0, 0.0, 0x400), s("Ltf", -30.0, 30.0, 0x1000), s("Rtf", 30.0, 30.0, 0x4000)];
static L_514: [Speaker; 10] = [
    L30,
    R30,
    C,
    LFE,
    s("Ls", -110.0, 0.0, 0x200),
    s("Rs", 110.0, 0.0, 0x400),
    s("Ltf", -30.0, 30.0, 0x1000),
    s("Rtf", 30.0, 30.0, 0x4000),
    s("Ltr", -110.0, 30.0, 0x8000),
    s("Rtr", 110.0, 30.0, 0x20000),
];
static L_712: [Speaker; 10] = [
    L30,
    R30,
    C,
    LFE,
    s("Lrs", -135.0, 0.0, 0x10),
    s("Rrs", 135.0, 0.0, 0x20),
    s("Lss", -90.0, 0.0, 0x200),
    s("Rss", 90.0, 0.0, 0x400),
    s("Ltf", -30.0, 30.0, 0x1000),
    s("Rtf", 30.0, 30.0, 0x4000),
];
static L_714: [Speaker; 12] = [
    L30,
    R30,
    C,
    LFE,
    s("Lrs", -135.0, 0.0, 0x10),
    s("Rrs", 135.0, 0.0, 0x20),
    s("Lss", -90.0, 0.0, 0x200),
    s("Rss", 90.0, 0.0, 0x400),
    s("Ltf", -45.0, 30.0, 0x1000),
    s("Rtf", 45.0, 30.0, 0x4000),
    s("Ltr", -135.0, 30.0, 0x8000),
    s("Rtr", 135.0, 30.0, 0x20000),
];
static L_916: [Speaker; 16] = [
    L30,
    R30,
    C,
    LFE,
    s("Lrs", -135.0, 0.0, 0x10),
    s("Rrs", 135.0, 0.0, 0x20),
    s("Lw", -60.0, 0.0, 0x40),
    s("Rw", 60.0, 0.0, 0x80),
    s("Lss", -90.0, 0.0, 0x200),
    s("Rss", 90.0, 0.0, 0x400),
    s("Ltf", -45.0, 45.0, 0x1000),
    s("Rtf", 45.0, 45.0, 0x4000),
    s("Ltr", -135.0, 30.0, 0x8000),
    s("Rtr", 135.0, 30.0, 0x20000),
    s("Ltm", -90.0, 45.0, 0x40000),
    s("Rtm", 90.0, 45.0, 0x80000),
];

const fn lay(id: u8, name: &'static str, speakers: &'static [Speaker], mask: u32) -> Layout {
    Layout { id, name, speakers, mask, ambisonic: false }
}

static LAYOUTS: [Layout; 13] = [
    lay(0, "5.1", &L_51, 0x60F),
    Layout { id: 1, name: "foa", speakers: &L_FOA, mask: 0, ambisonic: true },
    lay(2, "stereo", &L_20, 0x3),
    lay(3, "lcr", &L_LCR, 0x7),
    lay(4, "quad", &L_QUAD, 0x33),
    lay(5, "5.0", &L_50, 0x607),
    lay(6, "6.1", &L_61, 0x70F),
    lay(7, "7.1", &L_71, 0x63F),
    lay(8, "5.1.2", &L_512, 0x560F),
    lay(9, "5.1.4", &L_514, 0x2D60F),
    lay(10, "7.1.2", &L_712, 0x563F),
    lay(11, "7.1.4", &L_714, 0x2D63F),
    lay(12, "9.1.6", &L_916, 0xED6FF),
];

pub const COUNT: u8 = 13;

pub fn layout(id: u8) -> &'static Layout {
    LAYOUTS.get(id as usize).unwrap_or(&LAYOUTS[0])
}

impl Layout {
    pub fn channels(&self) -> usize {
        self.speakers.len()
    }

    fn has_side_pair(&self) -> bool {
        self.speakers.iter().any(|s| !s.lfe && s.el == 0.0 && s.az.abs() > 60.0 && s.az.abs() <= 120.0)
    }

    /// Each channel's share of the stereo fold-down (Lo, Ro), after ITU-R BS.775's downmix: fronts whole to their
    /// side, the centre and the sides at -3 dB, rear pairs at -3 dB or -6 dB beside a side pair, a back centre and
    /// every height channel at -6 dB, the LFE left out. First-order ambisonics folds through its own cardioids.
    pub fn fold(&self) -> [[f32; 2]; MAX_CH] {
        let mut out = [[0.0f32; 2]; MAX_CH];
        let k = std::f32::consts::FRAC_1_SQRT_2;
        let sides = self.has_side_pair();
        for (i, sp) in self.speakers.iter().enumerate() {
            let a = sp.az.abs();
            let share = if self.ambisonic || sp.lfe {
                0.0
            } else if sp.el > 0.0 {
                0.5
            } else if a == 0.0 {
                k
            } else if a >= 180.0 {
                0.5
            } else if a <= 45.0 {
                1.0
            } else if a <= 120.0 {
                k
            } else if sides {
                0.5
            } else {
                k
            };
            out[i] = if sp.az == 0.0 || sp.az >= 180.0 {
                [share, share]
            } else if sp.az < 0.0 {
                [share, 0.0]
            } else {
                [0.0, share]
            };
        }
        out
    }
}
