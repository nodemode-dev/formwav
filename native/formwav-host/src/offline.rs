//! Offline plugin work for formwav's engine: find the plugins installed on this machine, and run a file through one
//! of them block by block, the way formwav applies any effect (a new file; the source is kept). The engine starts one
//! fwhost process per job, so a plugin that crashes ends that job, never formwav.

use std::ffi::{c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::ptr;

use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{clap_input_events, clap_output_events};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::process::{clap_process, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;
use vst3::Steinberg::Vst::{
    AudioBusBuffers, AudioBusBuffers__type0, BusDirections_, IAudioProcessor, IAudioProcessorTrait, IComponent, IComponentTrait, IHostApplication, MediaTypes_, ProcessData, ProcessModes_, ProcessSetup,
    SpeakerArr, SymbolicSampleSizes_,
};
use vst3::Steinberg::{kResultOk, FUnknown, IPluginBaseTrait, IPluginFactory, IPluginFactoryTrait, PClassInfo, TUID};
use vst3::{ComPtr, ComWrapper, Interface};

use crate::wav::Audio;

pub const BLOCK: usize = 512;

/// The standard plugin folders of this system, then FORMWAV_PLUGIN_PATH.
pub fn default_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let mut dirs = Vec::new();
    for kind in ["CLAP", "VST3", "LADSPA"] {
        if cfg!(target_os = "macos") {
            dirs.push(home.join("Library/Audio/Plug-Ins").join(kind));
            dirs.push(PathBuf::from("/Library/Audio/Plug-Ins").join(kind));
        } else if cfg!(windows) {
            for root in ["COMMONPROGRAMFILES", "LOCALAPPDATA"] {
                if let Some(base) = std::env::var_os(root) {
                    let base = PathBuf::from(base);
                    dirs.push(if root == "LOCALAPPDATA" { base.join("Programs").join("Common").join(kind) } else { base.join(kind) });
                }
            }
        } else {
            let lower = kind.to_lowercase();
            dirs.push(home.join(format!(".{lower}")));
            dirs.push(PathBuf::from("/usr/lib").join(&lower));
            dirs.push(PathBuf::from("/usr/local/lib").join(&lower));
        }
    }
    if let Some(extra) = std::env::var_os("FORMWAV_PLUGIN_PATH") {
        dirs.extend(std::env::split_paths(&extra));
    }
    if let Some(extra) = std::env::var_os("LADSPA_PATH") {
        dirs.extend(std::env::split_paths(&extra));
    }
    dirs
}

fn find(dir: &Path, found: &mut Vec<(&'static str, PathBuf)>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        match path.extension().and_then(|x| x.to_str()) {
            Some("clap") => found.push(("clap", path)),
            Some("vst3") => found.push(("vst3", path)),
            // LADSPA libraries only where a folder is named ladspa: loading a library runs its initialisers
            Some("so") if path.ancestors().skip(1).any(|a| a.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("ladspa"))) => found.push(("ladspa", path)),
            _ if path.is_dir() && depth < 3 => find(&path, found, depth + 1),
            _ => {}
        }
    }
}

fn json(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// A CLAP file, or the binary inside a CLAP bundle (macOS).
pub fn clap_binary(path: &Path) -> Result<PathBuf, String> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    let inner = path.join("Contents").join("MacOS");
    std::fs::read_dir(&inner).ok().and_then(|mut d| d.find_map(|e| e.ok().map(|e| e.path()))).ok_or_else(|| format!("{} has no binary", path.display()))
}

pub(crate) unsafe fn clap_open(path: &Path) -> Result<(libloading::Library, *const clap_plugin_entry), String> {
    let binary = clap_binary(path)?;
    let lib = libloading::Library::new(&binary).map_err(|e| format!("could not load {}: {e}", binary.display()))?;
    let entry = *lib.get::<*const clap_plugin_entry>(b"clap_entry\0").map_err(|e| format!("no clap_entry: {e}"))?;
    let c_path = CString::new(path.to_string_lossy().as_bytes()).unwrap();
    if !((*entry).init.ok_or("entry without init")?)(c_path.as_ptr()) {
        return Err("the plugin's entry refused to initialise".into());
    }
    Ok((lib, entry))
}

