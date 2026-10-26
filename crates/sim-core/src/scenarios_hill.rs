//! Scenario tests for bài 3 (stop and start on a slope), in the style of `scenarios.rs`: input
//! scripts through `Session::step`, each rule given a run that triggers it and, where it is
//! natural, the near miss on the other side of its threshold.
//!
//! The driver reads the state it can see (the snapshot, as the web does) and says what to do at a
//! *place* ("brake so as to stop 0.4 m short of the line"), never at a tick number.

use crate::{Phase, Session, TickInput};

const HILL: u64 = 3 << 56;
const HANDBRAKE: u8 = TickInput::FLAG_HANDBRAKE;
const TICKS_PER_S: u32 = 60;

// Snapshot indices (the list in `lib.rs`).
const BUMPER: usize = 9;
const LINE_GAP: usize = 21;
const STOP_A: usize = 22;
const ROLLBACK: usize = 23;
const SINCE_STOP: usize = 24;
const ELEVATION: usize = 25;
const GRADE: usize = 26;

/// Climbs at about 2 m/s and brakes when the predicted stopping point reaches `a` metres short of
/// the line (negative: past it). Braking is decided once and kept: a car that has begun to brake
/// does not let go again as its speed falls.
struct Approach {
    a: f64,
    braking: bool,
}

impl Approach {
    fn new(a: f64) -> Self {
        Self { a, braking: false }
    }

    fn input(&mut self, s: &Session, t: u32) -> TickInput {
        if t < 20 {
            // Idle, neutral, handbrake on, as the exercise starts.
            return TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() };
        }
        let v = s.view();
        let stop_distance = v.speed_mps * v.speed_mps / (2.0 * 6.9);
        if v.front_bumper_m > 0.0 && v.front_bumper_m + stop_distance >= 6.0 - self.a {
            self.braking = true;
        }
        if self.braking {
            // Clutch in so the engine does not stall, full brake.
            TickInput { clutch: 255, brake: 255, gear: 1, ..Default::default() }
        } else {
            TickInput { gear: 1, clutch: 168, throttle: 70, ..Default::default() }
        }
    }
}

/// Parked on the slope: clutch in, neutral, handbrake on.
fn hold() -> TickInput {
    TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() }
}

/// The hill start the exercise is about: handbrake on, clutch up to the bite with throttle, then
/// the handbrake off. `n` is the number of steps since the learner began.
fn hill_start(n: u32) -> TickInput {
    let clutch = 255u32.saturating_sub(n * 2).max(180) as u8;
    let flags = if clutch > 180 { HANDBRAKE } else { 0 };
    TickInput { gear: 1, clutch, throttle: 70, flags, ..Default::default() }
}

/// Everything released: neutral, no brake, no handbrake.
fn let_go() -> TickInput {
    TickInput { clutch: 255, ..Default::default() }
}

fn since_stop(s: &Session) -> Option<u32> {
    let n = s.snapshot()[SINCE_STOP];
    (n >= 0.0).then_some(n as u32)
}

/// Approach, stop `a` short of the line, hold the stop for `wait_s` seconds, hill start, and run
/// until the exercise ends (at most `limit_s` seconds from the stop).
fn stop_wait_start(a: f64, wait_s: u32, limit_s: u32) -> Session {
    let mut s = Session::new(HILL | 1).unwrap();
    let mut approach = Approach::new(a);
    for t in 0..(60 + limit_s) * TICKS_PER_S {
        let input = match since_stop(&s) {
            None => approach.input(&s, t),
            Some(n) if n < wait_s * TICKS_PER_S => hold(),
            Some(n) => hill_start(n - wait_s * TICKS_PER_S),
        };
        s.step(input);
    }
    s
}

#[test]
fn an_unknown_exercise_id_is_refused_not_run_as_bai_1() {
    // 7 is ghép xe dọc, which this core does not have yet: refused, not run as bài 1.
    assert!(Session::new(7 << 56 | 1).is_none());
    assert!(crate::abi::sim_create(7 << 56 | 1).is_null());
    assert!(Session::new(HILL | 1).is_some());
}

#[test]
fn a_clean_stop_and_hill_start_scores_nothing_and_ends_over_the_line() {
    let s = stop_wait_start(0.3, 2, 20);
    let v = s.view();
    assert_eq!(v.fired_ids(), Vec::<&str>::new());
    assert_eq!(v.score, 100);
    assert_eq!(v.phase, Phase::Done, "passing the line after the stop ends the run");
    assert!(!v.disqualified);
    assert!(v.front_bumper_m > 6.0, "the car is over the line, got {}", v.front_bumper_m);
}

