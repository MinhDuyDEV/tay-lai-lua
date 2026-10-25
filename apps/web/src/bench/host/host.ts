// The two places the sim core can run. Same stepper, same fixed-step loop; only where it runs differs.
//
//  main:   the stepper is called inside the rAF callback, like run.ts.
//  worker: each rAF posts the time and the key markers to a dedicated Worker running the same
//          sim.wasm; the Worker runs the due fixed steps and replies with the last two states; the
//          render uses the latest reply. At most one request is in flight: an overloaded Worker
//          shows up as `busy` frames instead of an ever-growing queue.

import { createStepper } from './stepper.ts';
import type { SimState } from '../../sim/session.ts';
import type { Assets, BenchRun, Consumed, FrameInfo, FromWorker, Gate, Probe, ToWorker } from './types.ts';

export interface Host {
  readonly run: BenchRun;
  readonly ready: Promise<void>;
  /** Trace passes completed inside the run so far. */
  readonly passes: number;
  /** Live wasm instances holding the sim sessions (the bench keeps K sessions on one, see sim.ts). */
  readonly instances: number;
  /** A key was seen: the next tick that runs consumes it. Never reaches the sim input. */
  mark(id: number): void;
  /** Called once per rAF with the rAF timestamp. */
  frame(ts: number): FrameInfo;
  /** Undilated step cost in one tight loop; throwaway sessions, so no hash is affected. */
  probe(ticks: number): Promise<Probe>;
  /** After the last frame: finish the first session's trace unmeasured and return every gate. */
  finish(): Promise<Gate[]>;
  dispose(): void;
}

export function createMainHost(assets: Assets, k: number): Host {
  const stepper = createStepper(assets, k);
  let markers: number[] = [];
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
    ready: Promise.resolve(),
    mark: (id) => markers.push(id),
    frame(ts) {
      const taken = markers;
      markers = [];
      return { ...stepper.advance(ts, taken), busy: false };
    },
    probe: async (ticks) => stepper.probe(ticks),
    finish: async () => stepper.finish(),
    dispose() {},
  };
}

export function createWorkerHost(assets: Assets, k: number, slow: number): Host {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const send = (message: ToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);

  const s = { state: undefined as unknown as SimState, previous: undefined as unknown as SimState, alpha: 1, tick: 0, reopens: 0 };
  let pending = false;
  let passes = 0;
  let markers: number[] = [];
  let total = { ticks: 0, simUs: 0, reopened: false, consumed: [] as Consumed[] };
  let onReady: () => void;
  let onFinished: (gates: Gate[]) => void;
  let onProbed: (probe: Probe) => void;
  const ready = new Promise<void>((resolve) => (onReady = resolve));

  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const m = event.data;
    if (m.type === 'ready') {
      s.state = s.previous = m.state;
      onReady();
    } else if (m.type === 'frame') {
      pending = false;
      s.state = m.state;
      s.previous = m.previous;
      s.alpha = m.alpha;
      s.tick = m.seq;
      s.reopens = m.reopens;
      total.ticks += m.ticks;
      total.simUs += m.simUs;
      total.reopened ||= m.reopened;
      if (m.reopened) passes += 1;
      total.consumed.push(...m.consumed);
    } else if (m.type === 'finished') {
      onFinished(m.gates);
    } else if (m.type === 'probed') {
      onProbed(m.probe);
    }
  });

  // The Worker gets its own copy of the bytes (transferred), so the main host's assets stay usable.
  // Its opening state comes with `ready`; that is all the scene needs before the first frame.
  const wasm = assets.wasm.slice(0);
  const traces = assets.traces.map((t) => ({ ...t, bytes: t.bytes.slice() }));
  send({ type: 'init', assets: { wasm, traces }, k, slow }, [wasm, ...traces.map((t) => t.bytes.buffer)]);

  return {
    run: s as BenchRun,
    get passes() {
      return passes;
    },
    instances: 1,
    ready,
    mark: (id) => markers.push(id),
    frame(ts) {
      const out: FrameInfo = { ...total, busy: pending };
      total = { ticks: 0, simUs: 0, reopened: false, consumed: [] };
      if (!pending) {
        pending = true;
        send({ type: 'frame', ts, markers });
        markers = [];
      }
      return out;
    },
    probe: (ticks) =>
      new Promise<Probe>((resolve) => {
        onProbed = resolve;
        send({ type: 'probe', ticks });
      }),
    finish: () =>
      new Promise<Gate[]>((resolve) => {
        onFinished = resolve;
        send({ type: 'finish' });
      }),
    dispose: () => worker.terminate(),
  };
}
