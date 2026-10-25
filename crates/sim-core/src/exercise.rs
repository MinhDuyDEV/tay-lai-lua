//! Bài 1 — Xuất phát and bài 3 — Dừng và khởi hành xe trên dốc, as small state machines over one
//! car. `Exercise` picks which one a session runs; the shared parts (the car, `charge`, stall and
//! rpm) are the same code. Bài 3 is described at the bottom of this file.
//!
//! Bài 1 phase order, from TT 108/2026/TT-BCA Phụ lục III bài 1:
//!   wait — parked before the line, engine cold — plus the learner's own starter, until the
//!   order (đèn xanh); order -> depart with the left signal on -> signal off 5 m past the line
//!   -> end.
//!
//! The order is a `TickInput` flag the learner presses, so the car is live before it: the engine
//! can be cranked and the clutch dropped. That stretch is unscored and no clock runs, because the
//! law puts every timer and the belt check after "chờ hiệu lệnh"; `tick` starts at 0 there. An
//! order given once the front bumper is past the line is ignored and the run stays unscored.
//!
//! No threshold is a literal here: every one is read from `Ruleset`, which carries the sentence it
//! came from. The readings the law does not fix are named where they are applied and listed under
//! `assumptions` in `content/rulesets/tt108-2026.json`.
//!
//! The three signal rules are charged for three different acts, so one mistake is never charged
//! twice:
//! * `SH.01.KHONG_XI_NHAN_TRAI` — the left signal is off on the tick the car first moves.
//! * `SH.01.XI_NHAN_KHONG_KIP` — the left signal comes on only after the car has moved, or goes
//!   off before `course.signal_off_early_m`.
//! * `SH.01.KHONG_TAT_XI_NHAN` — the left signal is still on at `course.signal_off_late_m`.
//!
//! The belt is read on the first frame after the order, because the law puts fastening the belt
//! before waiting for the order.

use crate::rules::{Penalty, Repeat, Ruleset, Thresholds};
use crate::vehicle::{Car, Controls, StepOutcome};

/// Fixed step. `step` never receives a `dt`.
pub const DT: f64 = 1.0 / 60.0;

/// Which exercise a session runs. Picked once, from the seed (see `sim_create` in `abi.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Exercise {
    /// Bài 1 — Xuất phát.
    Start,
    /// Bài 3 — Dừng và khởi hành xe trên dốc.
    Hill,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    /// Before the start order: the car is live, but nothing is scored and no clock runs.
    Waiting,
    /// The order has been given; the car has not crossed the start line yet.
    Launched,
    /// The car crossed the start line and must shed the left signal within the window.
    PastLine,
    /// Bài 3: the car has stopped inside the exercise zone and must now start off again.
    Stopped,
    /// Past the end mark, or disqualified. Nothing more is scored.
    Done,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Signal {
    Off,
    Left,
    Right,
}

/// One fired rule, flattened so it can outlive the borrow of the ruleset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FiredRule {
    pub tick: u32,
    pub code: u16,
    pub points: i16,
}

/// Bài 3: where and when the car stopped. The first stop in the exercise zone is the only one.
#[derive(Clone, Copy, Debug)]
pub struct Stop {
    pub tick: u32,
    /// Front-bumper centre at the stop, on the course axis.
    pub front_bumper_m: f64,
}

pub struct State {
    pub exercise: Exercise,
    /// Steps since the start order. 0 while the run waits for it — the clocks count from the
    /// order, not from `create`.
    pub tick: u32,
    pub phase: Phase,
    pub score: i32,
    pub disqualified: bool,
    pub car: Car,
    /// Controls of the tick just stepped.
    pub controls: Controls,
    pub signal: Signal,
    /// Tick at which the front bumper passed the start line.
    pub crossed_at: Option<u32>,
    /// Metres past the line where the left signal was switched off, if it ever was.
    pub signal_off_at_m: Option<f64>,
    /// Bài 3 only. `None` until the car stops.
    pub stop: Option<Stop>,
    moved: bool,
    /// Bit per ruleset row index: charged, and (for `EACH`) not yet re-armed.
    latched: u32,
}

