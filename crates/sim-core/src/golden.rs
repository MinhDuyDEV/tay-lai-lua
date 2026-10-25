//! Golden traces: recorded input scripts the runners replay (two for bài 1, two for bài 3), and the tests that keep the hash
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
const ORDER: u8 = TickInput::FLAG_START_ORDER;
const HANDBRAKE: u8 = TickInput::FLAG_HANDBRAKE;

/// Ticks of cold cranking every trace spends before its start order. `crank_ticks` is 18, so 20
/// leaves the starter a margin; the prelude is unscored, so it costs the run nothing.
const CRANK_TICKS: u32 = 20;

pub struct Golden {
    pub name: &'static str,
    pub seed: u64,
    pub inputs: Vec<TickInput>,
}

/// Record a trace: drive a real session with a state-aware driver and freeze the inputs it sent.
/// The trace is a fixed script afterwards — replay never looks at the state to decide the input.
fn record(seed: u64, ticks: u32, driver: impl FnMut(&crate::View, u32) -> TickInput) -> Vec<TickInput> {
    record_while(seed, |_, t| t < ticks, driver)
}

/// Record a bài 3 trace up to and including the step that ends the run. The runners' negative
/// control flips a bit in the last record, so a trace that goes on after the end would ignore it.
fn record_to_the_end(seed: u64, driver: impl FnMut(&crate::View, u32) -> TickInput) -> Vec<TickInput> {
    record_while(seed, |v, t| v.phase != crate::Phase::Done && t < 5000, driver)
}

fn record_while(
    seed: u64,
    mut going: impl FnMut(&crate::View, u32) -> bool,
    mut driver: impl FnMut(&crate::View, u32) -> TickInput,
) -> Vec<TickInput> {
    let mut s = Session::new(seed).expect("a known exercise");
    let mut inputs = Vec::new();
    let mut t = 0;
    while going(&s.view(), t) {
        let input = driver(&s.view(), t);
        s.step(input);
        inputs.push(input);
        t += 1;
    }
    inputs
}

/// A clean pass: cold crank, belt on, the order, signal left, gentle clutch, light throttle, the
/// signal switched off once the bumper is inside the 5 m window, then a coast to the end mark. No
/// rule fires. Recorded at metres, so the window is hit exactly. The first `CRANK_TICKS` are the
/// unscored cold start; the 330 scored ticks after the order are the run the trace always had.
pub fn clean_pass() -> Golden {
    let seed = 1;
    let inputs = record(seed, 330 + CRANK_TICKS, |v, t| {
        let signalling = v.front_bumper_m < 5.0;
        let mut flags = BELT;
        if signalling {
            flags |= LEFT;
        }
        if t < CRANK_TICKS {
            // Cold: key held, clutch pressed, neutral, handbrake on. Nothing is scored yet.
            TickInput {
                gear: 0,
                clutch: 255,
                flags: flags | TickInput::FLAG_HANDBRAKE | IGN,
                ..Default::default()
            }
        } else {
            // Đèn xanh: every clock in the run counts from this tick.
            let t = t - CRANK_TICKS;
            flags |= ORDER;
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
        }
    });
    Golden { name: "xuat_phat_clean", seed, inputs }
}

