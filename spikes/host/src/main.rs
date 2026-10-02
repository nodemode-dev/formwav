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
use clap_sys::ext::gui::{clap_host_gui, clap_plugin_gui, clap_window, clap_window_handle, CLAP_EXT_GUI, CLAP_WINDOW_API_X11};
use clap_sys::ext::posix_fd_support::{clap_host_posix_fd_support, clap_plugin_posix_fd_support, CLAP_EXT_POSIX_FD_SUPPORT, CLAP_POSIX_FD_ERROR, CLAP_POSIX_FD_READ, CLAP_POSIX_FD_WRITE};
use clap_sys::ext::timer_support::{clap_host_timer_support, clap_plugin_timer_support, CLAP_EXT_TIMER_SUPPORT};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::process::{clap_process, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;

use vst3::Steinberg::Vst::{
    AudioBusBuffers, AudioBusBuffers__type0, BusDirections_, IAudioProcessor, IAudioProcessorTrait, IComponent, IComponentTrait, IHostApplication, IHostApplicationTrait, MediaTypes_, ProcessData,
    ProcessModes_, ProcessSetup, SpeakerArr, String128, SymbolicSampleSizes_,
};
use vst3::Steinberg::{kNotImplemented, kResultOk, tresult, FUnknown, IPluginBaseTrait, IPluginFactory, IPluginFactoryTrait, PClassInfo, TUID};
use vst3::{Class, ComPtr, ComWrapper, Interface};

struct HostApplication;

impl Class for HostApplication {
    type Interfaces = (IHostApplication,);
}

impl IHostApplicationTrait for HostApplication {
    unsafe fn getName(&self, name: *mut String128) -> tresult {
        let name = &mut *name;
        let text: Vec<u16> = "formwav".encode_utf16().collect();
        name[..text.len()].copy_from_slice(&text);
        name[text.len()] = 0;
        kResultOk
    }

    unsafe fn createInstance(&self, _cid: *mut TUID, _iid: *mut TUID, obj: *mut *mut c_void) -> tresult {
        *obj = ptr::null_mut();
        kNotImplemented
    }
}

// The VST3 editor's frame, which on Linux is also its run loop: the view registers its X11 descriptor and its timers
// here, and the host calls them back (Steinberg::Linux::IRunLoop, queried from the IPlugFrame).
struct EditorFrame {
    handlers: std::cell::RefCell<Vec<(vst3::ComPtr<vst3::Steinberg::Linux::IEventHandler>, i32)>>,
    timers: std::cell::RefCell<Vec<(vst3::ComPtr<vst3::Steinberg::Linux::ITimerHandler>, u64, std::time::Instant)>>,
}

impl Class for EditorFrame {
    type Interfaces = (vst3::Steinberg::IPlugFrame, vst3::Steinberg::Linux::IRunLoop);
}

impl vst3::Steinberg::IPlugFrameTrait for EditorFrame {
    unsafe fn resizeView(&self, view: *mut vst3::Steinberg::IPlugView, new_size: *mut vst3::Steinberg::ViewRect) -> tresult {
        use vst3::Steinberg::IPlugViewTrait;
        if let Some(view) = vst3::ComRef::from_raw(view) {
            view.onSize(new_size);
        }
        kResultOk
    }
}

impl vst3::Steinberg::Linux::IRunLoopTrait for EditorFrame {
    unsafe fn registerEventHandler(&self, handler: *mut vst3::Steinberg::Linux::IEventHandler, fd: vst3::Steinberg::Linux::FileDescriptor) -> tresult {
        if let Some(handler) = vst3::ComRef::from_raw(handler) {
            self.handlers.borrow_mut().push((handler.to_com_ptr(), fd));
        }
        kResultOk
    }

    unsafe fn unregisterEventHandler(&self, handler: *mut vst3::Steinberg::Linux::IEventHandler) -> tresult {
        self.handlers.borrow_mut().retain(|(h, _)| h.as_ptr() != handler);
        kResultOk
    }

    unsafe fn registerTimer(&self, handler: *mut vst3::Steinberg::Linux::ITimerHandler, milliseconds: vst3::Steinberg::Linux::TimerInterval) -> tresult {
        if let Some(handler) = vst3::ComRef::from_raw(handler) {
            self.timers.borrow_mut().push((handler.to_com_ptr(), milliseconds.max(1), std::time::Instant::now()));
        }
        kResultOk
    }

    unsafe fn unregisterTimer(&self, handler: *mut vst3::Steinberg::Linux::ITimerHandler) -> tresult {
        self.timers.borrow_mut().retain(|(h, _, _)| h.as_ptr() != handler);
        kResultOk
    }
}

const RATE: f64 = 48_000.0;
const FRAMES: usize = 4_800;
const BLOCKS: usize = 10;

fn blocks() -> usize {
    std::env::var("FWHOST_BLOCKS").ok().and_then(|v| v.parse().ok()).unwrap_or(BLOCKS)
}

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

// The host's run loop for plugin editors: on Linux a plugin's GUI draws from timers and from its X11 connection's
// file descriptor, both of which the host must drive (CLAP's timer-support and posix-fd-support extensions).
static TIMERS: std::sync::Mutex<Vec<(u32, u32, std::time::Instant)>> = std::sync::Mutex::new(Vec::new());
static FDS: std::sync::Mutex<Vec<(i32, u32)>> = std::sync::Mutex::new(Vec::new());

unsafe extern "C" fn register_timer(_host: *const clap_host, period_ms: u32, timer_id: *mut u32) -> bool {
    let mut timers = TIMERS.lock().unwrap();
    let id = timers.iter().map(|t| t.0 + 1).max().unwrap_or(1);
    timers.push((id, period_ms.max(1), std::time::Instant::now()));
    *timer_id = id;
    true
}

unsafe extern "C" fn unregister_timer(_host: *const clap_host, timer_id: u32) -> bool {
    TIMERS.lock().unwrap().retain(|t| t.0 != timer_id);
    true
}

unsafe extern "C" fn register_fd(_host: *const clap_host, fd: i32, flags: u32) -> bool {
    FDS.lock().unwrap().push((fd, flags));
    true
}

unsafe extern "C" fn modify_fd(_host: *const clap_host, fd: i32, flags: u32) -> bool {
    FDS.lock().unwrap().iter_mut().filter(|f| f.0 == fd).for_each(|f| f.1 = flags);
    true
}

unsafe extern "C" fn unregister_fd(_host: *const clap_host, fd: i32) -> bool {
    FDS.lock().unwrap().retain(|f| f.0 != fd);
    true
}

unsafe extern "C" fn gui_nothing(_host: *const clap_host) {}

unsafe extern "C" fn gui_yes(_host: *const clap_host) -> bool {
    true
}

unsafe extern "C" fn gui_resize(_host: *const clap_host, _width: u32, _height: u32) -> bool {
    true
}

unsafe extern "C" fn gui_closed(_host: *const clap_host, _was_destroyed: bool) {}

static HOST_TIMERS: clap_host_timer_support = clap_host_timer_support { register_timer: Some(register_timer), unregister_timer: Some(unregister_timer) };
static HOST_FDS: clap_host_posix_fd_support = clap_host_posix_fd_support { register_fd: Some(register_fd), modify_fd: Some(modify_fd), unregister_fd: Some(unregister_fd) };
static HOST_GUI: clap_host_gui = clap_host_gui {
    resize_hints_changed: Some(gui_nothing),
    request_resize: Some(gui_resize),
    request_show: Some(gui_yes),
    request_hide: Some(gui_yes),
    closed: Some(gui_closed),
};

unsafe extern "C" fn host_get_extension(_host: *const clap_host, id: *const c_char) -> *const c_void {
    let id = CStr::from_ptr(id);
    if id == CLAP_EXT_TIMER_SUPPORT {
        &HOST_TIMERS as *const clap_host_timer_support as *const c_void
    } else if id == CLAP_EXT_POSIX_FD_SUPPORT {
        &HOST_FDS as *const clap_host_posix_fd_support as *const c_void
    } else if id == CLAP_EXT_GUI {
        &HOST_GUI as *const clap_host_gui as *const c_void
    } else {
        ptr::null()
    }
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
        // Ten consecutive blocks with the clock advancing, as a DAW would run it: real plugins ramp parameters in and
        // carry latency, so the first block is reported beside the last, settled one.
        let mut status = CLAP_PROCESS_ERROR + 1;
        let mut first_db = 0.0;
        for block in 0..blocks() {
            let process = clap_process {
                steady_time: (block * FRAMES) as i64,
                frames_count: FRAMES as u32,
                transport: ptr::null(),
                audio_inputs: &in_buf,
                audio_outputs: &mut out_buf,
                audio_inputs_count: 1,
                audio_outputs_count: 1,
                in_events: &in_events,
                out_events: &out_events,
            };
            let s = ((*plugin).process.ok_or("plugin without process")?)(plugin, &process);
            if s == CLAP_PROCESS_ERROR {
                status = s;
            }
            if block == 0 {
                first_db = (rms_db(&output[0]) + rms_db(&output[1])) / 2.0;
            }
        }
        eprintln!("fwhost: first block {first_db:.2} dB RMS out, last block below");
        ((*plugin).stop_processing.ok_or("no stop_processing")?)(plugin);
        ((*plugin).deactivate.ok_or("no deactivate")?)(plugin);
        ((*plugin).destroy.ok_or("no destroy")?)(plugin);
        (entry.deinit.ok_or("entry without deinit")?)();
        report("clap", &id, &name, found, ports, status != CLAP_PROCESS_ERROR, &input, &output);
        Ok(())
    }
}