impl State {
    pub fn new(rs: &Ruleset, exercise: Exercise) -> Self {
        let c = &rs.course;
        let mut car = Car::new();
        let phase = match exercise {
            Exercise::Start => {
                // `start_front_bumper_m` is the bumper's signed position relative to the line
                // (-1.0 is one metre short of it); the car's reference point is its centre.
                car.x_m = c.start_line_x_m + c.start_front_bumper_m - 0.5 * rs.vehicle.length_m;
                Phase::Waiting
            }
            Exercise::Hill => {
                // Bài 3 gives no start order: the engine already idles and scoring is live.
                let h = &rs.hill;
                car.x_m = h.foot_x_m + h.start_front_bumper_from_foot_m - 0.5 * rs.vehicle.length_m;
                car.engine_on = true;
                car.rpm = rs.drivetrain.idle_target_rpm;
                Phase::Launched
            }
        };

        Self {
            exercise,
            tick: 0,
            phase,
            score: rs.scoring.base,
            disqualified: false,
            car,
            controls: Controls::default(),
            signal: Signal::Off,
            crossed_at: None,
            signal_off_at_m: None,
            stop: None,
            moved: false,
            latched: 0,
        }
    }

    /// Whether the car has moved under its own power yet.
    pub fn has_moved(&self) -> bool {
        self.moved
    }

    /// Rules charged and not yet re-armed. Future behaviour depends on these, so the hash covers
    /// them too.
    pub fn latched(&self) -> u32 {
        self.latched
    }

    pub fn front_bumper_x(&self, rs: &Ruleset) -> f64 {
        self.car.front_bumper_x(&rs.vehicle)
    }

    pub fn step(
        &mut self,
        rs: &Ruleset,
        t: &Thresholds,
        controls: Controls,
        signal: Signal,
        order: bool,
        fired: &mut Vec<FiredRule>,
    ) {
        if self.phase == Phase::Done {
            return;
        }
        match self.exercise {
            Exercise::Start => self.step_start(rs, t, controls, signal, order, fired),
            Exercise::Hill => self.step_hill(rs, t, controls, signal, fired),
        }
    }

    /// The car for one tick, on whatever the road does under it.
    fn drive_car(&mut self, rs: &Ruleset, controls: &Controls) -> StepOutcome {
        let sin_slope = match self.exercise {
            Exercise::Start => 0.0,
            Exercise::Hill => rs.hill.sin_slope_at(self.car.x_m),
        };
        self.car.step(&rs.vehicle, &rs.drivetrain, controls, sin_slope, DT)
    }

    /// Stall and over-revving, charged the same way in every exercise.
    fn check_engine(&mut self, rs: &Ruleset, t: &Thresholds, outcome: StepOutcome, fired: &mut Vec<FiredRule>) {
        if outcome.stalled {
            self.charge(rs, "SH.X.CHET_MAY", fired);
        } else if self.car.engine_on {
            self.rearm(rs, "SH.X.CHET_MAY");
        }
        if self.car.rpm > t.rpm_limit {
            self.charge(rs, "SH.X.RPM", fired);
        } else {
            self.rearm(rs, "SH.X.RPM");
        }
    }

