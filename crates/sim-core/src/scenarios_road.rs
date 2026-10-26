//! Scenario tests for bài 2 (dừng xe nhường đường cho người đi bộ), bài 9 (tạm dừng ở chỗ có đường
//! sắt chạy qua) and bài 11 (kết thúc), in the style of `scenarios_hill.rs`: input scripts through
//! the public `Session::step`, each rule given a run that triggers it and one that does not.
//!
//! The driver reads only what the page can read (the snapshot), and says what to do at a *place*
//! ("brake so as to stop 0,3 m short of the line"), never at a tick number.

use crate::{Phase, Session, TickInput};

const CROSSWALK: u64 = 2 << 56;
const RAIL: u64 = 9 << 56;
const FINISH: u64 = 11 << 56;
const HANDBRAKE: u8 = TickInput::FLAG_HANDBRAKE;
const RIGHT: u8 = TickInput::FLAG_SIGNAL_RIGHT;
const IGN: u8 = TickInput::FLAG_IGNITION;
const TICKS_PER_S: u32 = 60;

// Snapshot indices (the list in `lib.rs`).
const BUMPER: usize = 9;
const LINE_GAP: usize = 21;
const STOP_A: usize = 22;
const SINCE_STOP: usize = 24;
const ZONE: usize = 49;
const ROUTE: usize = 50;

fn line_m() -> f64 {
    crate::rules::Ruleset::load().road.stop_line_m()
}

fn finish_m() -> f64 {
    crate::rules::Ruleset::load().road.finish_m()
}

/// The approach every scenario here drives: brake on a predicted stopping point, decided once and
/// then kept, then hold, then pull away.
struct Approach {
    stop_at_m: f64,
    hold_ticks: u32,
    go_on: bool,
    flags: u8,
    braking: bool,
    stopped_at: Option<u32>,
}

impl Approach {
    fn new(stop_at_m: f64) -> Self {
        Self { stop_at_m, hold_ticks: 90, go_on: true, flags: 0, braking: false, stopped_at: None }
    }

    fn hold(mut self, ticks: u32) -> Self {
        self.hold_ticks = ticks;
        self
    }

    fn without_going_on(mut self) -> Self {
        self.go_on = false;
        self
    }

    fn with_flags(mut self, flags: u8) -> Self {
        self.flags = flags;
        self
    }

    fn input(&mut self, s: &Session, t: u32) -> TickInput {
        if t < 20 {
            return TickInput { clutch: 255, flags: HANDBRAKE | self.flags, ..Default::default() };
        }
        let v = s.view();
        if v.phase == Phase::Stopped && self.stopped_at.is_none() {
            self.stopped_at = Some(t);
        }
        match self.stopped_at {
            None => {
                let stop_distance = v.speed_mps * v.speed_mps / (2.0 * 6.9);
                self.braking |= v.front_bumper_m + stop_distance >= self.stop_at_m;
                if self.braking {
                    TickInput { gear: 1, clutch: 255, brake: 255, flags: self.flags, ..Default::default() }
                } else {
                    TickInput { gear: 1, clutch: 168, throttle: 80, flags: self.flags, ..Default::default() }
                }
            }
            Some(at) if t - at < self.hold_ticks || !self.go_on => {
                TickInput { gear: 1, clutch: 255, brake: 255, flags: self.flags, ..Default::default() }
            }
            Some(_) => TickInput { gear: 1, clutch: 150, throttle: 90, flags: self.flags, ..Default::default() },
        }
    }
}

/// Drive `seed` with `driver` until the exercise ends, or until `limit_s` runs out.
fn drive(seed: u64, limit_s: u32, mut driver: impl FnMut(&Session, u32) -> TickInput) -> Session {
    let mut s = Session::new(seed).expect("a known exercise");
    for t in 0..limit_s * TICKS_PER_S {
        let input = driver(&s, t);
        s.step(input);
        if s.view().phase == Phase::Done || s.view().disqualified {
            break;
        }
    }
    s
}

