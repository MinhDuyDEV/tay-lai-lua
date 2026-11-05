//! The automatic gearbox: a translation step in front of the car, not a second car.
//!
//! The learner has a selector (R, N, D) and two pedals. The car underneath is the manual one and
//! only knows a gear and a clutch, so each tick this turns the selector, the speed and the engine
//! speed into the gear and the clutch pedal the manual car takes. A torque converter is modelled as
//! a clutch whose grip grows with the square of the engine speed (small at idle, whole at `converter_rpm`): the car creeps
//! when the brake is let go, pulls away on the throttle, and cannot stall. All numbers are the
//! simulator's assumptions (`automatic` in the ruleset).
//!
//! The selector travels in the wire's gear byte: below 0 is R, 0 is N, above 0 is D. The clutch byte
//! is ignored. The manual path never reaches this file.

use crate::rules::Automatic;
use crate::vehicle::{Car, Controls};

pub struct Driveline {
    /// The gear the box is in, 1..=4, followed by speed whatever the selector says, so D picked at
    /// speed lands in the right gear.
    gear: i8,
}

impl Driveline {
    pub fn new() -> Self {
        Self { gear: 1 }
    }

    pub fn gear(&self) -> i8 {
        self.gear
    }

    /// The controls the manual car takes this tick, from the learner's.
    pub fn translate(&mut self, a: &Automatic, car: &Car, c: Controls) -> Controls {
        let speed = car.speed_mps.abs();
        let g = usize::from(self.gear.unsigned_abs());
        if self.gear < 4 && speed > a.up_mps[g - 1] {
            self.gear += 1;
        } else if self.gear > 1 && speed < a.down_mps[g - 2] {
            self.gear -= 1;
        }

        let mut out = c;
        out.gear = if c.gear < 0 {
            -1
        } else if c.gear == 0 {
            0
        } else {
            self.gear
        };
        // The starter wants the clutch open; the converter has nothing to carry with the engine off.
        let engagement = if !car.engine_on || out.gear == 0 {
            0.0
        } else {
            let r = car.rpm / a.converter_rpm;
            (r * r).min(1.0)
        };
        out.clutch = 1.0 - engagement;
        out
    }
}
