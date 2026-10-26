// The stop aid: when to press the one key that decides whether the car stops inside A.
//
// A is 500 mm ("khoảng cách A không quá 500mm" — bài 2, 3, 5 and 9 all quote it), and at the car's
// creep it covers that in a third of a second. A cue that means "press at this instant" cannot fit
// that, and neither can one that means "press when I say now": a person reading the line is 150 to
// 350 ms behind it and the page is polled. So the aid is two moments, not one:
//
//   * the *bar's mark* is where a press with no timing error lands the car: a key that lands at the
//     mark stops the car at A_MID_M, the middle of the window;
//   * the *"bấm ngay" text* leads that mark by LEAD_MS, so a learner who reads it and reacts inside the
//     band presses around the mark. The text is a trigger for a human; the bar is the exact geometry.
//
// Both are computed by running the core's own motion forward from the state the car is in — speed,
// the engine and clutch as they actually are, the grade under the road ahead — not by holding the
// current speed. That distinction is the whole of the earlier bug: the page's approach starts from
// rest about 2 m before the line, so at the moment the aid appears the car is still accelerating
// toward its creep. A countdown computed as `gap / speed` treats it as already at creep, says "now"
// far too early, and every learner who believed it stopped short of the window or past it
// (`stop-aid-feel.test.ts` measures this on bài 2, 3 and 9's own scenes, from the page's start state).

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
  /**
   * Milliseconds until the learner should press, as the line reads it: the countdown on screen and the
   * number a script schedules from. It leads the bar's mark by `LEAD_MS`, because a learner answers
   * words late and 0 has to mean "now" for a person who reacts. 0 once that moment has passed, and it
   * stays 0 until the car has stopped.
   */
  etaMs: number;
  /** The bar's own countdown to its mark. Equal to `etaMs`: the bar draws the ideal moment. */
  markEtaMs: number;
  /** True once the words should say "bấm ngay": `LEAD_MS` before the ideal, for a human's reaction. */
  now: boolean;
  /** Front bumper to the line, metres, signed: positive while short of it. */
  gapM: number;
  /** The gap at which the key should land, metres. */
  markM: number;
}

/**
 * Where a press with no timing error lands, metres short of the line: the middle of A's 500 mm
 * window, so being early and being late both have half of it to spend.
 */
export const A_MID_M = 0.27;

/**
 * How far the "bấm ngay" text leads the bar's mark, milliseconds. A learner who reads the words and
 * presses 150 to 350 ms later presses within 25 ms of the mark if the text leads by the middle of
 * that band. The bar itself is not moved: a learner watching the bar meet its mark presses at the
 * mark, and both are the same stop.
 */
export const LEAD_MS = 250;

/** A deceleration below this is none at all: a level road with no brake in reach. */
const EPS = 1e-6;

/** Below this the car is standing still and there is nothing to time. */
const MOVING_MPS = 0.05;
/**
 * How far ahead the *countdown* is worth publishing, seconds. Past this the forward run rests on the
 * car holding its line for that long, which nobody can promise — it is still picking up speed — so the
 * number would be a clock rather than a key to time. It also bounds the bar's scale.
 */
const MAX_ETA_S = 5;
/**
 * How far ahead the planner will search for the mark, seconds. Larger than `MAX_ETA_S` because the
 * search has to reach the mark before the aid decides there is nothing to publish: on bài 3 the car
 * sets off ~14 m from the line and takes several seconds to get there, and a search that gave up
 * inside the publish window would report "due now" from the far end of the approach. What the learner
 * is shown is still capped by `MAX_ETA_S`.
 */
const MAX_SEARCH_S = 40;
/** The forward run gives up after this long, seconds: a coast on the flat decelerates at a
 * tenth of a m/s². */
const MAX_RUN_S = 30;

/** RPM -> rad/s, as `vehicle.rs`. */
const RADPS_PER_RPM = (Math.PI * 2) / 60;

