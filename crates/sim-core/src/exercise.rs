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
use crate::stop::{StopAt, StopLine, Verdict};
use crate::vehicle::{Car, Controls, StepOutcome};

/// Fixed step. `step` never receives a `dt`.
pub const DT: f64 = 1.0 / 60.0;

/// Which exercise a session runs. Picked once, from the seed (see `sim_create` in `abi.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Exercise {
    /// Bài 1 — Xuất phát.
    Start,
    /// Bài 2 — Dừng xe nhường đường cho người đi bộ.
    Crosswalk,
    /// Bài 3 — Dừng và khởi hành xe trên dốc.
    Hill,
    /// Bài 4 — Qua vệt bánh xe và đường vòng vuông góc.
    Vet,
    /// Bài 5 — Qua ngã tư có tín hiệu điều khiển giao thông.
    Junction,
    /// Bài 6 — Qua đường vòng quanh co.
    Curve,
    /// Bài 9 — Tạm dừng ở chỗ có đường sắt chạy qua.
    Rail,
    /// Bài 11 — Kết thúc.
    Finish,
}

impl Exercise {
    /// The two exercises that are scored against a generated figure.
    pub fn is_sa_hinh(self) -> bool {
        matches!(self, Exercise::Vet | Exercise::Curve)
    }

    /// The exercises that run on the straight road scene of `course::road`.
    pub fn is_road(self) -> bool {
        matches!(self, Exercise::Crosswalk | Exercise::Junction | Exercise::Rail | Exercise::Finish)
    }

