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
}

/// The output devices of the default host, by name.
pub fn devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices().map(|ds| ds.filter_map(|d| d.description().ok().map(|n| n.to_string())).collect()).unwrap_or_default()
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
                    let host = cpal::default_host();
                    let dev = match &device {
                        Some(want) => host
                            .output_devices()
                            .map_err(|e| e.to_string())?
                            .find(|d| d.description().map(|n| n.to_string() == *want).unwrap_or(false))
                            .ok_or(format!("no output device named {want}"))?,
                        None => host.default_output_device().ok_or("no default output device")?,
                    };
                    let name = dev.description().map(|n| n.to_string()).unwrap_or_default();
                    let base = dev.default_output_config().map_err(|e| e.to_string())?;
                    if base.sample_format() != cpal::SampleFormat::F32 {
                        return Err(format!("{name} does not offer 32-bit float output"));
                    }
                    let channels = base.channels().max(1) as usize;
                    let config = cpal::StreamConfig { channels: base.channels(), sample_rate: rate, buffer_size: cpal::BufferSize::Default };
                    let (mut left, mut right) = (vec![0f32; 1 << 16], vec![0f32; 1 << 16]);
                    let stream = dev
                        .build_output_stream(
                            config,
                            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
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
                                    data.fill(0.0);
                                    return;
                                }
                                for (i, frame) in data.chunks_mut(channels).enumerate().take(frames) {
                                    for (c, sample) in frame.iter_mut().enumerate() {
                                        *sample = if c % 2 == 0 { left[i] } else { right[i] };
                                    }
                                }
                            },
                            |err| eprintln!("formwav native output: {err}"),
                            None,
                        )
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
                for k in c.fx.as_deref().unwrap_or(&[]).chunks_exact(4) {
                    p.add_clip_fx(k[0] as u8, k[1], k[2], k[3]);
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
            serde_json::json!({
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
