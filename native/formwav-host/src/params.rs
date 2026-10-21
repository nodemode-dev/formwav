//! A plugin's parameters, for formwav's generated controls (AU-29: controls for a plugin with no interface of its
//! own), and the values chosen in them carried into offline processing: CLAP as param-value events and VST3 as
//! parameter changes, both at the first sample of the first block. Hidden, read-only and VST3 bypass parameters are
//! left out. VST3 values are normalized (0 to 1), as VST3 defines them; CLAP values are the plugin's own range.

use std::cell::Cell;
use std::ffi::{c_void, CStr};
use std::path::Path;
use std::ptr;

use clap_sys::events::{clap_event_header, clap_event_param_value, clap_input_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE};
use clap_sys::ext::params::{clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::version::CLAP_VERSION;
use vst3::Steinberg::Vst::{IComponent, IComponentTrait, IConnectionPoint, IConnectionPointTrait, IEditController, IEditControllerTrait, IHostApplication, IParamValueQueue, IParamValueQueueTrait, IParameterChanges, IParameterChangesTrait, ParameterInfo};
use vst3::Steinberg::{kResultFalse, kResultOk, tresult, FUnknown, IPluginBaseTrait, IPluginFactoryTrait, TUID};
use vst3::{Class, ComPtr, ComWrapper, Interface};

// VST3 ParameterInfo flags (ivsteditcontroller.h): read-only, hidden, bypass.
const VST3_READ_ONLY: i32 = 2;
const VST3_HIDDEN: i32 = 16;
const VST3_BYPASS: i32 = 65536;

pub struct Param {
    pub id: u32,
    pub name: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub steps: i32,
}

fn json(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn to_json(params: &[Param]) -> String {
    let rows: Vec<String> = params
        .iter()
        .map(|p| format!("{{\"id\": {}, \"name\": \"{}\", \"min\": {}, \"max\": {}, \"default\": {}, \"steps\": {}}}", p.id, json(&p.name), p.min, p.max, p.default, p.steps))
        .collect();
    format!("[{}]", rows.join(",\n "))
}

/// `{"<id>": value, ...}` as given to `fwhost process`: a flat object of numbers, nothing nested.
pub fn parse_values(text: &str) -> Result<Vec<(u32, f64)>, String> {
    let body = text.trim().trim_start_matches('{').trim_end_matches('}');
    let mut out = Vec::new();
    for pair in body.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once(':').ok_or_else(|| format!("not a parameter value: {pair}"))?;
        let id = k.trim().trim_matches('"').parse::<u32>().map_err(|_| format!("not a parameter id: {k}"))?;
        let value = v.trim().parse::<f64>().map_err(|_| format!("not a number: {v}"))?;
        out.push((id, value));
    }
    Ok(out)
}

pub fn list(format: &str, path: &Path) -> Result<Vec<Param>, String> {
    unsafe {
        match format {
            "clap" => clap_list(path),
            "vst3" => vst3_list(path),
            "ladspa" => crate::ladspa::params(path),
            "au" => crate::au::params(&path.to_string_lossy()),
            other => Err(format!("unknown plugin format {other}")),
        }
    }
}

unsafe fn clap_list(path: &Path) -> Result<Vec<Param>, String> {
    let (lib, entry) = crate::offline::clap_open(path)?;
    let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
    let desc = if factory.is_null() { ptr::null() } else { ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, 0) };
    if desc.is_null() {
        return Err("the file holds no plugin".into());
    }
    let host = Box::new(clap_host {
        clap_version: CLAP_VERSION,
        host_data: ptr::null_mut(),
        name: c"formwav".as_ptr(),
        vendor: c"nodemode-ai".as_ptr(),
        url: c"https://github.com/nodemode-ai/formwav".as_ptr(),
        version: c"1".as_ptr(),
        get_extension: Some(crate::host_get_extension),
        request_restart: Some(crate::host_request),
        request_process: Some(crate::host_request),
        request_callback: Some(crate::host_request),
    });
    let plugin = ((*factory).create_plugin.ok_or("no create")?)(factory, &*host, (*desc).id);
    if plugin.is_null() || !((*plugin).init.ok_or("no init")?)(plugin) {
        return Err("the plugin would not initialise".into());
    }
    let mut params = Vec::new();
    let ext = ((*plugin).get_extension.ok_or("no get_extension")?)(plugin, CLAP_EXT_PARAMS.as_ptr()) as *const clap_plugin_params;
    if let Some(ext) = ext.as_ref() {
        let (count, get_info) = (ext.count.ok_or("params without count")?, ext.get_info.ok_or("params without get_info")?);
        for index in 0..count(plugin) {
            let mut info: clap_param_info = std::mem::zeroed();
            if get_info(plugin, index, &mut info) && info.flags & (CLAP_PARAM_IS_HIDDEN | CLAP_PARAM_IS_READONLY) == 0 {
                params.push(Param {
                    id: info.id,
                    name: CStr::from_ptr(info.name.as_ptr()).to_string_lossy().into_owned(),
                    min: info.min_value,
                    max: info.max_value,
                    default: info.default_value,
                    steps: if info.flags & clap_sys::ext::params::CLAP_PARAM_IS_STEPPED != 0 { (info.max_value - info.min_value).round() as i32 } else { 0 },
                });
            }
        }
    }
    ((*plugin).destroy.ok_or("no destroy")?)(plugin);
    ((*entry).deinit.ok_or("no deinit")?)();
    drop(lib);
    Ok(params)
}

