//! formwav's studio processors: stereo block processors with named parameters, each described by a [`Spec`] in
//! [`catalog`] and made by [`build`]. Every processor takes its parameters by index in its spec's order, already held
//! to their ranges ([`Param::clamp`]), allocates nothing while it runs, and reports its latency, its tail and, for the
//! dynamics, the gain it is taking away.

#![forbid(unsafe_code)]

mod color;
mod delay;
mod dynamics;
mod eq;
mod filters;
mod modulation;
mod pitch;
mod rng;
mod space;
mod strip;
mod utility;

/// How a parameter's value reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Db,
    Hz,
    Ms,
    Seconds,
    Percent,
    Ratio,
    Semitones,
    Cents,
    Plain,
    Toggle,
    Choice,
}

impl Unit {
    pub fn name(self) -> &'static str {
        match self {
            Unit::Db => "Db",
            Unit::Hz => "Hz",
            Unit::Ms => "Ms",
            Unit::Seconds => "Seconds",
            Unit::Percent => "Percent",
            Unit::Ratio => "Ratio",
            Unit::Semitones => "Semitones",
            Unit::Cents => "Cents",
            Unit::Plain => "None",
            Unit::Toggle => "Toggle",
            Unit::Choice => "Choice",
        }
    }
}

/// How a control moves across a parameter's range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Taper {
    Linear,
    Log,
}

