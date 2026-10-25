//! Bài 1 — Xuất phát, bài 3 — Dừng và khởi hành xe trên dốc, bài 4 — Qua vệt bánh xe và đường vòng
//! vuông góc and bài 6 — Qua đường vòng quanh co, as small state machines over one car. `Exercise`
//! picks which one a session runs; the shared parts (the car, `charge`, stall and rpm) are the same
//! code. Bài 3 is described at the bottom of this file, bài 4 and bài 6 after it.
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

use crate::course::{Course, Figure};
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
    /// Bài 4 — Qua vệt bánh xe và đường vòng vuông góc.
    Vet,
    /// Bài 6 — Qua đường vòng quanh co.
    Curve,
}

impl Exercise {
    /// The two exercises that are scored against a generated figure.
    pub fn is_sa_hinh(self) -> bool {
        matches!(self, Exercise::Vet | Exercise::Curve)
    }
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

/// One line's contact episode (bài 4 and bài 6): a maximal interval in which some wheel touches
/// that line. `elapsed_s` counts while it lasts; `next_keo_dai_s` is the next 5-second mark that
/// DE_VACH_KEO_DAI charges at.
#[derive(Clone, Copy, Debug, Default)]
pub struct Episode {
    pub touching: bool,
    pub elapsed_s: f64,
    pub next_keo_dai_s: f64,
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
    /// Bài 4 and bài 6: the figure this run is on, generated once from the ruleset.
    pub course: Option<Course>,
    /// Bài 4 and bài 6: one contact episode per painted line, indexed like `course.lines`.
    episodes: Vec<Episode>,
    /// Bài 4 and bài 6: metres along the centreline of the furthest point reached, for the
    /// reversing half of SAI_HINH.
    furthest_m: f64,
    /// Bài 4 and bài 6: whether the clock has started, and how long it has run.
    clock_s: f64,
    clock_running: bool,
    /// How many QUA_THOI_GIAN charges the clock has produced, so one charge per period.
    clock_charges: u32,
    /// Bài 4: which of the two right wheels has been inside the vệt strip. Bit 0 = front right,
    /// bit 1 = rear right; both set is "the car's right side has been through the vệt".
    vet_reached: u8,
    moved: bool,
    /// Bit per ruleset row index: charged, and (for `EACH`) not yet re-armed.
    latched: u32,
}

impl State {
    pub fn new(rs: &Ruleset, exercise: Exercise) -> Self {
        let c = &rs.course;
        let mut car = Car::new();
        let mut course = None;
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
            Exercise::Vet | Exercise::Curve => {
                // Bài 4 and bài 6 give no start order either: the engine idles, the handbrake is
                // on, and scoring is live from tick 1, as in bài 3.
                let figure = if exercise == Exercise::Vet { Figure::Vet } else { Figure::Curve };
                let built = Course::new(figure, rs).expect("the ruleset gives a drawable figure");
                car.x_m = built.start_x_m;
                car.y_m = built.start_y_m;
                car.heading_rad = built.start_heading_rad;
                car.engine_on = true;
                car.rpm = rs.drivetrain.idle_target_rpm;
                course = Some(built);
                Phase::Launched
            }
        };
        let episodes = match &course {
            Some(course) => vec![Episode::default(); course.lines.len()],
            None => Vec::new(),
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
            course,
            episodes,
            furthest_m: 0.0,
            clock_s: 0.0,
            clock_running: false,
            clock_charges: 0,
            vet_reached: 0,
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
            Exercise::Vet | Exercise::Curve => self.step_sa_hinh(rs, t, controls, signal, fired),
        }
    }

