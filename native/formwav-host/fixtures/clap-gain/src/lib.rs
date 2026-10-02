//! A CLAP test plugin for formwav's hosting spike (spike B): one stereo input, one stereo output, and a fixed gain of
//! 0.5 (-6.02 dB), so a host measuring it knows the right answer. Not part of formwav; built only to be hosted.

use std::ffi::{c_char, c_void, CStr};
use std::ptr;

use clap_sys::entry::clap_plugin_entry;
use clap_sys::ext::audio_ports::{clap_audio_port_info, clap_plugin_audio_ports, CLAP_AUDIO_PORT_IS_MAIN, CLAP_EXT_AUDIO_PORTS, CLAP_PORT_STEREO};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::id::CLAP_INVALID_ID;
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_CONTINUE, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;

struct Shared<T>(T);
unsafe impl<T> Sync for Shared<T> {}

static FEATURES: Shared<[*const c_char; 3]> = Shared([c"audio-effect".as_ptr(), c"utility".as_ptr(), ptr::null()]);

static DESCRIPTOR: Shared<clap_plugin_descriptor> = Shared(clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: c"ai.nodemode.formwav.test-gain".as_ptr(),
    name: c"formwav test gain".as_ptr(),
    vendor: c"nodemode-ai".as_ptr(),
    url: c"".as_ptr(),
    manual_url: c"".as_ptr(),
    support_url: c"".as_ptr(),
    version: c"0.1.0".as_ptr(),
    description: c"Halves the signal (-6.02 dB)".as_ptr(),
    features: &FEATURES.0 as *const [*const c_char; 3] as *const *const c_char,
});

unsafe extern "C" fn plugin_init(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_destroy(plugin: *const clap_plugin) {
    drop(Box::from_raw(plugin as *mut clap_plugin));
}

// An optional declared latency for testing a host's compensation: FORMWAV_TEST_LATENCY=n delays the output by n
// samples and reports n through CLAP's latency extension; unset, the fixture has none.
static DELAY: std::sync::Mutex<Vec<std::collections::VecDeque<f32>>> = std::sync::Mutex::new(Vec::new());

fn test_latency() -> u32 {
    std::env::var("FORMWAV_TEST_LATENCY").ok().and_then(|v| v.parse().ok()).unwrap_or(0)
}

unsafe extern "C" fn plugin_activate(_plugin: *const clap_plugin, _rate: f64, _min: u32, _max: u32) -> bool {
    let n = test_latency() as usize;
    *DELAY.lock().unwrap() = (0..2).map(|_| std::iter::repeat(0.0).take(n).collect()).collect();
    true
}

unsafe extern "C" fn latency_get(_plugin: *const clap_plugin) -> u32 {
    test_latency()
}

static LATENCY: clap_sys::ext::latency::clap_plugin_latency = clap_sys::ext::latency::clap_plugin_latency { get: Some(latency_get) };

unsafe extern "C" fn plugin_start(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_nothing(_plugin: *const clap_plugin) {}

unsafe extern "C" fn plugin_process(_plugin: *const clap_plugin, process: *const clap_process) -> clap_process_status {
    let process = &*process;
    if process.audio_inputs_count < 1 || process.audio_outputs_count < 1 {
        return CLAP_PROCESS_ERROR;
    }
    let input = &*process.audio_inputs;
    let output = &*process.audio_outputs;
    let mut delay = DELAY.lock().unwrap();
    for channel in 0..input.channel_count.min(output.channel_count) as usize {
        let src = *input.data32.add(channel);
        let dst = *output.data32.add(channel);
        let mut line = delay.get_mut(channel);
        for i in 0..process.frames_count as usize {
            let wet = *src.add(i) * 0.5;
            *dst.add(i) = match line {
                Some(ref mut l) if !l.is_empty() => {
                    l.push_back(wet);
                    l.pop_front().unwrap_or(0.0)
                }
                _ => wet,
            };
        }
    }
    CLAP_PROCESS_CONTINUE
}

unsafe extern "C" fn ports_count(_plugin: *const clap_plugin, _is_input: bool) -> u32 {
    1
}

unsafe extern "C" fn ports_get(_plugin: *const clap_plugin, index: u32, _is_input: bool, info: *mut clap_audio_port_info) -> bool {
    if index != 0 {
        return false;
    }
    let info = &mut *info;
    info.id = 0;
    for (slot, byte) in info.name.iter_mut().zip(b"main\0") {
        *slot = *byte as c_char;
    }
    info.flags = CLAP_AUDIO_PORT_IS_MAIN;
    info.channel_count = 2;
    info.port_type = CLAP_PORT_STEREO.as_ptr();
    info.in_place_pair = CLAP_INVALID_ID;
    true
}

static AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports { count: Some(ports_count), get: Some(ports_get) };

unsafe extern "C" fn plugin_get_extension(_plugin: *const clap_plugin, id: *const c_char) -> *const c_void {
    if CStr::from_ptr(id) == CLAP_EXT_AUDIO_PORTS {
        &AUDIO_PORTS as *const clap_plugin_audio_ports as *const c_void
    } else if CStr::from_ptr(id) == clap_sys::ext::latency::CLAP_EXT_LATENCY {
        &LATENCY as *const clap_sys::ext::latency::clap_plugin_latency as *const c_void
    } else {
        ptr::null()
    }
}

unsafe extern "C" fn factory_count(_factory: *const clap_plugin_factory) -> u32 {
    1
}

unsafe extern "C" fn factory_descriptor(_factory: *const clap_plugin_factory, index: u32) -> *const clap_plugin_descriptor {
    if index == 0 {
        &DESCRIPTOR.0
    } else {
        ptr::null()
    }
}

unsafe extern "C" fn factory_create(_factory: *const clap_plugin_factory, _host: *const clap_host, id: *const c_char) -> *const clap_plugin {
    if CStr::from_ptr(id) != CStr::from_ptr(DESCRIPTOR.0.id) {
        return ptr::null();
    }
    Box::into_raw(Box::new(clap_plugin {
        desc: &DESCRIPTOR.0,
        plugin_data: ptr::null_mut(),
        init: Some(plugin_init),
        destroy: Some(plugin_destroy),
        activate: Some(plugin_activate),
        deactivate: Some(plugin_nothing),
        start_processing: Some(plugin_start),
        stop_processing: Some(plugin_nothing),
        reset: Some(plugin_nothing),
        process: Some(plugin_process),
        get_extension: Some(plugin_get_extension),
        on_main_thread: Some(plugin_nothing),
    }))
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

unsafe extern "C" fn entry_get_factory(id: *const c_char) -> *const c_void {
    if CStr::from_ptr(id) == CLAP_PLUGIN_FACTORY_ID {
        &FACTORY as *const clap_plugin_factory as *const c_void
    } else {
        ptr::null()
    }
}

#[allow(non_upper_case_globals)]
#[no_mangle]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry {
    clap_version: CLAP_VERSION,
    init: Some(entry_init),
    deinit: Some(entry_deinit),
    get_factory: Some(entry_get_factory),
};
