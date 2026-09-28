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

#[no_mangle]
pub unsafe extern "C" fn fw_clear_clips(player: *mut Player) {
    (*player).clear_clips();
}

#[no_mangle]
pub unsafe extern "C" fn fw_add_clip(player: *mut Player, source: u32, start: f64, source_in: f64, length: f64, gain: f32, pan: f32) {
    (*player).add_clip(PlayClip {
        source,
        start: start.max(0.0) as u64,
        source_in: source_in.max(0.0) as u64,
        length: length.max(0.0) as u64,
        gain,
        pan,
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
