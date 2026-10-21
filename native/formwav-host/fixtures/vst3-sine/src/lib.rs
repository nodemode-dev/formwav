//! A VST3 test instrument for formwav-host (S17): no audio input, one event input, a stereo output; each note-on starts
//! a sine at the key's pitch from its own sample offset within the block (velocity sets its level, 0.25 at full), and a
//! note-off ends it at its offset after a 2 ms fade. Its factory gives the Instrument subcategory (IPluginFactory2), as
//! a host reading class infos finds instruments. Built on the vst3 crate (vst3 0.3.0, MIT OR Apache-2.0) after its gain
//! example, by the same pattern as fixtures/vst3-gain. Not part of formwav; built only to be hosted.

#![allow(non_snake_case)]

use std::cell::RefCell;
use std::ffi::{c_char, c_void, CString};
use std::slice;

use vst3::{uid, Class, ComRef, ComWrapper, Steinberg::Vst::*, Steinberg::*};

fn copy_cstring(src: &str, dst: &mut [c_char]) {
    let c_string = CString::new(src).unwrap_or_default();
    let bytes = c_string.as_bytes_with_nul();
    for (s, d) in bytes.iter().zip(dst.iter_mut()) {
        *d = *s as c_char;
    }
    if bytes.len() > dst.len() {
        if let Some(last) = dst.last_mut() {
            *last = 0;
        }
    }
}

fn copy_wstring(src: &str, dst: &mut [TChar]) {
    let mut len = 0;
    for (s, d) in src.encode_utf16().zip(dst.iter_mut()) {
        *d = s as TChar;
        len += 1;
    }
    if len < dst.len() {
        dst[len] = 0;
    }
}

const PLUGIN_NAME: &str = "formwav test sine (VST3)";
const FADE_S: f64 = 0.002;

#[derive(Clone, Copy)]
struct Voice {
    key: i16,
    phase: f64,
    step: f64,
    level: f32,
    /// samples left of the fade out, once released (None while held)
    left: Option<u32>,
}

struct SineProcessor {
    rate: RefCell<f64>,
    voices: RefCell<Vec<Voice>>,
}

impl Class for SineProcessor {
    type Interfaces = (IComponent, IAudioProcessor);
}

impl SineProcessor {
    const CID: TUID = uid(0x3B5C1F20, 0x7A0E4C11, 0x9D2B6E44, 0x51A0F7C3);
}

