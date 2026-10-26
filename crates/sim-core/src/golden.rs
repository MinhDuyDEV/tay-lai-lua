//! Golden traces: recorded input scripts the runners replay (two for bài 1, two for bài 3), and the tests that keep the hash
//! honest.
//!
//! File format (what the runners are written against):
//! * `golden/<name>.trace` — 8-byte little-endian `u64` seed, then N × 8-byte `TickInput` records.
//! * `golden/<name>.hash`  — the final `sim_hash` as 16 lowercase hex digits plus a newline.
//!
//! Regenerate with `cargo run -p sim-core --example gen_golden`. The traces are committed, so a
//! change in the simulation that moves the hash must be a deliberate re-record, not a silent one.

use crate::{Session, TickInput};

const BELT: u8 = TickInput::FLAG_BELT;
const LEFT: u8 = TickInput::FLAG_SIGNAL_LEFT;
const RIGHT: u8 = TickInput::FLAG_SIGNAL_RIGHT;
const IGN: u8 = TickInput::FLAG_IGNITION;
const ORDER: u8 = TickInput::FLAG_START_ORDER;
const HANDBRAKE: u8 = TickInput::FLAG_HANDBRAKE;

/// Ticks of cold cranking every trace spends before its start order. `crank_ticks` is 18, so 20
/// leaves the starter a margin; the prelude is unscored, so it costs the run nothing.
const CRANK_TICKS: u32 = 20;

pub struct Golden {
    pub name: &'static str,
    pub seed: u64,
    pub inputs: Vec<TickInput>,
}

/// Record a trace: drive a real session with a state-aware driver and freeze the inputs it sent.
/// The trace is a fixed script afterwards — replay never looks at the state to decide the input.
fn record(seed: u64, ticks: u32, driver: impl FnMut(&crate::View, u32) -> TickInput) -> Vec<TickInput> {
    record_while(seed, |_, t| t < ticks, driver)
}

/// Record a bài 3 trace up to and including the step that ends the run. The runners' negative
/// control flips a bit in the last record, so a trace that goes on after the end would ignore it.
fn record_to_the_end(seed: u64, driver: impl FnMut(&crate::View, u32) -> TickInput) -> Vec<TickInput> {
    record_while(seed, |v, t| v.phase != crate::Phase::Done && t < 5000, driver)
}

fn record_while(
    seed: u64,
    mut going: impl FnMut(&crate::View, u32) -> bool,
    mut driver: impl FnMut(&crate::View, u32) -> TickInput,
) -> Vec<TickInput> {
    let mut s = Session::new(seed).expect("a known exercise");
    let mut inputs = Vec::new();
    let mut t = 0;
    while going(&s.view(), t) {
        let input = driver(&s.view(), t);
        s.step(input);
        inputs.push(input);
        t += 1;
    }
    inputs
}

/// A clean pass: cold crank, belt on, the order, signal left, gentle clutch, light throttle, the
/// signal switched off once the bumper is inside the 5 m window, then a coast to the end mark. No
/// rule fires. Recorded at metres, so the window is hit exactly. The first `CRANK_TICKS` are the
/// unscored cold start; the 330 scored ticks after the order are the run the trace always had.
pub fn clean_pass() -> Golden {
    let seed = 1;
    let inputs = record(seed, 330 + CRANK_TICKS, |v, t| {
        let signalling = v.front_bumper_m < 5.0;
        let mut flags = BELT;
        if signalling {
            flags |= LEFT;
        }
        if t < CRANK_TICKS {
            // Cold: key held, clutch pressed, neutral, handbrake on. Nothing is scored yet.
            TickInput {
                gear: 0,
                clutch: 255,
                flags: flags | TickInput::FLAG_HANDBRAKE | IGN,
                ..Default::default()
            }
        } else {
            // Đèn xanh: every clock in the run counts from this tick.
            let t = t - CRANK_TICKS;
            flags |= ORDER;
            if t < 30 {
                // Parked at the line: clutch pressed, neutral, handbrake on.
                TickInput { gear: 0, clutch: 255, flags: flags | TickInput::FLAG_HANDBRAKE, ..Default::default() }
            } else if t < 60 {
                // Release the handbrake and feed the clutch in gently in first.
                let clutch = 255u8.saturating_sub(((t - 30) * 5) as u8);
                TickInput { gear: 1, clutch, throttle: 60, steering: (t as i16 - 45) * 40, flags, ..Default::default() }
            } else if v.speed_mps < 3.0 {
                TickInput { gear: 1, clutch: 60, throttle: 40, steering: 120, flags, ..Default::default() }
            } else {
                // Coast: off the throttle, a touch of steer, signal already off.
                TickInput { gear: 1, clutch: 60, steering: 0, flags, ..Default::default() }
            }
        }
    });
    Golden { name: "xuat_phat_clean", seed, inputs }
}

/// A messy run: cold crank, stall, restart, rev past 4000, a signal switched off far too early, a
/// handbrake stall, and a right signal at the end. Chosen so the float paths (clutch slip, rpm,
/// steering) all move, and so a one-bit float difference anywhere turns into a different final
/// hash. The cold crank is unscored; the order is given on the first tick after the engine
/// is seen running, and the script's own clock starts on that tick, so every scored event lands
/// on the same tick as in the recording made before the cold start existed.
pub fn messy_run() -> Golden {
    let seed = 0x0123_4567_89ab_cdef;
    let mut stage = 0u8;
    // Tick of the start order: the tick after the one that saw the engine running.
    let mut order_at: Option<u32> = None;
    let inputs = record(seed, 460 + CRANK_TICKS + 1, |v, t| {
        let t = match order_at {
            None => {
                // Cold: key held, clutch pressed, neutral, nothing scored either way.
                if v.engine_on {
                    order_at = Some(t + 1);
                }
                return TickInput { gear: 0, clutch: 255, flags: IGN, ..Default::default() };
            }
            Some(order_tick) => t - order_tick,
        };
        // Advance the stage on what the simulation says, not on a guessed tick.
        match stage {
            0 if t >= 18 => stage = 1,
            1 if !v.engine_on => stage = 2,
            2 if v.engine_on && t > 25 => stage = 3,
            3 if v.rpm > 4300.0 => stage = 4,
            4 if v.speed_mps > 1.0 => stage = 5,
            5 if v.front_bumper_m >= 0.5 => stage = 6,
            6 if v.front_bumper_m >= 4.0 => stage = 7,
            7 if v.speed_mps <= 0.0 => stage = 8,
            _ => {}
        }
        let ordered = |flags: u8| flags | ORDER;
        match stage {
            // Sitting at the line, no belt yet, neutral, engine idling.
            0 => TickInput { gear: 0, clutch: 255, flags: ORDER, ..Default::default() },
            // Drop the clutch in first at idle: dead stall.
            1 => TickInput { gear: 1, clutch: 0, steering: -60, flags: ORDER, ..Default::default() },
            // Restart: clutch in, neutral, key held.
            2 => TickInput { gear: 0, clutch: 255, flags: IGN | ORDER, ..Default::default() },
            // Belt on, signal left, rev it in neutral past 4000.
            3 => TickInput {
                gear: 0,
                clutch: 255,
                throttle: 255,
                flags: ordered(BELT | LEFT),
                ..Default::default()
            },
            // Launch in first with a fast clutch drop and a lot of throttle.
            4 => TickInput {
                gear: 1,
                clutch: 40,
                throttle: 200,
                steering: 300,
                flags: ordered(BELT | LEFT),
                ..Default::default()
            },
            // Signal switched off at 5 m... which is inside the window; stage 6 then
            // re-arms it and kills it early, so the messy trace still shows untimely use.
            5 | 6 => TickInput {
                gear: 1,
                clutch: 20,
                throttle: 150,
                steering: 100,
                flags: ordered(BELT),
                ..Default::default()
            },
            // Handbrake stop in second gear: the second stall.
            7 => TickInput {
                gear: 2,
                clutch: 0,
                brake: 255,
                steering: -200,
                flags: ordered(BELT | TickInput::FLAG_HANDBRAKE),
                ..Default::default()
            },
            // Odd signal use at the end: right instead of left, engine off.
            _ => TickInput {
                gear: 0,
                clutch: 255,
                flags: ordered(BELT | RIGHT),
                ..Default::default()
            },
        }
    });
    Golden { name: "xuat_phat_messy", seed, inputs }
}

