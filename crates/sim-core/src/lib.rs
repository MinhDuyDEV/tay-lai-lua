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
mod exercise;
pub mod golden;
mod hash;
mod rules;
mod vehicle;

#[cfg(test)]
mod scenarios;

use exercise::{DT, Signal, State};
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
    pub fn new(seed: u64) -> Self {
        Self::with_ruleset(seed, Ruleset::load())
    }

    pub fn with_ruleset(seed: u64, rules: Ruleset) -> Self {
        let thresholds = rules.thresholds();
        let state = State::new(&rules);
        // A zero seed would freeze xorshift; start from a non-zero constant like the skeleton did.
        let prng = Prng(seed ^ 0x9e37_79b9_7f4a_7c15);
        Self { rules, thresholds, state, seed, prng, events: Vec::new(), pending: Vec::new() }
    }

    pub fn step(&mut self, input: TickInput) {
        let mut fired = Vec::new();
        self.state.step(
            &self.rules,
            &self.thresholds,
            input.controls(&self.rules),
            input.signal(),
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

    pub fn drain_events(&mut self) -> Vec<Event> {
        core::mem::take(&mut self.pending)
    }

    /// Read-only view of the run, for the scenario tests and the golden-trace generator.
    pub fn view(&self) -> View<'_> {
        View {
            tick: self.state.tick,
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

/// What a scenario asserts on, without handing out mutable state.
pub struct View<'a> {
    pub tick: u32,
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
        exercise::Phase::Launched => 0,
        exercise::Phase::PastLine => 1,
        exercise::Phase::Done => 2,
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
