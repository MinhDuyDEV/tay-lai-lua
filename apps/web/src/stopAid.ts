// The stop aid: when to press the one key that decides whether the car stops inside A.
//
// A is 500 mm ("khoảng cách A không quá 500mm" — bài 2, 3, 5 and 9 all quote it), and at the
// keyboard's idle creep the car covers it in a third of a second. A cue that says "press now" cannot
// fit that: a person reading the line is 100 to 500 ms behind it and the page is polled
// (`input/stop-aid-feel.test.ts` sweeps 16 to 500 ms). So the aid is a *countdown to a key landing*,
// not a trigger. Everything here comes from the ruleset's own numbers and the keyboard's pedal rates
// (`FEEL`), and the zero point sits in the middle of the window: a press with no timing error lands
// at A_MID_M, leaving half of A for being early or late.
//
// The countdown is `the road left before the press / the speed the car has now`, where the press
// point is the gap at which pressing *this instant* would stop the car at A_MID_M. Both halves come
// from the car as it is: the gap and the speed are the core's own `line_gap_m` and `speed_mps`, and
// the stop length is the core's motion arithmetic (`vehicle.rs` `step_motion`) run forward — rolling
// plus drag·v², gravity along the grade where the stop happens, the brake growing at
// `FEEL.brake.rise`, and the engine still holding the car while the clutch pedal goes down. So a
// stale reading is still honest to half a second: the gap closes at the speed the learner can see,
// and the mark moves by only as much as the car's speed does in that time.
//
// Which key is critical is a property of the road, not of one exercise. On a grade it is the clutch:
// pressing it opens the drive, and the slope's gravity does the stopping. On the flat the road takes
// only ~0.12 m/s² off a coasting car, so the brake is the only thing that stops it — and the clutch
// is asked for before it (a brake in gear stalls the engine), which is the advice line's job, not
// the countdown's.

import { DT, FEEL } from '../input/driver.ts';
import { GRAVITY_MPS2, type Ruleset } from './ruleset.ts';
import type { SimState } from './sim/session.ts';

/** The key whose landing decides the stop. */
export type StopKey = 'clutch' | 'brake';

/**
 * The road a stop happens on, and the key that times it. It is the whole of what a lesson has to say
 * about its stop line: the gap and the speed come from the state, as the core measures them, so
 * bài 3's slope and the flat exercises' roads go through the same prediction.
 */
export interface StopRoad {
  /** Rise over run of the road `toLineM` metres short of the stop line. */
  grade(toLineM: number): number;
  key: StopKey;
}

/** A level road: every exercise whose stop line is on the flat uses this. */
export const flatRoad = (key: StopKey): StopRoad => ({ grade: () => 0, key });

/** What the page publishes, and what the HUD's bar draws. */
export interface StopAid {
  key: StopKey;
  /** Milliseconds until the key should land; 0 once it is due. */
  etaMs: number;
  /** Front bumper to the line, metres, signed: positive while short of it. */
  gapM: number;
  /** The gap at which the key should land, metres. */
  markM: number;
}

/**
 * Where a press with no timing error lands, metres short of the line: the middle of A's 500 mm
 * window, so being early and being late both have half of it to spend. `stop-aid-feel.test.ts`
 * measures where the sweep actually lands and this is set from that, not the other way round.
 */
export const A_MID_M = 0.27;

/** A deceleration below this is none at all: a level road with no brake in reach. */
const EPS = 1e-6;

/** Below this the car is standing still and there is nothing to time. */
const MOVING_MPS = 0.05;
/**
 * How far ahead the countdown is worth publishing, seconds. Past this the countdown rests on the car
 * holding its speed for that long, which nobody can promise — it is still picking up or shedding
 * speed — so the number would be a clock rather than a key to time. It also bounds the bar's scale:
 * a learner sees at most `còn 4.9 s` when the aid appears.
 */
const MAX_ETA_S = 5;
/** The forward run of a stop gives up after this long, seconds: a `clutch` press on the flat
 * decelerates at a tenth of a m/s². */
const MAX_RUN_S = 30;

/** Deceleration of the road alone at `v`, m/s²: gravity along the grade plus rolling and air drag. */
function roadDecel(ruleset: Ruleset, grade: number, v: number): number {
  const sinSlope = grade / Math.sqrt(1 + grade * grade);
  const { rolling_n: rolling, drag_n_per_mps2: drag } = ruleset.drivetrain;
  return GRAVITY_MPS2 * sinSlope + (rolling + drag * v * v) / ruleset.vehicle.mass_kg;
}