unsafe fn vst3_list(path: &Path) -> Result<Vec<Param>, String> {
    let (lib, factory) = crate::offline::vst3_open(path)?;
    let (cid, _) = crate::offline::vst3_effects(&factory).into_iter().next().ok_or("the module holds no audio effect")?;
    let mut obj: *mut c_void = ptr::null_mut();
    if factory.createInstance(cid.as_ptr(), IComponent::IID.as_ptr() as *const std::ffi::c_char, &mut obj) != kResultOk {
        return Err("the factory would not create the component".into());
    }
    let component = ComPtr::from_raw(obj as *mut IComponent).ok_or("no component")?;
    let host = ComWrapper::new(crate::HostApplication);
    let context = host.to_com_ptr::<IHostApplication>().ok_or("host context")?;
    component.initialize(context.as_ptr() as *mut FUnknown);
    let (controller, separate) = match component.cast::<IEditController>() {
        Some(c) => (c, false),
        None => {
            let mut controller_cid: TUID = [0; 16];
            if component.getControllerClassId(&mut controller_cid) != kResultOk {
                return Err("the component names no edit controller".into());
            }
            let mut obj: *mut c_void = ptr::null_mut();
            factory.createInstance(controller_cid.as_ptr(), IEditController::IID.as_ptr() as *const std::ffi::c_char, &mut obj);
            let c = ComPtr::from_raw(obj as *mut IEditController).ok_or("the factory would not create the edit controller")?;
            c.initialize(context.as_ptr() as *mut FUnknown);
            (c, true)
        }
    };
    // A separate controller (JUCE's) learns its parameters from the component through the connection points.
    let points = (component.cast::<IConnectionPoint>(), controller.cast::<IConnectionPoint>());
    if let (Some(a), Some(b)) = (&points.0, &points.1) {
        a.connect(b.as_ptr());
        b.connect(a.as_ptr());
    }
    let mut params = Vec::new();
    for index in 0..controller.getParameterCount() {
        let mut info: ParameterInfo = std::mem::zeroed();
        if controller.getParameterInfo(index, &mut info) != kResultOk || info.flags & (VST3_READ_ONLY | VST3_HIDDEN | VST3_BYPASS) != 0 {
            continue;
        }
        let end = info.title.iter().position(|c| *c == 0).unwrap_or(info.title.len());
        params.push(Param { id: info.id, name: String::from_utf16_lossy(&info.title[..end]), min: 0.0, max: 1.0, default: info.defaultNormalizedValue, steps: info.stepCount });
    }
    if let (Some(a), Some(b)) = (&points.0, &points.1) {
        a.disconnect(b.as_ptr());
        b.disconnect(a.as_ptr());
    }
    drop(points);
    if separate {
        controller.terminate();
    }
    drop(controller);
    component.terminate();
    drop(component);
    drop(factory);
    crate::offline::vst3_close(lib);
    Ok(params)
}