impl Taper {
    pub fn name(self) -> &'static str {
        match self {
            Taper::Linear => "Linear",
            Taper::Log => "Log",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Eq,
    Dynamics,
    Reverb,
    Delay,
    Modulation,
    Harmonic,
    Pitch,
    Utility,
}

impl Category {
    pub fn name(self) -> &'static str {
        match self {
            Category::Eq => "Eq",
            Category::Dynamics => "Dynamics",
            Category::Reverb => "Reverb",
            Category::Delay => "Delay",
            Category::Modulation => "Modulation",
            Category::Harmonic => "Harmonic",
            Category::Pitch => "Pitch",
            Category::Utility => "Utility",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Param {
    pub id: &'static str,
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub unit: Unit,
    pub taper: Taper,
    pub choices: &'static [&'static str],
}

impl Param {
    /// A value held to the parameter: in range, the default when not finite, whole for a switch or a choice.
    pub fn clamp(&self, v: f32) -> f32 {
        let v = if v.is_finite() { v.clamp(self.min, self.max) } else { self.default };
        if matches!(self.unit, Unit::Toggle | Unit::Choice) {
            v.round()
        } else {
            v
        }
    }
}

#[derive(Debug)]
pub struct Spec {
    pub id: &'static str,
    pub name: &'static str,
    pub short: &'static str,
    pub category: Category,
    pub params: &'static [Param],
}

impl Spec {
    pub fn index(&self, id: &str) -> Option<usize> {
        self.params.iter().position(|p| p.id == id)
    }
}

pub trait Processor: Send {
    /// Sets parameter `index` (the spec's order) to `value`, held to its range by the caller.
    fn set(&mut self, index: usize, value: f32);
    /// Clears every delay, envelope, filter and oscillator, as at the start of a render.
    fn reset(&mut self);
    /// A block of left and right samples processed in place; both slices have the same length.
    fn run(&mut self, left: &mut [f32], right: &mut [f32]);
    /// Samples the output lags the input by, for a mixer to compensate.
    fn latency(&self) -> usize {
        0
    }
    /// Samples of output that can follow the input's end.
    fn tail(&self) -> usize {
        0
    }
    /// The gain taken away during the last block, in dB (0 for anything but the dynamics).
    fn reduction_db(&self) -> f32 {
        0.0
    }
}

const fn num(id: &'static str, name: &'static str, min: f32, max: f32, default: f32, unit: Unit, taper: Taper) -> Param {
    Param { id, name, min, max, default, unit, taper, choices: &[] }
}

const fn switch(id: &'static str, name: &'static str, default: f32) -> Param {
    Param { id, name, min: 0.0, max: 1.0, default, unit: Unit::Toggle, taper: Taper::Linear, choices: &[] }
}

const fn pick(id: &'static str, name: &'static str, choices: &'static [&'static str], default: f32) -> Param {
    Param { id, name, min: 0.0, max: (choices.len() - 1) as f32, default, unit: Unit::Choice, taper: Taper::Linear, choices }
}

use Taper::{Linear as LIN, Log as LOG};
use Unit::{Cents, Db, Hz, Ms, Percent, Plain, Ratio, Seconds, Semitones};

const SLOPES: &[&str] = &["6 dB/oct", "12 dB/oct", "18 dB/oct", "24 dB/oct"];

/// The parameters both reverbs take, in this order.
const fn space(decay: f32, size: f32, pre_delay: f32, damping: f32, low_cut: f32, diffusion: f32, mix: f32) -> [Param; 8] {
    [
        num("decay", "Decay", 0.2, 10.0, decay, Seconds, LOG),
        num("size", "Size", 0.0, 100.0, size, Percent, LIN),
        num("pre_delay", "Pre-Delay", 0.0, 150.0, pre_delay, Ms, LIN),
        num("damping", "Damping", 1500.0, 16000.0, damping, Hz, LOG),
        num("low_cut", "Low Cut", 20.0, 600.0, low_cut, Hz, LOG),
        num("diffusion", "Diffusion", 0.0, 100.0, diffusion, Percent, LIN),
        num("width", "Width", 0.0, 100.0, 100.0, Percent, LIN),
        num("mix", "Mix", 0.0, 100.0, mix, Percent, LIN),
    ]
}

static ROOM: [Param; 8] = space(1.0, 40.0, 6.0, 6500.0, 50.0, 65.0, 20.0);
static PLATE: [Param; 8] = space(2.0, 55.0, 12.0, 10000.0, 80.0, 75.0, 25.0);

static CATALOG: [Spec; 24] = [
    Spec {
        id: "band_eq",
        name: "Band EQ",
        short: "EQ 1",
        category: Category::Eq,
        params: &[
            pick("type", "Type", &["Low Cut", "Low Shelf", "Bell", "Notch", "Band Pass", "High Shelf", "High Cut"], 2.0),
            num("freq", "Frequency", 20.0, 20000.0, 1000.0, Hz, LOG),
            num("gain", "Gain", -20.0, 20.0, 0.0, Db, LIN),
            num("q", "Q", 0.2, 16.0, 0.9, Plain, LOG),
            num("output", "Output", -20.0, 20.0, 0.0, Db, LIN),
        ],
    },
    Spec {
        id: "seven_band_eq",
        name: "7-Band EQ",
        short: "EQ 7",
        category: Category::Eq,
        params: &[
            num("input", "Input", -20.0, 20.0, 0.0, Db, LIN),
            switch("low_cut", "Low Cut", 0.0),
            num("low_cut_freq", "Low Cut Freq", 16.0, 800.0, 50.0, Hz, LOG),
            pick("low_cut_slope", "Low Cut Slope", SLOPES, 2.0),
            num("low_shelf_gain", "Low Shelf", -20.0, 20.0, 0.0, Db, LIN),
            num("low_shelf_freq", "Low Shelf Freq", 30.0, 800.0, 110.0, Hz, LOG),
            num("band1_gain", "Band 1", -20.0, 20.0, 0.0, Db, LIN),
            num("band1_freq", "Band 1 Freq", 50.0, 1500.0, 250.0, Hz, LOG),
            num("band1_q", "Band 1 Q", 0.2, 16.0, 0.9, Plain, LOG),
            num("band2_gain", "Band 2", -20.0, 20.0, 0.0, Db, LIN),
            num("band2_freq", "Band 2 Freq", 200.0, 6000.0, 1000.0, Hz, LOG),
            num("band2_q", "Band 2 Q", 0.2, 16.0, 0.9, Plain, LOG),
            num("band3_gain", "Band 3", -20.0, 20.0, 0.0, Db, LIN),
            num("band3_freq", "Band 3 Freq", 800.0, 16000.0, 3500.0, Hz, LOG),
            num("band3_q", "Band 3 Q", 0.2, 16.0, 0.9, Plain, LOG),
            num("high_shelf_gain", "High Shelf", -20.0, 20.0, 0.0, Db, LIN),
            num("high_shelf_freq", "High Shelf Freq", 2000.0, 18000.0, 8500.0, Hz, LOG),
            switch("high_cut", "High Cut", 0.0),
            num("high_cut_freq", "High Cut Freq", 2000.0, 20000.0, 15000.0, Hz, LOG),
            pick("high_cut_slope", "High Cut Slope", SLOPES, 1.0),
            num("output", "Output", -20.0, 20.0, 0.0, Db, LIN),
        ],
    },
    Spec {
        id: "compressor",
        name: "Compressor",
        short: "Comp",
        category: Category::Dynamics,
        params: &[
            num("threshold", "Threshold", -50.0, 0.0, -18.0, Db, LIN),
            num("ratio", "Ratio", 1.0, 30.0, 3.0, Ratio, LOG),
            num("attack", "Attack", 0.1, 150.0, 8.0, Ms, LOG),
            num("release", "Release", 10.0, 2500.0, 200.0, Ms, LOG),
            num("knee", "Knee", 0.0, 18.0, 4.0, Db, LIN),
            num("makeup", "Makeup", 0.0, 30.0, 0.0, Db, LIN),
            switch("sidechain_filter", "Sidechain Filter", 0.0),
            num("sidechain_freq", "Sidechain Freq", 30.0, 400.0, 90.0, Hz, LOG),
            num("lookahead", "Lookahead", 0.0, 20.0, 0.0, Ms, LIN),
            num("mix", "Mix", 0.0, 100.0, 100.0, Percent, LIN),
        ],
    },
    Spec {
        id: "gate",
        name: "Gate/Expander",
        short: "Gate",
        category: Category::Dynamics,
        params: &[
            num("threshold", "Threshold", -90.0, 0.0, -50.0, Db, LIN),
            num("ratio", "Ratio", 1.0, 40.0, 40.0, Ratio, LOG),
            num("floor", "Floor", 0.0, 80.0, 50.0, Db, LIN),
            num("attack", "Attack", 0.1, 40.0, 0.8, Ms, LOG),
            num("hold", "Hold", 0.0, 800.0, 30.0, Ms, LIN),
            num("release", "Release", 10.0, 2500.0, 200.0, Ms, LOG),
        ],
    },
    Spec {
        id: "de_esser",
        name: "De-Esser",
        short: "De-ess",
        category: Category::Dynamics,
        params: &[
            num("freq", "Frequency", 2500.0, 12000.0, 7000.0, Hz, LOG),
            num("threshold", "Threshold", -50.0, 0.0, -26.0, Db, LIN),
            num("depth", "Depth", 0.0, 24.0, 10.0, Db, LIN),
            switch("listen", "Listen", 0.0),
        ],
    },
    Spec {
        id: "maximizer",
        name: "Maximizer",
        short: "Max",
        category: Category::Dynamics,
        params: &[
            num("threshold", "Threshold", -24.0, 0.0, 0.0, Db, LIN),
            num("ceiling", "Ceiling", -12.0, 0.0, -0.5, Db, LIN),
            num("release", "Release", 10.0, 800.0, 60.0, Ms, LOG),
        ],
    },
    Spec {
        id: "channel_strip",
        name: "Channel Strip",
        short: "Strip",
        category: Category::Dynamics,
        params: &[
            num("input", "Input", -20.0, 20.0, 0.0, Db, LIN),
            pick("order", "Order", &["EQ first", "Dyn first"], 1.0),
            switch("low_cut", "Low Cut", 0.0),
            num("low_cut_freq", "Low Cut Freq", 16.0, 600.0, 40.0, Hz, LOG),
            num("low_gain", "Low", -15.0, 15.0, 0.0, Db, LIN),
            num("low_freq", "Low Freq", 40.0, 400.0, 90.0, Hz, LOG),
            num("low_mid_gain", "Low Mid", -15.0, 15.0, 0.0, Db, LIN),
            num("low_mid_freq", "Low Mid Freq", 100.0, 2000.0, 400.0, Hz, LOG),
            num("high_mid_gain", "High Mid", -15.0, 15.0, 0.0, Db, LIN),
            num("high_mid_freq", "High Mid Freq", 800.0, 10000.0, 2500.0, Hz, LOG),
            num("high_mid_q", "High Mid Q", 0.3, 6.0, 0.8, Plain, LOG),
            num("high_gain", "High", -15.0, 15.0, 0.0, Db, LIN),
            num("high_freq", "High Freq", 2000.0, 18000.0, 10000.0, Hz, LOG),
            switch("comp", "Compressor", 0.0),
            num("comp_threshold", "Comp Threshold", -50.0, 0.0, -20.0, Db, LIN),
            num("comp_ratio", "Comp Ratio", 1.5, 12.0, 2.5, Ratio, LOG),
            num("comp_attack", "Comp Attack", 0.1, 100.0, 6.0, Ms, LOG),
            num("comp_release", "Comp Release", 10.0, 1500.0, 180.0, Ms, LOG),
            switch("gate", "Gate", 0.0),
            num("gate_threshold", "Gate Threshold", -90.0, -10.0, -55.0, Db, LIN),
            num("gate_floor", "Gate Floor", 0.0, 60.0, 30.0, Db, LIN),
            num("output", "Output", -20.0, 20.0, 0.0, Db, LIN),
        ],
    },
    Spec { id: "room", name: "Room", short: "Room", category: Category::Reverb, params: &ROOM },
    Spec { id: "plate", name: "Plate", short: "Plate", category: Category::Reverb, params: &PLATE },
    Spec {
        id: "delay",
        name: "Modulated Delay",
        short: "Delay",
        category: Category::Delay,
        params: &[
            num("time", "Time", 1.0, 2500.0, 375.0, Ms, LOG),
            num("feedback", "Feedback", -90.0, 90.0, 30.0, Percent, LIN),
            num("tone", "Tone", 600.0, 20000.0, 8000.0, Hz, LOG),
            num("mod_rate", "Mod Rate", 0.05, 6.0, 0.4, Hz, LOG),
            num("mod_depth", "Mod Depth", 0.0, 100.0, 0.0, Percent, LIN),
            num("mix", "Mix", 0.0, 100.0, 25.0, Percent, LIN),
        ],
    },
    Spec {
        id: "chorus",
        name: "Chorus",
        short: "Chorus",
        category: Category::Modulation,
        params: &[
            num("delay", "Delay", 5.0, 40.0, 18.0, Ms, LIN),
            num("rate", "Rate", 0.1, 8.0, 0.9, Hz, LOG),
            num("depth", "Depth", 0.0, 100.0, 40.0, Percent, LIN),
            num("spread", "Spread", 0.0, 100.0, 75.0, Percent, LIN),
            num("feedback", "Feedback", 0.0, 70.0, 0.0, Percent, LIN),
            num("mix", "Mix", 0.0, 100.0, 40.0, Percent, LIN),
        ],
    },
    Spec {
        id: "flanger",
        name: "Flanger",
        short: "Flange",
        category: Category::Modulation,
        params: &[
            num("delay", "Delay", 0.5, 12.0, 2.5, Ms, LIN),
            num("rate", "Rate", 0.05, 5.0, 0.3, Hz, LOG),
            num("depth", "Depth", 0.0, 100.0, 60.0, Percent, LIN),
            num("feedback", "Feedback", -90.0, 90.0, 45.0, Percent, LIN),
            num("mix", "Mix", 0.0, 100.0, 50.0, Percent, LIN),
        ],
    },
    Spec {
        id: "phaser",
        name: "Phaser",
        short: "Phase",
        category: Category::Modulation,
        params: &[
            pick("stages", "Stages", &["4", "6", "8", "10", "12"], 1.0),
            num("center", "Center", 200.0, 2500.0, 600.0, Hz, LOG),
            num("rate", "Rate", 0.05, 5.0, 0.35, Hz, LOG),
            num("depth", "Depth", 0.0, 100.0, 65.0, Percent, LIN),
            num("feedback", "Feedback", -85.0, 85.0, 30.0, Percent, LIN),
            num("mix", "Mix", 0.0, 100.0, 50.0, Percent, LIN),
        ],
    },
    Spec {
        id: "drive",
        name: "Drive",
        short: "Drive",
        category: Category::Harmonic,
        params: &[
            num("drive", "Drive", 0.0, 40.0, 10.0, Db, LIN),
            pick("character", "Character", &["Soft", "Warm", "Hard"], 0.0),
            num("tone", "Tone", 2000.0, 20000.0, 20000.0, Hz, LOG),
            num("output", "Output", -30.0, 6.0, 0.0, Db, LIN),
            num("mix", "Mix", 0.0, 100.0, 100.0, Percent, LIN),
        ],
    },
    Spec {
        id: "bitcrush",
        name: "Bit Crusher",
        short: "Crush",
        category: Category::Harmonic,
        params: &[
            num("bits", "Bits", 3.0, 24.0, 12.0, Plain, LIN),
            num("downsample", "Downsample", 800.0, 48000.0, 16000.0, Hz, LOG),
            num("hiss", "Hiss", 0.0, 100.0, 0.0, Percent, LIN),
            num("mix", "Mix", 0.0, 100.0, 100.0, Percent, LIN),
        ],
    },
    Spec {
        id: "rectify",
        name: "Rectifier",
        short: "Rect",
        category: Category::Harmonic,
        params: &[
            pick("mode", "Mode", &["Full Wave", "Half Wave"], 0.0),
            num("blend", "Blend", 0.0, 100.0, 100.0, Percent, LIN),
            num("output", "Output", -24.0, 24.0, -6.0, Db, LIN),
        ],
    },
    Spec {
        id: "pitch",
        name: "Pitch Shift",
        short: "Shift",
        category: Category::Pitch,
        params: &[
            num("semitones", "Semitones", -24.0, 24.0, 0.0, Semitones, LIN),
            num("cents", "Cents", -100.0, 100.0, 0.0, Cents, LIN),
            num("window", "Window", 20.0, 120.0, 60.0, Ms, LIN),
            num("mix", "Mix", 0.0, 100.0, 100.0, Percent, LIN),
        ],
    },
    Spec {
        id: "offset",
        name: "Time Offset",
        short: "Offset",
        category: Category::Utility,
        params: &[num("ms", "Milliseconds", 0.0, 2000.0, 0.0, Ms, LIN), num("samples", "Samples", 0.0, 9600.0, 0.0, Plain, LIN)],
    },
    Spec { id: "gain", name: "Gain", short: "Gain", category: Category::Utility, params: &[num("gain", "Gain", -72.0, 24.0, 0.0, Db, LIN)] },
    Spec {
        id: "trim",
        name: "Trim",
        short: "Trim",
        category: Category::Utility,
        params: &[num("gain", "Trim", -48.0, 18.0, 0.0, Db, LIN), switch("invert", "Invert", 0.0)],
    },
    Spec { id: "polarity", name: "Polarity", short: "Flip", category: Category::Utility, params: &[] },
    Spec { id: "dc_block", name: "DC Block", short: "DC", category: Category::Utility, params: &[num("cutoff", "Cutoff", 1.0, 30.0, 6.0, Hz, LOG)] },
    Spec {
        id: "tone",
        name: "Test Tone",
        short: "Tone",
        category: Category::Utility,
        params: &[
            pick("waveform", "Waveform", &["Sine", "Triangle", "Square", "Sawtooth", "Pink Noise", "White Noise"], 0.0),
            num("freq", "Frequency", 10.0, 20000.0, 1000.0, Hz, LOG),
            num("level", "Level", -90.0, 0.0, -18.0, Db, LIN),
        ],
    },
    Spec {
        id: "dither",
        name: "Dither",
        short: "Dither",
        category: Category::Utility,
        params: &[pick("bits", "Bits", &["24", "20", "16"], 2.0), switch("shaping", "Noise Shaping", 0.0)],
    },
];

/// Every processor's description, in the order an interface lists them.
pub fn catalog() -> &'static [Spec] {
    &CATALOG
}

