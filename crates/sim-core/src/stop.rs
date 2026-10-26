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
//! The detector answers about a stop that has already been decided to be one of the exercise's: the
//! caller owns "the zone" (bài 3's slope foot, the road's stop zone, the junction's cap before the
//! junction depth), because that is the one thing that differs between the exercises.

/// What the car did about the stop line.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Verdict {
    /// It stopped with the bumper within A of the line.
    WithinA,
    /// It stopped, but short of the line by more than A (`a` metres).
    Short { a: f64 },
    /// It stopped past the line by `a` metres.
    Past { a: f64 },
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

    /// The verdict for a stop at `bumper_m`. The caller has already decided that this stop is one
    /// of the exercise's; nothing here asks where the car was.
    pub fn verdict(&self, bumper_m: f64) -> Verdict {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_verdict_is_read_off_distance_a_and_the_zone() {
        let line = StopLine { line_m: 6.0, max_a_m: 0.5 };
        assert_eq!(line.verdict(6.0), Verdict::WithinA);
        assert_eq!(line.verdict(5.5), Verdict::WithinA, "exactly A is within A");
        match line.verdict(5.4) {
            Verdict::Short { a } => assert!((a - 0.6).abs() < 1e-12, "0,6 m short, got {a}"),
            other => panic!("a stop 0,6 m short is Short, got {other:?}"),
        }
        match line.verdict(6.1) {
            Verdict::Past { a } => assert!((a + 0.1).abs() < 1e-12, "0,1 m past, got {a}"),
            other => panic!("a stop 0,1 m past is Past, got {other:?}"),
        }
        assert!((line.a_m(5.75) - 0.25).abs() < 1e-12);
    }
}
