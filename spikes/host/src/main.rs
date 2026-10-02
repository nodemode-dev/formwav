//! fwhost: formwav's plugin-hosting spike (spike B). Loads a CLAP or VST3 plugin, runs a known buffer through it and
//! reports what it did, the first step toward hosting plugins in formwav's native core (Phase 4).
//!
//!     fwhost clap <plugin.clap>
//!
//! The buffer is 100 ms of a 1 kHz sine at -12 dBFS on both channels at 48 kHz; the report is one JSON line.

use std::ffi::{c_char, c_void, CStr, CString};
use std::ptr;

use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{clap_event_header, clap_input_events, clap_output_events};
use clap_sys::ext::audio_ports::{clap_plugin_audio_ports, CLAP_EXT_AUDIO_PORTS};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::process::{clap_process, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;

const RATE: f64 = 48_000.0;
const FRAMES: usize = 4_800;

fn test_signal() -> [Vec<f32>; 2] {
    let amp = 10f32.powf(-12.0 / 20.0);
    let tone: Vec<f32> = (0..FRAMES).map(|n| amp * (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / RATE as f32).sin()).collect();
    [tone.clone(), tone]
}

fn rms_db(x: &[f32]) -> f64 {
    let power = x.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / x.len() as f64;
    10.0 * power.max(1e-30).log10()
}

fn report(format: &str, plugin: &str, name: &str, found: u32, ports: (u32, u32), ok: bool, input: &[Vec<f32>; 2], output: &[Vec<f32>; 2]) {
    let (i, o) = ((rms_db(&input[0]) + rms_db(&input[1])) / 2.0, (rms_db(&output[0]) + rms_db(&output[1])) / 2.0);
    println!(
        "{{\"format\": \"{format}\", \"plugin\": \"{plugin}\", \"name\": \"{name}\", \"plugins_in_file\": {found}, \"ports_in_out\": [{}, {}], \"processed\": {ok}, \"in_rms_db\": {i:.2}, \"out_rms_db\": {o:.2}, \"gain_db\": {:.2}}}",
        ports.0,
        ports.1,
        o - i
    );
}

unsafe extern "C" fn host_get_extension(_host: *const clap_host, _id: *const c_char) -> *const c_void {
    ptr::null()
}

unsafe extern "C" fn host_request(_host: *const clap_host) {}

unsafe extern "C" fn no_events_size(_list: *const clap_input_events) -> u32 {
    0
}

unsafe extern "C" fn no_events_get(_list: *const clap_input_events, _index: u32) -> *const clap_event_header {
    ptr::null()
}

unsafe extern "C" fn no_events_push(_list: *const clap_output_events, _event: *const clap_event_header) -> bool {
    false
}

fn run_clap(path: &str) -> Result<(), String> {
    unsafe {
        let lib = libloading::Library::new(path).map_err(|e| format!("could not load {path}: {e}"))?;
        let entry: libloading::Symbol<*const clap_plugin_entry> = lib.get(b"clap_entry\0").map_err(|e| format!("no clap_entry: {e}"))?;
        let entry = &**entry;
        let c_path = CString::new(path).unwrap();
        if !(entry.init.ok_or("entry without init")?)(c_path.as_ptr()) {
            return Err("the plugin's entry refused to initialise".into());
        }
        let factory = (entry.get_factory.ok_or("entry without get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
        if factory.is_null() {
            return Err("no plugin factory".into());
        }
        let found = ((*factory).get_plugin_count.ok_or("factory without count")?)(factory);
        let desc = ((*factory).get_plugin_descriptor.ok_or("factory without descriptors")?)(factory, 0);
        if found == 0 || desc.is_null() {
            return Err("the file holds no plugin".into());
        }
        let id = CStr::from_ptr((*desc).id).to_string_lossy().into_owned();
        let name = CStr::from_ptr((*desc).name).to_string_lossy().into_owned();
        let host = Box::new(clap_host {
            clap_version: CLAP_VERSION,
            host_data: ptr::null_mut(),
            name: c"formwav".as_ptr(),
            vendor: c"nodemode-ai".as_ptr(),
            url: c"https://github.com/nodemode-ai/formwav".as_ptr(),
            version: c"spike".as_ptr(),
            get_extension: Some(host_get_extension),
            request_restart: Some(host_request),
            request_process: Some(host_request),
            request_callback: Some(host_request),
        });
        let plugin = ((*factory).create_plugin.ok_or("factory without create")?)(factory, &*host, (*desc).id);
        if plugin.is_null() || !((*plugin).init.ok_or("plugin without init")?)(plugin) {
            return Err("the plugin would not initialise".into());
        }
        let ports_ext = ((*plugin).get_extension.ok_or("plugin without get_extension")?)(plugin, CLAP_EXT_AUDIO_PORTS.as_ptr()) as *const clap_plugin_audio_ports;
        let ports = match ports_ext.as_ref().and_then(|p| p.count) {
            Some(count) => (count(plugin, true), count(plugin, false)),
            None => (0, 0),
        };
        if !((*plugin).activate.ok_or("plugin without activate")?)(plugin, RATE, 1, FRAMES as u32) || !((*plugin).start_processing.ok_or("plugin without start_processing")?)(plugin) {
            return Err("the plugin would not start".into());
        }
        let input = test_signal();
        let mut output = [vec![0f32; FRAMES], vec![0f32; FRAMES]];
        let mut in_ptrs = [input[0].as_ptr() as *mut f32, input[1].as_ptr() as *mut f32];
        let mut out_ptrs = [output[0].as_mut_ptr(), output[1].as_mut_ptr()];
        let in_buf = clap_audio_buffer { data32: in_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
        let mut out_buf = clap_audio_buffer { data32: out_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
        let in_events = clap_input_events { ctx: ptr::null_mut(), size: Some(no_events_size), get: Some(no_events_get) };
        let out_events = clap_output_events { ctx: ptr::null_mut(), try_push: Some(no_events_push) };
        let process = clap_process {
            steady_time: 0,
            frames_count: FRAMES as u32,
            transport: ptr::null(),
            audio_inputs: &in_buf,
            audio_outputs: &mut out_buf,
            audio_inputs_count: 1,
            audio_outputs_count: 1,
            in_events: &in_events,
            out_events: &out_events,
        };
        let status = ((*plugin).process.ok_or("plugin without process")?)(plugin, &process);
        ((*plugin).stop_processing.ok_or("no stop_processing")?)(plugin);
        ((*plugin).deactivate.ok_or("no deactivate")?)(plugin);
        ((*plugin).destroy.ok_or("no destroy")?)(plugin);
        (entry.deinit.ok_or("entry without deinit")?)();
        report("clap", &id, &name, found, ports, status != CLAP_PROCESS_ERROR, &input, &output);
        Ok(())
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = match (args.get(1).map(String::as_str), args.get(2)) {
        (Some("clap"), Some(path)) => run_clap(path),
        _ => Err("usage: fwhost clap <plugin.clap>".into()),
    };
    if let Err(message) = result {
        eprintln!("fwhost: {message}");
        std::process::exit(1);
    }
}
