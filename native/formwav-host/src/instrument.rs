//! PT-15: a CLAP instrument played offline. Notes go in as note-on and note-off events on their frames (each block's
//! events carry their offsets within it), the plugin has no audio input, and its stereo output is what comes back.

use std::ffi::c_void;
use std::path::Path;
use std::ptr;

use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::events::{clap_event_header, clap_event_note, clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_NOTE_OFF, CLAP_EVENT_NOTE_ON};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::process::{clap_process, CLAP_PROCESS_ERROR};
use clap_sys::version::CLAP_VERSION;

use crate::offline::BLOCK;

/// A note: its first frame, its length in frames, its MIDI key and its velocity (1 to 127).
pub type Note = (u64, u64, u8, u8);

/// Notes as lines of `start length key velocity` (frames), blank lines and `#` comments skipped.
pub fn parse(text: &str) -> Result<Vec<Note>, String> {
    let mut notes = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let v: Vec<&str> = line.split_whitespace().collect();
        if v.len() != 4 {
            return Err(format!("a note is `start length key velocity`: {line}"));
        }
        let n = |i: usize| v[i].parse::<u64>().map_err(|_| format!("not a whole number: {}", v[i]));
        notes.push((n(0)?, n(1)?.max(1), n(2)?.min(127) as u8, n(3)?.clamp(1, 127) as u8));
    }
    Ok(notes)
}

struct Events {
    events: Vec<clap_event_note>,
}

unsafe extern "C" fn events_size(list: *const clap_input_events) -> u32 {
    (*((*list).ctx as *const Events)).events.len() as u32
}

unsafe extern "C" fn events_get(list: *const clap_input_events, index: u32) -> *const clap_event_header {
    let events = &*((*list).ctx as *const Events);
    events.events.get(index as usize).map_or(ptr::null(), |e| &e.header as *const clap_event_header)
}

fn note_event(kind: u16, at: u32, key: u8, velocity: u8) -> clap_event_note {
    clap_event_note {
        header: clap_event_header { size: std::mem::size_of::<clap_event_note>() as u32, time: at, space_id: CLAP_CORE_EVENT_SPACE_ID, type_: kind, flags: 0 },
        note_id: -1,
        port_index: 0,
        channel: 0,
        key: key as i16,
        velocity: velocity as f64 / 127.0,
    }
}

/// Plays `notes` on the CLAP instrument at `path` (`file.clap#index` for a bundle's others) for `frames` frames.
pub fn render(path: &Path, rate: u32, notes: &[Note], frames: usize) -> Result<[Vec<f32>; 2], String> {
    // every note's on and off, in time order (offs first at a shared frame, so a repeated key restarts cleanly)
    let mut timeline: Vec<(u64, u16, u8, u8)> = notes.iter().flat_map(|&(start, length, key, velocity)| [(start, CLAP_EVENT_NOTE_ON, key, velocity), (start + length, CLAP_EVENT_NOTE_OFF, key, 0)]).collect();
    timeline.sort_by_key(|e| (e.0, e.1 == CLAP_EVENT_NOTE_ON));
    unsafe {
        let text = path.to_string_lossy();
        let (path, index) = match text.rsplit_once('#') {
            Some((file, n)) if n.parse::<u32>().is_ok() => (Path::new(file).to_path_buf(), n.parse::<u32>().unwrap_or(0)),
            _ => (path.to_path_buf(), 0),
        };
        let (lib, entry) = crate::offline::clap_open(&path)?;
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
        if !((*plugin).activate.ok_or("no activate")?)(plugin, rate as f64, 1, BLOCK as u32) || !((*plugin).start_processing.ok_or("no start_processing")?)(plugin) {
            return Err("the plugin would not start".into());
        }
        let mut out = [vec![0f32; frames], vec![0f32; frames]];
        let (o0, o1) = (out[0].as_mut_ptr(), out[1].as_mut_ptr());
        let out_events = clap_output_events { ctx: ptr::null_mut(), try_push: Some(crate::no_events_push) };
        let (mut pos, mut next) = (0usize, 0usize);
        while pos < frames {
            let n = BLOCK.min(frames - pos);
            let mut block = Events { events: Vec::new() };
            while next < timeline.len() && (timeline[next].0 as usize) < pos + n {
                let (at, kind, key, velocity) = timeline[next];
                block.events.push(note_event(kind, (at as usize).saturating_sub(pos) as u32, key, velocity));
                next += 1;
            }
            let in_events = clap_input_events { ctx: &block as *const Events as *mut c_void, size: Some(events_size), get: Some(events_get) };
            let mut out_ptrs = [o0.add(pos), o1.add(pos)];
            let mut out_buf = clap_audio_buffer { data32: out_ptrs.as_mut_ptr(), data64: ptr::null_mut(), channel_count: 2, latency: 0, constant_mask: 0 };
            let process = clap_process {
                steady_time: pos as i64,
                frames_count: n as u32,
                transport: ptr::null(),
                audio_inputs: ptr::null(),
                audio_outputs: &mut out_buf,
                audio_inputs_count: 0,
                audio_outputs_count: 1,
                in_events: &in_events,
                out_events: &out_events,
            };
            if ((*plugin).process.ok_or("no process")?)(plugin, &process) == CLAP_PROCESS_ERROR {
                return Err(format!("the instrument failed at frame {pos}"));
            }
            pos += n;
        }
        ((*plugin).stop_processing.ok_or("no stop_processing")?)(plugin);
        ((*plugin).deactivate.ok_or("no deactivate")?)(plugin);
        ((*plugin).destroy.ok_or("no destroy")?)(plugin);
        ((*entry).deinit.ok_or("no deinit")?)();
        drop(lib);
        Ok(out)
    }
}
