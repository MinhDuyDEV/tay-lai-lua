//! sim-core: deterministic driving-exam simulation core.
//!
//! `lib.rs` is the pure core (no I/O, no clock, no wasm import). `abi.rs` is the only way the
//! outside world reaches it.
//!
//! Determinism rules this crate holds itself to:
//! * one fixed 1/60 s step; `step` never receives a `dt`;
//! * float math is `+ - * /` only, with `sin`/`cos` from `libm` (never `f64::sin`);
//! * no `mul_add`, no relaxed SIMD, no clock, no I/O;
//! * every random draw comes from the seeded PRNG in this file.

mod abi;
mod course;
mod exercise;
pub mod golden;
mod hash;
mod rules;
mod vehicle;

#[cfg(test)]
mod scenarios;
#[cfg(test)]
mod scenarios_sa_hinh;
#[cfg(test)]
mod scenarios_hill;

use exercise::{DT, Exercise, Signal, State};
use hash::Hash;
use rules::{Ruleset, Thresholds};
use vehicle::Controls;

/// One quantised input snapshot, consumed by exactly one 1/60 s step.
/// Wire layout (8 bytes, little endian):
/// `[0..2] steering i16 | [2] throttle u8 | [3] brake u8 | [4] clutch u8 | [5] gear i8 | [6] flags u8 | [7] 0`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TickInput {
    pub steering: i16,
    pub throttle: u8,
    pub brake: u8,
    pub clutch: u8,
    pub gear: i8,
    pub flags: u8,
}

impl TickInput {
    pub const WIRE_LEN: usize = 8;
    pub const FLAG_BELT: u8 = 1 << 0;
    pub const FLAG_SIGNAL_LEFT: u8 = 1 << 1;
    pub const FLAG_IGNITION: u8 = 1 << 2;
    pub const FLAG_HANDBRAKE: u8 = 1 << 3;
    pub const FLAG_SIGNAL_RIGHT: u8 = 1 << 4;
    /// The learner pressed the start order (đèn xanh). Latches: only the first tick carrying it
    /// matters, and everything after that tick is scored.
    pub const FLAG_START_ORDER: u8 = 1 << 5;

    pub fn from_wire(b: &[u8; Self::WIRE_LEN]) -> Self {
        Self {
            steering: i16::from_le_bytes([b[0], b[1]]),
            throttle: b[2],
            brake: b[3],
            clutch: b[4],
            gear: b[5] as i8,
            flags: b[6],
        }
    }

    fn signal(&self) -> Signal {
        let left = self.flags & Self::FLAG_SIGNAL_LEFT != 0;
        let right = self.flags & Self::FLAG_SIGNAL_RIGHT != 0;
        match (left, right) {
            // Both together is not a state the law describes; the left signal is what bài 1
            // scores, and the runner's own input never sends both.
            (true, _) => Signal::Left,
            (false, true) => Signal::Right,
            (false, false) => Signal::Off,
        }
    }

    fn controls(&self, rs: &Ruleset) -> Controls {
        let unit = |v: u8| f64::from(v) / 255.0;
        Controls {
            steer_rad: f64::from(self.steering) / 32767.0 * rs.vehicle.max_steer_rad,
            throttle: unit(self.throttle),
            brake: unit(self.brake),
            clutch: unit(self.clutch),
            gear: self.gear,
            handbrake: self.flags & Self::FLAG_HANDBRAKE != 0,
            has_belt: self.flags & Self::FLAG_BELT != 0,
            ignition: self.flags & Self::FLAG_IGNITION != 0,
        }
    }
}

/// One drained event record. Wire layout (8 bytes, little endian):
/// `[0..4] tick u32 | [4..6] code u16 | [6..8] points i16`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Event {
    pub tick: u32,
    pub code: u16,
    pub points: i16,
}

impl Event {
    pub const WIRE_LEN: usize = 8;

    pub fn to_wire(self) -> [u8; Self::WIRE_LEN] {
        let mut b = [0u8; Self::WIRE_LEN];
        b[0..4].copy_from_slice(&self.tick.to_le_bytes());
        b[4..6].copy_from_slice(&self.code.to_le_bytes());
        b[6..8].copy_from_slice(&self.points.to_le_bytes());
        b
    }
}

