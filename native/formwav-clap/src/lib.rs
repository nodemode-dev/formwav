//! RX-67: formwav's realtime repair tools as CLAP plugins for other hosts (Bitwig, Reaper and any CLAP host), one
//! bundle holding two: De-noise, the core's adaptive de-noiser (fx.rs Denoiser), and De-hum, a run of narrow cuts at
//! the mains frequency and its harmonics. Each instance keeps its parameters in atomics (the host reads them on its
//! main thread while audio runs), applies parameter events at the start of each block, saves and loads its state, and
//! processes in place safely (each frame's inputs are read before its outputs are written).

use std::cell::UnsafeCell;
use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{clap_event_header, clap_event_param_value, clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE};
use clap_sys::ext::audio_ports::{clap_audio_port_info, clap_plugin_audio_ports, CLAP_AUDIO_PORT_IS_MAIN, CLAP_EXT_AUDIO_PORTS, CLAP_PORT_STEREO};
use clap_sys::ext::params::{clap_host_params, clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE, CLAP_PARAM_IS_STEPPED, CLAP_PARAM_RESCAN_VALUES};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::id::clap_id;
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_CONTINUE, CLAP_PROCESS_ERROR};
use clap_sys::stream::{clap_istream, clap_ostream};
use clap_sys::version::CLAP_VERSION;
use formwav_dsp::fx::{Biquad, Denoiser};

struct Shared<T>(T);
unsafe impl<T> Sync for Shared<T> {}

/// One parameter: its id is its index; `stepped` ones take whole values.
struct Param {
    name: &'static str,
    unit: &'static str,
    min: f64,
    max: f64,
    default: f64,
    stepped: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Denoise,
    Dehum,
}

const DENOISE_PARAMS: [Param; 2] = [
    Param { name: "Reduction", unit: "dB", min: 0.0, max: 40.0, default: 12.0, stepped: false },
    Param { name: "Sensitivity", unit: "dB", min: -6.0, max: 12.0, default: 3.0, stepped: false },
];
const DEHUM_PARAMS: [Param; 4] = [
    Param { name: "Frequency", unit: "Hz", min: 40.0, max: 70.0, default: 50.0, stepped: false },
    Param { name: "Harmonics", unit: "", min: 1.0, max: 8.0, default: 4.0, stepped: true },
    Param { name: "Reduction", unit: "dB", min: 0.0, max: 60.0, default: 30.0, stepped: false },
    Param { name: "Q", unit: "", min: 2.0, max: 80.0, default: 30.0, stepped: false },
];
const MAX_PARAMS: usize = 4;

impl Kind {
    fn params(self) -> &'static [Param] {
        match self {
            Kind::Denoise => &DENOISE_PARAMS,
            Kind::Dehum => &DEHUM_PARAMS,
        }
    }
    fn tag(self) -> u8 {
        match self {
            Kind::Denoise => 1,
            Kind::Dehum => 2,
        }
    }
}

static DENOISE_FEATURES: Shared<[*const c_char; 4]> = Shared([c"audio-effect".as_ptr(), c"restoration".as_ptr(), c"stereo".as_ptr(), ptr::null()]);
static DEHUM_FEATURES: Shared<[*const c_char; 5]> = Shared([c"audio-effect".as_ptr(), c"restoration".as_ptr(), c"filter".as_ptr(), c"stereo".as_ptr(), ptr::null()]);

