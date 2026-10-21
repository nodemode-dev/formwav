//! S17 phase C, P5: a plug-in's own editor opened from the app. `fwhost edit clap <plugin> <state-in|-> <state-out>
//! [seconds]` makes the plug-in, gives it its saved state, opens its editor in an X11 window of its own and drives the
//! editor (its timers and its connection's descriptors, through CLAP's timer-support and posix-fd-support) until the
//! window is closed, a line `close` (or the end) arrives on standard input, or the seconds run out; then it asks the
//! plug-in to settle what the editor set (clap.params flush) and writes the plug-in's state to <state-out>. The engine
//! runs it with a pipe on standard input, so the app's Done closes it.

use std::ffi::{c_void, CStr};
use std::path::Path;
use std::ptr;
use std::time::{Duration, Instant};

use clap_sys::events::{clap_event_header, clap_input_events, clap_output_events};
use clap_sys::ext::gui::{clap_plugin_gui, clap_window, clap_window_handle, CLAP_EXT_GUI, CLAP_WINDOW_API_X11};
use clap_sys::ext::params::{clap_plugin_params, CLAP_EXT_PARAMS};
use clap_sys::ext::posix_fd_support::{clap_plugin_posix_fd_support, CLAP_EXT_POSIX_FD_SUPPORT, CLAP_POSIX_FD_ERROR, CLAP_POSIX_FD_READ, CLAP_POSIX_FD_WRITE};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::ext::timer_support::{clap_plugin_timer_support, CLAP_EXT_TIMER_SUPPORT};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::version::CLAP_VERSION;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, CreateWindowAux, EventMask, PropMode, WindowClass};
use x11rb::protocol::Event as XEvent;
use x11rb::wrapper::ConnectionExt as _;

unsafe extern "C" fn none_size(_list: *const clap_input_events) -> u32 {
    0
}

unsafe extern "C" fn none_get(_list: *const clap_input_events, _index: u32) -> *const clap_event_header {
    ptr::null()
}

/// What ended the editing: the window closed, the app's close, or the time.
pub struct Edited {
    pub state: Vec<u8>,
    pub why: &'static str,
    pub size: (u32, u32),
    pub window: u32,
}

