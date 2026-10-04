//! A CLAP instrument fixture for fwhost's tests (PT-15): a sine per note at its key's pitch, its level the velocity
//! times 0.25, starting on the note-on's frame and stopping on the note-off's (no envelope, so its timing can be
//! checked to the sample). One stereo output, one note input, no audio input.

use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::sync::Mutex;

use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{clap_event_note, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_NOTE_OFF, CLAP_EVENT_NOTE_ON};
use clap_sys::ext::audio_ports::{clap_audio_port_info, clap_plugin_audio_ports, CLAP_AUDIO_PORT_IS_MAIN, CLAP_EXT_AUDIO_PORTS, CLAP_PORT_STEREO};
use clap_sys::ext::note_ports::{clap_note_port_info, clap_plugin_note_ports, CLAP_EXT_NOTE_PORTS, CLAP_NOTE_DIALECT_CLAP, CLAP_NOTE_DIALECT_MIDI};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::id::CLAP_INVALID_ID;
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_CONTINUE, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;

struct Shared<T>(T);
unsafe impl<T> Sync for Shared<T> {}

static FEATURES: Shared<[*const c_char; 3]> = Shared([c"instrument".as_ptr(), c"synthesizer".as_ptr(), ptr::null()]);

static DESCRIPTOR: Shared<clap_plugin_descriptor> = Shared(clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: c"ai.nodemode.formwav.test-sine".as_ptr(),
    name: c"formwav test sine".as_ptr(),
    vendor: c"nodemode-ai".as_ptr(),
    url: c"".as_ptr(),
    manual_url: c"".as_ptr(),
    support_url: c"".as_ptr(),
    version: c"0.1.0".as_ptr(),
    description: c"A sine per note, gated exactly by its note-on and note-off".as_ptr(),
    features: &FEATURES.0 as *const [*const c_char; 3] as *const *const c_char,
});

/// The rate, and the sounding voices: key, level, phase (0 to 1).
static STATE: Mutex<(f64, Vec<(i16, f64, f64)>)> = Mutex::new((48000.0, Vec::new()));

unsafe extern "C" fn plugin_init(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_destroy(plugin: *const clap_plugin) {
    drop(Box::from_raw(plugin as *mut clap_plugin));
}

unsafe extern "C" fn plugin_activate(_plugin: *const clap_plugin, rate: f64, _min: u32, _max: u32) -> bool {
    *STATE.lock().unwrap() = (rate, Vec::new());
    true
}

unsafe extern "C" fn plugin_start(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_nothing(_plugin: *const clap_plugin) {}

unsafe extern "C" fn plugin_process(_plugin: *const clap_plugin, process: *const clap_process) -> clap_process_status {
    let process = &*process;
    if process.audio_outputs_count < 1 || process.in_events.is_null() {
        return CLAP_PROCESS_ERROR;
    }
    let output = &*process.audio_outputs;
    let (left, right) = (*output.data32.add(0), *output.data32.add(if output.channel_count > 1 { 1 } else { 0 }));
    let events = process.in_events;
    let count = ((*events).size.unwrap())(events);
    let mut next = 0;
    let mut state = STATE.lock().unwrap();
    let rate = state.0;
    for i in 0..process.frames_count as usize {
        while next < count {
            let header = ((*events).get.unwrap())(events, next);
            if header.is_null() || (*header).time as usize > i {
                break;
            }
            if (*header).space_id == CLAP_CORE_EVENT_SPACE_ID {
                let note = &*(header as *const clap_event_note);
                match (*header).type_ {
                    CLAP_EVENT_NOTE_ON => state.1.push((note.key, note.velocity * 0.25, 0.0)),
                    CLAP_EVENT_NOTE_OFF => state.1.retain(|v| v.0 != note.key),
                    _ => {}
                }
            }
            next += 1;
        }
        let mut sum = 0.0f64;
        for voice in state.1.iter_mut() {
            sum += voice.1 * (std::f64::consts::TAU * voice.2).sin();
            voice.2 += 440.0 * 2f64.powf((voice.0 as f64 - 69.0) / 12.0) / rate;
            if voice.2 >= 1.0 {
                voice.2 -= 1.0;
            }
        }
        *left.add(i) = sum as f32;
        *right.add(i) = sum as f32;
    }
    CLAP_PROCESS_CONTINUE
}

unsafe extern "C" fn audio_count(_plugin: *const clap_plugin, is_input: bool) -> u32 {
    if is_input { 0 } else { 1 }
}

unsafe extern "C" fn audio_get(_plugin: *const clap_plugin, index: u32, is_input: bool, info: *mut clap_audio_port_info) -> bool {
    if is_input || index != 0 {
        return false;
    }
    let info = &mut *info;
    info.id = 0;
    for (slot, byte) in info.name.iter_mut().zip(b"out\0") {
        *slot = *byte as c_char;
    }
    info.flags = CLAP_AUDIO_PORT_IS_MAIN;
    info.channel_count = 2;
    info.port_type = CLAP_PORT_STEREO.as_ptr();
    info.in_place_pair = CLAP_INVALID_ID;
    true
}

static AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports { count: Some(audio_count), get: Some(audio_get) };

unsafe extern "C" fn note_count(_plugin: *const clap_plugin, is_input: bool) -> u32 {
    if is_input { 1 } else { 0 }
}

unsafe extern "C" fn note_get(_plugin: *const clap_plugin, index: u32, is_input: bool, info: *mut clap_note_port_info) -> bool {
    if !is_input || index != 0 {
        return false;
    }
    let info = &mut *info;
    info.id = 0;
    info.supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI;
    info.preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
    for (slot, byte) in info.name.iter_mut().zip(b"notes\0") {
        *slot = *byte as c_char;
    }
    true
}

static NOTE_PORTS: clap_plugin_note_ports = clap_plugin_note_ports { count: Some(note_count), get: Some(note_get) };

unsafe extern "C" fn plugin_get_extension(_plugin: *const clap_plugin, id: *const c_char) -> *const c_void {
    let id = CStr::from_ptr(id);
    if id == CLAP_EXT_AUDIO_PORTS {
        &AUDIO_PORTS as *const clap_plugin_audio_ports as *const c_void
    } else if id == CLAP_EXT_NOTE_PORTS {
        &NOTE_PORTS as *const clap_plugin_note_ports as *const c_void
    } else {
        ptr::null()
    }
}

unsafe extern "C" fn factory_count(_factory: *const clap_plugin_factory) -> u32 {
    1
}

unsafe extern "C" fn factory_descriptor(_factory: *const clap_plugin_factory, index: u32) -> *const clap_plugin_descriptor {
    if index == 0 { &DESCRIPTOR.0 } else { ptr::null() }
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

static FACTORY: clap_plugin_factory = clap_plugin_factory { get_plugin_count: Some(factory_count), get_plugin_descriptor: Some(factory_descriptor), create_plugin: Some(factory_create) };

unsafe extern "C" fn entry_init(_path: *const c_char) -> bool {
    true
}

unsafe extern "C" fn entry_deinit() {}

unsafe extern "C" fn entry_get_factory(id: *const c_char) -> *const c_void {
    if CStr::from_ptr(id) == CLAP_PLUGIN_FACTORY_ID { &FACTORY as *const clap_plugin_factory as *const c_void } else { ptr::null() }
}

#[allow(non_upper_case_globals)]
#[no_mangle]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry { clap_version: CLAP_VERSION, init: Some(entry_init), deinit: Some(entry_deinit), get_factory: Some(entry_get_factory) };