/** Deceleration of the road alone at `v`, m/s²: gravity along the grade plus rolling and air drag. */
function roadDecel(ruleset: Ruleset, grade: number, v: number): number {
  const sinSlope = grade / Math.sqrt(1 + grade * grade);
  const { rolling_n: rolling, drag_n_per_mps2: drag } = ruleset.drivetrain;
  return GRAVITY_MPS2 * sinSlope + (rolling + drag * v * v) / ruleset.vehicle.mass_kg;
}

/** The engine's indicated torque at `rpm` with the throttle at `throttle` (`vehicle.rs` engine_torque). */
function engineTorque(ruleset: Ruleset, rpm: number, throttle: number): number {
  const d = ruleset.drivetrain;
  const r = rpm / d.indicated_ref_rpm;
  const shape = Math.min(1, Math.max(0, 1 - (r - 0.5) * (r - 0.5) * 1.6));
  return d.indicated_torque_nm * shape * Math.min(1, Math.max(0, throttle));
}

/**
 * Torque the partly closed clutch carries, positive when it drags the engine down
 * (`vehicle.rs` clutch_torque). `gear` is first, which every stop line here is driven in.
 */
function clutchTorque(ruleset: Ruleset, rpm: number, v: number, clutch: number): number {
  const d = ruleset.drivetrain;
  const ratio = d.gears['1'];
  if (ratio === undefined) return 0;
  const engagement = 1 - Math.min(1, Math.max(0, clutch));
  if (engagement <= 0) return 0;
  const driven = (v / ruleset.vehicle.wheel_radius_m) * ratio * d.final_drive;
  const slip = rpm * RADPS_PER_RPM - driven;
  const carried = Math.min(d.clutch_capacity_nm, Math.max(-d.clutch_capacity_nm, d.clutch_stiffness_nm_per_rad_s * slip));
  return carried * engagement;
}

/** The drive force at the contact patch, from a clutch torque and first gear (`vehicle.rs`). */
function driveForce(ruleset: Ruleset, torqueNm: number): number {
  const d = ruleset.drivetrain;
  const ratio = d.gears['1'];
  if (ratio === undefined) return 0;
  return (torqueNm * ratio * d.final_drive) / ruleset.vehicle.wheel_radius_m;
}

/**
 * How much road the car still covers, and how long it takes, from the moment the critical key lands
 * at `v0` with the engine at `rpm0`, until it stands still.
 *
 * `brake` is taken with the clutch already down: the engine is out of it and the pedal is all that is
 * stopping the car. `clutch` starts with the drive still carrying the car: the pedal takes
 * `(biteLow + biteHigh) / 2 / press` seconds to reach its bite, and until then the engine holds the
 * car; after that the road alone has it. Both pedal rates come from `FEEL` — the same numbers the
 * driver presses with — so a car with a different brake or bite zone gets a different answer.
 */
export function stopTravel(
  ruleset: Ruleset,
  v0: number,
  grade: number | StopRoad,
  key: StopKey,
  /** The gap to the line where the stop begins. Read only by a road whose grade varies along it. */
  fromGapM = 0,
  /**
   * Whether the clutch is already down when the key lands. The advice line on the *brake* road asks
   * for the clutch first, so it is down: `true` is that learner. The page's own one-key answer is to
   * press both at once, and then the drive still carries the car for as long as the pedal takes to
   * cross its bite — which is 0.1 s of road the stop has to pay for, and on a 2 m approach to a 500 mm
   * window that is the difference between A 0.16 and stopping on the line.
   */
  clutchDown = false,
): { travelM: number; timeS: number } {
  /** The grade the car is on after `m` metres of the stop. A road that varies is walked, not assumed. */
  const gradeAt = typeof grade === 'number' ? () => grade : (m: number) => grade.grade(fromGapM - m);
  const mass = ruleset.vehicle.mass_kg;
  const brakeMaxN = ruleset.drivetrain.brake_max_n;
  const { biteHigh, biteLow, press: pressRate } = FEEL.clutch;
  /** Seconds for the pedal to reach the middle of its bite zone: the drive carries the car until then. */
  const carriedS = key === 'clutch' || !clutchDown ? (biteLow + biteHigh) / 2 / pressRate : 0;
  let brake = 0;
  let clutch = clutchDown ? 1 : 0;
  let v = v0;
  let travelM = 0;
  let timeS = 0;
  // The drive holds the car at its speed; measured, this is where a clutch press starts costing road.
  const carried = Math.min(carriedS, v0 / Math.max(roadDecel(ruleset, gradeAt(0), v0), EPS));
  travelM += v0 * carried;
  timeS += carried;
  for (let i = 0; i < MAX_RUN_S / DT && v > 0; i += 1) {
    if (key === 'brake') brake = Math.min(1, brake + FEEL.brake.rise * DT);
    // The pedal carries on down while the brake rises, so the drive lets go a moment into the stop.
    if (clutch < 1) clutch = Math.min(1, clutch + pressRate * DT);
    // While the drive is still partly engaged the engine holds the car against the brake's share of it.
    const driveShare = 1 - clutch;
    const decel =
      roadDecel(ruleset, gradeAt(travelM), v) * (1 - driveShare) + (brakeMaxN * brake) / mass;
    // The order the core integrates in: the new speed, then the road covered at it.
    v = Math.max(0, v - decel * DT);
    travelM += v * DT;
    timeS += DT;
  }
  return { travelM, timeS };
}