fn stop_run(seed: u64, approach: Approach) -> Session {
    let mut approach = approach;
    drive(seed, 120, |s, t| approach.input(s, t))
}

/// A right-signal clean bài 11: right signal on from the line, over the finish, then stop.
fn finish_run(seed: u64, flags: u8) -> Session {
    let finish = finish_m();
    let mut approach = Approach::new(finish + 2.0).with_flags(flags).hold(600);
    drive(seed, 120, |s, t| approach.input(s, t))
}

// ---------------------------------------------------------------------------------------------
// Both exercises start and report themselves the way the road scene says.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_road_exercises_start_like_bai_3_and_are_on_the_road_route() {
    for id in [CROSSWALK, RAIL, FINISH] {
        let s = Session::new(id | 1).expect("a road exercise runs");
        let snap = s.snapshot();
        assert_eq!(snap[1], 1.0, "underway from the first step: no start order");
        assert_eq!(snap[0], 0.0);
        assert_eq!(snap[2], 100.0);
        assert_eq!(snap[8], 850.0, "engine idling");
        assert_eq!(snap[17], 1.0, "handbrake on");
        assert_eq!(snap[ROUTE], 1.0, "the straight road route");
        assert_eq!(snap[ZONE], 2.0, "the car waits inside the stop zone, 1,0 m before the line");
        assert!(!s.course_block().is_empty(), "the scene is drawn");
    }
    assert!(Session::new(7 << 56).is_none(), "bài 7 is still refused");
}

#[test]
fn the_snapshot_reports_the_stop_line_distance_a_and_the_zone() {
    let start = Session::new(CROSSWALK | 1).unwrap().snapshot();
    let line = line_m();
    assert_eq!(start[LINE_GAP], line - start[BUMPER], "the gap is live and positive while short");
    assert_eq!(start[STOP_A], 0.0, "no stop yet");
    assert_eq!(start[SINCE_STOP], -1.0, "no stop yet");

    // Read the snapshot on the stop tick: the run goes on past the line afterwards, and the zone
    // and the gap are live values of where the car is now.
    let mut approach = Approach::new(line - 0.3);
    let mut s = Session::new(CROSSWALK | 1).unwrap();
    let mut at_stop = None;
    for t in 0..120 * TICKS_PER_S {
        let input = approach.input(&s, t);
        s.step(input);
        if s.view().phase == Phase::Stopped {
            at_stop = Some(s.snapshot());
            break;
        }
    }
    let snap = at_stop.expect("the car stops at the line");
    assert!(snap[STOP_A] > 0.0 && snap[STOP_A] <= 0.5, "A recorded at the stop, got {}", snap[STOP_A]);
    assert_eq!(snap[SINCE_STOP], 0.0, "0 on the stop step");
    // A = 500 mm is still inside the stop zone: the "at the line" band is the paint, a tenth of a
    // metre either side, and a legal stop is up to half a metre short of it.
    assert_eq!(snap[ZONE], 2.0, "a stop inside A is still in the stop zone");
    assert!(snap[LINE_GAP].abs() <= 0.5, "the gap equals A at the stop, got {}", snap[LINE_GAP]);
}

// ---------------------------------------------------------------------------------------------
// SH.02.KHONG_DUNG / SH.DS.KHONG_DUNG — "Không dừng xe ở vạch dừng quy định, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_dung_triggers_when_the_car_never_stops_and_five_points_are_taken() {
    for (seed, id) in [(CROSSWALK | 1, "SH.02.KHONG_DUNG"), (RAIL | 1, "SH.DS.KHONG_DUNG")] {
        // Drive straight through without ever braking.
        let s = drive(seed, 60, |_s, t| {
            if t < 20 {
                TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() }
            } else {
                TickInput { gear: 1, clutch: 150, throttle: 90, ..Default::default() }
            }
        });
        let v = s.view();
        assert_eq!(v.fired(id), 1, "{id}: {:?}", v.fired_ids());
        assert_eq!(v.score, 95, "five points");
        assert!(!v.disqualified, "it is a deduction, not a suspension");
        assert_eq!(v.phase, Phase::Done, "the run still ends");
    }
}