/// Bài 3, bài 4 and bài 6 seeds carry their exercise id in the top byte (see `sim_create`).
const HILL: u64 = 3 << 56;
const VET: u64 = 4 << 56;
const CURVE: u64 = 6 << 56;

/// The centreline of a figure, from the block `sim_course` writes.
fn centreline(block: &[f64]) -> Vec<(f64, f64)> {
    let mut i = 0;
    while i + 2 < block.len() {
        let kind = block[i];
        let n = block[i + 2] as usize;
        let pts = i + 3;
        if kind == 5.0 {
            return (0..n).map(|k| (block[pts + 2 * k], block[pts + 2 * k + 1])).collect();
        }
        i = pts + 2 * n;
    }
    Vec::new()
}

fn path_length(pts: &[(f64, f64)]) -> f64 {
    pts.windows(2).map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt()).sum()
}

fn point_at(pts: &[(f64, f64)], progress: f64) -> Option<(f64, f64)> {
    let mut travelled = 0.0;
    for w in pts.windows(2) {
        let dx = w[1].0 - w[0].0;
        let dy = w[1].1 - w[0].1;
        let seg = (dx * dx + dy * dy).sqrt();
        if travelled + seg >= progress && seg > 0.0 {
            let t = ((progress - travelled) / seg).clamp(0.0, 1.0);
            return Some((w[0].0 + t * dx, w[0].1 + t * dy));
        }
        travelled += seg;
    }
    None
}

fn curvature(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    let ab = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
    let bc = ((c.0 - b.0).powi(2) + (c.1 - b.1).powi(2)).sqrt();
    let ca = ((a.0 - c.0).powi(2) + (a.1 - c.1).powi(2)).sqrt();
    let denom = ab * bc * ca;
    if denom == 0.0 { 0.0 } else { 2.0 * cross / denom }
}

/// Steering, as a fraction of full lock, that puts the car's centre on a circle of curvature `kappa`.
fn steer_for_raw(kappa: f64) -> f64 {
    if kappa.abs() < 1e-9 {
        return 0.0;
    }
    let r = 1.0 / kappa.abs();
    let r_axle = (r * r - 0.25 * 2.4 * 2.4).max(0.01).sqrt();
    (libm::atan(2.4 / r_axle).copysign(kappa) / 0.55).clamp(-1.0, 1.0)
}

fn steer_for(kappa: f64) -> i16 {
    (steer_for_raw(kappa) * 32760.0) as i16
}

/// A clean pass of either figure: idle, then steer by the centreline's own curvature.
///
/// The steering is a script derived from the figure, not a controller, because this trace's job is to
/// pin the *simulation* — the scoring, the contact model, the clock. A badly tuned controller failing
/// would say nothing about the figure, and would make the hash move for the wrong reason.
fn figure_pass(seed: u64, name: &'static str) -> Golden {
    let probe = Session::new(seed).expect("a known exercise");
    let pts = centreline(&probe.course_block());
    let len = path_length(&pts);
    let inputs = record_to_the_end(seed, |v, t| {
        if t < 30 {
            // Engine idling, neutral, handbrake on: the state the exercise opens in.
            return TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() };
        }
        let p = v.progress_m.clamp(0.0, len - 0.2);
        let (Some(a), Some(b), Some(c)) =
            (point_at(&pts, (p - 1.0).max(0.0)), point_at(&pts, p), point_at(&pts, (p + 1.0).min(len)))
        else {
            return TickInput { brake: 255, clutch: 255, ..Default::default() };
        };
        let steer = steer_for(curvature(a, b, c));
        let speed = v.speed_mps;
        TickInput {
            steering: steer,
            throttle: if speed < 1.4 { 110 } else { 0 },
            brake: if speed > 1.7 { 100 } else { 0 },
            clutch: 150,
            gear: 1,
            ..Default::default()
        }
    });
    Golden { name, seed, inputs }
}

/// A messy pass of either figure, recorded so every rule this exercise has lands at least once:
/// `SH.X.RPM` (rev past 4000), `SH.X.CHET_MAY` (dead stall, then a restart), `DE_VACH` (a wheel onto
/// a line), `DE_VACH_KEO_DAI` (that same episode held past five seconds), `QUA_THOI_GIAN` (the clock
/// pushed past two minutes) — and it ends there, on the step the clock charge lands, so the runner's
/// negative control still flips a bit in a step the simulation reads.
///
/// The clock is 120 s, so this trace is longer than the other seven: the law puts the clock where it
/// puts it, and a trace that dodged it would not prove the rule.
fn figure_messy(seed: u64, name: &'static str) -> Golden {
    let mut stage = 0u8;
    let mut restarting_since: Option<u32> = None;
    let mut inputs = Vec::new();
    let mut s = Session::new(seed).expect("a known exercise");
    for t in 0..12_000u32 {
        // Advance the script on what the simulation says, never on a guessed tick.
        match stage {
            0 if t >= 12 => stage = 1,
            1 if s.view().rpm > 4300.0 => stage = 2,
            2 if s.view().rpm < 900.0 => stage = 3,
            3 if !s.view().engine_on => stage = 4,
            4 if restarting_since.is_none() => restarting_since = Some(t),
            4 if s.view().engine_on && restarting_since.is_some_and(|r| t > r + 5) => stage = 5,
            // Turn in until a wheel touches a line, then stop on it: the episode runs on a stopped
            // wheel, so the five-second mark is reached without the car having to be steered along a
            // 0,1 m band.
            5 if s.view().longest_episode_s > 0.0 => stage = 6,
            6 if s.view().longest_episode_s >= 5.5 => stage = 7,
            _ => {}
        }
        let input = match stage {
            // Idle, handbrake on; nothing scored but the rev that follows.
            0 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            1 => TickInput { clutch: 255, throttle: 255, flags: HANDBRAKE, ..Default::default() },
            // Back to idle, then the clutch dropped in first with the throttle open: a dead stall.
            2 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            3 => TickInput { gear: 1, clutch: 0, throttle: 120, ..Default::default() },
            // Restart: clutch in, neutral, key held.
            4 => TickInput { clutch: 255, flags: TickInput::FLAG_IGNITION, ..Default::default() },
            // Drive on towards the left line at a steady walking pace. When a wheel touches it the
            // script stops the car dead on the spot: the line and the curb behind it are only 0,2 m
            // apart, so the touch has to be caught on the very tick it happens.
            5 => TickInput {
                steering: -11000,
                throttle: if s.view().speed_mps < 0.9 { 90 } else { 0 },
                brake: if s.view().speed_mps > 1.0 { 80 } else { 0 },
                clutch: 150,
                gear: 1,
                ..Default::default()
            },
            // On the line: clutch in and brake down, and stand there while the episode timer runs,
            // then while the exercise clock runs to its two minutes. The episode keeps running on a
            // stopped wheel, so nothing has to be steered along a 0,1 m band.
            6 | 7 => TickInput { brake: 255, clutch: 255, gear: 1, ..Default::default() },
            _ => TickInput { brake: 255, clutch: 255, gear: 1, ..Default::default() },
        };
        s.step(input);
        inputs.push(input);
        let v = s.view();
        let clock_charged = v.fired("SH.04.QUA_THOI_GIAN") + v.fired("SH.06.QUA_THOI_GIAN") > 0;
        if clock_charged || v.phase == crate::Phase::Done || v.disqualified {
            break;
        }
    }
    Golden { name, seed, inputs }
}