    fn step_start(
        &mut self,
        rs: &Ruleset,
        t: &Thresholds,
        controls: Controls,
        signal: Signal,
        order: bool,
        fired: &mut Vec<FiredRule>,
    ) {
        if self.phase == Phase::Waiting {
            // The order only counts while the car is still short of the line: "dừng xe trước vạch
            // xuất phát, chờ hiệu lệnh". Past it, the run is unscored and stays here.
            if !order || self.front_bumper_x(rs) >= rs.course.start_line_x_m {
                // The car is live before the đèn xanh — the learner cranks it and can drop the
                // clutch — but nothing is scored and no clock runs. A run that moves here is
                // unscored, not a penalty; see `before_order` in the ruleset assumptions.
                self.controls = controls;
                self.signal = signal;
                self.drive_car(rs, &controls);
                return;
            }
            // The tick carrying the order is the first tick of the run, counted as 1, so both
            // clocks start on it.
            self.phase = Phase::Launched;
        }

        let previous_signal = self.signal;
        self.tick += 1;
        self.controls = controls;
        self.signal = signal;

        if !controls.has_belt {
            self.charge(rs, "SH.01.DAY_AN_TOAN", fired);
        }

        let outcome = self.drive_car(rs, &controls);
        self.check_engine(rs, t, outcome, fired);

        let bumper = self.front_bumper_x(rs);
        self.check_departure(rs, previous_signal, fired);
        self.check_line(rs, t, bumper, fired);
        self.check_signal_window(rs, previous_signal, bumper, fired);

        if !self.disqualified && bumper >= rs.course.exercise_end_m {
            self.phase = Phase::Done;
        }
    }

    /// First movement under the car's own power: was the left signal already on?
    fn check_departure(&mut self, rs: &Ruleset, previous: Signal, fired: &mut Vec<FiredRule>) {
        if !self.moved && self.car.speed_mps > 0.1 {
            self.moved = true;
            if self.signal != Signal::Left {
                self.charge(rs, "SH.01.KHONG_XI_NHAN_TRAI", fired);
            }
        }
        // Bringing the signal on only after the car has moved is the late half of "kịp thời".
        if self.moved
            && previous != Signal::Left
            && self.signal == Signal::Left
            && self.crossed_at.is_some()
        {
            self.charge(rs, "SH.01.XI_NHAN_KHONG_KIP", fired);
        }
    }

    fn check_line(&mut self, rs: &Ruleset, t: &Thresholds, bumper: f64, fired: &mut Vec<FiredRule>) {
        if self.crossed_at.is_some() {
            return;
        }
        if bumper >= rs.course.start_line_x_m {
            self.crossed_at = Some(self.tick);
            self.phase = Phase::PastLine;
            return;
        }
        // Still short of the line: both departure deadlines run, counted from the start order.
        // The later one outranks the earlier one — 30 s is a disqualification, so it is the only
        // charge that matters.
        if self.tick > t.timeout_30_ticks {
            self.charge(rs, "SH.01.QUA_30S", fired);
        } else if self.tick > t.timeout_20_ticks {
            self.charge(rs, "SH.01.QUA_20S", fired);
        }
    }

    /// Switching the left signal off is judged where it happens; leaving it on is judged at the
    /// late edge of the window.
    fn check_signal_window(
        &mut self,
        rs: &Ruleset,
        previous: Signal,
        bumper: f64,
        fired: &mut Vec<FiredRule>,
    ) {
        let c = &rs.course;
        if previous == Signal::Left && self.signal != Signal::Left {
            self.signal_off_at_m = Some(bumper);
            // A signal never switched on is not an untimely switch-off: that act is already
            // charged as SH.01.KHONG_XI_NHAN_TRAI when the car first moves.
            if self.moved && bumper < c.signal_off_early_m {
                self.charge(rs, "SH.01.XI_NHAN_KHONG_KIP", fired);
            } else if bumper >= c.signal_off_late_m {
                self.charge(rs, "SH.01.KHONG_TAT_XI_NHAN", fired);
            }
        }
        if self.signal == Signal::Left && bumper >= c.signal_off_late_m {
            self.charge(rs, "SH.01.KHONG_TAT_XI_NHAN", fired);
        }
    }

