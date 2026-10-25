//! One car: a kinematic bicycle for position, plus a lumped engine/clutch/gearbox for rpm and
//! stall. Deliberately small — this is a determinism experiment, not a driving game.
//!
//! What it must do, per the lane brief: dropping the clutch in gear at idle dead-stalls the
//! engine, rpm rises with throttle, rpm > 4000 is reachable, and a careful clutch release moves
//! the car. It does that, and nothing else.
//!
//! Float discipline: only `+ - * /` and `libm::{sin, cos}`. Never `f64::sin` (libm's version is
//! the one that is identical in V8, SpiderMonkey, JSC and wazero), never `mul_add`.

use crate::rules::{Drivetrain, Vehicle};
use libm::{cos, sin};

/// rpm -> rad/s.
const RADPS_PER_RPM: f64 = core::f64::consts::PI * 2.0 / 60.0;
const EPS: f64 = 1e-9;

pub struct Car {
    /// Reference point is the car's centre, on its own +x axis. `<x>` grows down the exercise.
    pub x_m: f64,
    pub y_m: f64,
    pub heading_rad: f64,
    /// m/s along the car's own +x axis. Negative is reversing.
    pub speed_mps: f64,
    pub rpm: f64,
    pub engine_on: bool,
    /// Ticks left of a cranking attempt; 0 when the starter is idle.
    crank_left: u32,
}

/// What the pedals, the lever and the switches asked for on one tick. Pedal values are 0..1.
#[derive(Clone, Copy)]
pub struct Controls {
    pub steer_rad: f64,
    pub throttle: f64,
    pub brake: f64,
    /// Pedal travel: 0 = released (clutch closed), 1 = fully pressed (clutch open).
    pub clutch: f64,
    pub gear: i8,
    pub handbrake: bool,
    pub has_belt: bool,
    /// Key held in the start position.
    pub ignition: bool,
}

impl Default for Controls {
    /// The initial state the lane agreed on: engine running at idle, neutral, belt off, handbrake on.
    fn default() -> Self {
        Self {
            steer_rad: 0.0,
            throttle: 0.0,
            brake: 0.0,
            clutch: 1.0,
            gear: 0,
            handbrake: true,
            has_belt: false,
            ignition: false,
        }
    }
}

impl Controls {
    /// Pedal travel -> share of the clutch's torque capacity, 1..0.
    fn engagement(&self) -> f64 {
        1.0 - self.clutch.clamp(0.0, 1.0)
    }

    /// The road drags the engine only when a gear is in and the clutch is not fully open.
    fn engine_coupled(&self) -> bool {
        self.gear != 0 && self.engagement() > 0.0
    }
}

pub struct StepOutcome {
    /// True on the tick the engine died.
    pub stalled: bool,
}

impl Car {
    /// Ticks left of a cranking attempt. State, so the hash covers it.
    pub fn crank_left(&self) -> u32 {
        self.crank_left
    }

    pub fn new(d: &Drivetrain) -> Self {
        Self {
            x_m: 0.0,
            y_m: 0.0,
            heading_rad: 0.0,
            speed_mps: 0.0,
            rpm: d.idle_target_rpm,
            engine_on: true,
            crank_left: 0,
        }
    }

    /// Centre of the front bumper, in metres past the start line. The rules measure to this
    /// point; see `measure_point` in the ruleset.
    pub fn front_bumper_x(&self, v: &Vehicle) -> f64 {
        self.x_m + 0.5 * v.length_m * cos(self.heading_rad)
    }

    pub fn step(&mut self, v: &Vehicle, d: &Drivetrain, c: &Controls, dt: f64) -> StepOutcome {
        let stalled = self.step_engine(v, d, c, dt);
        self.step_motion(v, d, c, dt);
        StepOutcome { stalled }
    }

    /// Engine speed and stall. Returns true on the tick the engine dies.
    fn step_engine(&mut self, v: &Vehicle, d: &Drivetrain, c: &Controls, dt: f64) -> bool {
        if !self.engine_on {
            self.service_starter(d, c);
            if !self.engine_on {
                self.rpm = 0.0;
                return false;
            }
        }

        let governor =
            ((d.idle_target_rpm - self.rpm) * d.idle_gain_nm_per_rpm).clamp(0.0, d.idle_max_nm);
        let indicated = engine_torque(d, self.rpm, c.throttle);
        let friction = d.friction_base_nm + d.friction_per_rpm * self.rpm;
        let drag = self.clutch_torque(v, d, c);

        let net_torque = indicated + governor - friction - drag;
        let d_radps = net_torque / d.engine_inertia_kgm2 * dt;
        self.rpm += d_radps / RADPS_PER_RPM;

        if self.rpm < d.stall_rpm {
            self.engine_on = false;
            self.rpm = 0.0;
            self.crank_left = 0;
            return true;
        }
        false
    }