/// Predicted stopping point of a car braking at about 6.9 m/s² on the slope: where the front
/// bumper will be when it stops, if the brake goes on now.
fn stopping_point(v: &crate::View) -> f64 {
    v.front_bumper_m + v.speed_mps * v.speed_mps / (2.0 * 6.9)
}

/// A clean bài 3: climb to the line, brake to a stop 0.3 m short of it, handbrake on, then the hill
/// start — clutch up to the bite with throttle, handbrake off — and over the line. No rule fires.
/// A little steering keeps the heading and the sin/cos paths moving.
pub fn hill_clean() -> Golden {
    let seed = HILL | 1;
    let mut stopped_at: Option<u32> = None;
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        if v.phase == crate::Phase::Stopped && stopped_at.is_none() {
            stopped_at = Some(t);
        }
        match stopped_at {
            None if t < 20 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            None => {
                braking |= v.front_bumper_m > 0.0 && stopping_point(v) >= 6.0 - 0.3;
                if braking {
                    TickInput { gear: 1, clutch: 255, brake: 255, steering: 300, ..Default::default() }
                } else {
                    TickInput { gear: 1, clutch: 168, throttle: 70, steering: 300, ..Default::default() }
                }
            }
            // Held on the handbrake for two seconds.
            Some(at) if t - at < 120 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            Some(at) => {
                let clutch = 255u32.saturating_sub((t - at - 120) * 2).max(180) as u8;
                let flags = if clutch > 180 { HANDBRAKE } else { 0 };
                TickInput { gear: 1, clutch, throttle: 70, steering: -150, flags, ..Default::default() }
            }
        }
    });
    Golden { name: "dung_khoi_hanh_doc_clean", seed, inputs }
}

/// A messy bài 3: over-revved in neutral, a dead stall and a restart on the approach, a stop 1.2 m
/// short of the line (CHUA_DEN_VACH), then a hill start with the handbrake let go too early, so
/// the car rolls back a little (under 500 mm), grips, and goes over the line. Several deductions,
/// the run still ends by crossing the line, and the trace ends on the step that crosses it.
pub fn hill_messy() -> Golden {
    let seed = HILL | 0x0123_4567_89ab;
    let mut stage = 0u8;
    let mut stopped_at: Option<u32> = None;
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        if v.phase == crate::Phase::Stopped && stopped_at.is_none() {
            stopped_at = Some(t);
        }
        match stage {
            0 if t >= 20 => stage = 1,
            1 if v.rpm > 4300.0 => stage = 2,
            2 if v.rpm < 900.0 => stage = 3,
            3 if !v.engine_on => stage = 4,
            4 if v.engine_on => stage = 5,
            _ => {}
        }
        match stage {
            // Idle, then rev it in neutral past 4000.
            0 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            1 => TickInput { clutch: 255, throttle: 255, flags: HANDBRAKE, ..Default::default() },
            // Back to idle, then first gear with the clutch dropped and no throttle: dead stall.
            2 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            3 => TickInput { gear: 1, clutch: 0, ..Default::default() },
            // Restart: clutch in, neutral, key held.
            4 => TickInput { clutch: 255, flags: TickInput::FLAG_IGNITION, ..Default::default() },
            _ => match stopped_at {
                None => {
                    braking |= v.front_bumper_m > 0.0 && stopping_point(v) >= 6.0 - 1.2;
                    if braking {
                        TickInput { gear: 1, clutch: 255, brake: 255, steering: -200, ..Default::default() }
                    } else {
                        TickInput { gear: 1, clutch: 150, throttle: 120, steering: 200, ..Default::default() }
                    }
                }
                Some(at) if t - at < 60 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
                // The handbrake goes before the clutch bites, so the car rolls back a little.
                Some(at) => {
                    let clutch = 255u32.saturating_sub((t - at - 60) / 2).max(185) as u8;
                    let flags = if clutch > 245 { HANDBRAKE } else { 0 };
                    TickInput { gear: 1, clutch, throttle: 60, flags, ..Default::default() }
                }
            },
        }
    });
    Golden { name: "dung_khoi_hanh_doc_messy", seed, inputs }
}

// ---------------------------------------------------------------------------------------------
// Bài 2, bài 9 and bài 11 — the straight-road exercises. Same rule as the others: the trace is a
// fixed script, recorded from a driver that reads the state it can see, so it says what to do at a
// *place* ("brake to stop 0,3 m short of the line"), never at a tick number.
// ---------------------------------------------------------------------------------------------

const CROSSWALK: u64 = 2 << 56;
const RAIL: u64 = 9 << 56;
const FINISH: u64 = 11 << 56;

/// Where the stop line and the finish line sit on the road scene's axis, from the ruleset, so the
/// traces follow a layout change instead of quietly driving to a stale number.
fn road_lines() -> (f64, f64) {
    let rs = crate::rules::Ruleset::load();
    (rs.road.stop_line_m(), rs.road.finish_m())
}

/// Parked as the exercise opens: clutch pressed, neutral, handbrake on, engine idling.
fn road_park() -> TickInput {
    TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() }
}

/// A clean bài 2 or bài 9: drive up, stop `stop_short_m` short of the line (negative: past it),
/// hold two seconds, then pull away and out past the line. `flags` is whatever the car keeps on.
fn road_stop(seed: u64, name: &'static str, stop_short_m: f64, flags: u8) -> Golden {
    let (line, _) = road_lines();
    let mut stopped_at: Option<u32> = None;
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        if v.phase == crate::Phase::Stopped && stopped_at.is_none() {
            stopped_at = Some(t);
        }
        match stopped_at {
            None if t < 20 => road_park(),
            None => {
                // Decided once and kept: a car that has begun to brake does not let go again.
                braking |= stopping_point(v) >= line - stop_short_m;
                if braking {
                    TickInput { gear: 1, clutch: 255, brake: 255, flags, ..Default::default() }
                } else {
                    TickInput { gear: 1, clutch: 168, throttle: 80, flags, ..Default::default() }
                }
            }
            // Held at the line for two seconds, gear in, clutch pressed.
            Some(at) if t - at < 120 => TickInput { gear: 1, clutch: 255, brake: 255, flags, ..Default::default() },
            // Pull away and go on past the line: that is what ends the exercise.
            Some(_) => TickInput { gear: 1, clutch: 150, throttle: 90, flags, ..Default::default() },
        }
    });
    Golden { name, seed, inputs }
}

/// A messy bài 2 or bài 9: rev past 4000, a dead stall and a restart, then a stop at the line that
/// is wrong in the way the exercise is about — short of the line for bài 2, past it for bài 9 — and
/// the run still goes on and ends. Several different faults, each on the rule it belongs to.
fn road_messy(seed: u64, name: &'static str, stop_short_m: f64) -> Golden {
    let (line, _) = road_lines();
    let mut stage = 0u8;
    let mut braking = false;
    let mut stopped_at: Option<u32> = None;
    let inputs = record_to_the_end(seed, |v, t| {
        if v.phase == crate::Phase::Stopped && stopped_at.is_none() {
            stopped_at = Some(t);
        }
        match stage {
            0 if t >= 20 => stage = 1,
            1 if v.rpm > 4300.0 => stage = 2,
            2 if v.rpm < 900.0 => stage = 3,
            3 if !v.engine_on => stage = 4,
            4 if v.engine_on => stage = 5,
            _ => {}
        }
        if stage < 5 {
            return match stage {
                0 => road_park(),
                1 => TickInput { clutch: 255, throttle: 255, flags: HANDBRAKE, ..Default::default() },
                2 => road_park(),
                3 => TickInput { gear: 1, clutch: 0, ..Default::default() },
                _ => TickInput { clutch: 255, flags: TickInput::FLAG_IGNITION, ..Default::default() },
            };
        }
        match stopped_at {
            None => {
                braking |= stopping_point(v) >= line - stop_short_m;
                if braking {
                    TickInput { gear: 1, clutch: 255, brake: 255, ..Default::default() }
                } else {
                    TickInput { gear: 1, clutch: 150, throttle: 110, ..Default::default() }
                }
            }
            Some(at) if t - at < 90 => TickInput { gear: 1, clutch: 255, brake: 255, ..Default::default() },
            Some(_) => TickInput { gear: 1, clutch: 150, throttle: 90, ..Default::default() },
        }
    });
    Golden { name, seed, inputs }
}

