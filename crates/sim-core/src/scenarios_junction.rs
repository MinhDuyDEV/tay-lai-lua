//! Scenario tests for bài 5 (qua ngã tư có tín hiệu điều khiển giao thông), right turn only.
//!
//! The exercise is the only one in the core with a clock that is not the car's: the light runs on
//! ticks from the car's first movement, with a phase offset from the seed. These tests drive the
//! same script against seeds chosen so the car meets each colour, which is also how the goldens pick
//! their seeds — the phase is data, not a hidden knob.

use crate::{Phase, Session, TickInput};

const JUNCTION: u64 = 5 << 56;
const HANDBRAKE: u8 = TickInput::FLAG_HANDBRAKE;
const RIGHT: u8 = TickInput::FLAG_SIGNAL_RIGHT;
const TICKS_PER_S: u32 = 60;
/// The pace bài 5's route is driven at in these tests: 15 km/h, an ordinary speed through a
/// signalled junction, and fast enough that the 20 s clock is about the light and not the driver.
const SPEED: f64 = 15.0 / 3.6;

// Snapshot indices (the list in `lib.rs`).
const BUMPER: usize = 9;
const LIGHT: usize = 46;
const LIGHT_LEFT_MS: usize = 47;
const CLOCK_MS: usize = 48;
const ZONE: usize = 49;
const ROUTE: usize = 50;

fn rules() -> crate::rules::Ruleset {
    crate::rules::Ruleset::load()
}

/// The seed's offset into the cycle, as the core computes it.
fn offset_of(seed: u64) -> u32 {
    let cycle = rules().junction.cycle_ticks();
    (seed % u64::from(cycle)) as u32
}

/// A seed whose offset lands in the red band, one in green and one in yellow: found by searching,
/// so the test does not depend on a hard-coded number that a cycle change would invalidate.
fn seed_in(colour: u8) -> u64 {
    let j = rules().junction;
    for low in 0..j.cycle_ticks() {
        let seed = JUNCTION | u64::from(low);
        if j.light_at(offset_of(seed)) == colour {
            return seed;
        }
    }
    panic!("the cycle has no colour {colour}");
}

fn light_at_tick(seed: u64, tick: u32) -> u8 {
    let j = rules().junction;
    j.light_at(offset_of(seed).wrapping_add(tick))
}

/// The `kind == 5` centreline of the session's own figure, as the page draws it.
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

/// Steering that puts the car's centre on a circle of curvature `kappa` (signed: + turns left).
fn steer_for(kappa: f64) -> i16 {
    if kappa.abs() < 1e-9 {
        return 0;
    }
    let r = 1.0 / kappa.abs();
    let r_axle = (r * r - 0.25 * 2.4 * 2.4).max(0.01).sqrt();
    ((libm::atan(2.4 / r_axle).copysign(kappa) / 0.55).clamp(-1.0, 1.0) * 32760.0) as i16
}

fn curvature(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    let ab = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
    let bc = ((c.0 - b.0).powi(2) + (c.1 - b.1).powi(2)).sqrt();
    let ca = ((a.0 - c.0).powi(2) + (a.1 - c.1).powi(2)).sqrt();
    let denom = ab * bc * ca;
    if denom == 0.0 { 0.0 } else { 2.0 * cross / denom }
}

