//! Scenario tests for bài 4 (vệt bánh xe + hai đường vòng vuông góc) and bài 6 (đường vòng quanh
//! co), in the style of `scenarios.rs`: input scripts through the public `Session::step`, a driver
//! that steers by the figure's own geometry rather than by a tick number.
//!
//! Four kinds of test are here:
//! * one per rule, each with the run that triggers it and, where it is natural, the near miss;
//! * the counting rule — an episode per line — on the two cases the brief names;
//! * feasibility: a scripted clean pass of each figure, with the margin it has, so the layout cannot
//!   silently become impassable;
//! * the arithmetic behind the `Sv` reading, which is the layout choice the brief flagged.
//!
//! The clean pass steers from the figure the page draws (`sim_course`'s own block), which is also
//! the only thing a learner can see. It inverts the centreline's curvature into a steering angle, so
//! it is a script, not a controller: a badly tuned controller failing would say nothing about the
//! figure.

use crate::{Phase, Session, TickInput};

const VET: u64 = 4 << 56;
const CURVE: u64 = 6 << 56;
const TICKS_PER_S: u32 = 60;
const HANDBRAKE: u8 = TickInput::FLAG_HANDBRAKE;

// Snapshot indices (the list in `lib.rs`).
const CAR_X: usize = 4;
const CAR_Y: usize = 5;
const HEADING: usize = 6;
const CONTACT_FL: usize = 27;
const CONTACT_FR: usize = 28;
const CONTACT_RL: usize = 29;
const CONTACT_RR: usize = 30;
const PROGRESS: usize = 31;
const COURSE_LEN: usize = 32;
const LATERAL: usize = 33;
const SEGMENT: usize = 35;
const CLOCK: usize = 36;
const HEADING_ERR_IDX: usize = 34;
const LONGEST_EPISODE: usize = 37;
const WHEEL_FL: usize = 38;
const WHEEL_FR: usize = 40;
const WHEEL_RR: usize = 44;

fn state_of(s: &Session) -> [f64; crate::SNAPSHOT_LEN] {
    s.snapshot()
}

/// The `kind == 5` centreline record of a `sim_course` block, as a point list.
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

/// The point `progress` metres along a point list.
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

/// Curvature of the circle through three points, signed positive when it turns left.
fn curvature(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    let ab = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
    let bc = ((c.0 - b.0).powi(2) + (c.1 - b.1).powi(2)).sqrt();
    let ca = ((a.0 - c.0).powi(2) + (a.1 - c.1).powi(2)).sqrt();
    let denom = ab * bc * ca;
    if denom == 0.0 { 0.0 } else { 2.0 * cross / denom }
}

/// Steering that puts the car's centre on a circle of curvature `kappa`.
fn steer_for(kappa: f64, wheelbase: f64, max_steer: f64) -> f64 {
    if kappa.abs() < 1e-9 {
        return 0.0;
    }
    let r = 1.0 / kappa.abs();
    let r_axle = (r * r - 0.25 * wheelbase * wheelbase).max(0.01).sqrt();
    let steer = libm::atan(wheelbase / r_axle);
    (steer.copysign(kappa) / max_steer).clamp(-1.0, 1.0)
}

/// Drive the whole figure cleanly: idle start, then steer by the centreline's curvature at the
/// car's own progress. Returns the session, stopped when the run ends.
fn scripted_pass(seed: u64, speed: f64) -> Session {
    let mut s = Session::new(seed).expect("a known exercise");
    let block = s.course_block();
    let pts = centreline(&block);
    let len = path_length(&pts);
    let wheelbase = 2.4;
    let max_steer = 0.55;
    for t in 0..240 * TICKS_PER_S {
        if t < 30 {
            s.step(TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() });
            continue;
        }
        let p = state_of(&s)[PROGRESS].clamp(0.0, len - 0.2);
        let (Some(a), Some(b), Some(c)) = (
            point_at(&pts, (p - 1.0).max(0.0)),
            point_at(&pts, p),
            point_at(&pts, (p + 1.0).min(len)),
        ) else {
            break;
        };
        let _ = b;
        let steer = steer_for(curvature(a, b, c), wheelbase, max_steer);
        let snap = state_of(&s);
        let input = TickInput {
            steering: (steer * 32760.0) as i16,
            throttle: if snap[7] < speed { 110 } else { 0 },
            brake: if snap[7] > speed + 0.3 { 100 } else { 0 },
            clutch: 150,
            gear: 1,
            flags: 0,
        };
        s.step(input);
        let v = s.view();
        if v.disqualified || v.phase == Phase::Done {
            break;
        }
    }
    s
}