/**
 * Where a press must land for the car to stop at A_MID_M, given the state now: walk the free run
 * forward until a stop from that point would end at the mark. Solved by bisection on the moment,
 * because a press early stops the car short of the line and a press late carries it over, so the
 * gap a press must happen at is monotonic in time.
 */
function pressPoint(
  ruleset: Ruleset,
  now: { v: number; rpm: number; clutch: number; throttle: number },
  road: StopRoad,
  gapM: number,
  /** True when the learner's clutch is already down, so the key alone is the whole stop. */
  clutchDown: boolean,
): { etaS: number; gapM: number } | null {
  // Walk the free run forward — nothing more pressed, feet where they are — to the moment where
  // `gap - what a stop still costs` reaches the mark. That gap is monotonic in time (later means less
  // road), so the first sample that crosses the mark brackets it and interpolation lands on it.
  let prev = { t: 0, v: now.v, gap: gapM };
  const d = ruleset.drivetrain;
  const vehicle = ruleset.vehicle;
  let v = now.v;
  let rpm = now.rpm;
  let gap = gapM;
  let t = 0;
  for (let i = 0; i < MAX_SEARCH_S / DT; i += 1) {
    const governor = Math.min(d.idle_max_nm, Math.max(0, (d.idle_target_rpm - rpm) * d.idle_gain_nm_per_rpm));
    const indicated = engineTorque(ruleset, rpm, now.throttle);
    const friction = d.friction_base_nm + d.friction_per_rpm * rpm;
    const drag = clutchTorque(ruleset, rpm, v, now.clutch);
    rpm += ((indicated + governor - friction - drag) / d.engine_inertia_kgm2 * DT) / RADPS_PER_RPM;
    if (rpm < d.stall_rpm) rpm = d.stall_rpm;
    const driveN = driveForce(ruleset, clutchTorque(ruleset, rpm, v, now.clutch));
    const grade = road.grade(gap);
    const slopeN = -(vehicle.mass_kg * GRAVITY_MPS2 * (grade / Math.sqrt(1 + grade * grade)));
    const pushN = driveN + slopeN;
    const dragN = d.drag_n_per_mps2 * v * v;
    const staticN = d.rolling_n;
    const netN =
      Math.abs(v) < 1e-9
        ? Math.abs(pushN) <= staticN
          ? 0
          : pushN - Math.sign(pushN) * staticN
        : pushN - Math.sign(v) * (d.rolling_n + dragN);
    const next = v + (netN / vehicle.mass_kg) * DT;
    const crossed = next * v < 0;
    const driveline = driveN * next > 0;
    const gravity = slopeN * next > 0 && Math.abs(pushN) > staticN;
    v = crossed && !driveline && !gravity ? 0 : next;
    gap -= v * DT;
    t += DT;

    // Where would the car stop if the key landed at this moment?
    const landsAt = gap - stopTravel(ruleset, v, road, road.key, gap, road.key === 'brake' && !clutchDown).travelM;
    if (landsAt <= A_MID_M) {
      // Between the previous sample and this one. Interpolate on the landing point, which is smooth.
      const prevLands =
        prev.gap - stopTravel(ruleset, prev.v, road, road.key, prev.gap, road.key === 'brake' && !clutchDown).travelM;
      const span = landsAt - prevLands;
      const f = span === 0 ? 1 : Math.min(1, Math.max(0, (A_MID_M - prevLands) / span));
      return { etaS: prev.t + (t - prev.t) * f, gapM: prev.gap + (gap - prev.gap) * f };
    }
    prev = { t, v, gap };
    // Past the line nothing is being timed any more, and the run has no reason to continue.
    if (gap <= 0) return null;
    // Already past the mark: the key is due now, and stays due until the car has stopped. A learner
    // polling every 16 ms would otherwise be able to step over the one tick where it turns 0.
    if (gap - stopTravel(ruleset, v, road, road.key, gap, road.key === 'brake' && !clutchDown).travelM < A_MID_M) {
      return { etaS: 0, gapM: gap };
    }
  }
  // The run gave up before the car reached the mark: it is still far away (the approach can start
  // metres out, and a long forward run is not worth publishing), so there is no countdown yet.
  return null;
}