/// What keeps a loaded VST3 module alive: the loaded library on Linux and Windows, the CFBundle on macOS.
#[cfg(not(target_os = "macos"))]
pub(crate) type Vst3Module = Vst3Library;

/// A VST3 module's binary as loaded: dlopen'd on Unix, LoadLibrary'd on Windows.
#[cfg(unix)]
pub(crate) type Vst3Library = libloading::os::unix::Library;
#[cfg(windows)]
pub(crate) type Vst3Library = libloading::os::windows::Library;

/// Loads a VST3 module's binary and enters it as the VST3 SDK specifies for the platform: ModuleEntry with the
/// library's handle on Unix, InitDll on Windows (each optional: a module without it is entered by loading).
pub(crate) unsafe fn vst3_enter(binary: &Path) -> Result<Vst3Library, String> {
    #[cfg(unix)]
    {
        let lib = libloading::os::unix::Library::new(binary).map_err(|e| format!("could not load {}: {e}", binary.display()))?;
        let handle = lib.into_raw();
        let lib = libloading::os::unix::Library::from_raw(handle);
        if let Ok(entry) = lib.get::<unsafe extern "C" fn(*mut c_void) -> bool>(b"ModuleEntry\0") {
            if !entry(handle) {
                return Err("the module refused to enter".into());
            }
        }
        Ok(lib)
    }
    #[cfg(windows)]
    {
        let lib = libloading::os::windows::Library::new(binary).map_err(|e| format!("could not load {}: {e}", binary.display()))?;
        if let Ok(init) = lib.get::<unsafe extern "system" fn() -> bool>(b"InitDll\0") {
            if !init() {
                return Err("the module refused to initialise (InitDll)".into());
            }
        }
        Ok(lib)
    }
}

/// Leaves a VST3 module as the SDK specifies: ModuleExit on Unix, ExitDll on Windows.
pub(crate) unsafe fn vst3_leave(lib: &Vst3Library) {
    let name: &[u8] = if cfg!(windows) { b"ExitDll\0" } else { b"ModuleExit\0" };
    if let Ok(exit) = lib.get::<unsafe extern "C" fn() -> bool>(name) {
        exit();
    }
}
#[cfg(target_os = "macos")]
pub(crate) type Vst3Module = crate::mac::Bundle;

/// macOS: the module is a bundle; `bundleEntry` gets the bundle before the factory is taken (the VST3 SDK's way).
#[cfg(target_os = "macos")]
pub(crate) unsafe fn vst3_open(path: &Path) -> Result<(Vst3Module, ComPtr<IPluginFactory>), String> {
    let bundle = crate::mac::Bundle::open(path)?;
    let entry = bundle.symbol("bundleEntry");
    if !entry.is_null() {
        let entry: unsafe extern "C" fn(*mut c_void) -> bool = std::mem::transmute(entry);
        if !entry(bundle.as_ptr()) {
            return Err("the module refused to enter".into());
        }
    }
    let get_factory = bundle.symbol("GetPluginFactory");
    if get_factory.is_null() {
        return Err("no GetPluginFactory".into());
    }
    let get_factory: unsafe extern "C" fn() -> *mut IPluginFactory = std::mem::transmute(get_factory);
    let factory = ComPtr::from_raw(get_factory()).ok_or("GetPluginFactory returned nothing")?;
    Ok((bundle, factory))
}

#[cfg(target_os = "macos")]
pub(crate) unsafe fn vst3_close(bundle: Vst3Module) {
    let exit = bundle.symbol("bundleExit");
    if !exit.is_null() {
        let exit: unsafe extern "C" fn() -> bool = std::mem::transmute(exit);
        exit();
    }
    drop(bundle);
}