fn run_clap_gui(path: &str, seconds: f64) -> Result<(), String> {
    use std::time::{Duration, Instant};
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, CreateWindowAux, PropMode, WindowClass};
    use x11rb::wrapper::ConnectionExt as _;
    unsafe {
        let lib = libloading::Library::new(path).map_err(|e| format!("could not load {path}: {e}"))?;
        let entry: libloading::Symbol<*const clap_plugin_entry> = lib.get(b"clap_entry\0").map_err(|e| format!("no clap_entry: {e}"))?;
        let entry = &**entry;
        let c_path = CString::new(path).unwrap();
        if !(entry.init.ok_or("entry without init")?)(c_path.as_ptr()) {
            return Err("the plugin's entry refused to initialise".into());
        }
        let factory = (entry.get_factory.ok_or("entry without get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
        let desc = ((*factory).get_plugin_descriptor.ok_or("factory without descriptors")?)(factory, 0);
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
        let ext = |id: &CStr| ((*plugin).get_extension.unwrap())(plugin, id.as_ptr());
        let gui = (ext(CLAP_EXT_GUI) as *const clap_plugin_gui).as_ref().ok_or("the plugin has no editor (no clap.gui)")?;
        if !(gui.is_api_supported.ok_or("gui without is_api_supported")?)(plugin, CLAP_WINDOW_API_X11.as_ptr(), false) {
            return Err("the editor cannot embed in an X11 window".into());
        }
        if !(gui.create.ok_or("gui without create")?)(plugin, CLAP_WINDOW_API_X11.as_ptr(), false) {
            return Err("the editor would not be created".into());
        }
        let (mut width, mut height) = (0u32, 0u32);
        (gui.get_size.ok_or("gui without get_size")?)(plugin, &mut width, &mut height);
        let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("no X display: {e}"))?;
        let screen = &conn.setup().roots[screen_num];
        let win = conn.generate_id().map_err(|e| e.to_string())?;
        conn.create_window(x11rb::COPY_DEPTH_FROM_PARENT, win, screen.root, 40, 40, width.max(1) as u16, height.max(1) as u16, 0, WindowClass::INPUT_OUTPUT, 0, &CreateWindowAux::new().background_pixel(screen.black_pixel))
            .map_err(|e| e.to_string())?;
        conn.change_property8(PropMode::REPLACE, win, AtomEnum::WM_NAME, AtomEnum::STRING, b"formwav plugin editor").map_err(|e| e.to_string())?;
        conn.map_window(win).map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        let parent = clap_window { api: CLAP_WINDOW_API_X11.as_ptr(), specific: clap_window_handle { x11: win as std::ffi::c_ulong } };
        if !(gui.set_parent.ok_or("gui without set_parent")?)(plugin, &parent) {
            return Err("the editor would not take the window".into());
        }
        let shown = (gui.show.ok_or("gui without show")?)(plugin);
        eprintln!("fwhost: editor {width}x{height} in X11 window 0x{win:x}, shown {shown}");
        let timer_ext = (ext(CLAP_EXT_TIMER_SUPPORT) as *const clap_plugin_timer_support).as_ref();
        let fd_ext = (ext(CLAP_EXT_POSIX_FD_SUPPORT) as *const clap_plugin_posix_fd_support).as_ref();
        let deadline = Instant::now() + Duration::from_secs_f64(seconds);
        let (mut timer_calls, mut fd_calls) = (0u64, 0u64);
        while Instant::now() < deadline {
            let fds: Vec<(i32, u32)> = FDS.lock().unwrap().clone();
            let mut polls: Vec<libc::pollfd> = fds
                .iter()
                .map(|(fd, flags)| libc::pollfd {
                    fd: *fd,
                    events: (if flags & CLAP_POSIX_FD_READ != 0 { libc::POLLIN } else { 0 }) | (if flags & CLAP_POSIX_FD_WRITE != 0 { libc::POLLOUT } else { 0 }),
                    revents: 0,
                })
                .collect();
            libc::poll(polls.as_mut_ptr(), polls.len() as libc::nfds_t, 5);
            if let Some(on_fd) = fd_ext.and_then(|e| e.on_fd) {
                for p in polls.iter().filter(|p| p.revents != 0) {
                    let mut flags = 0;
                    if p.revents & libc::POLLIN != 0 {
                        flags |= CLAP_POSIX_FD_READ;
                    }
                    if p.revents & libc::POLLOUT != 0 {
                        flags |= CLAP_POSIX_FD_WRITE;
                    }
                    if p.revents & (libc::POLLERR | libc::POLLHUP) != 0 {
                        flags |= CLAP_POSIX_FD_ERROR;
                    }
                    on_fd(plugin, p.fd, flags);
                    fd_calls += 1;
                }
            }
            let now = Instant::now();
            let due: Vec<u32> = TIMERS.lock().unwrap().iter_mut().filter(|t| now >= t.2).map(|t| {
                t.2 = now + Duration::from_millis(t.1 as u64);
                t.0
            }).collect();
            if let Some(on_timer) = timer_ext.and_then(|e| e.on_timer) {
                for id in due {
                    on_timer(plugin, id);
                    timer_calls += 1;
                }
            }
            while let Ok(Some(_)) = conn.poll_for_event() {}
        }
        let (timers, fds) = (TIMERS.lock().unwrap().len(), FDS.lock().unwrap().len());
        (gui.hide.ok_or("gui without hide")?)(plugin);
        (gui.destroy.ok_or("gui without destroy")?)(plugin);
        conn.destroy_window(win).map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        ((*plugin).destroy.ok_or("no destroy")?)(plugin);
        (entry.deinit.ok_or("entry without deinit")?)();
        println!("{{\"format\": \"clap\", \"editor\": true, \"size\": [{width}, {height}], \"shown\": {shown}, \"timers\": {timers}, \"fds\": {fds}, \"timer_calls\": {timer_calls}, \"fd_calls\": {fd_calls}}}");
        Ok(())
    }
}

