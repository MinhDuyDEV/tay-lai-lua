//! Scenario tests for bài 3 (stop and start on a slope), in the style of `scenarios.rs`.

use crate::{Session, TickInput};

const HILL: u64 = 3 << 56;

#[test]
fn an_unknown_exercise_id_is_refused_not_run_as_bai_1() {
    assert!(Session::new(2 << 56 | 1).is_none());
    assert!(crate::abi::sim_create(2 << 56 | 1).is_null());
    assert!(Session::new(HILL | 1).is_some());
}
