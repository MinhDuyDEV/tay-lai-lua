// The Worker host's far side: the same stepper as the main host, behind postMessage.
//
// Why `slow` exists (TEMPORARY, until a browser can throttle a Worker): CDP's CPU throttle reaches
// the page's main thread but not a dedicated Worker (measured; attaching to the worker target
// answers "Operation is only supported for pages"). So that "Worker at 4x" is not a full-speed
// Worker, each sim batch is dilated: after it, the thread busy-waits until the batch has taken
// `slow` times what it measured. That slows the sim only, nothing else in the Worker.

import { spin } from './spin.ts';
import { createStepper, type Stepper } from './stepper.ts';
import type { FromWorker, FrameReply, ToWorker } from './types.ts';

const post = (message: FromWorker) => (self as unknown as Worker).postMessage(message);

/** Spin until `slow` times the time since `start` has passed; returns the dilated elapsed ms. */
function dilate(start: number, slow: number): number {
  const target = (performance.now() - start) * slow;
  if (slow > 1) while (performance.now() - start < target);
  return target;
}

let stepper: Stepper;
let slow = 1;

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  if (m.type === 'init') {
    slow = m.slow;
    stepper = createStepper(m.assets, m.k, m.slow);
    post({ type: 'ready', state: stepper.state });
  } else if (m.type === 'frame') {
    const start = performance.now();
    const a = stepper.advance(m.ts, m.markers);
    // State read happens inside advance (session.step); only the batch is dilated.
    const simUs = a.ticks > 0 ? dilate(start, slow) * 1000 : a.simUs;
    const reply: FrameReply = {
      type: 'frame',
      state: stepper.state,
      clip: a.clip,
      previous: stepper.previous,
      alpha: stepper.alpha,
      seq: stepper.seq,
      reopens: stepper.reopens,
      ticks: a.ticks,
      simUs,
      reopened: a.reopened,
      consumed: a.consumed,
    };
    post(reply);
  } else if (m.type === 'probe') {
    post({ type: 'probed', probe: stepper.probe(m.ticks) });
  } else if (m.type === 'finish') {
    post({ type: 'finished', gates: stepper.finish() });
  } else if (m.type === 'spin') {
    const start = performance.now();
    spin(m.iters);
    if (m.pad) dilate(start, m.slow);
    post({ type: 'spun' });
  }
});