pub fn spec(id: &str) -> Option<&'static Spec> {
    CATALOG.iter().find(|s| s.id == id)
}

/// The processor `id` at `rate`, every parameter at its default and every buffer clear; None for an unknown id or a
/// rate below 1 kHz.
pub fn build(id: &str, rate: f32) -> Option<Box<dyn Processor>> {
    if !(rate.is_finite() && rate >= 1000.0) {
        return None;
    }
    let spec = spec(id)?;
    let mut p: Box<dyn Processor> = match id {
        "band_eq" => Box::new(eq::OneBand::new(rate)),
        "seven_band_eq" => Box::new(eq::SevenBand::new(rate)),
        "compressor" => Box::new(dynamics::Compressor::new(rate)),
        "gate" => Box::new(dynamics::Expander::new(rate)),
        "de_esser" => Box::new(dynamics::DeEsser::new(rate)),
        "maximizer" => Box::new(dynamics::Maximizer::new(rate)),
        "channel_strip" => Box::new(strip::ChannelStrip::new(rate)),
        "room" => Box::new(space::Room::new(rate)),
        "plate" => Box::new(space::Plate::new(rate)),
        "delay" => Box::new(modulation::ModDelay::new(rate)),
        "chorus" => Box::new(modulation::Chorus::new(rate)),
        "flanger" => Box::new(modulation::Flanger::new(rate)),
        "phaser" => Box::new(modulation::Phaser::new(rate)),
        "drive" => Box::new(color::Drive::new(rate)),
        "bitcrush" => Box::new(color::Crusher::new(rate)),
        "rectify" => Box::new(color::Rectifier::new(rate)),
        "pitch" => Box::new(pitch::PitchShifter::new(rate)),
        "offset" => Box::new(utility::Offset::new(rate)),
        "gain" => Box::new(utility::Gain::new(false)),
        "trim" => Box::new(utility::Gain::new(true)),
        "polarity" => Box::new(utility::Polarity),
        "dc_block" => Box::new(utility::DcBlock::new(rate)),
        "tone" => Box::new(utility::Tone::new(rate)),
        "dither" => Box::new(utility::Dither::new()),
        _ => return None,
    };
    for (i, param) in spec.params.iter().enumerate() {
        p.set(i, param.default);
    }
    p.reset();
    Some(p)
}

/// Decibels to a linear gain.
#[inline]
pub(crate) fn gain_of(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// A linear level to decibels, -200 for silence.
#[inline]
pub(crate) fn db_of(level: f32) -> f32 {
    if level > 1e-10 {
        20.0 * level.log10()
    } else {
        -200.0
    }
}

/// The one-pole smoothing coefficient that covers about 63% of a step in `ms` milliseconds.
#[inline]
pub(crate) fn ballistic(ms: f32, rate: f32) -> f32 {
    let samples = (ms * 0.001 * rate).max(1e-3);
    (-1.0 / samples).exp()
}
