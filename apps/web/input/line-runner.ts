// A pose list driven as data: gives a line of poses to the learner model and it drives them with real
// key events through the real driver and the real core. This is the half of the harness that does not
// depend on the page having a planner: the lead's search writes a line, this replays it.
//
// A "line" here is the shape the lead's search emits: a list of legs, each `dir` (+1 forward, −1
// reverse), a `steer` fraction of full lock (−1..+1), and how far to go. The follower does what the
// brief fixes for the real car and what the page's advice line tells a person to do:
//   * stop completely at every leg boundary;
//   * set the lock while the car is still, then let go of the wheel;
//   * one measured tap to travel the leg, clutch up in the creep and back down to stop.
// The leg's `len` is the *travel* the search priced; the follower does not trust it blindly — it stops
// when the car has gone that far, and reports the residual pose error so a bad line is visible rather
// than silently absorbed.
//
// It is deliberately free of any planner: `driveLine` just takes poses. That is what makes it usable as
// the arbiter for the lead's search, for the page's planner, and for a recorded human run.
import { readFileSync } from 'node:fs';
import type { Leg, Pose } from '../src/ghep.ts';
import { endPose, wheelAt, reverseCreepMps } from '../src/ghep.ts';
import { FEEL } from './driver.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, seedWord, type Session, type SimState } from '../src/sim/session.ts';
import { createDriver, DT, steerFeel } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const rulesetData = JSON.parse(readFileSync(RULESET_FILE, 'utf8')) as Ruleset;
export const ruleset: Ruleset = { ...rulesetData, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

/** One leg as the search writes it: direction, lock fraction of full lock, and travel in metres. */
export interface LineLeg {
  dir: 1 | -1;
  /** −1 = full lock one way, +1 = full lock the other, 0 = straight. Any fraction in between is allowed. */
  steer: number;
  len: number;
}

/** A whole line: the legs, and where the search says it should end. */
export interface Line {
  legs: readonly LineLeg[];
  /** The end pose the search claims. The follower drives the legs; this is only compared, never aimed at. */
  end?: Pose;
}

/** A leg as `endPose` wants it, in radians of wheel. */
export function toLeg(leg: LineLeg, rs: Ruleset): Leg {
  return { dir: leg.dir, steerRad: leg.steer * wheelAt(rs, reverseCreepMps(rs)), len: leg.len };
}

export interface LineOutcome {
  /** Where the car actually ended, for comparing against the search's claim. */
  end: Pose;
  /** Metres between the actual end and `line.end`, when the line makes a claim. */
  endErrorM: number | null;
  /** The pose the search's own algebra predicts for the same legs, and the error against it. */
  predicted: Pose;
  algebraErrorM: number;
  /**
   * Whether any wheel touched paint or curb at any tick, from the core's own per-wheel `contact` field.
   * This is the core's verdict, not a second opinion: the harness never re-scores geometry the core
   * already scored.
   */
  touched: boolean;
  inside: boolean;
  signal: boolean;
  disqualified: boolean;
  score: number;
  clockS: number;
  /** Rules the core charged, by id. */
  pents: string[];
  /** True when every leg finished within `STOP_TOL_M` of where the algebra said it would. */
  legsHeld: boolean;
  /**
   * True when the run was cut short by the exam's own cap rather than by the finish. A partial line (one
   * leg, for a control test) always ends this way: it never gets inside the bay, so it waits out the cap.
   * Distinguishing it keeps "this leg did not work" from "this line was never meant to finish".
   */
  timedOut: boolean;
  /** Per-leg residual, metres: actual end minus the algebra's end. */
  legErrorsM: number[];
  /** Total forward and reverse distance the car actually covered, metres. */
  travelledM: { forward: number; back: number };
}

/** How far a leg may finish from the algebra's end before the line counts as "not held". */
export const STOP_TOL_M = 0.25;
/**
 * The follower brakes when the distance still to go equals the distance the car will cover while the
 * brake goes down — its speed times the pedal's rise, plus its own stopping distance at that speed.
 * Written as a prediction rather than a constant because no constant can be right for both a 0.5 m tap
 * (where a 0.5 m lead means never starting) and a 4 m leg (where it means overshooting by half a metre).
 * Both were measured: a constant lead never moved the car on the short leg, and none at all overshot
 * every leg by up to 0.50 m, which is the brake's own stopping distance at the creep.
 */
const brakeLead = (rs: Ruleset, speedMps: number): number => {
  const v = Math.abs(speedMps);
  const decel = rs.drivetrain.brake_max_n / rs.vehicle.mass_kg;
  // The pedal's state is *read* one tick late by the driver and the brake only bites once it is off its
  // rest position, so the car keeps rolling for `rise` ticks before any deceleration exists at all.
  const pedalS = 1 / FEEL.brake.rise;
  return v * pedestalS(v, pedalS) + (v * v) / (2 * Math.max(1, decel));
};

/**
 * The car cannot brake until the pedal reaches it, and the driver's pedal is one tick behind the key.
 * Measured braking lag is about three ticks before the deceleration shows; two of those are inside the
 * rise, one is the driver's own delay.
 */
const pedestalS = (v: number, riseS: number): number => riseS + 1 / 60;
/** Ticks the car is given to come to rest at a leg boundary before the follower insists. */
const SETTLE_TICKS = 180;
/** How close to the leg's end pose a tap must land before the follower calls the leg done. */
const TAP_TOL_M = 0.10;
/** The longest single tap the follower will ask for; beyond this the creep overshoots the brake. */
const MAX_TAP_M = 1.2;

/**
 * Drive a line, from the exercise's own start pose, with nothing but key events.
 *
 * `opts.lesson` picks the seed; the line is the only thing that steers.
 */
/** How long the finish is waited for before the harness gives up, seconds. The core's own cap is longer. */
const FINISH_WAIT_S = 8;

export function driveLine(
  lesson: 7 | 8,
  line: Line,
  opts: { trace?: (s: SimState, note: string) => void; /** Waits for the finish signal for this long. */ finishWaitS?: number } = {},
): LineOutcome {
  const session: Session = openSession(bytes(), seedWord(lesson));
  const driver = createDriver();
  const ruleList = (JSON.parse(readFileSync(RULESET_FILE, 'utf8')) as { rules: { code: number; id: string }[] })
    .rules;
  const idOf = new Map(ruleList.map((r) => [r.code, r.id]));

  let s: SimState = session.state;
  const held = new Set<string>();
  const pents: string[] = [];
  const legErrors: number[] = [];
  let touched = false;
  let travelledForward = 0;
  let travelledBack = 0;
  let lastX = s.carX;
  let lastY = s.carY;

  /** One tick of the real sim, with whatever keys are held now. */
  const tick = (pressed: readonly string[] = []): void => {
    const input = driver.step(held, [...pressed], { speedMps: s.speedMps, engineOn: s.engineOn });
    const r = session.step(input);
    s = r.state;
    for (const e of r.events) {
      const id = idOf.get(e.code);
      if (id) pents.push(id);
    }
    const d = Math.hypot(s.carX - lastX, s.carY - lastY);
    if (d > 0) {
      // Which way the car moved along its own nose tells forward from reverse.
      const along = (s.carX - lastX) * Math.cos(s.heading) + (s.carY - lastY) * Math.sin(s.heading);
      if (along >= 0) travelledForward += d;
      else travelledBack += d;
    }
    lastX = s.carX;
    lastY = s.carY;
    if (s.contact.some((c) => c !== 0)) touched = true;
  };

  /** Hold keys until the predicate holds or we give up, so a leg can never hang the harness. */
  const until = (pred: () => boolean, maxTicks: number): boolean => {
    for (let i = 0; i < maxTicks; i += 1) {
      if (pred()) return true;
      tick();
    }
    return pred();
  };

  // ---- the start: clutch, first gear, handbrake off, all while standing still -------------------
  // The gear press is retried until the lever actually moves. `until` above can see the clutch at 0.96
  // while the pedal is still travelling and the driver has not yet latched it, and a press that lands a
  // tick early is silently dropped — measured: the car then sits in neutral and every later leg fails.
  const selectGear = (want: 1 | -1): void => {
    for (let i = 0; i < 240 && s.gear !== want; i += 1) {
      held.add('Space');
      // Press on the tick after the pedal is fully down, so the driver's own copy of the travel agrees.
      tick(s.clutch >= 0.97 ? [want === 1 ? 'Digit1' : 'KeyR'] : []);
    }
  };
  held.add('Space');
  until(() => s.clutch >= 0.99, 240);
  selectGear(1);
  tick(['KeyP']);
  until(() => !s.handbrake, 60);

  /**
   * One measured tap: clutch up into the creep, stop at `distM` of travel (braking by prediction), and
   * settle. The wheel is held only while it is short of the lock the leg was priced with.
   */
  const tapOnce = (distM: number, arrow: string | null, lockSign: number, wantLock: number): void => {
    held.delete('ArrowDown');
    held.delete('Space');
    let moved = 0;
    let lastTapX = s.carX;
    let lastTapY = s.carY;
    let rolling = false;
    for (let i = 0; i < 60 * 40; i += 1) {
      if (arrow && lockSign * (wantLock - s.steerRad) > 0.04) held.add(arrow);
      else if (arrow) held.delete(arrow);
      tick();
      const d = Math.hypot(s.carX - lastTapX, s.carY - lastTapY);
      lastTapX = s.carX;
      lastTapY = s.carY;
      if (!rolling && Math.abs(s.speedMps) > 0.02) rolling = true;
      if (rolling) {
        moved += d;
        if (moved + brakeLead(ruleset, s.speedMps) >= distM) break;
      }
    }
    held.add('Space');
    held.add('ArrowDown');
  };

  // ---- the legs -------------------------------------------------------------------------------
  let predicted: Pose = { x: s.carX, y: s.carY, h: s.heading };
  let legsHeld = true;
  for (const raw of line.legs) {
    const leg = toLeg(raw, ruleset);
    const predictedBeforeLeg: Pose = predicted;
    // Stop fully and set the lock with the car still, then release the wheel: the real car cannot be
    // steered *through* a leg at creep speed, and the brief says every lock change happens stationary.
    held.add('Space');
    held.add('ArrowDown');
    until(() => Math.abs(s.speedMps) < 0.02, SETTLE_TICKS);

    if (s.gear !== leg.dir) selectGear(leg.dir);

    // The wheel: hold the arrow while the car stands until the lock reads where the leg wants it, and
    // KEEP HOLDING IT for the whole leg. The driver centres the wheel as soon as no arrow is held
    // (`FEEL.steer.centre`) and shrinks the lock with speed, so releasing before the tap turns every
    // arc into a straight line — measured: the car drove dead straight and h never changed.
    const wantLock = leg.steerRad;
    held.delete('ArrowLeft');
    held.delete('ArrowRight');
    const arrow = wantLock > 0 ? 'ArrowLeft' : wantLock < 0 ? 'ArrowRight' : null;
    const lockSign = wantLock > 0 ? 1 : -1;
    if (arrow) held.add(arrow);

    // The tap. One tap rarely lands the leg exactly: the creep speed, the brake's lag and the wheel's
    // lock all move with speed, so the follower closes the loop on the *pose* the search priced rather
    // than on a dead-reckoned length. It taps, stops, measures the distance still to go, and taps again —
    // bounded, so a leg the car cannot reach is reported as a residual rather than looping forever.
    const want = endPose(predictedBeforeLeg, [leg], ruleset);
    for (let tap = 0; tap < 6; tap += 1) {
      const remaining = Math.hypot(want.x - s.carX, want.y - s.carY);
      if (remaining < TAP_TOL_M) break;
      // A very short remaining distance is a reason to steer the last of it, not to give up.
      const throttleTo = Math.min(remaining, MAX_TAP_M);
      tapOnce(throttleTo, arrow, lockSign, leg.steerRad);
      // Stop, and let the brake settle before measuring again.
      until(() => Math.abs(s.speedMps) < 0.02, SETTLE_TICKS);
    }
    held.delete('ArrowLeft');
    held.delete('ArrowRight');
    const closed = Math.hypot(want.x - s.carX, want.y - s.carY);
    opts.trace?.(
      s,
      `leg ${raw.dir > 0 ? 'F' : 'R'} lock ${raw.steer.toFixed(2)} want ${raw.len.toFixed(2)} m → ` +
        `posed ${(Math.hypot(want.x - predictedBeforeLeg.x, want.y - predictedBeforeLeg.y)).toFixed(2)} m, ` +
        `off by ${closed.toFixed(2)} m`,
    );

    predicted = endPose(predicted, [leg], ruleset);
    const err = Math.hypot(s.carX - predicted.x, s.carY - predicted.y);
    legErrors.push(err);
    if (err > STOP_TOL_M) legsHeld = false;
  }

  // ---- the finish: stand on the brake and press Enter -------------------------------------------
  held.add('Space');
  held.add('ArrowDown');
  // The core needs the car inside and exactly still before it signals; then Enter ends the run. The wait
  // is bounded: a control line that never reaches the bay must not sit out the core's whole exam cap, or
  // every such test would take four minutes and charge a rule that says nothing about the line.
  const waitTicks = Math.round(60 * (opts.finishWaitS ?? FINISH_WAIT_S));
  const signalled = until(() => s.finishSignal || s.disqualified, waitTicks);
  if (signalled && s.finishSignal) {
    tick(['Enter']);
    until(() => s.phase === 'done' || s.disqualified, 120);
  }
  const timedOut = !s.finishSignal && !s.disqualified;

  const end: Pose = { x: s.carX, y: s.carY, h: s.heading };
  const out: LineOutcome = {
    end,
    endErrorM: line.end ? Math.hypot(end.x - line.end.x, end.y - line.end.y) : null,
    predicted,
    algebraErrorM: Math.hypot(end.x - predicted.x, end.y - predicted.y),
    touched,
    inside: s.hullInside,
    signal: s.finishSignal,
    disqualified: s.disqualified,
    score: s.score,
    clockS: s.clockMs / 1000,
    pents: [...new Set(pents)],
    legsHeld,
    timedOut,
    legErrorsM: legErrors,
    travelledM: { forward: travelledForward, back: travelledBack },
  };
  session.dispose();
  return out;
}
