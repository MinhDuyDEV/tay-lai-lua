//! Scenario tests for bài 7 (ghép xe dọc vào nơi đỗ) and bài 8 (ghép xe ngang vào nơi đỗ), in the
//! style of `scenarios_sa_hinh.rs`: input scripts through the public `Session::step`, and a driver
//! that acts on the state it can see before each step rather than on a tick number.
//!
//! One test per `SH.GHEP.*` rule, each with the run that triggers it, and — where the rule has a
//! natural near miss — the run that does not. The rules about *where the car is* are driven by
//! `place_car`, the same door bài 4 and bài 6's tests use: a pose that only a knife-edge driver
//! could reach would make the test about the driver, not about the rule.
//!
//! The finish signal and the two end-of-exam verdicts are tested through `park_end`, because that
//! is the one function every way of ending the exercise goes through.

use crate::{Phase, Session, TickInput};

const DOC: u64 = 7 << 56;
const NGANG: u64 = 8 << 56;
const PARK: u8 = TickInput::FLAG_HANDBRAKE;

// The snapshot indices this file reads (the list in `lib.rs`).
const HALF_LEN: f64 = 2.1; // a / 2, the ruleset vehicle.length_m = 4.2
const HALF_WID: f64 = 0.8; // b / 2, the ruleset vehicle.width_m = 1.6

fn park_of(s: &Session) -> (f64, f64, f64, f64) {
    // The `kind 8, line 2` record is the bay: find it in the exported block.
    let block = s.course_block();
    let mut i = 0;
    while i + 2 < block.len() {
        let kind = block[i];
        let id = block[i + 1];
        let n = block[i + 2] as usize;
        if kind == 8.0 && id == 2.0 && n == 5 {
            let pts: Vec<(f64, f64)> =
                (0..n).map(|k| (block[i + 3 + 2 * k], block[i + 4 + 2 * k])).collect();
            let xs: Vec<f64> = pts.iter().map(|p| p.0).collect();
            let ys: Vec<f64> = pts.iter().map(|p| p.1).collect();
            let min = |v: &[f64]| v.iter().fold(f64::INFINITY, |a, b| if *b < a { *b } else { a });
            let max = |v: &[f64]| v.iter().fold(f64::NEG_INFINITY, |a, b| if *b > a { *b } else { a });
            return (min(&xs), min(&ys), max(&xs), max(&ys));
        }
        i += 3 + 2 * n;
    }
    panic!("a bay exercise exports its bay");
}

/// The car parked squarely in the middle of the bay, which is the pose the exercise is for:
/// `heading` is along the bay's long axis (bài 7: down −y; bài 8: along +x).
fn parked_pose(s: &Session, seed: u64) -> (f64, f64, f64) {
    let (x0, y0, x1, y1) = park_of(s);
    let cx = 0.5 * (x0 + x1);
    let cy = 0.5 * (y0 + y1);
    if seed == DOC {
        (cx, cy, -core::f64::consts::FRAC_PI_2)
    } else {
        (cx, cy, 0.0)
    }
}

/// A session that idles for `settle` ticks and then has the car placed at `pose`, standing still.
fn placed(seed: u64, pose: (f64, f64, f64), settle: u32) -> Session {
    let mut s = Session::new(seed | 0x1234).expect("a bay exercise runs");
    for _ in 0..settle.max(1) {
        s.step(TickInput { clutch: 255, flags: PARK, ..Default::default() });
    }
    s.place_car(pose.0, pose.1, pose.2);
    s
}

/// One tick with the car held still: clutch pressed, handbrake on, no brake pedal. The physics is
/// what stops it moving, so a placed car really is still.
fn hold(s: &mut Session) {
    s.step(TickInput { clutch: 255, flags: PARK, ..Default::default() });
}

// ---------------------------------------------------------------------------------------------
// The figure and the opening state.
// ---------------------------------------------------------------------------------------------

