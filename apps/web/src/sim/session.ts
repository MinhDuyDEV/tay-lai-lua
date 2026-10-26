// The sim seam: a thin wrapper over the exports of sim.wasm. It records every tick it is fed, in the
// golden .trace format, so what the learner did can be replayed through the very same core.

import { STATE_LEN, readState, type SimState } from './contract.ts';
export type { SimState };
export { zoneName, ZONE_NAMES, type ZoneName, type ZoneCode } from './contract.ts';
export { lightName, LIGHT_NAMES, type LightName, type LightColour } from './contract.ts';

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

/** One painted thing on the course, as `sim_course` writes it. */
export interface CourseRecord {
  /** 1 limit line, 2 curb band, 3 vệt line, 4 gate, 5 lane centreline, 6 transverse mark,
   * 7 signal head. */
  kind: CourseKind;
  /** Which line within its kind; for a gate, 1 entry, 2 exit, 3 vệt start, 4 vệt end. */
  lineId: number;
  /** The polyline, metres, in the same frame as `SimState.carX`/`carY`. */
  points: readonly (readonly [number, number])[];
}

export type CourseKind = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** What a kind 6 transverse marking is, by its `line_id` (crates/sim-core/src/abi.rs). */
export type MarkKind = 'stop' | 'finish' | 'crosswalk' | 'rail';
const MARK_KINDS: readonly MarkKind[] = ['stop', 'finish', 'crosswalk', 'rail'];
export const markKind = (lineId: number): MarkKind => {
  const kind = MARK_KINDS[lineId - 1];
  if (kind === undefined) throw new Error(`sim_course mark line_id ${lineId} is not in the contract`);
  return kind;
};

export interface Session {
  /** The core's state now: before any tick it is the car parked and waiting for the order. */
  readonly state: SimState;
  /**
   * The figure this exercise is drawn on, read once from the core so the picture and the scoring
   * share one set of polylines. Empty for bài 1 and bài 3.
   */
  readonly course: readonly CourseRecord[];
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
  sim_course(handle: number, outPtr: number, cap: number): number;
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

/**
 * Read the whole figure in one call. `sim_course` writes nothing and returns the count it needs when
 * the capacity is short, so a first call with no room sizes the buffer.
 */
function readCourse(exports: Exports, handle: number): readonly CourseRecord[] {
  if (typeof exports.sim_course !== 'function') return [];
  const needed = exports.sim_course(handle, 0, 0);
  if (needed === 0) return [];
  const ptr = exports.sim_alloc(needed * 8);
  try {
    const count = exports.sim_course(handle, ptr, needed);
    if (count !== needed) throw new Error(`sim_course asked for ${needed} values but wrote ${count}`);
    const block = new Float64Array(exports.memory.buffer, ptr, count);
    return parseCourse(block, count);
  } finally {
    exports.sim_free(ptr, needed * 8);
  }
}

/**
 * `[kind, line_id, npoints, x0, y0, x1, y1, ...]` records, in order. A record that runs past the
 * block, or a kind outside 1..7, is a contract drift rather than a value to draw.
 */
export function parseCourse(block: Float64Array, count: number): readonly CourseRecord[] {
  const out: CourseRecord[] = [];
  let i = 0;
  while (i < count) {
    if (i + 3 > count) throw new Error(`sim_course record at ${i} runs past ${count} values`);
    const kind = block[i];
    if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4 && kind !== 5 && kind !== 6 && kind !== 7) {
      throw new Error(`sim_course kind ${kind} at ${i} is not in the contract`);
    }
    // A signal head is a single point, so its record is the one the point count is not used for.
    if (kind === 7 && block[i + 2] !== 1) {
      throw new Error(`sim_course signal-head record at ${i} has ${block[i + 2]} points, not 1`);
    }
    const npoints = block[i + 2];
    const end = i + 3 + npoints * 2;
    if (end > count) throw new Error(`sim_course record at ${i} wants ${end} values, block has ${count}`);
    const points: [number, number][] = [];
    for (let p = 0; p < npoints; p += 1) points.push([block[i + 3 + p * 2], block[i + 4 + p * 2]]);
    out.push({ kind, lineId: block[i + 1], points });
    i = end;
  }
  return out;
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
  const course = readCourse(exports, handle);
  let state = read();

  return {
    get state() {
      return state;
    },
    course,
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