/// A clean bài 11: right signal on, drive over the finish line, stop. No rule fires.
fn finish_clean(seed: u64, name: &'static str) -> Golden {
    let (_, finish) = road_lines();
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        if t < 20 {
            return TickInput { clutch: 255, flags: HANDBRAKE | RIGHT, ..Default::default() };
        }
        // Brake so as to stop a couple of metres past the line: "lái xe qua vạch kết thúc và dừng
        // xe" is the whole step.
        braking |= stopping_point(v) >= finish + 2.0;
        if braking {
            TickInput { gear: 1, clutch: 255, brake: 255, flags: RIGHT, ..Default::default() }
        } else {
            TickInput { gear: 1, clutch: 150, throttle: 80, flags: RIGHT, ..Default::default() }
        }
    });
    Golden { name, seed, inputs }
}

/// A messy bài 11: rev past 4000, a dead stall and a restart, then the finish line crossed with the
/// right signal off — the one mistake this exercise is about — and the car stops past it.
fn finish_messy(seed: u64, name: &'static str) -> Golden {
    let (_, finish) = road_lines();
    let mut stage = 0u8;
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        match stage {
            0 if t >= 20 => stage = 1,
            1 if v.rpm > 4300.0 => stage = 2,
            2 if v.rpm < 900.0 => stage = 3,
            3 if !v.engine_on => stage = 4,
            4 if v.engine_on => stage = 5,
            _ => {}
        }
        if stage < 5 {
            return match stage {
                0 => road_park(),
                1 => TickInput { clutch: 255, throttle: 255, flags: HANDBRAKE, ..Default::default() },
                2 => road_park(),
                3 => TickInput { gear: 1, clutch: 0, ..Default::default() },
                _ => TickInput { clutch: 255, flags: TickInput::FLAG_IGNITION, ..Default::default() },
            };
        }
        braking |= stopping_point(v) >= finish + 2.0;
        if braking {
            TickInput { gear: 1, clutch: 255, brake: 255, ..Default::default() }
        } else {
            TickInput { gear: 1, clutch: 150, throttle: 90, ..Default::default() }
        }
    });
    Golden { name, seed, inputs }
}

pub fn crosswalk_clean() -> Golden {
    road_stop(CROSSWALK | 1, "dung_xe_nhuong_nguoi_di_bo_clean", 0.3, 0)
}

pub fn crosswalk_messy() -> Golden {
    road_messy(CROSSWALK | 0x0123_4567_89ab, "dung_xe_nhuong_nguoi_di_bo_messy", 1.2)
}

pub fn rail_clean() -> Golden {
    road_stop(RAIL | 1, "tam_dung_duong_sat_clean", 0.3, 0)
}

pub fn rail_messy() -> Golden {
    road_messy(RAIL | 0x0123_4567_89ab, "tam_dung_duong_sat_messy", -0.6)
}

pub fn finish_golden_clean() -> Golden {
    finish_clean(FINISH | 1, "ket_thuc_clean")
}

pub fn finish_golden_messy() -> Golden {
    finish_messy(FINISH | 0x0123_4567_89ab, "ket_thuc_messy")
}

// ---------------------------------------------------------------------------------------------
// Bài 5 — the light exercise. Its goldens are the seeds as much as the scripts: a seed whose phase
// offset puts red in front of the car, one that puts green there, and one messy run with three
// different faults in it.
// ---------------------------------------------------------------------------------------------

const JUNCTION: u64 = 5 << 56;

/// The seed for bài 5 whose offset lands in `colour` (1 red, 2 yellow, 3 green).
fn junction_seed(colour: u8) -> u64 {
    let j = crate::rules::Ruleset::load().junction;
    let cycle = u64::from(j.cycle_ticks());
    for low in 1..cycle {
        let seed = JUNCTION | low;
        if j.light_at((seed % cycle) as u32) == colour {
            return seed;
        }
    }
    panic!("the light cycle has no colour {colour}");
}

