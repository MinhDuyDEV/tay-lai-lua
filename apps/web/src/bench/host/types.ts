// Shared shapes of the frame-budget bench: what the scene reads, what a cell loads, and what one
// frame reports back. The bench runs the sim on the main thread only, where the app runs it today.

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

/** What one frame did on the sim side. */
export interface FrameInfo {
  ticks: number;
  /** The frame hit CATCHUP: time was dropped, so the sim starved (a starved cell cannot decide). */
  clip: boolean;
  /** Time spent in the sim batch (all K sessions), microseconds, measured where the sim runs. */
  simUs: number;
  /** A trace ended and the sessions were reopened during this batch. */
  reopened: boolean;
}

/** Step cost measured in one tight loop on a throwaway sim, so no hash is affected. */
export interface Probe {
  ticks: number;
  k: number;
  /** Microseconds per tick for the first session alone, and for all K sessions together. */
  oneUsPerStep: number;
  kUsPerStep: number;
}