#[test]
fn snapshot_reports_the_slope_and_the_stop() {
    let mut s = Session::new(HILL | 1).unwrap();
    let start = s.snapshot();
    assert_eq!(start[1], 1.0, "underway from the first step: no start order");
    assert_eq!(start[BUMPER], -8.0);
    assert_eq!(start[LINE_GAP], 14.0, "stop line 6 m past the foot, bumper 8 m short of it");
    assert_eq!((start[ELEVATION], start[GRADE], start[SINCE_STOP]), (0.0, 0.0, -1.0));

    let mut approach = Approach::new(0.3);
    let mut before_stop = start;
    for t in 0..1200 {
        if since_stop(&s).is_some() {
            break;
        }
        before_stop = s.snapshot();
        s.step(approach.input(&s, t));
    }
    let stopped = s.snapshot();
    assert_eq!(stopped[1], 4.0, "stopped");
    assert_eq!(stopped[SINCE_STOP], 0.0, "0 on the stop step");
    assert!((stopped[STOP_A] - 0.3).abs() < 0.05, "A is recorded, got {}", stopped[STOP_A]);
    assert_eq!(stopped[LINE_GAP], stopped[STOP_A], "the gap is live and the car has not moved since");
    assert_eq!(stopped[ROLLBACK], 0.0);
    assert!(stopped[GRADE] == 0.1 && stopped[ELEVATION] > 0.0, "on the slope, 10 %");
    assert_eq!((before_stop[STOP_A], before_stop[ROLLBACK]), (0.0, 0.0), "nothing recorded before the stop");
}

// ---------------------------------------------------------------------------------------------
// SH.03.CHUA_DEN_VACH — "Dừng xe chưa đến vạch dừng quy định, trừ 05 điểm." (A <= 500 mm is fine)
// ---------------------------------------------------------------------------------------------

#[test]
fn chua_den_vach_triggers_past_500_mm_and_the_run_goes_on() {
    let near = stop_wait_start(0.4, 1, 20);
    assert_eq!(near.view().fired_ids(), Vec::<&str>::new(), "A = 0.4 m is inside 500 mm");
    assert_eq!(near.view().score, 100);

    let short = stop_wait_start(0.6, 1, 20);
    let v = short.view();
    assert_eq!(v.fired_ids(), vec!["SH.03.CHUA_DEN_VACH"]);
    assert_eq!(v.score, 95);
    assert!(!v.disqualified, "a point deduction, not a disqualification");
    assert_eq!(v.phase, Phase::Done, "the run went on, started off and passed the line");
}

// ---------------------------------------------------------------------------------------------
// SH.03.QUA_VACH — "Dừng xe quá vạch dừng quy định, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn qua_vach_triggers_when_the_car_stops_past_the_line() {
    let on_the_line = stop_wait_start(0.1, 1, 20);
    assert_eq!(on_the_line.view().fired_ids(), Vec::<&str>::new(), "short of the line by 0.1 m");

    let past = stop_wait_start(-0.3, 1, 20);
    let v = past.view();
    assert_eq!(v.fired_ids(), vec!["SH.03.QUA_VACH"], "at rest 0.3 m past the line is a stop with A < 0");
    assert!(v.disqualified);
}

// ---------------------------------------------------------------------------------------------
// SH.03.KHONG_DUNG — "Không dừng xe ở vạch dừng quy định, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_dung_triggers_when_the_car_drives_on_a_metre_past_the_line() {
    let mut s = Session::new(HILL | 1).unwrap();
    for t in 0..1200 {
        let input = if t < 20 { hold() } else { TickInput { gear: 1, clutch: 168, throttle: 70, ..Default::default() } };
        s.step(input);
    }
    let v = s.view();
    assert_eq!(v.fired_ids(), vec!["SH.03.KHONG_DUNG"]);
    assert!(v.disqualified);
    assert!(
        (7.0..7.1).contains(&v.front_bumper_m),
        "charged as the bumper reaches 1 m past the line, got {}",
        v.front_bumper_m
    );
    // The near miss is in `qua_vach_triggers_...`: a car that comes to rest 0.3 m past the line
    // is a stop, so it is charged QUA_VACH and not KHONG_DUNG.
}

// ---------------------------------------------------------------------------------------------
// SH.03.QUA_30S — "Quá thời gian 30 giây kể từ khi dừng xe không khởi hành xe qua vạch dừng, bị
// đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn qua_30s_counts_from_the_stop_and_triggers_after_30_seconds() {
    // Starting off after 25 s: the approach plus 25 s plus the start is well over 30 s of the run,
    // but under 30 s from the stop, so the clock demonstrably runs from the stop.
    let in_time = stop_wait_start(0.3, 25, 40);
    let v = in_time.view();
    assert_eq!(v.fired_ids(), Vec::<&str>::new(), "over the line within 30 s of the stop");
    assert_eq!(v.phase, Phase::Done);

    let too_late = stop_wait_start(0.3, 35, 40);
    let v = too_late.view();
    assert_eq!(v.fired_ids(), vec!["SH.03.QUA_30S"]);
    assert!(v.disqualified);
    assert_eq!(v.events()[0].tick, v.tick, "the run ended on the charge");
    assert_eq!(too_late.snapshot()[SINCE_STOP], f64::from(30 * TICKS_PER_S + 1), "the step after 30 s");
}