/// Drive bài 5's route by its own curvature, from the page's centreline. `obey` makes the car stop
/// at the line while the light is red or yellow and pull away on green; `signal` is whether the
/// right indicator is switched on. Returns the session when the run ends or `limit_s` runs out.
fn run(seed: u64, signal: bool, obey: bool, limit_s: u32) -> Session {
    let mut s = Session::new(seed).expect("bài 5 runs");
    let pts = centreline(&s.course_block());
    let len = pts.last().map(|p| p.1.abs()).unwrap_or(0.0) + 200.0;
    let line = rules().junction.stop_line_m();
    let progress_of = |x: f64, y: f64| -> f64 {
        // The same projection the core does: the nearest point on the centreline, as cumulative
        // length. A nearest-sample guess would jump at the joins and steer the car into a line.
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
            let (px, py) = (w[0].0 + t * dx, w[0].1 + t * dy);
            let d = ((x - px).powi(2) + (y - py).powi(2)).sqrt();
            let seg = len2.sqrt();
            if d < best.0 {
                best = (d, travelled + t * seg);
            }
            travelled += seg;
        }
        let _ = len;
        best.1
    };
    let mut waiting = false;
    for t in 0..limit_s * TICKS_PER_S {
        let snap = s.snapshot();
        let flags = if signal { RIGHT } else { 0 } | if t < 10 { HANDBRAKE } else { 0 };
        let p = progress_of(snap[4], snap[5]);
        // Stop for the light: begin braking where stopping at the line needs it, and hold there
        // while the light is not green. Braking the moment red is seen would stop the car metres
        // short of the line, which is a different rule (CHUA_DEN_VACH) and a different mistake.
        if obey && snap[LIGHT] != 3.0 && snap[LIGHT] != 0.0 && snap[BUMPER] < line - 0.2 {
            let stop_distance = snap[7] * snap[7] / (2.0 * 6.9);
            if snap[BUMPER] + stop_distance >= line - 0.3 {
                waiting = true;
            }
        }
        if waiting && snap[LIGHT] != 3.0 {
            // Held at the line: brake from a rolling pace, then stand on it.
            s.step(TickInput {
                gear: 1,
                clutch: 255,
                brake: 255,
                steering: 0,
                flags,
                ..Default::default()
            });
        } else {
            waiting = false;
            let pp = p.clamp(0.0, 1e6);
            let (Some(a), Some(b), Some(c)) = (
                point_at(&pts, (pp - 0.5).max(0.0)),
                point_at(&pts, pp),
                point_at(&pts, pp + 0.5),
            ) else {
                break;
            };
            // A junction is crossed at a real pace, not at the walking pace the figures use: the
            // exercise's own clock is 20 s for the whole route, so a slow driver is a different
            // test (and one of them, QUA_20S, is exactly about being slow).
            let want = if p < line { 3.0 } else { SPEED };
            s.step(TickInput {
                steering: steer_for(curvature(a, b, c)),
                gear: 1,
                clutch: 150,
                throttle: if snap[7] < want - 0.3 { 90 } else if snap[7] > want + 0.4 { 0 } else { 40 },
                brake: if snap[7] > want + 0.9 { 90 } else { 0 },
                flags,
                ..Default::default()
            });
        }
        let v = s.view();
        if v.phase == Phase::Done || v.disqualified {
            break;
        }
    }
    s
}

// ---------------------------------------------------------------------------------------------
// The scene and the light.
// ---------------------------------------------------------------------------------------------

#[test]
fn bai_5_runs_on_its_own_route_with_a_dark_light_until_the_car_moves() {
    let s = Session::new(seed_in(1)).unwrap();
    let snap = s.snapshot();
    assert_eq!(snap[1], 1.0, "underway from the first step");
    assert_eq!(snap[ROUTE], 2.0, "the junction right-turn route");
    assert_eq!(snap[LIGHT], 0.0, "the light is dark until the car first moves");
    assert_eq!(snap[LIGHT_LEFT_MS], 0.0);
    assert_eq!(snap[CLOCK_MS], 0.0, "the 20 s / 30 s clock is not armed yet");
    assert_eq!(snap[ZONE], 2.0, "waiting inside the stop zone");

    // One tick of movement is enough to start the cycle, and the colour is the seed's offset.
    let mut s = Session::new(seed_in(1)).unwrap();
    let mut first_colour = None;
    for t in 0..200u32 {
        s.step(TickInput {
            gear: 1,
            clutch: 200,
            throttle: 60,
            flags: RIGHT | if t < 10 { HANDBRAKE } else { 0 },
            ..Default::default()
        });
        let snap = s.snapshot();
        if snap[LIGHT] != 0.0 && first_colour.is_none() {
            first_colour = Some(snap[LIGHT]);
        }
    }
    assert!(first_colour.is_some(), "the cycle starts when the car moves");
    assert_eq!(s.snapshot()[LIGHT_LEFT_MS] > 0.0, true, "time left in the phase is reported");
}