/// A messy run: cold crank, stall, restart, rev past 4000, a signal switched off far too early, a
/// handbrake stall, and a right signal at the end. Chosen so the float paths (clutch slip, rpm,
/// steering) all move, and so a one-bit float difference anywhere turns into a different final
/// hash. The cold crank is unscored; the order is given on the first tick after the engine
/// is seen running, and the script's own clock starts on that tick, so every scored event lands
/// on the same tick as in the recording made before the cold start existed.
pub fn messy_run() -> Golden {
    let seed = 0x0123_4567_89ab_cdef;
    let mut stage = 0u8;
    // Tick of the start order: the tick after the one that saw the engine running.
    let mut order_at: Option<u32> = None;
    let inputs = record(seed, 460 + CRANK_TICKS + 1, |v, t| {
        let t = match order_at {
            None => {
                // Cold: key held, clutch pressed, neutral, nothing scored either way.
                if v.engine_on {
                    order_at = Some(t + 1);
                }
                return TickInput { gear: 0, clutch: 255, flags: IGN, ..Default::default() };
            }
            Some(order_tick) => t - order_tick,
        };
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
        let ordered = |flags: u8| flags | ORDER;
        match stage {
            // Sitting at the line, no belt yet, neutral, engine idling.
            0 => TickInput { gear: 0, clutch: 255, flags: ORDER, ..Default::default() },
            // Drop the clutch in first at idle: dead stall.
            1 => TickInput { gear: 1, clutch: 0, steering: -60, flags: ORDER, ..Default::default() },
            // Restart: clutch in, neutral, key held.
            2 => TickInput { gear: 0, clutch: 255, flags: IGN | ORDER, ..Default::default() },
            // Belt on, signal left, rev it in neutral past 4000.
            3 => TickInput {
                gear: 0,
                clutch: 255,
                throttle: 255,
                flags: ordered(BELT | LEFT),
                ..Default::default()
            },
            // Launch in first with a fast clutch drop and a lot of throttle.
            4 => TickInput {
                gear: 1,
                clutch: 40,
                throttle: 200,
                steering: 300,
                flags: ordered(BELT | LEFT),
                ..Default::default()
            },
            // Signal switched off at 5 m... which is inside the window; stage 6 then
            // re-arms it and kills it early, so the messy trace still shows untimely use.
            5 | 6 => TickInput {
                gear: 1,
                clutch: 20,
                throttle: 150,
                steering: 100,
                flags: ordered(BELT),
                ..Default::default()
            },
            // Handbrake stop in second gear: the second stall.
            7 => TickInput {
                gear: 2,
                clutch: 0,
                brake: 255,
                steering: -200,
                flags: ordered(BELT | TickInput::FLAG_HANDBRAKE),
                ..Default::default()
            },
            // Odd signal use at the end: right instead of left, engine off.
            _ => TickInput {
                gear: 0,
                clutch: 255,
                flags: ordered(BELT | RIGHT),
                ..Default::default()
            },
        }
    });
    Golden { name: "xuat_phat_messy", seed, inputs }
}

/// Bài 3 seeds carry the exercise id in the top byte (see `sim_create`).
const HILL: u64 = 3 << 56;

/// Predicted stopping point of a car braking at about 6.9 m/s² on the slope: where the front
/// bumper will be when it stops, if the brake goes on now.
fn stopping_point(v: &crate::View) -> f64 {
    v.front_bumper_m + v.speed_mps * v.speed_mps / (2.0 * 6.9)
}

/// A clean bài 3: climb to the line, brake to a stop 0.3 m short of it, handbrake on, then the hill
/// start — clutch up to the bite with throttle, handbrake off — and over the line. No rule fires.
/// A little steering keeps the heading and the sin/cos paths moving.
pub fn hill_clean() -> Golden {
    let seed = HILL | 1;
    let mut stopped_at: Option<u32> = None;
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        if v.phase == crate::Phase::Stopped && stopped_at.is_none() {
            stopped_at = Some(t);
        }
        match stopped_at {
            None if t < 20 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            None => {
                braking |= v.front_bumper_m > 0.0 && stopping_point(v) >= 6.0 - 0.3;
                if braking {
                    TickInput { gear: 1, clutch: 255, brake: 255, steering: 300, ..Default::default() }
                } else {
                    TickInput { gear: 1, clutch: 168, throttle: 70, steering: 300, ..Default::default() }
                }
            }
            // Held on the handbrake for two seconds.
            Some(at) if t - at < 120 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            Some(at) => {
                let clutch = 255u32.saturating_sub((t - at - 120) * 2).max(180) as u8;
                let flags = if clutch > 180 { HANDBRAKE } else { 0 };
                TickInput { gear: 1, clutch, throttle: 70, steering: -150, flags, ..Default::default() }
            }
        }
    });
    Golden { name: "dung_khoi_hanh_doc_clean", seed, inputs }
}