/// xorshift64*: the only source of randomness, seeded per session and hashed with the state.
struct Prng(u64);

impl Prng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
}

/// The exercise id is the top byte of the seed; the layout is documented at `sim_create`.
const EXERCISE_SHIFT: u32 = 56;

/// Length of the `state` snapshot, mirrored by the TS side. `sim_state` refuses to write more.
pub const SNAPSHOT_LEN: usize = 46;

/// One snapshot of the run: a flat `f64` array, so a JS `Float64Array` over the wasm buffer needs
/// no alignment logic. **This list is the field order** — the single place the wire layout of
/// `sim_state` is written down. Booleans are 0.0 or 1.0; `phase` and `signal` are the codes in
/// `phase_code` and `signal_code`. Adding a field means bumping `SNAPSHOT_LEN` here and in TS.
///
/// ```text
///  0 tick                  steps since the start order (0 while it waits for the order); bài 3
///                          has no order, it counts from the first step
///  1 phase                 0 waiting | 1 launched | 2 past line | 3 done | 4 stopped
///  2 score                 100 down to 0
///  3 disqualified          0 | 1
///  4 car x_m               metres, car centre, on the course axis
///  5 car y_m               metres
///  6 heading_rad           radians, 0 = down the course
///  7 speed_mps             m/s along the car's own +x axis
///  8 rpm                   engine speed, 0 when the engine is off
///  9 front_bumper_m        front-bumper centre, metres past the start line (negative = short);
///                          in bài 3 the course axis, with the foot of the slope at `hill.foot_x_m`
/// 10 engine_on             0 | 1
/// 11 cranking              0 | 1, the starter is turning
/// 12 steer_rad             -max_steer..max_steer, as consumed
/// 13 throttle              0..1, as consumed
/// 14 brake                 0..1, as consumed
/// 15 clutch                0..1 pedal travel, as consumed (1 = fully pressed, clutch open)
/// 16 gear                  -1..5, as consumed (0 = neutral)
/// 17 handbrake             0 | 1
/// 18 belt                  0 | 1
/// 19 signal                0 off | 1 left | 2 right
/// 20 engine_load_nm        Nm the clutch drags the engine down with; negative when the wheels
///                          drive the engine. The audio tells lugging from a free rev by it.
/// 21 line_gap_m            bài 3: stop line minus front bumper, positive while short; 0 in bài 1
/// 22 stop_gap_a_m          bài 3: distance A recorded at the stop (negative = past the line); 0
///                          before the stop
/// 23 rollback_m            bài 3: metres the front bumper is behind where the car stopped, >= 0;
///                          0 before the stop
/// 24 since_stop_ticks      bài 3: steps since the stop, 0 on the stop step; -1 before it (and in bài 1)
/// 25 elevation_m           road height under the car centre, metres above the flat; 0 in bài 1
/// 26 grade                 road grade under the car centre (0.10 on bài 3's slope); 0 in bài 1
/// 27 contact FL            what the front-left wheel's contact patch is on: 0 clear | 1 on a
///                          limit line | 2 on a curb
/// 28 contact FR            as 27, front right
/// 29 contact RL            as 27, rear left
/// 30 contact RR            as 27, rear right
/// 31 progress_m            bài 4/6: metres along the figure's centreline from its start; 0 else
/// 32 course_length_m       bài 4/6: the centreline's length; 0 else
/// 33 lateral_m             bài 4/6: signed offset from the centreline, + left of it; 0 else
/// 34 heading_err_rad       bài 4/6: car heading minus the centreline's heading; 0 else
/// 35 segment               bài 4: 0 approach | 1 vệt | 2 straight | 3 first bend | 4 transverse
///                          leg | 5 second bend | 6 exit; bài 6: 0 entry | 1 first half |
///                          2 second half | 3 exit; 0 else
/// 36 clock_s               bài 4/6: seconds on the exercise clock, 0 until the entry gate; 0 else
/// 37 longest_episode_s     bài 4/6: the longest contact episode running right now, seconds; 0 else
/// 38..45 wheel_x, wheel_y  bài 4/6: the four wheel centres in the car's frame, FL FR RL RR, as
///                          (x, y) pairs: 38/39 FL, 40/41 FR, 42/43 RL, 44/45 RR; 0 else
/// ```
pub type Snapshot = [f64; SNAPSHOT_LEN];