#[test]
fn khong_dung_does_not_trigger_when_the_car_stops_at_the_line() {
    for seed in [CROSSWALK | 1, RAIL | 1] {
        let v = stop_run(seed, Approach::new(line_m() - 0.3));
        assert_eq!(v.view().fired_ids(), Vec::<&str>::new(), "a stop at the line is clean");
        assert_eq!(v.view().score, 100);
    }
}

// ---------------------------------------------------------------------------------------------
// SH.02/DS.CHUA_DEN_VACH and .QUA_VACH — the two ways distance A can be wrong.
// ---------------------------------------------------------------------------------------------

#[test]
fn chua_den_vach_triggers_when_the_car_stops_more_than_500_mm_short() {
    for (seed, id) in [(CROSSWALK | 1, "SH.02.CHUA_DEN_VACH"), (RAIL | 1, "SH.DS.CHUA_DEN_VACH")] {
        let s = stop_run(seed, Approach::new(line_m() - 1.2));
        let v = s.view();
        assert_eq!(v.fired(id), 1, "{id}: {:?}", v.fired_ids());
        assert_eq!(v.score, 95);
        assert!(s.snapshot()[STOP_A] > 0.5, "A over 500 mm, got {}", s.snapshot()[STOP_A]);
    }
}

#[test]
fn qua_vach_triggers_when_the_car_stops_past_the_line() {
    for (seed, id) in [(CROSSWALK | 1, "SH.02.QUA_VACH"), (RAIL | 1, "SH.DS.QUA_VACH")] {
        let s = stop_run(seed, Approach::new(line_m() + 0.1));
        let v = s.view();
        assert_eq!(v.fired(id), 1, "{id}: {:?}", v.fired_ids());
        assert_eq!(v.score, 95);
        assert!(s.snapshot()[STOP_A] < 0.0, "A negative past the line, got {}", s.snapshot()[STOP_A]);
    }
}

#[test]
fn the_charge_follows_distance_a_and_nothing_else() {
    // The invariant, checked against the A the run actually recorded rather than against the A the
    // driver aimed for: within 500 mm nothing is charged; short of it is CHUA_DEN_VACH; past it is
    // QUA_VACH. Sweeping the aim across both edges is what makes this a statement about the rule
    // and not about one lucky stop.
    let line = line_m();
    let mut saw_within = 0;
    let mut saw_short = 0;
    let mut saw_past = 0;
    for aim in [-0.6, -0.3, -0.1, 0.0, 0.05, 0.2, 0.3, 0.45, 0.55, 0.8, 1.2] {
        let mut approach = Approach::new(line - aim).hold(10);
        let mut s = Session::new(CROSSWALK | 1).unwrap();
        let mut a = None;
        for t in 0..120 * TICKS_PER_S {
            let input = approach.input(&s, t);
            s.step(input);
            if s.view().phase == Phase::Stopped {
                a = Some(s.snapshot()[STOP_A]);
                break;
            }
        }
        let a = a.expect("the car stops in the zone");
        let v = s.view();
        let short = v.fired("SH.02.CHUA_DEN_VACH");
        let past = v.fired("SH.02.QUA_VACH");
        if a > 0.5 {
            saw_short += 1;
            assert_eq!((short, past), (1, 0), "A = {a:.3} m short must be CHUA_DEN_VACH only");
        } else if a < 0.0 {
            saw_past += 1;
            assert_eq!((short, past), (0, 1), "A = {a:.3} m past must be QUA_VACH only");
        } else {
            saw_within += 1;
            assert_eq!((short, past), (0, 0), "A = {a:.3} m is within 500 mm and is charged nothing");
        }
        assert_eq!(v.fired("SH.02.KHONG_DUNG"), 0, "a stop at the line is never KHONG_DUNG");
    }
    assert!(saw_within >= 3 && saw_short >= 1 && saw_past >= 1, "the sweep covered both edges");
}