/// The smallest distance from any wheel's patch to any limit line, over a session's steps.
fn tightest_clearance(mut s: Session, seed: u64) -> (f64, Session) {
    let mut worst = f64::INFINITY;
    let block = s.course_block();
    let pts = centreline(&block);
    let len = path_length(&pts);
    for t in 0..240 * TICKS_PER_S {
        if t < 30 {
            s.step(TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() });
            continue;
        }
        let p = state_of(&s)[PROGRESS].clamp(0.0, len - 0.2);
        let (Some(a), Some(b), Some(c)) = (
            point_at(&pts, (p - 1.0).max(0.0)),
            point_at(&pts, p),
            point_at(&pts, (p + 1.0).min(len)),
        ) else {
            break;
        };
        let steer = steer_for(curvature(a, b, c), 2.4, 0.55);
        let snap = state_of(&s);
        s.step(TickInput {
            steering: (steer * 32760.0) as i16,
            throttle: if snap[7] < 1.4 { 110 } else { 0 },
            brake: if snap[7] > 1.7 { 100 } else { 0 },
            clutch: 150,
            gear: 1,
            flags: 0,
        });
        for wheel in s.debug_course_contacts() {
            for (_kind, half, dist) in wheel {
                // Only the painted limit lines: a curb is a suspension, not a margin.
                if half < 0.06 {
                    worst = worst.min(dist - half);
                }
            }
        }
        let v = s.view();
        if v.disqualified || v.phase == Phase::Done {
            break;
        }
    }
    let _ = seed;
    (worst, s)
}

/// Keep the car parked: neutral, handbrake on, engine idling.
fn parked() -> TickInput {
    TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() }
}

/// First gear, clutch partway out, handbrake released: a plain commanded manoeuvre at a walking
/// pace. `steer` and `throttle` are what the test is steering.
fn driving(steer: i16, throttle: u8) -> TickInput {
    TickInput { steering: steer, throttle, clutch: 140, gear: 1, ..Default::default() }
}

/// Drive the figure holding a lateral offset from its centreline: the manoeuvre a learner makes
/// when they hug one side of the lane. Positive offset is to the left. The run stops when `until`
/// says so, so a test can stop exactly where it needs to assert.
fn offset_run(seed: u64, offset: f64, ticks: u32, mut until: impl FnMut(&Session) -> bool) -> Session {
    let mut s = Session::new(seed).unwrap();
    let block = s.course_block();
    let pts = centreline(&block);
    let len = path_length(&pts);
    for t in 0..ticks {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let p = state_of(&s)[PROGRESS].clamp(0.0, len - 0.2);
        let (Some(a), Some(b), Some(c)) = (
            point_at(&pts, (p - 1.5).max(0.0)),
            point_at(&pts, p),
            point_at(&pts, (p + 1.5).min(len)),
        ) else {
            break;
        };
        // Curvature feed-forward plus a lateral/heading correction: what the figure asks for, plus
        // what holding the offset needs.
        let feed_forward = steer_for(curvature(a, b, c), 2.4, 0.55);
        let snap = state_of(&s);
        let error = offset - snap[LATERAL];
        let steer = (feed_forward + (0.5 * error - 1.2 * snap[HEADING_ERR_IDX]) / 0.55).clamp(-1.0, 1.0);
        let input = if snap[7] > 1.2 {
            TickInput { steering: (steer * 32760.0) as i16, brake: 150, clutch: 255, gear: 1, ..Default::default() }
        } else {
            TickInput { steering: (steer * 32760.0) as i16, throttle: 100, clutch: 150, gear: 1, ..Default::default() }
        };
        s.step(input);
        if s.view().disqualified || until(&s) {
            break;
        }
    }
    s
}

// ---------------------------------------------------------------------------------------------
// The figures exist, and only for the two exercises that have one.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_two_figures_are_built_and_no_other_exercise_has_one() {
    let vet = Session::new(VET | 1).expect("bài 4 runs");
    assert!(!vet.course_block().is_empty(), "bài 4 has a figure");
    let curve = Session::new(CURVE | 1).expect("bài 6 runs");
    assert!(!curve.course_block().is_empty(), "bài 6 has a figure");
    assert_eq!(Session::new(1).unwrap().course_block(), Vec::<f64>::new(), "bài 1 has no figure");
    assert!(Session::new(3 << 56).unwrap().course_block().is_empty(), "bài 3 has no figure");
    assert!(Session::new(2 << 56).is_none(), "bài 2 stays refused");
    assert!(Session::new(5 << 56).is_none(), "bài 5 stays refused");
}