static DESCRIPTORS: Shared<[clap_plugin_descriptor; 2]> = Shared([
    clap_plugin_descriptor {
        clap_version: CLAP_VERSION,
        id: c"ai.nodemode.formwav.denoise".as_ptr(),
        name: c"formwav De-noise".as_ptr(),
        vendor: c"nodemode-ai".as_ptr(),
        url: c"https://nodemode.ai".as_ptr(),
        manual_url: c"".as_ptr(),
        support_url: c"".as_ptr(),
        version: c"1.0.0".as_ptr(),
        description: c"Adaptive realtime noise reduction: learns the noise floor in sixteen bands as it plays, no latency".as_ptr(),
        features: &DENOISE_FEATURES.0 as *const [*const c_char; 4] as *const *const c_char,
    },
    clap_plugin_descriptor {
        clap_version: CLAP_VERSION,
        id: c"ai.nodemode.formwav.dehum".as_ptr(),
        name: c"formwav De-hum".as_ptr(),
        vendor: c"nodemode-ai".as_ptr(),
        url: c"https://nodemode.ai".as_ptr(),
        manual_url: c"".as_ptr(),
        support_url: c"".as_ptr(),
        version: c"1.0.0".as_ptr(),
        description: c"Mains hum removal: narrow cuts at 50 or 60 Hz and its harmonics, no latency".as_ptr(),
        features: &DEHUM_FEATURES.0 as *const [*const c_char; 5] as *const *const c_char,
    },
]);

enum Dsp {
    Bypass,
    Denoise(Box<Denoiser>),
    /// The cuts and how many are in use: a fixed array, so a change while playing redesigns them without allocating
    /// on the audio thread
    Dehum([Biquad; 8], usize),
}

impl Dsp {
    #[inline]
    fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        match self {
            Dsp::Bypass => (l, r),
            Dsp::Denoise(d) => d.process(l, r),
            Dsp::Dehum(cuts, n) => {
                let (mut l, mut r) = (l, r);
                for c in cuts[..*n].iter_mut() {
                    l = c.process(0, l);
                    r = c.process(1, r);
                }
                (l, r)
            }
        }
    }
}

/// The notch run for De-hum's values (frequency, harmonics, reduction, Q): a peak cut at each harmonic below 0.45 of
/// the rate, designed into `cuts` in place (no allocation); returns how many are in use. A cut redesigned keeps the
/// filter state it had, so a change while playing does not click.
fn dehum_cuts(cuts: &mut [Biquad; 8], values: &[f64], rate: f64) -> usize {
    let (freq, harmonics, reduction, q) = (values[0], (values[1].round().max(1.0) as usize).min(8), values[2], values[3]);
    let mut n = 0;
    for k in 1..=harmonics {
        let f = freq * k as f64;
        if f >= 0.45 * rate {
            break;
        }
        if let Some(b) = Biquad::design(3, f as f32, -(reduction as f32), q as f32, rate as f32) {
            cuts[n].retune(&b);
            n += 1;
        }
    }
    n
}

struct Instance {
    plugin: clap_plugin,
    /// The host it was made for, asked to rescan the parameters' values after a state load.
    host: *const clap_host,
    kind: Kind,
    values: [AtomicU64; MAX_PARAMS],
    dirty: AtomicBool,
    rate: UnsafeCell<f64>,
    dsp: UnsafeCell<Dsp>,
}

unsafe impl Sync for Instance {}

