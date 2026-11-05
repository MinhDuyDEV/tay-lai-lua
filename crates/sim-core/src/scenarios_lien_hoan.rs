//! Scenario tests for sa hình liên hoàn: the run adds a clock, a score and a verdict around the per-bài
//! sessions and changes no bài's judgement; the link between bài 6 and bài 7 carries the hazard and the
//! wrong-place stops. Inputs are the goldens' own, cut at each bài's end.

use crate::chain::{Chain, LESSONS};
use crate::golden::{drive_link, lien_hoan, lien_hoan_bai, lien_hoan_seed, play, to_the_end, LinkPlan, LINK_CLEAN};
use crate::rules::Ruleset;
use crate::{Event, Phase, Session, Sim};

const SEED: u64 = 0;

fn fired(c: &Chain, id: &str) -> Vec<Event> {
    let code = c.rules().rule(id).code;
    c.events().iter().copied().filter(|e| e.code == code).collect()
}

fn manual() -> Vec<crate::golden::Golden> {
    let [manual, _] = lien_hoan_bai();
    manual
}

#[test]
fn the_run_is_an_exercise_of_its_own_and_no_bai_accepts_its_id() {
    assert!(Session::new(lien_hoan_seed(false)).is_none());
    assert!(Sim::new(lien_hoan_seed(false)).is_some());
}

/// The invariant of the lane: inside the run each bài is judged exactly as on its own page. At every
/// bài, up to its last step the run's session is bit-identical to a standalone session on the same
/// seed word fed the same inputs; the last step produces the same events; and the run then holds the
/// next stage, fresh. The link is driven between bài 6 and bài 7 and, driven cleanly, costs nothing.
#[test]
fn every_bai_is_judged_in_the_run_as_on_its_own_page() {
    for (variant, parts) in lien_hoan_bai().iter().enumerate() {
        let seed = lien_hoan_seed(variant == 1);
        let mut chain = Chain::new(seed, Ruleset::load());
        let mut expected: Vec<(u16, i16)> = Vec::new();
        for (k, g) in parts.iter().enumerate() {
            if chain.on_the_link() {
                drive_link(&mut chain, &mut Vec::new(), LINK_CLEAN);
                let got: Vec<(u16, i16)> = chain.events().iter().map(|e| (e.code, e.points)).collect();
                assert_eq!(got, expected, "variant {variant}: the clean link cost something");
            }
            let lesson = k as u8 + 1;
            assert_eq!(chain.lesson(), lesson);
            let inputs = to_the_end(g);
            let mut alone = Session::new(Chain::bai_seed(seed, lesson)).unwrap();
            let (last, head) = inputs.split_last().unwrap();
            for &i in head {
                alone.step(i);
                chain.step(i);
            }
            assert_eq!(chain.lesson(), lesson, "bài {lesson} ended early");
            assert_eq!(chain.inner().hash(), alone.hash(), "variant {variant} bài {lesson} drifted");
            alone.step(*last);
            chain.step(*last);
            assert_eq!(alone.view().phase, Phase::Done);
            expected.extend(alone.view().events().iter().map(|e| (e.code, e.points)));
            let got: Vec<(u16, i16)> = chain.events().iter().map(|e| (e.code, e.points)).collect();
            assert_eq!(got, expected, "variant {variant} bài {lesson} events");
        }
        assert_eq!(chain.lesson(), LESSONS);
    }
}

#[test]
fn a_clean_run_of_all_eleven_bai_passes_with_100_and_no_fault() {
    for g in lien_hoan() {
        let sim = crate::golden::run_any(&g);
        let Sim::LienHoan(c) = &sim else { panic!("not a run") };
        let snap = sim.snapshot();
        assert_eq!((snap[54], snap[56]), (11.0, 1.0), "{}: bài 11, passed", g.name);
        assert_eq!((snap[1], snap[2], snap[3]), (3.0, 100.0, 0.0), "{}: done, 100, not suspended", g.name);
        assert!(c.events().is_empty(), "{}: {:?}", g.name, c.events());
        // The run's clock starts at bài 1's order, 20 ticks of cold start into the first golden.
        assert_eq!(snap[55] as usize, g.inputs.len() - 20, "{}", g.name);
    }
}

#[test]
fn the_run_stops_for_good_when_a_bai_is_suspended() {
    let [_, mut auto] = lien_hoan_bai();
    auto[2] = crate::golden::hill_auto_tut_doc();
    let (mut c, inputs) = play(lien_hoan_seed(true), Ruleset::load(), &auto, LINK_CLEAN);
    assert_eq!(c.lesson(), 3, "bài 3 suspended the run; the other eight never started");
    let snap = c.snapshot();
    assert_eq!((snap[1], snap[3], snap[56]), (3.0, 1.0, 2.0), "done, suspended, failed");
    assert_eq!(fired(&c, "SH.03.TUT_DOC").len(), 1);
    let before = c.hash();
    for &i in &inputs[..60] {
        c.step(i);
    }
    assert_eq!(c.hash(), before, "a finished run takes no more input");
}

