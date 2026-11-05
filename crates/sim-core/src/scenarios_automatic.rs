//! Scenario tests for the automatic: what changes against the manual car, and what must not.
//! The wire's gear byte is the selector here (above 0 is D), and the clutch byte is ignored.

use crate::{AUTOMATIC_BIT, Phase, Session, TickInput};

const HILL: u64 = 3 << 56;
const GEAR: u64 = 10 << 56;
const D: i8 = 1;
const R: i8 = -1;

fn auto(exercise: u64) -> Session {
    Session::new(exercise | AUTOMATIC_BIT | 1).unwrap()
}

fn input(selector: i8, throttle: u8, brake: u8) -> TickInput {
    TickInput { gear: selector, throttle, brake, ..Default::default() }
}

#[test]
fn the_engine_cannot_be_stalled_by_any_pedal_mix_in_d_or_r() {
    // Bài 3 starts with the engine idling, so a stall would be the first thing to show.
    for selector in [D, R] {
        for (throttle, brake) in [(0, 255), (255, 255), (0, 0), (255, 0), (40, 255)] {
            let mut s = auto(HILL);
            for _ in 0..900 {
                s.step(input(selector, throttle, brake));
            }
            assert!(s.view().engine_on, "stalled in selector {selector} with throttle {throttle} brake {brake}");
            assert_eq!(s.view().fired("SH.X.CHET_MAY"), 0);
        }
    }
}

#[test]
fn the_car_creeps_at_a_few_kmh_when_the_brake_is_let_go_in_d() {
    let mut s = auto(HILL);
    for _ in 0..120 {
        s.step(input(D, 0, 0));
    }
    let v = s.view().speed_mps;
    assert!(v > 1.0 && v < 2.5, "creep on the flat should be a few km/h, was {v} m/s");
}

#[test]
fn bai_3_with_nothing_to_hold_the_car_rolls_back_past_500_mm_and_is_suspended() {
    // Creep alone cannot climb the 10 % slope: the car stops short of the line, then rolls back.
    let mut s = auto(HILL);
    for _ in 0..60 * 40 {
        s.step(input(D, 0, 0));
        if s.view().disqualified {
            break;
        }
    }
    assert_eq!(s.view().fired("SH.03.TUT_DOC"), 1);
    assert!(s.view().disqualified);
}

#[test]
fn bai_10_on_an_automatic_judges_the_speed_only() {
    // Creep all the way: far below 24 km/h at sign 2 → SAI_TOC_DO once, and never the gear rows.
    let mut slow = auto(GEAR);
    for _ in 0..60 * 120 {
        slow.step(input(D, 0, 0));
        if slow.view().phase == Phase::Done {
            break;
        }
    }
    let v = slow.view();
    assert_eq!(v.phase, Phase::Done);
    assert_eq!((v.fired("SH.SO.SAI_TOC_DO"), v.fired("SH.SO.SAI_SO"), v.fired("SH.SO.SAI_CA_HAI")), (1, 0, 0));
    assert_eq!(v.score, 95);

    // Full throttle all the way: fast enough at sign 2, still fast at sign 3 → again one SAI_TOC_DO.
    let mut fast = auto(GEAR);
    for _ in 0..60 * 120 {
        fast.step(input(D, 255, 0));
        if fast.view().phase == Phase::Done {
            break;
        }
    }
    let v = fast.view();
    assert_eq!((v.fired("SH.SO.SAI_TOC_DO"), v.fired("SH.SO.SAI_SO"), v.fired("SH.SO.SAI_CA_HAI")), (1, 0, 0));
}

#[test]
fn bai_10_never_reached_is_charged_on_the_speed_not_the_gear() {
    // Parked for the whole 240 s cap: neither sign is reached, and the gear rows still stay out.
    let mut s = auto(GEAR);
    for _ in 0..60 * 250 {
        s.step(TickInput { flags: TickInput::FLAG_HANDBRAKE, ..Default::default() });
        if s.view().phase == Phase::Done {
            break;
        }
    }
    let v = s.view();
    assert_eq!((v.fired("SH.SO.SAI_TOC_DO"), v.fired("SH.SO.SAI_SO"), v.fired("SH.SO.SAI_CA_HAI")), (2, 0, 0));
}