    /// The car for one tick, on whatever the road does under it.
    fn drive_car(&mut self, rs: &Ruleset, controls: &Controls) -> StepOutcome {
        let sin_slope = if self.exercise == Exercise::Hill { rs.hill.sin_slope_at(self.car.x_m) } else { 0.0 };
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

    /// Apply one rule, once per run: the latch bit is what makes `Repeat::Once` fire a single time.
    /// `Repeat::Each` rules that re-arm through `rearm` (stall, rpm) go through here too.
    ///
    /// A rule whose repeats are counted by the caller instead — the per-line contact episodes and
    /// the exercise clock — must use `charge_counted`: its own counter already decided that this is
    /// another occurrence, and the latch would silently swallow every charge after the first.
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

    /// Apply one rule that the caller has already decided is a fresh occurrence: no latch, so it
    /// fires every time it is called. Used by the per-line `DE_VACH` episodes, their five-second
    /// `DE_VACH_KEO_DAI` marks, and the `QUA_THOI_GIAN` clock.
    fn charge_counted(&mut self, rs: &Ruleset, id: &str, fired: &mut Vec<FiredRule>) -> bool {
        let Some(index) = rs.index_of(id) else {
            return false;
        };
        let rule = &rs.rules[index];
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

// ---------------------------------------------------------------------------------------------
// Bài 4 — Qua vệt bánh xe và đường vòng vuông góc, and bài 6 — Qua đường vòng quanh co.
//
// Both run on a generated figure (`course.rs`) and share one scoring loop; only what the exercise
// demands differs. Engine idling, neutral, handbrake on, scored from tick 1, no start order — the
// same opening state as bài 3.
//
// What is charged, and why it is charged once:
// * `DE_VACH` — one charge per *episode per line*: a maximal stretch in which some wheel of the
//   car touches that line. A learner sees touching a line as one mistake however many wheels slide
//   along it, and sees two lines as two mistakes. A long episode is charged again by
//   `DE_VACH_KEO_DAI` every five seconds, so the same scrape is never charged twice for the same
//   act.
// * `DE_VACH_KEO_DAI` — the same episode, at 5 s, 10 s, 15 s…, per line, so two lines held at once
//   run two timers.
// * `SAI_HINH` (đình chỉ) — the car centre leaves the corridor, or the car reverses more than
//   `reverse_limit_m` behind the furthest point it reached.
// * `TRUOT_VET` (bài 4, đình chỉ) — the right wheels leave the vệt strip, or are not both in it by
//   the time the car has gone `vet_entry_tolerance_m` past the strip's start.
// * `QUA_THOI_GIAN` — the clock runs from the step the front bumper crosses the entry gate to the
//   step the rear bumper crosses the exit gate, which also ends the run.
// * `VIA_HE` (đình chỉ) — a wheel's patch reaches the curb band.
// ---------------------------------------------------------------------------------------------

impl State {
    fn step_sa_hinh(
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
        if self.disqualified {
            return;
        }
        if !self.moved && self.car.speed_mps > 0.1 {
            self.moved = true;
        }

        let Some(course) = self.course.take() else { return };
        self.score_on_course(rs, t, &course, fired);
        // A charge may have ended the run; keep the figure either way, it is read-only.
        self.course = Some(course);
    }

    fn score_on_course(
        &mut self,
        rs: &Ruleset,
        t: &Thresholds,
        course: &Course,
        fired: &mut Vec<FiredRule>,
    ) {
        let carpet = course.project(self.car.x_m, self.car.y_m);
        self.clock_tick(rs, t, course, carpet.progress_m, fired);
        if self.phase == Phase::Done {
            return;
        }

        // SAI_HINH: off the figure, or too far back behind the best progress so far.
        let corridor = course.half_lane_m + rs.sa_hinh.outside_margin_m;
        if carpet.lateral_m.abs() > corridor {
            self.charge(rs, sa_hinh_id(self.exercise, "SAI_HINH"), fired);
            return;
        }
        if self.furthest_m - carpet.progress_m > rs.sa_hinh.reverse_limit_m {
            self.charge(rs, sa_hinh_id(self.exercise, "SAI_HINH"), fired);
            return;
        }
        if carpet.progress_m > self.furthest_m {
            self.furthest_m = carpet.progress_m;
        }

        self.contact_tick(rs, t, course, fired);
        if self.disqualified {
            return;
        }
        if self.exercise == Exercise::Vet {
            self.vet_tick(rs, course, fired);
        }
    }

    /// The clock: the front bumper crossing the entry gate starts it, the rear bumper crossing the
    /// exit gate stops it and ends the run.
    fn clock_tick(
        &mut self,
        rs: &Ruleset,
        t: &Thresholds,
        course: &Course,
        progress_m: f64,
        fired: &mut Vec<FiredRule>,
    ) {
        if self.phase == Phase::Done {
            return;
        }
        let v = &rs.vehicle;
        let ahead = 0.5 * v.length_m;
        let behind = 0.5 * v.length_m;
        if !self.clock_running {
            // The gate is crossed when the bumper passes the gate's progress point. Progress is
            // measured at the car centre, so the bumper is `ahead` further along.
            if progress_m + ahead >= course.entry_m {
                if self.phase == Phase::Launched {
                    self.phase = Phase::PastLine;
                }
                self.clock_running = true;
            }
            return;
        }
        self.clock_s += DT;
        if progress_m - behind >= course.exit_m {
            self.phase = Phase::Done;
            return;
        }
        let over = (self.clock_s / rs.sa_hinh.time_limit_s) as u32;
        let charged = (self.clock_charges) as u32;
        if over > charged {
            self.clock_charges += 1;
            self.charge_counted(rs, sa_hinh_id(self.exercise, "QUA_THOI_GIAN"), fired);
        }
        let _ = t;
    }

    /// Contact bookkeeping: the curb is a đình chỉ, and every touched line runs its own episode.
    fn contact_tick(&mut self, rs: &Ruleset, t: &Thresholds, course: &Course, fired: &mut Vec<FiredRule>) {
        let wheels = course.wheel_centres(rs, self.car.x_m, self.car.y_m, self.car.heading_rad);
        let mut touching = vec![false; course.lines.len()];
        for w in wheels {
            let c = course.contact(rs, w, self.car.heading_rad);
            if c.curb {
                self.charge(rs, "SH.X.VIA_HE", fired);
            }
            for (i, slot) in touching.iter_mut().enumerate() {
                if c.mask & (1u64 << i) != 0 {
                    *slot = true;
                }
            }
        }
        let keo_dai_every_s = t.de_vach_keo_dai_ticks as f64 * DT;
        let de_vach = sa_hinh_id(self.exercise, "DE_VACH");
        let keo_dai = sa_hinh_id(self.exercise, "DE_VACH_KEO_DAI");
        let mut episodes = core::mem::take(&mut self.episodes);
        for (i, ep) in episodes.iter_mut().enumerate() {
            if touching[i] {
                if !ep.touching {
                    // A new episode on this line.
                    ep.touching = true;
                    ep.elapsed_s = 0.0;
                    ep.next_keo_dai_s = keo_dai_every_s;
                    self.charge_counted(rs, de_vach, fired);
                }
                ep.elapsed_s += DT;
                if ep.elapsed_s >= ep.next_keo_dai_s {
                    ep.next_keo_dai_s += keo_dai_every_s;
                    self.charge_counted(rs, keo_dai, fired);
                }
            } else if ep.touching {
                ep.touching = false;
                ep.elapsed_s = 0.0;
                ep.next_keo_dai_s = 0.0;
            }
        }
        self.episodes = episodes;
    }

    /// Bài 4's own error: the right wheels must go *through* the vệt strip.
    ///
    /// Judged per right wheel, because a wheel is what the law names: each of the two right wheels
    /// must be inside the strip at some point, may not leave it sideways once inside, and must be
    /// inside it before it has gone `vet_entry_tolerance_m` past the strip's start. A wheel that is
    /// still outside the strip when it leaves the strip's length never went through it.
    fn vet_tick(&mut self, rs: &Ruleset, course: &Course, fired: &mut Vec<FiredRule>) {
        let Some(vet) = course.vet else { return };
        let wheels = course.wheel_centres(rs, self.car.x_m, self.car.y_m, self.car.heading_rad);
        let tolerance = rs.sa_hinh.vet_entry_tolerance_m;
        // The two right wheels: front right and rear right.
        for (bit, index) in [0u8, 1u8].into_iter().zip([1usize, 3]) {
            let w = wheels[index];
            let inside = w.0 >= vet.x0
                && w.0 <= vet.x1
                && (w.1 - vet.y_m).abs() <= vet.half_play_m;
            let in_strip_length = w.0 >= vet.x0 && w.0 <= vet.x1;
            let been = self.vet_reached & (1 << bit) != 0;
            if inside {
                self.vet_reached |= 1 << bit;
            } else if been && in_strip_length {
                // It was inside and is now sideways out of it: the wheel slipped off the vệt.
                self.charge(rs, "SH.04.TRUOT_VET", fired);
            } else if !been && w.0 > vet.x0 + tolerance && w.0 < vet.x1 {
                // Entered late and never got in: it is passing the strip outside the zone.
                self.charge(rs, "SH.04.TRUOT_VET", fired);
            } else if !been && w.0 >= vet.x1 {
                // Its length through the strip is over without ever being inside.
                self.charge(rs, "SH.04.TRUOT_VET", fired);
            }
        }
    }
}

/// The ruleset id of a sa hình rule for whichever of bài 4 or bài 6 is running.
fn sa_hinh_id(exercise: Exercise, name: &str) -> &'static str {
    match (exercise, name) {
        (Exercise::Curve, "SAI_HINH") => "SH.06.SAI_HINH",
        (Exercise::Curve, "DE_VACH") => "SH.06.DE_VACH",
        (Exercise::Curve, "DE_VACH_KEO_DAI") => "SH.06.DE_VACH_KEO_DAI",
        (Exercise::Curve, "QUA_THOI_GIAN") => "SH.06.QUA_THOI_GIAN",
        (_, "SAI_HINH") => "SH.04.SAI_HINH",
        (_, "DE_VACH") => "SH.04.DE_VACH",
        (_, "DE_VACH_KEO_DAI") => "SH.04.DE_VACH_KEO_DAI",
        (_, "QUA_THOI_GIAN") => "SH.04.QUA_THOI_GIAN",
        (_, _) => "SH.04.SAI_HINH",
    }
}

// ---------------------------------------------------------------------------------------------
// What the web layer reads of a figure run, and what the hash covers.
// ---------------------------------------------------------------------------------------------

impl State {
    /// Snapshot fields 27..46: contact, progress, clock and the wheel centres. Zero when the
    /// exercise has no figure, so the fields mean one thing only.
    pub fn sa_hinh_snapshot(&self, rs: &Ruleset, out: &mut crate::Snapshot) {
        let Some(course) = &self.course else { return };
        let wheels = course.wheel_centres(rs, self.car.x_m, self.car.y_m, self.car.heading_rad);
        for (i, w) in wheels.iter().enumerate() {
            out[27 + i] = f64::from(course.contact(rs, *w, self.car.heading_rad).code());
        }
        let p = course.project(self.car.x_m, self.car.y_m);
        out[31] = p.progress_m;
        out[32] = course.length_m;
        out[33] = p.lateral_m;
        out[34] = wrap_to_pi(self.car.heading_rad - p.heading_rad);
        out[35] = p.part as f64;
        out[36] = self.clock_s;
        out[37] = self.episodes.iter().fold(0.0f64, |m, e| if e.touching { m.max(e.elapsed_s) } else { m });
        for (i, w) in wheels.iter().enumerate() {
            out[38 + 2 * i] = w.0;
            out[39 + 2 * i] = w.1;
        }
    }

    /// Place the car at an exact pose. Only for the scenario tests: the episode-counting rule is
    /// about what the scoring code does with a given set of contacts, and a pose that a driver can
    /// only reach on a knife-edge would make the test about the driver, not the rule.
    pub fn place_car(&mut self, x: f64, y: f64, heading: f64) {
        self.car.x_m = x;
        self.car.y_m = y;
        self.car.heading_rad = heading;
        self.car.speed_mps = 0.0;
    }

    pub fn episode_table(&self) -> &[Episode] {
        &self.episodes
    }

    /// Progress, signed lateral offset and heading error on the figure; zeros without one.
    pub fn progress_m(&self) -> (f64, f64, f64) {
        match &self.course {
            Some(course) => {
                let p = course.project(self.car.x_m, self.car.y_m);
                (p.progress_m, p.lateral_m, wrap_to_pi(self.car.heading_rad - p.heading_rad))
            }
            None => (0.0, 0.0, 0.0),
        }
    }

    /// The longest contact episode running right now, seconds.
    pub fn longest_episode_s(&self) -> f64 {
        self.episodes.iter().fold(0.0f64, |m, e| if e.touching { m.max(e.elapsed_s) } else { m })
    }

    pub fn furthest_progress_m(&self) -> f64 {
        self.furthest_m
    }

    pub fn clock_seconds(&self) -> f64 {
        self.clock_s
    }

    pub fn clock_running(&self) -> bool {
        self.clock_running
    }

    pub fn clock_charges(&self) -> u32 {
        self.clock_charges
    }

    pub fn vet_reached(&self) -> bool {
        self.vet_reached == 0b11
    }

    /// The two right wheels' `vet` bits, as the hash records them.
    pub fn vet_wheels(&self) -> u8 {
        self.vet_reached
    }
}

fn wrap_to_pi(a: f64) -> f64 {
    let pi = core::f64::consts::PI;
    let mut x = a;
    while x > pi {
        x -= 2.0 * pi;
    }
    while x < -pi {
        x += 2.0 * pi;
    }
    x
}