impl Instance {
    fn value(&self, id: usize) -> f64 {
        f64::from_bits(self.values[id].load(Ordering::Relaxed))
    }
    fn set(&self, id: usize, value: f64) {
        let Some(p) = self.kind.params().get(id) else { return };
        if !value.is_finite() {
            return;
        }
        let v = value.clamp(p.min, p.max);
        let v = if p.stepped { v.round() } else { v };
        self.values[id].store(v.to_bits(), Ordering::Relaxed);
        self.dirty.store(true, Ordering::Release);
    }
    fn values(&self) -> Vec<f64> {
        (0..self.kind.params().len()).map(|i| self.value(i)).collect()
    }
    /// Builds the DSP for the current values at the current rate (the main thread, while not processing).
    unsafe fn build(&self) {
        let rate = *self.rate.get();
        let v = self.values();
        *self.dsp.get() = match self.kind {
            Kind::Denoise => Denoiser::design(v[0] as f32, v[1] as f32, rate as f32).map(|d| Dsp::Denoise(Box::new(d))).unwrap_or(Dsp::Bypass),
            Kind::Dehum => {
                let mut cuts = [Biquad::bandpass(1000.0, 1.0, rate as f32); 8];
                let n = dehum_cuts(&mut cuts, &v, rate);
                Dsp::Dehum(cuts, n)
            }
        };
        self.dirty.store(false, Ordering::Release);
    }
    /// New values reach the DSP (the audio thread): the de-noiser retuned with what it has learned kept, the hum cuts
    /// redesigned.
    unsafe fn apply(&self) {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let v = self.values();
        match &mut *self.dsp.get() {
            Dsp::Denoise(d) => d.retune(v[0] as f32, v[1] as f32),
            Dsp::Dehum(cuts, n) => {
                let was = *n;
                *n = dehum_cuts(cuts, &v, *self.rate.get());
                for c in cuts.iter_mut().take(*n).skip(was) {
                    c.reset();
                }
            }
            Dsp::Bypass => {}
        }
    }
    unsafe fn read_events(&self, events: *const clap_input_events) {
        if events.is_null() {
            return;
        }
        let list = &*events;
        let (Some(size), Some(get)) = (list.size, list.get) else { return };
        for i in 0..size(events) {
            let header: *const clap_event_header = get(events, i);
            if header.is_null() || (*header).space_id != CLAP_CORE_EVENT_SPACE_ID || (*header).type_ != CLAP_EVENT_PARAM_VALUE {
                continue;
            }
            let event = &*(header as *const clap_event_param_value);
            self.set(event.param_id as usize, event.value);
        }
    }
}

/// Flush-to-zero (and, on x86, denormals-are-zero) for the length of a block, the host's own mode restored when it
/// drops: a decaying filter or envelope otherwise reaches subnormal floats, slow on most processors (clap-validator
/// found one at 6.9e-39 in De-noise's output).
struct NoDenormals(u64);

impl NoDenormals {
    #[inline]
    #[allow(deprecated)]
    fn on() -> NoDenormals {
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let old = std::arch::x86_64::_mm_getcsr();
            std::arch::x86_64::_mm_setcsr(old | 0x8040);
            NoDenormals(old as u64)
        }
        #[cfg(target_arch = "aarch64")]
        unsafe {
            let old: u64;
            std::arch::asm!("mrs {}, fpcr", out(reg) old);
            std::arch::asm!("msr fpcr, {}", in(reg) old | (1 << 24));
            NoDenormals(old)
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        NoDenormals(0)
    }
}

impl Drop for NoDenormals {
    #[inline]
    #[allow(deprecated)]
    fn drop(&mut self) {
        #[cfg(target_arch = "x86_64")]
        unsafe {
            std::arch::x86_64::_mm_setcsr(self.0 as u32)
        };
        #[cfg(target_arch = "aarch64")]
        unsafe {
            std::arch::asm!("msr fpcr, {}", in(reg) self.0)
        };
    }
}

unsafe fn instance<'a>(plugin: *const clap_plugin) -> &'a Instance {
    &*((*plugin).plugin_data as *const Instance)
}