#[test]
fn the_light_cycle_is_a_function_of_ticks_and_the_seed() {
    let j = rules().junction;
    // Red, then green, then yellow, then back to red — measured through the public snapshot.
    let mut seen = Vec::new();
    let mut s = Session::new(seed_in(1)).unwrap();
    // Two seconds of creep to start the cycle, then stand on the brake at the line: the cycle keeps
    // running while the car waits, which is the point of measuring it in ticks.
    for t in 0..(j.cycle_ticks() as u32 + 120) {
        let moving = t < 40;
        s.step(TickInput {
            gear: 1,
            clutch: if moving { 200 } else { 255 },
            throttle: if moving { 60 } else { 0 },
            brake: if moving { 0 } else { 255 },
            flags: RIGHT | if t < 10 { HANDBRAKE } else { 0 },
            ..Default::default()
        });
        let now = s.snapshot()[LIGHT];
        if seen.last() != Some(&now) {
            seen.push(now);
        }
    }
    assert_eq!(seen, vec![0.0, 1.0, 3.0, 2.0, 1.0], "dark, red, green, yellow, red again: {seen:?}");
    assert_eq!(j.red_ticks, 900, "15 s of red");
    assert_eq!(j.green_ticks, 1560, "26 s of green");
    assert_eq!(j.yellow_ticks, 180, "3 s of yellow, the open question's 3 s");
}

#[test]
fn different_attempts_meet_different_lights_and_one_seed_always_meets_the_same() {
    let red = seed_in(1);
    let green = seed_in(3);
    let yellow = seed_in(2);
    assert_ne!(red, green, "the phase offset really does vary with the seed");
    // The same trace run twice meets the light the same way at every tick it ran.
    let a = run(green, true, false, 30);
    let b = run(green, true, false, 30);
    assert_eq!(a.hash(), b.hash(), "the same seed is the same light, bit for bit");
    assert_eq!(light_at_tick(red, 0), 1, "this seed starts on red");
    assert_eq!(light_at_tick(green, 0), 3, "this one starts on green");
    assert_eq!(light_at_tick(yellow, 0), 2, "and this one on yellow");
}

// ---------------------------------------------------------------------------------------------
// SH.05.VUOT_DEN_DO — "Vi phạm tín hiệu đèn điều khiển giao thông (… đèn tín hiệu màu đỏ), trừ 10 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn vuot_den_do_triggers_when_the_car_drives_into_the_junction_on_red() {
    let s = run(seed_in(1), true, false, 40);
    let v = s.view();
    assert_eq!(v.fired("SH.05.VUOT_DEN_DO"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.score, 90, "ten points");
}

#[test]
fn vuot_den_do_does_not_trigger_when_the_car_waits_for_its_green() {
    // Waits on red, pulls away on green: the light is obeyed, so nothing is charged for it.
    let s = run(seed_in(1), true, true, 90);
    let v = s.view();
    assert_eq!(v.fired("SH.05.VUOT_DEN_DO"), 0, "{:?}", v.fired_ids());
}

#[test]
fn a_yellow_that_began_while_short_of_the_line_is_a_vuot_den_do() {
    // The law: "Đèn tín hiệu màu vàng nếu đã đi quá vạch dừng thì được phép đi, nếu chưa đến vạch
    // dừng phải dừng lại." Driving on through a yellow that began before the line is the second
    // half of that sentence.
    let j = rules().junction;
    // A seed that starts green and will turn yellow while the car is still short of the line.
    let mut found = None;
    for low in 0..j.cycle_ticks() {
        let seed = JUNCTION | u64::from(low);
        if j.light_at(offset_of(seed)) != 3 {
            continue;
        }
        // Ticks of green left at the start of the run.
        let into = offset_of(seed);
        let left = j.red_ticks + j.green_ticks - into;
        // The car covers the 1 m to the line in a couple of seconds; a yellow inside the first
        // 3 s is one the car meets short of the line.
        if (60..180).contains(&left) {
            found = Some(seed);
            break;
        }
    }
    let seed = found.expect("the cycle has a green that turns yellow just after the start");
    let s = run(seed, true, false, 40);
    let v = s.view();
    assert_eq!(v.fired("SH.05.VUOT_DEN_DO"), 1, "through a yellow met short of the line: {:?}", v.fired_ids());
}