/// CLAP: the chosen values as param-value events, delivered in the first block only, and S17's automation: timed
/// events offered in the block they fall in, each at its frame within that block.
pub struct ClapEvents {
    pub events: Vec<clap_event_param_value>,
    pub live: Cell<bool>,
    timed: std::cell::UnsafeCell<Vec<clap_event_param_value>>,
    timed_at: Vec<u64>,
    window: Cell<(usize, usize)>,
}

fn param_event(time: u32, id: u32, value: f64) -> clap_event_param_value {
    clap_event_param_value {
        header: clap_event_header { size: std::mem::size_of::<clap_event_param_value>() as u32, time, space_id: CLAP_CORE_EVENT_SPACE_ID, type_: CLAP_EVENT_PARAM_VALUE, flags: 0 },
        param_id: id,
        cookie: ptr::null_mut(),
        note_id: -1,
        port_index: -1,
        channel: -1,
        key: -1,
        value,
    }
}

/// S17: a CLAP state stream read from saved bytes, and one written into a Vec.
pub struct StateReader<'a> {
    pub bytes: &'a [u8],
    pub at: usize,
}

pub unsafe extern "C" fn state_read(stream: *const clap_sys::stream::clap_istream, buffer: *mut std::ffi::c_void, size: u64) -> i64 {
    let reader = &mut *((*stream).ctx as *mut StateReader);
    let n = (size as usize).min(reader.bytes.len() - reader.at);
    std::ptr::copy_nonoverlapping(reader.bytes.as_ptr().add(reader.at), buffer as *mut u8, n);
    reader.at += n;
    n as i64
}

pub unsafe extern "C" fn state_write(stream: *const clap_sys::stream::clap_ostream, buffer: *const std::ffi::c_void, size: u64) -> i64 {
    let out = &mut *((*stream).ctx as *mut Vec<u8>);
    out.extend_from_slice(std::slice::from_raw_parts(buffer as *const u8, size as usize));
    size as i64
}

/// S17: automation as given to `fwhost process` (`frame id value` lines, breakpoints in input frames), each parameter's
/// line between its breakpoints sampled every AUTOMATION_STEP frames as CLAP events, held after the last.
pub const AUTOMATION_STEP: u64 = 32;

