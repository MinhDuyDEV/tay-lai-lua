// The one place the sim core runs in the bench: the main thread, inside the rAF callback, the same
// shape as run.ts. (The Worker host is gone with the verdict that main stays; git history keeps it
// for the day the core outgrows the break-even.)

import { createStepper } from './stepper.ts';
import type { Assets, BenchRun, FrameInfo, Gate, Probe } from './types.ts';

export interface Host {
  readonly run: BenchRun;
  readonly ready: Promise<void>;
  /** Trace passes completed inside the run so far. */
  readonly passes: number;
  /** Live wasm instances holding the sim sessions (the bench keeps K sessions on one, see sim.ts). */
  readonly instances: number;
  /** Frames that hit CATCHUP and dropped time: a starved sim cannot win. */
  readonly clips: number;
  /** Called once per rAF with the rAF timestamp. */
  frame(ts: number): FrameInfo;
  /** Undilated step cost in one tight loop; throwaway sessions, so no hash is affected. */
  probe(ticks: number): Promise<Probe>;
  /** After the last frame: finish the first session's trace unmeasured and return every gate. */
  finish(): Promise<Gate[]>;
  dispose(): void;
}

export function createHost(assets: Assets, k: number): Host {
  const stepper = createStepper(assets, k);
  const run: BenchRun = {
    get state() {
      return stepper.state;
    },
    get previous() {
      return stepper.previous;
    },
    get alpha() {
      return stepper.alpha;
    },
    get tick() {
      return stepper.seq;
    },
    get reopens() {
      return stepper.reopens;
    },
  };
  return {
    run,
    get passes() {
      return stepper.passes;
    },
    get instances() {
      return stepper.instances;
    },
    get clips() {
      return stepper.clips;
    },
    ready: Promise.resolve(),
    frame: (ts) => stepper.advance(ts),
    probe: async (ticks) => stepper.probe(ticks),
    finish: async () => stepper.finish(),
    dispose() {},
  };
}
