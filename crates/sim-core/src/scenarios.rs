//! Scenario tests for the 8 rules of bài 1, written as input scripts through the public
//! `Session::step` interface. Each rule gets one run that triggers it and one that does not,
//! asserting on the fired event and the resulting score.
//!
//! The driver is a function of the state it can see before each step, so a scenario says what the
//! driver does at a *place* ("switch the signal off once the bumper is 5 m past the line"),
//! not at a tick number that would silently move if the car model changed.

use crate::{Session, TickInput, View};

const BELT: u8 = TickInput::FLAG_BELT;
const LEFT: u8 = TickInput::FLAG_SIGNAL_LEFT;
const IGN: u8 = TickInput::FLAG_IGNITION;

/// Drive for `ticks` steps. `driver` sees the state before the step and returns the input for it.
fn drive(ticks: u32, mut driver: impl FnMut(&View, u32) -> TickInput) -> Session {
    let mut s = Session::new(2026);
    for t in 0..ticks {
        let input = {
            let v = s.view();
            driver(&v, t)
        };
        s.step(input);
    }
    s
}

/// A launch that keeps the engine alive: clutch in while first is selected, then a gentle
/// engagement with light throttle. `signal_off_at_m` switches the left signal off when the front
/// bumper reaches that many metres past the start line.
struct Launch {
    belt: bool,
    signal: bool,
    signal_off_at_m: Option<f64>,
}

impl Launch {
    fn clean() -> Self {
        Self { belt: true, signal: true, signal_off_at_m: Some(5.0) }
    }

    fn input(&self, v: &View, t: u32) -> TickInput {
        let mut flags = if self.belt { BELT } else { 0 };
        let still_on = self.signal
            && self.signal_off_at_m.is_none_or(|at| v.front_bumper_m < at);
        if still_on {
            flags |= LEFT;
        }
        if t < 20 {
            // Clutch pressed, neutral: the engine idles before the launch.
            TickInput { gear: 0, clutch: 255, flags, ..Default::default() }
        } else {
            TickInput { gear: 1, clutch: 168, throttle: 70, flags, ..Default::default() }
        }
    }
}

fn clean() -> Launch {
    Launch::clean()
}

// ---------------------------------------------------------------------------------------------
// SH.01.DAY_AN_TOAN — "Không thắt dây an toàn, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn day_an_toan_triggers_without_the_belt() {
    let l = Launch { belt: false, ..clean() };
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.DAY_AN_TOAN"), 1, "{}", v.fired_ids().join(","));
    assert_eq!(v.score, 95);
}

#[test]
fn day_an_toan_does_not_trigger_with_the_belt() {
    let l = clean();
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.DAY_AN_TOAN"), 0);
    assert_eq!(v.score, 100, "{}", v.fired_ids().join(","));
}

// ---------------------------------------------------------------------------------------------
// SH.01.KHONG_XI_NHAN_TRAI — "Không bật đèn xi nhan trái khi xuất phát, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_xi_nhan_trai_triggers_when_the_car_moves_without_it() {
    let l = Launch { signal: false, signal_off_at_m: None, ..clean() };
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.KHONG_XI_NHAN_TRAI"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.01.XI_NHAN_KHONG_KIP"), 0, "one mistake, one charge");
    assert_eq!(v.fired("SH.01.KHONG_TAT_XI_NHAN"), 0);
    assert_eq!(v.score, 95);
}

#[test]
fn khong_xi_nhan_trai_does_not_trigger_when_the_signal_is_on_at_departure() {
    let l = clean();
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.KHONG_XI_NHAN_TRAI"), 0);
    assert_eq!(v.score, 100);
}

// ---------------------------------------------------------------------------------------------
// SH.01.KHONG_TAT_XI_NHAN — "Không tắt đèn xi nhan trái ở khoảng cách 05 mét sau vạch xuất
// phát (đèn xanh trên xe tắt), trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn khong_tat_xi_nhan_triggers_when_the_signal_stays_on_past_5m() {
    let l = Launch { signal: true, signal_off_at_m: None, ..clean() };
    let s = drive(900, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.KHONG_TAT_XI_NHAN"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.01.XI_NHAN_KHONG_KIP"), 0);
    assert_eq!(v.score, 95);
}

#[test]
fn khong_tat_xi_nhan_does_not_trigger_when_the_signal_goes_off_inside_the_window() {
    let l = clean();
    let s = drive(900, |v, t| l.input(v, t));
    let v = s.view();
    assert!(
        v.front_bumper_m > 6.0,
        "the run must pass the end of the window or this proves nothing, got {}",
        v.front_bumper_m
    );
    assert_eq!(v.fired("SH.01.KHONG_TAT_XI_NHAN"), 0, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.01.XI_NHAN_KHONG_KIP"), 0);
    assert_eq!(v.score, 100);
}

// ---------------------------------------------------------------------------------------------
// SH.01.XI_NHAN_KHONG_KIP — "Không bật và tắt đèn xi nhan trái kịp thời trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn xi_nhan_khong_kip_triggers_when_the_signal_goes_off_too_early() {
    // Off at 1 m: close enough to the line that the switch is not the timed one.
    let l = Launch { signal_off_at_m: Some(1.0), ..clean() };
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.XI_NHAN_KHONG_KIP"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.01.KHONG_TAT_XI_NHAN"), 0);
    assert_eq!(v.score, 95);
}