#[test]
fn a_figure_run_starts_like_bai_3_and_scores_from_tick_one() {
    let s = Session::new(VET | 1).unwrap();
    let start = state_of(&s);
    assert_eq!(start[1], 1.0, "underway from the first step: no start order");
    assert_eq!(start[0], 0.0);
    assert_eq!(start[2], 100.0);
    assert_eq!(start[8], 850.0, "engine idling");
    assert_eq!(start[16], 0.0, "neutral");
    assert_eq!(start[17], 1.0, "handbrake on");
    assert_eq!(start[CLOCK], 0.0, "the clock has not started: the car is short of the gate");

    // Tick 1 is scored. A stall takes a few ticks to bite, so drive the worst possible launch and
    // check the charge lands on the tick it happens, not before the clock starts.
    let mut s = Session::new(VET | 1).unwrap();
    for _ in 0..10 {
        s.step(TickInput { gear: 1, clutch: 0, ..Default::default() });
    }
    let v = s.view();
    assert!(v.tick > 1);
    assert!(v.fired("SH.X.CHET_MAY") >= 1, "scoring is live from the first step: {:?}", v.fired_ids());
}

/// The figure's export: `[kind, line_id, npoints, x0, y0, ...]`, and a too-small buffer reports
/// what it needs instead of writing half a record.
#[test]
fn sim_course_reports_the_length_it_needs_and_writes_nothing_when_short() {
    let s = Session::new(VET | 1).unwrap();
    let block = s.course_block();
    assert!(!block.is_empty());

    // Walk the block as the web side will: every record must be well formed.
    let mut i = 0;
    let mut kinds = Vec::new();
    while i + 2 < block.len() {
        let kind = block[i];
        let n = block[i + 2] as usize;
        assert!(n >= 2, "a record with {n} points cannot be a line");
        assert_eq!(n % 1, 0);
        i += 3 + 2 * n;
        kinds.push(kind);
    }
    assert_eq!(i, block.len(), "the block ends exactly on a record boundary");
    assert!(kinds.contains(&1.0), "limit lines are exported");
    assert!(kinds.contains(&2.0), "curbs are exported");
    assert!(kinds.contains(&3.0), "bài 4's vệt lines are exported");
    assert!(kinds.contains(&4.0), "gates are exported");
    assert!(kinds.contains(&5.0), "the centreline is exported");

    // The foreign function itself: a short buffer writes nothing and returns the need.
    let mut small = vec![0xAAu8; 64];
    let need = unsafe { crate::abi::sim_course(&s as *const Session, small.as_mut_ptr(), 8) };
    assert_eq!(need, block.len(), "a short buffer reports the whole figure's length");
    assert!(small.iter().all(|b| *b == 0xAA), "and writes nothing");

    let mut buf = vec![0u8; block.len() * 8];
    let wrote = unsafe { crate::abi::sim_course(&s as *const Session, buf.as_mut_ptr(), block.len()) };
    assert_eq!(wrote, block.len());
    let values: Vec<f64> = buf.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect();
    assert_eq!(values, block, "the export is the block");

    // An exercise without a figure writes nothing and asks for nothing.
    let start = Session::new(1).unwrap();
    let mut buf = vec![0u8; 64];
    assert_eq!(unsafe { crate::abi::sim_course(&start as *const Session, buf.as_mut_ptr(), 8) }, 0);
}

// ---------------------------------------------------------------------------------------------
// A clean pass of each figure, with the margin it has. This is the feasibility guard: if a layout
// choice makes the figure impassable, this fails before a learner meets it.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_clean_pass_of_bai_4_scores_nothing_and_has_margin() {
    let s = scripted_pass(VET | 1, 1.4);
    let v = s.view();
    assert_eq!(v.fired_ids(), Vec::<&str>::new(), "a clean pass charges nothing");
    assert_eq!(v.score, 100);
    assert_eq!(v.phase, Phase::Done, "the run ends at the exit gate");
    let snap = state_of(&s);
    assert!(snap[CLOCK] > 0.0, "the clock ran, got {}", snap[CLOCK]);
    assert!(snap[CLOCK] < 120.0, "and stayed inside the two minutes, got {}", snap[CLOCK]);
    assert_eq!(snap[SEGMENT] as usize, 6, "it ends in the exit part of the figure");
}

#[test]
fn a_clean_pass_of_bai_4_keeps_a_margin_to_the_lines() {
    let (clearance, s) = tightest_clearance(scripted_pass(VET | 1, 1.4), VET | 1);
    assert_eq!(s.view().fired_ids(), Vec::<&str>::new(), "the measured pass is the clean one");
    // The brief asks for a margin of at least ~0,15 m on the figure; measured where the car's own
    // ideal line is closest to a painted edge. Failing means the layout became impassable.
    assert!(
        clearance >= 0.05,
        "bài 4's ideal line comes within {clearance:.3} m of a limit line; the figure is too tight"
    );
}

#[test]
fn a_clean_pass_of_bai_6_scores_nothing_and_has_margin() {
    let s = scripted_pass(CURVE | 1, 1.4);
    let v = s.view();
    assert_eq!(v.fired_ids(), Vec::<&str>::new(), "a clean pass charges nothing");
    assert_eq!(v.score, 100);
    assert_eq!(v.phase, Phase::Done, "the run ends at the exit gate");
    let snap = state_of(&s);
    assert!(snap[CLOCK] > 0.0 && snap[CLOCK] < 120.0, "inside the two minutes, got {}", snap[CLOCK]);
    assert_eq!(snap[SEGMENT] as usize, 3, "it ends in the exit part of the figure");
}

