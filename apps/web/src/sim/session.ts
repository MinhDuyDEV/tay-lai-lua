// The sim seam: a thin wrapper over the exports of sim.wasm. It records every tick it is fed, in the
// golden .trace format, so what the learner did can be replayed through the very same core.

import { STATE_LEN, readState, type SimState } from './contract.ts';
export type { SimState };

/** One drained scoring event, as the core packs it: `[0..4] tick | [4..6] code | [6..8] points`. */
export interface SimEvent {
  tick: number;
  code: number;
  points: number;
}

export interface StepResult {
  state: SimState;
  /** Rules that fired on this tick, in the order the core charged them. */
  events: SimEvent[];
}

export interface Session {
  /** The core's state now: before any tick it is the car parked and waiting for the order. */
  readonly state: SimState;
  /** Advance exactly one 1/60 s tick with these 8 TickInput bytes. */
  step(input: Uint8Array): StepResult;
  /** The core's state hash: 16 lowercase hex digits. */
  hash(): string;
  /** The recorded run: 8-byte seed then one 8-byte record per tick fed, exactly what was fed. */
  trace(): Uint8Array;
  dispose(): void;
}

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

/** What `sim_create` takes: the exercise id in bits 56..63, the seed below it. */
export const seedWord = (exerciseId: number, seed = 1n): bigint => (BigInt(exerciseId) << 56n) | seed;
const EVENTS_PER_DRAIN = 32;

/** Open a session from the shipped `sim.wasm` bytes. Throws if the module is not the core we expect. */
export function openSession(wasmBytes: ArrayBuffer, seed: bigint): Session {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
  const exports = instance.exports as unknown as Exports;
  if (typeof exports.sim_state !== 'function') throw new Error('sim.wasm has no sim_state: wrong build');
  return wasmSession(exports, seed);
}

function wasmSession(exports: Exports, seed: bigint): Session {
  const inPtr = exports.sim_alloc(8);
  const evPtr = exports.sim_alloc(EVENTS_PER_DRAIN * 8);
  const statePtr = exports.sim_alloc(STATE_LEN * 8);
  const handle = exports.sim_create(seed);
  // Handle 0 is the core refusing the word: an exercise id it does not know.
  if (handle === 0) throw new Error(`sim.wasm refused seed word ${seed.toString(16)}: unknown exercise id`);
  // Fresh views after every call: any allocation can grow memory and detach older buffers.
  const heap = () => new Uint8Array(exports.memory.buffer);
  const records: Uint8Array[] = [];
  const drain = (): SimEvent[] => {
    const n = exports.sim_drain_events(handle, evPtr, EVENTS_PER_DRAIN);
    const view = new DataView(exports.memory.buffer);
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i += 1) {
      const at = evPtr + i * 8;
      out.push({ tick: view.getUint32(at, true), code: view.getUint16(at + 4, true), points: view.getInt16(at + 6, true) });
    }
    return out;
  };

  const read = (): SimState => {
    const count = exports.sim_state(handle, statePtr, STATE_LEN);
    return readState(new Float64Array(exports.memory.buffer, statePtr, STATE_LEN), count);
  };
  let state = read();

  return {
    get state() {
      return state;
    },
    step(input) {
      const copy = input.slice();
      records.push(copy);
      heap().set(copy, inPtr);
      exports.sim_step(handle, inPtr);
      // Drain every tick, like the runners do, so a burst of events cannot overflow the buffer.
      const events = drain();
      state = read();
      return { state, events };
    },
    hash() {
      return BigInt.asUintN(64, exports.sim_hash(handle)).toString(16).padStart(16, '0');
    },
    trace() {
      const out = new Uint8Array(8 + records.length * 8);
      new DataView(out.buffer).setBigUint64(0, seed, true);
      records.forEach((r, i) => out.set(r.subarray(0, 8), 8 + i * 8));
      return out;
    },
    dispose() {
      exports.sim_destroy(handle);
      exports.sim_free(inPtr, 8);
      exports.sim_free(evPtr, EVENTS_PER_DRAIN * 8);
      exports.sim_free(statePtr, STATE_LEN * 8);
    },
  };
}