#[test]
fn xi_nhan_khong_kip_does_not_trigger_inside_the_window() {
    let l = clean();
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.XI_NHAN_KHONG_KIP"), 0, "{:?}", v.fired_ids());
    assert_eq!(v.score, 100);
}

// ---------------------------------------------------------------------------------------------
// SH.01.QUA_20S — "Quá 20 giây kể từ khi có lệnh xuất phát (đèn xanh trên xe bật sáng) không
// đi qua vạch xuất phát, trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn qua_20s_triggers_when_the_car_sits_at_the_line() {
    let s = drive(21 * 60, |_, _| TickInput { flags: BELT, ..Default::default() });
    let v = s.view();
    assert_eq!(v.fired("SH.01.QUA_20S"), 1, "{:?}", v.fired_ids());
    assert_eq!(v.fired("SH.01.QUA_30S"), 0);
    assert_eq!(v.score, 95);
}

#[test]
fn qua_20s_does_not_trigger_when_the_car_crosses_in_time() {
    let l = clean();
    let s = drive(20 * 60, |v, t| l.input(v, t));
    let v = s.view();
    assert!(v.front_bumper_m > 0.0, "car crossed the line, got {}", v.front_bumper_m);
    assert_eq!(v.fired("SH.01.QUA_20S"), 0, "{:?}", v.fired_ids());
    assert_eq!(v.score, 100, "{:?}", v.fired_ids());
}

// ---------------------------------------------------------------------------------------------
// SH.01.QUA_30S — "Quá 30 giây ... không đi qua vạch xuất phát, bị đình chỉ sát hạch."
// ---------------------------------------------------------------------------------------------

#[test]
fn qua_30s_triggers_and_disqualifies() {
    let s = drive(31 * 60, |_, _| TickInput { flags: BELT, ..Default::default() });
    let v = s.view();
    assert_eq!(v.fired("SH.01.QUA_30S"), 1, "{:?}", v.fired_ids());
    assert!(v.disqualified, "QUA_30S is a disqualification, not a deduction");
}

#[test]
fn qua_30s_does_not_trigger_when_the_car_crosses_in_time() {
    let l = clean();
    let s = drive(31 * 60, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.01.QUA_30S"), 0, "{:?}", v.fired_ids());
    assert!(!v.disqualified);
}

// ---------------------------------------------------------------------------------------------
// SH.X.CHET_MAY — "Xe bị chết máy, mỗi lần trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn chet_may_triggers_on_dropping_the_clutch_in_gear() {
    // First gear, clutch already released, no throttle: dead stall. The left signal is on so the
    // stall is the only thing charged.
    let s = drive(120, |_, _| TickInput {
        gear: 1,
        clutch: 0,
        flags: BELT | LEFT,
        ..Default::default()
    });
    let v = s.view();
    assert_eq!(v.fired("SH.X.CHET_MAY"), 1, "{:?}", v.fired_ids());
    assert!(!v.engine_on, "the engine is dead");
    assert_eq!(v.score, 95);
}

#[test]
fn chet_may_does_not_trigger_on_a_careful_launch() {
    let l = clean();
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert_eq!(v.fired("SH.X.CHET_MAY"), 0, "{:?}", v.fired_ids());
    assert!(v.engine_on);
}

#[test]
fn chet_may_counts_each_stall() {
    // Stall, restart with the clutch pressed, stall again, then stop trying: "mỗi lần" is twice,
    // not once, and each costs 05 points.
    let s = drive(600, |_, t| match t {
        // Stall it.
        0..10 => TickInput { gear: 1, clutch: 0, flags: BELT | LEFT, ..Default::default() },
        // Restart: clutch pressed, neutral, key held until the engine catches.
        10..70 => TickInput { gear: 0, clutch: 255, flags: BELT | LEFT | IGN, ..Default::default() },
        // Stall it again.
        70..80 => TickInput { gear: 1, clutch: 0, flags: BELT | LEFT, ..Default::default() },
        // Give up and sit still.
        _ => TickInput { gear: 0, clutch: 255, flags: BELT | LEFT, ..Default::default() },
    });
    let v = s.view();
    assert_eq!(v.fired("SH.X.CHET_MAY"), 2, "{:?}", v.fired_ids());
    assert_eq!(v.score, 90, "two stalls at 05 points each");
}

// ---------------------------------------------------------------------------------------------
// SH.X.RPM — "Để tốc độ động cơ quá 4000 vòng/phút, mỗi lần trừ 05 điểm."
// ---------------------------------------------------------------------------------------------

#[test]
fn rpm_triggers_when_revving_past_4000() {
    let s = drive(300, |v, _| {
        let flags = if v.front_bumper_m < 5.0 { BELT | LEFT } else { BELT };
        TickInput { gear: 0, clutch: 255, throttle: 255, flags, ..Default::default() }
    });
    let v = s.view();
    assert_eq!(v.fired("SH.X.RPM"), 1, "{:?}", v.fired_ids());
    assert!(v.rpm > 4000.0);
}

#[test]
fn rpm_does_not_trigger_when_kept_below_4000() {
    let l = clean();
    let s = drive(600, |v, t| l.input(v, t));
    let v = s.view();
    assert!(v.rpm <= 4000.0, "rpm stayed under the limit, got {}", v.rpm);
    assert_eq!(v.fired("SH.X.RPM"), 0, "{:?}", v.fired_ids());
}
