//! S17: hosted plug-ins live, in the engine's own process (feature "native"; never the browser's WebAssembly): a CLAP
//! effect as an insert on a bus's chain (a track's own bus), so it plays during native output and in the export through
//! the same player. It is made, given its saved state and values, and activated off the audio thread; it starts
//! processing on the audio thread at its first block and reports its latency, which the player reads ahead by (delay
//! compensation). Unlike an offline render through fwhost, a live plug-in that crashes takes the engine with it.

use std::collections::HashMap;
use std::ffi::{c_char, c_void, CString};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::Mutex;

use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{clap_event_header, clap_event_param_value, clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::{clap_process, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;

/// The most frames handed to a plug-in at once; a longer block is split.
pub const MAX_BLOCK: usize = 4096;

/// A loaded CLAP library and its entry, shared by every instance from it: a library's entry is initialised once and
/// deinitialised after its last instance goes.
struct Loaded {
    _lib: libloading::Library,
    entry: *const clap_plugin_entry,
    users: usize,
}

// SAFETY: the entry pointer is only used under LOADED's lock or by instances that hold a use of it.
unsafe impl Send for Loaded {}

static LOADED: Mutex<Option<HashMap<PathBuf, Loaded>>> = Mutex::new(None);

/// A CLAP file, or the binary inside a CLAP bundle (macOS).
fn binary(path: &Path) -> Result<PathBuf, String> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    let inner = path.join("Contents").join("MacOS");
    std::fs::read_dir(&inner).ok().and_then(|mut d| d.find_map(|e| e.ok().map(|e| e.path()))).ok_or_else(|| format!("{} has no binary", path.display()))
}

unsafe fn acquire(path: &Path) -> Result<*const clap_plugin_entry, String> {
    let mut guard = LOADED.lock().unwrap_or_else(|p| p.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(l) = map.get_mut(path) {
        l.users += 1;
        return Ok(l.entry);
    }
    let bin = binary(path)?;
    let lib = libloading::Library::new(&bin).map_err(|e| format!("could not load {}: {e}", bin.display()))?;
    let entry = *lib.get::<*const clap_plugin_entry>(b"clap_entry\0").map_err(|e| format!("no clap_entry: {e}"))?;
    let c_path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    if !((*entry).init.ok_or("entry without init")?)(c_path.as_ptr()) {
        return Err("the plug-in's entry refused to initialise".into());
    }
    map.insert(path.to_path_buf(), Loaded { _lib: lib, entry, users: 1 });
    Ok(entry)
}

unsafe fn release(path: &Path) {
    let mut guard = LOADED.lock().unwrap_or_else(|p| p.into_inner());
    let Some(map) = guard.as_mut() else { return };
    let last = match map.get_mut(path) {
        Some(l) => {
            l.users -= 1;
            l.users == 0
        }
        None => false,
    };
    if last {
        if let Some(l) = map.remove(path) {
            if let Some(deinit) = (*l.entry).deinit {
                deinit();
            }
        }
    }
}

unsafe extern "C" fn host_get_extension(_host: *const clap_host, _id: *const c_char) -> *const c_void {
    ptr::null()
}

unsafe extern "C" fn host_request(_host: *const clap_host) {}

/// The chosen values as param-value events, delivered with the first block only.
struct Values {
    events: Vec<clap_event_param_value>,
    live: bool,
}

unsafe extern "C" fn values_size(list: *const clap_input_events) -> u32 {
    let v = &*((*list).ctx as *const Values);
    if v.live {
        v.events.len() as u32
    } else {
        0
    }
}

unsafe extern "C" fn values_get(list: *const clap_input_events, index: u32) -> *const clap_event_header {
    let v = &*((*list).ctx as *const Values);
    v.events.get(index as usize).map_or(ptr::null(), |e| &e.header as *const clap_event_header)
}

unsafe extern "C" fn no_push(_list: *const clap_output_events, _event: *const clap_event_header) -> bool {
    false
}

unsafe extern "C" fn state_read(stream: *const clap_sys::stream::clap_istream, buffer: *mut c_void, size: u64) -> i64 {
    let (bytes, at) = &mut *((*stream).ctx as *mut (&[u8], usize));
    let n = (size as usize).min(bytes.len() - *at);
    ptr::copy_nonoverlapping(bytes.as_ptr().add(*at), buffer as *mut u8, n);
    *at += n;
    n as i64
}

unsafe extern "C" fn state_write(stream: *const clap_sys::stream::clap_ostream, buffer: *const c_void, size: u64) -> i64 {
    let out = &mut *((*stream).ctx as *mut Vec<u8>);
    out.extend_from_slice(std::slice::from_raw_parts(buffer as *const u8, size as usize));
    size as i64
}

/// What an insert was made from, as the key a rebuilt mix finds it by: the path, the values and the saved state.
pub fn key(path: &str, state: Option<&[u8]>, values: &[(u32, f64)]) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    state.hash(&mut h);
    for (id, v) in values {
        id.hash(&mut h);
        v.to_bits().hash(&mut h);
    }
    format!("{path}|{:016x}", h.finish())
}

/// A CLAP effect live on a bus's chain.
pub struct ClapInsert {
    key: String,
    path: PathBuf,
    plugin: *const clap_plugin,
    _host: Box<clap_host>,
    values: Box<Values>,
    started: bool,
    failed: bool,
    latency: usize,
    input: [Vec<f32>; 2],
    output: [Vec<f32>; 2],
    steady: i64,
}

// SAFETY: the instance is made on one thread and then used by one thread at a time (the player's owner under its
// lock, or the audio callback), as CLAP's threading allows for a host without a separate main thread.
unsafe impl Send for ClapInsert {}

impl ClapInsert {
    /// The plug-in at `path` (a .clap file or bundle; a bundle's other plug-ins as `file.clap#1`) at `rate`: its saved
    /// state loaded, its values set (delivered with the first block), activated for blocks of up to MAX_BLOCK frames.
    pub fn open(path: &str, rate: f32, state: Option<&[u8]>, values: &[(u32, f64)]) -> Result<ClapInsert, String> {
        let (file, index) = match path.rsplit_once('#') {
            Some((file, n)) if n.parse::<u32>().is_ok() => (PathBuf::from(file), n.parse::<u32>().unwrap_or(0)),
            _ => (PathBuf::from(path), 0),
        };
        unsafe {
            let entry = acquire(&file)?;
            match Self::make(entry, &file, index, rate, state, values) {
                Ok(mut made) => {
                    made.key = key(path, state, values);
                    Ok(made)
                }
                Err(e) => {
                    release(&file);
                    Err(e)
                }
            }
        }
    }

    unsafe fn make(entry: *const clap_plugin_entry, file: &Path, index: u32, rate: f32, state: Option<&[u8]>, values: &[(u32, f64)]) -> Result<ClapInsert, String> {
        let factory = ((*entry).get_factory.ok_or("no get_factory")?)(CLAP_PLUGIN_FACTORY_ID.as_ptr()) as *const clap_plugin_factory;
        if factory.is_null() {
            return Err("no plug-in factory".into());
        }
        let desc = ((*factory).get_plugin_descriptor.ok_or("no descriptors")?)(factory, index);
        if desc.is_null() {
            return Err("the file holds no such plug-in".into());
        }
        let host = Box::new(clap_host {
            clap_version: CLAP_VERSION,
            host_data: ptr::null_mut(),
            name: c"formwav".as_ptr(),
            vendor: c"nodemode-ai".as_ptr(),
            url: c"https://github.com/nodemode-ai/formwav".as_ptr(),
            version: c"1".as_ptr(),
            get_extension: Some(host_get_extension),
            request_restart: Some(host_request),
            request_process: Some(host_request),
            request_callback: Some(host_request),
        });
        let plugin = ((*factory).create_plugin.ok_or("no create")?)(factory, &*host, (*desc).id);
        if plugin.is_null() {
            return Err("the plug-in could not be made".into());
        }
        let destroy = |e: String| {
            if let Some(d) = (*plugin).destroy {
                d(plugin);
            }
            Err(e)
        };
        if !((*plugin).init.ok_or("no init")?)(plugin) {
            return destroy("the plug-in would not initialise".into());
        }
        if let Some(bytes) = state {
            let ext = ((*plugin).get_extension.ok_or("no get_extension")?)(plugin, clap_sys::ext::state::CLAP_EXT_STATE.as_ptr()) as *const clap_sys::ext::state::clap_plugin_state;
            let Some(load) = ext.as_ref().and_then(|e| e.load) else {
                return destroy("the plug-in keeps no state".into());
            };
            let mut ctx: (&[u8], usize) = (bytes, 0);
            let stream = clap_sys::stream::clap_istream { ctx: &mut ctx as *mut (&[u8], usize) as *mut c_void, read: Some(state_read) };
            if !load(plugin, &stream) {
                return destroy("the plug-in refused the saved state".into());
            }
        }
        if !((*plugin).activate.ok_or("no activate")?)(plugin, f64::from(rate), 1, MAX_BLOCK as u32) {
            return destroy("the plug-in would not activate".into());
        }
        let latency_ext = ((*plugin).get_extension.ok_or("no get_extension")?)(plugin, clap_sys::ext::latency::CLAP_EXT_LATENCY.as_ptr()) as *const clap_sys::ext::latency::clap_plugin_latency;
        let latency = latency_ext.as_ref().and_then(|e| e.get).map_or(0, |get| get(plugin) as usize);
        let events = values
            .iter()
            .map(|&(id, value)| clap_event_param_value {
                header: clap_event_header { size: std::mem::size_of::<clap_event_param_value>() as u32, time: 0, space_id: CLAP_CORE_EVENT_SPACE_ID, type_: CLAP_EVENT_PARAM_VALUE, flags: 0 },
                param_id: id,
                cookie: ptr::null_mut(),
                note_id: -1,
                port_index: -1,
                channel: -1,
                key: -1,
                value,
            })
            .collect();
        Ok(ClapInsert {
            key: String::new(),
            path: file.to_path_buf(),
            plugin,
            _host: host,
            values: Box::new(Values { events, live: true }),
            started: false,
            failed: false,
            latency,
            input: [vec![0.0; MAX_BLOCK], vec![0.0; MAX_BLOCK]],
            output: [vec![0.0; MAX_BLOCK], vec![0.0; MAX_BLOCK]],
            steady: 0,
        })
    }

    /// The plug-in's state now (for the session to keep), or None when it keeps none.
    pub fn save_state(&self) -> Option<Vec<u8>> {
        unsafe {
            let ext = ((*self.plugin).get_extension?)(self.plugin, clap_sys::ext::state::CLAP_EXT_STATE.as_ptr()) as *const clap_sys::ext::state::clap_plugin_state;
            let save = ext.as_ref()?.save?;
            let mut out = Vec::new();
            let stream = clap_sys::stream::clap_ostream { ctx: &mut out as *mut Vec<u8> as *mut c_void, write: Some(state_write) };
            save(self.plugin, &stream).then_some(out)
        }
    }

    unsafe fn run(&mut self, left: &mut [f32], right: &mut [f32]) -> bool {
        let n = left.len().min(right.len()).min(MAX_BLOCK);
        self.input[0][..n].copy_from_slice(&left[..n]);
        self.input[1][..n].copy_from_slice(&right[..n]);
        let mut in_ptrs = [self.input[0].as_mut_ptr(), self.input[1].as_mut_ptr()];
        let mut out_ptrs = [self.output[0].as_mut_ptr(), self.output[1].as_mut_ptr()];
        let in_buf = clap_audio_buffer { data32: in_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
        let mut out_buf = clap_audio_buffer { data32: out_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
        let in_events = clap_input_events { ctx: &*self.values as *const Values as *mut c_void, size: Some(values_size), get: Some(values_get) };
        let out_events = clap_output_events { ctx: ptr::null_mut(), try_push: Some(no_push) };
        let process = clap_process {
            steady_time: self.steady,
            frames_count: n as u32,
            transport: ptr::null(),
            audio_inputs: &in_buf,
            audio_outputs: &mut out_buf,
            audio_inputs_count: 1,
            audio_outputs_count: 1,
            in_events: &in_events,
            out_events: &out_events,
        };
        let Some(process_fn) = (*self.plugin).process else { return false };
        if process_fn(self.plugin, &process) == CLAP_PROCESS_ERROR {
            return false;
        }
        self.values.live = false;
        self.steady += n as i64;
        left[..n].copy_from_slice(&self.output[0][..n]);
        right[..n].copy_from_slice(&self.output[1][..n]);
        true
    }
}

impl crate::fx::Insert for ClapInsert {
    /// In place, in pieces of up to MAX_BLOCK frames; a plug-in that would not start or failed passes the signal through.
    fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.failed {
            return;
        }
        unsafe {
            if !self.started {
                // CLAP starts processing on the audio thread, so at the first block rather than on activation
                match (*self.plugin).start_processing {
                    Some(start) if start(self.plugin) => self.started = true,
                    _ => {
                        self.failed = true;
                        return;
                    }
                }
            }
            let n = left.len().min(right.len());
            let mut at = 0;
            while at < n {
                let m = (n - at).min(MAX_BLOCK);
                if !self.run(&mut left[at..at + m], &mut right[at..at + m]) {
                    self.failed = true;
                    return;
                }
                at += m;
            }
        }
    }

    fn latency(&self) -> usize {
        self.latency
    }

    /// A seek or a loop's wrap: the plug-in forgets what it held (its tails, its delay lines).
    fn reset(&mut self) {
        if self.started {
            unsafe {
                if let Some(reset) = (*self.plugin).reset {
                    reset(self.plugin);
                }
            }
        }
    }

    fn key(&self) -> &str {
        &self.key
    }
}

impl Drop for ClapInsert {
    fn drop(&mut self) {
        unsafe {
            if self.started {
                if let Some(stop) = (*self.plugin).stop_processing {
                    stop(self.plugin);
                }
            }
            if let Some(deactivate) = (*self.plugin).deactivate {
                deactivate(self.plugin);
            }
            if let Some(destroy) = (*self.plugin).destroy {
                destroy(self.plugin);
            }
            release(&self.path);
        }
    }
}
