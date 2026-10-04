//! LADSPA hosting (AU-41): the effects a LADSPA library exports, their control ports as parameters, and offline
//! processing. A library holds many plugins (CMT's one file holds dozens), so a plugin is addressed as
//! `<library>#<index>`. Only folders named `ladspa` are scanned for libraries, since loading one runs its initialisers.

use std::ffi::{c_char, c_int, c_ulong, c_void, CStr};
use std::path::{Path, PathBuf};

use crate::params::Param;
use crate::wav::Audio;

#[repr(C)]
struct RangeHint {
    hint: c_int,
    lower: f32,
    upper: f32,
}

/// ladspa.h's LADSPA_Descriptor, field for field.
#[repr(C)]
struct Descriptor {
    unique_id: c_ulong,
    label: *const c_char,
    properties: c_int,
    name: *const c_char,
    maker: *const c_char,
    copyright: *const c_char,
    port_count: c_ulong,
    port_descriptors: *const c_int,
    port_names: *const *const c_char,
    port_range_hints: *const RangeHint,
    implementation_data: *mut c_void,
    instantiate: Option<unsafe extern "C" fn(*const Descriptor, c_ulong) -> *mut c_void>,
    connect_port: Option<unsafe extern "C" fn(*mut c_void, c_ulong, *mut f32)>,
    activate: Option<unsafe extern "C" fn(*mut c_void)>,
    run: Option<unsafe extern "C" fn(*mut c_void, c_ulong)>,
    run_adding: Option<unsafe extern "C" fn(*mut c_void, c_ulong)>,
    set_run_adding_gain: Option<unsafe extern "C" fn(*mut c_void, f32)>,
    deactivate: Option<unsafe extern "C" fn(*mut c_void)>,
    cleanup: Option<unsafe extern "C" fn(*mut c_void)>,
}

const INPUT: c_int = 0x1;
const OUTPUT: c_int = 0x2;
const CONTROL: c_int = 0x4;
const AUDIO: c_int = 0x8;
const BOUNDED_BELOW: c_int = 0x1;
const BOUNDED_ABOVE: c_int = 0x2;
const TOGGLED: c_int = 0x4;
const SAMPLE_RATE: c_int = 0x8;
const LOGARITHMIC: c_int = 0x10;
const INTEGER: c_int = 0x20;
const DEFAULT_MASK: c_int = 0x3C0;
const BLOCK: usize = 1024;

type DescriptorFn = unsafe extern "C" fn(c_ulong) -> *const Descriptor;

struct Port {
    index: usize,
    name: String,
    kind: c_int,
    hint: c_int,
    lower: f32,
    upper: f32,
}

impl Port {
    fn is(&self, bits: c_int) -> bool {
        self.kind & bits == bits
    }

    /// The control's range at `rate` (sample-rate bounds scaled; an open end given a usable stand-in).
    fn range(&self, rate: f32) -> (f32, f32) {
        if self.hint & TOGGLED != 0 {
            return (0.0, 1.0);
        }
        let scale = if self.hint & SAMPLE_RATE != 0 { rate } else { 1.0 };
        let lo = if self.hint & BOUNDED_BELOW != 0 { self.lower * scale } else { f32::NAN };
        let hi = if self.hint & BOUNDED_ABOVE != 0 { self.upper * scale } else { f32::NAN };
        match (lo.is_nan(), hi.is_nan()) {
            (false, false) => (lo, hi),
            (false, true) => (lo, lo.abs().max(1.0) * 100.0),
            (true, false) => (if hi > 0.0 { 0.0 } else { hi - 100.0 }, hi),
            (true, true) => (0.0, 1.0),
        }
    }