fn run_vst3_gui(path: &str, seconds: f64) -> Result<(), String> {
    use std::time::{Duration, Instant};
    use vst3::Steinberg::Linux::{IEventHandlerTrait, ITimerHandlerTrait};
    use vst3::Steinberg::Vst::{IConnectionPoint, IConnectionPointTrait, IEditController, IEditControllerTrait};
    use vst3::Steinberg::{kPlatformTypeX11EmbedWindowID, kResultTrue, IPlugFrame, IPlugViewTrait, ViewRect};
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, CreateWindowAux, PropMode, WindowClass};
    use x11rb::wrapper::ConnectionExt as _;
    unsafe {
        let binary = vst3_binary(path)?;
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
        let mut cid: Option<TUID> = None;
        for index in 0..factory.countClasses() {
            let mut info: PClassInfo = std::mem::zeroed();
            if factory.getClassInfo(index, &mut info) == kResultOk && CStr::from_ptr(info.category.as_ptr()).to_bytes() == b"Audio Module Class" {
                cid = Some(info.cid);
                break;
            }
        }
        let cid = cid.ok_or("the module holds no audio effect")?;
        let mut obj: *mut c_void = ptr::null_mut();
        if factory.createInstance(cid.as_ptr(), IComponent::IID.as_ptr() as *const c_char, &mut obj) != kResultOk {
            return Err("the factory would not create the component".into());
        }
        let component = ComPtr::from_raw(obj as *mut IComponent).ok_or("no component")?;
        let host = ComWrapper::new(HostApplication);
        let context = host.to_com_ptr::<IHostApplication>().ok_or("host context")?;
        component.initialize(context.as_ptr() as *mut FUnknown);
        let (controller, separate) = match component.cast::<IEditController>() {
            Some(controller) => (controller, false),
            None => {
                let mut controller_cid: TUID = [0; 16];
                if component.getControllerClassId(&mut controller_cid) != kResultOk {
                    return Err("the component names no edit controller".into());
                }
                let mut obj: *mut c_void = ptr::null_mut();
                factory.createInstance(controller_cid.as_ptr(), IEditController::IID.as_ptr() as *const c_char, &mut obj);
                let controller = ComPtr::from_raw(obj as *mut IEditController).ok_or("the factory would not create the edit controller")?;
                controller.initialize(context.as_ptr() as *mut FUnknown);
                (controller, true)
            }
        };
        let points = (component.cast::<IConnectionPoint>(), controller.cast::<IConnectionPoint>());
        if let (Some(a), Some(b)) = (&points.0, &points.1) {
            a.connect(b.as_ptr());
            b.connect(a.as_ptr());
        }
        let view = ComPtr::from_raw(controller.createView(c"editor".as_ptr())).ok_or("the controller made no editor view")?;
        if view.isPlatformTypeSupported(kPlatformTypeX11EmbedWindowID) != kResultTrue {
            return Err("the editor cannot embed in an X11 window".into());
        }
        let frame = ComWrapper::new(EditorFrame { handlers: Default::default(), timers: Default::default() });
        let frame_ptr = frame.to_com_ptr::<IPlugFrame>().ok_or("frame")?;
        view.setFrame(frame_ptr.as_ptr());
        let mut rect: ViewRect = std::mem::zeroed();
        view.getSize(&mut rect);
        let (width, height) = ((rect.right - rect.left).max(1) as u16, (rect.bottom - rect.top).max(1) as u16);
        let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("no X display: {e}"))?;
        let screen = &conn.setup().roots[screen_num];
        let win = conn.generate_id().map_err(|e| e.to_string())?;
        conn.create_window(x11rb::COPY_DEPTH_FROM_PARENT, win, screen.root, 40, 40, width, height, 0, WindowClass::INPUT_OUTPUT, 0, &CreateWindowAux::new().background_pixel(screen.black_pixel))
            .map_err(|e| e.to_string())?;
        conn.change_property8(PropMode::REPLACE, win, AtomEnum::WM_NAME, AtomEnum::STRING, b"formwav plugin editor (VST3)").map_err(|e| e.to_string())?;
        conn.map_window(win).map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        if view.attached(win as usize as *mut c_void, kPlatformTypeX11EmbedWindowID) != kResultOk {
            return Err("the editor would not attach to the window".into());
        }
        eprintln!("fwhost: VST3 editor {width}x{height} in X11 window 0x{win:x} (controller {})", if separate { "separate" } else { "in the component" });
        let deadline = Instant::now() + Duration::from_secs_f64(seconds);
        let (mut timer_calls, mut fd_calls) = (0u64, 0u64);
        while Instant::now() < deadline {
            let handlers: Vec<_> = frame.handlers.borrow().iter().map(|(h, fd)| (h.clone(), *fd)).collect();
            let mut polls: Vec<libc::pollfd> = handlers.iter().map(|(_, fd)| libc::pollfd { fd: *fd, events: libc::POLLIN, revents: 0 }).collect();
            libc::poll(polls.as_mut_ptr(), polls.len() as libc::nfds_t, 5);
            for (p, (h, fd)) in polls.iter().zip(&handlers) {
                if p.revents != 0 {
                    h.onFDIsSet(*fd);
                    fd_calls += 1;
                }
            }
            let now = Instant::now();
            let due: Vec<_> = frame.timers.borrow_mut().iter_mut().filter(|t| now >= t.2).map(|t| {
                t.2 = now + Duration::from_millis(t.1);
                t.0.clone()
            }).collect();
            for t in due {
                t.onTimer();
                timer_calls += 1;
            }
            while let Ok(Some(_)) = conn.poll_for_event() {}
        }
        let (timers, fds) = (frame.timers.borrow().len(), frame.handlers.borrow().len());
        view.removed();
        view.setFrame(ptr::null_mut());
        drop(view);
        if let (Some(a), Some(b)) = (&points.0, &points.1) {
            a.disconnect(b.as_ptr());
            b.disconnect(a.as_ptr());
        }
        drop(points);
        conn.destroy_window(win).map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        if separate {
            controller.terminate();
        }
        drop(controller);
        component.terminate();
        drop(component);
        drop(factory);
        if let Ok(exit) = lib.get::<unsafe extern "C" fn() -> bool>(b"ModuleExit\0") {
            exit();
        }
        println!("{{\"format\": \"vst3\", \"editor\": true, \"size\": [{width}, {height}], \"separate_controller\": {separate}, \"timers\": {timers}, \"fds\": {fds}, \"timer_calls\": {timer_calls}, \"fd_calls\": {fd_calls}}}");
        Ok(())
    }
}