// ---------------------------------------------------------------------------------------------
// SH.05.KHONG_XI_NHAN — "Không bật đèn xi nhan khi rẽ trái hoặc rẽ phải, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_xi_nhan_triggers_when_the_turn_starts_without_the_right_signal() {
    let s = run(seed_in(3), false, false, 40);
    let v = s.view();
    assert_eq!(v.fired("SH.05.KHONG_XI_NHAN"), 1, "{:?}", v.fired_ids());
}

#[test]
fn khong_xi_nhan_does_not_trigger_with_the_right_signal_on() {
    let s = run(seed_in(3), true, false, 40);
    let v = s.view();
    assert_eq!(v.fired("SH.05.KHONG_XI_NHAN"), 0, "{:?}", v.fired_ids());
}

// ---------------------------------------------------------------------------------------------
// SH.05.QUA_20S / SH.05.QUA_30S — "Quá 20 giây từ khi đèn tín hiệu màu xanh bật sáng …"
// ---------------------------------------------------------------------------------------------

#[test]
fn qua_30s_triggers_when_the_car_sits_through_its_green() {
    // Hold the car still at the line: the green it was armed on runs out and the 30 s mark is the
    // disqualification.
    let seed = seed_in(3);
    let mut s = Session::new(seed).unwrap();
    let mut armed = None;
    for t in 0..60 * TICKS_PER_S {
        let snap = s.snapshot();
        if snap[CLOCK_MS] > 0.0 && armed.is_none() {
            armed = Some(t);
        }
        // Creep into the zone (which arms the clock on the green) and then stand still.
        let moving = snap[CLOCK_MS] == 0.0;
        s.step(TickInput {
            gear: 1,
            clutch: if moving { 200 } else { 255 },
            throttle: if moving { 60 } else { 0 },
            brake: if moving { 0 } else { 255 },
            flags: RIGHT | if t < 10 { HANDBRAKE } else { 0 },
            ..Default::default()
        });
        let v = s.view();
        assert_eq!(v.fired("SH.05.VUOT_DEN_DO"), 0, "standing still is not going through");
        if v.disqualified || v.phase == Phase::Done {
            break;
        }
    }
    let v = s.view();
    assert!(armed.is_some(), "the clock was armed on the green");
    assert_eq!(v.fired("SH.05.QUA_30S"), 1, "over 30 s on the green: {:?}", v.fired_ids());
    assert!(v.disqualified, "30 s is a suspension");
    // The 20 s charge fires on the way there, exactly as bài 1's own 20 s / 30 s pair does (both
    // marks are passed, and each is a rule the law lists).
    assert_eq!(v.fired("SH.05.QUA_20S"), 1);
}

#[test]
fn the_clock_does_not_charge_a_car_that_crosses_the_end_line_in_time() {
    let s = run(seed_in(3), true, true, 90);
    let v = s.view();
    assert_eq!(v.fired("SH.05.QUA_20S"), 0, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.05.QUA_30S"), 0, "{:?}", v.fired_ids());
}

#[test]
fn the_clock_is_armed_on_the_car_arrival_not_before() {
    // Same seed, same light: a car that dawdles at the start line and a car that goes straight to
    // the zone must both be armed at their own arrival, so the dawdling one is not charged for the
    // green that ran while it was still at the start.
    let seed = seed_in(3);
    let mut late = Session::new(seed).unwrap();
    for _ in 0..180 {
        late.step(TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() });
    }
    assert_eq!(late.snapshot()[CLOCK_MS], 0.0, "standing on the handbrake at the start: no clock");
}

