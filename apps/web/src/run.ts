// The run: one fixed-step loop that owns the keyboard, the driver and the sim session, and is
// driven by requestAnimationFrame from the page — never by the canvas. If WebGL fails, the run
// keeps ticking and the HUD keeps updating; only the picture goes.
//
// Time base: real time accumulates, each 1/60 s of it runs exactly one tick, and one frame catches
// up at most CATCHUP ticks. No `dt` ever reaches the core.
//
// The core is live from the first tick: it is `waiting` for the start order, and nothing the
// learner does before the order is scored. Every tick is fed and recorded, so the trace replays the
// whole sitting.

import { createDriver, DT, type Driver } from '../input/driver.ts';
import { attachKeyboard, type Keyboard } from '../input/keyboard.ts';
import type { Penalty, Ruleset } from './ruleset.ts';
import { toPenalty } from './ruleset.ts';
import type { Session, SimState } from './sim/session.ts';

/** One frame may run at most this many ticks; beyond that the run drops time rather than spiral. */
export const CATCHUP = 6;

/** Esc and Backspace restart; the driver has no use for them. */
export const RESTART_CODES: readonly string[] = ['Escape', 'Backspace'];

export interface Run {
  readonly keyboard: Keyboard;
  readonly driver: Driver;
  /** Last state of the core. */
  readonly state: SimState;
  /** The state one tick earlier, for interpolating the picture between the last two ticks. */
  readonly previous: SimState;
  /** 0..1, how far the last rendered frame sits between `previous` and `state`. */
  readonly alpha: number;
  /** True once the start order has been given. */
  readonly ordered: boolean;
  /** Run `fn` once per frame, from inside the loop, after the ticks. Returns the unsubscribe. */
  onFrame(fn: () => void): () => void;
  hash(): string;
  /** 8-byte seed then one 8-byte record per tick, base64. */
  traceBase64(): string;
  /** Every penalty so far, in order. */
  readonly penalties: readonly Penalty[];
  restart(): void;
  dispose(): void;
}

export interface RunOptions {
  ruleset: Ruleset;
  openSession(): Session;
  target: Window;
  /** The codes this page captures; the restart codes are added here. */
  handledCodes: ReadonlySet<string>;
  onPenalty(penalty: Penalty): void;
  onRestart?(): void;
}

export function createRun(options: RunOptions): Run {
  const { ruleset, target, onPenalty } = options;
  const keyboard = attachKeyboard(target, new Set([...options.handledCodes, ...RESTART_CODES]));
  const penalties: Penalty[] = [];

  let driver = createDriver();
  let session = options.openSession();
  let state = session.state;
  let previous = state;
  let alpha = 1;
  let accumulator = 0;
  let lastMs = 0;
  let frame = 0;
  let disposed = false;
  const frameHooks = new Set<() => void>();
  /** Key presses seen but not yet given to a tick: a frame can run zero ticks. */
  let waiting: string[] = [];

  const reset = () => {
    session.dispose();
    driver = createDriver();
    session = options.openSession();
    state = session.state;
    previous = state;
    penalties.length = 0;
    accumulator = 0;
    lastMs = 0;
    alpha = 1;
    waiting = [];
    keyboard.clear();
    options.onRestart?.();
  };

  /** One 1/60 s tick. `pressed` are the codes that went down since the last tick. */
  const tick = (pressed: readonly string[]) => {
    // Asked exactly once per tick, so the pedals feel the same whatever the frame rate.
    const input = driver.step(keyboard.held, pressed, { speedMps: state.speedMps, engineOn: state.engineOn });
    // Finished: the core and the record are frozen, so the hash on screen matches the trace.
    if (state.phase === 'done') return;
    const result = session.step(input);
    previous = state;
    state = result.state;
    for (const event of result.events) {
      const penalty = toPenalty(ruleset, event);
      penalties.push(penalty);
      onPenalty(penalty);
    }
  };

  const advance = (nowMs: number) => {
    const real = lastMs === 0 ? 0 : (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    accumulator += Math.max(0, real);

    waiting.push(...keyboard.drainPressed());
    if (waiting.some((code) => RESTART_CODES.includes(code))) {
      reset();
      return;
    }

    let steps = 0;
    while (accumulator >= DT && steps < CATCHUP) {
      tick(waiting);
      waiting = [];
      accumulator -= DT;
      steps += 1;
    }
    // Too far behind to catch up: drop the backlog instead of running extra sim every frame.
    if (steps === CATCHUP) accumulator = 0;
    alpha = Math.min(1, accumulator / DT);
  };

  const loop = (nowMs: number) => {
    if (disposed) return;
    advance(nowMs);
    for (const hook of frameHooks) hook();
    frame = target.requestAnimationFrame(loop);
  };
  frame = target.requestAnimationFrame(loop);

  return {
    onFrame(fn) {
      frameHooks.add(fn);
      return () => frameHooks.delete(fn);
    },
    keyboard,
    get driver() {
      return driver;
    },
    get state() {
      return state;
    },
    get previous() {
      return previous;
    },
    get alpha() {
      return alpha;
    },
    get ordered() {
      return state.phase !== 'waiting';
    },
    hash: () => session.hash(),
    traceBase64() {
      const bytes = session.trace();
      let text = '';
      for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
      return btoa(text);
    },
    get penalties() {
      return penalties;
    },
    restart: reset,
    dispose() {
      disposed = true;
      target.cancelAnimationFrame(frame);
      keyboard.dispose();
      session.dispose();
    },
  };
}
