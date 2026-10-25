// Shared shapes of the sim-core placement bench: what the scene reads, what the Worker is sent, and
// what one frame of either host reports back.

import type { SimState } from '../../sim/session.ts';

/** What the scene (apps/web/src/bench/scene) may read, in `useFrame` only. */
export interface BenchRun {
  readonly state: SimState;
  readonly previous: SimState;
  /** 0..1, how far the picture sits between `previous` and `state`. */
  readonly alpha: number;
  /** Count of first-session ticks so far; keeps rising across a trace reopen (state.tick does not). */
  readonly tick: number;
  /** Bumps each time the trace restarts; the host sets previous = state then. */
  readonly reopens: number;
}

export interface TraceAsset {
  name: string;
  /** 8-byte seed word, then 8 bytes of TickInput per tick: the golden .trace format. */
  bytes: Uint8Array;
  /** The expected final hash, from the .hash next to the trace. */
  golden: string;
}

export interface Assets {
  wasm: ArrayBuffer;
  traces: TraceAsset[];
}

/**
 * One whole pass over a trace by the FIRST session, checked against the golden hash. The last pass
 * of a cell is completed after the final frame (unmeasured), so its frames never enter the samples;
 * the pass itself is a real pass over the golden input and its hash is checked the same way.
 */
export interface Gate {
  trace: string;
  ticks: number;
  /** Session 0's hash. */
  hash: string;
  /** How many of the K sessions hashed to `hash` (all of them, when the trace really ran on all K). */
  allHashesEqual: number;
  k: number;
  golden: string;
  ok: boolean;
  /** True when the pass ended inside the measured run, false for the one finished after the last frame. */
  measured: boolean;
}

/** A key marker consumed by a tick: `tick` is the sequence number after that tick ran. */
export interface Consumed {
  id: number;
  tick: number;
}

/** What one frame of a host did on the sim side. */
export interface FrameInfo {
  ticks: number;
  /** The frame hit CATCHUP: time was dropped, so the sim starved (a starved cell cannot decide). */
  clip: boolean;
  /** Time spent in the sim batch (all K sessions), microseconds, measured where the sim runs. */
  simUs: number;
  /** A trace ended and the sessions were reopened during this batch. */
  reopened: boolean;
  consumed: Consumed[];
  /** Worker host only: a request was still in flight, so none was sent this frame. */
  busy: boolean;
}

export type ToWorker =
  | { type: 'init'; assets: Assets; k: number; slow: number }
  | { type: 'frame'; ts: number; markers: number[] }
  | { type: 'finish' }
  | { type: 'spin'; iters: number; pad: boolean; slow: number }
  | { type: 'probe'; ticks: number };

/** Step cost measured in one tight loop, undilated, on a throwaway set of sessions. */
export interface Probe {
  ticks: number;
  k: number;
  /** Microseconds per tick for the first session alone, and for all K sessions together. */
  oneUsPerStep: number;
  kUsPerStep: number;
  /** All K, with the Worker's dilation applied: what a throttled Worker spends per tick. */
  kDilatedUsPerStep: number;
}

export interface FrameReply {
  type: 'frame';
  state: SimState;
  clip: boolean;
  previous: SimState;
  alpha: number;
  seq: number;
  reopens: number;
  ticks: number;
  simUs: number;
  reopened: boolean;
  consumed: Consumed[];
}

export type FromWorker =
  | { type: 'ready'; state: SimState }
  | FrameReply
  | { type: 'finished'; gates: Gate[] }
  | { type: 'spun' }
  | { type: 'probed'; probe: Probe };