#[cfg(not(target_os = "macos"))]
pub(crate) unsafe fn vst3_open(path: &Path) -> Result<(Vst3Module, ComPtr<IPluginFactory>), String> {
    let binary = crate::vst3_binary(&path.to_string_lossy())?;
    let lib = vst3_enter(&binary)?;
    let get_factory = lib.get::<unsafe extern "C" fn() -> *mut IPluginFactory>(b"GetPluginFactory\0").map_err(|e| format!("no GetPluginFactory: {e}"))?;
    let factory = ComPtr::from_raw(get_factory()).ok_or("GetPluginFactory returned nothing")?;
    Ok((lib, factory))
}

#[cfg(not(target_os = "macos"))]
pub(crate) unsafe fn vst3_close(lib: Vst3Module) {
    vst3_leave(&lib);
}

pub(crate) unsafe fn vst3_effects(factory: &ComPtr<IPluginFactory>) -> Vec<(TUID, String)> {
    let mut effects = Vec::new();
    for index in 0..factory.countClasses() {
        let mut info: PClassInfo = std::mem::zeroed();
        if factory.getClassInfo(index, &mut info) == kResultOk && CStr::from_ptr(info.category.as_ptr()).to_bytes() == b"Audio Module Class" {
            effects.push((info.cid, CStr::from_ptr(info.name.as_ptr()).to_string_lossy().into_owned()));
        }
    }
    effects
}

/// Every plugin found under `dirs`, one JSON object each: format, path, id and name, or the reason it could not be read.
pub fn scan(dirs: &[PathBuf]) -> Vec<String> {
    let mut found = Vec::new();
    for dir in dirs {
        find(dir, &mut found, 0);
    }
    let mut out = Vec::new();
    for (format, path) in found {
        let p = json(&path.to_string_lossy());
        if format == "ladspa" {
            // AU-41: a library holds many plugins, each listed and addressed as <library>#<index>
            match crate::ladspa::describe(&path) {
                Ok(list) => out.extend(list.into_iter().map(|(i, label, name)| format!("{{\"format\": \"ladspa\", \"path\": \"{p}#{i}\", \"id\": \"{}\", \"name\": \"{}\"}}", json(&label), json(&name)))),
                Err(e) => out.push(format!("{{\"format\": \"ladspa\", \"path\": \"{p}\", \"error\": \"{}\"}}", json(&e))),
            }
            continue;
        }
        let described: Result<Vec<(String, String, bool)>, String> = unsafe {
            match format {
                "clap" => clap_open(&path).and_then(|(lib, entry)| {
                    let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
                    let mut list = Vec::new();
                    if !factory.is_null() {
                        for i in 0..((*factory).get_plugin_count.ok_or("no count")?)(factory) {
                            let d = ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, i);
                            if !d.is_null() {
                                // PT-15: an instrument says so among its features (a null-terminated list)
                                let mut instrument = false;
                                let mut f = (*d).features;
                                while !f.is_null() && !(*f).is_null() {
                                    instrument |= CStr::from_ptr(*f).to_bytes() == b"instrument";
                                    f = f.add(1);
                                }
                                list.push((CStr::from_ptr((*d).id).to_string_lossy().into_owned(), CStr::from_ptr((*d).name).to_string_lossy().into_owned(), instrument));
                            }
                        }
                    }
                    ((*entry).deinit.ok_or("no deinit")?)();
                    drop(lib);
                    Ok(list)
                }),
                _ => vst3_open(&path).map(|(lib, factory)| {
                    let list = vst3_effects(&factory).into_iter().map(|(cid, name)| (cid.iter().map(|b| format!("{:02X}", *b as u8)).collect(), name, false)).collect();
                    drop(factory);
                    vst3_close(lib);
                    list
                }),
            }
        };
        match described {
            Ok(list) => out.extend(list.into_iter().map(|(id, name, instrument)| format!("{{\"format\": \"{format}\", \"path\": \"{p}\", \"id\": \"{}\", \"name\": \"{}\"{}}}", json(&id), json(&name), if instrument { ", \"instrument\": true" } else { "" }))),
            Err(e) => out.push(format!("{{\"format\": \"{format}\", \"path\": \"{p}\", \"error\": \"{}\"}}", json(&e))),
        }
    }
    out.extend(crate::au::list().into_iter().map(|(id, name)| format!("{{\"format\": \"au\", \"path\": \"{}\", \"id\": \"{}\", \"name\": \"{}\"}}", json(&id), json(&id), json(&name))));
    out
}