    /// LADSPA's default hint, between the bounds (geometric when logarithmic), or 0, 1, 100 or 440.
    fn default(&self, rate: f32) -> f32 {
        let (lo, hi) = self.range(rate);
        let mix = |a: f32| {
            if self.hint & LOGARITHMIC != 0 && lo > 0.0 && hi > 0.0 {
                (lo.ln() * (1.0 - a) + hi.ln() * a).exp()
            } else {
                lo * (1.0 - a) + hi * a
            }
        };
        let v = match self.hint & DEFAULT_MASK {
            0x40 => lo,
            0x80 => mix(0.25),
            0xC0 => mix(0.5),
            0x100 => mix(0.75),
            0x140 => hi,
            0x200 => 0.0,
            0x240 => 1.0,
            0x280 => 100.0,
            0x2C0 => 440.0,
            _ => 0.0f32.clamp(lo.min(hi), hi.max(lo)),
        };
        if self.hint & INTEGER != 0 { v.round() } else { v }
    }
}

struct Library {
    _lib: libloading::Library,
    get: DescriptorFn,
}

/// `<library>#<index>` split; a bare library means its first plugin.
fn split(path: &Path) -> (PathBuf, c_ulong) {
    let text = path.to_string_lossy();
    match text.rsplit_once('#') {
        Some((lib, idx)) if !idx.is_empty() && idx.chars().all(|c| c.is_ascii_digit()) => (PathBuf::from(lib), idx.parse().unwrap_or(0)),
        _ => (path.to_path_buf(), 0),
    }
}

fn open(lib_path: &Path) -> Result<Library, String> {
    unsafe {
        let lib = libloading::Library::new(lib_path).map_err(|e| format!("cannot load {}: {e}", lib_path.display()))?;
        let get: DescriptorFn = *lib.get::<DescriptorFn>(b"ladspa_descriptor\0").map_err(|_| "not a LADSPA library (no ladspa_descriptor)".to_string())?;
        Ok(Library { _lib: lib, get })
    }
}