impl IPluginBaseTrait for SineProcessor {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

impl IComponentTrait for SineProcessor {
    unsafe fn getControllerClassId(&self, _class_id: *mut TUID) -> tresult {
        kResultFalse
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    unsafe fn getBusCount(&self, media_type: MediaType, dir: BusDirection) -> i32 {
        match (media_type as MediaTypes, dir as BusDirections) {
            (MediaTypes_::kAudio, BusDirections_::kOutput) => 1,
            (MediaTypes_::kEvent, BusDirections_::kInput) => 1,
            _ => 0,
        }
    }

    unsafe fn getBusInfo(&self, media_type: MediaType, dir: BusDirection, index: i32, bus: *mut BusInfo) -> tresult {
        if index != 0 {
            return kInvalidArgument;
        }
        let bus = &mut *bus;
        match (media_type as MediaTypes, dir as BusDirections) {
            (MediaTypes_::kAudio, BusDirections_::kOutput) => {
                bus.mediaType = MediaTypes_::kAudio as MediaType;
                bus.direction = BusDirections_::kOutput as BusDirection;
                bus.channelCount = 2;
                copy_wstring("Output", &mut bus.name);
            }
            (MediaTypes_::kEvent, BusDirections_::kInput) => {
                bus.mediaType = MediaTypes_::kEvent as MediaType;
                bus.direction = BusDirections_::kInput as BusDirection;
                bus.channelCount = 1;
                copy_wstring("Notes", &mut bus.name);
            }
            _ => return kInvalidArgument,
        }
        bus.busType = BusTypes_::kMain as BusType;
        bus.flags = BusInfo_::BusFlags_::kDefaultActive as u32;
        kResultOk
    }

    unsafe fn getRoutingInfo(&self, _in_info: *mut RoutingInfo, _out_info: *mut RoutingInfo) -> tresult {
        kNotImplemented
    }

    unsafe fn activateBus(&self, _media_type: MediaType, _dir: BusDirection, _index: i32, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setActive(&self, _state: TBool) -> tresult {
        self.voices.borrow_mut().clear();
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }
}

impl IAudioProcessorTrait for SineProcessor {
    unsafe fn setBusArrangements(&self, _inputs: *mut SpeakerArrangement, num_ins: i32, outputs: *mut SpeakerArrangement, num_outs: i32) -> tresult {
        if num_ins == 0 && num_outs == 1 && *outputs == SpeakerArr::kStereo {
            kResultTrue
        } else {
            kResultFalse
        }
    }

    unsafe fn getBusArrangement(&self, dir: BusDirection, index: i32, arr: *mut SpeakerArrangement) -> tresult {
        if dir as BusDirections == BusDirections_::kOutput && index == 0 {
            *arr = SpeakerArr::kStereo;
            kResultOk
        } else {
            kInvalidArgument
        }
    }

    unsafe fn canProcessSampleSize(&self, size: i32) -> tresult {
        if size as SymbolicSampleSizes == SymbolicSampleSizes_::kSample32 {
            kResultOk
        } else {
            kNotImplemented
        }
    }

    unsafe fn getLatencySamples(&self) -> u32 {
        0
    }

    unsafe fn setupProcessing(&self, setup: *mut ProcessSetup) -> tresult {
        *self.rate.borrow_mut() = (*setup).sampleRate;
        kResultOk
    }

    unsafe fn setProcessing(&self, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        let data = &*data;
        let n = data.numSamples as usize;
        if data.numOutputs < 1 {
            return kResultOk;
        }
        let out_bus = &*data.outputs;
        if out_bus.numChannels != 2 {
            return kResultOk;
        }
        let chans = slice::from_raw_parts(out_bus.__field0.channelBuffers32, 2);
        let (left, right) = (slice::from_raw_parts_mut(chans[0], n), slice::from_raw_parts_mut(chans[1], n));
        // the block's note events in offset order
        let mut events: Vec<(i32, bool, i16, f32)> = Vec::new();
        if let Some(list) = ComRef::from_raw(data.inputEvents) {
            for i in 0..list.getEventCount() {
                let mut e: Event = std::mem::zeroed();
                if list.getEvent(i, &mut e) != kResultOk {
                    continue;
                }
                match e.r#type as u32 {
                    t if t == Event_::EventTypes_::kNoteOnEvent as u32 => events.push((e.sampleOffset, true, e.__field0.noteOn.pitch, e.__field0.noteOn.velocity)),
                    t if t == Event_::EventTypes_::kNoteOffEvent as u32 => events.push((e.sampleOffset, false, e.__field0.noteOff.pitch, 0.0)),
                    _ => {}
                }
            }
        }
        events.sort_by_key(|e| (e.0, e.1));
        let rate = *self.rate.borrow();
        let fade = (FADE_S * rate) as u32;
        let mut voices = self.voices.borrow_mut();
        let mut next = 0;
        for i in 0..n {
            while next < events.len() && events[next].0 as usize <= i {
                let (_, on, key, velocity) = events[next];
                if on && velocity > 0.0 {
                    let hz = 440.0 * 2f64.powf((key as f64 - 69.0) / 12.0);
                    voices.push(Voice { key, phase: 0.0, step: hz / rate, level: 0.25 * velocity, left: None });
                } else {
                    for v in voices.iter_mut().filter(|v| v.key == key && v.left.is_none()) {
                        v.left = Some(fade);
                    }
                }
                next += 1;
            }
            let mut s = 0.0f32;
            for v in voices.iter_mut() {
                let env = match v.left {
                    Some(k) => k as f32 / fade.max(1) as f32,
                    None => 1.0,
                };
                s += v.level * env * (2.0 * std::f64::consts::PI * v.phase).sin() as f32;
                v.phase = (v.phase + v.step).fract();
                if let Some(k) = v.left.as_mut() {
                    *k = k.saturating_sub(1);
                }
            }
            voices.retain(|v| v.left != Some(0));
            left[i] = s;
            right[i] = s;
        }
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> u32 {
        0
    }
}

struct Factory {}

impl Class for Factory {
    type Interfaces = (IPluginFactory2,);
}

impl IPluginFactoryTrait for Factory {
    unsafe fn getFactoryInfo(&self, info: *mut PFactoryInfo) -> tresult {
        let info = &mut *info;
        copy_cstring("formwav test", &mut info.vendor);
        copy_cstring("https://example.com", &mut info.url);
        copy_cstring("test@example.com", &mut info.email);
        info.flags = PFactoryInfo_::FactoryFlags_::kUnicode as int32;
        kResultOk
    }

    unsafe fn countClasses(&self) -> i32 {
        1
    }

    unsafe fn getClassInfo(&self, index: i32, info: *mut PClassInfo) -> tresult {
        if index != 0 {
            return kInvalidArgument;
        }
        let info = &mut *info;
        info.cid = SineProcessor::CID;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy_cstring("Audio Module Class", &mut info.category);
        copy_cstring(PLUGIN_NAME, &mut info.name);
        kResultOk
    }

    unsafe fn createInstance(&self, cid: FIDString, iid: FIDString, obj: *mut *mut c_void) -> tresult {
        if *(cid as *const TUID) != SineProcessor::CID {
            return kInvalidArgument;
        }
        let instance = ComWrapper::new(SineProcessor { rate: RefCell::new(48000.0), voices: RefCell::new(Vec::new()) }).to_com_ptr::<FUnknown>().unwrap();
        let ptr = instance.as_ptr();
        ((*(*ptr).vtbl).queryInterface)(ptr, iid as *mut TUID, obj)
    }
}

impl IPluginFactory2Trait for Factory {
    unsafe fn getClassInfo2(&self, index: i32, info: *mut PClassInfo2) -> tresult {
        if index != 0 {
            return kInvalidArgument;
        }
        let info = &mut *info;
        info.cid = SineProcessor::CID;
        info.cardinality = PClassInfo_::ClassCardinality_::kManyInstances as int32;
        copy_cstring("Audio Module Class", &mut info.category);
        copy_cstring(PLUGIN_NAME, &mut info.name);
        info.classFlags = 0;
        copy_cstring("Instrument|Synth", &mut info.subCategories);
        copy_cstring("formwav test", &mut info.vendor);
        copy_cstring("1.0", &mut info.version);
        copy_cstring("VST 3.7", &mut info.sdkVersion);
        kResultOk
    }
}

#[cfg(target_os = "windows")]
#[no_mangle]
extern "system" fn InitDll() -> bool {
    true
}

#[cfg(target_os = "windows")]
#[no_mangle]
extern "system" fn ExitDll() -> bool {
    true
}

#[cfg(target_os = "macos")]
#[no_mangle]
extern "system" fn BundleEntry(_bundle_ref: *mut c_void) -> bool {
    true
}

#[cfg(target_os = "macos")]
#[no_mangle]
extern "system" fn BundleExit() -> bool {
    true
}

#[cfg(target_os = "linux")]
#[no_mangle]
extern "system" fn ModuleEntry(_library_handle: *mut c_void) -> bool {
    true
}

#[cfg(target_os = "linux")]
#[no_mangle]
extern "system" fn ModuleExit() -> bool {
    true
}

#[no_mangle]
extern "system" fn GetPluginFactory() -> *mut IPluginFactory {
    ComWrapper::new(Factory {}).to_com_ptr::<IPluginFactory>().unwrap().into_raw()
}
