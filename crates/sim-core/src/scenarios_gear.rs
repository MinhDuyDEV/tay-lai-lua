//! Scenario tests for bài 10 (thay đổi số trên đường bằng): each SH.SO rule gets a run that fires
//! it and the clean run fires none. The runs are the golden driver's plans (`golden::gear_run`),
//! played through the public `Session::step`.

use crate::golden::{gear_run, run, GearPlan, GEAR_CLEAN};
use crate::{Phase, Session, TickInput};

const GEAR: u64 = 10 << 56;

fn play(plan: GearPlan) -> Session {
    let g = gear_run(GEAR | 1, "scenario", plan, false);
    run(&g)
}

/// Fault rows fired, by legal id, and the score.
fn fired(s: &Session, ids: &[&str]) -> Vec<usize> {
    let v = s.view();
    ids.iter().map(|id| v.fired(id)).collect()
}

const SO: &str = "SH.SO.SAI_SO";
const TOC_DO: &str = "SH.SO.SAI_TOC_DO";
const CA_HAI: &str = "SH.SO.SAI_CA_HAI";
const TIME: &str = "SH.SO.QUA_THOI_GIAN";

#[test]
fn a_clean_run_shifts_up_fast_then_down_slow_and_loses_nothing() {
    let s = play(GEAR_CLEAN);
    assert_eq!(s.view().phase, Phase::Done, "the run ends at the third sign");
    assert_eq!(s.view().score, 100);
    assert_eq!(fired(&s, &[SO, TOC_DO, CA_HAI, TIME]), [0, 0, 0, 0]);
}

#[test]
fn staying_in_gear_1_in_zone_1_is_sai_so_alone() {
    let s = play(GearPlan { up: false, top_mps: 8.0, ..GEAR_CLEAN });
    assert_eq!(fired(&s, &[SO, TOC_DO, CA_HAI]), [1, 0, 0], "fast enough, wrong gear");
    assert_eq!(s.view().score, 95);
}

#[test]
fn gear_2_but_under_24_kmh_at_sign_2_is_sai_toc_do_alone() {
    let s = play(GearPlan { top_mps: 5.0, ..GEAR_CLEAN });
    assert_eq!(fired(&s, &[SO, TOC_DO, CA_HAI]), [0, 1, 0], "right gear, too slow");
    assert_eq!(s.view().score, 95);
}

#[test]
fn wrong_gear_and_too_slow_in_one_zone_is_sai_ca_hai_not_the_other_two_added() {
    let s = play(GearPlan { up: false, top_mps: 5.0, ..GEAR_CLEAN });
    assert_eq!(fired(&s, &[SO, TOC_DO, CA_HAI]), [0, 0, 1]);
    assert_eq!(s.view().score, 95, "one 05 — not 10");
}

#[test]
fn zone_2_wants_gear_1_at_sign_3() {
    // Stays in gear 2, slowed down: the gear is wrong.
    let s = play(GearPlan { down: false, ..GEAR_CLEAN });
    assert_eq!(fired(&s, &[SO, TOC_DO, CA_HAI]), [1, 0, 0]);
}

#[test]
fn each_wrong_zone_is_charged_its_own_05() {
    let s = play(GearPlan { up: false, top_mps: 8.0, down: false, low_mps: 0.0, keep_speed: true });
    assert_eq!(fired(&s, &[SO, TOC_DO, CA_HAI]), [1, 1, 0], "zone 1 gear, zone 2 speed");
    assert_eq!(s.view().score, 90);
}

#[test]
fn every_whole_2_minutes_over_is_05_and_a_run_that_never_moves_ends_at_240_s() {
    let mut s = Session::new(GEAR | 1).unwrap();
    let parked = TickInput { clutch: 255, flags: TickInput::FLAG_HANDBRAKE, ..Default::default() };
    for _ in 0..7200 {
        s.step(parked);
    }
    assert_eq!(fired(&s, &[TIME]), [0], "120 s exactly is not over 2 minutes");
    s.step(parked);
    assert_eq!(fired(&s, &[TIME]), [1]);
    while s.view().phase != Phase::Done {
        s.step(parked);
    }
    assert_eq!(s.view().tick, 14400, "the cap");
    assert_eq!(fired(&s, &[TIME, CA_HAI]), [1, 2], "240 s exactly is one charge; both zones never reached");
    assert_eq!(s.view().score, 100 - 5 - 10);
}

#[test]
fn the_messy_golden_has_the_common_faults_and_both_zone_faults_in_it() {
    let s = run(&crate::golden::gear_golden_messy());
    assert_eq!(fired(&s, &[SO, TOC_DO, "SH.X.RPM", "SH.X.CHET_MAY"]), [1, 1, 1, 1]);
}