unsafe fn text(p: *const c_char) -> String {
    if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

unsafe fn ports(d: *const Descriptor) -> Vec<Port> {
    (0..(*d).port_count as usize)
        .map(|i| {
            let h = &*(*d).port_range_hints.add(i);
            Port { index: i, name: text(*(*d).port_names.add(i)), kind: *(*d).port_descriptors.add(i), hint: h.hint, lower: h.lower, upper: h.upper }
        })
        .collect()
}

fn audio(ps: &[Port], dir: c_int) -> Vec<usize> {
    ps.iter().filter(|p| p.is(AUDIO | dir)).map(|p| p.index).collect()
}

/// The effects in a library (audio in and out), as (index, label, name).
pub fn describe(lib_path: &Path) -> Result<Vec<(u64, String, String)>, String> {
    let l = open(lib_path)?;
    let mut out = Vec::new();
    unsafe {
        for i in 0..4096 {
            let d = (l.get)(i);
            if d.is_null() {
                break;
            }
            let ps = ports(d);
            if !audio(&ps, INPUT).is_empty() && !audio(&ps, OUTPUT).is_empty() {
                out.push((i as u64, text((*d).label), text((*d).name)));
            }
        }
    }
    Ok(out)
}

/// The plugin's control inputs as parameters (ids are port numbers), at 48 kHz for sample-rate ranges.
pub fn params(path: &Path) -> Result<Vec<Param>, String> {
    let (lib_path, idx) = split(path);
    let l = open(&lib_path)?;
    unsafe {
        let d = (l.get)(idx);
        if d.is_null() {
            return Err(format!("no plugin {idx} in {}", lib_path.display()));
        }
        Ok(ports(d)
            .iter()
            .filter(|p| p.is(CONTROL | INPUT))
            .map(|p| {
                let (lo, hi) = p.range(48000.0);
                let steps = if p.hint & TOGGLED != 0 { 1 } else if p.hint & INTEGER != 0 { (hi - lo).round().max(0.0) as i32 } else { 0 };
                Param { id: p.index as u32, name: p.name.clone(), min: lo as f64, max: hi as f64, default: p.default(48000.0) as f64, steps }
            })
            .collect())
    }
}

/// One instance run over whole signals: `inputs` per audio input port (shorter ones padded with silence), every port
/// connected before the first run as LADSPA requires, in blocks of BLOCK frames; returns each audio output.
unsafe fn run(d: *const Descriptor, ps: &[Port], rate: f32, values: &[(u32, f64)], inputs: &[Vec<f32>], frames: usize) -> Result<Vec<Vec<f32>>, String> {
    let handle = ((*d).instantiate.ok_or("no instantiate")?)(d, rate as c_ulong);
    if handle.is_null() {
        return Err("the plugin would not start".into());
    }
    let connect = (*d).connect_port.ok_or("no connect_port")?;
    let ins = audio(ps, INPUT);
    let outs = audio(ps, OUTPUT);
    let mut in_bufs: Vec<Vec<f32>> = ins.iter().map(|_| vec![0.0; BLOCK]).collect();
    let mut out_bufs: Vec<Vec<f32>> = outs.iter().map(|_| vec![0.0; BLOCK]).collect();
    let mut controls: Vec<f32> = ps.iter().map(|p| if p.is(CONTROL | INPUT) { values.iter().find(|(id, _)| *id as usize == p.index).map(|(_, v)| *v as f32).unwrap_or_else(|| p.default(rate)) } else { 0.0 }).collect();
    for p in ps {
        let ptr = if let Some(k) = ins.iter().position(|&i| i == p.index) {
            in_bufs[k].as_mut_ptr()
        } else if let Some(k) = outs.iter().position(|&i| i == p.index) {
            out_bufs[k].as_mut_ptr()
        } else {
            controls.as_mut_ptr().add(p.index)
        };
        connect(handle, p.index as c_ulong, ptr);
    }
    if let Some(activate) = (*d).activate {
        activate(handle);
    }
    let runf = (*d).run.ok_or("no run")?;
    let mut result: Vec<Vec<f32>> = outs.iter().map(|_| Vec::with_capacity(frames)).collect();
    let mut at = 0;
    while at < frames {
        let n = BLOCK.min(frames - at);
        for (k, buf) in in_bufs.iter_mut().enumerate() {
            for (j, s) in buf[..n].iter_mut().enumerate() {
                *s = inputs.get(k).and_then(|x| x.get(at + j)).copied().unwrap_or(0.0);
            }
        }
        runf(handle, n as c_ulong);
        for (k, buf) in out_bufs.iter().enumerate() {
            result[k].extend_from_slice(&buf[..n]);
        }
        at += n;
    }
    if let Some(deactivate) = (*d).deactivate {
        deactivate(handle);
    }
    if let Some(cleanup) = (*d).cleanup {
        cleanup(handle);
    }
    Ok(result)
}

/// Runs `input` (mono becomes both sides) through the plugin, then `tail_s` seconds of silence; returns stereo. A plugin
/// with two audio inputs and outputs takes the pair; a mono one runs as one instance per side.
pub fn process(path: &Path, input: &Audio, tail_s: f64, values: &[(u32, f64)]) -> Result<Audio, String> {
    let (lib_path, idx) = split(path);
    let l = open(&lib_path)?;
    let left = input.channels.first().cloned().unwrap_or_default();
    let right = input.channels.get(1).cloned().unwrap_or_else(|| left.clone());
    let frames = left.len() + (tail_s.max(0.0) * input.rate as f64).round() as usize;
    let rate = input.rate as f32;
    unsafe {
        let d = (l.get)(idx);
        if d.is_null() {
            return Err(format!("no plugin {idx} in {}", lib_path.display()));
        }
        let ps = ports(d);
        let (ins, outs) = (audio(&ps, INPUT), audio(&ps, OUTPUT));
        if ins.is_empty() || outs.is_empty() {
            return Err("this LADSPA plugin is not an effect (it has no audio input or output)".into());
        }
        let channels = if ins.len() >= 2 && outs.len() >= 2 {
            let out = run(d, &ps, rate, values, &[left, right], frames)?;
            vec![out[0].clone(), out[1].clone()]
        } else {
            let a = run(d, &ps, rate, values, &[left], frames)?;
            let b = run(d, &ps, rate, values, &[right], frames)?;
            vec![a[0].clone(), b[0].clone()]
        };
        Ok(Audio { rate: input.rate, channels })
    }
}