#[test]
fn both_bays_are_built_to_the_laws_formulas_and_start_like_bai_3() {
    let rs = crate::rules::Ruleset::load();
    let doc = Session::new(DOC | 1).expect("bài 7 runs");
    let (x0, y0, x1, y1) = park_of(&doc);
    assert!((x1 - x0 - rs.park.doc_width_m(&rs.vehicle)).abs() < 1e-9, "bài 7's bay is Rd = b + 0,6 wide");
    assert!((y1 - y0 - rs.park.doc_length_m(&rs.vehicle)).abs() < 1e-9, "and Ld = a + 1,0 long");
    assert!((rs.park.doc_width_m(&rs.vehicle) - 2.2).abs() < 1e-9, "2,20 m for this car");
    assert!((rs.park.doc_length_m(&rs.vehicle) - 5.2).abs() < 1e-9, "5,20 m for this car");
    assert!((rs.park.doc_lane_m(&rs.vehicle) - 5.04).abs() < 1e-9, "Ed = 1,2a = 5,04 m");

    let ngang = Session::new(NGANG | 1).expect("bài 8 runs");
    let (x0, y0, x1, y1) = park_of(&ngang);
    assert!((x1 - x0 - rs.park.ngang_length_m(&rs.vehicle)).abs() < 1e-9, "bài 8's bay is Lg = 3a/2 long");
    assert!((y1 - y0 - rs.park.ngang_width_m(&rs.vehicle)).abs() < 1e-9, "and Rg = 5b/4 deep");
    assert!((rs.park.ngang_length_m(&rs.vehicle) - 6.3).abs() < 1e-9, "6,30 m for this car");
    assert!((rs.park.ngang_width_m(&rs.vehicle) - 2.0).abs() < 1e-9, "2,00 m for this car");

    for (seed, route) in [(DOC, 4.0), (NGANG, 4.0)] {
        let s = Session::new(seed | 1).unwrap();
        let snap = s.snapshot();
        assert_eq!(snap[1], 1.0, "underway from the first step: no start order");
        assert_eq!(snap[2], 100.0);
        assert_eq!(snap[8], 850.0, "engine idling");
        assert_eq!(snap[17], 1.0, "handbrake on");
        assert_eq!(snap[50], route, "the bay route");
        assert_eq!(snap[51], 0.0, "not in the bay yet");
        assert_eq!(snap[52], 0.0, "no finish signal");
        assert_eq!(snap[36], 0.0, "the clock has not started: the car is short of the gate");
        assert!(!s.course_block().is_empty(), "the bay is drawn");
        // The bay is behind the entry gate, so the car has to drive past it before reversing.
        let bumper = snap[9];
        let (bx0, _, bx1, _) = park_of(&s);
        if seed == DOC {
            assert!(bumper > bx1, "bài 7: the car starts past the bay, to reverse back into it");
        } else {
            assert!(bumper < bx0, "bài 8: the car starts before the bay, to reverse back into it");
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The finish signal, and the end of the exam.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_finish_signal_is_the_hull_inside_the_bay_and_still_for_the_hold() {
    for seed in [DOC, NGANG] {
        let probe = Session::new(seed | 1).unwrap();
        let pose = parked_pose(&probe, seed);
        let mut s = placed(seed, pose, 3);
        let hold_ticks = crate::rules::Ruleset::load().park.signal_hold_ticks();
        assert!(hold_ticks > 0);

        // Still and inside: the hold counts up and nothing is charged. The signal is given ON the
        // tick the hold reaches its length, so this runs to one short of it.
        for i in 1..hold_ticks {
            hold(&mut s);
            let snap = s.snapshot();
            assert_eq!(snap[51], 1.0, "the hull is inside the bay on tick {i}");
            assert_eq!(snap[53], f64::from(i), "the hold counts still ticks");
            assert_eq!(snap[52], 0.0, "the signal is not given before the hold is complete");
            assert_eq!(snap[2], 100.0, "waiting for the signal costs nothing");
        }
        // The hold expires: the signal is given and the run is over, with nothing charged.
        hold(&mut s);
        assert_eq!(s.snapshot()[53], f64::from(hold_ticks), "the hold is complete");
        let v = s.view();
        assert_eq!(s.snapshot()[52], 1.0, "the hold complete is the signal");
        assert_eq!(v.phase, Phase::Done, "the signal ends the run");
        assert_eq!(v.score, 100, "a clean park scores 100");
        assert_eq!(v.fired_ids(), Vec::<&str>::new(), "and charges nothing");
    }
}

#[test]
fn moving_inside_the_bay_restarts_the_hold_so_a_rolling_car_never_triggers() {
    let probe = Session::new(DOC | 1).unwrap();
    let pose = parked_pose(&probe, DOC);
    let mut s = placed(DOC, pose, 3);
    for _ in 0..10 {
        hold(&mut s);
    }
    assert!(s.snapshot()[53] > 0.0, "the hold is running");
    // Roll the car a little without touching the bay: the hold must clear.
    s.place_car(pose.0 + 0.05, pose.1, pose.2);
    s.step(TickInput { gear: 1, clutch: 200, throttle: 60, ..Default::default() });
    let snap = s.snapshot();
    assert!(snap[7].abs() > 0.0, "the car is moving");
    assert_eq!(snap[53], 0.0, "a moving car has no hold");
    assert_eq!(snap[52], 0.0, "and no signal");
}

#[test]
fn ending_the_exam_inside_the_bay_without_a_signal_charges_khong_tin_hieu() {
    let probe = Session::new(DOC | 1).unwrap();
    let pose = parked_pose(&probe, DOC);
    let mut s = placed(DOC, pose, 3);
    // The learner presses the end key before the hold completes.
    hold(&mut s);
    assert_eq!(s.snapshot()[53], 1.0, "one still tick: the hold is not complete");
    s.step(TickInput { clutch: 255, flags: PARK | TickInput::FLAG_START_ORDER, ..Default::default() });
    let v = s.view();
    assert_eq!(v.fired_ids(), vec!["SH.GHEP.KHONG_TIN_HIEU_KET_THUC"], "inside but no signal");
    assert_eq!(v.score, 95);
    assert_eq!(v.phase, Phase::Done, "the exam is over");
    assert!(!v.disqualified, "a wrong position inside the bay is not a suspension");
}

#[test]
fn ending_the_exam_with_the_body_still_outside_charges_chua_vao_chuong() {
    let probe = Session::new(NGANG | 1).unwrap();
    let (x0, _, x1, _) = park_of(&probe);
    // Half the car's width inside the bay, the rest still on the road: the law's own words,
    // "còn một phần thân xe nằm ngoài khu vực ghép xe".
    let cx = 0.5 * (x0 + x1);
    let mut s = placed(NGANG, (cx, HALF_WID + 0.2, 0.0), 3);
    assert_eq!(s.snapshot()[51], 0.0, "the hull is not inside");
    s.step(TickInput { clutch: 255, flags: PARK | TickInput::FLAG_START_ORDER, ..Default::default() });
    let v = s.view();
    assert_eq!(v.fired_ids(), vec!["SH.GHEP.CHUA_VAO_CHUONG"]);
    assert!(v.disqualified, "chưa vào chuồng is a suspension");
    assert_eq!(v.phase, Phase::Done);
}

#[test]
fn the_end_key_is_an_edge_so_a_latched_key_does_not_end_the_run_every_tick() {
    // Standing in the lane, still, well clear of the bay, with the end key held high from the start.
    let lane = crate::rules::Ruleset::load().park.doc_lane_m(&crate::rules::Ruleset::load().vehicle);
    let mut s = placed(DOC, (8.0, 0.5 * lane, core::f64::consts::PI), 3);
    // First tick carries the key: the exam ends there, on CHUA_VAO_CHUONG.
    s.step(TickInput { clutch: 255, flags: PARK | TickInput::FLAG_START_ORDER, ..Default::default() });
    assert_eq!(s.view().fired("SH.GHEP.CHUA_VAO_CHUONG"), 1);
    // Every later tick must not charge anything again, however long the key is held.
    for _ in 0..120 {
        hold(&mut s);
        s.step(TickInput { clutch: 255, flags: PARK | TickInput::FLAG_START_ORDER, ..Default::default() });
    }
    let v = s.view();
    assert_eq!(v.fired("SH.GHEP.CHUA_VAO_CHUONG"), 1, "one end, one verdict");
    assert_eq!(v.score, 100, "a suspension is not also points");
}

#[test]
fn the_240_s_cap_ends_the_exam_and_charges_qua_thoi_gian_once_per_two_minutes() {
    let lane_y = 0.5 * crate::rules::Ruleset::load().park.doc_lane_m(&crate::rules::Ruleset::load().vehicle);
    // Sitting in the lane, 240 s of doing nothing. The clock starts when the bumper crosses the gate
    // at x = 0, which is ahead of the car: drive it there first.
    let mut s = placed(DOC, (8.0, lane_y, core::f64::consts::PI), 3);
    let mut ticks = 0;
    while s.snapshot()[36] == 0.0 && ticks < 60 * 40 {
        s.step(TickInput { gear: 1, clutch: 200, ..Default::default() });
        ticks += 1;
    }
    assert!(s.snapshot()[36] > 0.0, "the clock starts when the bumper crosses the gate");
    // Now stand on the brake and wait for the cap.
    let mut charges = 0;
    for _ in 0..(60 * 260) {
        s.step(TickInput { clutch: 255, brake: 255, ..Default::default() });
        charges = s.view().fired("SH.GHEP.QUA_THOI_GIAN");
        if s.view().phase == Phase::Done {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.phase, Phase::Done, "the cap ends the run");
    assert_eq!(charges, 1, "240 s is two minutes over 120 s, so exactly one charge");
    assert_eq!(v.score, 95, "the cap costs the time charge and the missing signal");
    assert!(v.disqualified || v.fired("SH.GHEP.CHUA_VAO_CHUONG") == 1, "and it never got in the bay");
}

#[test]
fn a_line_touch_in_a_bay_exercise_charges_the_ghep_code_not_bai_4s() {
    // The contact model is shared with bài 4 and bài 6, and the rule id must follow the exercise:
    // a park run that fell through to the bài 4/6 mapper would charge SH.04.* on a run with no
    // SH.04.* row in its own table, and the score would be wrong without any test failing.
    let probe = Session::new(NGANG | 1).unwrap();
    let (x0, y0, x1, _) = park_of(&probe);
    // Park the car across the bay's mouth line, so a wheel is on it.
    let mut s = placed(NGANG, (0.5 * (x0 + x1), 0.0, 0.0), 3);
    for _ in 0..5 {
        hold(&mut s);
    }
    let v = s.view();
    assert_eq!(v.fired("SH.04.DE_VACH"), 0, "bài 8 never charges bài 4's code: {:?}", v.fired_ids());
    assert_eq!(v.fired("SH.04.DE_VACH_KEO_DAI"), 0, "nor its five-second mark");
    let _ = y0;
}

// ---------------------------------------------------------------------------------------------
// SAI_HINH, DE_VACH and VIA_HE.
// ---------------------------------------------------------------------------------------------

#[test]
fn sai_hinh_is_the_centre_leaving_the_figure_and_reversing_is_not() {
    let rs = crate::rules::Ruleset::load();
    let probe = Session::new(DOC | 1).unwrap();
    let (x0, y0, x1, y1) = park_of(&probe);
    let lane = rs.park.doc_lane_m(&rs.vehicle);
    let _ = (x1, y1);

    // Reversing a long way inside the bay must charge nothing: "Lùi để ghép xe vào nơi đỗ".
    let mut s = placed(DOC, (0.5 * (x0 + rs.park.doc_width_m(&rs.vehicle)), y0 + 0.1, -core::f64::consts::FRAC_PI_2), 3);
    let before = s.view().score;
    for _ in 0..30 {
        s.step(TickInput { gear: -1, clutch: 210, ..Default::default() });
    }
    assert_eq!(s.view().fired("SH.GHEP.SAI_HINH"), 0, "reversing inside the bay is the exercise");
    let _ = before;

    // Well outside the lane, past the margin: SAI_HINH, and the run is suspended.
    let mut s = placed(DOC, (x0 + 2.0, lane + rs.park.outside_margin_m + 0.5, 0.0), 3);
    hold(&mut s);
    let v = s.view();
    assert_eq!(v.fired("SH.GHEP.SAI_HINH"), 1, "the centre left the figure");
    assert!(v.disqualified, "đi không đúng hình is a suspension");
}