pub fn parse_automation(text: &str) -> Result<Vec<(u64, u32, f64)>, String> {
    let mut points: Vec<(u32, u64, f64)> = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let mut it = line.split_whitespace();
        let (Some(f), Some(i), Some(v)) = (it.next(), it.next(), it.next()) else { return Err(format!("not an automation point: {line}")) };
        let frame = f.parse::<u64>().map_err(|_| format!("not a frame: {f}"))?;
        let id = i.parse::<u32>().map_err(|_| format!("not a parameter id: {i}"))?;
        let value = v.parse::<f64>().map_err(|_| format!("not a number: {v}"))?;
        points.push((id, frame, value));
    }
    points.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
    let mut out = Vec::new();
    for (k, &(id, frame, value)) in points.iter().enumerate() {
        out.push((frame, id, value));
        if let Some(&(next_id, next_frame, next_value)) = points.get(k + 1) {
            if next_id == id && next_frame > frame {
                let mut t = (frame / AUTOMATION_STEP + 1) * AUTOMATION_STEP;
                while t < next_frame {
                    let p = (t - frame) as f64 / (next_frame - frame) as f64;
                    out.push((t, id, value + (next_value - value) * p));
                    t += AUTOMATION_STEP;
                }
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    Ok(out)
}

impl ClapEvents {
    pub fn new(values: &[(u32, f64)]) -> Self {
        let events = values.iter().map(|(id, value)| param_event(0, *id, *value)).collect();
        ClapEvents { events, live: Cell::new(true), timed: std::cell::UnsafeCell::new(Vec::new()), timed_at: Vec::new(), window: Cell::new((0, 0)) }
    }

    /// The automation's events (frame, id, value; sorted by frame), offered block by block through `block`.
    pub fn with_automation(mut self, points: &[(u64, u32, f64)]) -> Self {
        self.timed_at = points.iter().map(|p| p.0).collect();
        self.timed = std::cell::UnsafeCell::new(points.iter().map(|&(_, id, value)| param_event(0, id, value)).collect());
        self
    }

    /// Chooses the automation events inside frames `pos` to `pos + n` for the next process call, timed within it.
    pub fn block(&self, pos: u64, n: u64) {
        let start = self.timed_at.partition_point(|&t| t < pos);
        let end = self.timed_at.partition_point(|&t| t < pos + n);
        // SAFETY: the host calls size and get only during process, after this, on the same thread
        let timed = unsafe { &mut *self.timed.get() };
        for k in start..end {
            timed[k].header.time = (self.timed_at[k] - pos) as u32;
        }
        self.window.set((start, end));
    }
}

pub unsafe extern "C" fn clap_events_size(list: *const clap_input_events) -> u32 {
    let events = &*((*list).ctx as *const ClapEvents);
    let (start, end) = events.window.get();
    (if events.live.get() { events.events.len() } else { 0 } + (end - start)) as u32
}

pub unsafe extern "C" fn clap_events_get(list: *const clap_input_events, index: u32) -> *const clap_event_header {
    let events = &*((*list).ctx as *const ClapEvents);
    let first = if events.live.get() { events.events.len() } else { 0 };
    let index = index as usize;
    if index < first {
        return events.events.get(index).map_or(ptr::null(), |e| &e.header as *const clap_event_header);
    }
    let (start, end) = events.window.get();
    let k = start + (index - first);
    if k >= end {
        return ptr::null();
    }
    let timed = &*events.timed.get();
    timed.get(k).map_or(ptr::null(), |e| &e.header as *const clap_event_header)
}

/// VST3: one queue per chosen value, each a single point at sample 0, offered in the first block only.
pub struct Vst3Queue {
    id: u32,
    value: f64,
}

impl Class for Vst3Queue {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for Vst3Queue {
    unsafe fn getParameterId(&self) -> u32 {
        self.id
    }

    unsafe fn getPointCount(&self) -> i32 {
        1
    }

    unsafe fn getPoint(&self, index: i32, sample_offset: *mut i32, value: *mut f64) -> tresult {
        if index != 0 {
            return kResultFalse;
        }
        *sample_offset = 0;
        *value = self.value;
        kResultOk
    }

    unsafe fn addPoint(&self, _sample_offset: i32, _value: f64, _index: *mut i32) -> tresult {
        kResultFalse
    }
}

/// S17, VST3 state: an in-memory IBStream, written by getState and read by setState.
pub struct MemStream {
    pub bytes: std::cell::RefCell<Vec<u8>>,
    at: Cell<usize>,
}

impl MemStream {
    pub fn new(bytes: Vec<u8>) -> Self {
        MemStream { bytes: std::cell::RefCell::new(bytes), at: Cell::new(0) }
    }
}

impl Class for MemStream {
    type Interfaces = (vst3::Steinberg::IBStream,);
}

impl vst3::Steinberg::IBStreamTrait for MemStream {
    unsafe fn read(&self, buffer: *mut c_void, num: i32, read: *mut i32) -> tresult {
        let bytes = self.bytes.borrow();
        let at = self.at.get();
        let n = (num.max(0) as usize).min(bytes.len().saturating_sub(at));
        ptr::copy_nonoverlapping(bytes.as_ptr().add(at), buffer as *mut u8, n);
        self.at.set(at + n);
        if !read.is_null() {
            *read = n as i32;
        }
        kResultOk
    }

    unsafe fn write(&self, buffer: *mut c_void, num: i32, written: *mut i32) -> tresult {
        let mut bytes = self.bytes.borrow_mut();
        let at = self.at.get();
        let n = num.max(0) as usize;
        if bytes.len() < at + n {
            bytes.resize(at + n, 0);
        }
        ptr::copy_nonoverlapping(buffer as *const u8, bytes.as_mut_ptr().add(at), n);
        self.at.set(at + n);
        if !written.is_null() {
            *written = n as i32;
        }
        kResultOk
    }

    unsafe fn seek(&self, pos: i64, mode: i32, result: *mut i64) -> tresult {
        let len = self.bytes.borrow().len() as i64;
        let base = match mode {
            1 => self.at.get() as i64,
            2 => len,
            _ => 0,
        };
        let to = (base + pos).clamp(0, len);
        self.at.set(to as usize);
        if !result.is_null() {
            *result = to;
        }
        kResultOk
    }

    unsafe fn tell(&self, pos: *mut i64) -> tresult {
        if !pos.is_null() {
            *pos = self.at.get() as i64;
        }
        kResultOk
    }
}

/// S17, VST3 automation: one parameter's points, offered block by block as the points inside the block, each at its
/// sample offset within it.
pub struct Vst3Timed {
    id: u32,
    at: Vec<u64>,
    values: Vec<f64>,
    window: Cell<(usize, usize)>,
    pos: Cell<u64>,
}

impl Class for Vst3Timed {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for Vst3Timed {
    unsafe fn getParameterId(&self) -> u32 {
        self.id
    }

    unsafe fn getPointCount(&self) -> i32 {
        let (start, end) = self.window.get();
        (end - start) as i32
    }

    unsafe fn getPoint(&self, index: i32, sample_offset: *mut i32, value: *mut f64) -> tresult {
        let (start, end) = self.window.get();
        let k = start + index.max(0) as usize;
        if index < 0 || k >= end {
            return kResultFalse;
        }
        *sample_offset = (self.at[k] - self.pos.get()) as i32;
        *value = self.values[k];
        kResultOk
    }

    unsafe fn addPoint(&self, _sample_offset: i32, _value: f64, _index: *mut i32) -> tresult {
        kResultFalse
    }
}

pub struct Vst3Changes {
    queues: Vec<ComPtr<IParamValueQueue>>,
    pub live: Cell<bool>,
    timed: Vec<(ComWrapper<Vst3Timed>, ComPtr<IParamValueQueue>)>,
    active: std::cell::RefCell<Vec<usize>>,
}

impl Vst3Changes {
    pub fn new(values: &[(u32, f64)]) -> Self {
        let queues = values.iter().filter_map(|(id, value)| ComWrapper::new(Vst3Queue { id: *id, value: *value }).to_com_ptr::<IParamValueQueue>()).collect();
        Vst3Changes { queues, live: Cell::new(true), timed: Vec::new(), active: std::cell::RefCell::new(Vec::new()) }
    }

    /// The automation (frame, id, value; sorted by frame) as one timed queue per parameter.
    pub fn with_automation(mut self, points: &[(u64, u32, f64)]) -> Self {
        let mut ids: Vec<u32> = points.iter().map(|p| p.1).collect();
        ids.sort_unstable();
        ids.dedup();
        for id in ids {
            let mine: Vec<&(u64, u32, f64)> = points.iter().filter(|p| p.1 == id).collect();
            let queue = ComWrapper::new(Vst3Timed { id, at: mine.iter().map(|p| p.0).collect(), values: mine.iter().map(|p| p.2).collect(), window: Cell::new((0, 0)), pos: Cell::new(0) });
            if let Some(ptr) = queue.to_com_ptr::<IParamValueQueue>() {
                self.timed.push((queue, ptr));
            }
        }
        self
    }

    /// Chooses each parameter's points inside frames `pos` to `pos + n` for the next process call.
    pub fn block(&self, pos: u64, n: u64) {
        let mut active = self.active.borrow_mut();
        active.clear();
        for (k, (queue, _)) in self.timed.iter().enumerate() {
            let start = queue.at.partition_point(|&t| t < pos);
            let end = queue.at.partition_point(|&t| t < pos + n);
            queue.window.set((start, end));
            queue.pos.set(pos);
            if end > start {
                active.push(k);
            }
        }
    }

    /// Whether this block has any change to offer.
    pub fn any(&self) -> bool {
        (self.live.get() && !self.queues.is_empty()) || !self.active.borrow().is_empty()
    }
}

impl Class for Vst3Changes {
    type Interfaces = (IParameterChanges,);
}

impl IParameterChangesTrait for Vst3Changes {
    unsafe fn getParameterCount(&self) -> i32 {
        (if self.live.get() { self.queues.len() } else { 0 } + self.active.borrow().len()) as i32
    }

    unsafe fn getParameterData(&self, index: i32) -> *mut IParamValueQueue {
        let first = if self.live.get() { self.queues.len() } else { 0 };
        let index = index.max(0) as usize;
        if index < first {
            return self.queues.get(index).map_or(ptr::null_mut(), |q| q.as_ptr());
        }
        let active = self.active.borrow();
        active.get(index - first).and_then(|&k| self.timed.get(k)).map_or(ptr::null_mut(), |(_, p)| p.as_ptr())
    }

    unsafe fn addParameterData(&self, _id: *const u32, _index: *mut i32) -> *mut IParamValueQueue {
        ptr::null_mut()
    }
}