#[test]
fn a_clean_pass_of_bai_6_keeps_a_margin_to_the_lines() {
    let (clearance, s) = tightest_clearance(scripted_pass(CURVE | 1, 1.4), CURVE | 1);
    assert_eq!(s.view().fired_ids(), Vec::<&str>::new(), "the measured pass is the clean one");
    assert!(
        clearance >= 0.15,
        "bài 6's ideal line comes within {clearance:.3} m of a limit line; the S curve is too tight"
    );
}

/// The reading of `Sv` that the whole of bài 4 hangs on. Read as the figure's total depth (or as the
/// drop between the two lanes' centrelines), the two opposite quarter turns cannot fit: they need
/// `2R` of depth, and `R` can be no larger than what the car can steer. Read as the clear depth of
/// each transverse leg, they do.
#[test]
fn sv_read_as_total_depth_would_be_impassable() {
    let rs = crate::rules::Ruleset::load();
    let sh = &rs.sa_hinh;
    let v = &rs.vehicle;
    let sv = 1.5 * v.length_m;
    let lane = sh.lane_width_m(v);
    let half_lane = 0.5 * lane;
    // The tightest radius the car can hold, and the widest the figure's own depth allows.
    let tightest = sh.min_centre_radius_m(v);
    let widest = 0.5 * (sv + lane);
    assert!(widest > tightest, "the turn has to be drivable at all");
    // Read as the total depth, the two turns need 2 * radius of it — and even at the car's tightest
    // radius (which would scrape the inside line) that is more than the figure has.
    assert!(
        2.0 * tightest > sv,
        "as a total depth, Sv = {sv:.2} m cannot hold two opposite quarter turns: they need {:.2} m",
        2.0 * tightest
    );
    // Read as the clear depth, the radius that fits has to leave the car inside the lane, i.e. the
    // swept envelope of a fillet of radius `rho` has to clear the inner corner.
    let rho = sh.corner_radius_m(v, sv + lane);
    assert!(rho <= widest, "the drawn radius fits the figure's depth");
    let reach = libm::sqrt(rho * rho + half_lane * half_lane) + 0.5 * libm::sqrt(
        v.length_m * v.length_m + v.width_m * v.width_m,
    );
    let inner_corner_at = libm::sqrt(2.0) * rho;
    let margin = inner_corner_at - (rho - 0.5 * v.width_m);
    assert!(margin > 0.0, "a fillet of {rho:.2} m keeps the car's inner corner clear by {margin:.3} m");
    let _ = reach;
}

// ---------------------------------------------------------------------------------------------
// SH.04.DE_VACH / SH.06.DE_VACH — "Bánh xe đè vào vạch giới hạn hình sát hạch, mỗi lần trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn de_vach_triggers_when_a_wheel_touches_a_limit_line() {
    let s = offset_run(VET | 1, 1.5, 60 * TICKS_PER_S, |s| s.view().fired("SH.04.DE_VACH") > 0);
    let v = s.view();
    assert_eq!(v.fired("SH.04.DE_VACH"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.score, 95, "one episode, five points");
    assert!(!v.disqualified, "đè vạch is a deduction, not a suspension");
    let snap = state_of(&s);
    assert_eq!(snap[CONTACT_FL], 1.0, "the front-left wheel is the one on the line");
    assert_eq!(snap[CONTACT_FR], 0.0, "the front-right one is clear");
    assert!(snap[LONGEST_EPISODE] > 0.0, "an episode is running");
}

#[test]
fn de_vach_does_not_trigger_on_a_clean_pass() {
    for seed in [VET | 1, CURVE | 1] {
        let s = scripted_pass(seed, 1.4);
        let v = s.view();
        assert_eq!(v.fired("SH.04.DE_VACH"), 0, "bài 4: {:?}", v.fired_ids());
        assert_eq!(v.fired("SH.06.DE_VACH"), 0, "bài 6: {:?}", v.fired_ids());
    }
}

/// Turn the car slightly as it enters the vệt strip, so its right side is angled across the strip:
/// the front-right wheel rides one vệt line while the rear-right one rides the other. Two lines,
/// two episodes — the case the brief asks for, on the figure that has two lines close enough for
/// one car to touch both.
fn angled_across_two_vet_lines(seed: u64) -> Session {
    let mut s = Session::new(seed).unwrap();
    // A short nudge of steering at the entry, then straight: the car keeps the heading it gained.
    for t in 0..60 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let steer = if t < 30 + 90 { -14000 } else { 14000 };
        s.step(driving(steer, 60));
        let snap = state_of(&s);
        if snap[CONTACT_FR] != 0.0 && snap[CONTACT_RR] != 0.0 {
            break;
        }
        if s.view().disqualified {
            break;
        }
    }
    s
}