// ---------------------------------------------------------------------------------------------
// SH.03.TUT_DOC — "Xe bị tụt dốc quá 500mm kể từ khi dừng xe, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn tut_doc_triggers_when_the_car_rolls_back_more_than_500_mm() {
    let mut s = Session::new(HILL | 1).unwrap();
    let mut approach = Approach::new(0.3);
    let mut t = 0;
    // A stop held on the handbrake alone for 25 s: a holding brake holds exactly. No creep, no
    // oscillation that adds up: the bumper does not move by a single bit.
    let mut stop_bumper = f64::NAN;
    while since_stop(&s).is_none_or(|n| n < 25 * TICKS_PER_S) {
        let input = match since_stop(&s) {
            None => approach.input(&s, t),
            Some(0) => {
                assert_eq!(s.view().speed_mps, 0.0, "a braked stop ends at exactly 0, not a hair of rollback");
                stop_bumper = s.snapshot()[BUMPER];
                hold()
            }
            Some(_) => hold(),
        };
        s.step(input);
        t += 1;
    }
    let held = s.snapshot();
    assert_eq!(s.view().fired_ids(), Vec::<&str>::new(), "25 s held on the slope costs nothing");
    assert_eq!(held[ROLLBACK], 0.0);
    assert_eq!(held[BUMPER], stop_bumper, "not one bit of creep");
    assert_eq!(s.view().speed_mps, 0.0, "speed exactly 0 while held");

    // Let everything go: the car rolls back, and is charged once it is 500 mm behind the stop.
    for _ in 0..5 * TICKS_PER_S {
        s.step(let_go());
        if s.view().fired("SH.03.TUT_DOC") == 1 {
            break;
        }
    }
    let v = s.view();
    assert_eq!(v.fired_ids(), vec!["SH.03.TUT_DOC"]);
    assert!(v.disqualified);
    let rolled = s.snapshot()[ROLLBACK];
    assert!((0.5..0.55).contains(&rolled), "charged as it passes 500 mm, got {rolled}");
}

#[test]
fn a_car_left_to_roll_back_without_a_braked_stop_is_still_a_stop() {
    // Coast up the slope in neutral with nothing held: gravity takes the speed through zero and
    // into a rollback. That step is the stop, so neither the 30 s clock nor TUT_DOC is escaped.
    let mut s = Session::new(HILL | 1).unwrap();
    let mut coasting = false;
    for t in 0..40 * TICKS_PER_S {
        coasting |= s.view().front_bumper_m > 1.0;
        let input = if t < 20 {
            hold()
        } else if coasting {
            let_go()
        } else {
            TickInput { gear: 1, clutch: 168, throttle: 70, ..Default::default() }
        };
        s.step(input);
    }
    let v = s.view();
    assert_eq!(v.fired_ids(), vec!["SH.03.CHUA_DEN_VACH", "SH.03.TUT_DOC"]);
    assert!(v.disqualified);
}

// ---------------------------------------------------------------------------------------------
// What counts as a stop: only inside the exercise zone.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_stop_on_the_flat_approach_is_not_a_stop() {
    // Creep 2 m on the flat, stop, and sit there for 40 s: no A, no 30 s clock, no rollback.
    let mut s = Session::new(HILL | 1).unwrap();
    for t in 0..(40 + 20) * TICKS_PER_S {
        let v = s.view();
        let input = if t < 20 {
            hold()
        } else if v.front_bumper_m < -6.0 {
            TickInput { gear: 1, clutch: 168, throttle: 70, ..Default::default() }
        } else {
            TickInput { clutch: 255, brake: 255, gear: 1, ..Default::default() }
        };
        s.step(input);
    }
    let v = s.view();
    let snap = s.snapshot();
    assert!(v.front_bumper_m < 0.0 && v.speed_mps == 0.0, "stopped on the flat, got {}", v.front_bumper_m);
    assert_eq!(v.fired_ids(), Vec::<&str>::new());
    assert_eq!(v.phase, Phase::Launched);
    assert_eq!((snap[SINCE_STOP], snap[STOP_A]), (-1.0, 0.0), "no stop recorded");

    // Then the real stop, in the zone, is the one that counts.
    let mut approach = Approach::new(0.6);
    for t in 0..20 * TICKS_PER_S {
        s.step(if since_stop(&s).is_some() { hold() } else { approach.input(&s, t) });
    }
    assert_eq!(s.view().fired_ids(), vec!["SH.03.CHUA_DEN_VACH"]);
    assert!(since_stop(&s).is_some());
}