/**
 * How much road the car still covers, and how long it takes, from the moment the critical key lands
 * at `v0` until it stands still.
 *
 * `brake` is taken with the clutch already down: the engine is out of it and the pedal is all that is
 * stopping the car. `clutch` starts with the drive still carrying the car: the engine feeds the
 * road's own resistance through the clutch, so the car holds its speed until the pedal has gone
 * through the middle of its bite zone, and the road alone has it from there on. Both phases and the
 * two rates come from `FEEL` — the same numbers the driver presses the pedals with — so a car with a
 * different brake or a different bite zone gets a different answer.
 */
export function stopTravel(ruleset: Ruleset, v0: number, grade: number, key: StopKey): { travelM: number; timeS: number } {
  const mass = ruleset.vehicle.mass_kg;
  const brakeMaxN = ruleset.drivetrain.brake_max_n;
  const { biteHigh, biteLow, press: pressRate } = FEEL.clutch;
  /** Seconds for the pedal to reach the middle of its bite zone: the drive carries the car until then. */
  const carriedS = key === 'clutch' ? (biteLow + biteHigh) / 2 / pressRate : 0;
  let brake = 0;
  let v = v0;
  let travelM = 0;
  let timeS = 0;
  // The drive holds the car at its speed; measured, this is where a clutch press starts costing road.
  const carried = Math.min(carriedS, v0 / Math.max(roadDecel(ruleset, grade, v0), EPS));
  travelM += v0 * carried;
  timeS += carried;
  for (let i = 0; i < MAX_RUN_S / DT && v > 0; i += 1) {
    if (key === 'brake') brake = Math.min(1, brake + FEEL.brake.rise * DT);
    const decel = roadDecel(ruleset, grade, v) + (brakeMaxN * brake) / mass;
    // The order the core integrates in: the new speed, then the road covered at it.
    v = Math.max(0, v - decel * DT);
    travelM += v * DT;
    timeS += DT;
  }
  return { travelM, timeS };
}

/**
 * The gap at which pressing now stops the car at A_MID_M, or null when even a press now cannot make
 * the window: the car comes to rest short of A_MID_M on its own, so no key would be needed.
 *
 * The stop's own grade is read where the stop happens, and the stop happens `travelM` past the mark,
 * so the mark and the grade are taken as a fixed point; it settles in one step on a straight approach
 * to a line, which is the only kind there is.
 */
function pressGapM(ruleset: Ruleset, v: number, road: StopRoad): number {
  let mark = A_MID_M + stopTravel(ruleset, v, road.grade(A_MID_M), road.key).travelM;
  mark = A_MID_M + stopTravel(ruleset, v, road.grade(mark), road.key).travelM;
  return mark;
}

/**
 * The aid for this tick, or null when no key is being timed: the run is over or suspended, the car is
 * not being driven toward the line (engine off, not in first, handbrake on) or it is standing still.
 *
 * Once the critical key is already down the countdown is over — the stop is happening and the answer
 * is "now, here" — so `etaMs` is 0 and the mark is the gap the car is at. Without that a script that
 * polls after the press reads a fresh positive countdown for a car that is already slowing, plans a
 * second press, and releases the keys in between.
 *
 * There is no aid at all while the drive is open on the clutch road: a car in first with the clutch
 * down is setting off or changing gear, not rolling to a stop, and a countdown then is a countdown on
 * a car that is not going anywhere. On the brake road the clutch is *expected* down (the advice line
 * asks for it first), so only the brake itself ends that countdown.
 */
export function stopAid(state: SimState, ruleset: Ruleset, road: StopRoad): StopAid | null {
  if (state.disqualified || state.phase === 'done') return null;
  if (!state.engineOn || state.gear !== 1 || state.handbrake) return null;
  if (state.sinceStopTicks >= 0) return null;
  const v = state.speedMps;
  if (v <= MOVING_MPS) return null;
  const gapM = state.lineGapM;
  if (road.key === 'clutch' && state.clutch > 0.05) return null;
  if (road.key === 'brake' && state.brake > 0.05) return { key: road.key, etaMs: 0, gapM, markM: gapM };
  const markM = pressGapM(ruleset, v, road);
  if (markM >= gapM) return { key: road.key, etaMs: 0, gapM, markM: gapM };
  // The car keeps closing the gap at its speed until the key lands: the engine holds it in gear, and
  // the coast with the clutch down is in the stop's own length.
  const etaMs = Math.round(((gapM - markM) / v) * 1000);
  if (etaMs > MAX_ETA_S * 1000) return null;
  return { key: road.key, etaMs, gapM, markM };
}