pub use exercise::Phase;

pub struct Session {
    rules: Ruleset,
    thresholds: Thresholds,
    state: State,
    seed: u64,
    prng: Prng,
    /// Every rule fired so far, in tick order. Part of the hash.
    events: Vec<Event>,
    /// Not yet drained by the caller.
    pending: Vec<Event>,
}

impl Session {
    /// `None` when the seed names an exercise this core does not have (see `sim_create`).
    pub fn new(seed: u64) -> Option<Self> {
        Self::with_ruleset(seed, Ruleset::load())
    }

    pub fn with_ruleset(seed: u64, rules: Ruleset) -> Option<Self> {
        let exercise = match seed >> EXERCISE_SHIFT {
            0 | 1 => Exercise::Start,
            3 => Exercise::Hill,
            4 => Exercise::Vet,
            6 => Exercise::Curve,
            _ => return None,
        };
        let thresholds = rules.thresholds();
        let state = State::new(&rules, exercise);
        // A zero seed would freeze xorshift; start from a non-zero constant like the skeleton did.
        let prng = Prng(seed ^ 0x9e37_79b9_7f4a_7c15);
        Some(Self { rules, thresholds, state, seed, prng, events: Vec::new(), pending: Vec::new() })
    }

    pub fn step(&mut self, input: TickInput) {
        let mut fired = Vec::new();
        self.state.step(
            &self.rules,
            &self.thresholds,
            input.controls(&self.rules),
            input.signal(),
            input.flags & TickInput::FLAG_START_ORDER != 0,
            &mut fired,
        );
        for rule in fired {
            let event = Event { tick: rule.tick, code: rule.code, points: rule.points };
            self.events.push(event);
            self.pending.push(event);
        }
        // The PRNG advances every step so the stream is part of the state whether or not a rule
        // happened to draw from it.
        let _ = self.prng.next();
    }

    /// The smallest clearance from any wheel patch to any limit line, with the car placed at `pose`
    /// on the ideal line. The figure's own feasibility measure.
    #[doc(hidden)]
    pub fn ideal_pose_clearance(&self, centre: (f64, f64), heading: f64) -> f64 {
        let Some(course) = &self.state.course else { return f64::INFINITY };
        let wheels = course.wheel_centres(&self.rules, centre.0, centre.1, heading);
        let mut worst = f64::INFINITY;
        for w in wheels {
            for (kind, half, dist) in course.debug_contacts(&self.rules, w, heading) {
                if kind != 2 {
                    let clear = dist - half;
                    if clear < worst { worst = clear; }
                }
            }
        }
        worst
    }

    /// Every line's distance from the car's four patches, for the geometry diagnostics.
    #[doc(hidden)]
    pub fn debug_course_contacts(&self) -> Vec<Vec<(u8, f64, f64)>> {
        let Some(course) = &self.state.course else { return Vec::new() };
        course
            .wheel_centres(&self.rules, self.state.car.x_m, self.state.car.y_m, self.state.car.heading_rad)
            .iter()
            .map(|w| course.debug_contacts(&self.rules, *w, self.state.car.heading_rad))
            .collect()
    }

    /// The figure this session runs on, as `sim_course` writes it. Empty when the exercise has no
    /// figure, so a caller reads 0 and draws nothing.
    pub fn course_block(&self) -> Vec<f64> {
        let mut out = Vec::new();
        if let Some(course) = &self.state.course {
            course.write(&mut out);
        }
        out
    }

    /// Place the car at an exact pose, for the scenario tests.
    #[doc(hidden)]
    pub fn place_car(&mut self, x: f64, y: f64, heading: f64) {
        self.state.place_car(x, y, heading);
    }

    pub fn drain_events(&mut self) -> Vec<Event> {
        core::mem::take(&mut self.pending)
    }