fn vst3_binary(path: &str) -> Result<std::path::PathBuf, String> {
    let bundle = std::path::Path::new(path);
    if bundle.is_file() {
        return Ok(bundle.to_path_buf());
    }
    let dir = bundle.join("Contents").join(format!("{}-linux", std::env::consts::ARCH));
    std::fs::read_dir(&dir)
        .map_err(|e| format!("{} is not a VST3 bundle with a Linux binary: {e}", path))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.extension().is_some_and(|x| x == "so"))
        .ok_or_else(|| format!("no .so in {}", dir.display()))
}

fn run_vst3(path: &str) -> Result<(), String> {
    unsafe {
        let binary = vst3_binary(path)?;
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
        let classes = factory.countClasses();
        let mut found: Option<(TUID, String)> = None;
        for index in 0..classes {
            let mut info: PClassInfo = std::mem::zeroed();
            if factory.getClassInfo(index, &mut info) == kResultOk && CStr::from_ptr(info.category.as_ptr()).to_bytes() == b"Audio Module Class" {
                found = Some((info.cid, CStr::from_ptr(info.name.as_ptr()).to_string_lossy().into_owned()));
                break;
            }
        }
        let (cid, name) = found.ok_or("the module holds no audio effect")?;
        let mut obj: *mut c_void = ptr::null_mut();
        if factory.createInstance(cid.as_ptr(), IComponent::IID.as_ptr() as *const c_char, &mut obj) != kResultOk || obj.is_null() {
            return Err("the factory would not create the component".into());
        }
        let component = ComPtr::from_raw(obj as *mut IComponent).ok_or("no component")?;
        let host = ComWrapper::new(HostApplication);
        let context = host.to_com_ptr::<IHostApplication>().ok_or("host context")?;
        if component.initialize(context.as_ptr() as *mut FUnknown) != kResultOk {
            return Err("the component would not initialise".into());
        }
        let processor = component.cast::<IAudioProcessor>().ok_or("the component is not an audio processor")?;
        let ports = (component.getBusCount(MediaTypes_::kAudio as i32, BusDirections_::kInput as i32) as u32, component.getBusCount(MediaTypes_::kAudio as i32, BusDirections_::kOutput as i32) as u32);
        let mut ins = [SpeakerArr::kStereo];
        let mut outs = [SpeakerArr::kStereo];
        processor.setBusArrangements(ins.as_mut_ptr(), 1, outs.as_mut_ptr(), 1);
        component.activateBus(MediaTypes_::kAudio as i32, BusDirections_::kInput as i32, 0, 1);
        component.activateBus(MediaTypes_::kAudio as i32, BusDirections_::kOutput as i32, 0, 1);
        let mut setup = ProcessSetup { processMode: ProcessModes_::kRealtime as i32, symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32, maxSamplesPerBlock: FRAMES as i32, sampleRate: RATE };
        if processor.setupProcessing(&mut setup) != kResultOk || component.setActive(1) != kResultOk {
            return Err("the processor would not set up or activate".into());
        }
        processor.setProcessing(1);
        let input = test_signal();
        let mut output = [vec![0f32; FRAMES], vec![0f32; FRAMES]];
        let mut in_ptrs = [input[0].as_ptr() as *mut f32, input[1].as_ptr() as *mut f32];
        let mut out_ptrs = [output[0].as_mut_ptr(), output[1].as_mut_ptr()];
        let mut in_bus = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: in_ptrs.as_mut_ptr() } };
        let mut out_bus = AudioBusBuffers { numChannels: 2, silenceFlags: 0, __field0: AudioBusBuffers__type0 { channelBuffers32: out_ptrs.as_mut_ptr() } };
        let mut ok = true;
        let mut first_db = 0.0;
        for block in 0..blocks() {
            let mut data = ProcessData {
                processMode: ProcessModes_::kRealtime as i32,
                symbolicSampleSize: SymbolicSampleSizes_::kSample32 as i32,
                numSamples: FRAMES as i32,
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
            ok &= processor.process(&mut data) == kResultOk;
            if block == 0 {
                first_db = (rms_db(&output[0]) + rms_db(&output[1])) / 2.0;
            }
        }
        eprintln!("fwhost: first block {first_db:.2} dB RMS out, last block below");
        processor.setProcessing(0);
        component.setActive(0);
        component.terminate();
        drop(processor);
        drop(component);
        drop(factory);
        if let Ok(exit) = lib.get::<unsafe extern "C" fn() -> bool>(b"ModuleExit\0") {
            exit();
        }
        let id: String = cid.iter().map(|b| format!("{:02X}", *b as u8)).collect();
        report("vst3", &id, &name, classes as u32, ports, ok, &input, &output);
        Ok(())
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = match (args.get(1).map(String::as_str), args.get(2)) {
        (Some("clap"), Some(path)) => run_clap(path),
        (Some("vst3"), Some(path)) => run_vst3(path),
        (Some("clap-gui"), Some(path)) => run_clap_gui(path, args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5.0)),
        (Some("vst3-gui"), Some(path)) => run_vst3_gui(path, args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5.0)),
        _ => Err("usage: fwhost clap <plugin.clap> | fwhost vst3 <plugin.vst3> | fwhost clap-gui <plugin.clap> [seconds]".into()),
    };
    if let Err(message) = result {
        eprintln!("fwhost: {message}");
        std::process::exit(1);
    }
}
