//! The wasm surface. Every function here is a thin wrapper; no logic lives in this file.
//! Locked contract (runners depend on it):
//!   sim_alloc(len) -> ptr            sim_free(ptr, len)
//!   sim_create(seed: u64) -> handle  sim_destroy(handle)   (handle 0 = refused, see `sim_create`)
//!   sim_step(handle, input_ptr)      reads TickInput::WIRE_LEN bytes
//!   sim_hash(handle) -> u64
//!   sim_drain_events(handle, out_ptr, cap) -> n   writes n <= cap Event records (Event::WIRE_LEN each)
//!   sim_state(handle, out_ptr, cap) -> n          writes n <= cap f64 snapshot values
//!   sim_course(handle, out_ptr, cap) -> n         writes n <= cap f64 figure records, or 0 for an
//!                                                exercise with no figure

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

/// The seed carries two things. Bits 56..63 (the top byte) are the exercise id:
/// * 0 and 1 — bài 1 (Xuất phát; 0 so that a plain seed is a bài 1 seed, 1 because it is bài 1's own
///   number and the messy golden's seed starts with it);
/// * 2 — bài 2 (Dừng xe nhường đường cho người đi bộ);
/// * 3 — bài 3 (Dừng và khởi hành xe trên dốc);
/// * 4 — bài 4 (Qua vệt bánh xe và đường vòng vuông góc);
/// * 5 — bài 5 (Qua ngã tư có tín hiệu điều khiển giao thông);
/// * 6 — bài 6 (Qua đường vòng quanh co);
/// * 7 — bài 7 (Ghép xe dọc vào nơi đỗ);
/// * 8 — bài 8 (Ghép xe ngang vào nơi đỗ);
/// * 9 — bài 9 (Tạm dừng ở chỗ có đường sắt chạy qua);
/// * 10 — bài 10 (Thay đổi số trên đường bằng);
/// * 11 — bài 11 (Kết thúc).
///
/// Bits 0..55 are the seed proper. For bài 5 they also pick the light's phase: the offset into the
/// cycle is that number reduced modulo the cycle length, so the same trace always meets the same
/// light and a different attempt meets red, green or yellow. Any other exercise id is refused: this
/// returns a null handle, and the caller must not use it, rather than quietly running bài 1.
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

/// Writes the session's figure as little-endian `f64` values and returns how many it wrote.
///
/// The block is a sequence of records, each `[kind, line_id, npoints, x0, y0, x1, y1, ...]`:
/// * kind 1 — a limit line (vạch giới hạn), the centre polyline of the 0,1 m painted band;
/// * kind 2 — a curb (bó vỉa), a band of its own outside the limit line;
/// * kind 3 — a vệt bánh xe line (bài 4 only), a limit line the learner must drive through;
/// * kind 4 — a gate: entry, exit, vệt start, vệt end (`line_id` = 1, 2, 3, 4), npoints = 2;
/// * kind 5 — the lane centreline, for arrow and cue drawing;
/// * kind 6 — a transverse marking (bài 2, 5, 9, 10, 11), npoints = 2, `line_id` 1 stop line /
///   2 finish or end line / 3 crosswalk stripe / 4 rail / 5 sign (bài 10, both points the post's foot);
/// * kind 7 — the signal head's position (bài 2, 5, 9), one point.
///
/// Records arrive in that order: lines, gates, centreline, markings, signal, and — for bài 7 and
/// bài 8 only — the two rectangles that make the bay exercise. The exercises that existed before
/// each addition write exactly the records they always wrote, in the order they always wrote them,
/// so their blocks are unchanged.
///
/// Record kinds:
/// * 1 — a limit line, one polyline, `line_id` = its index in `Course::lines`;
/// * 2 — a curb band, a polyline just outside a limit line;
/// * 3 — bài 4's vệt lines;
/// * 4 — a gate, as the two ends of a line across the lane; `line_id` is `Gate`: 1 entry, 2 exit,
///   3 vệt start, 4 vệt end, 5 the bay's mouth;
/// * 5 — the centreline the learner follows;
/// * 6 — a transverse marking (stop line, crosswalk stripe, rail, finish line);
/// * 7 — the signal head's position;
/// * 8 — bài 7 and bài 8: a closed quad. `line_id` 1 is the drivable area (the control lane of
///   Hình 13, the road of Hình 14), `line_id` 2 is the bay itself. Six values each, the first corner
///   repeated at the end.
///
/// Coordinates are metres in the same frame as the snapshot's `x_m`/`y_m`.
///
/// **A capacity too small writes nothing and returns the number needed**, so the caller can size
/// its buffer and call again; a call with enough room writes the whole figure and returns its
/// length. Exercises 1 and 3 have no figure and return 0.
///
/// # Safety
/// `s` is a live session; when `cap` is large enough, `out` has room for `cap * 8` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_course(s: *const Session, out: *mut u8, cap: usize) -> usize {
    let block = unsafe { &*s }.course_block();
    if block.is_empty() || block.len() > cap {
        return block.len();
    }
    for (i, v) in block.iter().enumerate() {
        let dst = unsafe { core::slice::from_raw_parts_mut(out.add(i * 8), 8) };
        dst.copy_from_slice(&v.to_le_bytes());
    }
    block.len()
}

/// The figure block, for the scenario tests. Not exported to wasm.
#[cfg(test)]
pub fn course_block_for_test(s: &Session) -> Vec<f64> {
    s.course_block()
}
