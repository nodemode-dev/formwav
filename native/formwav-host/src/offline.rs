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
    for kind in ["CLAP", "VST3"] {
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
    dirs
}

fn find(dir: &Path, found: &mut Vec<(&'static str, PathBuf)>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        match path.extension().and_then(|x| x.to_str()) {
            Some("clap") => found.push(("clap", path)),
            Some("vst3") => found.push(("vst3", path)),
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

unsafe fn clap_open(path: &Path) -> Result<(libloading::Library, *const clap_plugin_entry), String> {
    let binary = clap_binary(path)?;
    let lib = libloading::Library::new(&binary).map_err(|e| format!("could not load {}: {e}", binary.display()))?;
    let entry = *lib.get::<*const clap_plugin_entry>(b"clap_entry\0").map_err(|e| format!("no clap_entry: {e}"))?;
    let c_path = CString::new(path.to_string_lossy().as_bytes()).unwrap();
    if !((*entry).init.ok_or("entry without init")?)(c_path.as_ptr()) {
        return Err("the plugin's entry refused to initialise".into());
    }
    Ok((lib, entry))
}

unsafe fn vst3_open(path: &Path) -> Result<(libloading::os::unix::Library, ComPtr<IPluginFactory>), String> {
    let binary = crate::vst3_binary(&path.to_string_lossy())?;
    let lib = libloading::os::unix::Library::new(&binary).map_err(|e| format!("could not load {}: {e}", binary.display()))?;
    let handle = lib.into_raw();
    let lib = libloading::os::unix::Library::from_raw(handle);
    if let Ok(entry) = lib.get::<unsafe extern "C" fn(*mut c_void) -> bool>(b"ModuleEntry\0") {
        if !entry(handle) {
            return Err("the module refused to enter".into());
        }
    }
    let get_factory = lib.get::<unsafe extern "C" fn() -> *mut IPluginFactory>(b"GetPluginFactory\0").map_err(|e| format!("no GetPluginFactory: {e}"))?;
    let factory = ComPtr::from_raw(get_factory()).ok_or("GetPluginFactory returned nothing")?;
    Ok((lib, factory))
}

unsafe fn vst3_close(lib: libloading::os::unix::Library) {
    if let Ok(exit) = lib.get::<unsafe extern "C" fn() -> bool>(b"ModuleExit\0") {
        exit();
    }
}

unsafe fn vst3_effects(factory: &ComPtr<IPluginFactory>) -> Vec<(TUID, String)> {
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
        let described: Result<Vec<(String, String)>, String> = unsafe {
            match format {
                "clap" => clap_open(&path).and_then(|(lib, entry)| {
                    let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
                    let mut list = Vec::new();
                    if !factory.is_null() {
                        for i in 0..((*factory).get_plugin_count.ok_or("no count")?)(factory) {
                            let d = ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, i);
                            if !d.is_null() {
                                list.push((CStr::from_ptr((*d).id).to_string_lossy().into_owned(), CStr::from_ptr((*d).name).to_string_lossy().into_owned()));
                            }
                        }
                    }
                    ((*entry).deinit.ok_or("no deinit")?)();
                    drop(lib);
                    Ok(list)
                }),
                _ => vst3_open(&path).map(|(lib, factory)| {
                    let list = vst3_effects(&factory).into_iter().map(|(cid, name)| (cid.iter().map(|b| format!("{:02X}", *b as u8)).collect(), name)).collect();
                    drop(factory);
                    vst3_close(lib);
                    list
                }),
            }
        };
        match described {
            Ok(list) => out.extend(list.into_iter().map(|(id, name)| format!("{{\"format\": \"{format}\", \"path\": \"{p}\", \"id\": \"{}\", \"name\": \"{}\"}}", json(&id), json(&name)))),
            Err(e) => out.push(format!("{{\"format\": \"{format}\", \"path\": \"{p}\", \"error\": \"{}\"}}", json(&e))),
        }
    }
    out
}

/// Runs `input` (mono becomes both sides; beyond two channels, the first two) through the plugin's first audio effect,
/// in blocks of BLOCK frames with its clock advancing, followed by `tail_s` seconds of silence so reverbs and delays
/// can ring out; returns stereo.
pub fn process(format: &str, plugin: &Path, input: &Audio, tail_s: f64) -> Result<Audio, String> {
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
            "clap" => clap_process(plugin, rate, &left, &right, &mut out)?,
            "vst3" => vst3_process(plugin, rate, &left, &right, &mut out)?,
            other => return Err(format!("unknown plugin format {other}")),
        }
    }
    Ok(Audio { rate, channels: out })
}

unsafe fn clap_process(path: &Path, rate: u32, left: &[f32], right: &[f32], out: &mut [Vec<f32>]) -> Result<(), String> {
    let (lib, entry) = clap_open(path)?;
    let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
    if factory.is_null() {
        return Err("no plugin factory".into());
    }
    let desc = ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, 0);
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
    if !((*plugin).activate.ok_or("no activate")?)(plugin, rate as f64, 1, BLOCK as u32) || !((*plugin).start_processing.ok_or("no start_processing")?)(plugin) {
        return Err("the plugin would not start".into());
    }
    let in_events = clap_input_events { ctx: ptr::null_mut(), size: Some(crate::no_events_size), get: Some(crate::no_events_get) };
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
        pos += n;
    }
    for (channel, dst) in out.iter_mut().enumerate() {
        let len = dst.len();
        dst.copy_from_slice(&wet[channel][latency..latency + len]);
    }
    ((*plugin).stop_processing.ok_or("no stop_processing")?)(plugin);
    ((*plugin).deactivate.ok_or("no deactivate")?)(plugin);
    ((*plugin).destroy.ok_or("no destroy")?)(plugin);
    ((*entry).deinit.ok_or("no deinit")?)();
    drop(lib);
    Ok(())
}

unsafe fn vst3_process(path: &Path, rate: u32, left: &[f32], right: &[f32], out: &mut [Vec<f32>]) -> Result<(), String> {
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
            inputParameterChanges: ptr::null_mut(),
            outputParameterChanges: ptr::null_mut(),
            inputEvents: ptr::null_mut(),
            outputEvents: ptr::null_mut(),
            processContext: ptr::null_mut(),
        };
        if processor.process(&mut data) != kResultOk {
            failed = Some(pos);
            break;
        }
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
