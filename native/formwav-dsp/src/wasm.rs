use std::slice;

use crate::render::{PlayClip, Player};
use crate::wav::decode_wav;

#[no_mangle]
pub extern "C" fn fw_alloc(bytes: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(bytes.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn fw_free(ptr: *mut u8, bytes: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, bytes.max(1)));
    }
}

#[no_mangle]
pub extern "C" fn fw_player_new() -> *mut Player {
    Box::into_raw(Box::new(Player::new()))
}

#[no_mangle]
pub unsafe extern "C" fn fw_load_wav(player: *mut Player, id: u32, ptr: *const u8, len: usize) -> f64 {
    match decode_wav(slice::from_raw_parts(ptr, len)) {
        Ok(buf) => {
            let frames = buf.frames();
            (*player).load_source(id, buf);
            frames as f64
        }
        Err(_) => -1.0,
    }
}

/// A silent source of known length, playable at once and filled by `fw_source_write` (a long file streamed in).
#[no_mangle]
pub unsafe extern "C" fn fw_source_alloc(player: *mut Player, id: u32, rate: u32, channels: u32, frames: f64) -> f64 {
    if !(frames >= 0.0) || channels == 0 || channels > 32 {
        return -1.0;
    }
    (*player).alloc_source(id, rate, channels as usize, frames as usize);
    frames
}

/// Interleaved f32 frames written into a source from `offset`; returns the frames written.
#[no_mangle]
pub unsafe extern "C" fn fw_source_write(player: *mut Player, id: u32, offset: f64, ptr: *const f32, len: usize) -> f64 {
    if !(offset >= 0.0) {
        return 0.0;
    }
    (*player).write_source(id, offset as usize, slice::from_raw_parts(ptr, len)) as f64
}

#[no_mangle]
pub unsafe extern "C" fn fw_clear_clips(player: *mut Player) {
    (*player).clear_clips();
}

#[no_mangle]
pub unsafe extern "C" fn fw_add_clip(
    player: *mut Player,
    source: u32,
    start: f64,
    source_in: f64,
    length: f64,
    gain: f32,
    pan: f32,
    fade_in: f64,
    fade_out: f64,
    fade_shape: u32,
    bus: u32,
    track: u32,
    gain_env: u32,
    pan_env: u32,
) {
    (*player).add_clip(PlayClip {
        source,
        start: start.max(0.0) as u64,
        source_in: source_in.max(0.0) as u64,
        length: length.max(0.0) as u64,
        gain,
        pan,
        fade_in: fade_in.max(0.0) as u64,
        fade_out: fade_out.max(0.0) as u64,
        fade_shape: fade_shape.min(u8::MAX as u32) as u8,
        bus,
        track,
        gain_env,
        pan_env,
    });
}

#[no_mangle]
pub unsafe extern "C" fn fw_seek(player: *mut Player, position: f64) {
    (*player).seek(position.max(0.0) as u64);
}

#[no_mangle]
pub unsafe extern "C" fn fw_position(player: *mut Player) -> f64 {
    (*player).position() as f64
}

#[no_mangle]
pub unsafe extern "C" fn fw_render(player: *mut Player, left: *mut f32, right: *mut f32, frames: usize) {
    (*player).render(slice::from_raw_parts_mut(left, frames), slice::from_raw_parts_mut(right, frames));
}

#[no_mangle]
pub unsafe extern "C" fn fw_set_loop(player: *mut Player, start: f64, end: f64) {
    (*player).set_loop(start.max(0.0) as u64, end.max(0.0) as u64);
}

#[no_mangle]
pub unsafe extern "C" fn fw_clear_buses(player: *mut Player) {
    (*player).clear_buses();
}

#[no_mangle]
pub unsafe extern "C" fn fw_add_bus(player: *mut Player, id: u32, gain: f32, pan: f32) {
    (*player).add_bus(crate::render::Bus { id, gain, pan });
}

/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_set_rate(player: *mut Player, rate: f32) {
    (*player).set_rate(rate);
}

/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_add_clip_fx(player: *mut Player, kind: u32, freq: f32, gain_db: f32, q: f32) -> u32 {
    (*player).add_clip_fx(kind as u8, freq, gain_db, q) as u32
}

