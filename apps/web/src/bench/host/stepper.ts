// The sim side of the bench, the same code in both hosts: K sessions fed from the golden traces,
// the run.ts time base (fixed 1/60 step, accumulator, CATCHUP), and the hash gate.
//
// The sim is driven ONLY by the golden TickInput bytes. A key marker is a counter that rides along;
// it never reaches a session, so the hash stays the golden one.

import { CATCHUP } from '../../run.ts';
import { DT } from '../../../input/driver.ts';
import type { SimState } from '../../sim/session.ts';
import { openKSim, type KSim } from './sim.ts';
import type { Assets, Consumed, Gate, Probe } from './types.ts';

export interface Advance {
  ticks: number;
  /** Elapsed time of the batch in microseconds, as performance.now() sees it where this runs. */
  simUs: number;
  reopened: boolean;
  consumed: Consumed[];
}

export interface Stepper {
  readonly state: SimState;
  readonly previous: SimState;
  readonly alpha: number;
  readonly seq: number;
  readonly reopens: number;
  /** Trace passes completed inside the run so far: the cells that carry a hash check. */
  readonly passes: number;
  /** Run the ticks due at rAF time `ts` (ms); `markers` are key ids seen since the last call. */
  advance(ts: number, markers: readonly number[]): Advance;
  /** Step the first session alone to the end of the current trace, gate it, and return every gate. */
  finish(): Gate[];
  /**
   * Cost of `ticks` steps, undilated, on a throwaway sim: one session alone, then all K.
   * One tight loop beats a per-frame measurement, which the coarsened clock rounds to nothing.
   */
  probe(ticks: number): Probe;
  readonly gates: readonly Gate[];
}

export function createStepper(assets: Assets, k: number): Stepper {
  const { wasm, traces } = assets;
  const gates: Gate[] = [];
  let traceIdx = 0;
  let cursor = 0;
  let sim: KSim;
  let state: SimState;
  let previous: SimState;
  let alpha = 1;
  let seq = 0;
  let reopens = 0;
  let accumulator = 0;
  /** null until the first frame: the first rAF has no delta to accumulate (run.ts starts at 0). */
  let lastMs: number | null = null;
  let waiting: number[] = [];

  const open = () => {
    sim?.dispose();
    const t = traces[traceIdx];
    const seed = new DataView(t.bytes.buffer, t.bytes.byteOffset, 8).getBigUint64(0, true);
    sim = openKSim(wasm, seed, k);
    cursor = 0;
    state = previous = sim.startState;
  };
  open();

  const ticksIn = () => (traces[traceIdx].bytes.length - 8) / 8;
  const input = () => traces[traceIdx].bytes.subarray(8 + cursor * 8, 16 + cursor * 8);
  const gate = (measured: boolean) => {
    const t = traces[traceIdx];
    const hash = sim.hash();
    gates.push({ trace: t.name, ticks: cursor, hash, golden: t.golden, ok: hash === t.golden, measured });
  };

  /** One tick on every session; returns true when it ended the trace and the sessions were reopened. */
  const tick = (): boolean => {
    previous = state;
    state = sim.step(input());
    cursor += 1;
    seq += 1;
    if (cursor < ticksIn()) return false;
    // This pass ended inside the measured run, so its frames are the cell's samples.
    gate(true);
    traceIdx = (traceIdx + 1) % traces.length;
    open();
    reopens += 1;
    return true;
  };

  return {
    get state() {
      return state;
    },
    get previous() {
      return previous;
    },
    get alpha() {
      return alpha;
    },
    get seq() {
      return seq;
    },
    get reopens() {
      return reopens;
    },
    get gates() {
      return gates;
    },
    get passes() {
      return gates.length;
    },
    advance(ts, markers) {
      const real = lastMs === null ? 0 : (ts - lastMs) / 1000;
      lastMs = ts;
      accumulator += Math.max(0, real);
      for (const id of markers) waiting.push(id);

      const consumed: Consumed[] = [];
      let ticks = 0;
      let reopened = false;
      const t0 = performance.now();
      while (accumulator >= DT && ticks < CATCHUP) {
        if (tick()) reopened = true;
        // A frame can run zero ticks: a marker waits for the first tick that follows it.
        for (const id of waiting) consumed.push({ id, tick: seq });
        waiting = [];
        accumulator -= DT;
        ticks += 1;
      }
      const simUs = (performance.now() - t0) * 1000;
      if (ticks === CATCHUP) accumulator = 0;
      alpha = Math.min(1, accumulator / DT);
      return { ticks, simUs, reopened, consumed };
    },
    probe(n) {
      const t = traces[traceIdx];
      const seed = new DataView(t.bytes.buffer, t.bytes.byteOffset, 8).getBigUint64(0, true);
      const one = openKSim(wasm, seed, 1);
      let start = performance.now();
      for (let i = 0; i < n; i += 1) one.step(t.bytes.subarray(8 + ((cursor + i) % ticksIn()) * 8, 16 + ((cursor + i) % ticksIn()) * 8));
      const oneUsPerStep = ((performance.now() - start) * 1000) / n;
      one.dispose();
      const all = openKSim(wasm, seed, k);
      start = performance.now();
      for (let i = 0; i < n; i += 1) all.step(t.bytes.subarray(8 + ((cursor + i) % ticksIn()) * 8, 16 + ((cursor + i) % ticksIn()) * 8));
      const kUsPerStep = ((performance.now() - start) * 1000) / n;
      all.dispose();
      return { ticks: n, k, oneUsPerStep, kUsPerStep };
    },
    finish() {
      // A cell can end mid-trace: finish that pass with the same golden input and gate it, unmeasured.
      if (cursor > 0) {
        while (cursor < ticksIn()) {
          sim.step(input());
          cursor += 1;
        }
        gate(false);
      }
      return gates.slice();
    },
  };
}