    /// Apply one rule. Returns whether it was charged on this tick.
    fn charge(&mut self, rs: &Ruleset, id: &str, fired: &mut Vec<FiredRule>) -> bool {
        let Some(index) = rs.index_of(id) else {
            return false;
        };
        let bit = 1u32 << index;
        if self.latched & bit != 0 {
            return false;
        }

        let rule = &rs.rules[index];
        // `Repeat::Once` stays latched for the rest of the run; `EACH` re-arms through `rearm`.
        self.latched |= bit;
        let points = match rule.penalty {
            Penalty::Points { points } => {
                self.score -= i32::from(points);
                points
            }
            Penalty::Disqualify => {
                self.disqualified = true;
                self.phase = Phase::Done;
                0
            }
        };
        fired.push(FiredRule { tick: self.tick, code: rule.code, points });
        true
    }

    fn rearm(&mut self, rs: &Ruleset, id: &str) {
        if rs.rule(id).repeat != Repeat::Each {
            return;
        }
        if let Some(index) = rs.index_of(id) {
            self.latched &= !(1u32 << index);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Bài 3 — Dừng và khởi hành xe trên dốc.
//
// The car waits on the flat before the foot of a 10 % slope, engine idling, neutral, handbrake on.
// It drives up, stops with the front bumper short of the stop line (distance A), starts off again
// on the slope and passes the line. Everything is scored from tick 1; only the 30 s clock and the
// rollback measure begin at the stop. Every number is `rs.hill`; every reading the law leaves open
// is under `assumptions` in the ruleset. Phase: `Launched` is "underway toward the stop line",
// `Stopped` is "stopped, now start off", `Done` is past the line or disqualified.
// ---------------------------------------------------------------------------------------------

impl State {
    fn step_hill(
        &mut self,
        rs: &Ruleset,
        t: &Thresholds,
        controls: Controls,
        signal: Signal,
        fired: &mut Vec<FiredRule>,
    ) {
        self.tick += 1;
        self.controls = controls;
        self.signal = signal;

        let outcome = self.drive_car(rs, &controls);
        self.check_engine(rs, t, outcome, fired);

        if !self.moved && self.car.speed_mps > 0.1 {
            self.moved = true;
        }
        let bumper = self.front_bumper_x(rs);
        match self.stop {
            None => self.check_stop(rs, bumper, fired),
            Some(stop) => self.check_start_off(rs, t, stop, bumper, fired),
        }
    }

    /// "Dừng xe" is the first tick, after the car has moved forward, on which forward speed is
    /// not positive. It counts only once the bumper is past the foot of the slope; a stall or a
    /// hesitation on the approach is not a stop and costs nothing here.
    fn check_stop(&mut self, rs: &Ruleset, bumper: f64, fired: &mut Vec<FiredRule>) {
        let h = &rs.hill;
        let a = h.stop_line_x_m() - bumper;
        if self.moved && self.car.speed_mps <= 0.0 && bumper >= h.foot_x_m {
            self.stop = Some(Stop { tick: self.tick, front_bumper_m: bumper });
            self.phase = Phase::Stopped;
            if a < 0.0 {
                self.charge(rs, "SH.03.QUA_VACH", fired);
            } else if a > h.max_a_m {
                self.charge(rs, "SH.03.CHUA_DEN_VACH", fired);
            }
        } else if -a >= h.no_stop_beyond_m {
            self.charge(rs, "SH.03.KHONG_DUNG", fired);
        }
    }

    /// After the stop: no more than `max_rollback_m` back from where it stopped, and over the line
    /// within the time. Passing the line ends the run with the score so far.
    fn check_start_off(&mut self, rs: &Ruleset, t: &Thresholds, stop: Stop, bumper: f64, fired: &mut Vec<FiredRule>) {
        let h = &rs.hill;
        if stop.front_bumper_m - bumper > h.max_rollback_m {
            self.charge(rs, "SH.03.TUT_DOC", fired);
        }
        if self.disqualified {
            return;
        }
        if bumper > h.stop_line_x_m() {
            self.phase = Phase::Done;
        } else if self.tick - stop.tick > t.hill_timeout_ticks {
            self.charge(rs, "SH.03.QUA_30S", fired);
        }
    }
}