/// A messy bài 3: over-revved in neutral, a dead stall and a restart on the approach, a stop 1.2 m
/// short of the line (CHUA_DEN_VACH), then a hill start with the handbrake let go too early, so
/// the car rolls back a little (under 500 mm), grips, and goes over the line. Several deductions,
/// the run still ends by crossing the line, and the trace ends on the step that crosses it.
pub fn hill_messy() -> Golden {
    let seed = HILL | 0x0123_4567_89ab;
    let mut stage = 0u8;
    let mut stopped_at: Option<u32> = None;
    let mut braking = false;
    let inputs = record_to_the_end(seed, |v, t| {
        if v.phase == crate::Phase::Stopped && stopped_at.is_none() {
            stopped_at = Some(t);
        }
        match stage {
            0 if t >= 20 => stage = 1,
            1 if v.rpm > 4300.0 => stage = 2,
            2 if v.rpm < 900.0 => stage = 3,
            3 if !v.engine_on => stage = 4,
            4 if v.engine_on => stage = 5,
            _ => {}
        }
        match stage {
            // Idle, then rev it in neutral past 4000.
            0 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            1 => TickInput { clutch: 255, throttle: 255, flags: HANDBRAKE, ..Default::default() },
            // Back to idle, then first gear with the clutch dropped and no throttle: dead stall.
            2 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
            3 => TickInput { gear: 1, clutch: 0, ..Default::default() },
            // Restart: clutch in, neutral, key held.
            4 => TickInput { clutch: 255, flags: TickInput::FLAG_IGNITION, ..Default::default() },
            _ => match stopped_at {
                None => {
                    braking |= v.front_bumper_m > 0.0 && stopping_point(v) >= 6.0 - 1.2;
                    if braking {
                        TickInput { gear: 1, clutch: 255, brake: 255, steering: -200, ..Default::default() }
                    } else {
                        TickInput { gear: 1, clutch: 150, throttle: 120, steering: 200, ..Default::default() }
                    }
                }
                Some(at) if t - at < 60 => TickInput { clutch: 255, flags: HANDBRAKE, ..Default::default() },
                // The handbrake goes before the clutch bites, so the car rolls back a little.
                Some(at) => {
                    let clutch = 255u32.saturating_sub((t - at - 60) / 2).max(185) as u8;
                    let flags = if clutch > 245 { HANDBRAKE } else { 0 };
                    TickInput { gear: 1, clutch, throttle: 60, flags, ..Default::default() }
                }
            },
        }
    });
    Golden { name: "dung_khoi_hanh_doc_messy", seed, inputs }
}

pub fn all() -> [Golden; 4] {
    [clean_pass(), messy_run(), hill_clean(), hill_messy()]
}

