//! AU-27: Audio Unit effects (macOS). A unit is addressed by its component identity, type:subtype:manufacturer as
//! four-character codes (Apple's AUDelay is aufx:dely:appl); AudioToolbox's and CoreFoundation's few functions are
//! declared here, as mac.rs declares CoreFoundation's, rather than through a crate.

use crate::params::Param;

#[cfg(target_os = "macos")]
mod sys {
    use std::ffi::{c_char, c_void};

    pub type OSStatus = i32;
    pub type AudioComponent = *mut c_void;
    pub type AudioUnit = *mut c_void;
    pub type CFStringRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct AudioComponentDescription {
        pub component_type: u32,
        pub component_sub_type: u32,
        pub component_manufacturer: u32,
        pub component_flags: u32,
        pub component_flags_mask: u32,
    }

    #[repr(C)]
    pub struct AudioStreamBasicDescription {
        pub sample_rate: f64,
        pub format_id: u32,
        pub format_flags: u32,
        pub bytes_per_packet: u32,
        pub frames_per_packet: u32,
        pub bytes_per_frame: u32,
        pub channels_per_frame: u32,
        pub bits_per_channel: u32,
        pub reserved: u32,
    }

    #[repr(C)]
    pub struct AudioBuffer {
        pub number_channels: u32,
        pub data_byte_size: u32,
        pub data: *mut c_void,
    }