/// Drive bài 5's route by the centreline the page draws. `obey` stops at the line for red and
/// yellow; `signal_at` is the bumper distance at which the right indicator goes on (a huge number
/// means it never does). `boundary` steers out onto the right-hand line once past the stop line,
/// which is the SAI_VACH_KE run.
fn junction_pass(seed: u64, name: &'static str, obey: bool, signal_at: f64, boundary: bool) -> Golden {
    let mut s = Session::new(seed).expect("bài 5 runs");
    let pts = centreline(&s.course_block());
    let len = path_length(&pts);
    let total = len;
    let line = crate::rules::Ruleset::load().junction.stop_line_m();
    let progress_of = |x: f64, y: f64| -> f64 {
        let mut best = (f64::INFINITY, 0.0);
        let mut travelled = 0.0;
        for w in pts.windows(2) {
            let (dx, dy) = (w[1].0 - w[0].0, w[1].1 - w[0].1);
            let len2 = dx * dx + dy * dy;
            let t = if len2 > 0.0 {
                (((x - w[0].0) * dx + (y - w[0].1) * dy) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let d = f64::sqrt((x - (w[0].0 + t * dx)).powi(2) + (y - (w[0].1 + t * dy)).powi(2));
            let seg = f64::sqrt(len2);
            if d < best.0 {
                best = (d, travelled + t * seg);
            }
            travelled += seg;
        }
        best.1
    };
    let mut inputs = Vec::new();
    let mut waiting = false;
    for _ in 0..300 * 60u32 {
        let snap = s.snapshot();
        let p = progress_of(snap[4], snap[5]);
        let signalling = snap[9] >= signal_at;
        let flags = if signalling { RIGHT } else { 0 };
        if obey && snap[46] != 3.0 && snap[46] != 0.0 && snap[9] < line - 0.2 {
            let stop_distance = snap[7] * snap[7] / (2.0 * 6.9);
            if snap[9] + stop_distance >= line - 0.3 {
                waiting = true;
            }
        }
        let input = if waiting && snap[46] != 3.0 {
            TickInput { gear: 1, clutch: 255, brake: 255, flags, ..Default::default() }
        } else {
            waiting = false;
            let (Some(a), Some(b), Some(c)) = (
                point_at(&pts, (p - 0.5).max(0.0)),
                point_at(&pts, p.min(total - 0.05)),
                point_at(&pts, p + 0.5),
            ) else {
                break;
            };
            let steer = if boundary && snap[9] > line + 1.0 { -3000 } else { steer_for(curvature(a, b, c)) };
            let want = if p < line { 3.0 } else { 15.0 / 3.6 };
            TickInput {
                steering: steer,
                gear: 1,
                clutch: 150,
                throttle: if snap[7] < want - 0.3 { 90 } else if snap[7] > want + 0.4 { 0 } else { 40 },
                brake: if snap[7] > want + 0.9 { 90 } else { 0 },
                flags,
                ..Default::default()
            }
        };
        s.step(input);
        inputs.push(input);
        let v = s.view();
        if v.phase == crate::Phase::Done || v.disqualified {
            break;
        }
    }
    let _ = len;
    Golden { name, seed, inputs }
}

/// A clean bài 5 that arrives on red: it waits in A at the line and goes on when the light turns
/// green. This is the run the exercise is for.
pub fn junction_red_clean() -> Golden {
    junction_pass(junction_seed(1), "qua_nga_tu_den_do_clean", true, 0.0, false)
}

/// A clean bài 5 that arrives on green: no stop is needed, and none is made.
pub fn junction_green_clean() -> Golden {
    junction_pass(junction_seed(3), "qua_nga_tu_den_xanh_clean", false, 0.0, false)
}

/// A messy bài 5: through the junction on red, with no turn signal. Two faults the law lists, on
/// the run that shows both.
pub fn junction_messy() -> Golden {
    junction_pass(junction_seed(1), "qua_nga_tu_messy", false, 1.0e9, false)
}

/// A messy bài 5 with the third fault: the car drifts onto the right-hand boundary line on its way
/// out of the turn, which is the suspension (SAI_VACH_KE) — a separate golden because the run ends
/// on it, so it cannot share a trace with the deductions above.
pub fn junction_line_messy() -> Golden {
    junction_pass(junction_seed(3), "qua_nga_tu_de_vach_messy", false, 0.0, true)
}

pub fn vet_clean() -> Golden {
    figure_pass(VET | 1, "qua_vet_banh_xe_clean")
}

pub fn vet_messy() -> Golden {
    figure_messy(VET | 0x0123_4567_89ab, "qua_vet_banh_xe_messy")
}

pub fn curve_clean() -> Golden {
    figure_pass(CURVE | 1, "qua_duong_vong_quanh_co_clean")
}

pub fn curve_messy() -> Golden {
    figure_messy(CURVE | 0x0123_4567_89ab, "qua_duong_vong_quanh_co_messy")
}

// ---------------------------------------------------------------------------------------------
// Bài 7 and bài 8 — the two bay exercises.
//
// The clean run is the line a patient driver can actually hold: a diagonal launch pose reached
// forward in the lane, then a reverse with at most one steering change, then straight back into the
// bay. Starting the reverse from a DIAGONAL pose is what makes it clean — a lane-parallel start
// forces a sharper arc and brushes the bay's side line (measured: the best symmetric two-arc from a
// parallel start misses by 2 mm).
//
// The legs are `(direction, steer, arc length)`. The length is recomputed from the leg's two poses
// (`dθ = dir·tanδ/L·s`), so it does not inherit the search's 5 cm grid; the core's path depends only
// on distance and steering, never on speed, so a leg reproduces its arc at any pace. Every leg is
// driven to a full stop with the wheel set while the car stands still.
// ---------------------------------------------------------------------------------------------

const DOC: u64 = 7 << 56;
const NGANG: u64 = 8 << 56;

/// One leg of a bay line: `(from pose, to pose, direction, steer as a fraction of full lock)`.
type GhepLeg = ((f64, f64, f64), (f64, f64, f64), f64, f64);

fn ghep_arc_len(leg: &GhepLeg) -> f64 {
    let (from, to, _dir, steer) = leg;
    let mut d = to.2 - from.2;
    let pi = core::f64::consts::PI;
    while d > pi {
        d -= 2.0 * pi;
    }
    while d < -pi {
        d += 2.0 * pi;
    }
    let tan_delta = libm::tan(steer * MAX_STEER_RAD);
    if tan_delta.abs() < 1e-12 {
        libm::sqrt((to.0 - from.0) * (to.0 - from.0) + (to.1 - from.1) * (to.1 - from.1))
    } else {
        libm::fabs(d * WHEELBASE_M / tan_delta)
    }
}

const WHEELBASE_M: f64 = 2.4;
const MAX_STEER_RAD: f64 = 0.55;

/// Drive a bay line in a live session and freeze the inputs. The one deviation from an open script
/// is that the final leg keeps going until the hull is inside the bay: the end pose the line was
/// planned to is quantised to the planner's grid, so its arc can stop a couple of centimetres short.
fn ghep_clean(seed: u64, name: &'static str, legs: &[GhepLeg]) -> Golden {
    let mut s = Session::new(seed).expect("a bay exercise");
    let mut inputs = Vec::new();
    let mut drive = |s: &mut Session, inputs: &mut Vec<TickInput>, input: TickInput, stop_at: Option<f64>| -> bool {
        s.step(input);
        inputs.push(input);
        let v = s.snapshot()[7];
        stop_at.is_some_and(|_| v == 0.0)
    };

    // Idle on the handbrake while the figure settles.
    for _ in 0..15 {
        s.step(TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() });
        inputs.push(TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() });
    }

    for (i, leg) in legs.iter().enumerate() {
        let (_, _, dir, steer) = *leg;
        let gear: i8 = if dir > 0.0 { 1 } else { -1 };
        let st = (steer * 32767.0).clamp(-32767.0, 32767.0) as i16;
        // Come to a full stop first: the wheel is only turned while the car stands still.
        for _ in 0..300 {
            let done = drive(&mut s, &mut inputs, TickInput { gear, clutch: 255, brake: 255, ..Default::default() }, Some(0.0));
            if done { break }
        }
        let len = ghep_arc_len(leg);
        let last = i + 1 == legs.len();
        let sn = s.snapshot();
        let (mut px, mut py) = (sn[4], sn[5]);
        let mut travelled = 0.0f64;
        let mut release = 0u32;
        for _ in 0..4000 {
            let sn = s.snapshot();
            let (x, y, v) = (sn[4], sn[5], sn[7]);
            travelled += libm::sqrt((x - px) * (x - px) + (y - py) * (y - py));
            px = x;
            py = y;
            // The last leg stops when the hull is inside, not at the planned arc length.
            let remaining = if last && sn[51] == 0.0 { f64::INFINITY } else { len - travelled };
            let stop_dist = v * v / (2.0 * 6.9);
            let braking = remaining.is_finite() && remaining <= stop_dist + 0.02;
            let input = if braking {
                TickInput { gear, clutch: 255, brake: 255, steering: st, ..Default::default() }
            } else if v * dir > 0.85 {
                TickInput { gear, clutch: 255, brake: 120, steering: st, ..Default::default() }
            } else if dir > 0.0 {
                TickInput { gear, clutch: 175, throttle: if v < 0.70 { 55 } else { 0 }, steering: st, ..Default::default() }
            } else if v.abs() < 0.55 && release == 0 {
                release = 6;
                TickInput { gear, clutch: 212, steering: st, ..Default::default() }
            } else if release > 0 {
                release -= 1;
                TickInput { gear, clutch: 212, steering: st, ..Default::default() }
            } else {
                TickInput { gear, clutch: 255, brake: 110, steering: st, ..Default::default() }
            };
            let done = drive(&mut s, &mut inputs, input, Some(0.0));
            if s.view().disqualified { return Golden { name, seed, inputs } }
            if braking && done { break }
            if last && sn[51] == 1.0 && s.snapshot()[7] == 0.0 { break }
        }
    }

    // Stand still and let the yard's signal end the run.
    for _ in 0..120 {
        s.step(TickInput { gear: -1, clutch: 255, brake: 255, ..Default::default() });
        inputs.push(TickInput { gear: -1, clutch: 255, brake: 255, ..Default::default() });
        if s.snapshot()[52] == 1.0 { break }
    }
    Golden { name, seed, inputs }
}