    /// `
    fn id(self, name: &str) -> &'static str {
        match (self, name) {
            (Exercise::Crosswalk, "KHONG_DUNG") => "SH.02.KHONG_DUNG",
            (Exercise::Crosswalk, "CHUA_DEN_VACH") => "SH.02.CHUA_DEN_VACH",
            (Exercise::Crosswalk, "QUA_VACH") => "SH.02.QUA_VACH",
            (Exercise::Rail, "KHONG_DUNG") => "SH.DS.KHONG_DUNG",
            (Exercise::Rail, "CHUA_DEN_VACH") => "SH.DS.CHUA_DEN_VACH",
            (Exercise::Rail, "QUA_VACH") => "SH.DS.QUA_VACH",
            (Exercise::Junction, "KHONG_DUNG") => "SH.05.KHONG_DUNG",
            (Exercise::Junction, "CHUA_DEN_VACH") => "SH.05.CHUA_DEN_VACH",
            (Exercise::Junction, "QUA_VACH") => "SH.05.QUA_VACH",
            (Exercise::Junction, "KHONG_XI_NHAN") => "SH.05.KHONG_XI_NHAN",
            (Exercise::Junction, "VUOT_DEN_DO") => "SH.05.VUOT_DEN_DO",
            (Exercise::Junction, "QUA_20S") => "SH.05.QUA_20S",
            (Exercise::Junction, "QUA_30S") => "SH.05.QUA_30S",
            (Exercise::Junction, "SAI_VACH_KE") => "SH.05.SAI_VACH_KE",
            (Exercise::Finish, "KHONG_QUA_VACH") => "SH.KT.KHONG_QUA_VACH",
            (Exercise::Finish, "KHONG_XI_NHAN_PHAI") => "SH.KT.KHONG_XI_NHAN_PHAI",
            _ => "",
        }
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

/// The stop a run recorded, for every exercise that has a stop line. The first stop the detector
/// accepts is the only one: a learner who rolls forward and stops again has already been judged.
#[derive(Clone, Copy, Debug)]
pub struct Stop {
    pub tick: u32,
    /// Front-bumper centre at the stop, on the approach axis.
    pub front_bumper_m: f64,
    /// The detector's verdict and distance A at that stop.
    pub at: StopAt,
}

/// The light of bài 5, as the snapshot and the hash read it. `None` until the car first moves: the
/// cycle is not running while the learner is still at the line with the handbrake on.
#[derive(Clone, Copy, Debug)]
pub struct Light {
    /// Ticks since the first movement, plus the seed's offset: where in the cycle we are.
    pub clock: u32,
    /// 1 red, 2 yellow, 3 green on this tick.
    pub colour: u8,
    /// Ticks left in the current colour, counting this one.
    pub left: u32,
    /// The light clock's arming tick: the later of the arrival in the zone and the first green at or
    /// after it. The 20 s / 30 s clock counts from here.
    pub armed_at: Option<u32>,
    /// The car has been in the stop zone since `armed_at`.
    pub arrived: bool,
    /// The bumper's position on the tick the current colour began: what decides whether a yellow
    /// found the car short of the line (stop) or at/past it (through).
    pub bumper_at_colour_start: f64,
    /// Where the stop line is on the approach axis, so the light can answer that question without
    /// borrowing the ruleset every tick.
    pub stop_line_m: f64,
}

impl Light {
    fn dark() -> Self {
        Self {
            clock: 0,
            colour: 0,
            left: 0,
            armed_at: None,
            arrived: false,
            bumper_at_colour_start: 0.0,
            stop_line_m: 0.0,
        }
    }
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
    /// Bài 5: the light cycle and the 20 s / 30 s clock that hangs off it. Dark in every other
    /// exercise.
    pub light: Light,
    /// Bài 5: where the route's right-turn arc starts, on the approach axis — the tick the bumper
    /// reaches it is where the turn signal is judged. `None` in every other exercise.
    pub arc_start_m: Option<f64>,
    /// Bài 11: whether the right signal was on the tick the bumper crossed the finish line.
    pub finish_signal: Option<Signal>,
    /// Bài 11: the car has stopped after crossing the finish line; the run is over.
    pub finished: bool,
    /// Bài 2 and bài 9: KHONG_DUNG has been charged, so the run has its verdict and can end.
    pub no_stop_charged: bool,
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
    /// Bit per ruleset row index: charged, and (for `EACH`) not yet re-armed. 64 bits because the
    /// ruleset has 38 rows now; the hash writes the low 32 for the exercises that existed before
    /// the road exercises, so their golden hashes do not move.
    latched: u64,
}

impl State {
    /// `seed` is read for bài 5's light phase only; every other exercise ignores it.
    pub fn new(rs: &Ruleset, exercise: Exercise, seed: u64) -> Self {
        let c = &rs.course;
        let mut car = Car::new();
        let mut course = None;
        let mut arc_start_m = None;
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
            Exercise::Crosswalk | Exercise::Rail | Exercise::Finish => {
                // The straight road scene: engine idling, neutral, handbrake on, scored from tick
                // 1 — the same opening state as bài 3. It has a figure too (the lane, the stop
                // line, the crosswalk or the rails or the finish line), so the page draws the
                // same numbers the scoring reads.
                let figure = match exercise {
                    Exercise::Crosswalk => Figure::Crosswalk,
                    Exercise::Rail => Figure::Rail,
                    _ => Figure::Finish,
                };
                let built = Course::new(figure, rs).expect("the ruleset gives a drawable scene");
                car.x_m = rs.road.start_front_bumper_m - 0.5 * rs.vehicle.length_m;
                car.y_m = built.start_y_m;
                car.heading_rad = built.start_heading_rad;
                car.engine_on = true;
                car.rpm = rs.drivetrain.idle_target_rpm;
                course = Some(built);
                Phase::Launched
            }
            Exercise::Junction => {
                // Bài 5 turns right out of the approach lane, so it runs on a figure too: the
                // route's own lines are what SAI_VACH_KE is judged on.
                let built = Course::new(Figure::Junction, rs).expect("the ruleset gives a drawable figure");
                car.x_m = built.start_x_m;
                car.y_m = built.start_y_m;
                car.heading_rad = built.start_heading_rad;
                car.engine_on = true;
                car.rpm = rs.drivetrain.idle_target_rpm;
                arc_start_m = built.arc_start_m;
                course = Some(built);
                Phase::Launched
            }
        };
        let episodes = match &course {
            Some(course) if exercise.is_sa_hinh() => vec![Episode::default(); course.lines.len()],
            _ => Vec::new(),
        };
        // Bài 5: the cycle's phase offset is the seed proper, so the same trace always meets the
        // same light and a different attempt meets a different one.
        let light = if exercise == Exercise::Junction {
            Light {
                clock: phase_offset(seed, &rs.junction),
                stop_line_m: rs.junction.stop_line_m(),
                ..Light::dark()
            }
        } else {
            Light::dark()
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
            light,
            arc_start_m,
            finish_signal: None,
            finished: false,
            no_stop_charged: false,
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
    pub fn latched(&self) -> u64 {
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
            Exercise::Crosswalk | Exercise::Rail => self.step_road_stop(rs, t, controls, signal, fired),
            Exercise::Junction => self.step_junction(rs, t, controls, signal, fired),
            Exercise::Finish => self.step_finish(rs, t, controls, signal, fired),
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
        let bit = 1u64 << index;
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
            self.latched &= !(1u64 << index);
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
    ///
    /// The definition and distance A come from the shared detector (`crate::stop`), which bài 2,
    /// 5 and 9 use too; this function only says what the answers cost in bài 3.
    fn check_stop(&mut self, rs: &Ruleset, bumper: f64, fired: &mut Vec<FiredRule>) {
        let h = &rs.hill;
        let line = StopLine { line_m: h.stop_line_x_m(), max_a_m: h.max_a_m };
        if self.moved && self.car.speed_mps <= 0.0 && bumper >= h.foot_x_m {
            let verdict = line.verdict(bumper, true);
            self.stop = Some(Stop {
                tick: self.tick,
                front_bumper_m: bumper,
                at: StopAt { tick: self.tick, front_bumper_m: bumper, a_m: line.a_m(bumper), verdict },
            });
            self.phase = Phase::Stopped;
            match verdict {
                Verdict::Past { .. } => {
                    self.charge(rs, "SH.03.QUA_VACH", fired);
                }
                Verdict::Short { .. } => {
                    self.charge(rs, "SH.03.CHUA_DEN_VACH", fired);
                }
                Verdict::WithinA | Verdict::NotInZone => {}
            }
        } else if -line.a_m(bumper) >= h.no_stop_beyond_m {
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
    /// Judged per right wheel, because a wheel is what the law names. For each of the two right
    /// wheels, three facts decide it, and they are mutually exclusive on any one tick by
    /// construction (`VetStrip::touches_paint` vs `VetStrip::left_zone`):
    ///
    /// * the patch touches the vệt paint — the wheel is *in* the strip, on it, and only DE_VACH can
    ///   charge. This is the same patch-overlap test the contact model uses, so it agrees with the
    ///   contact code the snapshot reports;
    /// * the patch has left the strip entirely, past the outside of the paint — the wheel slipped
    ///   off the vệt sideways, which is TRUOT_VET;
    /// * the wheel is where neither holds and has never been inside — it is passing the strip
    ///   alongside it. Once it is `vet_entry_tolerance_m` past the strip's start, that is TRUOT_VET
    ///   too; the tolerance is the run-up the driver gets to line the car up.
    fn vet_tick(&mut self, rs: &Ruleset, course: &Course, fired: &mut Vec<FiredRule>) {
        let Some(vet) = course.vet else { return };
        let wheels = course.wheel_centres(rs, self.car.x_m, self.car.y_m, self.car.heading_rad);
        // The patch's circumscribed radius: half its diagonal. Using one measure for both tests is
        // what keeps "on the paint" and "left the strip" from ever being true together, and it errs
        // towards the paint being reached, which is the milder of the two charges.
        let (tyre, patch_len) = (rs.sa_hinh.tyre_width_m, rs.sa_hinh.patch_length_m);
        let patch_reach = 0.5 * libm::sqrt(tyre * tyre + patch_len * patch_len);
        let tolerance = rs.sa_hinh.vet_entry_tolerance_m;
        let in_length = |x: f64| x >= vet.x0 && x <= vet.x1;
        for (bit, index) in [0u8, 1u8].into_iter().zip([1usize, 3]) {
            let w = wheels[index];
            let been = self.vet_reached & (1 << bit) != 0;
            if !in_length(w.0) {
                // The strip's length is behind or ahead of this wheel: the sideways question does
                // not apply. What does apply is that its run through the strip is over without the
                // wheel ever having been inside.
                if !been && w.0 > vet.x1 {
                    self.charge(rs, "SH.04.TRUOT_VET", fired);
                }
                continue;
            }
            if vet.left_zone(w.1, patch_reach) {
                // The patch is entirely outside the strip's paint. If the wheel was ever inside, it
                // slipped off the vệt; if it never was, it is passing the strip alongside it, which
                // the run-up tolerance gives it a chance to fix.
                if been || w.0 > vet.x0 + tolerance {
                    self.charge(rs, "SH.04.TRUOT_VET", fired);
                }
                continue;
            }
            // The unit is inside the vệt zone: it counts as having gone through.
            self.vet_reached |= 1 << bit;
            if vet.touches_paint(w.1, patch_reach) {
                // ...and it is also on the paint, which the contact model charges as DE_VACH. That
                // is the only charge this wheel earns on this tick.
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
    /// Snapshot fields 27..46: contact, progress and the wheel centres, read off the session's own
    /// figure. Writes nothing when the exercise has no figure, so the fields mean one thing only.
    /// bài 4 and bài 6 fill all of them; bài 5 fills the ones its route can answer (contact,
    /// progress, lateral, heading error, wheels) and leaves the named parts, the bài 4/6 clock and
    /// the contact episodes at 0 — its place on the scene is field 49 and its clock is field 48.
    pub fn figure_snapshot(&self, rs: &Ruleset, out: &mut crate::Snapshot) {
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

    /// Which right wheels have been inside the vệt strip, as the hash records them: bit 0 front
    /// right, bit 1 rear right. The hash takes the two bits, not a bool — "the front one got in but
    /// the rear one did not" is a different state from "both did", and a mid-run hash that folded
    /// them together could miss a real difference.
    pub fn vet_wheels(&self) -> u8 {
        self.vet_reached
    }
}

/// Bài 5's phase offset: the seed proper (the low 56 bits), reduced modulo the cycle, so two
/// attempts with different seeds meet the light at different points and the same seed always meets
/// it the same way. No division by the PRNG, no clock.
fn phase_offset(seed: u64, j: &crate::rules::Junction) -> u32 {
    let cycle = u64::from(j.cycle_ticks().max(1));
    (seed % cycle) as u32
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

// ---------------------------------------------------------------------------------------------
// Bài 2 — Dừng xe nhường đường cho người đi bộ, bài 9 — Tạm dừng ở chỗ có đường sắt chạy qua and
// bài 11 — Kết thúc.
//
// The three share one straight-road scene (`rules::Road`): a lane, a stop line, and one thing past
// it — the crosswalk (bài 2), the rail (bài 9), the finish line (bài 11). The engine idles, the
// handbrake is on and scoring is live from tick 1, as in bài 3.
//
// Bài 2 and bài 9 are the same exercise with a different picture and different code prefixes, so
// they run one loop: stop at the line, then go on. The stop itself is the shared detector; this
// section only prices its answers.
//
// bài 2:  SH.02.KHONG_DUNG / CHUA_DEN_VACH / QUA_VACH
// bài 9:  SH.DS.KHONG_DUNG / CHUA_DEN_VACH / QUA_VACH
// bài 11: SH.KT.KHONG_XI_NHAN_PHAI on the tick the bumper crosses the finish line, and
//         SH.KT.KHONG_QUA_VACH (đình chỉ) if the car stops short of it with the engine running.
// ---------------------------------------------------------------------------------------------

impl State {
    /// Bài 2 and bài 9: stop at the line, then go on. Done when the bumper is `end_past_line_m`
    /// past the line after the stop.
    fn step_road_stop(
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
        self.note_movement();

        let r = &rs.road;
        let bumper = self.front_bumper_x(rs);
        let line = StopLine { line_m: r.stop_line_m(), max_a_m: r.max_a_m };
        let no_stop_mark = line.line_m + r.no_stop_beyond_m;
        // The stop verdict is judged while the car is still inside the stretch a stop of this
        // exercise can happen in: from the near edge of the stop zone to the no-stop mark past the
        // line. Past that mark and still rolling, the car is not stopping at the line and the
        // charge is KHONG_DUNG, not QUA_VACH — one act, one charge, whichever of the two it is.
        if self.stop.is_none() && bumper < no_stop_mark {
            let in_zone = bumper >= line.line_m - r.stop_zone_length_m;
            self.check_stop_at_line(rs, line, bumper, in_zone, fired);
        }
        if self.stop.is_none() && -line.a_m(bumper) >= r.no_stop_beyond_m {
            // "Không dừng xe ở vạch dừng quy định": through the line and on past the no-stop mark
            // without ever stopping for it.
            if self.charge(rs, self.exercise.id("KHONG_DUNG"), fired) {
                self.no_stop_charged = true;
            }
        }
        // Done once the car is past the line after its stop — or after the no-stop charge, since a
        // run that never stopped still has to end somewhere.
        let past = bumper >= line.line_m + r.end_past_line_m;
        if !self.disqualified && past && (self.stop.is_some() || self.no_stop_charged) {
            self.phase = Phase::Done;
        }
        if !self.disqualified && bumper >= line.line_m + r.run_end_past_line_m {
            // The car drove off down the road; the exercise cannot outlast its own scene.
            self.phase = Phase::Done;
        }
    }

    /// Bài 11: cross the finish line with the right signal on, then stop.
    fn step_finish(
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
        if self.disqualified || self.finished {
            return;
        }
        self.note_movement();

        let r = &rs.road;
        let bumper = self.front_bumper_x(rs);
        let finish = r.finish_m();

        // "Khi xe qua vạch kết thúc": judged once, on the tick the bumper crosses the line.
        if self.finish_signal.is_none() {
            if bumper >= finish {
                self.finish_signal = Some(self.signal);
                if self.signal != Signal::Right {
                    self.charge(rs, "SH.KT.KHONG_XI_NHAN_PHAI", fired);
                }
            } else if self.moved && self.car.speed_mps <= 0.0 && self.car.engine_on {
                // "Không qua vạch kết thúc, bị đình chỉ sát hạch": a real stop short of the line,
                // not a stall — the engine has to be running for this to be a stop the learner
                // chose. `next_tick_does_not_change_this` in the tests pins the pairing with
                // bài 11's clean run, where the car stops just after the line.
                self.charge(rs, "SH.KT.KHONG_QUA_VACH", fired);
            }
        } else if self.moved && self.car.speed_mps <= 0.0 {
            // "Lái xe qua vạch kết thúc và dừng xe": the run is over.
            self.finished = true;
            self.phase = Phase::Done;
        }
        if !self.disqualified && bumper >= finish + r.run_end_past_line_m {
            self.phase = Phase::Done;
        }
    }

    /// The shared stop, priced in the running exercise's own codes. `in_zone` is the exercise's
    /// answer to "is this stop one of mine?" — bài 3's slope foot, the road's stop zone.
    fn check_stop_at_line(
        &mut self,
        rs: &Ruleset,
        line: StopLine,
        bumper: f64,
        in_zone: bool,
        fired: &mut Vec<FiredRule>,
    ) {
        if !self.moved || self.car.speed_mps > 0.0 {
            return;
        }
        let verdict = line.verdict(bumper, in_zone);
        if verdict == Verdict::NotInZone {
            return;
        }
        self.stop = Some(Stop {
            tick: self.tick,
            front_bumper_m: bumper,
            at: StopAt { tick: self.tick, front_bumper_m: bumper, a_m: line.a_m(bumper), verdict },
        });
        self.phase = Phase::Stopped;
        match verdict {
            Verdict::WithinA | Verdict::NotInZone => {}
            Verdict::Short { .. } => {
                self.charge(rs, self.exercise.id("CHUA_DEN_VACH"), fired);
            }
            Verdict::Past { .. } => {
                self.charge(rs, self.exercise.id("QUA_VACH"), fired);
            }
        }
    }

    /// Whether the running yellow began while the car was still short of the stop line. The tick a
    /// colour starts is `clock - (ticks into the colour)`, so the answer is a function of the clock
    /// and the line, not of what the driver did: `bumper_at_colour_start` is recorded each tick.
    fn yellow_began_short(&self) -> bool {
        self.light.bumper_at_colour_start < self.light.stop_line_m
    }

    /// First movement under the car's own power, the same 0,1 m/s as bài 1 and bài 3.
    fn note_movement(&mut self) {
        if !self.moved && self.car.speed_mps > 0.1 {
            self.moved = true;
        }
    }

    /// The light cycle of bài 5, advanced one step. It starts at the car's first movement, not at
    /// tick 0: a learner who spends a minute cranking the engine should not find the light already
    /// most of the way through its cycle when they finally reach the line.
    fn tick_light(&mut self, rs: &Ruleset) {
        if self.light.colour == 0 && !self.moved {
            return;
        }
        let j = &rs.junction;
        let bumper = self.front_bumper_x(rs);
        if self.light.colour == 0 {
            // The first moving tick: the colour it starts on counts as having begun here.
            self.light.colour = j.light_at(self.light.clock);
            self.light.bumper_at_colour_start = bumper;
        }
        let before = self.light.colour;
        self.light.clock = self.light.clock.wrapping_add(1);
        self.light.colour = j.light_at(self.light.clock);
        if self.light.colour != before {
            self.light.bumper_at_colour_start = bumper;
        }
        let into = self.light.clock % j.cycle_ticks().max(1);
        self.light.left = match self.light.colour {
            1 => j.red_ticks - into,
            3 => j.red_ticks + j.green_ticks - into,
            _ => j.cycle_ticks() - into,
        };
    }

    /// Bài 5: one right turn through a signalled junction.
    ///
    /// The stop is judged only when the light asked for it (red, or a yellow still short of the
    /// line), because the law's two stop-distance errors are about stopping *for the signal*.
    /// Passing the junction on red — or on a yellow that began while the car was short of the line
    /// — is VUOT_DEN_DO, at the tick the bumper enters the junction; a stop that ends 0–4 m past
    /// the line only on red is therefore QUA_VACH alone, never both.
    fn step_junction(
        &mut self,
        rs: &Ruleset,
        t: &Thresholds,
        controls: Controls,
        signal: Signal,
        fired: &mut Vec<FiredRule>,
    ) {
        let Some(course) = self.course.take() else { return };
        self.tick += 1;
        self.controls = controls;
        self.signal = signal;

        let outcome = self.drive_car(rs, &controls);
        self.check_engine(rs, t, outcome, fired);
        if self.disqualified {
            self.course = Some(course);
            return;
        }
        self.note_movement();
        self.tick_light(rs);

        let j = &rs.junction;
        let bumper = self.front_bumper_x(rs);
        let line = StopLine { line_m: j.stop_line_m(), max_a_m: j.max_a_m };
        let in_zone = bumper >= line.line_m - j.stop_zone_length_m;

        // Arm the 20 s / 30 s clock: the later of the arrival in the zone and the green the car
        // actually has (the one running as it arrives, or the next one at/after the arrival).
        if in_zone {
            self.light.arrived = true;
        }
        if self.light.arrived && self.light.armed_at.is_none() && self.light.colour == 3 {
            self.light.armed_at = Some(self.tick);
        }

        // The turn signal, read where the turn begins.
        if let Some(arc) = self.arc_start_m {
            if bumper >= arc && self.signal != Signal::Right {
                self.charge(rs, "SH.05.KHONG_XI_NHAN", fired);
            }
        }

        // A stop the light asked for.
        if self.stop.is_none() && in_zone && self.car.speed_mps <= 0.0 && self.moved {
            let light_asks = self.light.colour == 1 || self.light.colour == 2;
            if light_asks {
                self.check_stop_at_line(rs, line, bumper, in_zone, fired);
            }
        }

        // Through the junction: the tick the bumper enters it, on a colour that forbids it.
        if bumper >= line.line_m + j.junction_depth_m && self.light.colour != 0 {
            // Red forbids it outright. Yellow forbids it only if the car was still short of the
            // line when that yellow began — "nếu chưa đến vạch dừng phải dừng lại"; a yellow that
            // began once the bumper was at or past the line is a through-move the law allows.
            // The yellow question is only asked while the light is yellow: what a yellow that
            // once found the car short of the line means afterwards is nothing — by then the car
            // is through the junction on a colour the law allows.
            let red = self.light.colour == 1;
            let yellow_from_short = self.light.colour == 2 && self.yellow_began_short();
            if red || yellow_from_short {
                self.charge(rs, "SH.05.VUOT_DEN_DO", fired);
            }
        }

        // The route's own lines: a wheel patch on a boundary line is SAI_VACH_KE (đình chỉ).
        if !self.disqualified {
            let walls = course.boundary_touch(rs, self.car.x_m, self.car.y_m, self.car.heading_rad);
            if walls {
                self.charge(rs, "SH.05.SAI_VACH_KE", fired);
            }
        }

        // The 20 s / 30 s clock: from the light the car actually has to the end line of the
        // junction, which ends the exercise.
        if let Some(from) = self.light.armed_at {
            let progress = course.project(self.car.x_m, self.car.y_m).progress_m;
            if progress >= course.exit_m {
                self.phase = Phase::Done;
            } else {
                // The later mark outranks the earlier one, as bài 1 reads its own pair: 30 s is a
                // suspension, so charging 20 s as well would add five points to a dead run.
                let elapsed = self.tick.saturating_sub(from);
                if elapsed > t.junction_30_ticks {
                    self.charge(rs, "SH.05.QUA_30S", fired);
                } else if elapsed > t.junction_20_ticks {
                    self.charge(rs, "SH.05.QUA_20S", fired);
                }
            }
        }
        self.course = Some(course);
    }
}