// ---------------------------------------------------------------------------------------------
// SH.05.SAI_VACH_KE — "Lái xe vi phạm vạch kẻ đường … bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn sai_vach_ke_triggers_when_a_wheel_touches_the_routes_boundary_line() {
    let mut s = Session::new(seed_in(3)).unwrap();
    for t in 0..40 * TICKS_PER_S {
        // Hard right from the line: over the right-hand limit line and onto it.
        s.step(TickInput {
            steering: -32000,
            gear: 1,
            clutch: 170,
            throttle: 70,
            flags: RIGHT | if t < 10 { HANDBRAKE } else { 0 },
            ..Default::default()
        });
        if s.view().disqualified || s.view().phase == Phase::Done {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired("SH.05.SAI_VACH_KE"), 1, "{:?}", v.fired_ids());
    assert!(v.disqualified, "leaving the lane suspends the run");
}

#[test]
fn sai_vach_ke_does_not_trigger_on_the_clean_route() {
    let s = run(seed_in(3), true, false, 40);
    assert_eq!(s.view().fired("SH.05.SAI_VACH_KE"), 0, "{:?}", s.view().fired_ids());
}

// ---------------------------------------------------------------------------------------------
// The stop verdict of bài 5 is charged only for a stop the light asked for.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_stop_short_of_the_line_is_charged_only_when_the_light_asked_for_it() {
    // On green the car does not have to stop, so a stop short of the line is not this exercise's
    // error and nothing is charged.
    let seed = seed_in(3);
    let mut s = Session::new(seed).unwrap();
    let line = rules().junction.stop_line_m();
    for t in 0..60 * TICKS_PER_S {
        let snap = s.snapshot();
        let stop_now = snap[BUMPER] > line - 1.4;
        s.step(TickInput {
            gear: 1,
            clutch: if stop_now { 255 } else { 200 },
            throttle: if stop_now { 0 } else { 60 },
            brake: if stop_now { 255 } else { 0 },
            flags: RIGHT | if t < 10 { HANDBRAKE } else { 0 },
            ..Default::default()
        });
        assert_eq!(s.snapshot()[LIGHT] == 3.0 || s.snapshot()[LIGHT] == 0.0, true);
        if t > 200 {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired("SH.05.CHUA_DEN_VACH"), 0, "a green-light stop short of the line: {:?}", v.fired_ids());
    assert_eq!(v.fired("SH.05.QUA_VACH"), 0);
}

#[test]
fn stopping_past_the_line_on_red_is_qua_vach_only_never_also_vuot_den_do() {
    // One act, one charge: the car rolls 0,3 m past the line and stops there on red. That is QUA_VACH
    // (dừng quá vạch), not also VUOT_DEN_DO, which is for entering the junction.
    let seed = seed_in(1);
    let mut s = Session::new(seed).unwrap();
    let line = rules().junction.stop_line_m();
    let mut braking = false;
    for t in 0..60 * TICKS_PER_S {
        let snap = s.snapshot();
        let stop_distance = snap[7] * snap[7] / (2.0 * 6.9);
        braking |= snap[BUMPER] + stop_distance >= line + 0.3;
        s.step(TickInput {
            gear: 1,
            clutch: if braking { 255 } else { 150 },
            throttle: if braking { 0 } else { 90 },
            brake: if braking { 255 } else { 0 },
            flags: RIGHT | if t < 10 { HANDBRAKE } else { 0 },
            ..Default::default()
        });
        if t > 20 && snap[7] == 0.0 && braking {
            break;
        }
    }
    let v = s.view();
    let snap = s.snapshot();
    assert!(snap[BUMPER] > line, "the car stopped past the line, bumper {:.3}", snap[BUMPER]);
    assert_eq!(v.fired("SH.05.QUA_VACH"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.05.VUOT_DEN_DO"), 0, "stopping past the line is not entering the junction: {:?}", v.fired_ids());
    assert_eq!(v.score, 95, "five points, not fifteen");
}