#[test]
fn faults_of_every_bai_add_up_in_the_run_score() {
    let mut parts = manual();
    let messy = crate::golden::gear_golden_messy();
    let mut alone = Session::new(Chain::bai_seed(lien_hoan_seed(false), 10)).unwrap();
    for &i in &to_the_end(&messy) {
        alone.step(i);
    }
    assert!(!alone.view().disqualified && alone.view().score < 100, "the messy gear run loses points, keeps going");
    parts[9] = messy;
    let (c, _) = play(lien_hoan_seed(false), Ruleset::load(), &parts, LINK_CLEAN);
    assert_eq!(c.score(), alone.view().score, "bài 10's faults are all the run lost");
    assert_eq!(c.snapshot()[56], 1.0, "and it still passes at or above 80");
}

#[test]
fn a_score_under_the_pass_line_after_bai_11_is_duoi_80_and_the_run_fails() {
    let mut rules = Ruleset::load();
    rules.scoring.pass = 101;
    let (c, _) = play(lien_hoan_seed(false), rules, &manual(), LINK_CLEAN);
    let duoi = fired(&c, "SH.KT.DUOI_80");
    assert_eq!(duoi.len(), 1);
    assert_eq!(duoi[0].points, 0, "đình chỉ carries no points");
    assert_eq!(c.snapshot()[56], 2.0);
}

#[test]
fn past_the_time_limit_every_three_seconds_cost_one_point() {
    let mut rules = Ruleset::load();
    rules.lien_hoan.time_limit_s = 120.0;
    let (c, inputs) = play(lien_hoan_seed(false), rules, &manual(), LINK_CLEAN);
    let run_ticks = inputs.len() as u32 - 20;
    let want = (run_ticks - 120 * 60) / 180;
    let hits = fired(&c, "SH.KT.TONG_THOI_GIAN");
    assert!(want > 0, "the clean run is longer than the shortened limit");
    assert_eq!(hits.len() as u32, want);
    assert_eq!(hits[0].tick, 120 * 60 + 180, "the first whole 3 s past the limit");
    assert!(hits.iter().all(|e| e.points == 1));
    assert_eq!(c.score(), 100 - want as i32);
}

// ---- the link ------------------------------------------------------------------------------

/// Drive the link alone with `plan` and say what the run charged on it, by legal id.
fn on_the_link(plan: LinkPlan) -> (Chain, Vec<(String, i16)>) {
    let mut c = Chain::on_link_for_test(SEED, Ruleset::load());
    drive_link(&mut c, &mut Vec::new(), plan);
    assert_eq!(c.lesson(), 7, "the link ends in bài 7");
    let charged = c
        .events()
        .iter()
        .map(|e| (c.rules().rules.iter().find(|r| r.code == e.code).unwrap().id.clone(), e.points))
        .collect();
    (c, charged)
}

#[test]
fn the_hazard_is_one_a_run_from_the_seed_and_handled_it_costs_nothing() {
    let (c, charged) = on_the_link(LINK_CLEAN);
    assert!(charged.is_empty(), "{charged:?}");
    assert_eq!(c.score(), 100);
    // The same seed meets the hazard at the same place; another seed does not have to.
    let at = |seed| Chain::new(seed, Ruleset::load()).hazard_at_for_test();
    let lh = &c.rules().lien_hoan;
    assert_eq!(at(7), at(7));
    assert!((lh.hazard_min_m..=lh.hazard_max_m).contains(&at(7)));
    assert_ne!(at(7), at(8));
}

#[test]
fn doing_nothing_about_the_hazard_is_khong_thuc_hien_once_and_not_the_other_three() {
    let (c, charged) = on_the_link(LinkPlan { brake: false, press: false, release: false, stop_early: false });
    assert_eq!(charged, [("SH.CHUNG.NGUY_HIEM.KHONG_THUC_HIEN".to_string(), 10)]);
    assert_eq!(c.score(), 90);
}

#[test]
fn braking_without_the_button_is_bat_tin_hieu_alone() {
    let (_, charged) = on_the_link(LinkPlan { brake: true, press: false, release: true, stop_early: false });
    assert_eq!(charged, [("SH.CHUNG.NGUY_HIEM.BAT_TIN_HIEU".to_string(), 10)]);
}

#[test]
fn going_on_with_the_button_down_is_tat_tin_hieu() {
    let (_, charged) = on_the_link(LinkPlan { brake: true, press: true, release: false, stop_early: false });
    assert_eq!(charged, [("SH.CHUNG.NGUY_HIEM.TAT_TIN_HIEU".to_string(), 10)]);
}

#[test]
fn a_stop_away_from_the_hazard_is_dung_sai_vi_tri_each_time() {
    let (c, charged) = on_the_link(LinkPlan { stop_early: true, ..LINK_CLEAN });
    assert_eq!(charged, [("SH.CHUNG.DUNG_SAI_VI_TRI".to_string(), 5)], "the hazard stop itself is the right one");
    assert_eq!(c.score(), 95);
}
