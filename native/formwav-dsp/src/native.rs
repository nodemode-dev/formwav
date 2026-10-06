//! Native audio output (feature "native"): formwav's Player, the mixer the browser runs as WebAssembly in its
//! AudioWorklet, rendered into a device's output stream through cpal (Apache-2.0). It is configured by the same "clips"
//! message the worklet receives (clips with their envelopes and effects, buses with their stages, master stages and
//! level, the end) and reports what the worklet reports (position, playing, peaks, track and bus peaks, loudness), so
//! the interface can drive either the same way. The stream lives on its own thread (a cpal stream may not move between
//! threads on some systems); the caller holds only the shared mixer state and a way to stop that thread. The audio
//! callback never waits: if the state is busy being changed it plays one block of silence.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Deserialize;

use crate::render::{Bus, PlayClip, Player};
use crate::wav::AudioBuffer;

const MAX_TRACKS: usize = 64;
const MAX_BUSES: usize = 32;

pub struct Shared {
    pub player: Player,
    pub playing: bool,
    pub end: u64,
    /// Set by the audio callback when playback runs to the end; the next report carries it once.
    pub ended: bool,
}

pub struct NativeOutput {
    shared: Arc<Mutex<Shared>>,
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
    pub rate: u32,
    pub device: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MixClip {
    source: u32,
    start: f64,
    source_in: f64,
    length: f64,
    gain: f32,
    pan: f32,
    fade_in: f64,
    fade_out: f64,
    fade_shape: u8,
    bus: u32,
    track: u32,
    #[serde(default)]
    gain_points: Option<Vec<f64>>,
    #[serde(default)]
    pan_points: Option<Vec<f64>>,
    #[serde(default)]
    fx: Option<Vec<f32>>,
    /// The filters' parameter automation (PT-19), as the browser worklet receives it.
    #[serde(default)]
    fx_auto: Option<Vec<FxAuto>>,
    /// PT-33: the clip's own compressor, [filters ahead of it, threshold dB, ratio, attack ms, release ms, makeup dB].
    #[serde(default)]
    comp: Option<Vec<f32>>,
}

#[derive(Deserialize)]
struct FxAuto {
    stage: usize,
    param: u8,
    points: Vec<f64>,
}

#[derive(Deserialize)]
struct MixBus {
    id: u32,
    gain: f32,
    pan: f32,
    #[serde(default)]
    stages: Option<Vec<f32>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mix {
    clips: Vec<MixClip>,
    #[serde(default)]
    buses: Vec<MixBus>,
    #[serde(default)]
    master_fx: Option<Vec<f32>>,
    #[serde(default)]
    master_db: f64,
    #[serde(default)]
    end: f64,
    /// PT-38, AA-11: placed clips as records of seven (the clip's index, then its speaker gains in SMPTE order).
    #[serde(default)]
    places: Option<Vec<f32>>,
    /// Whether the session hears its 5.1 as the bus folded to stereo.
    #[serde(default)]
    fold: bool,
    /// PT-42: the bus's format, 0 for 5.1 and 1 for first-order ambisonics.
    #[serde(default)]
    surround_format: u8,
}

/// AU-23: the hosts devices are offered from, each with the prefix its devices' names carry: the platform's default
/// (Core Audio, WASAPI, ALSA) and, in a build with the opt-in `asio` feature on Windows, ASIO ("ASIO: " before its
/// devices). The default build leaves ASIO out entirely, so it needs no ASIO SDK and stays Apache-2.0; a build that opts
/// in links Steinberg's ASIO SDK under its own licence (GPLv3 or Steinberg's).
fn hosts() -> Vec<(&'static str, cpal::Host)> {
    #[cfg(all(windows, feature = "asio"))]
    let asio: Vec<(&'static str, cpal::Host)> = cpal::host_from_id(cpal::HostId::Asio).map(|h| vec![("ASIO: ", h)]).unwrap_or_default();
    #[cfg(not(all(windows, feature = "asio")))]
    let asio: Vec<(&'static str, cpal::Host)> = Vec::new();
    // ASIO first: its prefix is checked before the default host's empty one when a name is looked up
    asio.into_iter().chain(std::iter::once(("", cpal::default_host()))).collect()
}

/// The output devices of every host offered, by name (an ASIO device's with "ASIO: " before it).
pub fn devices() -> Vec<String> {
    hosts()
        .into_iter()
        .flat_map(|(prefix, host)| host.output_devices().map(|ds| ds.filter_map(|d| d.description().ok().map(|n| format!("{prefix}{n}"))).collect::<Vec<_>>()).unwrap_or_default())
        .collect()
}

/// AU-23: the output stream in the device's sample type `T`: the player renders float frames as before (silence while
/// stopped) and write_frames puts them in the buffer.
fn build_stream<T: cpal::SizedSample + cpal::FromSample<f32>>(dev: &cpal::Device, config: cpal::StreamConfig, channels: usize, state: Arc<Mutex<Shared>>) -> Result<cpal::Stream, cpal::Error> {
    let (mut left, mut right) = (vec![0f32; 1 << 16], vec![0f32; 1 << 16]);
    dev.build_output_stream(
        config,
        move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
            let frames = (data.len() / channels).min(left.len());
            let rendered = match state.try_lock() {
                Ok(mut s) if s.playing => {
                    s.player.render(&mut left[..frames], &mut right[..frames]);
                    if s.end > 0 && s.player.position() >= s.end {
                        s.playing = false;
                        s.ended = true;
                    }
                    true
                }
                _ => false,
            };
            if !rendered {
                data.fill(<T as cpal::Sample>::EQUILIBRIUM);
                return;
            }
            write_frames(data, channels, &left, &right, frames);
        },
        |err| eprintln!("formwav native output: {err}"),
        None,
    )
}

/// AU-23: the rendered stereo frames written into an output buffer of any sample type, interleaved over its channels
/// (left on the even ones, right on the odd); ASIO drivers mostly take 32-bit integers, some devices 16-bit.
fn write_frames<T: cpal::SizedSample + cpal::FromSample<f32>>(data: &mut [T], channels: usize, left: &[f32], right: &[f32], frames: usize) {
    for (i, frame) in data.chunks_mut(channels).enumerate().take(frames) {
        for (c, sample) in frame.iter_mut().enumerate() {
            *sample = T::from_sample(if c % 2 == 0 { left[i] } else { right[i] });
        }
    }
}

impl NativeOutput {
    /// Opens `device` (by name; the default output when None) at `rate` and starts its stream, silent until play.
    pub fn open(device: Option<String>, rate: u32) -> Result<NativeOutput, String> {
        let mut player = Player::new();
        player.set_rate(rate as f32);
        let shared = Arc::new(Mutex::new(Shared { player, playing: false, end: 0, ended: false }));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<String, String>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let state = shared.clone();
        let thread = std::thread::Builder::new()
            .name("formwav-native-output".into())
            .spawn(move || {
                let opened = (|| -> Result<(cpal::Stream, String), String> {
                    // AU-23: by name across the hosts offered (an ASIO device's carries "ASIO: "), else the default
                    let (prefix, dev) = match &device {
                        Some(want) => hosts()
                            .into_iter()
                            .find_map(|(prefix, host)| {
                                let bare = want.strip_prefix(prefix)?;
                                host.output_devices().ok()?.find(|d| d.description().map(|n| n.to_string() == bare).unwrap_or(false)).map(|d| (prefix, d))
                            })
                            .ok_or(format!("no output device named {want}"))?,
                        None => ("", cpal::default_host().default_output_device().ok_or("no default output device")?),
                    };
                    let name = format!("{prefix}{}", dev.description().map(|n| n.to_string()).unwrap_or_default());
                    let base = dev.default_output_config().map_err(|e| e.to_string())?;
                    let channels = base.channels().max(1) as usize;
                    let config = cpal::StreamConfig { channels: base.channels(), sample_rate: rate, buffer_size: cpal::BufferSize::Default };
                    // AU-23: written in the device's own sample type (ASIO drivers mostly take 32-bit integers)
                    let stream = match base.sample_format() {
                        cpal::SampleFormat::F32 => build_stream::<f32>(&dev, config, channels, state.clone()),
                        cpal::SampleFormat::I32 => build_stream::<i32>(&dev, config, channels, state.clone()),
                        cpal::SampleFormat::I16 => build_stream::<i16>(&dev, config, channels, state.clone()),
                        other => return Err(format!("{name} takes {other} samples, which formwav does not write")),
                    }
                    .map_err(|e| format!("could not open {name} at {rate} Hz: {e}"))?;
                    stream.play().map_err(|e| e.to_string())?;
                    Ok((stream, name))
                })();
                match opened {
                    Ok((stream, name)) => {
                        let _ = ready_tx.send(Ok(name));
                        let _ = stop_rx.recv();
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        let device = ready_rx.recv().map_err(|_| "the output thread ended before opening".to_string())??;
        Ok(NativeOutput { shared, stop: stop_tx, thread: Some(thread), rate, device })
    }

    fn with<R>(&self, f: impl FnOnce(&mut Shared) -> R) -> R {
        let mut guard = self.shared.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut guard)
    }

    pub fn load_source(&self, id: u32, sample_rate: u32, channels: Vec<Vec<f32>>) {
        self.with(|s| s.player.load_source(id, AudioBuffer { sample_rate, channels }));
    }

    /// The worklet's "clips" message: clips with their envelopes and effects, buses and their stages, master stages
    /// and level, and the end.
    pub fn set_mix(&self, json: &str) -> Result<(), String> {
        let mix: Mix = serde_json::from_str(json).map_err(|e| format!("not a mix: {e}"))?;
        self.with(|s| {
            let p = &mut s.player;
            p.clear_clips();
            p.clear_envelopes();
            let envelope = |p: &mut Player, flat: &Option<Vec<f64>>, db: bool| -> u32 {
                match flat {
                    Some(f) if f.len() >= 2 => {
                        let points: Vec<(u64, f64)> = f.chunks_exact(2).map(|c| (c[0].max(0.0) as u64, c[1])).collect();
                        p.add_envelope(&points, db)
                    }
                    _ => 0,
                }
            };
            for c in &mix.clips {
                let gain_env = envelope(p, &c.gain_points, true);
                let pan_env = envelope(p, &c.pan_points, false);
                p.add_clip(PlayClip {
                    source: c.source,
                    start: c.start.max(0.0) as u64,
                    source_in: c.source_in.max(0.0) as u64,
                    length: c.length.max(0.0) as u64,
                    gain: c.gain,
                    pan: c.pan,
                    fade_in: c.fade_in.max(0.0) as u64,
                    fade_out: c.fade_out.max(0.0) as u64,
                    fade_shape: c.fade_shape,
                    bus: c.bus,
                    track: c.track,
                    gain_env,
                    pan_env,
                });
                // PT-33: the clip's own compressor after `at` of its filters
                let comp = c.comp.as_deref().filter(|v| v.len() == 6);
                let filters: Vec<&[f32]> = c.fx.as_deref().unwrap_or(&[]).chunks_exact(4).collect();
                for i in 0..=filters.len() {
                    if let Some(v) = comp {
                        if i == (v[0].max(0.0) as usize).min(filters.len()) {
                            p.add_clip_comp(v[1], v[2], v[3], v[4], v[5]);
                        }
                    }
                    if let Some(k) = filters.get(i) {
                        p.add_clip_fx(k[0] as u8, k[1], k[2], k[3]);
                    }
                }
                for a in c.fx_auto.as_deref().unwrap_or(&[]) {
                    let env = envelope(p, &Some(a.points.clone()), false);
                    if env > 0 {
                        p.add_clip_fx_auto(a.stage, a.param, env);
                    }
                }
            }
            p.clear_buses();
            for b in &mix.buses {
                p.add_bus(Bus { id: b.id, gain: b.gain, pan: b.pan });
                for st in b.stages.as_deref().unwrap_or(&[]).chunks_exact(6) {
                    p.add_bus_stage(st[0] as u8, st[1], st[2], st[3], st[4], st[5]);
                }
            }
            p.clear_master_fx();
            for st in mix.master_fx.as_deref().unwrap_or(&[]).chunks_exact(6) {
                p.add_master_stage(st[0] as u8, st[1], st[2], st[3], st[4], st[5]);
            }
            p.set_master_db(mix.master_db);
            // PT-38, AA-11: the placements and fold mode after the master chain, as the worklet applies them
            let records: &[f32] = if mix.fold { mix.places.as_deref().unwrap_or(&[]) } else { &[] };
            let mut places: Vec<Option<[f32; 6]>> = Vec::new();
            for r in records.chunks_exact(7) {
                let index = r[0] as usize;
                if places.len() <= index {
                    places.resize(index + 1, None);
                }
                places[index] = Some([r[1], r[2], r[3], r[4], r[5], r[6]]);
            }
            p.set_surround_format(mix.surround_format);
            p.set_places(&places);
            p.set_fold_51(!records.is_empty());
            s.end = mix.end.max(0.0) as u64;
        });
        Ok(())
    }

    pub fn seek(&self, position: u64) {
        self.with(|s| s.player.seek(position));
    }

    pub fn set_loop(&self, start: u64, end: u64) {
        self.with(|s| s.player.set_loop(start, end));
    }

    pub fn play(&self) {
        let rate = self.rate;
        self.with(|s| {
            s.player.reset_loudness(rate);
            s.ended = false;
            s.playing = true;
        });
    }

    pub fn stop(&self) {
        self.with(|s| s.playing = false);
    }

    /// What the worklet reports: the message the interface already reads.
    pub fn report(&self) -> String {
        self.with(|s| {
            let ended = s.ended;
            s.ended = false;
            let playing = s.playing;
            let p = &mut s.player;
            let (left, right) = p.take_peaks();
            let correlation = p.take_correlation();
            let mut tracks = vec![0f32; MAX_TRACKS * 2];
            let tn = p.take_track_peaks(&mut tracks);
            let mut buses = vec![0f32; MAX_BUSES * 2];
            let bn = p.take_bus_peaks(&mut buses);
            let (m, st, i) = p.loudness();
            let surround = if p.is_fold_51() { Some(p.take_peaks_51()) } else { None };
            serde_json::json!({
                "surroundPeaks": surround,
                "type": "position",
                "position": p.position(),
                "playing": playing,
                "ended": ended,
                "peakLeft": left,
                "peakRight": right,
                "correlation": if correlation.is_nan() { None } else { Some(correlation) },
                "trackPeaks": &tracks[..tn * 2],
                "loudness": [m, st, i],
                "busPeaks": &buses[..bn * 2],
            })
            .to_string()
        })
    }
}

impl Drop for NativeOutput {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::write_frames;

    /// AU-23: rendered frames written as 32-bit float, 32-bit and 16-bit integer samples (what ASIO drivers and some
    /// devices take): cpal's own conversions, left on even channels and right on odd, nothing past the rendered frames.
    #[test]
    fn frames_are_written_in_any_sample_type() {
        let (left, right) = ([0.5f32, -0.25, 1.0], [-0.5f32, 0.75, -1.0]);
        let mut f = [9.0f32; 8];
        write_frames(&mut f, 2, &left, &right, 3);
        assert_eq!(f, [0.5, -0.5, -0.25, 0.75, 1.0, -1.0, 9.0, 9.0]);
        let mut i16s = [7i16; 6];
        write_frames(&mut i16s, 2, &left, &right, 3);
        assert_eq!(i16s, [16384, -16384, -8192, 24576, 32767, -32768]);
        let mut i32s = [7i32; 4];
        write_frames(&mut i32s, 2, &left, &right, 2);
        assert_eq!(i32s, [1 << 30, -(1 << 30), -(1 << 29), 3 << 29]);
        let mut wide = [0i16; 8];
        write_frames(&mut wide, 4, &left, &right, 2); // four channels: left, right, left, right
        assert_eq!(wide, [16384, -16384, 16384, -16384, -8192, 24576, -8192, 24576]);
    }
}

/// The comparison's Multitrack recording row: capture through the engine, every channel of an interface. A browser's
/// capture stops at two channels (Chromium and Firefox alike), so recording more inputs than that from one interface
/// goes through here. One input stream per device, on its own thread as the output's is; while recording, the callback
/// appends the device's interleaved frames as floats, and it keeps each channel's latest peak for meters either way.
/// Unlike the output's, the callback takes the lock rather than trying it: a missed render is silence, a missed capture
/// would be a hole in the take. The engine holds the lock only to copy out.
struct InputShared {
    recording: bool,
    frames: Vec<f32>,
    peaks: Vec<f32>,
}

pub struct NativeInput {
    shared: Arc<Mutex<InputShared>>,
    stop_tx: mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
    pub name: String,
    pub channels: usize,
    pub rate: u32,
}

/// The input devices of every host offered, by name (an ASIO device's with "ASIO: " before it), with their most
/// channels.
pub fn input_devices() -> Vec<(String, u16)> {
    hosts()
        .into_iter()
        .flat_map(|(prefix, host)| {
            host.input_devices()
                .map(|ds| {
                    ds.filter_map(|d| {
                        let name = d.description().ok()?.to_string();
                        let most = d.supported_input_configs().ok().and_then(|cs| cs.map(|c| c.channels()).max()).or_else(|| d.default_input_config().ok().map(|c| c.channels()))?;
                        Some((format!("{prefix}{name}"), most))
                    })
                    .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
        .collect()
}

fn build_input<T>(dev: &cpal::Device, config: cpal::StreamConfig, channels: usize, state: Arc<Mutex<InputShared>>) -> Result<cpal::Stream, cpal::Error>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    dev.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            let Ok(mut s) = state.lock() else { return };
            if s.peaks.len() != channels {
                s.peaks = vec![0.0; channels];
            }
            let mut block = vec![0f32; channels];
            if s.recording {
                s.frames.reserve(data.len());
            }
            for frame in data.chunks(channels) {
                for (c, v) in frame.iter().enumerate() {
                    let x = <f32 as cpal::FromSample<T>>::from_sample_(*v);
                    block[c] = block[c].max(x.abs());
                    if s.recording {
                        s.frames.push(x);
                    }
                }
            }
            s.peaks.copy_from_slice(&block);
        },
        |err| eprintln!("formwav native input: {err}"),
        None,
    )
}

impl NativeInput {
    /// Opens `device` (by name; the default input when None) at `rate` with `channels` when asked (as a DAW's I/O set-up
    /// chooses), else the most it offers at that rate, and starts its stream; nothing is kept until start().
    pub fn open(device: Option<String>, rate: u32, channels: Option<u16>) -> Result<NativeInput, String> {
        let shared = Arc::new(Mutex::new(InputShared { recording: false, frames: Vec::new(), peaks: Vec::new() }));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(String, usize), String>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let state = shared.clone();
        let thread = std::thread::Builder::new()
            .name("formwav-native-input".into())
            .spawn(move || {
                let opened = (|| -> Result<(cpal::Stream, String, usize), String> {
                    let (prefix, dev) = match &device {
                        Some(want) => hosts()
                            .into_iter()
                            .find_map(|(prefix, host)| {
                                let bare = want.strip_prefix(prefix)?;
                                host.input_devices().ok()?.find(|d| d.description().map(|n| n.to_string() == bare).unwrap_or(false)).map(|d| (prefix, d))
                            })
                            .ok_or(format!("no input device named {want}"))?,
                        None => ("", cpal::default_host().default_input_device().ok_or("no default input device")?),
                    };
                    let name = format!("{prefix}{}", dev.description().map(|n| n.to_string()).unwrap_or_default());
                    // The configuration with the most channels at this rate, float preferred
                    let range = dev
                        .supported_input_configs()
                        .map_err(|e| e.to_string())?
                        .filter(|c| c.min_sample_rate() <= rate && rate <= c.max_sample_rate())
                        .filter(|c| channels.is_none_or(|n| c.channels() == n))
                        .max_by_key(|c| (c.channels(), c.sample_format() == cpal::SampleFormat::F32))
                        .ok_or(match channels { Some(n) => format!("{name} offers no {n}-channel input at {rate} Hz"), None => format!("{name} offers no input at {rate} Hz") })?;
                    let chosen = range.with_sample_rate(rate);
                    let channels = chosen.channels().max(1) as usize;
                    // A moderate fixed buffer (1024 frames, within what the device allows): a capture engine's choice, and some
                    // devices' defaults reach for the top of a very wide range
                    let buffer_size = match chosen.buffer_size() {
                        cpal::SupportedBufferSize::Range { min, max } => cpal::BufferSize::Fixed(1024u32.clamp(*min, *max)),
                        cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
                    };
                    let config = cpal::StreamConfig { channels: chosen.channels(), sample_rate: rate, buffer_size };
                    let stream = match chosen.sample_format() {
                        cpal::SampleFormat::F32 => build_input::<f32>(&dev, config, channels, state.clone()),
                        cpal::SampleFormat::I32 => build_input::<i32>(&dev, config, channels, state.clone()),
                        cpal::SampleFormat::I16 => build_input::<i16>(&dev, config, channels, state.clone()),
                        other => return Err(format!("{name} gives {other} samples, which formwav does not read")),
                    }
                    .map_err(|e| e.to_string())?;
                    stream.play().map_err(|e| e.to_string())?;
                    Ok((stream, name, channels))
                })();
                match opened {
                    Ok((stream, name, channels)) => {
                        let _ = ready_tx.send(Ok((name, channels)));
                        let _ = stop_rx.recv();
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        let (name, channels) = ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(NativeInput { shared, stop_tx, thread: Some(thread), name, channels, rate })
    }

    /// Begins a take: what the device delivers from now on is kept.
    pub fn start(&self) {
        if let Ok(mut s) = self.shared.lock() {
            s.frames.clear();
            s.recording = true;
        }
    }

    /// Ends the take and hands back its frames, interleaved over the device's channels.
    pub fn stop(&self) -> Vec<f32> {
        match self.shared.lock() {
            Ok(mut s) => {
                s.recording = false;
                std::mem::take(&mut s.frames)
            }
            Err(_) => Vec::new(),
        }
    }

    /// What the take holds so far, handed over while it goes on: the engine drains a take to disk as it records, so a
    /// long take with many channels never sits whole in memory.
    pub fn drain(&self) -> Vec<f32> {
        self.shared.lock().map(|mut s| std::mem::take(&mut s.frames)).unwrap_or_default()
    }

    /// Each channel's latest peak, for meters.
    pub fn peaks(&self) -> Vec<f32> {
        self.shared.lock().map(|s| s.peaks.clone()).unwrap_or_default()
    }

    pub fn close(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for NativeInput {
    fn drop(&mut self) {
        self.close();
    }
}