unsafe extern "C" fn plugin_init(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_destroy(plugin: *const clap_plugin) {
    drop(Box::from_raw((*plugin).plugin_data as *mut Instance));
}

unsafe extern "C" fn plugin_activate(plugin: *const clap_plugin, rate: f64, _min: u32, _max: u32) -> bool {
    let inst = instance(plugin);
    if !(rate > 0.0) {
        return false;
    }
    *inst.rate.get() = rate;
    inst.build();
    true
}

unsafe extern "C" fn plugin_deactivate(plugin: *const clap_plugin) {
    *instance(plugin).dsp.get() = Dsp::Bypass;
}

unsafe extern "C" fn plugin_start(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_stop(_plugin: *const clap_plugin) {}

unsafe extern "C" fn plugin_reset(plugin: *const clap_plugin) {
    let inst = instance(plugin);
    if *inst.rate.get() > 0.0 {
        inst.build();
    }
}

unsafe extern "C" fn plugin_process(plugin: *const clap_plugin, process: *const clap_process) -> clap_process_status {
    let inst = instance(plugin);
    let p = &*process;
    inst.read_events(p.in_events);
    inst.apply();
    if p.audio_inputs_count < 1 || p.audio_outputs_count < 1 || p.audio_inputs.is_null() || p.audio_outputs.is_null() {
        return CLAP_PROCESS_ERROR;
    }
    let (input, output) = (&*p.audio_inputs, &*p.audio_outputs);
    if input.data32.is_null() || output.data32.is_null() || input.channel_count < 1 || output.channel_count < 1 {
        return CLAP_PROCESS_ERROR;
    }
    let il = *input.data32;
    let ir = if input.channel_count > 1 { *input.data32.add(1) } else { il };
    let ol = *output.data32;
    let or = if output.channel_count > 1 { *output.data32.add(1) } else { ptr::null_mut() };
    let dsp = &mut *inst.dsp.get();
    let _ftz = NoDenormals::on();
    let flush = |v: f32| if v.abs() < 1e-30 { 0.0 } else { v };
    for i in 0..p.frames_count as usize {
        let (l, r) = dsp.process(*il.add(i), *ir.add(i)); // both read before either is written: in place is safe
        *ol.add(i) = flush(l);
        if !or.is_null() {
            *or.add(i) = flush(r);
        }
    }
    CLAP_PROCESS_CONTINUE
}

// audio ports: one stereo in, one stereo out, processable in place

unsafe extern "C" fn ports_count(_plugin: *const clap_plugin, _is_input: bool) -> u32 {
    1
}

unsafe extern "C" fn ports_get(_plugin: *const clap_plugin, index: u32, _is_input: bool, info: *mut clap_audio_port_info) -> bool {
    if index != 0 || info.is_null() {
        return false;
    }
    let info = &mut *info;
    info.id = 0;
    write_c(&mut info.name, "main");
    info.flags = CLAP_AUDIO_PORT_IS_MAIN;
    info.channel_count = 2;
    info.port_type = CLAP_PORT_STEREO.as_ptr();
    info.in_place_pair = 0;
    true
}

static AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports { count: Some(ports_count), get: Some(ports_get) };

// parameters

fn write_c(slot: &mut [c_char], text: &str) {
    let n = text.len().min(slot.len().saturating_sub(1));
    for (s, b) in slot.iter_mut().zip(text.as_bytes()[..n].iter()) {
        *s = *b as c_char;
    }
    if let Some(end) = slot.get_mut(n) {
        *end = 0;
    }
}

unsafe extern "C" fn params_count(plugin: *const clap_plugin) -> u32 {
    instance(plugin).kind.params().len() as u32
}

unsafe extern "C" fn params_info(plugin: *const clap_plugin, index: u32, info: *mut clap_param_info) -> bool {
    let Some(p) = instance(plugin).kind.params().get(index as usize) else { return false };
    if info.is_null() {
        return false;
    }
    let info = &mut *info;
    info.id = index as clap_id;
    info.flags = CLAP_PARAM_IS_AUTOMATABLE | if p.stepped { CLAP_PARAM_IS_STEPPED } else { 0 };
    info.cookie = ptr::null_mut();
    write_c(&mut info.name, p.name);
    write_c(&mut info.module, "");
    info.min_value = p.min;
    info.max_value = p.max;
    info.default_value = p.default;
    true
}

unsafe extern "C" fn params_value(plugin: *const clap_plugin, id: clap_id, out: *mut f64) -> bool {
    let inst = instance(plugin);
    if (id as usize) >= inst.kind.params().len() || out.is_null() {
        return false;
    }
    *out = inst.value(id as usize);
    true
}

unsafe extern "C" fn params_to_text(plugin: *const clap_plugin, id: clap_id, value: f64, out: *mut c_char, size: u32) -> bool {
    let Some(p) = instance(plugin).kind.params().get(id as usize) else { return false };
    if out.is_null() || size == 0 {
        return false;
    }
    let text = match (p.stepped, p.unit) {
        (true, _) => format!("{}", value.round() as i64),
        (false, "") => format!("{value:.2}"),
        (false, unit) => format!("{value:.2} {unit}"),
    };
    write_c(std::slice::from_raw_parts_mut(out, size as usize), &text);
    true
}

unsafe extern "C" fn params_from_text(plugin: *const clap_plugin, id: clap_id, text: *const c_char, out: *mut f64) -> bool {
    let Some(p) = instance(plugin).kind.params().get(id as usize) else { return false };
    if text.is_null() || out.is_null() {
        return false;
    }
    let Ok(text) = CStr::from_ptr(text).to_str() else { return false };
    let number = text.trim().split_whitespace().next().unwrap_or("");
    match number.parse::<f64>() {
        Ok(v) if v.is_finite() => {
            *out = v.clamp(p.min, p.max);
            true
        }
        _ => false,
    }
}

unsafe extern "C" fn params_flush(plugin: *const clap_plugin, input: *const clap_input_events, _output: *const clap_output_events) {
    instance(plugin).read_events(input);
}

static PARAMS: clap_plugin_params = clap_plugin_params {
    count: Some(params_count),
    get_info: Some(params_info),
    get_value: Some(params_value),
    value_to_text: Some(params_to_text),
    text_to_value: Some(params_from_text),
    flush: Some(params_flush),
};

// state: "FWCL", a version, the plugin's tag, the count, then each value as a little-endian f64

const STATE_MAGIC: &[u8; 4] = b"FWCL";

unsafe extern "C" fn state_save(plugin: *const clap_plugin, stream: *const clap_ostream) -> bool {
    let inst = instance(plugin);
    let Some(write) = (if stream.is_null() { None } else { (*stream).write }) else { return false };
    let values = inst.values();
    let mut bytes = STATE_MAGIC.to_vec();
    bytes.extend_from_slice(&[1, inst.kind.tag(), values.len() as u8]);
    for v in values {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    let mut at = 0usize;
    while at < bytes.len() {
        let n = write(stream, bytes[at..].as_ptr() as *const c_void, (bytes.len() - at) as u64);
        if n <= 0 {
            return false;
        }
        at += n as usize;
    }
    true
}

unsafe extern "C" fn state_load(plugin: *const clap_plugin, stream: *const clap_istream) -> bool {
    let inst = instance(plugin);
    let Some(read) = (if stream.is_null() { None } else { (*stream).read }) else { return false };
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 256];
    loop {
        let n = read(stream, chunk.as_mut_ptr() as *mut c_void, chunk.len() as u64);
        if n < 0 {
            return false;
        }
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n as usize]);
        if bytes.len() > 4096 {
            return false;
        }
    }
    if bytes.len() < 7 || &bytes[..4] != STATE_MAGIC || bytes[4] != 1 || bytes[5] != inst.kind.tag() {
        return false;
    }
    let count = bytes[6] as usize;
    if count != inst.kind.params().len() || bytes.len() != 7 + 8 * count {
        return false;
    }
    for i in 0..count {
        let mut v = [0u8; 8];
        v.copy_from_slice(&bytes[7 + 8 * i..15 + 8 * i]);
        inst.set(i, f64::from_le_bytes(v));
    }
    // the values changed under the host: it must be told to read them again (clap-validator's state tests caught the
    // silent change, a host's knobs showing the old values)
    if !inst.host.is_null() {
        if let Some(get) = (*inst.host).get_extension {
            let ext = get(inst.host, CLAP_EXT_PARAMS.as_ptr()) as *const clap_host_params;
            if let Some(rescan) = if ext.is_null() { None } else { (*ext).rescan } {
                rescan(inst.host, CLAP_PARAM_RESCAN_VALUES);
            }
        }
    }
    true
}