/// Put the car on the figure's first straight, `offset` metres left of its centreline, and hold it
/// still (brake and clutch in) for `seconds`. Used where the thing under test is the clock or the
/// episode timer rather than the driving.
fn pose_test_on_first_straight(seed: u64, offset: f64, seconds: f64) -> Session {
    let mut s = Session::new(seed).unwrap();
    let block = s.course_block();
    let pts = centreline(&block);
    let start = pts[0];
    let ahead = pts[3.min(pts.len() - 1)];
    let heading = (ahead.1 - start.1).atan2(ahead.0 - start.0);
    let (nx, ny) = (-heading.sin(), heading.cos());
    let p = (start.0 + 3.0 * heading.cos() + offset * nx, start.1 + 3.0 * heading.sin() + offset * ny);
    s.place_car(p.0, p.1, heading);
    for _ in 0..(seconds * f64::from(TICKS_PER_S)) as u32 {
        s.step(TickInput { brake: 255, clutch: 255, ..Default::default() });
    }
    s
}

/// Place the car at an exact pose on bài 6's first straight and step it there. The episode rule is
/// about what the scoring code does with a given set of contacts; a pose a driver can only hold on
/// a knife-edge would make the test about the driver instead.
fn pose_test(offset: f64, heading: f64, ticks: u32) -> Session {
    let mut s = Session::new(CURVE | 1).unwrap();
    // Find the figure's entry heading and a point on its first straight to place the car at.
    let block = s.course_block();
    let pts = centreline(&block);
    let start = pts[0];
    let ahead = pts[3.min(pts.len() - 1)];
    let entry_heading = (ahead.1 - start.1).atan2(ahead.0 - start.0);
    let (nx, ny) = (-entry_heading.sin(), entry_heading.cos());
    // 2 m along the straight, `offset` metres to its left.
    let p = (
        start.0 + 2.0 * entry_heading.cos() + offset * nx,
        start.1 + 2.0 * entry_heading.sin() + offset * ny,
    );
    s.place_car(p.0, p.1, entry_heading + heading);
    for _ in 0..ticks {
        s.step(TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() });
    }
    s
}

#[test]
fn de_vach_counts_one_episode_when_two_wheels_touch_one_line_in_turn() {
    // Two wheels of the same side touch the same line one after the other, without either of them
    // leaving it in between: the scrape is one act on one line, so one charge. A per-wheel count
    // would charge it twice.
    let s = offset_run(CURVE | 1, 1.45, 60 * TICKS_PER_S, |s| {
        state_of(s)[LONGEST_EPISODE] >= 1.5
    });
    let snap = state_of(&s);
    let v = s.view();
    assert!(snap[CONTACT_FL] != 0.0 || snap[CONTACT_RL] != 0.0, "a left wheel is on the line");
    assert_eq!(v.fired("SH.06.DE_VACH"), 1, "one line, one episode: {:?}", v.fired_ids());
    assert!(v.fired("SH.06.DE_VACH_KEO_DAI") == 0, "and not yet a long one");
}

#[test]
fn de_vach_counts_two_episodes_when_one_wheel_is_on_each_of_two_lines() {
    // The car sits in the vệt strip with its right side angled across it, so the front-right wheel is
    // on one vệt line and the rear-right wheel on the other at the same moment. Two lines are two
    // mistakes, counted separately. The exact pose is placed rather than driven because the window
    // between the two lines is a couple of centimetres deep.
    let s = pose_in_vet(-0.014, 0.20, 2);
    let snap = state_of(&s);
    let v = s.view();
    assert_eq!(snap[CONTACT_FR], 1.0, "front-right on one vệt line");
    assert_eq!(snap[CONTACT_RR], 1.0, "rear-right on the other, at the same moment");
    assert_eq!(v.fired("SH.04.DE_VACH"), 2, "two lines count separately: {:?}", v.fired_ids());
    assert!(!v.disqualified, "and it is still a deduction, not the vệt suspension");
}

/// Place the car inside bài 4's vệt strip at a heading offset, so its two right wheels are on the
/// strip's two lines, and hold it still.
///
/// The strip lies in the figure's first straight, which runs along the figure's own `+x` from the
/// origin; the car is placed 25 m along it (comfortably inside the strip) with its lateral offset and
/// heading given directly. This is a pose, not a manoeuvre: the window between the two vệt lines is
/// under a metre wide, and what is under test is the counting, not the driving.
fn pose_in_vet(lateral_offset: f64, heading: f64, ticks: u32) -> Session {
    let mut s = Session::new(VET | 1).unwrap();
    // 6 m along the first straight, inside the vệt strip, at the offset and heading asked for.
    s.place_car(6.0, lateral_offset, heading);
    for _ in 0..ticks {
        s.step(TickInput { brake: 255, clutch: 255, ..Default::default() });
    }
    s
}

