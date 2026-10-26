//! The stop detector: the one place in the core that answers "did the car stop at the line, and by
//! how much did it miss?".
//!
//! Bài 2, 3, 5 and 9 all ask the same question of a stop — `khoảng cách A` against the 500 mm the
//! law allows — and differ only in which rule ids they charge for the answer. Keeping one detector
//! is what stops the four exercises from slowly disagreeing about what a stop is; the codes are the
//! exercise's own business and live in `exercise.rs`.
//!
//! The reading the law does not give ("dừng xe" has no definition) is named in
//! `assumptions.stop_detector` in `content/rulesets/tt108-2026.json`:
//! * the car must have moved forward first — a stall on the approach is not a stop;
//! * forward speed must be non-positive on this tick;
//! * the bumper must be inside the exercise's stop zone, which is the fixed part of the road the
//!   stop belongs to (`road.stop_zone_length_m` before the line, or bài 3's slope).
//!
//! `never_stopped` is the same detector's answer at the far end of the road: the bumper passing
//! `line + no_stop_beyond_m` with no stop recorded.

/// What the car did about the stop line.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Verdict {
    /// It stopped with the bumper within A of the line.
    WithinA,
    /// It stopped, but short of the line by more than A (`a` metres).
    Short { a: f64 },
    /// It stopped past the line by `a` metres.
    Past { a: f64 },
    /// A stop happened somewhere the exercise does not count it — not the exercise's fault.
    NotInZone,
}

/// Geometry of one exercise's stop line, in metres along the approach.
#[derive(Clone, Copy, Debug)]
pub struct StopLine {
    /// Where the stop line is on the approach axis.
    pub line_m: f64,
    /// Distance A the law allows, from the ruleset.
    pub max_a_m: f64,
}

impl StopLine {
    /// Distance A for a bumper at `bumper_m`: positive short of the line, negative past it. This is
    /// the number the snapshot reports and the number the whole exercise is judged on.
    pub fn a_m(&self, bumper_m: f64) -> f64 {
        self.line_m - bumper_m
    }

    /// The verdict for a stop at `bumper_m`. `in_zone` says whether this stop is inside the part of
    /// the road the exercise counts; the caller decides what "the zone" is, because it is the one
    /// thing that differs between the exercises.
    pub fn verdict(&self, bumper_m: f64, in_zone: bool) -> Verdict {
        if !in_zone {
            return Verdict::NotInZone;
        }
        let a = self.a_m(bumper_m);
        if a < 0.0 {
            Verdict::Past { a }
        } else if a > self.max_a_m {
            Verdict::Short { a }
        } else {
            Verdict::WithinA
        }
    }
}

/// A stop this session has recorded: the detector's verdict and where the bumper was.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StopAt {
    pub tick: u32,
    pub front_bumper_m: f64,
    pub a_m: f64,
    pub verdict: Verdict,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_verdict_is_read_off_distance_a_and_the_zone() {
        let line = StopLine { line_m: 6.0, max_a_m: 0.5 };
        assert_eq!(line.verdict(6.0, true), Verdict::WithinA);
        assert_eq!(line.verdict(5.5, true), Verdict::WithinA, "exactly A is within A");
        match line.verdict(5.4, true) {
            Verdict::Short { a } => assert!((a - 0.6).abs() < 1e-12, "0,6 m short, got {a}"),
            other => panic!("a stop 0,6 m short is Short, got {other:?}"),
        }
        match line.verdict(6.1, true) {
            Verdict::Past { a } => assert!((a + 0.1).abs() < 1e-12, "0,1 m past, got {a}"),
            other => panic!("a stop 0,1 m past is Past, got {other:?}"),
        }
        assert_eq!(line.verdict(6.1, false), Verdict::NotInZone, "outside the zone nothing is charged");
        assert!((line.a_m(5.75) - 0.25).abs() < 1e-12);
    }
}
