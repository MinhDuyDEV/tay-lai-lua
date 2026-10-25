//! Writes `golden/*.trace` and `golden/*.hash` at the repo root.
//!
//! Run from the repo root after an intentional change to the simulation:
//!     cargo run -p sim-core --example gen_golden
//!
//! The traces are committed; the tests in `src/golden.rs` fail if either file drifts, so this
//! example is the only way they change.

fn main() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    std::fs::create_dir_all(format!("{root}/golden")).expect("create golden/");
    for g in sim_core::golden::all() {
        let trace = format!("{root}/golden/{}.trace", g.name);
        std::fs::write(&trace, sim_core::golden::encode(&g)).expect("write trace");
        let hash = format!("{root}/golden/{}.hash", g.name);
        std::fs::write(&hash, sim_core::golden::hash_line(&sim_core::golden::run(&g)))
            .expect("write hash");
        println!("{}: {} inputs -> {}", g.name, g.inputs.len(), hash);
    }
}