/// Opens the CLAP plug-in's editor (`file.clap#index` for a bundle's others) with `state_in` loaded, until closed.
pub fn edit_clap(path: &Path, state_in: Option<&[u8]>, seconds: f64) -> Result<Edited, String> {
    let text = path.to_string_lossy();
    let (file, index) = match text.rsplit_once('#') {
        Some((f, n)) if n.parse::<u32>().is_ok() => (Path::new(f).to_path_buf(), n.parse::<u32>().unwrap_or(0)),
        _ => (path.to_path_buf(), 0),
    };
    unsafe {
        let (lib, entry) = crate::offline::clap_open(&file)?;
        let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
        if factory.is_null() {
            return Err("no plugin factory".into());
        }
        let desc = ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, index);
        if desc.is_null() {
            return Err("the file holds no such plugin".into());
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
        let ext = |id: &CStr| ((*plugin).get_extension.unwrap())(plugin, id.as_ptr());
        let state = (ext(CLAP_EXT_STATE) as *const clap_plugin_state).as_ref().ok_or("the plugin keeps no state, so nothing set in its editor could be kept")?;
        if let Some(bytes) = state_in {
            let mut reader = crate::params::StateReader { bytes, at: 0 };
            let stream = clap_sys::stream::clap_istream { ctx: &mut reader as *mut crate::params::StateReader as *mut c_void, read: Some(crate::params::state_read) };
            if !(state.load.ok_or("no state load")?)(plugin, &stream) {
                return Err("the plugin refused the saved state".into());
            }
        }
        let gui = (ext(CLAP_EXT_GUI) as *const clap_plugin_gui).as_ref().ok_or("the plugin has no editor of its own")?;
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
        conn.create_window(x11rb::COPY_DEPTH_FROM_PARENT, win, screen.root, 40, 40, width.max(1) as u16, height.max(1) as u16, 0, WindowClass::INPUT_OUTPUT, 0, &CreateWindowAux::new().background_pixel(screen.black_pixel).event_mask(EventMask::STRUCTURE_NOTIFY))
            .map_err(|e| e.to_string())?;
        let title = format!("{} (formwav)", CStr::from_ptr((*desc).name).to_string_lossy());
        conn.change_property8(PropMode::REPLACE, win, AtomEnum::WM_NAME, AtomEnum::STRING, title.as_bytes()).map_err(|e| e.to_string())?;
        // the window manager's close button sends WM_DELETE_WINDOW rather than destroying the window
        let protocols = conn.intern_atom(false, b"WM_PROTOCOLS").map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?.atom;
        let delete = conn.intern_atom(false, b"WM_DELETE_WINDOW").map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?.atom;
        conn.change_property32(PropMode::REPLACE, win, protocols, AtomEnum::ATOM, &[delete]).map_err(|e| e.to_string())?;
        conn.map_window(win).map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        let parent = clap_window { api: CLAP_WINDOW_API_X11.as_ptr(), specific: clap_window_handle { x11: win as std::ffi::c_ulong } };
        if !(gui.set_parent.ok_or("gui without set_parent")?)(plugin, &parent) {
            return Err("the editor would not take the window".into());
        }
        (gui.show.ok_or("gui without show")?)(plugin);
        eprintln!("fwhost: editor {width}x{height} in X11 window 0x{win:x}");
        let timer_ext = (ext(CLAP_EXT_TIMER_SUPPORT) as *const clap_plugin_timer_support).as_ref();
        let fd_ext = (ext(CLAP_EXT_POSIX_FD_SUPPORT) as *const clap_plugin_posix_fd_support).as_ref();
        let deadline = Instant::now() + Duration::from_secs_f64(seconds.max(1.0));
        let mut why = "time";
        let mut line = Vec::new();
        'run: while Instant::now() < deadline {
            let fds: Vec<(i32, u32)> = crate::FDS.lock().unwrap().clone();
            let mut polls: Vec<libc::pollfd> = fds
                .iter()
                .map(|(fd, flags)| libc::pollfd {
                    fd: *fd,
                    events: (if flags & CLAP_POSIX_FD_READ != 0 { libc::POLLIN } else { 0 }) | (if flags & CLAP_POSIX_FD_WRITE != 0 { libc::POLLOUT } else { 0 }),
                    revents: 0,
                })
                .collect();
            polls.push(libc::pollfd { fd: 0, events: libc::POLLIN, revents: 0 });
            libc::poll(polls.as_mut_ptr(), polls.len() as libc::nfds_t, 5);
            let stdin = polls.pop().map_or(0, |p| p.revents);
            if stdin != 0 {
                let mut buf = [0u8; 256];
                let n = libc::read(0, buf.as_mut_ptr() as *mut c_void, buf.len());
                if n <= 0 {
                    why = "input closed";
                    break 'run;
                }
                line.extend_from_slice(&buf[..n as usize]);
                if line.split(|b| *b == b'\n').any(|l| l.trim_ascii() == b"close") {
                    why = "closed from the app";
                    break 'run;
                }
            }
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
                }
            }
            let now = Instant::now();
            let due: Vec<u32> = crate::TIMERS
                .lock()
                .unwrap()
                .iter_mut()
                .filter(|t| now >= t.2)
                .map(|t| {
                    t.2 = now + Duration::from_millis(t.1 as u64);
                    t.0
                })
                .collect();
            if let Some(on_timer) = timer_ext.and_then(|e| e.on_timer) {
                for id in due {
                    on_timer(plugin, id);
                }
            }
            while let Ok(Some(event)) = conn.poll_for_event() {
                match event {
                    XEvent::ClientMessage(m) if m.data.as_data32()[0] == delete => {
                        why = "window closed";
                        break 'run;
                    }
                    XEvent::DestroyNotify(d) if d.window == win => {
                        why = "window closed";
                        break 'run;
                    }
                    _ => {}
                }
            }
        }
        (gui.hide.ok_or("gui without hide")?)(plugin);
        (gui.destroy.ok_or("gui without destroy")?)(plugin);
        let _ = conn.destroy_window(win);
        let _ = conn.flush();
        // CLAP: a plug-in that is not processing settles its parameters on a flush, before its state is read
        if let Some(flush) = (ext(CLAP_EXT_PARAMS) as *const clap_plugin_params).as_ref().and_then(|p| p.flush) {
            let in_events = clap_input_events { ctx: ptr::null_mut(), size: Some(none_size), get: Some(none_get) };
            let out_events = clap_output_events { ctx: ptr::null_mut(), try_push: Some(crate::no_events_push) };
            flush(plugin, &in_events, &out_events);
        }
        let mut saved = Vec::new();
        let stream = clap_sys::stream::clap_ostream { ctx: &mut saved as *mut Vec<u8> as *mut c_void, write: Some(crate::params::state_write) };
        if !(state.save.ok_or("no state save")?)(plugin, &stream) {
            return Err("the plugin would not save its state".into());
        }
        ((*plugin).destroy.ok_or("no destroy")?)(plugin);
        ((*entry).deinit.ok_or("no deinit")?)();
        drop(lib);
        Ok(Edited { state: saved, why, size: (width, height), window: win })
    }
}