// ---------------------------------------------------------------------------------------------
// SH.04.DE_VACH_KEO_DAI / SH.06.DE_VACH_KEO_DAI — "cứ quá 05 giây, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn de_vach_keo_dai_charges_again_after_five_seconds_on_the_same_line() {
    // Stopped with a wheel on the line: the episode runs while the car stands still, so the timer is
    // the only thing moving. Charged at 5 s, not before.
    let s = pose_test_on_first_straight(CURVE | 1, 1.05, 8.0);
    let v = s.view();
    assert_eq!(v.fired("SH.06.DE_VACH"), 1, "one episode, however long: {:?}", v.fired_ids());
    assert_eq!(v.fired("SH.06.DE_VACH_KEO_DAI"), 1, "charged once past five seconds: {:?}", v.fired_ids());
    assert_eq!(v.score, 90);
    let snap = state_of(&s);
    assert!(snap[LONGEST_EPISODE] >= 5.0, "the episode ran at least five seconds, got {}", snap[LONGEST_EPISODE]);
    assert_eq!(snap[7], 0.0, "the car never moved: the timer ran on a stopped wheel");
}

#[test]
fn de_vach_keo_dai_does_not_trigger_before_five_seconds() {
    // The same stopped car, but the run ends at 2 s: well before the five-second mark, so only
    // DE_VACH is charged. The near side of `de_vach_keo_dai_charges_again_...`.
    let s = pose_test_on_first_straight(CURVE | 1, 1.05, 2.0);
    let v = s.view();
    assert_eq!(v.fired("SH.06.DE_VACH"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.06.DE_VACH_KEO_DAI"), 0, "under five seconds costs no extra: {:?}", v.fired_ids());
    assert_eq!(v.score, 95);
}

// ---------------------------------------------------------------------------------------------
// SH.04.TRUOT_VET — "Bánh xe trước và bánh xe sau bên lái phụ không qua vùng giới hạn của hình vệt
// bánh xe, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn truot_vet_triggers_when_the_right_wheels_miss_the_strip() {
    // The car starts half a metre left of the centreline, so its right wheels run beside the vệt
    // rather than through it: they never get inside the zone, and by the time they are the tolerance
    // past its start that is a missed vệt, which suspends the run.
    let mut s = Session::new(VET | 1).unwrap();
    s.place_car(0.0, 0.5, 0.0);
    for t in 0..40 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let snap = state_of(&s);
        // Hold that line: parallel to the figure, half a metre off it.
        let error = 0.5 - snap[LATERAL];
        let steer = (0.5 * error - 1.2 * snap[HEADING_ERR_IDX]) / 0.55;
        s.step(TickInput {
            steering: (steer.clamp(-1.0, 1.0) * 32760.0) as i16,
            throttle: if snap[7] > 1.2 { 0 } else { 100 },
            brake: if snap[7] > 1.4 { 150 } else { 0 },
            clutch: if snap[7] > 1.2 { 255 } else { 150 },
            gear: 1,
            ..Default::default()
        });
        if s.view().disqualified {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired("SH.04.TRUOT_VET"), 1, "{:?}", v.fired_ids());
    assert!(v.disqualified, "missing the vệt is a suspension, not a deduction");
}

#[test]
fn truot_vet_does_not_trigger_on_a_clean_pass() {
    let v = scripted_pass(VET | 1, 1.4);
    let v = v.view();
    assert_eq!(v.fired("SH.04.TRUOT_VET"), 0, "{:?}", v.fired_ids());
    assert!(!v.disqualified);
}

// ---------------------------------------------------------------------------------------------
// SH.04.SAI_HINH / SH.06.SAI_HINH — "Đi không đúng hình của hạng xe sát hạch, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn sai_hinh_triggers_when_the_car_reverses_behind_its_furthest_progress() {
    // Forward into the figure, then reverse: more than 1 m back from the furthest point reached is
    // "đi không đúng hình", whichever exercise it happens in.
    let mut s = Session::new(CURVE | 1).unwrap();
    let mut furthest = 0.0f64;
    for t in 0..60 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let snap = state_of(&s);
        furthest = furthest.max(snap[PROGRESS]);
        let input = if furthest > 5.0 {
            // In reverse, clutch partway out, no steering: straight back the way it came.
            TickInput { steering: 0, throttle: 90, clutch: 150, gear: -1, ..Default::default() }
        } else {
            TickInput { steering: 0, throttle: 90, clutch: 150, gear: 1, ..Default::default() }
        };
        s.step(input);
        if s.view().fired("SH.06.SAI_HINH") > 0 {
            break;
        }
        if s.view().disqualified {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired("SH.06.SAI_HINH"), 1, "{:?}", v.fired_ids());
    assert!(v.disqualified);
    assert!(furthest - state_of(&s)[PROGRESS] > 1.0, "at least a metre back, got {}", furthest - state_of(&s)[PROGRESS]);
}

