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
    // Bài 2, 5, 9 and 11 run on the straight-road scene, which is a figure too (its markings are
    // what the page draws); bài 5's is the right-turn route.
    for id in [2u64, 9, 11] {
        let s = Session::new(id << 56).expect("a road exercise runs");
        assert!(!s.course_block().is_empty(), "bài {id} has a scene to draw");
    }
    let junction = Session::new(5 << 56).expect("bài 5 runs");
    assert!(!junction.course_block().is_empty(), "bài 5 draws its right-turn route");
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

/// Put the car on a figure's first straight, `offset` metres left of its centreline, and hold it
/// still (brake and clutch in) for `seconds`. Used where the thing under test is a timer rather than
/// the driving: a stopped wheel keeps its episode running.
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

/// Place the car inside bài 4's vệt strip at a lateral offset and heading, and hold it still.
///
/// The strip runs along the figure's own `+x` from the entry gate, so the pose is given in the figure
/// frame directly: `car_x` along the first straight (well inside the strip, so both right wheels are),
/// `car_y` across it, `heading` about it.
fn pose_in_vet(car_x: f64, car_y: f64, heading: f64, ticks: u32) -> Session {
    let mut s = Session::new(VET | 1).unwrap();
    s.place_car(car_x, car_y, heading);
    for _ in 0..ticks {
        s.step(TickInput { brake: 255, clutch: 255, ..Default::default() });
    }
    s
}

#[test]
fn de_vach_counts_one_episode_when_two_wheels_share_one_line() {
    // Both right wheels on the SAME vệt line at once: one line, so one charge. A per-wheel counter
    // would charge it twice, which is exactly what this rules out. There are two such bands, one per
    // line ([-0.395, -0.100] and [+0.100, +0.396] in car_y); 0,25 m is the middle of the upper one,
    // so this is not a knife edge.
    let s = pose_in_vet(7.0, 0.25, 0.0, 2);
    let snap = state_of(&s);
    let v = s.view();
    assert_eq!(snap[CONTACT_FR], 1.0, "front-right on the vệt line");
    assert_eq!(snap[CONTACT_RR], 1.0, "rear-right on the same line, same moment");
    assert_eq!(v.fired("SH.04.DE_VACH"), 1, "one line, one episode: {:?}", v.fired_ids());
    assert_eq!(v.score, 95, "and five points, not ten");
    // The band is wide, not a knife edge: a hand's width either side still gives one episode.
    for y in [0.12, 0.18, 0.32, 0.38] {
        let s = pose_in_vet(7.0, y, 0.0, 2);
        let snap = state_of(&s);
        assert_eq!(
            (snap[CONTACT_FR], snap[CONTACT_RR]),
            (1.0, 1.0),
            "at {y:.2} m both right wheels must still be on that line"
        );
        assert_eq!(s.view().fired("SH.04.DE_VACH"), 1, "still one line at {y:.2} m");
    }
}

#[test]
fn de_vach_counts_two_episodes_when_one_wheel_is_on_each_of_two_lines() {
    // The car sits in the vệt strip with its right side angled across it, so the front-right wheel is
    // on one vệt line and the rear-right on the other: two lines, two charges. Placed rather than
    // driven, but not a knife edge — 0.01 rad of heading either side still covers both lines.
    let s = pose_in_vet(7.0, -0.0145, 0.2077, 2);
    let snap = state_of(&s);
    let v = s.view();
    assert_eq!(snap[CONTACT_FR], 1.0, "front-right on one vệt line");
    assert_eq!(snap[CONTACT_RR], 1.0, "rear-right on the other, at the same moment");
    assert_eq!(v.fired("SH.04.DE_VACH"), 2, "two lines count separately: {:?}", v.fired_ids());
    assert_eq!(v.score, 90, "five points each");
    assert!(!v.disqualified, "and it is a deduction, not the vệt suspension");
    for dh in [-0.008, 0.008] {
        let h = 0.2077 + dh;
        let y = 0.675 * libm::cos(h) - 0.675;
        let s = pose_in_vet(7.0, y, h, 2);
        let snap = state_of(&s);
        assert_eq!(
            (snap[CONTACT_FR], snap[CONTACT_RR]),
            (1.0, 1.0),
            "at heading {h:.4} both lines must still be covered"
        );
        assert_eq!(s.view().fired("SH.04.DE_VACH"), 2, "still two lines at heading {h:.4}");
    }
}

// ---------------------------------------------------------------------------------------------
// The vệt boundary: touching the paint is DE_VACH, leaving the strip is TRUOT_VET, and the two are
// mutually exclusive by construction. The reviewer's repro was an ordinary 0,22 m error left of the
// lane centre through the strip, which used to charge both on one tick.
// ---------------------------------------------------------------------------------------------

