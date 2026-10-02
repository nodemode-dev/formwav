//! fwaudio: formwav's native audio output spike. cpal (Apache-2.0) opens an output device and formwav's own native
//! mixer (formwav-dsp's Player, the code the browser runs as WebAssembly) renders into its callback; the report says
//! whether the callback keeps time. ASIO is the opt-in `asio` feature (Windows, Steinberg's SDK).
//!
//!     fwaudio list
//!     fwaudio play [seconds] [device name contains]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use formwav_dsp::render::{PlayClip, Player};
use formwav_dsp::wav::AudioBuffer;

fn list() {
    for id in cpal::available_hosts() {
        let Ok(host) = cpal::host_from_id(id) else { continue };
        let default = host.default_output_device().and_then(|d| d.description().ok().map(|n| n.to_string()));
        println!("host {:?} (default output: {})", id, default.as_deref().unwrap_or("none"));
        if let Ok(devices) = host.output_devices() {
            for d in devices {
                let name = d.description().map(|n| n.to_string()).unwrap_or_else(|_| "?".into());
                match d.default_output_config() {
                    Ok(c) => println!("  {name}: {} Hz, {} ch, {:?}, buffer {:?}", c.sample_rate(), c.channels(), c.sample_format(), c.buffer_size()),
                    Err(e) => println!("  {name}: no default config ({e})"),
                }
            }
        }
    }
}

struct Timing {
    callbacks: u64,
    frames_min: usize,
    frames_max: usize,
    gaps_ms: Vec<f64>,
    render_ms: Vec<f64>,
    last: Option<Instant>,
}

fn play(seconds: f64, wanted: Option<&str>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = match wanted {
        Some(w) => host
            .output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.description().map(|n| n.to_string().contains(w)).unwrap_or(false))
            .ok_or(format!("no output device named like {w}"))?,
        None => host.default_output_device().ok_or("no default output device")?,
    };
    let name = device.description().map(|n| n.to_string()).unwrap_or_default();
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let (rate, channels) = (config.sample_rate(), config.channels() as usize);
    let tone: Vec<f32> = (0..(rate as usize * 2)).map(|n| 0.25 * (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / rate as f32).sin()).collect();
    let mut player = Player::new();
    player.load_source(1, AudioBuffer { sample_rate: rate, channels: vec![tone.clone(), tone] });
    player.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: rate as u64 * 2, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
    player.set_loop(0, rate as u64 * 2);
    player.seek(0);
    let timing = Arc::new(Mutex::new(Timing { callbacks: 0, frames_min: usize::MAX, frames_max: 0, gaps_ms: Vec::new(), render_ms: Vec::new(), last: None }));
    let errors = Arc::new(AtomicU64::new(0));
    let peak = Arc::new(Mutex::new(0f32));
    let (t, e, p) = (timing.clone(), errors.clone(), peak.clone());
    let (mut left, mut right) = (vec![0f32; 1 << 16], vec![0f32; 1 << 16]);
    let stream = device
        .build_output_stream(
            config.config(),
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let started = Instant::now();
                let frames = data.len() / channels;
                player.render(&mut left[..frames], &mut right[..frames]);
                for (i, frame) in data.chunks_mut(channels).enumerate() {
                    for (c, sample) in frame.iter_mut().enumerate() {
                        *sample = if c % 2 == 0 { left[i] } else { right[i] };
                    }
                }
                let (pl, pr) = player.take_peaks();
                let mut tm = t.lock().unwrap();
                tm.callbacks += 1;
                tm.frames_min = tm.frames_min.min(frames);
                tm.frames_max = tm.frames_max.max(frames);
                if let Some(last) = tm.last {
                    tm.gaps_ms.push(started.duration_since(last).as_secs_f64() * 1000.0);
                }
                tm.last = Some(started);
                tm.render_ms.push(started.elapsed().as_secs_f64() * 1000.0);
                let mut pk = p.lock().unwrap();
                *pk = pk.max(pl.max(pr));
            },
            move |err| {
                eprintln!("fwaudio: stream error: {err}");
                e.fetch_add(1, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| format!("could not open {name}: {e}"))?;
    stream.play().map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_secs_f64(seconds));
    drop(stream);
    let tm = timing.lock().unwrap();
    let mean = |v: &[f64]| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    let max = |v: &[f64]| v.iter().cloned().fold(0.0, f64::max);
    let budget = if tm.frames_max > 0 { tm.frames_min as f64 / rate as f64 * 1000.0 } else { 0.0 };
    println!(
        "{{\"device\": \"{name}\", \"rate\": {rate}, \"channels\": {channels}, \"seconds\": {seconds}, \"callbacks\": {}, \"frames_per_callback\": [{}, {}], \"gap_ms_mean\": {:.3}, \"gap_ms_max\": {:.3}, \"render_ms_mean\": {:.4}, \"render_ms_max\": {:.4}, \"budget_ms\": {budget:.3}, \"frames_delivered\": {}, \"stream_errors\": {}, \"peak\": {:.4}}}",
        tm.callbacks,
        if tm.callbacks > 0 { tm.frames_min } else { 0 },
        tm.frames_max,
        mean(&tm.gaps_ms),
        max(&tm.gaps_ms),
        mean(&tm.render_ms),
        max(&tm.render_ms),
        tm.callbacks as usize * if tm.callbacks > 0 { tm.frames_min } else { 0 },
        errors.load(Ordering::Relaxed),
        *peak.lock().unwrap()
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("list") => {
            list();
            Ok(())
        }
        Some("play") => play(args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3.0), args.get(3).map(String::as_str)),
        _ => Err("usage: fwaudio list | fwaudio play [seconds] [device name contains]".into()),
    };
    if let Err(message) = result {
        eprintln!("fwaudio: {message}");
        std::process::exit(1);
    }
}
