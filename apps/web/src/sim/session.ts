// The sim seam. One interface, two implementations: the real `sim.wasm` and a fake that stands in
// until peer-sim's `sim_state` lands. Which one is running is never a secret — the page publishes
// it as `data-sim`, and the end-to-end test refuses anything but `wasm`.

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
  /** `wasm` when the real core answered, `fake` only while `sim_state` is missing. */
  readonly kind: 'wasm' | 'fake';
  /** Advance exactly one 1/60 s tick with these 8 TickInput bytes. */
  step(input: Uint8Array): StepResult;
  /** The core's state hash: 16 lowercase hex digits. */
  hash(): string;
  /** The recorded run: 8-byte seed then one 8-byte record per tick fed, exactly what was fed. */
  trace(): Uint8Array;
  /** True while the core is still cranking the starter. */
  readonly ordered: boolean;
  markOrdered(): void;
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
  sim_state?(handle: number, outPtr: number, cap: number): number;
}

export const SEED = 1n;
const EVENTS_PER_DRAIN = 32;

/**
 * Open a session from the shipped `sim.wasm` bytes. Throws if the module is unusable; falls back to
 * the fake only when `sim_state` is absent, which is the one difference the fake can stand in for.
 */
export function openSession(wasmBytes: ArrayBuffer): Session {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
  const exports = instance.exports as unknown as Exports;
  if (typeof exports.sim_state !== 'function') return fakeSession('sim_state missing from sim.wasm');
  return wasmSession(exports);
}

function wasmSession(exports: Exports): Session {
  const simState = exports.sim_state!;
  const inPtr = exports.sim_alloc(8);
  const evPtr = exports.sim_alloc(EVENTS_PER_DRAIN * 8);
  const statePtr = exports.sim_alloc(STATE_LEN * 8);
  const handle = exports.sim_create(SEED);
  // Fresh views after every call: any allocation can grow memory and detach older buffers.
  const heap = () => new Uint8Array(exports.memory.buffer);
  const records: Uint8Array[] = [];
  let ordered = false;

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

  return {
    kind: 'wasm',
    get ordered() {
      return ordered;
    },
    markOrdered() {
      ordered = true;
    },
    step(input) {
      const copy = input.slice();
      records.push(copy);
      heap().set(copy, inPtr);
      exports.sim_step(handle, inPtr);
      // Drain every tick, like the runners do, so a burst of events cannot overflow the buffer.
      const events = drain();
      const count = simState(handle, statePtr, STATE_LEN);
      const block = new Float64Array(exports.memory.buffer, statePtr, STATE_LEN);
      return { state: readState(block, count, ordered), events };
    },
    hash() {
      return BigInt.asUintN(64, exports.sim_hash(handle)).toString(16).padStart(16, '0');
    },
    trace() {
      const out = new Uint8Array(8 + records.length * 8);
      new DataView(out.buffer).setBigUint64(0, SEED, true);
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

/**
 * The stand-in used until `sim_state` exists. It moves the car with the same clutch/gear shape the
 * real core has, so the scene, the camera, the HUD and the step checklist can all be built and
 * looked at. It scores NOTHING: an event set here would be an invented legal reading, and the
 * end-to-end test treats `kind: 'fake'` as a failure.
 */
export function createFakeSession(reason: string): Session {
  return fakeSession(reason);
}

function fakeSession(reason: string): Session {
  void reason;
  const records: Uint8Array[] = [];
  let tick = 0;
  let ordered = false;
  let x = -1 - 2.1;
  let speed = 0;
  let rpm = 850;
  let engineOn = true;
  let cranking = false;
  let gear = 0;
  let belt = false;
  let signal: SimState['signal'] = 'off';
  let handbrake = true;
  let clutch = 1;
  let throttle = 0;

  return {
    kind: 'fake',
    get ordered() {
      return ordered;
    },
    markOrdered() {
      ordered = true;
    },
    step(input) {
      records.push(input.slice());
      tick += 1;
      const flags = input[6];
      belt = (flags & 1) !== 0;
      signal = (flags & 2) !== 0 ? 'left' : (flags & 16) !== 0 ? 'right' : 'off';
      handbrake = (flags & 8) !== 0;
      const ignition = (flags & 32) !== 0;
      const wire = new DataView(input.buffer, input.byteOffset, 8);
      gear = wire.getInt8(5);
      const steerRad = (wire.getInt16(0, true) / 32767) * 0.55;
      clutch = input[4] / 255;
      throttle = input[2] / 255;

      if (!engineOn && ignition) cranking = true;
      if (cranking && input[4] / 255 > 0.9) {
        cranking = false;
        engineOn = true;
        rpm = 850;
      }
      // A crude mirror of the real car: revs follow throttle, the clutch bites and pulls, the
      // handbrake holds. Enough to see the scene move; not a simulation to score on.
      rpm = Math.max(600, Math.min(6000, rpm + (throttle * 3000 - (rpm - 850) * 0.5) * (1 / 60)));
      const drive = gear !== 0 && clutch < 0.7 && !handbrake ? (0.7 - clutch) * 6 : 0;
      speed = Math.max(0, speed + (drive - 0.6 * speed - (input[3] / 255) * 4) * (1 / 60));
      if (handbrake && speed < 0.1) speed = 0;
      x += speed * (1 / 60);
      if (!engineOn) rpm = 0;

      const frontBumperM = x + 2.1;
      const phase: SimState['phase'] = !ordered
        ? 'waiting'
        : frontBumperM >= 10
          ? 'done'
          : frontBumperM >= 0
            ? 'past-line'
            : 'launched';

      return {
        events: [],
        state: {
          tick,
          phase,
          score: 100,
          disqualified: false,
          carX: x,
          carY: 0,
          heading: 0,
          speedMps: speed,
          rpm,
          frontBumperM,
          engineOn,
          cranking,
          steerRad,
          throttle,
          brake: input[3] / 255,
          clutch,
          gear,
          handbrake,
          belt,
          signal,
          engineLoad: throttle,
        },
      };
    },
    hash() {
      // Stable but meaningless: a fake run must never be mistaken for a verified one.
      return '000000000000f0f0';
    },
    trace() {
      const out = new Uint8Array(8 + records.length * 8);
      new DataView(out.buffer).setBigUint64(0, SEED, true);
      records.forEach((r, i) => out.set(r.subarray(0, 8), 8 + i * 8));
      return out;
    },
    dispose() {},
  };
}