pub fn run(g: &Golden) -> Session {
    let mut s = Session::new(g.seed).expect("a known exercise");
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

    const COMMITTED: [(&str, &str); 4] = [
        ("xuat_phat_clean", include_str!("../../../golden/xuat_phat_clean.hash")),
        ("xuat_phat_messy", include_str!("../../../golden/xuat_phat_messy.hash")),
        ("dung_khoi_hanh_doc_clean", include_str!("../../../golden/dung_khoi_hanh_doc_clean.hash")),
        ("dung_khoi_hanh_doc_messy", include_str!("../../../golden/dung_khoi_hanh_doc_messy.hash")),
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
            let mut s = Session::new(messy_run().seed).unwrap();
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
        let mut s = Session::new(messy_run().seed).unwrap();
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

    /// The bài 3 goldens must be what they claim: the clean one scores nothing and ends over the
    /// line; the messy one takes several deductions, rolls back a little without being charged,
    /// and still ends by crossing the line.
    #[test]
    fn hill_goldens_are_what_they_claim() {
        let clean = run(&hill_clean());
        let v = clean.view();
        assert_eq!((v.fired_ids(), v.score, v.phase), (Vec::<&str>::new(), 100, crate::Phase::Done));

        let mut messy = Session::new(hill_messy().seed).unwrap();
        let mut peak_rollback: f64 = 0.0;
        for &input in &hill_messy().inputs {
            messy.step(input);
            peak_rollback = peak_rollback.max(messy.snapshot()[23]);
        }
        let v = messy.view();
        assert_eq!(v.fired_ids(), vec!["SH.X.RPM", "SH.X.CHET_MAY", "SH.03.CHUA_DEN_VACH"]);
        assert_eq!((v.score, v.disqualified, v.phase), (85, false, crate::Phase::Done));
        assert!(peak_rollback > 0.1 && peak_rollback < 0.5, "a rollback inside 500 mm, got {peak_rollback}");

        // The last record is the step that ends the run: the runners' negative control flips a bit
        // in it, and a step after the end would ignore the flip.
        for g in [hill_clean(), hill_messy()] {
            let mut s = Session::new(g.seed).unwrap();
            for &input in &g.inputs[..g.inputs.len() - 1] {
                s.step(input);
            }
            assert_ne!(s.view().phase, crate::Phase::Done, "{} runs on after the end", g.name);
        }
    }

    /// The snapshot the web reads (`sim_state`) must say what the core actually consumed: feed a
    /// distinctive input, then read the same numbers back. The field order is the list in
    /// `lib.rs`; this indexes it, so a reorder breaks here instead of in TS.
    #[test]
    fn snapshot_reports_what_the_core_consumed() {
        let mut s = Session::new(2026).unwrap();
        for _ in 0..40 {
            s.step(TickInput { clutch: 255, flags: IGN, ..Default::default() });
        }
        let input = TickInput {
            steering: 1200,
            throttle: 70,
            brake: 30,
            clutch: 168,
            gear: 1,
            flags: TickInput::FLAG_BELT | TickInput::FLAG_SIGNAL_LEFT | TickInput::FLAG_START_ORDER,
        };
        s.step(input);

        let snap = s.snapshot();
        let v = s.view();
        assert_eq!(snap.len(), 27, "the snapshot is the 27 documented values");
        assert_eq!(snap[0], f64::from(v.tick));
        assert_eq!(
            snap[1],
            match v.phase {
                crate::Phase::Waiting => 0.0,
                crate::Phase::Launched => 1.0,
                crate::Phase::PastLine => 2.0,
                crate::Phase::Done => 3.0,
                crate::Phase::Stopped => 4.0,
            },
            "the order tick puts the run in Launched"
        );
        assert_eq!(snap[2], f64::from(v.score));
        assert_eq!(snap[3], 0.0, "not disqualified");
        assert_eq!(snap[7], v.speed_mps);
        assert_eq!(snap[8], v.rpm);
        assert_eq!(snap[9], v.front_bumper_m);
        assert_eq!(snap[10], f64::from(u8::from(v.engine_on)));
        assert_eq!(snap[13], 70.0 / 255.0, "throttle as consumed");
        assert_eq!(snap[14], 30.0 / 255.0, "brake as consumed");
        assert_eq!(snap[15], 168.0 / 255.0, "clutch as consumed");
        assert_eq!(snap[16], 1.0, "first gear");
        assert_eq!(snap[17], 0.0, "handbrake released");
        assert_eq!(snap[18], 1.0, "belt on");
        assert_eq!(snap[19], 1.0, "left signal");
        assert!(
            snap[12] > 0.0 && snap[12] < 0.55,
            "steer is the radian value the car moved with, got {}",
            snap[12]
        );
        // First gear, clutch partway out, engine at idle: the driveline drags it down, which is
        // what the audio uses to tell lugging from a free rev.
        assert!(snap[20] > 0.0, "engine load is positive while the clutch drags, got {}", snap[20]);
    }
}
