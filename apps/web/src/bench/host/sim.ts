// K sim sessions over ONE WebAssembly.Instance, for the bench only.
//
// `session.ts` opens a fresh instance per session, which is right for the app (one session per run)
// and impossible here: Chromium allows about 125 live instances per renderer, so K=400 could not
// start. The core itself keeps every session on the wasm heap behind a handle (`sim_create` returns
// one per call), so K handles on one instance give the same K ticks of sim work per frame — the same
// step, event drain and state read the app's `Session.step` does — with no instance ceiling.
//
// The layout of the state block still comes from contract.ts, so a core that changes it fails here
// exactly as it fails in the app.

import { STATE_LEN, readState, type SimState } from '../../sim/contract.ts';

interface Exports {
  memory: WebAssembly.Memory;
  sim_alloc(len: number): number;
  sim_free(ptr: number, len: number): void;
  sim_create(seed: bigint): number;
  sim_destroy(handle: number): void;
  sim_step(handle: number, inputPtr: number): void;
  sim_hash(handle: number): bigint;
  sim_drain_events(handle: number, outPtr: number, cap: number): number;
  sim_state(handle: number, outPtr: number, cap: number): number;
}

const EVENTS_PER_DRAIN = 32;

export interface KSim {
  readonly k: number;
  /** Session 0's state before any tick: the car parked and waiting for the order. */
  readonly startState: SimState;
  /** One tick on every session, drained and read like the app does; returns session 0's state. */
  step(input: Uint8Array): SimState;
  /** Session 0's hash: 16 lowercase hex digits, the same format as `Session.hash`. */
  hash(): string;
  dispose(): void;
}

export function openKSim(wasmBytes: ArrayBuffer, seed: bigint, k: number): KSim {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
  const x = instance.exports as unknown as Exports;
  if (typeof x.sim_state !== 'function') throw new Error('sim.wasm has no sim_state: wrong build');
  const inPtr = x.sim_alloc(8);
  const evPtr = x.sim_alloc(EVENTS_PER_DRAIN * 8);
  const statePtr = x.sim_alloc(STATE_LEN * 8);
  const handles = Array.from({ length: k }, () => x.sim_create(seed));
  if (handles.some((h) => h === 0)) {
    throw new Error(`sim.wasm refused seed word ${seed.toString(16)}: unknown exercise id`);
  }
  // Fresh views after any call: an allocation can grow memory and detach older buffers.
  const heap = () => new Uint8Array(x.memory.buffer);
  const startState = readState(new Float64Array(x.memory.buffer, statePtr, STATE_LEN), x.sim_state(handles[0], statePtr, STATE_LEN));
  let state = startState;

  return {
    k,
    startState,
    step(input) {
      heap().set(input.subarray(0, 8), inPtr);
      for (const h of handles) {
        x.sim_step(h, inPtr);
        // Drained every tick, as the app does, so a burst of events cannot overflow the buffer.
        x.sim_drain_events(h, evPtr, EVENTS_PER_DRAIN);
      }
      const count = x.sim_state(handles[0], statePtr, STATE_LEN);
      state = readState(new Float64Array(x.memory.buffer, statePtr, STATE_LEN), count);
      return state;
    },
    hash() {
      return BigInt.asUintN(64, x.sim_hash(handles[0])).toString(16).padStart(16, '0');
    },
    dispose() {
      for (const h of handles) x.sim_destroy(h);
      x.sim_free(inPtr, 8);
      x.sim_free(evPtr, EVENTS_PER_DRAIN * 8);
      x.sim_free(statePtr, STATE_LEN * 8);
    },
  };
}