    /// Holding the key cranks the engine, but only out of gear or with the clutch pressed.
    fn service_starter(&mut self, d: &Drivetrain, c: &Controls) {
        if self.crank_left == 0 {
            let safe = c.gear == 0 || c.engagement() < 0.05;
            if c.ignition && safe {
                self.crank_left = d.crank_ticks;
            }
            return;
        }
        if !c.ignition {
            self.crank_left = 0;
            return;
        }
        self.crank_left -= 1;
        if self.crank_left == 0 {
            self.engine_on = true;
            self.rpm = d.idle_target_rpm;
        }
    }

    /// Torque the partly closed clutch carries, positive when it drags the engine down.
    fn clutch_torque(&self, v: &Vehicle, d: &Drivetrain, c: &Controls) -> f64 {
        if !c.engine_coupled() {
            return 0.0;
        }
        let Some(ratio) = d.gears.ratio(c.gear) else {
            return 0.0;
        };
        // Engine-side speed the wheels are asking for, in rad/s.
        let driven = self.speed_mps / v.wheel_radius_m * ratio * d.final_drive;
        let slip = self.rpm * RADPS_PER_RPM - driven;
        let carried = (d.clutch_stiffness_nm_per_rad_s * slip)
            .clamp(-d.clutch_capacity_nm, d.clutch_capacity_nm);
        carried * c.engagement()
    }

    fn step_motion(&mut self, v: &Vehicle, d: &Drivetrain, c: &Controls, dt: f64) {
        let drive_n = self.drive_force_n(v, d, c);
        let hold_n = d.brake_max_n * c.brake.clamp(0.0, 1.0)
            + if c.handbrake { d.handbrake_max_n } else { 0.0 };
        let drag_n = d.drag_n_per_mps2 * self.speed_mps * self.speed_mps;

        let net_n = if self.speed_mps.abs() < EPS {
            // At rest, static resistance holds unless the driveline overcomes it.
            let static_n = hold_n + d.rolling_n;
            if drive_n.abs() <= static_n {
                0.0
            } else {
                drive_n - drive_n.signum() * static_n
            }
        } else {
            drive_n - self.speed_mps.signum() * (hold_n + d.rolling_n + drag_n)
        };

        let next = self.speed_mps + net_n / v.mass_kg * dt;
        // Resistance may stop the car; it may not push it the other way. Only the driveline, when
        // it pushes in the same direction the car came out moving, may carry it across zero.
        let crossed_zero = next * self.speed_mps < 0.0;
        let driveline_drives_there = drive_n * next > 0.0;
        self.speed_mps = if crossed_zero && !driveline_drives_there { 0.0 } else { next };

        let yaw_rate = self.speed_mps * sin(c.steer_rad) / (cos(c.steer_rad) * v.wheelbase_m.max(EPS));
        self.heading_rad = wrap_angle(self.heading_rad + yaw_rate * dt);
        self.x_m += self.speed_mps * cos(self.heading_rad) * dt;
        self.y_m += self.speed_mps * sin(self.heading_rad) * dt;
    }

    /// Force at the contact patch that the clutch feeds into the driveline.
    fn drive_force_n(&self, v: &Vehicle, d: &Drivetrain, c: &Controls) -> f64 {
        let Some(ratio) = d.gears.ratio(c.gear) else {
            return 0.0;
        };
        self.clutch_torque(v, d, c) * ratio * d.final_drive / v.wheel_radius_m
    }
}

fn engine_torque(d: &Drivetrain, rpm: f64, throttle: f64) -> f64 {
    let r = rpm / d.indicated_ref_rpm;
    // Rises to full torque near mid-range, falls away at idle and at the limiter.
    let shape = (1.0 - (r - 0.5) * (r - 0.5) * 1.6).clamp(0.0, 1.0);
    d.indicated_torque_nm * shape * throttle.clamp(0.0, 1.0)
}

fn wrap_angle(a: f64) -> f64 {
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
