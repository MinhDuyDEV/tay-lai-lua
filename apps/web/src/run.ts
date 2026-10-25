// The run: one fixed-step loop that owns the keyboard, the driver and the sim session, and is
// driven by requestAnimationFrame from the page — never by the canvas. If WebGL fails, the run
// keeps ticking and the HUD keeps updating; only the picture goes.
//
// Time base: real time accumulates, each 1/60 s of it runs exactly one tick, and one frame catches
// up at most CATCHUP ticks. No `dt` ever reaches the core.
//
// The session is created on the start order, not when the learner enters the car. That is the
// core's reading of the law: it charges "no seat belt" on its first tick and counts the 20 s / 30 s
// departure deadlines from it, so the first tick *is* the order (crates/sim-core/src/exercise.rs,
// and the `belt_checked_at_order` assumption). Ticks run before that too — so the pedals feel the
// same — but the core is not fed: the car sits in the cockpit and the HUD shows what the driver's
// own bytes say.

import { createDriver, DT, type Driver } from '../input/driver.ts';
import { attachKeyboard, type Keyboard } from '../input/keyboard.ts';
import type { Penalty, Ruleset } from './ruleset.ts';
import { toPenalty } from './ruleset.ts';
import type { Session, SimEvent, SimState } from './sim/session.ts';

/** One frame may run at most this many ticks; beyond that the run drops time rather than spiral. */
export const CATCHUP = 6;

/** Esc and Backspace restart; the driver has no use for them. */
export const RESTART_CODES: readonly string[] = ['Escape', 'Backspace'];

export interface SessionFactory {
  open(): Session;
}

export interface Run {
  readonly keyboard: Keyboard;
  readonly driver: Driver;
  /** Last state of the core, or the cockpit state before the order. */
  readonly state: SimState;
  /** The previous tick's state, for interpolating the picture between the last two ticks. */
  readonly previous: SimState;
  /** 0..1, how far the last rendered frame sits between `previous` and `state`. */
  readonly alpha: number;
  /** True once the start order has created the core session. */
  readonly ordered: boolean;
  /** What actually answered: `none` before the order, then the session's own kind. */
  readonly simKind: 'none' | 'wasm' | 'fake';
  /** Called once per frame from inside the loop, after the ticks. The HUD paints refs here. */
  onFrame?: () => void;
  /** 16 hex digits, or null before the order. */
  hash(): string | null;
  /** 8-byte seed then one 8-byte record per tick, base64; empty before the order. */
  traceBase64(): string;
  /** Every penalty so far, in order. */
  readonly penalties: readonly Penalty[];
  restart(): void;
  dispose(): void;
}

/**
 * The car before the order. The core cannot represent this moment — its first tick is the order —
 * so the cockpit is decoded from the very bytes the driver produced, which are also the bytes the
 * core will get on its first tick. That keeps the HUD honest rather than inventing a state.
 */
export function cockpitState(input: Uint8Array, ruleset: Ruleset, idleRpm: number): SimState {
  const wire = new DataView(input.buffer, input.byteOffset, 8);
  const flags = input[6];
  const { course, vehicle } = ruleset;
  return {
    tick: 0,
    phase: 'waiting',
    score: ruleset.scoring.base,
    disqualified: false,
    // The core puts the car's centre half a length behind the bumper mark.
    carX: course.start_line_x_m + course.start_front_bumper_m - 0.5 * vehicle.length_m,
    carY: 0,
    heading: 0,
    speedMps: 0,
    rpm: idleRpm,
    frontBumperM: course.start_front_bumper_m,
    engineOn: true,
    cranking: (flags & 0b100) !== 0,
    steerRad: (wire.getInt16(0, true) / 32767) * vehicle.max_steer_rad,
    throttle: input[2] / 255,
    brake: input[3] / 255,
    clutch: input[4] / 255,
    gear: wire.getInt8(5),
    handbrake: (flags & 0b1000) !== 0,
    belt: (flags & 0b1) !== 0,
    signal: (flags & 0b10) !== 0 ? 'left' : (flags & 0b10000) !== 0 ? 'right' : 'off',
    engineLoad: 0,
  };
}

export interface RunOptions {
  ruleset: Ruleset;
  factory: SessionFactory;
  target: Window;
  /** The codes this page captures; the restart codes are added here. */
  handledCodes: ReadonlySet<string>;
  /** The idle rpm the core starts at, for the cockpit before the order. */
  idleRpm: number;
  onPenalty(penalty: Penalty): void;
  onRestart?(): void;
}

export function createRun(options: RunOptions): Run {
  const { ruleset, target, factory, onPenalty } = options;
  const keyboard = attachKeyboard(target, new Set([...options.handledCodes, ...RESTART_CODES]));
  const penalties: Penalty[] = [];

  let driver = createDriver();
  let session: Session | null = null;
  let state = cockpitState(driver.step(new Set(), [], { speedMps: 0, engineOn: true }), ruleset, options.idleRpm);
  let previous = state;
  let alpha = 1;
  let accumulator = 0;
  let lastMs = 0;
  let frame = 0;
  let disposed = false;
  let frameHook: (() => void) | undefined;
  /** Key presses seen but not yet given to a tick. */
  let waiting: string[] = [];

  const drain = (events: SimEvent[]) => {
    for (const event of events) {
      const penalty = toPenalty(ruleset, event);
      penalties.push(penalty);
      onPenalty(penalty);
    }
  };

  const reset = () => {
    session?.dispose();
    session = null;
    driver = createDriver();
    state = cockpitState(driver.step(new Set(), [], { speedMps: 0, engineOn: true }), ruleset, options.idleRpm);
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
    if (!session && pressed.includes('Enter')) {
      // The order. The core's first tick is the order, so belt and gear must already be in the
      // bytes this tick sends — they are, because the driver kept its state while un-fed.
      session = factory.open();
    }
    // Asked exactly once per tick, in both periods, so the pedals feel the same before and after.
    const input = driver.step(keyboard.held, pressed, {
      speedMps: state.speedMps,
      engineOn: state.engineOn,
    });
    if (!session) {
      // No core yet: the cockpit is what the driver's own bytes describe.
      previous = state;
      state = cockpitState(input, ruleset, options.idleRpm);
      return;
    }
    // Finished: the core is frozen and so is the record, so the trace and hash on screen match.
    if (state.phase === 'done') return;
    const result = session.step(input);
    previous = state;
    state = result.state;
    drain(result.events);
  };

  const advance = (nowMs: number) => {
    const real = lastMs === 0 ? 0 : (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    accumulator += Math.max(0, real);

    // A frame can run zero ticks; a press must wait for the tick that will consume it.
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
    if (steps === CATCHUP) {
      // Too far behind to catch up: drop the backlog instead of running extra sim per frame.
      accumulator = 0;
    }
    alpha = Math.min(1, accumulator / DT);
  };

  const loop = (nowMs: number) => {
    if (disposed) return;
    advance(nowMs);
    frameHook?.();
    frame = target.requestAnimationFrame(loop);
  };
  frame = target.requestAnimationFrame(loop);

  return {
    get onFrame() {
      return frameHook;
    },
    set onFrame(fn) {
      frameHook = fn;
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
      return session !== null;
    },
    get simKind() {
      return session ? session.kind : 'none';
    },
    hash() {
      return session ? session.hash() : null;
    },
    traceBase64() {
      if (!session) return '';
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
      session?.dispose();
      session = null;
    },
  };
}
