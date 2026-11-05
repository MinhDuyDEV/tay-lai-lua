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
//
// A liên hoàn run holds eleven exercises in one session: when the core swaps to the next bài the
// page refreshes the figure and puts the driver's toggles back to a parked car, so a gear left in at
// the end of one bài cannot stall the car at the start of the next. A replay feeds a recorded trace
// through a fresh session instead of the keyboard; same inputs, same hash.

import { createDriver, DT, type Driver } from '../input/driver.ts';
import { attachKeyboard, type Keyboard } from '../input/keyboard.ts';
import type { Penalty, Ruleset } from './ruleset.ts';
import { toPenalty } from './ruleset.ts';
import type { Exercise } from './exercise.ts';
import type { StepId } from './steps.ts';
import type { CourseRecord, Session, SimState } from './sim/session.ts';

/** One frame may run at most this many ticks; beyond that the run drops time rather than spiral. */
export const CATCHUP = 6;

/** Esc and Backspace restart; the driver has no use for them. */
export const RESTART_CODES: readonly string[] = ['Escape', 'Backspace'];

/** A recorded trace fed back through a fresh session, `ticksPerFrame` steps per animation frame. */
export interface ReplayOptions {
  /** One 8-byte record per tick, in the order they were fed. */
  inputs: readonly Uint8Array[];
  /** How many recorded ticks to run per frame; 1 is real time, more is the accelerated replay. */
  ticksPerFrame: number;
}

/** How far a replay has got, for the page to show while the recorded run plays back. */
export interface ReplayProgress {
  readonly done: boolean;
  readonly fed: number;
  readonly total: number;
}

export interface Run {
  readonly keyboard: Keyboard | null;
  readonly driver: Driver;
  /** Last state of the core. */
  readonly state: SimState;
  /** The figure's painted lines and gates, from the core; refreshed when a liên hoàn run swaps bài. */
  readonly course: readonly CourseRecord[];
  /** The state one tick earlier, for interpolating the picture between the last two ticks. */
  readonly previous: SimState;
  /** 0..1, how far the last rendered frame sits between `previous` and `state`. */
  readonly alpha: number;
  /** True once the core has left `waiting` (the start order in bài 1; bài 3 never waits). */
  readonly ordered: boolean;
  /** The checklist steps done so far in this bài; cleared when a liên hoàn run swaps bài. */
  readonly stepsDone: ReadonlySet<StepId>;
  /** Run `fn` once per frame, from inside the loop, after the ticks. Returns the unsubscribe. */
  onFrame(fn: () => void): () => void;
  hash(): string;
  /** 8-byte seed then one 8-byte record per tick, base64. */
  traceBase64(): string;
  /** Every penalty so far, in order. */
  readonly penalties: readonly Penalty[];
  /** Non-null while this run is a replay of a recorded trace. */
  readonly replay: ReplayProgress | null;
  restart(): void;
  dispose(): void;
}

export interface RunOptions {
  exercise: Exercise;
  /**
   * The exercise the current state belongs to. A per-bài page leaves this out (one exercise for the
   * whole run); a liên hoàn run returns the bài the core has swapped to.
   */
  exerciseOf?: (state: SimState) => Exercise;
  ruleset: Ruleset;
  openSession(): Session;
  target: Window;
  /** The codes this page captures; the restart codes are added here. */
  handledCodes: ReadonlySet<string>;
  /** True when the page drives an automatic: the driver then has a selector and no third pedal. */
  automatic?: boolean;
  /** Feed this recorded trace instead of the keyboard. */
  replay?: ReplayOptions;
  onPenalty(penalty: Penalty): void;
  onRestart?(): void;
}

export function createRun(options: RunOptions): Run {
  const { exercise, ruleset, target, onPenalty } = options;
  const automatic = options.automatic === true;
  const exerciseOf = options.exerciseOf ?? (() => exercise);
  const replayInputs = options.replay?.inputs ?? null;
  const keyboard = replayInputs
    ? null
    : attachKeyboard(target, new Set([...options.handledCodes, ...RESTART_CODES]));
  const penalties: Penalty[] = [];

  const stepsDone = new Set<StepId>();
  const mark = () => exerciseOf(state).mark(stepsDone, state, ruleset);

  let driver = createDriver({ automatic });
  let session = options.openSession();
  let state = session.state;
  let course = session.course;
  let previous = state;
  let alpha = 1;
  let accumulator = 0;
  let lastMs = 0;
  let frame = 0;
  let disposed = false;
  let replayAt = 0;
  let replayDone = replayInputs !== null && replayInputs.length === 0;
  const frameHooks = new Set<() => void>();
  /** Key presses seen but not yet given to a tick: a frame can run zero ticks. */
  let waiting: string[] = [];

  const reset = () => {
    session.dispose();
    driver = createDriver({ automatic });
    session = options.openSession();
    state = session.state;
    course = session.course;
    previous = state;
    penalties.length = 0;
    stepsDone.clear();
    accumulator = 0;
    lastMs = 0;
    alpha = 1;
    waiting = [];
    replayAt = 0;
    replayDone = replayInputs !== null && replayInputs.length === 0;
    keyboard?.clear();
    options.onRestart?.();
  };

  /** One 1/60 s tick with the input bytes the core will consume. */
  const tick = (input: Uint8Array) => {
    // Finished: the core and the record are frozen, so the hash on screen matches the trace.
    if (state.phase === 'done') return;
    const lesson = state.lesson;
    const result = session.step(input);
    previous = state;
    state = result.state;
    if (state.lesson !== lesson) {
      // The core has swapped to the next bài: its own figure, and a parked car's toggles. The car
      // itself is put at that bài's start pose by the core, at rest and engine running.
      course = session.refreshCourse();
      stepsDone.clear();
      previous = state;
      if (replayInputs === null) driver.resetToggles();
    }
    mark();
    for (const event of result.events) {
      const penalty = toPenalty(ruleset, event, lesson);
      penalties.push(penalty);
      onPenalty(penalty);
    }
  };

  const advance = (nowMs: number) => {
    if (replayInputs !== null) {
      // The recorded inputs, a few per frame: the scene and the clock play the same run back.
      for (let i = 0; i < options.replay!.ticksPerFrame && replayAt < replayInputs.length; i += 1) {
        tick(replayInputs[replayAt]);
        replayAt += 1;
      }
      if (replayAt >= replayInputs.length) replayDone = true;
      alpha = 1;
      return;
    }

    const real = lastMs === 0 ? 0 : (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    accumulator += Math.max(0, real);

    waiting.push(...keyboard!.drainPressed());
    if (waiting.some((code) => RESTART_CODES.includes(code))) {
      reset();
      return;
    }

    let steps = 0;
    while (accumulator >= DT && steps < CATCHUP) {
      // Asked exactly once per tick, so the pedals feel the same whatever the frame rate.
      const input = driver.step(keyboard!.held, waiting, { speedMps: state.speedMps, engineOn: state.engineOn });
      waiting = [];
      tick(input);
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

  const replay = replayInputs
    ? {
        get done() {
          return replayDone;
        },
        get fed() {
          return replayAt;
        },
        get total() {
          return replayInputs.length;
        },
      }
    : null;

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
    get course() {
      return course;
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
    stepsDone,
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
    replay,
    restart: reset,
    dispose() {
      disposed = true;
      target.cancelAnimationFrame(frame);
      keyboard?.dispose();
      session.dispose();
    },
  };
}