static STATE: clap_plugin_state = clap_plugin_state { save: Some(state_save), load: Some(state_load) };

unsafe extern "C" fn plugin_extension(_plugin: *const clap_plugin, id: *const c_char) -> *const c_void {
    if id.is_null() {
        return ptr::null();
    }
    let id = CStr::from_ptr(id);
    if id == CLAP_EXT_AUDIO_PORTS {
        &AUDIO_PORTS as *const clap_plugin_audio_ports as *const c_void
    } else if id == CLAP_EXT_PARAMS {
        &PARAMS as *const clap_plugin_params as *const c_void
    } else if id == CLAP_EXT_STATE {
        &STATE as *const clap_plugin_state as *const c_void
    } else {
        ptr::null()
    }
}

unsafe extern "C" fn plugin_on_main_thread(_plugin: *const clap_plugin) {}

// the factory: both plugins

unsafe extern "C" fn factory_count(_factory: *const clap_plugin_factory) -> u32 {
    2
}

unsafe extern "C" fn factory_descriptor(_factory: *const clap_plugin_factory, index: u32) -> *const clap_plugin_descriptor {
    DESCRIPTORS.0.get(index as usize).map_or(ptr::null(), |d| d as *const clap_plugin_descriptor)
}

unsafe extern "C" fn factory_create(_factory: *const clap_plugin_factory, host: *const clap_host, id: *const c_char) -> *const clap_plugin {
    if id.is_null() {
        return ptr::null();
    }
    let id = CStr::from_ptr(id);
    let Some(index) = DESCRIPTORS.0.iter().position(|d| CStr::from_ptr(d.id) == id) else { return ptr::null() };
    let kind = if index == 0 { Kind::Denoise } else { Kind::Dehum };
    let values: [AtomicU64; MAX_PARAMS] = std::array::from_fn(|i| AtomicU64::new(kind.params().get(i).map_or(0.0, |p| p.default).to_bits()));
    let inst = Box::into_raw(Box::new(Instance {
        plugin: clap_plugin {
            desc: &DESCRIPTORS.0[index],
            plugin_data: ptr::null_mut(),
            init: Some(plugin_init),
            destroy: Some(plugin_destroy),
            activate: Some(plugin_activate),
            deactivate: Some(plugin_deactivate),
            start_processing: Some(plugin_start),
            stop_processing: Some(plugin_stop),
            reset: Some(plugin_reset),
            process: Some(plugin_process),
            get_extension: Some(plugin_extension),
            on_main_thread: Some(plugin_on_main_thread),
        },
        host,
        kind,
        values,
        dirty: AtomicBool::new(false),
        rate: UnsafeCell::new(0.0),
        dsp: UnsafeCell::new(Dsp::Bypass),
    }));
    (*inst).plugin.plugin_data = inst as *mut c_void;
    &(*inst).plugin
}

static FACTORY: clap_plugin_factory = clap_plugin_factory {
    get_plugin_count: Some(factory_count),
    get_plugin_descriptor: Some(factory_descriptor),
    create_plugin: Some(factory_create),
};

unsafe extern "C" fn entry_init(_path: *const c_char) -> bool {
    true
}

unsafe extern "C" fn entry_deinit() {}

unsafe extern "C" fn entry_factory(id: *const c_char) -> *const c_void {
    if !id.is_null() && CStr::from_ptr(id) == CLAP_PLUGIN_FACTORY_ID {
        &FACTORY as *const clap_plugin_factory as *const c_void
    } else {
        ptr::null()
    }
}

#[no_mangle]
#[allow(non_upper_case_globals)]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry { clap_version: CLAP_VERSION, init: Some(entry_init), deinit: Some(entry_deinit), get_factory: Some(entry_factory) };