    /// Read-only view of the run, for the scenario tests and the golden-trace generator.
    pub fn view(&self) -> View<'_> {
        let progress = self.state.progress_m();
        View {
            tick: self.state.tick,
            progress_m: progress.0,
            lateral_m: progress.1,
            heading_err_rad: progress.2,
            longest_episode_s: self.state.longest_episode_s(),
            clock_s: self.state.clock_seconds(),
            phase: self.state.phase,
            score: self.state.score,
            disqualified: self.state.disqualified,
            front_bumper_m: self.state.front_bumper_x(&self.rules),
            speed_mps: self.state.car.speed_mps,
            rpm: self.state.car.rpm,
            engine_on: self.state.car.engine_on,
            events: &self.events,
            rules: &self.rules,
        }
    }

    /// Read-only snapshot of the run for the web layer, as a flat `f64` array. It is derived, so
    /// it is not part of the hash.
    pub fn snapshot(&self) -> Snapshot {
        let s = &self.state;
        let c = &s.controls;
        let mut out = [0.0f64; SNAPSHOT_LEN];
        out[0] = f64::from(s.tick);
        out[1] = f64::from(phase_code(s.phase));
        out[2] = f64::from(s.score);
        out[3] = f64::from(u8::from(s.disqualified));
        out[4] = s.car.x_m;
        out[5] = s.car.y_m;
        out[6] = s.car.heading_rad;
        out[7] = s.car.speed_mps;
        out[8] = s.car.rpm;
        out[9] = s.front_bumper_x(&self.rules);
        out[10] = f64::from(u8::from(s.car.engine_on));
        out[11] = f64::from(u8::from(s.car.crank_left() > 0));
        out[12] = c.steer_rad;
        out[13] = c.throttle;
        out[14] = c.brake;
        out[15] = c.clutch;
        out[16] = f64::from(c.gear);
        out[17] = f64::from(u8::from(c.handbrake));
        out[18] = f64::from(u8::from(c.has_belt));
        out[19] = f64::from(signal_code(s.signal));
        out[20] = s.car.engine_load(&self.rules.vehicle, &self.rules.drivetrain, c);
        out[24] = -1.0;
        if s.exercise.is_sa_hinh() {
            s.sa_hinh_snapshot(&self.rules, &mut out);
        }
        if s.exercise == Exercise::Hill {
            let h = &self.rules.hill;
            out[21] = h.stop_line_x_m() - out[9];
            out[23] = 0.0;
            if let Some(stop) = s.stop {
                out[22] = h.stop_line_x_m() - stop.front_bumper_m;
                let back = stop.front_bumper_m - out[9];
                out[23] = if back > 0.0 { back } else { 0.0 };
                out[24] = f64::from(s.tick - stop.tick);
            }
            out[25] = h.elevation_at(s.car.x_m);
            out[26] = h.grade_at(s.car.x_m);
        }
        out
    }

    /// Hash of the full simulation state: every float as bits (NaN canonicalised, -0.0 folded),
    /// plus the integer state, the PRNG and every event so far.
    pub fn hash(&self) -> u64 {
        let s = &self.state;
        let mut h = Hash::new();
        h.u64(self.seed);
        h.u64(self.prng.0);
        h.u32(s.tick);
        h.u8(phase_code(s.phase));
        h.u8(signal_code(s.signal));
        h.i32(s.score);
        h.bool(s.disqualified);
        h.bool(s.has_moved());
        h.u32(s.latched());

        // Car.
        h.f64(s.car.x_m);
        h.f64(s.car.y_m);
        h.f64(s.car.heading_rad);
        h.f64(s.car.speed_mps);
        h.f64(s.car.rpm);
        h.bool(s.car.engine_on);
        h.u32(s.car.crank_left());

        // Controls of the last tick.
        let c = &s.controls;
        h.f64(c.steer_rad);
        h.f64(c.throttle);
        h.f64(c.brake);
        h.f64(c.clutch);
        h.u8(c.gear as u8);
        h.bool(c.handbrake);
        h.bool(c.has_belt);
        h.bool(c.ignition);

        // Course progress.
        h.opt_f64(s.crossed_at.map(f64::from));
        h.opt_f64(s.signal_off_at_m);

        // Bài 3's stop record. Bài 1 writes nothing, so its hash is what it was before bài 3.
        if s.exercise == Exercise::Hill {
            h.opt_f64(s.stop.map(|p| p.front_bumper_m));
            h.u32(s.stop.map_or(0, |p| p.tick));
        }

        // Bài 4 and bài 6 write their own block, and nothing else: the exercise-specific hash
        // blocks are why the four earlier goldens are untouched by these exercises existing.
        if s.exercise.is_sa_hinh() {
            h.f64(s.furthest_progress_m());
            h.f64(s.clock_seconds());
            h.bool(s.clock_running());
            h.u32(s.clock_charges());
            h.bool(s.vet_reached());
            for ep in s.episode_table() {
                h.bool(ep.touching);
                h.f64(ep.elapsed_s);
                h.f64(ep.next_keo_dai_s);
            }
        }

        // Events so far.
        h.u32(self.events.len() as u32);
        for e in &self.events {
            h.u32(e.tick);
            h.u16(e.code);
            h.i16(e.points);
        }
        h.raw()
    }
}

