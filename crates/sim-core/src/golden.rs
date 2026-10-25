//! Golden traces: two recorded input scripts the runners replay, and the tests that keep the hash
//! honest.
//!
//! File format (what the runners are written against):
//! * `golden/<name>.trace` — 8-byte little-endian `u64` seed, then N × 8-byte `TickInput` records.
//! * `golden/<name>.hash`  — the final `sim_hash` as 16 lowercase hex digits plus a newline.
//!
//! Regenerate with `cargo run -p sim-core --example gen_golden`. The traces are committed, so a
//! change in the simulation that moves the hash must be a deliberate re-record, not a silent one.

use crate::{Session, TickInput};

const BELT: u8 = TickInput::FLAG_BELT;
const LEFT: u8 = TickInput::FLAG_SIGNAL_LEFT;
const RIGHT: u8 = TickInput::FLAG_SIGNAL_RIGHT;
const IGN: u8 = TickInput::FLAG_IGNITION;

pub struct Golden {
    pub name: &'static str,
    pub seed: u64,
    pub inputs: Vec<TickInput>,
}

/// Record a trace: drive a real session with a state-aware driver and freeze the inputs it sent.
/// The trace is a fixed script afterwards — replay never looks at the state to decide the input.
fn record(seed: u64, ticks: u32, mut driver: impl FnMut(&crate::View, u32) -> TickInput) -> Vec<TickInput> {
    let mut s = Session::new(seed);
    let mut inputs = Vec::with_capacity(ticks as usize);
    for t in 0..ticks {
        let input = {
            let v = s.view();
            driver(&v, t)
        };
        s.step(input);
        inputs.push(input);
    }
    inputs
}

/// A clean pass: belt on, signal left at the order, gentle clutch, light throttle, the signal
/// switched off once the bumper is inside the 5 m window, then a coast to the end mark. No rule
/// fires. Recorded at metres, so the window is hit exactly.
pub fn clean_pass() -> Golden {
    let seed = 1;
    let inputs = record(seed, 330, |v, t| {
        let signalling = v.front_bumper_m < 5.0;
        let mut flags = BELT;
        if signalling {
            flags |= LEFT;
        }
        if t < 30 {
            // Parked at the line: clutch pressed, neutral, handbrake on.
            TickInput { gear: 0, clutch: 255, flags: flags | TickInput::FLAG_HANDBRAKE, ..Default::default() }
        } else if t < 60 {
            // Release the handbrake and feed the clutch in gently in first.
            let clutch = 255u8.saturating_sub(((t - 30) * 5) as u8);
            TickInput { gear: 1, clutch, throttle: 60, steering: (t as i16 - 45) * 40, flags, ..Default::default() }
        } else if v.speed_mps < 3.0 {
            TickInput { gear: 1, clutch: 60, throttle: 40, steering: 120, flags, ..Default::default() }
        } else {
            // Coast: off the throttle, a touch of steer, signal already off.
            TickInput { gear: 1, clutch: 60, steering: 0, flags, ..Default::default() }
        }
    });
    Golden { name: "xuat_phat_clean", seed, inputs }
}

/// A messy run: stall, restart, rev past 4000, a signal switched off far too early, a handbrake
/// stall, and a right signal at the end. Chosen so the float paths (clutch slip, rpm, steering)
/// all move, and so a one-bit float difference anywhere turns into a different final hash.
pub fn messy_run() -> Golden {
    let seed = 0x0123_4567_89ab_cdef;
    let mut stage = 0u8;
    let inputs = record(seed, 460, |v, t| {
        // Advance the stage on what the simulation says, not on a guessed tick.
        match stage {
            0 if t >= 18 => stage = 1,
            1 if !v.engine_on => stage = 2,
            2 if v.engine_on && t > 25 => stage = 3,
            3 if v.rpm > 4300.0 => stage = 4,
            4 if v.speed_mps > 1.0 => stage = 5,
            5 if v.front_bumper_m >= 0.5 => stage = 6,
            6 if v.front_bumper_m >= 4.0 => stage = 7,
            7 if v.speed_mps <= 0.0 => stage = 8,
            _ => {}
        }
        match stage {
            // Sitting at the line, no belt yet, neutral, engine idling.
            0 => TickInput { gear: 0, clutch: 255, ..Default::default() },
            // Drop the clutch in first at idle: dead stall.
            1 => TickInput { gear: 1, clutch: 0, steering: -60, ..Default::default() },
            // Restart: clutch in, neutral, key held.
            2 => TickInput { gear: 0, clutch: 255, flags: IGN, ..Default::default() },
            // Belt on, signal left, rev it in neutral past 4000.
            3 => TickInput {
                gear: 0,
                clutch: 255,
                throttle: 255,
                flags: BELT | LEFT,
                ..Default::default()
            },
            // Launch in first with a fast clutch drop and a lot of throttle.
            4 => TickInput {
                gear: 1,
                clutch: 40,
                throttle: 200,
                steering: 300,
                flags: BELT | LEFT,
                ..Default::default()
            },
            // Signal switched off at 5 m... which is inside the window; stage 6 then
            // re-arms it and kills it early, so the messy trace still shows untimely use.
            5 | 6 => TickInput {
                gear: 1,
                clutch: 20,
                throttle: 150,
                steering: 100,
                flags: BELT,
                ..Default::default()
            },
            // Handbrake stop in second gear: the second stall.
            7 => TickInput {
                gear: 2,
                clutch: 0,
                brake: 255,
                steering: -200,
                flags: BELT | TickInput::FLAG_HANDBRAKE,
                ..Default::default()
            },
            // Odd signal use at the end: right instead of left, engine off.
            _ => TickInput { gear: 0, clutch: 255, flags: BELT | RIGHT, ..Default::default() },
        }
    });
    Golden { name: "xuat_phat_messy", seed, inputs }
}

