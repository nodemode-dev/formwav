//! A CLAP test plug-in with an editor, for formwav-host's editors (S17 phase C): a stereo gain whose one parameter
//! (Gain, 0 to 1, id 0) is kept as its state (eight bytes) and set by its own X11 editor, a 240 x 80 window where a
//! click or a drag at x sets the gain to x / 240 and a bar shows it. The editor's X connection is driven by the host
//! through posix-fd-support, as CLAP asks on Linux. Not part of formwav; built only to be hosted.

use std::ffi::{c_char, c_void, CStr};
use std::os::fd::AsRawFd;
use std::ptr;

use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{clap_event_param_value, clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE};
use clap_sys::ext::audio_ports::{clap_audio_port_info, clap_plugin_audio_ports, CLAP_AUDIO_PORT_IS_MAIN, CLAP_EXT_AUDIO_PORTS, CLAP_PORT_STEREO};
use clap_sys::ext::gui::{clap_gui_resize_hints, clap_plugin_gui, clap_window, CLAP_EXT_GUI, CLAP_WINDOW_API_X11};
use clap_sys::ext::params::{clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE};
use clap_sys::ext::posix_fd_support::{clap_host_posix_fd_support, clap_plugin_posix_fd_support, CLAP_EXT_POSIX_FD_SUPPORT, CLAP_POSIX_FD_READ};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::id::{clap_id, CLAP_INVALID_ID};
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_CONTINUE};
use clap_sys::stream::{clap_istream, clap_ostream};
use clap_sys::version::CLAP_VERSION;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ConnectionExt as _, CreateGCAux, CreateWindowAux, EventMask, Rectangle, WindowClass};
use x11rb::protocol::Event as XEvent;
use x11rb::rust_connection::RustConnection;

struct Shared<T>(T);
unsafe impl<T> Sync for Shared<T> {}

const WIDTH: u32 = 240;
const HEIGHT: u32 = 80;

static FEATURES: Shared<[*const c_char; 3]> = Shared([c"audio-effect".as_ptr(), c"utility".as_ptr(), ptr::null()]);

static DESCRIPTOR: Shared<clap_plugin_descriptor> = Shared(clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: c"ai.nodemode.formwav.test-knob".as_ptr(),
    name: c"formwav test knob".as_ptr(),
    vendor: c"nodemode-ai".as_ptr(),
    url: c"".as_ptr(),
    manual_url: c"".as_ptr(),
    support_url: c"".as_ptr(),
    version: c"0.1.0".as_ptr(),
    description: c"A gain set from its own editor".as_ptr(),
    features: &FEATURES.0 as *const [*const c_char; 3] as *const *const c_char,
});

struct Editor {
    conn: RustConnection,
    win: u32,
    gc: u32,
}

struct Knob {
    host: *const clap_host,
    gain: f64,
    editor: Option<Editor>,
    pending: Option<Box<RustConnection>>,
}

unsafe fn knob<'a>(plugin: *const clap_plugin) -> &'a mut Knob {
    &mut *((*plugin).plugin_data as *mut Knob)
}

impl Knob {
    fn draw(&self) {
        let Some(e) = self.editor.as_ref() else { return };
        let filled = (self.gain.clamp(0.0, 1.0) * WIDTH as f64) as u16;
        let _ = e.conn.clear_area(false, e.win, 0, 0, 0, 0);
        let _ = e.conn.poly_fill_rectangle(e.win, e.gc, &[Rectangle { x: 0, y: 20, width: filled.max(1), height: 40 }]);
        let _ = e.conn.flush();
    }
}