pub fn ghep_doc_clean() -> Golden {
    let pi = core::f64::consts::PI;
    let legs: [( (f64, f64, f64), (f64, f64, f64), f64, f64); 8] = [
        ((10.140, 2.520, pi), (9.199, 2.405, 193.9f64 * pi / 180.0), 1.0, 1.0),
        ((9.199, 2.405, 193.9f64 * pi / 180.0), (7.077, 2.473, 162.4f64 * pi / 180.0), 1.0, -1.0),
        ((7.077, 2.473, 162.4f64 * pi / 180.0), (3.768, 2.027, 212.9f64 * pi / 180.0), 1.0, 1.0),
        ((3.768, 2.027, 212.9f64 * pi / 180.0), (0.130, 1.700, 157.3f64 * pi / 180.0), 1.0, -1.0),
        ((0.130, 1.700, 157.3f64 * pi / 180.0), (-0.294, 1.850, 163.9f64 * pi / 180.0), 1.0, 1.0),
        ((-0.294, 1.850, 163.9f64 * pi / 180.0), (-2.132, 3.007, 131.7f64 * pi / 180.0), 1.0, -1.0),
        ((-2.132, 3.007, 131.7f64 * pi / 180.0), (-1.141, 0.302, 88.5f64 * pi / 180.0), -1.0, 1.0),
        ((-1.141, 0.302, 88.5f64 * pi / 180.0), (-1.204, -2.148, 88.5f64 * pi / 180.0), -1.0, 0.0),
    ];
    ghep_clean(DOC | 1, "ghep_doc_clean", &legs)
}

pub fn ghep_ngang_clean() -> Golden {
    let pi = core::f64::consts::PI;
    let legs: [((f64, f64, f64), (f64, f64, f64), f64, f64); 8] = [
        ((-5.100, 1.760, 0.0), (-3.919, 1.578, -17.6f64 * pi / 180.0), 1.0, -1.0),
        ((-3.919, 1.578, -17.6f64 * pi / 180.0), (-1.943, 1.476, 11.7f64 * pi / 180.0), 1.0, 1.0),
        ((-1.943, 1.476, 11.7f64 * pi / 180.0), (1.602, 0.429, -44.6f64 * pi / 180.0), 1.0, -1.0),
        ((1.602, 0.429, -44.6f64 * pi / 180.0), (2.183, -0.044, -33.7f64 * pi / 180.0), 1.0, 1.0),
        ((2.183, -0.044, -33.7f64 * pi / 180.0), (2.306, -0.130, -35.9f64 * pi / 180.0), 1.0, -1.0),
        ((2.306, -0.130, -35.9f64 * pi / 180.0), (4.200, -0.851, -5.9f64 * pi / 180.0), 1.0, 1.0),
        ((4.200, -0.851, -5.9f64 * pi / 180.0), (3.401, -0.851, 5.9f64 * pi / 180.0), -1.0, -1.0),
        ((3.401, -0.851, 5.9f64 * pi / 180.0), (3.102, -0.870, 1.5f64 * pi / 180.0), -1.0, 1.0),
    ];
    ghep_clean(NGANG | 1, "ghep_ngang_clean", &legs)
}

/// A messy bay run: no line-up at all. The car drives past the bay, reverses in on full lock
/// straight from the lane, and touches the bay's paint on the way (DE_VACH). It stops there, still
/// on the line, so the episode runs past the five-second mark (DE_VACH_KEO_DAI), and then ends the
/// exam on the stop key with the body outside the bay (CHUA_VAO_CHUONG).
///
/// Three faults a learner actually makes, each on its own row, and the run ends without being
/// suspended: reversing on full lock from a lane-parallel pose is exactly the mistake the clean
/// line's diagonal launch pose avoids.
fn ghep_messy(seed: u64, name: &'static str) -> Golden {
    let doc = seed >> 56 == 7;
    let mut s = Session::new(seed).expect("a bay exercise");
    let mut inputs = Vec::new();
    let mut stage = 0u8;
    let mut release = 0u32;
    for _ in 0..8000u32 {
        let snap = s.snapshot();
        let v = snap[7];
        let longest = snap[37];
        match stage {
            0 if snap[0] > 15.0 => stage = 1,
            // Forward, past the bay's mouth so the reverse has to turn in from outside it.
            1 if (if doc { snap[4] <= -1.0 } else { snap[4] >= 7.0 }) => stage = 2,
            2 if v == 0.0 => stage = 3,
            // Reverse on full lock until a wheel touches the paint.
            3 if longest > 0.0 => stage = 4,
            // Stand still on the line while the episode runs to its five-second mark.
            4 if longest >= 5.4 => stage = 5,
            _ => {}
        }
        let steer = if doc { -24000i16 } else { 24000 };
        let input = match stage {
            0 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            1 => TickInput { gear: 1, clutch: 168, throttle: 60, ..Default::default() },
            2 => TickInput { gear: 1, clutch: 255, brake: 255, ..Default::default() },
            3 => {
                if v.abs() < 0.5 && release == 0 {
                    release = 6;
                    TickInput { gear: -1, clutch: 212, steering: steer, ..Default::default() }
                } else if release > 0 {
                    release -= 1;
                    TickInput { gear: -1, clutch: 212, steering: steer, ..Default::default() }
                } else {
                    TickInput { gear: -1, clutch: 255, brake: 110, steering: steer, ..Default::default() }
                }
            }
            // Stopped on the line: hold the brake and keep the wheel where it is.
            4 => TickInput { gear: -1, clutch: 255, brake: 255, steering: steer, ..Default::default() },
            // End the exam on the stop key, out of position.
            _ => TickInput {
                clutch: 255,
                brake: 255,
                flags: TickInput::FLAG_START_ORDER,
                ..Default::default()
            },
        };
        s.step(input);
        inputs.push(input);
        let v = s.view();
        if v.phase == crate::Phase::Done || v.disqualified { break }
    }
    Golden { name, seed, inputs }
}

pub fn ghep_doc_messy() -> Golden {
    ghep_messy(DOC | 0x0123_4567_89ab, "ghep_doc_messy")
}

pub fn ghep_ngang_messy() -> Golden {
    ghep_messy(NGANG | 0x0123_4567_89ab, "ghep_ngang_messy")
}

pub fn all() -> [Golden; 22] {
    [
        clean_pass(),
        messy_run(),
        hill_clean(),
        hill_messy(),
        vet_clean(),
        vet_messy(),
        curve_clean(),
        curve_messy(),
        crosswalk_clean(),
        crosswalk_messy(),
        rail_clean(),
        rail_messy(),
        finish_golden_clean(),
        finish_golden_messy(),
        junction_red_clean(),
        junction_green_clean(),
        junction_messy(),
        junction_line_messy(),
        ghep_doc_clean(),
        ghep_doc_messy(),
        ghep_ngang_clean(),
        ghep_ngang_messy(),
    ]
}

pub fn run(g: &Golden) -> Session {
    let mut s = Session::new(g.seed).expect("a known exercise");
    for &input in &g.inputs {
        s.step(input);
    }
    s
}

/// Serialised form the runners read: seed then the input records.
pub fn encode(g: &Golden) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + g.inputs.len() * TickInput::WIRE_LEN);
    out.extend_from_slice(&g.seed.to_le_bytes());
    for i in &g.inputs {
        out.extend_from_slice(&wire(*i));
    }
    out
}

fn wire(i: TickInput) -> [u8; TickInput::WIRE_LEN] {
    let mut b = [0u8; TickInput::WIRE_LEN];
    b[0..2].copy_from_slice(&i.steering.to_le_bytes());
    b[2] = i.throttle;
    b[3] = i.brake;
    b[4] = i.clutch;
    b[5] = i.gear as u8;
    b[6] = i.flags;
    b
}

