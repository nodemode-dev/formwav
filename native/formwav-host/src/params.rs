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

/// CLAP: the chosen values as param-value events, delivered in the first block only.
pub struct ClapEvents {
    pub events: Vec<clap_event_param_value>,
    pub live: Cell<bool>,
}

impl ClapEvents {
    pub fn new(values: &[(u32, f64)]) -> Self {
        let events = values
            .iter()
            .map(|(id, value)| clap_event_param_value {
                header: clap_event_header { size: std::mem::size_of::<clap_event_param_value>() as u32, time: 0, space_id: CLAP_CORE_EVENT_SPACE_ID, type_: CLAP_EVENT_PARAM_VALUE, flags: 0 },
                param_id: *id,
                cookie: ptr::null_mut(),
                note_id: -1,
                port_index: -1,
                channel: -1,
                key: -1,
                value: *value,
            })
            .collect();
        ClapEvents { events, live: Cell::new(true) }
    }
}

pub unsafe extern "C" fn clap_events_size(list: *const clap_input_events) -> u32 {
    let events = &*((*list).ctx as *const ClapEvents);
    if events.live.get() { events.events.len() as u32 } else { 0 }
}

pub unsafe extern "C" fn clap_events_get(list: *const clap_input_events, index: u32) -> *const clap_event_header {
    let events = &*((*list).ctx as *const ClapEvents);
    if !events.live.get() {
        return ptr::null();
    }
    events.events.get(index as usize).map_or(ptr::null(), |e| &e.header as *const clap_event_header)
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

pub struct Vst3Changes {
    queues: Vec<ComPtr<IParamValueQueue>>,
    pub live: Cell<bool>,
}

impl Vst3Changes {
    pub fn new(values: &[(u32, f64)]) -> Self {
        let queues = values.iter().filter_map(|(id, value)| ComWrapper::new(Vst3Queue { id: *id, value: *value }).to_com_ptr::<IParamValueQueue>()).collect();
        Vst3Changes { queues, live: Cell::new(true) }
    }
}

impl Class for Vst3Changes {
    type Interfaces = (IParameterChanges,);
}

impl IParameterChangesTrait for Vst3Changes {
    unsafe fn getParameterCount(&self) -> i32 {
        if self.live.get() { self.queues.len() as i32 } else { 0 }
    }

    unsafe fn getParameterData(&self, index: i32) -> *mut IParamValueQueue {
        if !self.live.get() {
            return ptr::null_mut();
        }
        self.queues.get(index as usize).map_or(ptr::null_mut(), |q| q.as_ptr())
    }

    unsafe fn addParameterData(&self, _id: *const u32, _index: *mut i32) -> *mut IParamValueQueue {
        ptr::null_mut()
    }
}