/// PT-33: a compressor stage on the latest clip's chain, in the order stages are added.
/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_add_clip_comp(player: *mut Player, threshold_db: f32, ratio: f32, attack_ms: f32, release_ms: f32, makeup_db: f32) -> u32 {
    (*player).add_clip_comp(threshold_db, ratio, attack_ms, release_ms, makeup_db) as u32
}

/// Effect parameter automation (PT-19): `param` (0 frequency, 1 gain, 2 Q) of stage `stage` of the latest clip
/// follows envelope `envelope`; 1 when attached.
///
/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_add_clip_fx_auto(player: *mut Player, stage: u32, param: u32, envelope: u32) -> u32 {
    (*player).add_clip_fx_auto(stage as usize, param as u8, envelope) as u32
}

/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_clear_master_fx(player: *mut Player) {
    (*player).clear_master_fx();
}

/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_add_master_fx(player: *mut Player, kind: u32, freq: f32, gain_db: f32, q: f32) -> u32 {
    (*player).add_master_fx(kind as u8, freq, gain_db, q) as u32
}

/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn fw_add_master_stage(player: *mut Player, kind: u32, a: f32, b: f32, c: f32, d: f32, e: f32) -> u32 {
    (*player).add_master_stage(kind as u8, a, b, c, d, e) as u32
}

/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn fw_add_bus_stage(player: *mut Player, kind: u32, a: f32, b: f32, c: f32, d: f32, e: f32) -> u32 {
    (*player).add_bus_stage(kind as u8, a, b, c, d, e) as u32
}

#[no_mangle]
pub unsafe extern "C" fn fw_take_peaks(player: *mut Player, out: *mut f32) {
    let (left, right) = (*player).take_peaks();
    *out = left;
    *out.add(1) = right;
}

/// The master's phase correlation since the last call (AA-02); NaN with nothing playing.
///
/// # Safety
/// `player` must come from `fw_player_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn fw_take_correlation(player: *mut Player) -> f32 {
    (*player).take_correlation()
}

#[no_mangle]
pub unsafe extern "C" fn fw_take_track_peaks(player: *mut Player, out: *mut f32, max_tracks: u32) -> u32 {
    let buf = std::slice::from_raw_parts_mut(out, max_tracks as usize * 2);
    (*player).take_track_peaks(buf) as u32
}

#[no_mangle]
pub unsafe extern "C" fn fw_take_bus_peaks(player: *mut Player, out: *mut f32, max_buses: u32) -> u32 {
    let buf = std::slice::from_raw_parts_mut(out, max_buses as usize * 2);
    (*player).take_bus_peaks(buf) as u32
}

#[no_mangle]
pub unsafe extern "C" fn fw_loudness_reset(player: *mut Player, rate: u32) {
    (*player).reset_loudness(rate);
}

/// Writes momentary, short-term and integrated loudness (LUFS) to `out[0..3]`; -inf where not yet measured.
#[no_mangle]
pub unsafe extern "C" fn fw_loudness(player: *mut Player, out: *mut f32) {
    let (m, s, i) = (*player).loudness();
    for (k, v) in [m, s, i].into_iter().enumerate() {
        *out.add(k) = v.map_or(f32::NEG_INFINITY, |x| x as f32);
    }
}

#[no_mangle]
pub unsafe extern "C" fn fw_clear_envelopes(player: *mut Player) {
    (*player).clear_envelopes();
}

/// Sets the master fader in dB (0 turns the master stage off).
#[no_mangle]
pub unsafe extern "C" fn fw_set_master_db(player: *mut Player, db: f64) {
    (*player).set_master_db(db);
}

/// Adds an envelope from `count` (time, value) f64 pairs at `points`; `db` != 0 means dB values. Returns its 1-based index.
#[no_mangle]
pub unsafe extern "C" fn fw_add_envelope(player: *mut Player, points: *const f64, count: u32, db: u32) -> u32 {
    let raw = std::slice::from_raw_parts(points, count as usize * 2);
    let pairs: Vec<(u64, f64)> = raw.chunks_exact(2).map(|p| (p[0].max(0.0) as u64, p[1])).collect();
    (*player).add_envelope(&pairs, db != 0)
}