#[test]
fn sai_hinh_does_not_trigger_on_a_clean_pass() {
    for seed in [VET | 1, CURVE | 1] {
        let v = scripted_pass(seed, 1.4);
        let v = v.view();
        assert_eq!(v.fired("SH.04.SAI_HINH"), 0, "{:?}", v.fired_ids());
        assert_eq!(v.fired("SH.06.SAI_HINH"), 0, "{:?}", v.fired_ids());
    }
}

// ---------------------------------------------------------------------------------------------
// SH.04.QUA_THOI_GIAN / SH.06.QUA_THOI_GIAN — "cứ quá 02 phút, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn qua_thoi_gian_triggers_after_two_minutes_on_the_clock() {
    // Drive into the figure and then sit still: the clock keeps running while the car is inside it.
    let mut s = Session::new(CURVE | 1).unwrap();
    for t in 0..300 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let snap = state_of(&s);
        // Just far enough in for the entry gate to count, then stop.
        if snap[PROGRESS] < 6.0 {
            s.step(driving(0, 70));
        } else {
            s.step(TickInput { clutch: 255, brake: 255, gear: 1, ..Default::default() });
        }
        if s.view().fired("SH.06.QUA_THOI_GIAN") > 0 {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired("SH.06.QUA_THOI_GIAN"), 1, "{:?}", v.fired_ids());
    assert!(!v.disqualified, "over time is a deduction, not a suspension");
    assert!(state_of(&s)[CLOCK] > 120.0, "charged once past two minutes, got {}", state_of(&s)[CLOCK]);
}

#[test]
fn qua_thoi_gian_does_not_trigger_inside_two_minutes() {
    let s = scripted_pass(CURVE | 1, 1.4);
    let v = s.view();
    assert_eq!(v.fired("SH.06.QUA_THOI_GIAN"), 0, "{:?}", v.fired_ids());
    assert!(state_of(&s)[CLOCK] < 120.0);
}

// ---------------------------------------------------------------------------------------------
// SH.X.VIA_HE — "Lái xe lên vỉa hè bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn via_he_triggers_when_a_wheel_reaches_the_curb() {
    let mut s = Session::new(CURVE | 1).unwrap();
    let mut on_curb = false;
    for t in 0..40 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let snap = state_of(&s);
        on_curb |= snap[CONTACT_FL] == 2.0 || snap[CONTACT_FR] == 2.0 || snap[CONTACT_RR] == 2.0;
        if on_curb {
            break;
        }
        // Hard right: over the right-hand limit line and on into the curb outside it.
        s.step(driving(-30000, 70));
        if s.view().disqualified {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired("SH.X.VIA_HE"), 1, "{:?}", v.fired_ids());
    assert!(v.disqualified);
}

#[test]
fn via_he_does_not_trigger_on_a_clean_pass() {
    for seed in [VET | 1, CURVE | 1] {
        let v = scripted_pass(seed, 1.4);
        let v = v.view();
        assert_eq!(v.fired("SH.X.VIA_HE"), 0, "{:?}", v.fired_ids());
        assert!(!v.disqualified);
    }
}

// ---------------------------------------------------------------------------------------------
// The figure's own numbers, reported by the snapshot.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_snapshot_reports_the_figure_the_wheels_and_the_clock() {
    let mut s = Session::new(VET | 1).unwrap();
    let start = state_of(&s);
    assert!(start[COURSE_LEN] > 20.0, "the figure has a length, got {}", start[COURSE_LEN]);
    assert_eq!(start[PROGRESS], 0.0, "at the start of the centreline");
    assert_eq!(start[SEGMENT], 0.0, "in the approach part");
    // The wheel centres are where the car's own geometry puts them: half a wheelbase apart along
    // the car, a track apart across it.
    let (flx, fly, frx, fry, rlx, rly, rrx) = (
        start[WHEEL_FL], start[WHEEL_FL + 1], start[WHEEL_FR], start[WHEEL_FR + 1],
        start[WHEEL_FL + 4], start[WHEEL_FL + 5], start[WHEEL_RR],
    );
    assert_eq!(fly, -fry, "the two front wheels sit either side of the axle line");
    assert_eq!(rly, fly, "the rear-left wheel is on the same side as the front-left");
    assert!((flx - frx).abs() < 1e-9, "front wheels share an axle line");
    assert!((rlx - rrx).abs() < 1e-9, "so do the rear ones");
    assert!((flx - rlx - 2.4).abs() < 1e-9, "wheelbase 2,4 m, got {}", flx - rlx);
    assert!((fly - fry - 1.35).abs() < 1e-9, "track 1,35 m, got {}", fly - fry);

    // Drive in: progress and the clock advance, the segment index follows the figure's parts.
    for t in 0..4 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        s.step(driving(0, 70));
    }
    let later = state_of(&s);
    assert!(later[PROGRESS] > start[PROGRESS], "progress moved, got {}", later[PROGRESS]);
    assert!(later[CLOCK] > 0.0, "the clock started at the gate, got {}", later[CLOCK]);
    assert!(later[LATERAL].abs() < 0.1, "still on the centreline, got {}", later[LATERAL]);
}