    #[repr(C)]
    pub struct AudioBufferList2 {
        pub number_buffers: u32,
        pub buffers: [AudioBuffer; 2],
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct SmpteTime {
        pub subframes: i16,
        pub subframe_divisor: i16,
        pub counter: u32,
        pub kind: u32,
        pub flags: u32,
        pub hours: i16,
        pub minutes: i16,
        pub seconds: i16,
        pub frames: i16,
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct AudioTimeStamp {
        pub sample_time: f64,
        pub host_time: u64,
        pub rate_scalar: f64,
        pub word_clock_time: u64,
        pub smpte_time: SmpteTime,
        pub flags: u32,
        pub reserved: u32,
    }

    pub type RenderCallback = unsafe extern "C" fn(*mut c_void, *mut u32, *const AudioTimeStamp, u32, u32, *mut AudioBufferList2) -> OSStatus;

    #[repr(C)]
    pub struct RenderCallbackStruct {
        pub input_proc: RenderCallback,
        pub input_proc_ref_con: *mut c_void,
    }

    #[repr(C)]
    pub struct ParameterInfo {
        pub name: [c_char; 52],
        pub unit_name: CFStringRef,
        pub clump_id: u32,
        pub cf_name_string: CFStringRef,
        pub unit: u32,
        pub min_value: f32,
        pub max_value: f32,
        pub default_value: f32,
        pub flags: u32,
    }

    #[link(name = "AudioToolbox", kind = "framework")]
    extern "C" {
        pub fn AudioComponentFindNext(component: AudioComponent, desc: *const AudioComponentDescription) -> AudioComponent;
        pub fn AudioComponentCopyName(component: AudioComponent, name: *mut CFStringRef) -> OSStatus;
        pub fn AudioComponentGetDescription(component: AudioComponent, desc: *mut AudioComponentDescription) -> OSStatus;
        pub fn AudioComponentInstanceNew(component: AudioComponent, unit: *mut AudioUnit) -> OSStatus;
        pub fn AudioComponentInstanceDispose(unit: AudioUnit) -> OSStatus;
        pub fn AudioUnitInitialize(unit: AudioUnit) -> OSStatus;
        pub fn AudioUnitUninitialize(unit: AudioUnit) -> OSStatus;
        pub fn AudioUnitSetProperty(unit: AudioUnit, id: u32, scope: u32, element: u32, data: *const c_void, size: u32) -> OSStatus;
        pub fn AudioUnitGetProperty(unit: AudioUnit, id: u32, scope: u32, element: u32, data: *mut c_void, size: *mut u32) -> OSStatus;
        pub fn AudioUnitGetPropertyInfo(unit: AudioUnit, id: u32, scope: u32, element: u32, size: *mut u32, writable: *mut u8) -> OSStatus;
        pub fn AudioUnitSetParameter(unit: AudioUnit, id: u32, scope: u32, element: u32, value: f32, offset: u32) -> OSStatus;
        pub fn AudioUnitRender(unit: AudioUnit, flags: *mut u32, stamp: *const AudioTimeStamp, bus: u32, frames: u32, data: *mut AudioBufferList2) -> OSStatus;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFStringGetCString(s: CFStringRef, buf: *mut c_char, size: isize, encoding: u32) -> u8;
        pub fn CFRelease(cf: *const c_void);
    }

    pub const EFFECT: u32 = u32::from_be_bytes(*b"aufx");
    pub const MUSIC_EFFECT: u32 = u32::from_be_bytes(*b"aumf");
    pub const LPCM: u32 = u32::from_be_bytes(*b"lpcm");
    pub const FLOAT_PACKED_NONINTERLEAVED: u32 = 1 | 8 | 32;
    pub const STREAM_FORMAT: u32 = 8;
    pub const PARAMETER_LIST: u32 = 3;
    pub const PARAMETER_INFO: u32 = 4;
    pub const LATENCY: u32 = 12;
    pub const MAX_FRAMES: u32 = 14;
    pub const SET_RENDER_CALLBACK: u32 = 23;
    pub const GLOBAL: u32 = 0;
    pub const INPUT: u32 = 1;
    pub const OUTPUT: u32 = 2;
    pub const SAMPLE_TIME_VALID: u32 = 1;
    pub const UTF8: u32 = 0x0800_0100;
}

#[cfg(target_os = "macos")]
fn fourcc(v: u32) -> String {
    v.to_be_bytes().iter().map(|&b| if b.is_ascii_graphic() || b == b' ' { b as char } else { '?' }).collect()
}

#[cfg(target_os = "macos")]
fn parse_id(id: &str) -> Result<sys::AudioComponentDescription, String> {
    let parts: Vec<&str> = id.split(':').collect();
    let code = |s: &str| -> Result<u32, String> {
        let b = s.as_bytes();
        if b.len() != 4 {
            return Err(format!("{id} is not type:subtype:manufacturer in four-character codes"));
        }
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    if parts.len() != 3 {
        return Err(format!("{id} is not type:subtype:manufacturer in four-character codes"));
    }
    Ok(sys::AudioComponentDescription { component_type: code(parts[0])?, component_sub_type: code(parts[1])?, component_manufacturer: code(parts[2])?, ..Default::default() })
}

#[cfg(target_os = "macos")]
unsafe fn cf_string(s: sys::CFStringRef) -> String {
    let mut buf = [0 as std::ffi::c_char; 256];
    if s.is_null() || sys::CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, sys::UTF8) == 0 {
        return String::new();
    }
    std::ffi::CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
}

/// Every effect and music-effect unit on this Mac as scan entries.
pub fn list() -> Vec<(String, String)> {
    #[cfg(target_os = "macos")]
    unsafe {
        let mut out = Vec::new();
        for kind in [sys::EFFECT, sys::MUSIC_EFFECT] {
            let want = sys::AudioComponentDescription { component_type: kind, ..Default::default() };
            let mut c = sys::AudioComponentFindNext(std::ptr::null_mut(), &want);
            while !c.is_null() {
                let mut d = sys::AudioComponentDescription::default();
                let mut name: sys::CFStringRef = std::ptr::null();
                if sys::AudioComponentGetDescription(c, &mut d) == 0 && sys::AudioComponentCopyName(c, &mut name) == 0 {
                    out.push((format!("{}:{}:{}", fourcc(d.component_type), fourcc(d.component_sub_type), fourcc(d.component_manufacturer)), cf_string(name)));
                    if !name.is_null() {
                        sys::CFRelease(name);
                    }
                }
                c = sys::AudioComponentFindNext(c, &want);
            }
        }
        out
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[cfg(target_os = "macos")]
unsafe fn open(id: &str, rate: u32) -> Result<sys::AudioUnit, String> {
    let want = parse_id(id)?;
    let c = sys::AudioComponentFindNext(std::ptr::null_mut(), &want);
    if c.is_null() {
        return Err(format!("no Audio Unit {id} on this Mac"));
    }
    let mut unit: sys::AudioUnit = std::ptr::null_mut();
    if sys::AudioComponentInstanceNew(c, &mut unit) != 0 || unit.is_null() {
        return Err(format!("{id} would not open"));
    }
    let format = sys::AudioStreamBasicDescription { sample_rate: rate as f64, format_id: sys::LPCM, format_flags: sys::FLOAT_PACKED_NONINTERLEAVED, bytes_per_packet: 4, frames_per_packet: 1, bytes_per_frame: 4, channels_per_frame: 2, bits_per_channel: 32, reserved: 0 };
    let size = std::mem::size_of::<sys::AudioStreamBasicDescription>() as u32;
    for scope in [sys::INPUT, sys::OUTPUT] {
        let status = sys::AudioUnitSetProperty(unit, sys::STREAM_FORMAT, scope, 0, &format as *const _ as *const _, size);
        if status != 0 {
            sys::AudioComponentInstanceDispose(unit);
            return Err(format!("{id} refused stereo float at {rate} Hz (status {status})"));
        }
    }
    let max: u32 = 512;
    sys::AudioUnitSetProperty(unit, sys::MAX_FRAMES, sys::GLOBAL, 0, &max as *const _ as *const _, 4);
    Ok(unit)
}

#[cfg(target_os = "macos")]
struct Feed {
    left: *const f32,
    right: *const f32,
    frames: usize,
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn feed(ctx: *mut std::ffi::c_void, _flags: *mut u32, stamp: *const sys::AudioTimeStamp, _bus: u32, frames: u32, data: *mut sys::AudioBufferList2) -> sys::OSStatus {
    let feed = &*(ctx as *const Feed);
    let at = (*stamp).sample_time.max(0.0) as usize;
    for (k, src) in [feed.left, feed.right].into_iter().enumerate().take((*data).number_buffers.min(2) as usize) {
        let dst = (*data).buffers[k].data as *mut f32;
        if dst.is_null() {
            continue;
        }
        for i in 0..frames as usize {
            *dst.add(i) = if at + i < feed.frames { *src.add(at + i) } else { 0.0 };
        }
    }
    0
}

/// The input rendered through the unit, parameters set by id, its reported latency taken off the front.
pub fn process(id: &str, rate: u32, left: &[f32], right: &[f32], out: &mut [Vec<f32>], values: &[(u32, f64)]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let unit = open(id, rate)?;
        let total = left.len();
        let mut latency_s: f64 = 0.0;
        let mut size = 8u32;
        sys::AudioUnitGetProperty(unit, sys::LATENCY, sys::GLOBAL, 0, &mut latency_s as *mut f64 as *mut _, &mut size);
        let lat = (latency_s.max(0.0) * rate as f64).round() as usize;
        let mut l = left.to_vec();
        let mut r = right.to_vec();
        l.resize(total + lat, 0.0);
        r.resize(total + lat, 0.0);
        let feed_ctx = Box::new(Feed { left: l.as_ptr(), right: r.as_ptr(), frames: l.len() });
        let cb = sys::RenderCallbackStruct { input_proc: feed, input_proc_ref_con: &*feed_ctx as *const Feed as *mut _ };
        sys::AudioUnitSetProperty(unit, sys::SET_RENDER_CALLBACK, sys::INPUT, 0, &cb as *const _ as *const _, std::mem::size_of::<sys::RenderCallbackStruct>() as u32);
        if sys::AudioUnitInitialize(unit) != 0 {
            sys::AudioComponentInstanceDispose(unit);
            return Err(format!("{id} would not initialize"));
        }
        for &(pid, v) in values {
            sys::AudioUnitSetParameter(unit, pid, sys::GLOBAL, 0, v as f32, 0);
        }
        let mut wet = [vec![0f32; l.len()], vec![0f32; l.len()]];
        let mut pos = 0usize;
        while pos < l.len() {
            let n = 512.min(l.len() - pos);
            let stamp = sys::AudioTimeStamp { sample_time: pos as f64, flags: sys::SAMPLE_TIME_VALID, ..Default::default() };
            let mut abl = sys::AudioBufferList2 {
                number_buffers: 2,
                buffers: [
                    sys::AudioBuffer { number_channels: 1, data_byte_size: (n * 4) as u32, data: wet[0][pos..].as_mut_ptr() as *mut _ },
                    sys::AudioBuffer { number_channels: 1, data_byte_size: (n * 4) as u32, data: wet[1][pos..].as_mut_ptr() as *mut _ },
                ],
            };
            let mut flags = 0u32;
            let status = sys::AudioUnitRender(unit, &mut flags, &stamp, 0, n as u32, &mut abl);
            if status != 0 {
                sys::AudioUnitUninitialize(unit);
                sys::AudioComponentInstanceDispose(unit);
                return Err(format!("{id} failed to render (status {status})"));
            }
            pos += n;
        }
        sys::AudioUnitUninitialize(unit);
        sys::AudioComponentInstanceDispose(unit);
        drop(feed_ctx);
        for (o, w) in out.iter_mut().zip(wet.iter()) {
            for (i, v) in o.iter_mut().enumerate() {
                *v = w[i + lat];
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (id, rate, left, right, out, values);
        Err("Audio Units exist only on macOS".into())
    }
}

/// The unit's parameters: id, name, range and default.
pub fn params(id: &str) -> Result<Vec<Param>, String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let unit = open(id, 48000)?;
        let mut size = 0u32;
        let mut writable = 0u8;
        let mut out = Vec::new();
        if sys::AudioUnitGetPropertyInfo(unit, sys::PARAMETER_LIST, sys::GLOBAL, 0, &mut size, &mut writable) == 0 && size > 0 {
            let mut ids = vec![0u32; size as usize / 4];
            sys::AudioUnitGetProperty(unit, sys::PARAMETER_LIST, sys::GLOBAL, 0, ids.as_mut_ptr() as *mut _, &mut size);
            for pid in ids {
                let mut info: sys::ParameterInfo = std::mem::zeroed();
                let mut isize_ = std::mem::size_of::<sys::ParameterInfo>() as u32;
                if sys::AudioUnitGetProperty(unit, sys::PARAMETER_INFO, sys::GLOBAL, pid, &mut info as *mut _ as *mut _, &mut isize_) != 0 {
                    continue;
                }
                let name = if info.cf_name_string.is_null() { std::ffi::CStr::from_ptr(info.name.as_ptr()).to_string_lossy().into_owned() } else { cf_string(info.cf_name_string) };
                out.push(Param { id: pid, name, min: info.min_value as f64, max: info.max_value as f64, default: info.default_value as f64, steps: 0 });
            }
        }
        sys::AudioComponentInstanceDispose(unit);
        Ok(out)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("Audio Units exist only on macOS".into())
    }
}

/// The owner's check on a Mac: Apple's AUDelay at 0.1 s, fully wet, must move an impulse 4800 samples at 48 kHz, and
/// AULowpass at 1 kHz must pass 200 Hz and cut 8 kHz. Prints the measurements as JSON.
pub fn check() -> String {
    let rate = 48000u32;
    let mut impulse = vec![0f32; rate as usize];
    impulse[1000] = 1.0;
    let mut out = vec![vec![0f32; impulse.len()], vec![0f32; impulse.len()]];
    let delay = match process("aufx:dely:appl", rate, &impulse, &impulse, &mut out, &[(0, 100.0), (1, 0.1), (2, 0.0), (3, 23000.0)]) {
        Ok(()) => {
            let peak = out[0].iter().enumerate().fold((0usize, 0f32), |m, (i, v)| if v.abs() > m.1 { (i, v.abs()) } else { m });
            format!("{{\"unit\": \"AUDelay\", \"expected_shift\": 4800, \"measured_shift\": {}, \"peak\": {:.3}}}", peak.0 as i64 - 1000, peak.1)
        }
        Err(e) => format!("{{\"unit\": \"AUDelay\", \"error\": \"{}\"}}", e.replace('"', "'")),
    };
    let tone = |hz: f32| (0..rate as usize).map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin() * 0.5).collect::<Vec<f32>>();
    let level = |hz: f32| -> Result<f32, String> {
        let x = tone(hz);
        let mut o = vec![vec![0f32; x.len()], vec![0f32; x.len()]];
        process("aufx:lpas:appl", rate, &x, &x, &mut o, &[(0, 1000.0), (1, 0.0)])?;
        let rms = |v: &[f32]| (v[rate as usize / 2..].iter().map(|s| s * s).sum::<f32>() / (v.len() - rate as usize / 2) as f32).sqrt();
        Ok(20.0 * (rms(&o[0]) / rms(&x)).log10())
    };
    let lowpass = match (level(200.0), level(8000.0)) {
        (Ok(a), Ok(b)) => format!("{{\"unit\": \"AULowpass\", \"cutoff_hz\": 1000, \"gain_200_hz_db\": {a:.2}, \"gain_8000_hz_db\": {b:.2}}}"),
        (Err(e), _) | (_, Err(e)) => format!("{{\"unit\": \"AULowpass\", \"error\": \"{}\"}}", e.replace('"', "'")),
    };
    format!("{{\"audio_units\": {}, \"checks\": [{delay}, {lowpass}]}}", list().len())
}