pub fn all() -> [Golden; 2] {
    [clean_pass(), messy_run()]
}

pub fn run(g: &Golden) -> Session {
    let mut s = Session::new(g.seed);
    for &input in &g.inputs {
        s.step(input);
    }
    s
}

/// Serialised form the runners read: seed then the input records.
pub fn encode(g: &Golden) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + g.inputs.len() * TickInput::WIRE_LEN);
    out.extend_from_slice(&g.seed.to_le_bytes());
    for i in &g.inputs {
        out.extend_from_slice(&wire(*i));
    }
    out
}

fn wire(i: TickInput) -> [u8; TickInput::WIRE_LEN] {
    let mut b = [0u8; TickInput::WIRE_LEN];
    b[0..2].copy_from_slice(&i.steering.to_le_bytes());
    b[2] = i.throttle;
    b[3] = i.brake;
    b[4] = i.clutch;
    b[5] = i.gear as u8;
    b[6] = i.flags;
    b
}

pub fn hash_line(s: &Session) -> String {
    format!("{:016x}\n", s.hash())
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMMITTED: [(&str, &str); 2] = [
        ("xuat_phat_clean", include_str!("../../../golden/xuat_phat_clean.hash")),
        ("xuat_phat_messy", include_str!("../../../golden/xuat_phat_messy.hash")),
    ];

    /// The committed `.hash` files must match what the code produces today. A failure means the
    /// simulation changed: re-record with `cargo run -p sim-core --example gen_golden` on purpose.
    #[test]
    fn committed_golden_hashes_match_the_simulation() {
        for (g, committed) in all().iter().zip(COMMITTED) {
            assert_eq!(g.name, committed.0);
            assert_eq!(hash_line(&run(g)), committed.1, "golden {} drifted", g.name);
        }
    }

    /// The committed `.trace` bytes must be exactly what the generator writes.
    #[test]
    fn committed_golden_traces_match_the_generator() {
        for g in all() {
            let path = format!("{}/../../golden/{}.trace", env!("CARGO_MANIFEST_DIR"), g.name);
            let on_disk = std::fs::read(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
            assert_eq!(on_disk, encode(&g), "golden {} trace drifted", g.name);
        }
    }

    /// Same trace twice: same hash. Guards against hidden state the hash does not cover.
    #[test]
    fn same_trace_run_twice_gives_the_same_hash() {
        for g in all() {
            let a = run(&g).hash();
            let b = run(&g).hash();
            assert_eq!(a, b, "golden {} is not reproducible", g.name);
        }
    }

    /// One bit in one input must move the hash *and* the simulation behind it. The second half is
    /// what stops this passing vacuously: a hash that happened to vary (through the PRNG, say)
    /// while the car computed the same thing would satisfy the first half alone.
    #[test]
    fn flipping_one_input_bit_changes_the_hash_and_the_state() {
        let mut g = clean_pass();
        let before = run(&g);
        let baseline = (before.hash(), before.view().front_bumper_m, before.view().rpm);

        // Flip the lowest bit of the throttle on one frame in the middle of the launch.
        g.inputs[70].throttle ^= 1;
        let after = run(&g);
        let moved = (after.hash(), after.view().front_bumper_m, after.view().rpm);

        assert_ne!(moved.0, baseline.0, "a one-bit input change left the hash alone");
        assert!(
            moved.1 != baseline.1 || moved.2 != baseline.2,
            "the hash moved but the car did not: {baseline:?} vs {moved:?}"
        );
    }

    /// A cranking attempt in progress is state: two runs that differ only in when the key went
    /// down must not share a hash, or a mid-run hash comparison could miss a real difference.
    #[test]
    fn hash_covers_the_starter_progress() {
        let idle = TickInput { clutch: 255, flags: TickInput::FLAG_BELT, ..TickInput::default() };
        let key = TickInput { flags: idle.flags | TickInput::FLAG_IGNITION, ..idle };
        let hash_after = |first: TickInput| {
            let mut s = Session::new(messy_run().seed);
            for &input in &messy_run().inputs {
                s.step(input);
                if !s.view().engine_on {
                    break;
                }
            }
            assert!(!s.view().engine_on, "the messy trace must stall the engine");
            s.step(first);
            s.step(key);
            s.hash()
        };
        assert_ne!(hash_after(idle), hash_after(key));
    }

    /// The messy trace must actually move the float paths it exists for: the rpm past 4000, the
    /// engine dead at least once, and the left signal off outside the window.
    #[test]
    fn messy_trace_exercises_the_float_paths() {
        let mut s = Session::new(messy_run().seed);
        let mut peak_rpm: f64 = 0.0;
        let mut saw_dead_engine = false;
        for &input in &messy_run().inputs {
            s.step(input);
            let v = s.view();
            peak_rpm = peak_rpm.max(v.rpm);
            saw_dead_engine |= !v.engine_on;
        }
        let v = s.view();
        assert!(saw_dead_engine, "the messy trace must stall the engine");
        assert!(peak_rpm > 4000.0, "the messy trace must pass 4000 rpm, got {peak_rpm}");
        assert!(v.fired("SH.01.XI_NHAN_KHONG_KIP") >= 1, "the signal was used untimely");
        assert!(v.fired("SH.X.CHET_MAY") >= 1, "the stall was scored");
    }

    /// The clean trace must be clean: no rule fires at all.
    #[test]
    fn clean_trace_scores_nothing() {
        let v = run(&clean_pass());
        let v = v.view();
        assert_eq!(v.fired_ids(), Vec::<&str>::new(), "clean run must be clean");
        assert_eq!(v.score, 100);
    }
}