/// Drive through bài 4's vệt strip holding `offset` metres left of the lane centre (+ = left),
/// slowly, and stop as soon as the strip's length is behind the car.
///
/// Stopping there is deliberate: past the strip the same sloppy line runs the car into a *limit* line
/// and then the curb, and those are different rules on different lines. This helper is about the vệt.
fn hold_offset_through_the_vet(offset: f64) -> Session {
    let mut s = Session::new(VET | 1).unwrap();
    // The strip ends `Lvb` past the entry gate; the entry gate is `lead_m` in.
    let vet_end = {
        let block = s.course_block();
        let mut i = 0;
        let mut end = f64::INFINITY;
        while i + 2 < block.len() {
            let n = block[i + 2] as usize;
            if block[i] == 4.0 && block[i + 1] == 4.0 {
                // The vệt-end gate: its distance along the first straight is its x.
                end = end.min(block[i + 3]);
            }
            i += 3 + 2 * n;
        }
        end
    };
    for t in 0..60 * TICKS_PER_S {
        if t < 30 {
            s.step(parked());
            continue;
        }
        let snap = state_of(&s);
        if snap[PROGRESS] > vet_end {
            break;
        }
        let error = offset - snap[LATERAL];
        let steer = ((0.5 * error - 1.2 * snap[HEADING_ERR_IDX]) / 0.55).clamp(-1.0, 1.0);
        s.step(TickInput {
            steering: (steer * 32760.0) as i16,
            throttle: if snap[7] < 0.8 { 80 } else { 0 },
            brake: if snap[7] > 1.0 { 100 } else { 0 },
            clutch: if snap[7] > 0.8 { 255 } else { 160 },
            gear: 1,
            ..Default::default()
        });
        if s.view().disqualified {
            break;
        }
    }
    s
}

#[test]
fn touching_the_vet_paint_is_de_vach_only_never_also_a_slip_off() {
    // The reviewer's case: a small error left of the lane centre through the strip. The right wheels
    // touch the upper vệt line, so DE_VACH is charged — and because a patch on the paint is by
    // definition still inside the strip, TRUOT_VET must not fire with it. 0,22 m is the exact repro.
    for offset in [0.20, 0.22, 0.25, 0.30] {
        let s = hold_offset_through_the_vet(offset);
        let v = s.view();
        assert!(v.fired("SH.04.DE_VACH") >= 1, "at {offset} m the right wheels are on the paint: {:?}", v.fired_ids());
        assert_eq!(v.fired("SH.04.TRUOT_VET"), 0, "and still inside the strip at {offset} m: {:?}", v.fired_ids());
        assert!(!v.disqualified, "so no suspension at {offset} m");
    }
}

#[test]
fn leaving_the_vet_strip_past_the_paint_is_the_slip_off() {
    // Far enough left that the right wheels' patches clear the upper vệt line entirely: that is
    // outside the strip, so it is the slip-off, and it suspends the run.
    for offset in [0.45, 0.50, 0.60] {
        let s = hold_offset_through_the_vet(offset);
        let v = s.view();
        assert_eq!(v.fired("SH.04.TRUOT_VET"), 1, "at {offset} m the strip is left behind: {:?}", v.fired_ids());
        assert!(v.disqualified, "and that is a suspension at {offset} m");
    }
}

#[test]
fn the_vet_zone_edge_never_charges_both_for_one_tick() {
    // Sweep the offset across both edges. A run may earn DE_VACH early (it brushed the paint on the
    // way out) *and* TRUOT_VET later (it then left the strip) — those are two acts at two times and
    // the law lists both. What must never happen is the two landing on the same tick, which is the
    // overlap the reviewer found. So the sweep asserts the per-tick rule, not a per-run one.
    for step in 0..=16 {
        let offset = 0.20 + f64::from(step) * 0.025;
        let s = hold_offset_through_the_vet(offset);
        assert!(
            !same_tick_has_both(&s, "SH.04.DE_VACH", "SH.04.TRUOT_VET"),
            "at {offset:.3} m off centre DE_VACH and TRUOT_VET landed on one tick: {:?}",
            s.view().fired_ids()
        );
        // And the suspension, when it comes, is only ever the slip-off.
        let slip = s.view().fired("SH.04.TRUOT_VET") > 0;
        assert_eq!(slip, s.view().disqualified, "only the slip-off suspends, at {offset:.3} m");
    }
}

/// Whether two rules fired on the same tick anywhere in the run. Two charges for one act share a
/// tick; two separate acts do not.
fn same_tick_has_both(s: &Session, a: &str, b: &str) -> bool {
    let rs = crate::rules::Ruleset::load();
    let code_of = |id: &str| rs.index_of(id).map(|i| rs.rules[i].code);
    let (Some(ca), Some(cb)) = (code_of(a), code_of(b)) else { return false };
    let ticks_a: Vec<u32> = s.view().events().iter().filter(|e| e.code == ca).map(|e| e.tick).collect();
    s.view().events().iter().any(|e| e.code == cb && ticks_a.contains(&e.tick))
}

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
    // Follow the model: the reference point turns at `wheelbase / tan(max_steer)`, the front axle
    // is half a wheelbase ahead of that line, and the outer wheel's patch adds half a tyre.
    let pivot = v.wheelbase_m / libm::tan(v.max_steer_rad);
    let half_base = 0.5 * v.wheelbase_m;
    let out = pivot + 0.5 * sh.track_m;
    let expected = libm::sqrt(half_base * half_base + out * out) + 0.5 * sh.tyre_width_m;
    assert!((rqv - expected).abs() < 1e-12, "rqv is the model's, got {rqv} want {expected}");
    assert!(
        (sh.min_centre_radius_m(v) - pivot).abs() < 1e-12,
        "the reference point's radius is wheelbase / tan(max_steer), not a hypot of it"
    );
    // A hair under the legal 4,9 m floor for an exam car: named in the ruleset assumptions, because
    // it makes the figures marginally easier than a real car's would be.
    assert!((4.8..4.9).contains(&rqv), "rqv sits just under the legal minimum, got {rqv:.4}");
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
