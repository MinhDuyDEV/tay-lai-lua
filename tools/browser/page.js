// Page-side half of the golden runner: runs one trace in whatever engine the page is in.
// runner.mjs injects this file with page.addScriptTag({ path }), so no server or bundler
// is involved and the engine runs the real .wasm bytes.

// Returns the final state hash of `traceB64` as 16 lowercase hex digits.
// `flip` mutates a copy of one input byte (negative control: the hash must differ).
window.runGolden = async ({ wasmB64, traceB64, flip }) => {
  const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const trace = bytes(traceB64);
  if (flip) {
    // Flip the sign bit of the steering in the *last* record, in memory only.
    // trace = 8-byte seed, then 8-byte TickInput records; steering is [0..2] i16.
    // The last record is the input the final sim_step consumes, so a sim that reads its input
    // must carry it into the state that gets hashed. An early record is not equivalent: a trace
    // can open on frames where the controls do nothing (parked, clutch in), and flipping there
    // would fail a correct simulation.
    trace[trace.length - 8 + 1] ^= 0x80;
  }

  const { instance } = await WebAssembly.instantiate(bytes(wasmB64).buffer, {});
  const sim = instance.exports;
  // Fresh views: any allocation may grow memory and detach older buffers.
  const heap = () => new Uint8Array(sim.memory.buffer);

  const seed = new DataView(trace.buffer).getBigUint64(0, true);
  const inPtr = sim.sim_alloc(8);
  const evPtr = sim.sim_alloc(64 * 8);
  const handle = sim.sim_create(seed);

  for (let o = 8; o + 8 <= trace.length; o += 8) {
    heap().set(trace.subarray(o, o + 8), inPtr);
    sim.sim_step(handle, inPtr);
    sim.sim_drain_events(handle, evPtr, 64); // like the web worker: drain each step
  }

  const hash = BigInt.asUintN(64, sim.sim_hash(handle)).toString(16).padStart(16, '0');
  sim.sim_destroy(handle);
  sim.sim_free(inPtr, 8);
  sim.sim_free(evPtr, 64 * 8);
  return hash;
};