unsafe extern "C" fn plugin_init(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_destroy(plugin: *const clap_plugin) {
    drop(Box::from_raw((*plugin).plugin_data as *mut Knob));
    drop(Box::from_raw(plugin as *mut clap_plugin));
}

unsafe extern "C" fn plugin_activate(_plugin: *const clap_plugin, _rate: f64, _min: u32, _max: u32) -> bool {
    true
}

unsafe extern "C" fn plugin_true(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_nothing(_plugin: *const clap_plugin) {}

/// The gain's value events, from a process call or a flush.
unsafe fn take_events(k: &mut Knob, events: *const clap_input_events) {
    let Some(list) = events.as_ref() else { return };
    let (Some(size), Some(get)) = (list.size, list.get) else { return };
    for i in 0..size(events) {
        let h = get(events, i);
        if !h.is_null() && (*h).space_id == CLAP_CORE_EVENT_SPACE_ID && (*h).type_ == CLAP_EVENT_PARAM_VALUE {
            let e = &*(h as *const clap_event_param_value);
            if e.param_id == 0 {
                k.gain = e.value.clamp(0.0, 1.0);
            }
        }
    }
}

unsafe extern "C" fn plugin_process(plugin: *const clap_plugin, process: *const clap_process) -> clap_process_status {
    let k = knob(plugin);
    let p = &*process;
    take_events(k, p.in_events);
    if p.audio_inputs_count < 1 || p.audio_outputs_count < 1 {
        return CLAP_PROCESS_CONTINUE;
    }
    let (input, output) = (&*p.audio_inputs, &*p.audio_outputs);
    for c in 0..input.channel_count.min(output.channel_count) as usize {
        let (src, dst) = (*input.data32.add(c), *output.data32.add(c));
        for i in 0..p.frames_count as usize {
            *dst.add(i) = *src.add(i) * k.gain as f32;
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

unsafe extern "C" fn params_count(_plugin: *const clap_plugin) -> u32 {
    1
}

unsafe extern "C" fn params_info(_plugin: *const clap_plugin, index: u32, info: *mut clap_param_info) -> bool {
    if index != 0 {
        return false;
    }
    let info = &mut *info;
    info.id = 0;
    info.flags = CLAP_PARAM_IS_AUTOMATABLE;
    info.cookie = ptr::null_mut();
    for (slot, byte) in info.name.iter_mut().zip(b"Gain\0") {
        *slot = *byte as c_char;
    }
    info.module[0] = 0;
    info.min_value = 0.0;
    info.max_value = 1.0;
    info.default_value = 1.0;
    true
}

unsafe extern "C" fn params_value(plugin: *const clap_plugin, id: clap_id, value: *mut f64) -> bool {
    if id != 0 {
        return false;
    }
    *value = knob(plugin).gain;
    true
}

unsafe extern "C" fn params_to_text(_plugin: *const clap_plugin, _id: clap_id, _value: f64, _out: *mut c_char, _size: u32) -> bool {
    false
}

unsafe extern "C" fn params_from_text(_plugin: *const clap_plugin, _id: clap_id, _text: *const c_char, _value: *mut f64) -> bool {
    false
}

unsafe extern "C" fn params_flush(plugin: *const clap_plugin, in_: *const clap_input_events, _out: *const clap_output_events) {
    take_events(knob(plugin), in_);
}

static PARAMS: clap_plugin_params = clap_plugin_params {
    count: Some(params_count),
    get_info: Some(params_info),
    get_value: Some(params_value),
    value_to_text: Some(params_to_text),
    text_to_value: Some(params_from_text),
    flush: Some(params_flush),
};

unsafe extern "C" fn state_save(plugin: *const clap_plugin, stream: *const clap_ostream) -> bool {
    let bytes = knob(plugin).gain.to_le_bytes();
    let Some(write) = (*stream).write else { return false };
    write(stream, bytes.as_ptr() as *const c_void, 8) == 8
}

unsafe extern "C" fn state_load(plugin: *const clap_plugin, stream: *const clap_istream) -> bool {
    let mut bytes = [0u8; 8];
    let Some(read) = (*stream).read else { return false };
    if read(stream, bytes.as_mut_ptr() as *mut c_void, 8) != 8 {
        return false;
    }
    knob(plugin).gain = f64::from_le_bytes(bytes).clamp(0.0, 1.0);
    true
}

static STATE: clap_plugin_state = clap_plugin_state { save: Some(state_save), load: Some(state_load) };

unsafe extern "C" fn gui_supported(_plugin: *const clap_plugin, api: *const c_char, floating: bool) -> bool {
    !floating && CStr::from_ptr(api) == CLAP_WINDOW_API_X11
}

unsafe extern "C" fn gui_preferred(_plugin: *const clap_plugin, api: *mut *const c_char, floating: *mut bool) -> bool {
    *api = CLAP_WINDOW_API_X11.as_ptr();
    *floating = false;
    true
}

unsafe extern "C" fn gui_create(plugin: *const clap_plugin, api: *const c_char, floating: bool) -> bool {
    if floating || CStr::from_ptr(api) != CLAP_WINDOW_API_X11 {
        return false;
    }
    match x11rb::connect(None) {
        Ok((conn, _)) => {
            knob(plugin).pending = Some(Box::new(conn));
            true
        }
        Err(_) => false,
    }
}

unsafe extern "C" fn gui_destroy(plugin: *const clap_plugin) {
    let k = knob(plugin);
    if let Some(e) = k.editor.take() {
        if let Some(host_fd) = ((*k.host).get_extension.and_then(|g| (g(k.host, CLAP_EXT_POSIX_FD_SUPPORT.as_ptr()) as *const clap_host_posix_fd_support).as_ref())).and_then(|x| x.unregister_fd) {
            host_fd(k.host, e.conn.stream().as_raw_fd());
        }
        let _ = e.conn.destroy_window(e.win);
        let _ = e.conn.flush();
    }
    k.pending = None;
}

unsafe extern "C" fn gui_scale(_plugin: *const clap_plugin, _scale: f64) -> bool {
    true
}

unsafe extern "C" fn gui_size(_plugin: *const clap_plugin, width: *mut u32, height: *mut u32) -> bool {
    *width = WIDTH;
    *height = HEIGHT;
    true
}

unsafe extern "C" fn gui_no(_plugin: *const clap_plugin) -> bool {
    false
}

unsafe extern "C" fn gui_hints(_plugin: *const clap_plugin, _hints: *mut clap_gui_resize_hints) -> bool {
    false
}

unsafe extern "C" fn gui_adjust(_plugin: *const clap_plugin, _width: *mut u32, _height: *mut u32) -> bool {
    false
}

unsafe extern "C" fn gui_set_size(_plugin: *const clap_plugin, width: u32, height: u32) -> bool {
    width == WIDTH && height == HEIGHT
}

unsafe extern "C" fn gui_parent(plugin: *const clap_plugin, window: *const clap_window) -> bool {
    let k = knob(plugin);
    let Some(conn) = k.pending.take() else { return false };
    let parent = (*window).specific.x11 as u32;
    let Ok(win) = conn.generate_id() else { return false };
    let Ok(gc) = conn.generate_id() else { return false };
    let screen = &conn.setup().roots[0];
    let aux = CreateWindowAux::new().background_pixel(screen.black_pixel).event_mask(EventMask::BUTTON_PRESS | EventMask::BUTTON_MOTION | EventMask::EXPOSURE);
    if conn.create_window(x11rb::COPY_DEPTH_FROM_PARENT, win, parent, 0, 0, WIDTH as u16, HEIGHT as u16, 0, WindowClass::INPUT_OUTPUT, 0, &aux).is_err() {
        return false;
    }
    let _ = conn.create_gc(gc, win, &CreateGCAux::new().foreground(screen.white_pixel));
    let _ = conn.map_window(win);
    let _ = conn.flush();
    let fd = conn.stream().as_raw_fd();
    if let Some(register) = ((*k.host).get_extension.and_then(|g| (g(k.host, CLAP_EXT_POSIX_FD_SUPPORT.as_ptr()) as *const clap_host_posix_fd_support).as_ref())).and_then(|x| x.register_fd) {
        register(k.host, fd, CLAP_POSIX_FD_READ);
    }
    k.editor = Some(Editor { conn: *conn, win, gc });
    k.draw();
    true
}

unsafe extern "C" fn gui_transient(_plugin: *const clap_plugin, _window: *const clap_window) -> bool {
    false
}

unsafe extern "C" fn gui_title(_plugin: *const clap_plugin, _title: *const c_char) {}

static GUI: clap_plugin_gui = clap_plugin_gui {
    is_api_supported: Some(gui_supported),
    get_preferred_api: Some(gui_preferred),
    create: Some(gui_create),
    destroy: Some(gui_destroy),
    set_scale: Some(gui_scale),
    get_size: Some(gui_size),
    can_resize: Some(gui_no),
    get_resize_hints: Some(gui_hints),
    adjust_size: Some(gui_adjust),
    set_size: Some(gui_set_size),
    set_parent: Some(gui_parent),
    set_transient: Some(gui_transient),
    suggest_title: Some(gui_title),
    show: Some(plugin_true),
    hide: Some(plugin_true),
};

/// The editor's X events, read when the host sees its connection readable: a press or a drag sets the gain.
unsafe extern "C" fn on_fd(plugin: *const clap_plugin, _fd: i32, _flags: u32) {
    let k = knob(plugin);
    let mut changed = false;
    let mut expose = false;
    if let Some(e) = k.editor.as_ref() {
        while let Ok(Some(event)) = e.conn.poll_for_event() {
            match event {
                XEvent::ButtonPress(b) => {
                    k.gain = (b.event_x as f64 / WIDTH as f64).clamp(0.0, 1.0);
                    changed = true;
                }
                XEvent::MotionNotify(m) => {
                    k.gain = (m.event_x as f64 / WIDTH as f64).clamp(0.0, 1.0);
                    changed = true;
                }
                XEvent::Expose(_) => expose = true,
                _ => {}
            }
        }
    }
    if changed || expose {
        k.draw();
    }
}

static FD: clap_plugin_posix_fd_support = clap_plugin_posix_fd_support { on_fd: Some(on_fd) };

unsafe extern "C" fn plugin_get_extension(_plugin: *const clap_plugin, id: *const c_char) -> *const c_void {
    let id = CStr::from_ptr(id);
    if id == CLAP_EXT_AUDIO_PORTS {
        &AUDIO_PORTS as *const clap_plugin_audio_ports as *const c_void
    } else if id == CLAP_EXT_PARAMS {
        &PARAMS as *const clap_plugin_params as *const c_void
    } else if id == CLAP_EXT_STATE {
        &STATE as *const clap_plugin_state as *const c_void
    } else if id == CLAP_EXT_GUI {
        &GUI as *const clap_plugin_gui as *const c_void
    } else if id == CLAP_EXT_POSIX_FD_SUPPORT {
        &FD as *const clap_plugin_posix_fd_support as *const c_void
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

unsafe extern "C" fn factory_create(_factory: *const clap_plugin_factory, host: *const clap_host, id: *const c_char) -> *const clap_plugin {
    if CStr::from_ptr(id) != CStr::from_ptr(DESCRIPTOR.0.id) {
        return ptr::null();
    }
    let data = Box::into_raw(Box::new(Knob { host, gain: 1.0, editor: None, pending: None }));
    Box::into_raw(Box::new(clap_plugin {
        desc: &DESCRIPTOR.0,
        plugin_data: data as *mut c_void,
        init: Some(plugin_init),
        destroy: Some(plugin_destroy),
        activate: Some(plugin_activate),
        deactivate: Some(plugin_nothing),
        start_processing: Some(plugin_true),
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