/// The figure numbers the ruleset and the car produce, for the geometry tests and the diagnostics.
#[doc(hidden)]
pub fn rules_probe() -> Vec<(&'static str, f64)> {
    let rs = Ruleset::load();
    let sh = &rs.sa_hinh;
    vec![
        ("rqv", sh.rqv_m(&rs.vehicle)),
        ("rn", sh.outer_radius_m(&rs.vehicle)),
        ("rtr", sh.inner_radius_m(&rs.vehicle)),
        ("Bqc", sh.lane_width_m(&rs.vehicle)),
        ("r", 0.5 * (sh.outer_radius_m(&rs.vehicle) + sh.inner_radius_m(&rs.vehicle))),
        ("sqc", sh.o_distance_m(&rs.vehicle)),
        ("angle", sh.o_line_angle_rad()),
        ("corner_radius", sh.corner_radius_m(&rs.vehicle, 1.5 * rs.vehicle.length_m + sh.lane_width_m(&rs.vehicle))),
        ("min_centre_radius", sh.min_centre_radius_m(&rs.vehicle)),
        ("Bvb", sh.vet_width_m(&rs.vehicle)),
        ("track", sh.track_m),
    ]
}

/// What a scenario asserts on, without handing out mutable state.
pub struct View<'a> {
    pub tick: u32,
    /// The figure fields a trace recorder needs: metres along the centreline, the signed offset from
    /// it, the heading error, the longest contact episode running, and the exercise clock.
    pub progress_m: f64,
    pub lateral_m: f64,
    pub heading_err_rad: f64,
    pub longest_episode_s: f64,
    pub clock_s: f64,
    pub phase: Phase,
    pub score: i32,
    pub disqualified: bool,
    /// Front-bumper centre, metres past the start line.
    pub front_bumper_m: f64,
    pub speed_mps: f64,
    pub rpm: f64,
    pub engine_on: bool,
    events: &'a [Event],
    rules: &'a Ruleset,
}

impl View<'_> {
    pub fn events(&self) -> &[Event] {
        self.events
    }

    /// How many times a rule fired, by its legal id.
    pub fn fired(&self, id: &str) -> usize {
        match self.rules.index_of(id) {
            Some(i) => {
                let code = self.rules.rules[i].code;
                self.events.iter().filter(|e| e.code == code).count()
            }
            None => 0,
        }
    }

    pub fn fired_ids(&self) -> Vec<&str> {
        self.events
            .iter()
            .filter_map(|e| self.rules.rules.iter().find(|r| r.code == e.code).map(|r| r.id.as_str()))
            .collect()
    }
}

fn phase_code(p: exercise::Phase) -> u8 {
    match p {
        exercise::Phase::Waiting => 0,
        exercise::Phase::Launched => 1,
        exercise::Phase::PastLine => 2,
        exercise::Phase::Done => 3,
        exercise::Phase::Stopped => 4,
    }
}

fn signal_code(s: Signal) -> u8 {
    match s {
        Signal::Off => 0,
        Signal::Left => 1,
        Signal::Right => 2,
    }
}

/// `DT` is the only time base; exposed so a trace builder can turn seconds into tick counts.
pub const STEP_SECONDS: f64 = DT;