/// Runs `input` (mono becomes both sides; beyond two channels, the first two) through the plugin's first audio effect,
/// in blocks of BLOCK frames with its clock advancing, followed by `tail_s` seconds of silence so reverbs and delays
/// can ring out; returns stereo.
/// S17: with automation (frame, id, value events, CLAP only), a saved state loaded into the plugin before it
/// starts, and its state saved after it stops into `state_out` (CLAP only; other formats refuse either).
#[allow(clippy::too_many_arguments)]
pub fn process_with(format: &str, plugin: &Path, input: &Audio, tail_s: f64, values: &[(u32, f64)], automation: &[(u64, u32, f64)], state_in: Option<&[u8]>, state_out: Option<&mut Vec<u8>>) -> Result<Audio, String> {
    if format != "clap" && (!automation.is_empty() || state_in.is_some() || state_out.is_some()) {
        return Err(format!("automation and saved state are hosted for CLAP plugins only, not {format}"));
    }
    if format == "ladspa" {
        return crate::ladspa::process(plugin, input, tail_s, values);
    }
    let rate = input.rate;
    let frames = input.channels.first().map_or(0, |c| c.len());
    let total = frames + (tail_s.max(0.0) * rate as f64) as usize;
    let side = |c: usize| {
        let mut v = input.channels[c.min(input.channels.len() - 1)].clone();
        v.resize(total, 0.0);
        v
    };
    let (left, right) = (side(0), side(1));
    let mut out = vec![vec![0f32; total], vec![0f32; total]];
    unsafe {
        match format {
            "clap" => clap_process(plugin, rate, &left, &right, &mut out, values, automation, state_in, state_out)?,
            "vst3" => vst3_process(plugin, rate, &left, &right, &mut out, values)?,
            "au" => crate::au::process(&plugin.to_string_lossy(), rate, &left, &right, &mut out, values)?,
            other => return Err(format!("unknown plugin format {other}")),
        }
    }
    Ok(Audio { rate, channels: out })
}