/**
 * The aid for this tick, or null when no key is being timed: the run is over or suspended, the car is
 * not being driven toward the line (engine off, not in first, handbrake on) or it is standing still.
 *
 * Once the critical key is already down the countdown is over — the stop is happening and the answer
 * is "now, here" — so both countdowns are 0 and the mark is the gap the car is at. Without that a
 * script that polls after the press reads a fresh positive countdown for a car that is already
 * slowing, plans a second press, and releases the keys in between.
 *
 * There is no aid at all while the drive is open on the clutch road: a car in first with the clutch
 * down is setting off or changing gear, not rolling to a stop. On the brake road the clutch is
 * *expected* down (the advice line asks for it first), so only the brake itself ends that countdown.
 */
export function stopAid(state: SimState, ruleset: Ruleset, road: StopRoad): StopAid | null {
  if (state.disqualified || state.phase === 'done') return null;
  if (!state.engineOn || state.gear !== 1 || state.handbrake) return null;
  if (state.sinceStopTicks >= 0) return null;
  const v = state.speedMps;
  if (v <= MOVING_MPS) return null;
  const gapM = state.lineGapM;
  if (road.key === 'clutch' && state.clutch > 0.05) return null;
  if (road.key === 'brake' && state.brake > 0.05) {
    return { key: road.key, etaMs: 0, markEtaMs: 0, now: true, gapM, markM: gapM };
  }
  // On the brake road the page's one key is "Phanh", and the learner presses the clutch with it — the
  // advice line says so and a brake in gear stalls the engine. So the stop is timed for both pedals
  // going down together, unless the clutch is already down.
  const clutchDown = state.clutch > 0.9;
  const point = pressPoint(
    ruleset,
    { v, rpm: state.rpm, clutch: state.clutch, throttle: state.throttle },
    road,
    gapM,
    clutchDown,
  );
  if (!point) return null;
  const markEtaMs = Math.max(0, Math.round(point.etaS * 1000));
  if (markEtaMs - LEAD_MS > MAX_ETA_S * 1000) return null;
  // Two moments, because one number cannot serve both learners. `markEtaMs` is the bar's: a press that
  // starts then lands the car at A_MID_M. `etaMs` is what the words and `data-aid-eta-ms` carry, and it
  // leads the mark by LEAD_MS — so 0 means "bấm ngay" for a learner who then takes a reaction to press,
  // and a script that schedules its press from the attribute lands on the mark too.
  //
  // Both stay at 0 once passed, until the car has stopped: the due instant is otherwise a window of a
  // tick or two, and a learner polling every 16 ms can step clean over it.
  const etaMs = markEtaMs;
  return { key: road.key, etaMs, markEtaMs, now: etaMs <= LEAD_MS, gapM, markM: point.gapM };
}
