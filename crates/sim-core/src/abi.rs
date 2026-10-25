//! The wasm surface. Every function here is a thin wrapper; no logic lives in this file.
//! Locked contract (runners depend on it):
//!   sim_alloc(len) -> ptr            sim_free(ptr, len)
//!   sim_create(seed: u64) -> handle  sim_destroy(handle)   (handle 0 = refused, see `sim_create`)
//!   sim_step(handle, input_ptr)      reads TickInput::WIRE_LEN bytes
//!   sim_hash(handle) -> u64
//!   sim_drain_events(handle, out_ptr, cap) -> n   writes n <= cap Event records (Event::WIRE_LEN each)
//!   sim_state(handle, out_ptr, cap) -> n          writes n <= cap f64 snapshot values

use crate::{Event, Session, TickInput};

#[unsafe(no_mangle)]
pub extern "C" fn sim_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from a prior `sim_alloc(len)`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_free(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len.max(1)) });
}

/// The seed carries two things. Bits 56..63 (the top byte) are the exercise id: 0 and 1 are bài 1
/// (Xuất phát; 0 so that a plain seed is a bài 1 seed, 1 because it is bài 1's own number and the
/// messy golden's seed starts with it), 3 is bài 3 (Dừng và khởi hành xe trên dốc). Bits 0..55 are
/// the seed proper. Any other exercise id is refused: this returns a null handle, and the caller
/// must not use it, rather than quietly running bài 1.
#[unsafe(no_mangle)]
pub extern "C" fn sim_create(seed: u64) -> *mut Session {
    match Session::new(seed) {
        Some(s) => Box::into_raw(Box::new(s)),
        None => core::ptr::null_mut(),
    }
}

/// # Safety
/// `s` must come from `sim_create` and not be used afterwards; the null handle of a refused
/// `sim_create` is accepted and ignored.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_destroy(s: *mut Session) {
    if !s.is_null() {
        drop(unsafe { Box::from_raw(s) });
    }
}

/// # Safety
/// `s` is a live session; `input` points at `TickInput::WIRE_LEN` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_step(s: *mut Session, input: *const u8) {
    let bytes = unsafe { &*(input as *const [u8; TickInput::WIRE_LEN]) };
    unsafe { &mut *s }.step(TickInput::from_wire(bytes));
}

/// # Safety
/// `s` is a live session.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_hash(s: *const Session) -> u64 {
    unsafe { &*s }.hash()
}

/// # Safety
/// `s` is a live session; `out` has room for `cap` records.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_drain_events(s: *mut Session, out: *mut u8, cap: usize) -> usize {
    let events = unsafe { &mut *s }.drain_events();
    let n = events.len().min(cap);
    for (i, e) in events.into_iter().take(n).enumerate() {
        let dst = unsafe { core::slice::from_raw_parts_mut(out.add(i * Event::WIRE_LEN), Event::WIRE_LEN) };
        dst.copy_from_slice(&e.to_wire());
    }
    n
}

/// Writes the run snapshot into `out` as little-endian `f64` values and returns how many it wrote.
/// Same shape as `sim_drain_events`: the caller allocates, the core reports the count. Values are
/// copied as bytes, so the caller makes no alignment promise and a JS `DataView` reads them.
/// The field order is the list in `lib.rs` above `Snapshot`.
///
/// # Safety
/// `s` is a live session; `out` has room for `cap * 8` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_state(s: *const Session, out: *mut u8, cap: usize) -> usize {
    let snap = unsafe { &*s }.snapshot();
    let n = snap.len().min(cap);
    for (i, v) in snap.into_iter().take(n).enumerate() {
        let dst = unsafe { core::slice::from_raw_parts_mut(out.add(i * 8), 8) };
        dst.copy_from_slice(&v.to_le_bytes());
    }
    n
}
