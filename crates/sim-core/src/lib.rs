//! sim-core: deterministic driving-exam simulation core.
//!
//! `lib.rs` is the pure core (no I/O, no clock). `abi` is the only way the outside world
//! reaches it: a handful of `extern "C"` exports and no wasm imports.

mod abi;

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

pub struct Session {
    tick: u32,
    seed: u64,
    acc: u64,
    events: Vec<Event>,
}

impl Session {
    pub fn new(seed: u64) -> Self {
        Self { tick: 0, seed, acc: 0xcbf2_9ce4_8422_2325 ^ seed, events: Vec::new() }
    }

    pub fn step(&mut self, input: TickInput) {
        self.tick += 1;
        for b in input.steering.to_le_bytes().into_iter().chain([
            input.throttle,
            input.brake,
            input.clutch,
            input.gear as u8,
            input.flags,
        ]) {
            self.acc = (self.acc ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
        }
        let _ = self.seed;
    }

    pub fn drain_events(&mut self) -> Vec<Event> {
        core::mem::take(&mut self.events)
    }

    pub fn hash(&self) -> u64 {
        self.acc ^ u64::from(self.tick)
    }
}
