// A line given as data, driven with real key events through the real driver and the real core.
//
// A line is what a search emits: legs of (from pose, to pose, direction, lock fraction). The runner
// does what the page tells a person to do and what the core's own golden does:
//   * stop completely at every leg boundary and set the lock while the car stands;
//   * hold the lock arrow through the leg (the driver centres the wheel the moment it is let go);
//   * travel the leg's PATH length, which is recomputed from its two poses so it does not inherit the
//     search's grid, braking early by the distance the pedal and the car need to stop;
//   * close the last leg on the core's own condition (hull inside the bay), not on a planned length.
// It never re-scores geometry: contact, rule ids and the finish signal are the core's.
import { readFileSync } from 'node:fs';
import type { Leg, Pose } from '../src/ghep.ts';
import { endPose, reverseCreepMps, wheelAt } from '../src/ghep.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, seedWord, type Session, type SimState } from '../src/sim/session.ts';
import { createDriver, FEEL, steerFeel } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const rulesetData = JSON.parse(readFileSync(RULESET_FILE, 'utf8')) as Ruleset;
export const ruleset: Ruleset = { ...rulesetData, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

/** One leg: direction, lock fraction (−1..1; the keyboard only has −1, 0, +1), and path length, metres. */
export interface LineLeg {
  dir: 1 | -1;
  steer: number;
  len: number;
  /**
   * Signed heading change the leg is for, radians. A keyboard has no half lock: the wheel runs to full
   * at 2/s while the key is down and back to centre at 3/s once it is up. So a leg priced at a part lock
   * is driven by holding the arrow until the HEADING has turned this far, then letting go.
   */
  turn?: number;
}

export interface Line {
  legs: readonly LineLeg[];
}

/** A leg as a search writes it: the two poses (heading in degrees), the direction and the lock fraction. */
export interface PoseLeg {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  dir: 1 | -1;
  steer: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Path length of a pose leg: |Δθ·L / tan δ| on a lock, the chord on a straight. */
export function pathLength(leg: PoseLeg, rs: Ruleset): number {
  const tanD = Math.tan(leg.steer * wheelAt(rs, reverseCreepMps(rs)));
  if (Math.abs(tanD) < 1e-9) return Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
  const dTheta = wrap(((leg.to[2] - leg.from[2]) * Math.PI) / 180);
  return Math.abs((dTheta * rs.vehicle.wheelbase_m) / tanD);
}

/** A pose-leg list as a line. */
export function lineOf(poses: readonly PoseLeg[], rs: Ruleset = ruleset): Line {
  return {
    legs: poses.map((p) => ({
      dir: p.dir,
      steer: p.steer,
      len: pathLength(p, rs),
      turn: wrap(((p.to[2] - p.from[2]) * Math.PI) / 180),
    })),
  };
}

/** A leg as `endPose` wants it. */
export function toLeg(leg: LineLeg, rs: Ruleset): Leg {
  return { dir: leg.dir, steerRad: leg.steer * wheelAt(rs, reverseCreepMps(rs)), len: leg.len };
}

export interface LineOutcome {
  end: Pose;
  /** The core's own verdict, per wheel and per tick: did any wheel ever sit on paint or curb. */
  touched: boolean;
  inside: boolean;
  signal: boolean;
  disqualified: boolean;
  score: number;
  /** Seconds of simulated time from the first tick to the end, as a person would feel the run. */
  runS: number;
  /** The core's exam clock at the end. */
  clockS: number;
  pents: string[];
  /** Per-leg distance between where the car stopped and where the algebra says the leg ends. */
  legErrorsM: number[];
  travelledM: { forward: number; back: number };
  /** The finish wait ran out with no signal and no disqualification. */
  timedOut: boolean;
}

export const STOP_TOL_M = 0.25;
const SETTLE_TICKS = 240;
const FINISH_WAIT_S = 8;
/** A tap shorter than this is not worth a clutch release: the car cannot be placed that finely. */
const MIN_TAP_M = 0.05;
const MAX_TAPS = 4;

/**
 * Road the car still covers once the brake is asked for: the pedal's rise at the present speed, plus the
 * stop itself. A prediction, not a constant — a constant lead cannot suit both a 0.5 m tap and a 4 m leg.
 */
const brakeLead = (rs: Ruleset, speedMps: number, lateS = 0): number => {
  const v = Math.abs(speedMps);
  const decel = rs.drivetrain.brake_max_n / rs.vehicle.mass_kg;
  return v * (0.17 + lateS) + (v * v) / (2 * Math.max(1, decel));
};

export interface DriveOpts {
  trace?: (note: string) => void;
  finishWaitS?: number;
  /** Close the last leg on the core's hull-inside condition (default), or on its path length. */
  closeLast?: boolean;
  /**
   * The reader's lateness: every key change reaches the car this many ms after it was decided, plus the
   * poll's own phase. The brake lead grows by the road covered in that time, exactly as the page's cue
   * (`stoppingLeadM`) asks the brake early by `reactionS`.
   */
  reactMs?: number;
  phaseMs?: number;
}

export function driveLine(lesson: 7 | 8, line: Line, opts: DriveOpts = {}): LineOutcome {
  const session: Session = openSession(bytes(), seedWord(lesson, 1n));
  const driver = createDriver();
  const idOf = new Map(rulesetData.rules.map((r: { code: number; id: string }) => [r.code, r.id]));
  let s: SimState = session.state;
  const held = new Set<string>();
  const pents: string[] = [];
  const legErrors: number[] = [];
  let touched = false;
  let ticks = 0;
  const travelled = { forward: 0, back: 0 };
  let lx = s.carX;
  let ly = s.carY;

  const lateTicks = Math.round((((opts.reactMs ?? 0) + (opts.phaseMs ?? 0)) / 1000) * 60);
  const lateS = lateTicks / 60;
  /** What the learner decided, `lateTicks` ago: the car only ever sees this. */
  const queue: { held: Set<string>; pressed: string[] }[] = [];
  const tick = (pressed: readonly string[] = []): void => {
    queue.push({ held: new Set(held), pressed: [...pressed] });
    const seen = queue.length > lateTicks ? queue.shift()! : { held: new Set<string>(['Space']), pressed: [] };
    const r = session.step(driver.step(seen.held, seen.pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = r.state;
    ticks += 1;
    for (const e of r.events) {
      const id = idOf.get(e.code);
      if (id) pents.push(id);
    }
    const d = Math.hypot(s.carX - lx, s.carY - ly);
    const along = (s.carX - lx) * Math.cos(s.heading) + (s.carY - ly) * Math.sin(s.heading);
    if (along >= 0) travelled.forward += d;
    else travelled.back += d;
    lx = s.carX;
    ly = s.carY;
    if (s.contact.some((c) => c !== 0)) touched = true;
  };
  const until = (pred: () => boolean, max: number): boolean => {
    for (let i = 0; i < max && !pred(); i += 1) tick();
    return pred();
  };
  const stand = (): void => {
    held.add('Space');
    held.add('ArrowDown');
    until(() => Math.abs(s.speedMps) < 0.02, SETTLE_TICKS);
  };
  /** The gear goes in only with the pedal at the floor; the press is repeated until the lever moves. */
  const selectGear = (want: number): void => {
    held.add('Space');
    for (let i = 0; i < 300 && s.gear !== want; i += 1) {
      tick(s.clutch >= 0.97 ? [want === 1 ? 'Digit1' : 'KeyR'] : []);
    }
  };

  // The start: clutch, first gear, handbrake off.
  held.add('Space');
  selectGear(1);
  tick(['KeyP']);
  until(() => !s.handbrake, 60);

  /** One tap: clutch up into the creep, stop `dist` of path later (or when `stopWhen` holds). */
  const tap = (dist: number, arrow: string | null, stopWhen?: () => boolean, turn?: { h0: number; rad: number }): number => {
    held.delete('ArrowDown');
    held.delete('Space');
    const odo0 = travelled.forward + travelled.back;
    let moved = 0;
    let px = s.carX;
    let py = s.carY;
    let rolling = false;
    for (let i = 0; i < 60 * 40; i += 1) {
      if (arrow && turn) {
        // Part lock: hold the arrow only while the heading is still short of the wanted turn.
        if (Math.abs(wrap(s.heading - turn.h0)) < Math.abs(turn.rad) - 0.02) held.add(arrow);
        else held.delete(arrow);
      } else if (arrow) held.add(arrow);
      tick();
      moved += Math.hypot(s.carX - px, s.carY - py);
      px = s.carX;
      py = s.carY;
      if (!rolling && Math.abs(s.speedMps) > 0.02) rolling = true;
      if (!rolling) continue;
      if (stopWhen ? stopWhen() : moved + brakeLead(ruleset, s.speedMps, lateS) >= dist) break;
    }
    stand();
    // The path covered includes the stop itself: the brake does not bite at once.
    return travelled.forward + travelled.back - odo0;
  };

  let predicted: Pose = { x: s.carX, y: s.carY, h: s.heading };
  line.legs.forEach((raw, i) => {
    const leg = toLeg(raw, ruleset);
    const last = (opts.closeLast ?? true) && i === line.legs.length - 1;
    stand();
    if (s.gear !== raw.dir) selectGear(raw.dir);
    // Set the lock with the car standing, and wait for it to arrive: a lock change from one side to the
    // other takes a second on the keyboard, and a leg started before it is there is a different arc.
    for (const a of ['ArrowLeft', 'ArrowRight']) held.delete(a);
    const arrow = raw.steer > 0 ? 'ArrowLeft' : raw.steer < 0 ? 'ArrowRight' : null;
    const part = raw.turn !== undefined && Math.abs(raw.steer) > 0 && Math.abs(raw.steer) < 0.95;
    if (arrow && !part) held.add(arrow);
    // Sign-aware: a wheel at full lock the OTHER way is also "past" the wanted magnitude, and a leg
    // started from there is a different arc (measured: the lock-change legs came out 2-3 degrees short).
    const sign = Math.sign(leg.steerRad);
    until(
      () => (sign === 0 || part ? Math.abs(s.steerRad) < 0.02 : sign * (s.steerRad - leg.steerRad) >= -0.02),
      240,
    );
    let done = 0;
    const turnGoal = part ? { h0: s.heading, rad: raw.turn as number } : undefined;
    for (let n = 0; n < MAX_TAPS; n += 1) {
      const left = raw.len - done;
      if (!last && left < MIN_TAP_M) break;
      const got = tap(left, arrow, last ? () => s.hullInside : undefined, turnGoal);
      done += got;
      if (last) break;
    }
    for (const a of ['ArrowLeft', 'ArrowRight']) held.delete(a);
    predicted = endPose(predicted, [leg], ruleset);
    legErrors.push(Math.hypot(s.carX - predicted.x, s.carY - predicted.y));
    opts.trace?.(`${touched ? '[TOUCHED] ' : ''}${s.disqualified ? '[DQ] ' : ''}leg ${i + 1} ${raw.dir > 0 ? 'F' : 'R'} lock ${raw.steer} want ${raw.len.toFixed(2)} did ${done.toFixed(2)} → off ${legErrors[i].toFixed(2)} m, at ${s.carX.toFixed(2)} ${s.carY.toFixed(2)} ${((s.heading * 180) / Math.PI).toFixed(1)}° vs ${predicted.x.toFixed(2)} ${predicted.y.toFixed(2)} ${((predicted.h * 180) / Math.PI).toFixed(1)}°`);
  });

  // The finish: stand on the brake until the core signals, then Enter.
  stand();
  const signalled = until(() => s.finishSignal || s.disqualified, Math.round(60 * (opts.finishWaitS ?? FINISH_WAIT_S)));
  if (signalled && s.finishSignal) {
    tick(['Enter']);
    until(() => s.phase === 'done' || s.disqualified, 120);
  }
  const out: LineOutcome = {
    end: { x: s.carX, y: s.carY, h: s.heading },
    touched,
    inside: s.hullInside,
    signal: s.finishSignal,
    disqualified: s.disqualified,
    score: s.score,
    runS: ticks / 60,
    clockS: s.clockMs / 1000,
    pents: [...new Set(pents)],
    legErrorsM: legErrors,
    travelledM: travelled,
    timedOut: !s.finishSignal && !s.disqualified,
  };
  session.dispose();
  return out;
}