#[test]
fn a_stop_before_the_stop_zone_is_not_a_stop_of_the_exercise() {
    // Stopping well before the zone and then going on must not be judged as "chưa đến vạch": the
    // law's errors are about the stop at the line, and a pause on the approach is not one.
    let line = line_m();
    let zone_start = line - crate::rules::Ruleset::load().road.stop_zone_length_m;
    let s = stop_run(CROSSWALK | 1, Approach::new(zone_start - 2.0));
    let v = s.view();
    assert!(
        !v.fired_ids().iter().any(|id| id.ends_with("CHUA_DEN_VACH")),
        "a stop before the zone is not a short stop: {:?}",
        v.fired_ids()
    );
    assert_eq!(s.snapshot()[STOP_A], 0.0, "no stop recorded: it was not the exercise's stop");
}

// ---------------------------------------------------------------------------------------------
// SH.KT.KHONG_XI_NHAN_PHAI — "Khi xe qua vạch kết thúc: a) Không bật đèn xi nhan phải, trừ 05 điểm"
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_xi_nhan_phai_triggers_when_the_finish_line_is_crossed_without_the_right_signal() {
    let s = finish_run(FINISH | 1, 0);
    let v = s.view();
    assert_eq!(v.fired("SH.KT.KHONG_XI_NHAN_PHAI"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.score, 95);
    assert_eq!(v.phase, Phase::Done, "the car still stops past the line and the run ends");
}

#[test]
fn khong_xi_nhan_phai_does_not_trigger_with_the_right_signal_on() {
    let s = finish_run(FINISH | 1, RIGHT);
    let v = s.view();
    assert_eq!(v.fired_ids(), Vec::<&str>::new(), "right signal, clean run");
    assert_eq!(v.score, 100);
    assert_eq!(v.phase, Phase::Done);
}

#[test]
fn khong_xi_nhan_phai_is_read_on_the_tick_the_bumper_crosses_the_line() {
    // The signal goes on only after the line is behind: the law judges the moment of crossing, so
    // switching it on later does not undo the charge — and switching it off after the line does not
    // cause one.
    let finish = finish_m();
    let mut approach = Approach::new(finish + 2.0).hold(600);
    let s = drive(FINISH | 1, 120, |s2, t| {
        let crossed = s2.snapshot()[BUMPER] >= finish;
        let mut input = approach.input(s2, t);
        if crossed {
            input.flags |= RIGHT;
        }
        input
    });
    let v = s.view();
    assert_eq!(v.fired("SH.KT.KHONG_XI_NHAN_PHAI"), 1, "late signal still charges: {:?}", v.fired_ids());
}

// ---------------------------------------------------------------------------------------------
// SH.KT.KHONG_QUA_VACH — "Không qua vạch kết thúc, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_qua_vach_triggers_when_the_car_stops_short_of_the_finish_line() {
    let finish = finish_m();
    let s = stop_run(FINISH | 1, Approach::new(finish - 3.0).without_going_on().with_flags(RIGHT));
    let v = s.view();
    assert_eq!(v.fired("SH.KT.KHONG_QUA_VACH"), 1, "{:?}", v.fired_ids());
    assert!(v.disqualified, "stopping short of the finish line suspends the run");
}

#[test]
fn khong_qua_vach_does_not_trigger_when_the_car_stops_past_the_finish_line() {
    let s = finish_run(FINISH | 1, RIGHT);
    let v = s.view();
    assert_eq!(v.fired("SH.KT.KHONG_QUA_VACH"), 0, "{:?}", v.fired_ids());
    assert!(!v.disqualified);
    assert!(s.snapshot()[BUMPER] > finish_m(), "stopped past the line");
}
