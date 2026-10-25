//! Canonical state hash (FNV-1a 64).
//!
//! Every field goes in as little-endian bytes. Every `f64` goes in as its bits, with NaN
//! canonicalised and `-0.0` folded to `0.0`, so a hash difference always means a real
//! difference in the simulation, never a difference in bit-pattern trivia.

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

pub struct Hash(u64);

impl Hash {
    pub fn new() -> Self {
        Self(OFFSET)
    }

    pub fn raw(&self) -> u64 {
        self.0
    }

    pub fn u8(&mut self, b: u8) {
        self.0 = (self.0 ^ u64::from(b)).wrapping_mul(PRIME);
    }

    pub fn bool(&mut self, b: bool) {
        self.u8(u8::from(b));
    }

    pub fn u16(&mut self, x: u16) {
        for b in x.to_le_bytes() {
            self.u8(b);
        }
    }

    pub fn i16(&mut self, x: i16) {
        self.u16(x as u16);
    }

    pub fn u32(&mut self, x: u32) {
        for b in x.to_le_bytes() {
            self.u8(b);
        }
    }

    pub fn i32(&mut self, x: i32) {
        self.u32(x as u32);
    }

    pub fn u64(&mut self, x: u64) {
        for b in x.to_le_bytes() {
            self.u8(b);
        }
    }

    pub fn f64(&mut self, x: f64) {
        let x = if x.is_nan() {
            f64::NAN
        } else if x == 0.0 {
            0.0
        } else {
            x
        };
        self.u64(x.to_bits());
    }

    pub fn opt_f64(&mut self, x: Option<f64>) {
        match x {
            Some(v) => {
                self.u8(1);
                self.f64(v);
            }
            None => self.u8(0),
        }
    }
}