#[allow(clippy::too_many_arguments)]
unsafe fn clap_process(path: &Path, rate: u32, left: &[f32], right: &[f32], out: &mut [Vec<f32>], values: &[(u32, f64)], automation: &[(u64, u32, f64)], state_in: Option<&[u8]>, state_out: Option<&mut Vec<u8>>) -> Result<(), String> {
    let param_events = crate::params::ClapEvents::new(values).with_automation(automation);
    // a bundle's other plugins by index, `file.clap#1`, as LADSPA libraries are named (RX-67: formwav's bundle holds two)
    let text = path.to_string_lossy();
    let (path, index) = match text.rsplit_once('#') {
        Some((file, n)) if n.parse::<u32>().is_ok() => (Path::new(file).to_path_buf(), n.parse::<u32>().unwrap_or(0)),
        _ => (path.to_path_buf(), 0),
    };
    let (lib, entry) = clap_open(&path)?;
    let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
    if factory.is_null() {
        return Err("no plugin factory".into());
    }
    let desc = ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, index);
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
    let state_ext = ((*plugin).get_extension.ok_or("no get_extension")?)(plugin, clap_sys::ext::state::CLAP_EXT_STATE.as_ptr()) as *const clap_sys::ext::state::clap_plugin_state;
    if (state_in.is_some() || state_out.is_some()) && state_ext.is_null() {
        return Err("the plugin keeps no state".into());
    }
    if let Some(bytes) = state_in {
        let mut reader = crate::params::StateReader { bytes, at: 0 };
        let stream = clap_sys::stream::clap_istream { ctx: &mut reader as *mut crate::params::StateReader as *mut c_void, read: Some(crate::params::state_read) };
        if !((*state_ext).load.ok_or("no state load")?)(plugin, &stream) {
            return Err("the plugin refused the saved state".into());
        }
    }
    if !((*plugin).activate.ok_or("no activate")?)(plugin, rate as f64, 1, BLOCK as u32) || !((*plugin).start_processing.ok_or("no start_processing")?)(plugin) {
        return Err("the plugin would not start".into());
    }
    let in_events = clap_input_events { ctx: &param_events as *const crate::params::ClapEvents as *mut c_void, size: Some(crate::params::clap_events_size), get: Some(crate::params::clap_events_get) };
    let out_events = clap_output_events { ctx: ptr::null_mut(), try_push: Some(crate::no_events_push) };
    // Latency compensation: a plugin that reports latency outputs that much later, so it runs that many frames of
    // silence past the end and the output is taken from that point, lining up sample for sample with the input.
    let latency_ext = ((*plugin).get_extension.ok_or("no get_extension")?)(plugin, clap_sys::ext::latency::CLAP_EXT_LATENCY.as_ptr()) as *const clap_sys::ext::latency::clap_plugin_latency;
    let latency = latency_ext.as_ref().and_then(|e| e.get).map_or(0, |get| get(plugin) as usize);
    let (mut padded_l, mut padded_r) = (left.to_vec(), right.to_vec());
    padded_l.resize(left.len() + latency, 0.0);
    padded_r.resize(right.len() + latency, 0.0);
    let (left, right) = (&padded_l[..], &padded_r[..]);
    let mut wet = vec![vec![0f32; left.len()]; 2];
    let (o0, o1) = (wet[0].as_mut_ptr(), wet[1].as_mut_ptr());
    let mut pos = 0;
    while pos < left.len() {
        let n = BLOCK.min(left.len() - pos);
        param_events.block(pos as u64, n as u64);
        let mut in_ptrs = [left.as_ptr().add(pos) as *mut f32, right.as_ptr().add(pos) as *mut f32];
        let mut out_ptrs = [o0.add(pos), o1.add(pos)];
        let in_buf = clap_audio_buffer { data32: in_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
        let mut out_buf = clap_audio_buffer { data32: out_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
        let process = clap_process {
            steady_time: pos as i64,
            frames_count: n as u32,
            transport: ptr::null(),
            audio_inputs: &in_buf,
            audio_outputs: &mut out_buf,
            audio_inputs_count: 1,
            audio_outputs_count: 1,
            in_events: &in_events,
            out_events: &out_events,
        };
        if ((*plugin).process.ok_or("no process")?)(plugin, &process) == CLAP_PROCESS_ERROR {
            return Err(format!("the plugin failed at frame {pos}"));
        }
        param_events.live.set(false);
        pos += n;
    }
    for (channel, dst) in out.iter_mut().enumerate() {
        let len = dst.len();
        dst.copy_from_slice(&wet[channel][latency..latency + len]);
    }
    ((*plugin).stop_processing.ok_or("no stop_processing")?)(plugin);
    ((*plugin).deactivate.ok_or("no deactivate")?)(plugin);
    if let Some(saved) = state_out {
        saved.clear();
        let stream = clap_sys::stream::clap_ostream { ctx: saved as *mut Vec<u8> as *mut c_void, write: Some(crate::params::state_write) };
        if !((*state_ext).save.ok_or("no state save")?)(plugin, &stream) {
            return Err("the plugin would not save its state".into());
        }
    }
    ((*plugin).destroy.ok_or("no destroy")?)(plugin);
    ((*entry).deinit.ok_or("no deinit")?)();
    drop(lib);
    Ok(())
}

unsafe fn vst3_process(path: &Path, rate: u32, left: &[f32], right: &[f32], out: &mut [Vec<f32>], values: &[(u32, f64)]) -> Result<(), String> {
    let changes = ComWrapper::new(crate::params::Vst3Changes::new(values));
    let changes_ptr = changes.to_com_ptr::<vst3::Steinberg::Vst::IParameterChanges>().ok_or("parameter changes")?;
    let (lib, factory) = vst3_open(path)?;
    let (cid, _) = vst3_effects(&factory).into_iter().next().ok_or("the module holds no audio effect")?;
    let mut obj: *mut c_void = ptr::null_mut();
    if factory.createInstance(cid.as_ptr(), IComponent::IID.as_ptr() as *const std::ffi::c_char, &mut obj) != kResultOk {
        return Err("the factory would not create the component".into());
    }
    let component = ComPtr::from_raw(obj as *mut IComponent).ok_or("no component")?;
    let host = ComWrapper::new(crate::HostApplication);
    let context = host.to_com_ptr::<IHostApplication>().ok_or("host context")?;
    if component.initialize(context.as_ptr() as *mut FUnknown) != kResultOk {
        return Err("the component would not initialise".into());
    }
    let processor = component.cast::<IAudioProcessor>().ok_or("the component is not an audio processor")?;
    let (mut ins, mut outs) = ([SpeakerArr::kStereo], [SpeakerArr::kStereo]);
    processor.setBusArrangements(ins.as_mut_ptr(), 1, outs.as_mut_ptr(), 1);
    component.activateBus(MediaTypes_::kAudio as i32, BusDirections_::kInput as i32, 0, 1);
    component.activateBus(MediaTypes_::kAudio as i32, BusDirections_::kOutput as i32, 0, 1);
    let mut setup = ProcessSetup { processMode: ProcessModes_::kOffline as i32, symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32, maxSamplesPerBlock: BLOCK as i32, sampleRate: rate as f64 };
    if processor.setupProcessing(&mut setup) != kResultOk || component.setActive(1) != kResultOk {
        return Err("the processor would not set up or activate".into());
    }
    processor.setProcessing(1);
    // Latency compensation, as for CLAP: run the reported latency past the end and take the output from there.
    let latency = processor.getLatencySamples() as usize;
    let (mut padded_l, mut padded_r) = (left.to_vec(), right.to_vec());
    padded_l.resize(left.len() + latency, 0.0);
    padded_r.resize(right.len() + latency, 0.0);
    let (left, right) = (&padded_l[..], &padded_r[..]);
    let mut wet = vec![vec![0f32; left.len()]; 2];
    let (o0, o1) = (wet[0].as_mut_ptr(), wet[1].as_mut_ptr());
    let mut pos = 0;
    let mut failed = None;
    while pos < left.len() {
        let n = BLOCK.min(left.len() - pos);
        let mut in_ptrs = [left.as_ptr().add(pos) as *mut f32, right.as_ptr().add(pos) as *mut f32];
        let mut out_ptrs = [o0.add(pos), o1.add(pos)];
        let mut in_bus = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: in_ptrs.as_mut_ptr() } };
        let mut out_bus = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: out_ptrs.as_mut_ptr() } };
        let mut data = ProcessData {
            processMode: ProcessModes_::kOffline as i32,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32,
            numSamples: n as i32,
            numInputs: 1,
            numOutputs: 1,
            inputs: &mut in_bus,
            outputs: &mut out_bus,
            inputParameterChanges: if values.is_empty() || !changes.live.get() { ptr::null_mut() } else { changes_ptr.as_ptr() },
            outputParameterChanges: ptr::null_mut(),
            inputEvents: ptr::null_mut(),
            outputEvents: ptr::null_mut(),
            processContext: ptr::null_mut(),
        };
        if processor.process(&mut data) != kResultOk {
            failed = Some(pos);
            break;
        }
        changes.live.set(false);
        pos += n;
    }
    for (channel, dst) in out.iter_mut().enumerate() {
        let len = dst.len();
        dst.copy_from_slice(&wet[channel][latency..latency + len]);
    }
    processor.setProcessing(0);
    component.setActive(0);
    component.terminate();
    drop(processor);
    drop(component);
    drop(factory);
    vst3_close(lib);
    match failed {
        Some(at) => Err(format!("the plugin failed at frame {at}")),
        None => Ok(()),
    }
}
