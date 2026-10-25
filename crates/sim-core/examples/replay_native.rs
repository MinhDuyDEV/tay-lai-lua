//! Replay a `golden/*.trace` file natively and print its hash and events, so the same trace can be
//! checked against `build/sim.wasm` on any host.
//!
//!     cargo run -p sim-core --example replay_native -- golden/xuat_phat_clean.trace
fn main() {
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).expect("read trace");
        let seed = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        let mut s = sim_core::Session::new(seed).expect("a known exercise");
        for rec in bytes[8..].chunks_exact(8) {
            let b: [u8; 8] = rec.try_into().unwrap();
            s.step(sim_core::TickInput::from_wire(&b));
        }
        let events: Vec<String> = s
            .drain_events()
            .iter()
            .map(|e| format!("[{},{},{}]", e.tick, e.code, e.points))
            .collect();
        println!("{} {:016x} [{}]", path, s.hash(), events.join(","));
    }
}