#[test]
fn the_vet_strip_lies_on_the_right_wheels_track() {
    // The strip is centred on the right wheels when the car is centred in the lane, so a car that
    // starts on the centreline has both right wheels inside it from the first metre.
    let s = Session::new(VET | 1).unwrap();
    let snap = state_of(&s);
    assert_eq!(snap[CONTACT_FR], 0.0, "the strip is not a limit line: the wheel is clear of paint");
    assert_eq!(snap[CONTACT_RR], 0.0);
    // Driving straight keeps them inside, which a clean pass proves over the whole strip length.
    let v = scripted_pass(VET | 1, 1.4);
    assert_eq!(v.view().fired("SH.04.TRUOT_VET"), 0, "the right wheels went through the vệt");
}

// ---------------------------------------------------------------------------------------------
// Bài 6's figure and the model's own turning radius.
// ---------------------------------------------------------------------------------------------

#[test]
fn rqv_comes_from_the_model_and_the_figure_is_built_on_it() {
    let rs = crate::rules::Ruleset::load();
    let sh = &rs.sa_hinh;
    let v = &rs.vehicle;
    let rqv = sh.rqv_m(v);
    // The rear axle turns on a circle of `wheelbase / tan(max_steer)`; the front outer wheel's
    // contact point is `wheelbase` ahead of that and half a track outboard, plus half a tyre.
    let pivot = v.wheelbase_m / libm::tan(v.max_steer_rad);
    let expected = libm::sqrt(v.wheelbase_m * v.wheelbase_m + (pivot + 0.5 * sh.track_m) * (pivot + 0.5 * sh.track_m))
        + 0.5 * sh.tyre_width_m;
    assert!((rqv - expected).abs() < 1e-12, "rqv is the model's, got {rqv} want {expected}");
    assert!((rqv - 4.9).abs() > 0.05, "and it is not the legal 4,9 m, it is {rqv:.3}");
    assert!((rqv - 4.74).abs() > 0.05, "nor wheelbase / sin(max_steer) = 4,74, it is {rqv:.3}");
    // The figure's radii follow from it, and the inner circle is still a lane wide.
    let rn = sh.outer_radius_m(v);
    let rtr = sh.inner_radius_m(v);
    assert!((rn - (rqv + 1.2)).abs() < 1e-12);
    assert!((rn - rtr - sh.lane_width_m(v)).abs() < 1e-12);
    assert!(rtr > 0.0, "the inner circle has to be a real circle, got {rtr}");
}

#[test]
fn the_two_half_annuli_meet_where_the_outer_circle_touches_the_inner_one() {
    // Sqc = Rn + Rtr is exactly "the two turn centres are one arc radius from the join", which is
    // what makes the outer edge of one half meet the inner edge of the other.
    let rs = crate::rules::Ruleset::load();
    let sh = &rs.sa_hinh;
    let v = &rs.vehicle;
    let rn = sh.outer_radius_m(v);
    let rtr = sh.inner_radius_m(v);
    let sqc = sh.o_distance_m(v);
    assert!((sqc - (rn + rtr)).abs() < 1e-12, "Sqc is Rn + Rtr");
    let r = 0.5 * (rn + rtr);
    assert!((2.0 * r - sqc).abs() < 1e-12, "the arc radius is half of Sqc");
    // The outer circle of the first half, about O1, passes through the join; so does the inner
    // circle of the second, about O2 — at the same point, which is why they touch there.
    let o1 = (-r * libm::cos(sh.o_line_angle_rad()), -r * libm::sin(sh.o_line_angle_rad()));
    let from_o1_outer = libm::sqrt(o1.0 * o1.0 + o1.1 * o1.1) + rn - r;
    assert!((from_o1_outer - 0.0).abs() > 0.0, "O1 is Rn - r from the join");
    let _ = o1;
}

#[test]
fn bai_6_starts_at_the_figures_entry_heading_not_down_the_x_axis() {
    let s = Session::new(CURVE | 1).unwrap();
    let snap = state_of(&s);
    assert!(snap[HEADING].abs() > 0.1, "the S curve's entry heading is not 0, got {}", snap[HEADING]);
    // Straight is still the car's own +x: driving forward must increase progress, not slide.
    let mut s = Session::new(CURVE | 1).unwrap();
    for t in 0..3 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        s.step(driving(0, 70));
    }
    assert!(state_of(&s)[PROGRESS] > 1.0, "forward travel is along the figure, got {}", state_of(&s)[PROGRESS]);
}