pub fn hash_line(s: &Session) -> String {
    format!("{:016x}\n", s.hash())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every golden's committed hash, in `all()` order. All eight, so `cargo test` pins every one of
    /// them: a zip against a shorter list would silently leave the tail unpinned, and a hash file
    /// full of ffff would still pass.
    const COMMITTED: [(&str, &str); 22] = [
        ("xuat_phat_clean", include_str!("../../../golden/xuat_phat_clean.hash")),
        ("xuat_phat_messy", include_str!("../../../golden/xuat_phat_messy.hash")),
        ("dung_khoi_hanh_doc_clean", include_str!("../../../golden/dung_khoi_hanh_doc_clean.hash")),
        ("dung_khoi_hanh_doc_messy", include_str!("../../../golden/dung_khoi_hanh_doc_messy.hash")),
        ("qua_vet_banh_xe_clean", include_str!("../../../golden/qua_vet_banh_xe_clean.hash")),
        ("qua_vet_banh_xe_messy", include_str!("../../../golden/qua_vet_banh_xe_messy.hash")),
        ("qua_duong_vong_quanh_co_clean", include_str!("../../../golden/qua_duong_vong_quanh_co_clean.hash")),
        ("qua_duong_vong_quanh_co_messy", include_str!("../../../golden/qua_duong_vong_quanh_co_messy.hash")),
        ("dung_xe_nhuong_nguoi_di_bo_clean", include_str!("../../../golden/dung_xe_nhuong_nguoi_di_bo_clean.hash")),
        ("dung_xe_nhuong_nguoi_di_bo_messy", include_str!("../../../golden/dung_xe_nhuong_nguoi_di_bo_messy.hash")),
        ("tam_dung_duong_sat_clean", include_str!("../../../golden/tam_dung_duong_sat_clean.hash")),
        ("tam_dung_duong_sat_messy", include_str!("../../../golden/tam_dung_duong_sat_messy.hash")),
        ("ket_thuc_clean", include_str!("../../../golden/ket_thuc_clean.hash")),
        ("ket_thuc_messy", include_str!("../../../golden/ket_thuc_messy.hash")),
        ("qua_nga_tu_den_do_clean", include_str!("../../../golden/qua_nga_tu_den_do_clean.hash")),
        ("qua_nga_tu_den_xanh_clean", include_str!("../../../golden/qua_nga_tu_den_xanh_clean.hash")),
        ("qua_nga_tu_messy", include_str!("../../../golden/qua_nga_tu_messy.hash")),
        ("qua_nga_tu_de_vach_messy", include_str!("../../../golden/qua_nga_tu_de_vach_messy.hash")),
        ("ghep_doc_clean", include_str!("../../../golden/ghep_doc_clean.hash")),
        ("ghep_doc_messy", include_str!("../../../golden/ghep_doc_messy.hash")),
        ("ghep_ngang_clean", include_str!("../../../golden/ghep_ngang_clean.hash")),
        ("ghep_ngang_messy", include_str!("../../../golden/ghep_ngang_messy.hash")),
    ];

    /// The committed `.hash` files must match what the code produces today. A failure means the
    /// simulation changed: re-record with `cargo run -p sim-core --example gen_golden` on purpose.
    #[test]
    fn committed_golden_hashes_match_the_simulation() {
        let goldens = all();
        assert_eq!(
            goldens.len(),
            COMMITTED.len(),
            "every golden must be pinned by a committed hash, or the unpinned ones cannot fail"
        );
        for (g, committed) in goldens.iter().zip(COMMITTED) {
            assert_eq!(g.name, committed.0);
            assert_eq!(hash_line(&run(g)), committed.1, "golden {} drifted", g.name);
        }
    }

    /// The committed `.trace` bytes must be exactly what the generator writes.
    #[test]
    fn committed_golden_traces_match_the_generator() {
        for g in all() {
            let path = format!("{}/../../golden/{}.trace", env!("CARGO_MANIFEST_DIR"), g.name);
            let on_disk = std::fs::read(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
            assert_eq!(on_disk, encode(&g), "golden {} trace drifted", g.name);
        }
    }

    /// Same trace twice: same hash. Guards against hidden state the hash does not cover.
    #[test]
    fn same_trace_run_twice_gives_the_same_hash() {
        for g in all() {
            let a = run(&g).hash();
            let b = run(&g).hash();
            assert_eq!(a, b, "golden {} is not reproducible", g.name);
        }
    }

    /// One bit in one input must move the hash *and* the simulation behind it. The second half is
    /// what stops this passing vacuously: a hash that happened to vary (through the PRNG, say)
    /// while the car computed the same thing would satisfy the first half alone.
    #[test]
    fn flipping_one_input_bit_changes_the_hash_and_the_state() {
        let mut g = clean_pass();
        let before = run(&g);
        let baseline = (before.hash(), before.view().front_bumper_m, before.view().rpm);

        // Flip the lowest bit of the throttle on one frame in the middle of the launch.
        g.inputs[70].throttle ^= 1;
        let after = run(&g);
        let moved = (after.hash(), after.view().front_bumper_m, after.view().rpm);

        assert_ne!(moved.0, baseline.0, "a one-bit input change left the hash alone");
        assert!(
            moved.1 != baseline.1 || moved.2 != baseline.2,
            "the hash moved but the car did not: {baseline:?} vs {moved:?}"
        );
    }

    /// A cranking attempt in progress is state: two runs that differ only in when the key went
    /// down must not share a hash, or a mid-run hash comparison could miss a real difference.
    #[test]
    fn hash_covers_the_starter_progress() {
        let idle = TickInput { clutch: 255, flags: TickInput::FLAG_BELT, ..TickInput::default() };
        let key = TickInput { flags: idle.flags | TickInput::FLAG_IGNITION, ..idle };
        let hash_after = |first: TickInput| {
            let mut s = Session::new(messy_run().seed).unwrap();
            for &input in &messy_run().inputs {
                s.step(input);
                if !s.view().engine_on {
                    break;
                }
            }
            assert!(!s.view().engine_on, "the messy trace must stall the engine");
            s.step(first);
            s.step(key);
            s.hash()
        };
        assert_ne!(hash_after(idle), hash_after(key));
    }

    /// The messy trace must actually move the float paths it exists for: the rpm past 4000, the
    /// engine dead at least once, and the left signal off outside the window.
    #[test]
    fn messy_trace_exercises_the_float_paths() {
        let mut s = Session::new(messy_run().seed).unwrap();
        let mut peak_rpm: f64 = 0.0;
        let mut saw_dead_engine = false;
        for &input in &messy_run().inputs {
            s.step(input);
            let v = s.view();
            peak_rpm = peak_rpm.max(v.rpm);
            saw_dead_engine |= !v.engine_on;
        }
        let v = s.view();
        assert!(saw_dead_engine, "the messy trace must stall the engine");
        assert!(peak_rpm > 4000.0, "the messy trace must pass 4000 rpm, got {peak_rpm}");
        assert!(v.fired("SH.01.XI_NHAN_KHONG_KIP") >= 1, "the signal was used untimely");
        assert!(v.fired("SH.X.CHET_MAY") >= 1, "the stall was scored");
    }

    /// The clean trace must be clean: no rule fires at all.
    #[test]
    fn clean_trace_scores_nothing() {
        let v = run(&clean_pass());
        let v = v.view();
        assert_eq!(v.fired_ids(), Vec::<&str>::new(), "clean run must be clean");
        assert_eq!(v.score, 100);
    }

    /// The bài 3 goldens must be what they claim: the clean one scores nothing and ends over the
    /// line; the messy one takes several deductions, rolls back a little without being charged,
    /// and still ends by crossing the line.
    #[test]
    fn hill_goldens_are_what_they_claim() {
        let clean = run(&hill_clean());
        let v = clean.view();
        assert_eq!((v.fired_ids(), v.score, v.phase), (Vec::<&str>::new(), 100, crate::Phase::Done));

        let mut messy = Session::new(hill_messy().seed).unwrap();
        let mut peak_rollback: f64 = 0.0;
        for &input in &hill_messy().inputs {
            messy.step(input);
            peak_rollback = peak_rollback.max(messy.snapshot()[23]);
        }
        let v = messy.view();
        assert_eq!(v.fired_ids(), vec!["SH.X.RPM", "SH.X.CHET_MAY", "SH.03.CHUA_DEN_VACH"]);
        assert_eq!((v.score, v.disqualified, v.phase), (85, false, crate::Phase::Done));
        assert!(peak_rollback > 0.1 && peak_rollback < 0.5, "a rollback inside 500 mm, got {peak_rollback}");

        // The last record is the step that ends the run: the runners' negative control flips a bit
        // in it, and a step after the end would ignore the flip.
        for g in [hill_clean(), hill_messy()] {
            let mut s = Session::new(g.seed).unwrap();
            for &input in &g.inputs[..g.inputs.len() - 1] {
                s.step(input);
            }
            assert_ne!(s.view().phase, crate::Phase::Done, "{} runs on after the end", g.name);
        }
    }

    /// The bài 2, bài 9 and bài 11 goldens must be what their names say: the clean ones score
    /// nothing, and each messy one carries the faults it exists for.
    #[test]
    fn road_goldens_are_what_they_claim() {
        for g in [crosswalk_clean(), rail_clean(), finish_golden_clean()] {
            let s = run(&g);
            let v = s.view();
            assert_eq!(v.fired_ids(), Vec::<&str>::new(), "{} must be clean", g.name);
            assert_eq!(v.score, 100, "{}", g.name);
            assert_eq!(v.phase, crate::Phase::Done, "{} must end at its own end mark", g.name);
        }

        // bài 2 stops short of the line: CHUA_DEN_VACH, on top of the two engine faults.
        let v = run(&crosswalk_messy());
        let v = v.view();
        assert_eq!(
            v.fired_ids(),
            vec!["SH.X.RPM", "SH.X.CHET_MAY", "SH.02.CHUA_DEN_VACH"],
            "bài 2's messy run"
        );
        assert_eq!(v.score, 85);
        assert_eq!(v.phase, crate::Phase::Done, "and it still ends");

        // bài 9 stops past the line: QUA_VACH.
        let v = run(&rail_messy());
        let v = v.view();
        assert_eq!(
            v.fired_ids(),
            vec!["SH.X.RPM", "SH.X.CHET_MAY", "SH.DS.QUA_VACH"],
            "bài 9's messy run"
        );
        assert_eq!(v.score, 85);

        // bài 11 crosses the finish line with no right signal: KHONG_XI_NHAN_PHAI.
        let v = run(&finish_golden_messy());
        let v = v.view();
        assert_eq!(
            v.fired_ids(),
            vec!["SH.X.RPM", "SH.X.CHET_MAY", "SH.KT.KHONG_XI_NHAN_PHAI"],
            "bài 11's messy run"
        );
        assert_eq!(v.score, 85);
        assert_eq!(v.phase, crate::Phase::Done, "it stops past the line and ends");
    }

    /// The bài 5 goldens must be what their names say, and the two clean ones must arrive on
    /// different lights — that is the whole reason the phase offset is part of the seed.
    #[test]
    fn junction_goldens_are_what_they_claim() {
        let red = run(&junction_red_clean());
        let v = red.view();
        assert_eq!(v.fired_ids(), Vec::<&str>::new(), "the red-light run is clean");
        assert_eq!((v.score, v.phase), (100, crate::Phase::Done));
        // It really did meet red and stop for it: the light was red on the approach tick, and the
        // run recorded a stop.
        assert!(red.snapshot()[24] >= 0.0, "the red run stopped at the line");

        let green = run(&junction_green_clean());
        let v = green.view();
        assert_eq!(v.fired_ids(), Vec::<&str>::new(), "the green-light run is clean");
        assert_eq!((v.score, v.phase), (100, crate::Phase::Done));
        assert_eq!(green.snapshot()[24], -1.0, "and it never had to stop");

        // The two clean runs must not be the same run with a different seed: they meet different
        // lights, so their traces differ.
        assert_ne!(hash_line(&red), hash_line(&green), "red and green are different runs");

        let messy = run(&junction_messy());
        let v = messy.view();
        // Both faults, each exactly once. The order is where they happen — the turn signal is judged
        // at the arc, the red-light run at the junction — so this asserts the set and the count, not
        // an order that a layout tweak would legitimately change.
        let mut ids = v.fired_ids();
        ids.sort_unstable();
        assert_eq!(ids, vec!["SH.05.KHONG_XI_NHAN", "SH.05.VUOT_DEN_DO"], "the messy run");
        assert_eq!(v.score, 85);
        assert_eq!(v.fired("SH.05.SAI_VACH_KE"), 0, "it stayed inside the route");

        let v = run(&junction_line_messy());
        let v = v.view();
        assert_eq!(v.fired_ids(), vec!["SH.05.SAI_VACH_KE"], "the boundary run: {:?}", v.fired_ids());
        assert!(v.disqualified, "a wheel on the route's line suspends the run");
    }

    /// The snapshot the web reads (`sim_state`) must say what the core actually consumed: feed a
    /// distinctive input, then read the same numbers back. The field order is the list in
    /// `lib.rs`; this indexes it, so a reorder breaks here instead of in TS.
    #[test]
    fn snapshot_reports_what_the_core_consumed() {
        let mut s = Session::new(2026).unwrap();
        for _ in 0..40 {
            s.step(TickInput { clutch: 255, flags: IGN, ..Default::default() });
        }
        let input = TickInput {
            steering: 1200,
            throttle: 70,
            brake: 30,
            clutch: 168,
            gear: 1,
            flags: TickInput::FLAG_BELT | TickInput::FLAG_SIGNAL_LEFT | TickInput::FLAG_START_ORDER,
        };
        s.step(input);

        let snap = s.snapshot();
        let v = s.view();
        assert_eq!(snap.len(), crate::SNAPSHOT_LEN, "the snapshot is the documented values");
        assert_eq!(snap[0], f64::from(v.tick));
        assert_eq!(
            snap[1],
            match v.phase {
                crate::Phase::Waiting => 0.0,
                crate::Phase::Launched => 1.0,
                crate::Phase::PastLine => 2.0,
                crate::Phase::Done => 3.0,
                crate::Phase::Stopped => 4.0,
            },
            "the order tick puts the run in Launched"
        );
        assert_eq!(snap[2], f64::from(v.score));
        assert_eq!(snap[3], 0.0, "not disqualified");
        assert_eq!(snap[7], v.speed_mps);
        assert_eq!(snap[8], v.rpm);
        assert_eq!(snap[9], v.front_bumper_m);
        assert_eq!(snap[10], f64::from(u8::from(v.engine_on)));
        assert_eq!(snap[13], 70.0 / 255.0, "throttle as consumed");
        assert_eq!(snap[14], 30.0 / 255.0, "brake as consumed");
        assert_eq!(snap[15], 168.0 / 255.0, "clutch as consumed");
        assert_eq!(snap[16], 1.0, "first gear");
        assert_eq!(snap[17], 0.0, "handbrake released");
        assert_eq!(snap[18], 1.0, "belt on");
        assert_eq!(snap[19], 1.0, "left signal");
        assert!(
            snap[12] > 0.0 && snap[12] < 0.55,
            "steer is the radian value the car moved with, got {}",
            snap[12]
        );
        // First gear, clutch partway out, engine at idle: the driveline drags it down, which is
        // what the audio uses to tell lugging from a free rev.
        assert!(snap[20] > 0.0, "engine load is positive while the clutch drags, got {}", snap[20]);
        // Fields 27..45 belong to bài 4 and bài 6 and are 0 in every other exercise, so a reader can
        // tell "no figure" from "a figure at 0" without knowing which exercise it is.
        assert!(
            snap[27..46].iter().all(|v| *v == 0.0),
            "bài 1 has no figure fields, got {:?}",
            &snap[27..46]
        );
    }
}
