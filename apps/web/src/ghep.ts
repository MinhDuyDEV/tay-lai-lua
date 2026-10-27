// Bài 7 and bài 8: ghép xe vào nơi đỗ — the reverse park, and the planner that talks the learner into it.
//
// Both figures are one flat area (bài 7's control lane, bài 8's road) with a rectangular bay off it.
// The core publishes the two rectangles as `sim_course` records of kind 8 (`parkRects`), scores the
// wheel patches against the paint (`SH.GHEP.DE_VACH`, one point per episode) and gives the finish
// signal when the whole hull has stood still inside the bay for `signal_hold_s`. So this file holds
// only the page's side: where the body is, what a plan costs, and the two words the advice line
// publishes — a steering key and a pedal.
//
// Why a search and not a script: measured on the real core (M1), a reverse-only line into either bay
// drags a rear contact patch over the bay's mouth corner — the tightest single-shot line is 0.72 m
// outside the paint on bài 7 — while a line with a forward shuffle is clean. A learner also stops
// wherever they stop, so every tick the plan is re-solved from the pose the snapshot publishes, and the
// cue names the next leg of that plan. Nothing here is a fixed sequence of taps.

import { steerFeel, FEEL } from '../input/driver.ts';
import type { Ruleset } from './ruleset.ts';
import type { ParkRects, SimState } from './sim/session.ts';

export type GhepLesson = 7 | 8;

/** A pose in the sim's frame: `carX`/`carY` is the car's centre (the core's reference point). */
export interface Pose {
  x: number;
  y: number;
  h: number;
}

export type Pt = readonly [number, number];
export type Rect = readonly [number, number, number, number];

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const HALF_PI = Math.PI / 2;

/** The bay and the ground around it, as the core publishes them. */
export interface Yard {
  area: Rect;
  bay: Rect;
}

export function yardOf(rects: ParkRects): Yard {
  return { area: rects.area, bay: rects.bay };
}

/**
 * The parked pose the exercise scores: the bay's centre, with the car square to the bay's long axis.
 * Both figures park the car along the longer side of the bay (bài 7 nose-out toward the lane, bài 8
 * nose the way the traffic goes), and the longer side is the bay's x extent on both.
 */
export function holdPose(yard: Yard): Pose {
  const [bx0, by0, bx1, by1] = yard.bay;
  const alongX = bx1 - bx0 >= by1 - by0;
  return { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2, h: alongX ? 0 : HALF_PI };
}

/** The four corners of the body at a pose, in the sim's frame. */
export function hull(p: Pose, ruleset: Ruleset): [Pt, Pt, Pt, Pt] {
  const hl = ruleset.vehicle.length_m / 2;
  const hw = ruleset.vehicle.width_m / 2;
  const c = Math.cos(p.h);
  const s = Math.sin(p.h);
  return [
    [p.x + hl * c - hw * s, p.y + hl * s + hw * c],
    [p.x + hl * c + hw * s, p.y + hl * s - hw * c],
    [p.x - hl * c + hw * s, p.y - hl * s - hw * c],
    [p.x - hl * c - hw * s, p.y - hl * s + hw * c],
  ];
}

const inRect = (x: number, y: number, r: Rect): boolean => x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3];

/**
 * The whole body inside the bay. Not the page's verdict — the core's `hullInside` is `sim_state`'s —
 * but the Inset and the advice line need the same answer to explain what is still sticking out.
 */
export function hullInsideBay(p: Pose, yard: Yard, ruleset: Ruleset, inset = 0): boolean {
  const [x0, y0, x1, y1] = yard.bay;
  const inner: Rect = [x0 + inset, y0 + inset, x1 - inset, y1 - inset];
  return hull(p, ruleset).every(([x, y]) => inRect(x, y, inner));
}

/** How many of the four hull corners are still outside the bay, and by how much, worst first. */
export function hullOutside(yard: Yard, ruleset: Ruleset, p: Pose): number {
  const [bx0, by0, bx1, by1] = yard.bay;
  let worst = 0;
  for (const [x, y] of hull(p, ruleset)) {
    const d = Math.max(bx0 - x, x - bx1, by0 - y, y - by1, 0);
    worst = Math.max(worst, d);
  }
  return worst;
}

/**
 * Signed distance from a point to the boundary of the free space — the union of the lane (the area
 * rectangle) and the bay. The two rectangles share the mouth, so the union's boundary is: every edge
 * of either rectangle that is NOT part of the shared mouth.
 *
 * Positive inside the union, negative outside; the magnitude is the distance to the nearest wall, so a
 * caller can see how much room a patch has. Getting this right matters more than it looks: a wheel
 * just inside the bay near its mouth is a third of a metre from any wall, while the same wheel 1 cm
 * across the mouth line is on the paint — the union has to be measured as one region, not as two
 * rectangles with the nearest one winning.
 */
/** The free space's walls as flat segments [x0,y0,x1,y1…], cached per figure: this runs millions of times. */
const wallCache = new WeakMap<Yard, Float64Array>();
function wallsOf(yard: Yard): Float64Array {
  let w = wallCache.get(yard);
  if (!w) {
    const [ax0, ay0, ax1, ay1] = yard.area;
    const [bx0, by0, bx1, by1] = yard.bay;
    w = Float64Array.from([
      // the area's four sides; its near side is split by the mouth so the bay is not walled off
      ax0, ay0, ax0, ay1,
      ax1, ay0, ax1, ay1,
      ax0, ay1, ax1, ay1,
      ax0, ay0, bx0, ay0,
      bx1, ay0, ax1, ay0,
      // the bay's three closed sides
      bx0, by1, bx0, by0,
      bx1, by1, bx1, by0,
      bx0, by0, bx1, by0,
    ]);
    wallCache.set(yard, w);
  }
  return w;
}

function clearance(yard: Yard, x: number, y: number): number {
  const [ax0, ay0, ax1, ay1] = yard.area;
  const [bx0, by0, bx1, by1] = yard.bay;
  const inside =
    (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1) || (x >= bx0 && x <= bx1 && y >= by0 && y <= by1);
  const w = wallsOf(yard);
  let best = Infinity;
  for (let i = 0; i < w.length; i += 4) {
    const ex = w[i + 2] - w[i];
    const ey = w[i + 3] - w[i + 1];
    const l2 = ex * ex + ey * ey;
    let t = l2 === 0 ? 0 : ((x - w[i]) * ex + (y - w[i + 1]) * ey) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (w[i] + t * ex);
    const dy = y - (w[i + 1] + t * ey);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  const d = Math.sqrt(best);
  return inside ? d : -d;
}

/**
 * The worst clearance the four wheel patches see at one pose, metres. The patch geometry is the
 * core's (`sa_hinh.tyre_width_m`, `patch_length_m`, `track_m`), so this number is the one the scorer
 * charges on, and a plan is only clean while it stays above zero.
 */
export function patchMargin(p: Pose, yard: Yard, ruleset: Ruleset): number {
  work += 1;
  const sh = ruleset.sa_hinh;
  if (!sh) return 0;
  const c = Math.cos(p.h);
  const s = Math.sin(p.h);
  const halfBase = ruleset.vehicle.wheelbase_m / 2;
  const halfTrack = sh.track_m / 2;
  const hl = sh.patch_length_m / 2;
  const hw = sh.tyre_width_m / 2;
  const reach = Math.hypot(hl, hw);
  let worst = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const lx = i < 2 ? halfBase : -halfBase;
    const ly = i % 2 === 0 ? halfTrack : -halfTrack;
    const wx = p.x + lx * c - ly * s;
    const wy = p.y + lx * s + ly * c;
    // Clearance changes no faster than the point moves: a wheel whose centre is further from every wall
    // than the patch is wide, plus what the worst so far already is, cannot lower the minimum.
    if (clearance(yard, wx, wy) - reach >= worst) continue;
    // A 5 x 3 grid: with only the corners and the middle a line running obliquely past the patch's long
    // edge can be closer to the edge's midpoint than to any sampled point.
    for (let j = -2; j <= 2; j += 1) {
      for (let k = -1; k <= 1; k += 1) {
        const dx = (j / 2) * hl;
        const dy = k * hw;
        const d = clearance(yard, wx + dx * c - dy * s, wy + dx * s + dy * c);
        if (d < worst) worst = d;
      }
    }
  }
  // A patch is on the paint once it is within half the painted width of the line's centre.
  return worst - 0.5 * sh.line_width_m;
}

/** One leg: a direction of travel, a wheel lock, and how far to go. */
export interface Leg {
  /** +1 forward (gear 1), −1 reverse (gear R). */
  dir: 1 | -1;
  /** Wheel angle in radians, + left. Held fixed for the leg, as a keyboard does. */
  steerRad: number;
  len: number;
}

/**
 * A pose after driving `legs`. The core integrates `yaw = v·tan δ / wheelbase` with the wheel fixed
 * (`vehicle.rs`), so a leg is an arc in closed form and the planner never has to step the sim to price
 * a plan.
 */
export function endPose(from: Pose, legs: readonly Leg[], ruleset: Ruleset): Pose {
  const base = ruleset.vehicle.wheelbase_m;
  let { x, y, h } = from;
  for (const leg of legs) {
    const k = Math.tan(leg.steerRad) / base;
    const dh = leg.dir * k * leg.len;
    if (Math.abs(k) < 1e-9) {
      x += leg.dir * leg.len * Math.cos(h);
      y += leg.dir * leg.len * Math.sin(h);
      continue;
    }
    const r = 1 / k;
    // The heading rate already carries `dir` (dh above), so the radius must not: x = ∫dir·cos h ds with
    // h = h0 + dir·k·s gives r·(sin h1 − sin h0) for both directions. A second `dir` here mirrored every
    // reverse arc (measured: a reverse on full lock landed 2.6 m from the core's pose, the forward ones
    // within 3 cm), which is why no reverse line could ever be fitted to the core's.
    x += r * (Math.sin(h + dh) - Math.sin(h));
    y += r * (Math.cos(h) - Math.cos(h + dh));
    h += dh;
  }
  return { x, y, h };
}

/** The wheel the keyboard can actually hold at a speed: the same law `driver.ts` winds the wheel by. */
export function wheelAt(ruleset: Ruleset, speedMps: number): number {
  const v = Math.abs(speedMps) / steerFeel.speedScaleMps;
  const frac = Math.max(steerFeel.minLock, 1 / (1 + v * v));
  return frac * ruleset.vehicle.max_steer_rad;
}

/** A priced plan: the legs, where they end, and what they cost. */
export interface Plan {
  legs: readonly Leg[];
  end: Pose;
  /** Worst wheel-patch clearance along the plan, metres (negative = the plan touches the paint). */
  margin: number;
  /** How many times the direction of travel changes. */
  shunts: number;
  /** Metres to drive in total. */
  length: number;
  /** The launch pose a forward lead-in was aimed at, when the plan has one. */
  launch?: Pose;
}

/**
 * Walk one leg and price it. A leg that grazes the paint anywhere is rejected outright: the search
 * must not be able to reach the bay by driving over a line, and `SH.GHEP.DE_VACH` is charged on the
 * first touch. The *whole-plan* test — is it square in the bay — belongs to the search, not here, so
 * that a first leg which drives away from the bay can still be expanded.
 */
function walkLeg(from: Pose, leg: Leg, yard: Yard, ruleset: Ruleset): { end: Pose; margin: number } | null {
  let p = from;
  let margin = Infinity;
  const steps = Math.max(1, Math.ceil(leg.len / 0.15));
  for (let i = 0; i < steps; i += 1) {
    p = endPose(p, [{ ...leg, len: leg.len / steps }], ruleset);
    margin = Math.min(margin, patchMargin(p, yard, ruleset));
    if (margin <= 0) return null;
  }
  // The brake lands a hand's width past where the leg ends: that stretch must be clear too.
  let q = p;
  for (let i = 0; i < 2; i += 1) {
    q = endPose(q, [{ ...leg, len: STOP_OVERSHOOT_M / 2 }], ruleset);
    margin = Math.min(margin, patchMargin(q, yard, ruleset));
  }
  if (margin <= 0) return null;
  return { end: p, margin };
}
/** How far past the end of a leg the car may still roll, metres: a 50 ms poll at the creep and a bit. */
const STOP_OVERSHOOT_M = 0.001;

export type GhepCue = 'left' | 'right' | 'straight';

/**
 * The pedal the page asks for, one value:
 * `creep` — feet off, the clutch is up and the car is moving on its own;
 * `brake` — hold ↓ now, the car is at the place this leg ends;
 * `clutch` — hold Space, the car has to change gear direction and only shifts with the pedal down;
 * `wheel` — stand on the pedals and hold the arrow until the wheel is at the lock the leg wants;
 * `hold` — stand on ↓ and stay there; the car is parked and the signal is counting.
 */
/**
 * One value per attribute. `park` means "release the handbrake, this is the first thing" — the same
 * word the driving school starts with and the same one `P` does; it is not folded into `hold`, because
 * a learner told to hold the brake with the handbrake still on never moves at all.
 */
export type GhepPedal = 'creep' | 'brake' | 'clutch' | 'hold' | 'park' | 'enter' | 'wheel';

/** What the page tells the learner to do this tick. */
export interface GhepCueNow {
  steer: GhepCue;
  pedal: GhepPedal;
  /** Which gear the next leg needs: 1 forward, −1 reverse, 0 = stay in what you have. */
  gear: 1 | -1 | 0;
  /** True once the hull is inside the bay and the car is standing in it. */
  parked: boolean;
  /** The plan this tick's cue came from, for the HUD's own drawing. Null when none was found. */
  plan: Plan | null;
}

/**
 * How far the car still travels after the learner reads the line and presses: the reaction plus the
 * brake's own stopping distance. It is the reason the cue asks for the brake *before* the place the
 * leg ends, and it is why the whole manoeuvre is pulses: at the reverse creep a 400 ms read is 0.7 m,
 * which is wider than the bay's slack.
 */
export function stoppingLeadM(ruleset: Ruleset, speedMps: number, reactionS: number): number {
  const v = Math.abs(speedMps);
  const decel = ruleset.drivetrain.brake_max_n / ruleset.vehicle.mass_kg;
  // The pedal itself takes `1 / FEEL.brake.rise` seconds to reach the floor; the stop starts part-way.
  const pedalS = 1 / FEEL.brake.rise;
  return v * reactionS + (v * v) / (2 * Math.max(1, decel)) + v * pedalS * 0.5;
}

/**
 * The cue for this tick. The plan is re-solved from the pose the snapshot publishes, so a learner who
 * stopped somewhere else gets a different — and still exact — line rather than a script that no longer
 * fits.
 *
 * `reactionS` is the read-and-press the page is built for; the brake is asked for that much road early.
 */
export function cueGhep(s: SimState, yard: Yard, ruleset: Ruleset, reactionS = READ_S): GhepCueNow {
  // A run that starts over (the tick counter went back) starts without the last run's memory.
  if (s.tick < lastTick) forget();
  lastTick = s.tick;
  warmUp(yard, ruleset);
  const pose: Pose = { x: s.carX, y: s.carY, h: s.heading };
  const parked = s.hullInside && Math.abs(s.speedMps) < 0.05;
  if (parked) return { steer: 'straight', pedal: 'hold', gear: 0, parked: true, plan: null };
  // While the learner is still starting the car (clutch, gear, handbrake) the first plan is worked out.
  if (s.gear === 0 || s.handbrake) runFor(pose, false, yard, ruleset);
  // The start order the driving school teaches, and the one `PARK_STEPS` lists: clutch, first gear, then
  // the handbrake. Saying "release the brake" while the lever is still in neutral is the wrong order: the
  // car would roll with nothing engaged.
  if (s.gear === 0) return { steer: 'straight', pedal: 'clutch', gear: 1, parked: false, plan: null };
  if (s.handbrake) return { steer: 'straight', pedal: 'park', gear: 0, parked: false, plan: null };
  if (s.finishSignal || s.disqualified || s.phase === 'done') {
    // The finish is the one instruction the learner must not miss: `enter` is its own word, so the model
    // (and the page) never has to guess whether "stand on the brake" also means "press Enter".
    return { steer: 'straight', pedal: 'enter', gear: 0, parked, plan: null };
  }
  const speed = Math.abs(s.speedMps);
  const moving = speed > 0.05;
  const run = runFor(pose, moving, yard, ruleset);
  const plan = run?.plan ?? null;
  const leg = plan?.legs[0];
  if (!plan || !leg) {
    // No line from here (or the car is already in): hold still and say so rather than invent a wheel.
    return { steer: 'straight', pedal: 'brake', gear: 0, parked, plan: null };
  }
  const steer: GhepCue = leg.steerRad > 0.06 ? 'left' : leg.steerRad < -0.06 ? 'right' : 'straight';
  if (moving) {
    // Rolling on the leg: the brake word comes when the road still to run equals the road the stop needs.
    // A reverse leg is driven in pulses: one tap moves the car at most `pulseM`, then the car stops and the
    // cue is solved again from where it stands. At the reverse creep a late reader's error is a speed times
    // a reaction, and only a car that is still slow when the brake word lands keeps the S inside its band.
    const reach = leg.dir === -1 ? Math.min(leg.len, pulseM(ruleset)) : leg.len;
    const left = reach - legProgress(run!.anchor, pose, leg, ruleset);
    return { steer, pedal: left <= stoppingLeadM(ruleset, speed, reactionS) ? 'brake' : 'creep', gear: 0, parked, plan };
  }
  // Standing: the right gear first (clutch to the floor), then feet off, wheel already over.
  if (s.gear !== leg.dir) return { steer, pedal: 'clutch', gear: leg.dir, parked, plan };
  // The lock goes on while the car stands: a leg started with the wheel still travelling is another arc.
  // `wheel` is "hold the arrow, stay on the pedals"; `creep` only comes once the wheel is where the leg wants it.
  const wheelSet = Math.abs(s.steerRad - leg.steerRad) <= WHEEL_SET_RAD * ruleset.vehicle.max_steer_rad;
  return { steer, pedal: wheelSet ? 'creep' : 'wheel', gear: 0, parked, plan };
}

/**
 * How long the page assumes a learner takes from the cue changing to the pedal being down, seconds: the
 * slowest reader the page is meant for (a 400 ms reaction, a 50 ms poll and the pedal's own rise). A
 * quicker reader stops a little short, which the next stop's plan absorbs; a slower one overshoots.
 */
export const READ_S = 0.45;

/**
 * How near the wheel must be to the lock a leg wants before the car is let go, as a share of full lock. Wide,
 * the arc is a larger circle than the plan's (a wheel 10% short is a radius 11% long: 0.1 m across the S).
 */
const WHEEL_SET_RAD = 0.02;

/** The gear word for the advice line: what to hold down before the gear goes in. */
export const gearWord = (dir: 1 | -1): '1' | 'R' => (dir === 1 ? '1' : 'R');

/** The reverse creep the cue is priced at, from the ruleset's own reverse ratio (never a literal). */
export function reverseCreepMps(ruleset: Ruleset): number {
  const { idle_target_rpm: idle, final_drive: final, gears } = ruleset.drivetrain;
  const ratio = gears['-1'] ?? gears['1'];
  return Math.abs(((idle / ratio) / final) * 2 * Math.PI * ruleset.vehicle.wheel_radius_m) / 60;
}

const m = (v: number) => `${Math.round(v * 100) / 100} m`;

/**
 * The plan made where the car last stood, and where that was. A plan is solved once per stop (it takes a
 * few hundred milliseconds, the frame's whole budget, and the car cannot act on a difference smaller than
 * a few centimetres); while the car rolls the cue only measures progress along the first leg of that plan.
 * The next stop drops it and solves again from the pose the snapshot publishes, so an error in one leg
 * is never carried into the next.
 */
interface Run {
  key: string;
  anchor: Pose;
  plan: Plan | null;
}
let lastRun: Run | null = null;
/** Launch poses the car has reached without the S working from them: not aimed at again. */
let failedLaunch: Pose[] = [];
let runYard = '';
/** How often the car has stood at each (rounded) pose: standing in one place three times is a loop. */
let visits = new Map<string, number>();
let lastTick = 0;
/** For the last few plans: did it open with a straight shunt? */
let recentShunts: boolean[] = [];
let lastShunt: { dir: 1 | -1; pose: Pose } | null = null;

/** Drop everything the planner remembers about the run in progress. */
function forget(): void {
  lastRun = null;
  pending = null;
  failedLaunch = [];
  visits = new Map();
  recentShunts = [];
  lastShunt = null;
  runYard = '';
}

/** Clearance checks done so far: the planner's measure of work, which is the same on every machine. */
let work = 0;
export const plannerWork = (): number => work;

/** Wall-clock milliseconds one frame may give to planning: the frame's budget is 16, drawing needs most. */
const SLICE_MS = 5;
/** Tests count clearance checks instead of milliseconds so a sweep is the same on every machine. */
let sliceWork: number | null = null;
export function setSliceWork(n: number | null): void {
  sliceWork = n;
}

/** When the page last spent its planning slice: the HUD asks for the cue several times a frame. */
let lastSliceAt = -Infinity;

/** Give a job one frame's share of work. Returns its result once it is finished, otherwise null. */
function advance<T>(job: Job<T>): { value: T } | null {
  const t0 = performance.now();
  // A second ask within the same frame (the HUD reads the cue for the arrow, the pedal and the sentence)
  // must not spend a second slice.
  if (sliceWork === null && t0 - lastSliceAt < SLICE_MS) return null;
  const w0 = work;
  for (;;) {
    const r = job.next();
    if (r.done) return { value: r.value };
    if (sliceWork !== null ? work - w0 >= sliceWork : performance.now() - t0 >= SLICE_MS) break;
  }
  lastSliceAt = performance.now();
  return null;
}

/** The plan being worked out for a stop, and the stop it is for. */
let pending: { key: string; job: Job<Run> } | null = null;
let warm: { key: string; job: Job<Launch> } | null = null;

/** True while the cue is waiting on the planner: the car is held still and the HUD says so. */
export let thinking = false;

/** Build the launch table while the learner is still getting the car going, so no stop ever pays for it. */
function warmUp(yard: Yard, ruleset: Ruleset): void {
  const key = `${yard.area.join(',')}|${yard.bay.join(',')}|${ruleset.vehicle.wheelbase_m}`;
  if (launchCache.has(key)) return;
  if (!warm || warm.key !== key) warm = { key, job: launchSetJob(yard, ruleset) };
  if (advance(warm.job)) warm = null;
}

function* solveJob(pose: Pose, key: string, yard: Yard, ruleset: Ruleset): Job<Run> {
  const yardKey = yard.bay.join(',');
  if (yardKey !== runYard) {
    runYard = yardKey;
    failedLaunch = [];
    lastRun = null;
    visits = new Map();
  }
  // Arrived where the last plan aimed and still no S from here: that aim does not work, choose another.
  const aimed = lastRun?.plan?.launch ?? null;
  if (aimed && close(pose, aimed, 0.45, 0.15) && !failedLaunch.some((f) => close(f, aimed, 0.01, 0.01))) {
    const direct = yield* reverseWithShuntJob(pose, yard, ruleset);
    if (!direct) failedLaunch = [...failedLaunch.slice(-11), aimed];
  }
  const spot = `${Math.round(pose.x / 0.2)},${Math.round(pose.y / 0.2)},${Math.round(pose.h / 0.06)}`;
  const seen = (visits.get(spot) ?? 0) + 1;
  visits.set(spot, seen);
  // The third time the car stands in the same place the shunts are not working: aim somewhere else.
  // Or the last plans were mostly shunts: a shunt is a straight move and cannot undo a heading the S left.
  const looping = seen >= 3 || recentShunts.filter(Boolean).length >= 3;
  if (looping && aimed) failedLaunch = [...failedLaunch.slice(-11), aimed];
  // The car keeps coming back here, so the line that clears by a hair is better than the next shunt:
  // the buffer is spent (2nd visit onwards).
  const floor = seen >= 2 ? 0 : COMMITTED_MARGIN;
  let plan = yield* planParkJob(pose, yard, ruleset, failedLaunch, aimed, looping, floor);
  // A shunt that just undoes the last one (forward 0.2, then back 0.2, the car landing either side of a
  // window it cannot hit) is not a plan: look for a different two moves instead.
  const f0 = plan?.legs[0];
  if (plan && f0 && f0.steerRad === 0 && lastShunt && f0.dir === -lastShunt.dir && close(pose, lastShunt.pose, 0.8, 0.3)) {
    const other = yield* recoverJob(pose, yard, ruleset, floor);
    if (other) plan = other;
  }
  lastShunt = plan?.legs[0] && plan.legs[0].steerRad === 0 && (plan.shunts ?? 0) > 0 ? { dir: plan.legs[0].dir, pose } : null;
  const first = plan?.legs[0];
  recentShunts = [...recentShunts.slice(-5), Boolean(first && first.steerRad === 0 && (plan?.shunts ?? 0) > 0)];
  if (looping) recentShunts = [];
  return { key, anchor: pose, plan };
}

/**
 * The plan made at the last stop, picked up again where the car now stands, if the car is still on it.
 * A tap lands a few centimetres short or long along a leg, and that is no reason to look for another
 * line: only a car that has left the line (more than `OFF_LINE_M` across it or `OFF_LINE_RAD` crooked)
 * is planned afresh. Without this the solver, sitting on the edge of what fits, answers every small
 * difference with a different manoeuvre and the car shuffles on the spot.
 */
const OFF_LINE_M = 0.07;
const OFF_LINE_RAD = 0.04;
function pickUp(run: Run, pose: Pose, yard: Yard, ruleset: Ruleset): Run | null {
  const plan = run.plan;
  if (!plan || plan.legs.length === 0) return null;
  let p = run.anchor;
  let best: { li: number; d: number; off: number } | null = null;
  for (let li = 0; li < plan.legs.length; li += 1) {
    const leg = plan.legs[li];
    for (let d = 0; d <= leg.len + 1e-9; d += 0.05) {
      const q = endPose(p, [{ ...leg, len: Math.min(d, leg.len) }], ruleset);
      const off = Math.hypot(q.x - pose.x, q.y - pose.y);
      if (off <= OFF_LINE_M && Math.abs(wrap(q.h - pose.h)) <= OFF_LINE_RAD && (!best || off < best.off)) best = { li, d, off };
    }
    p = endPose(p, [leg], ruleset);
  }
  if (!best) return null;
  const rest = plan.legs.slice(best.li);
  rest[0] = { ...rest[0], len: rest[0].len - best.d };
  const legs = rest[0].len < MIN_LEG_M ? rest.slice(1) : rest;
  if (legs.length === 0) return null;
  // Being near the line is not being able to finish it: the rest of it, driven from where the car really
  // stands, must still clear the paint, and a line that ended inside the bay must still end inside it.
  let q = pose;
  let margin = Infinity;
  for (const leg of legs) {
    const w = walkLeg(q, leg, yard, ruleset);
    if (!w) return null;
    q = w.end;
    margin = Math.min(margin, w.margin);
  }
  if (margin < COMMITTED_MARGIN) return null;
  if (hullInsideBay(plan.end, yard, ruleset, HULL_INSET) && !hullInsideBay(q, yard, ruleset, HULL_INSET)) return null;
  return { key: run.key, anchor: pose, plan: { ...plan, legs } };
}

/**
 * The run for this stop. While the car rolls it is the plan made at the last stop; at a new stop the plan
 * is worked out a slice per call, and until it is done the answer is null (the cue says "hold still").
 */
function runFor(pose: Pose, moving: boolean, yard: Yard, ruleset: Ruleset): Run | null {
  thinking = false;
  if (moving && lastRun) return lastRun;
  const key = [
    yard.bay.join(','),
    Math.round(pose.x / 0.04),
    Math.round(pose.y / 0.04),
    Math.round(pose.h / (Math.PI / 360)),
  ].join('|');
  // The car creeping off at under 0.05 m/s is still the same stop: the plan is for where it stood, not for
  // each centimetre it gives while the clutch bites.
  if (lastRun && (lastRun.key === key || (lastRun.plan && close(pose, lastRun.anchor, 0.1, 0.03)))) return lastRun;
  if (lastRun && !pending) {
    const kept = pickUp(lastRun, pose, yard, ruleset);
    if (kept) {
      lastRun = { ...kept, key };
      return lastRun;
    }
  }
  if (!pending || pending.key !== key) pending = { key, job: solveJob(pose, key, yard, ruleset) };
  const done = advance(pending.job);
  if (!done) {
    thinking = true;
    return null;
  }
  pending = null;
  lastRun = done.value;
  return lastRun;
}

/** Metres of `leg` driven since `anchor`: path along the arc (from the heading turned), or the chord. */
function legProgress(anchor: Pose, now: Pose, leg: Leg, ruleset: Ruleset): number {
  const k = Math.tan(leg.steerRad) / ruleset.vehicle.wheelbase_m;
  if (Math.abs(k) < 1e-9) return Math.hypot(now.x - anchor.x, now.y - anchor.y);
  return Math.abs(wrap(now.h - anchor.h)) / Math.abs(k);
}

/**
 * The line the learner reads, one sentence, always starting with the key it asks for.
 *
 * It teaches the reference points a driving school names out loud — where to stop, when to put the
 * wheel over, when to straighten, when to stand on the brake — because a keyboard learner cannot feel
 * the car and has only the picture and this sentence. The sentence for each stage is chosen from the
 * cue the same tick, so the words and `data-cue` cannot disagree.
 */
export function adviceGhep(
  s: SimState,
  yard: Yard,
  ruleset: Ruleset,
  lesson: GhepLesson,
  reactionS = READ_S,
): string {
  const name = lesson === 7 ? 'bài 7' : 'bài 8';
  const bayW = yard.bay[2] - yard.bay[0];
  const bayD = yard.bay[3] - yard.bay[1];
  if (s.disqualified) return 'Đã bị đình chỉ. Bấm Esc để làm lại.';
  if (s.finishSignal || s.phase === 'done') {
    return `Đã có tín hiệu báo kết thúc: thân xe nằm trọn trong ô ${name}. Bấm Enter để kết thúc, Esc để làm lại.`;
  }
  if (!s.engineOn) return 'Máy đã tắt. Đạp côn (giữ Space) rồi bấm E để nổ lại.';
  if (s.gear === 0) return 'Đạp côn hết cỡ (giữ Space), bấm 1 để vào số, rồi bấm P nhả phanh tay.';
  if (s.handbrake) return 'Phanh tay đang kéo nên xe đứng yên. Bấm P để nhả.';

  const cue = cueGhep(s, yard, ruleset, reactionS);
  const still = Math.abs(s.speedMps) < 0.05 && Math.abs(s.speedMps) >= 0;
  const plan = cue.plan;
  const leg = plan?.legs[0];

  // Parked but not yet signalled: the core needs the hull inside AND the car exactly still for 0.5 s,
  // so the one instruction that matters is "stand on the brake".
  if (s.hullInside && still) {
    return 'Xe đã nằm trọn trong ô. Giữ phanh ↓ cho xe đứng yên đến khi có tín hiệu báo kết thúc, rồi bấm Enter.';
  }
  if (s.hullInside && !still) {
    return 'Thân xe đã vào ô: giữ phanh ↓ cho xe dừng hẳn và đứng yên — tín hiệu chỉ hiện khi xe đứng yên.';
  }
  // Just outside: say which way it is short, in metres, so the learner can nudge.
  const outside = hullOutside(yard, ruleset, { x: s.carX, y: s.carY, h: s.heading });
  if (cue.parked || outside > 0) {
    const inBay = hullInsideBay({ x: s.carX, y: s.carY, h: s.heading }, yard, ruleset);
    if (!inBay && outside > 0 && outside < 1.2) {
      return `Còn ${m(outside)} thân xe ngoài ô: lùi thêm thật chậm (R, giữ côn ở điểm bắt) cho hết thân xe vào, rồi giữ phanh ↓.`;
    }
  }
  if (thinking) return 'Giữ phanh ↓ và côn: đang tính đường lùi từ chỗ xe đứng.';
  if (!plan || !leg) {
    return `Chưa tìm được đường từ chỗ này: giữ phanh ↓ và côn, bấm Esc để làm lại. ${name} rộng ${m(bayW)}, sâu ${m(bayD)}.`;
  }

  // One sentence per step of the leg, each opening with the key it asks for, so the line and `data-pedal`
  // cannot disagree: first the gear, then the wheel with the car standing, then feet off, then the brake.
  const way = leg.dir === 1 ? 'tiến' : 'lùi';
  const arrow = cue.steer === 'left' ? '←' : cue.steer === 'right' ? '→' : null;
  const lock = arrow ? `giữ ${arrow} (đánh hết lái)` : 'thẳng lái (không bấm ← →)';
  if (cue.pedal === 'clutch') {
    return `Đạp côn hết cỡ (giữ Space) và giữ phanh ↓, bấm ${gearWord(leg.dir)} để vào số ${way}.`;
  }
  if (cue.pedal === 'wheel') {
    return `Xe còn đứng yên: ${lock} cho vô lăng vào đúng góc, giữ côn Space và phanh ↓ đến khi hết lái.`;
  }
  if (cue.pedal === 'brake') {
    return 'Đạp côn (Space) và phanh ↓ ngay cho xe dừng hẳn; đợi lời nhắc kế tiếp.';
  }
  return `Nhả phanh ↓ rồi nhả côn thật chậm, ${lock}, ${way} khoảng ${m(leg.len)} rồi đạp côn và phanh ↓ dừng hẳn.`;
}


/**
 * The clearance a plan must keep from a pose: the usual floor, but never more than the car already has.
 * A car that stopped 3 cm off the paint is still allowed to drive away from it; one that must first be
 * 5 cm clear would be stuck for good.
 */
const floorFrom = (from: Pose, yard: Yard, ruleset: Ruleset, floor: number): number =>
  Math.min(floor, patchMargin(from, yard, ruleset) - 0.002);

/** A job the planner can run a slice at a time: it yields between units of work and returns its result. */
type Job<T> = Generator<void, T, void>;

/** Run a job to the end now. The planner's tests and tools use this; the page slices instead. */
export function drain<T>(job: Job<T>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

// ---------------------------------------------------------------------------------------------
// The reverse phase: a reverse S. One lock to bring the tail to the bay's axis, the OPPOSITE lock to
// bring the body square with it, then straight back. Core measured this shape on the real car (a
// full lock to square then straight clips the side line), and it is all a keyboard can do: the wheel is
// at full lock one way, full the other, or centred, never in between.
// ---------------------------------------------------------------------------------------------

/** Distance walked per check along a path, metres. */
const PATH_STEP = 0.1;
/** The wheel-patch clearance a plan must keep everywhere, metres. Core's executed lines keep 0.10-0.18. */
export const MIN_MARGIN = 0.05;
/** The clearance an S already under way must still keep, metres: off the paint, with a little to spare. */
const COMMITTED_MARGIN = 0.005;
/** Metres of clearance a second arc must add over a single arc to be chosen. */
const SECOND_ARC_PRICE_M = 0.03;
/** A hull corner this far inside the bay line counts as inside: a rotated hull passes a centre test with a corner out. */
const HULL_INSET = 0.02;
const MAX_ARC_M = 6;
/** Arc legs are searched on a coarser grid than the straight: a 0.15 m arc is about 2 degrees of heading. */
const ARC_STEP = 0.15;
const MAX_STRAIGHT_M = 8;
/** How far the car may still roll after the brake is asked for while staying inside, metres. */
const OVER_ROLL_M = 0.1;

/** The straight reverse from a pose square to the bay: its length until the hull is inside, if it is clean. */
function straightIn(
  from: Pose,
  yard: Yard,
  ruleset: Ruleset,
  margin0: number,
  floor: number,
): { len: number; margin: number } | null {
  let p = from;
  let margin = margin0;
  let inside = -1;
  for (let d = 0; d <= MAX_STRAIGHT_M + OVER_ROLL_M; d += PATH_STEP) {
    if (d > 0) p = endPose(p, [{ dir: -1, steerRad: 0, len: PATH_STEP }], ruleset);
    margin = Math.min(margin, patchMargin(p, yard, ruleset));
    if (margin < floor) return null;
    const ok = hullInsideBay(p, yard, ruleset, HULL_INSET);
    if (inside < 0 && ok) inside = d;
    if (inside >= 0) {
      if (!ok) return null;
      if (d >= inside + OVER_ROLL_M) return { len: inside, margin };
    }
  }
  return null;
}

/**
 * The best reverse S from a stopped pose, or null. "Best" is the roomiest (largest worst wheel clearance),
 * then the shortest. The legs are exact path lengths; the caller brakes early by the stopping lead.
 */
export function reverseS(from: Pose, yard: Yard, ruleset: Ruleset, floor = MIN_MARGIN): Plan | null {
  return drain(reverseSJob(from, yard, ruleset, floor));
}

function* reverseSJob(from: Pose, yard: Yard, ruleset: Ruleset, floorWanted: number): Job<Plan | null> {
  const floor = floorFrom(from, yard, ruleset, floorWanted);
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  const axis = holdPose(yard).h;
  // The bay stretched along its long axis: a pose that fits this fits across the bay, wherever along it.
  const [bx0, by0, bx1, by1] = yard.bay;
  const alongX = bx1 - bx0 >= by1 - by0;
  const longBay: Yard = {
    area: yard.area,
    bay: alongX ? [bx0 - 100, by0, bx1 + 100, by1] : [bx0, by0 - 100, bx1, by1 + 100],
  };
  const start = patchMargin(from, yard, ruleset);
  if (start < floor) return null;
  // Already square to the bay and across it: just back straight in. This is also where every S ends up,
  // and without it the solver keeps cutting the last 20 cm into two arcs.
  if (Math.abs(wrap(from.h - axis)) <= 0.1 && hullInsideBay(from, longBay, ruleset, HULL_INSET)) {
    const fin = straightIn(from, yard, ruleset, start, floor);
    if (fin) {
      const leg: Leg = { dir: -1, steerRad: 0, len: fin.len };
      return { legs: [leg], end: endPose(from, [leg], ruleset), margin: fin.margin, shunts: 0, length: fin.len };
    }
  }
  let best: Plan | null = null;
  let bestScore = -Infinity;
  for (const a of [lock, -lock]) {
    let p1 = from;
    let m1 = start;
    for (let s1 = ARC_STEP; s1 <= MAX_ARC_M; s1 += ARC_STEP) {
      yield;
      p1 = endPose(p1, [{ dir: -1, steerRad: a, len: ARC_STEP }], ruleset);
      m1 = Math.min(m1, patchMargin(p1, yard, ruleset));
      if (m1 < floor) break;
      let p2 = p1;
      let m2 = m1;
      let off = Infinity;
      for (let s2 = 0; s2 <= MAX_ARC_M; s2 += ARC_STEP) {
        if (s2 > 0) {
          p2 = endPose(p2, [{ dir: -1, steerRad: -a, len: ARC_STEP }], ruleset);
          m2 = Math.min(m2, patchMargin(p2, yard, ruleset));
          if (m2 < floor) break;
        }
        // The heading turns one way at a constant lock: once it is leaving the axis it does not come back.
        const was = off;
        off = Math.abs(wrap(p2.h - axis));
        if (off > 0.1) {
          if (off > was) break;
          continue;
        }
        // Cheap cut before the long straight walk: across the bay's short axis the hull must already fit.
        if (!hullInsideBay(p2, longBay, ruleset, HULL_INSET)) continue;
        const fin = straightIn(p2, yard, ruleset, m2, floor);
        if (!fin) continue;
        // A clutch tap cannot place a leg shorter than it moves the car: a 0.15 m first arc is not a leg the
        // car can drive, it is a way for the solver to shift where the second arc starts.
        const tap = minTapM(ruleset);
        if (s1 < tap || (s2 > 0 && s2 < tap)) continue;
        const legs: Leg[] = [{ dir: -1, steerRad: a, len: s1 }];
        if (s2 > 0) legs.push({ dir: -1, steerRad: -a, len: s2 });
        legs.push({ dir: -1, steerRad: 0, len: fin.len });
        const length = s1 + s2 + fin.len;
        // A second arc costs a stop and a lock change the car can only make standing still; it has to buy
        // clearance to be worth it, or the solver trades a plain arc for a micro-arc and a shunt.
        const score = fin.margin - (s2 > 0 ? SECOND_ARC_PRICE_M : 0);
        if (!best || score > bestScore + 0.01 || (score > bestScore - 0.01 && length < best.length)) {
          best = { legs, end: endPose(p2, [{ dir: -1, steerRad: 0, len: fin.len }], ruleset), margin: fin.margin, shunts: 0, length };
          bestScore = score;
        }
      }
    }
  }
  return best;
}


// ---------------------------------------------------------------------------------------------
// The whole plan. Two phases, replanned from the real stop pose at every stop:
//   lead-in  forward, one of the four Dubins words (arc, straight, arc) at full lock, to a LAUNCH pose;
//   reverse  `reverseS` from there, after at most one straight shunt.
// A launch pose is one a reverse S is known to finish from. They are not searched for at run time: they
// are the poses the reverse S itself leads back to from the bay, generated once per figure by driving the
// S backwards from poses in the bay, so a lead-in only has to land on one (or next to one: a shunt or a
// short second lead-in absorbs the rest).
// ---------------------------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;
const mod2pi = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

interface Launch {
  x: Float32Array;
  y: Float32Array;
  h: Float32Array;
  margin: Float32Array;
  /** 0..1: how much of the neighbourhood (one cell each way in x, y and heading) is also a launch pose. */
  inner: Float32Array;
  n: number;
}

export /** Metres of lead-in a launch pose is worth giving up for being surrounded by other launch poses. */
const INNER_PRICE = 12;
/** The launch pose a plan was already driving at is worth this much shorter: do not change aim between stops. */
const KEEP_BONUS_M = 6;
const close = (a: Pose, b: Pose, metres: number, rad: number): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) <= metres && Math.abs(wrap(a.h - b.h)) <= rad;

/**
 * What a lead-in costs beyond its length: every leg is a stop, a wheel change and a clutch tap, and a leg
 * shorter than a metre is mostly the tap's own scatter. Without this the planner trims a few degrees with
 * 0.2 m arcs, the tap overshoots, and the next plan trims the other way (measured: a 7 m straight driven
 * in 0.3 m pieces).
 */
const stopCost = (legs: readonly Leg[]): number =>
  legs.reduce((t, w) => t + STOP_PRICE_M + SHORT_PRICE * Math.max(0, SHORT_LEG_M - w.len), 0);
const STOP_PRICE_M = 1.5;
const SHORT_LEG_M = 1.2;
const SHORT_PRICE = 4;

/**
 * What one clutch tap does at the reverse creep, as time at the creep speed. Measured on the real car at
 * 1.74 m/s: the least tap moved it 0.36 m (0.21 s) and a tap kept to 0.6 m (0.35 s). They are times, not
 * metres, so a taller reverse gear (a slower creep) shrinks both with no change here.
 */
const MIN_TAP_S = 0.21;
const PULSE_S = 0.35;
/** The least one tap moves the car, metres; never below one arc step, which the solver cannot resolve. */
const minTapM = (ruleset: Ruleset): number => Math.max(ARC_STEP, MIN_TAP_S * reverseCreepMps(ruleset));
/** The furthest one tap of a reverse leg is asked to go, metres. */
const pulseM = (ruleset: Ruleset): number => Math.max(2 * ARC_STEP, PULSE_S * reverseCreepMps(ruleset));

/** Shortest leg worth driving, metres. */
const MIN_LEG_M = 0.15;
/** A launch pose with at least this much wheel clearance along its whole S is roomy. */
const ROOMY_M = 0.2;
/** Metres of lead-in a launch pose is worth giving up per metre of clearance it lacks. */
const ROOM_PRICE = 15;

const launchCache = new Map<string, Launch>();

/** Launch poses for a figure: the reverse S driven backwards (forwards, with the same locks) from the bay. */
export function launchSet(yard: Yard, ruleset: Ruleset): Launch {
  return drain(launchSetJob(yard, ruleset));
}

function* launchSetJob(yard: Yard, ruleset: Ruleset): Job<Launch> {
  const key = `${yard.area.join(',')}|${yard.bay.join(',')}|${ruleset.vehicle.wheelbase_m}`;
  const hit = launchCache.get(key);
  if (hit) return hit;
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  const hold = holdPose(yard);
  // Nominal ends: the hold pose, shifted a little across the bay and rotated a little, as a learner's stop is.
  const [bx0, by0, bx1, by1] = yard.bay;
  const alongX = bx1 - bx0 >= by1 - by0;
  const ends: Pose[] = [];
  // The hull fits the bay anywhere along its long axis within the slack, so the S may end anywhere in it.
  const slack = Math.max(0, (alongX ? bx1 - bx0 : by1 - by0) - ruleset.vehicle.length_m) / 2;
  for (const along of [-1, -0.5, 0, 0.5, 1]) {
    for (const lat of [-0.12, 0, 0.12]) {
      const a = along * slack;
      ends.push({
        x: hold.x + (alongX ? a : lat),
        y: hold.y + (alongX ? lat : a),
        h: hold.h + (lat === 0 ? 0 : lat * 0.4),
      });
    }
  }
  const best = new Map<string, [number, number, number, number]>();
  for (const e of ends) {
    const m0 = patchMargin(e, yard, ruleset);
    if (m0 < MIN_MARGIN) continue;
    for (const a of [lock, -lock]) {
      let p3 = e;
      let m3 = m0;
      for (let s3 = 0; s3 <= 3.01; s3 += 0.5) {
        if (s3 > 0) {
          for (let i = 0; i < 5; i += 1) {
            p3 = endPose(p3, [{ dir: 1, steerRad: 0, len: 0.1 }], ruleset);
            m3 = Math.min(m3, patchMargin(p3, yard, ruleset));
          }
        }
        if (m3 < MIN_MARGIN) break;
        let p2 = p3;
        let m2 = m3;
        for (let s2 = 0; s2 <= MAX_ARC_M; s2 += ARC_STEP) {
          yield;
          if (s2 > 0) {
            p2 = endPose(p2, [{ dir: 1, steerRad: -a, len: ARC_STEP }], ruleset);
            m2 = Math.min(m2, patchMargin(p2, yard, ruleset));
            if (m2 < MIN_MARGIN) break;
          }
          let p1 = p2;
          let m1 = m2;
          for (let s1 = ARC_STEP; s1 <= MAX_ARC_M; s1 += ARC_STEP) {
            p1 = endPose(p1, [{ dir: 1, steerRad: a, len: ARC_STEP }], ruleset);
            m1 = Math.min(m1, patchMargin(p1, yard, ruleset));
            if (m1 < MIN_MARGIN) break;
            const k = `${Math.round(p1.x / 0.15)},${Math.round(p1.y / 0.15)},${Math.round(p1.h / 0.06)}`;
            const old = best.get(k);
            if (!old || m1 > old[3]) best.set(k, [p1.x, p1.y, p1.h, m1]);
          }
        }
      }
    }
  }
  const n = best.size;
  const out: Launch = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    h: new Float32Array(n),
    margin: new Float32Array(n),
    inner: new Float32Array(n),
    n,
  };
  let i = 0;
  for (const [x, y, h, mg] of best.values()) {
    out.x[i] = x;
    out.y[i] = y;
    out.h[i] = h;
    out.margin[i] = mg;
    let near = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dh = -1; dh <= 1; dh += 1) {
          if (dx === 0 && dy === 0 && dh === 0) continue;
          const nk = `${Math.round(x / 0.15) + dx},${Math.round(y / 0.15) + dy},${Math.round(h / 0.06) + dh}`;
          if (best.has(nk)) near += 1;
        }
      }
    }
    out.inner[i] = near / 26;
    i += 1;
  }
  launchCache.set(key, out);
  return out;
}

/** The four forward Dubins words from one pose to another at one turning radius, shortest first. */
export function dubins(from: Pose, to: Pose, radius: number): Leg[][] {
  const dx = (to.x - from.x) / radius;
  const dy = (to.y - from.y) / radius;
  const d = Math.hypot(dx, dy);
  const theta = Math.atan2(dy, dx);
  const al = mod2pi(from.h - theta);
  const be = mod2pi(to.h - theta);
  const sa = Math.sin(al);
  const sb = Math.sin(be);
  const ca = Math.cos(al);
  const cb = Math.cos(be);
  const cab = Math.cos(al - be);
  const words: Array<{ t: number; p: number; q: number; l1: 1 | -1; l3: 1 | -1 }> = [];
  // LSL
  let p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (p2 >= 0) {
    const t1 = Math.atan2(cb - ca, d + sa - sb);
    words.push({ t: mod2pi(-al + t1), p: Math.sqrt(p2), q: mod2pi(be - t1), l1: 1, l3: 1 });
  }
  // RSR
  p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (p2 >= 0) {
    const t1 = Math.atan2(ca - cb, d - sa + sb);
    words.push({ t: mod2pi(al - t1), p: Math.sqrt(p2), q: mod2pi(-be + t1), l1: -1, l3: -1 });
  }
  // LSR
  p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (p2 >= 0) {
    const p = Math.sqrt(p2);
    const t2 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
    words.push({ t: mod2pi(-al + t2), p, q: mod2pi(-be + t2), l1: 1, l3: -1 });
  }
  // RSL
  p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
  if (p2 >= 0) {
    const p = Math.sqrt(p2);
    const t2 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
    words.push({ t: mod2pi(al - t2), p, q: mod2pi(be - t2), l1: -1, l3: 1 });
  }
  return words
    .sort((u, v) => u.t + u.p + u.q - (v.t + v.p + v.q))
    .map((w) => [
      { dir: 1 as const, steerRad: w.l1, len: w.t * radius },
      { dir: 1 as const, steerRad: 0, len: w.p * radius },
      { dir: 1 as const, steerRad: w.l3, len: w.q * radius },
    ]);
}

/** A forward lead-in from `from` to one of the launch poses, clean all the way, shortest first. */
/** How many clear lead-ins are compared for the roominess of their launch pose. */
const FUNNEL_CANDIDATES = 8;
/** Metres of lead-in worth giving up to raise the share of scattered stops the reverse phase can finish from to 1. */
const FUNNEL_PRICE_M = 15;
/**
 * How far a stop lands from where it was aimed, metres: the reaction and the brake's rise at the creep
 * speed. Measured by core on the real car: ±0.22 m at 1.74 m/s and ±0.07 m at 0.52 m/s, both 0.13 s of travel.
 */
const SCATTER_S = 0.25;
const scatterM = (ruleset: Ruleset): number => SCATTER_S * reverseCreepMps(ruleset);
const funnels = new WeakMap<Launch, Map<number, number>>();

/**
 * The share of stops near launch pose `i` that a reverse phase can still finish from. A stop lands a
 * couple of decimetres and a few degrees from where it was aimed, so a pose with a clean line but no room
 * either side of it is a pose the car never actually parks from. Solved with the reverse solver itself,
 * once per pose.
 */
function* funnelJob(set: Launch, i: number, yard: Yard, ruleset: Ruleset): Job<number> {
  let memo = funnels.get(set);
  if (!memo) funnels.set(set, (memo = new Map()));
  const hit = memo.get(i);
  if (hit !== undefined) return hit;
  let ok = 0;
  let n = 0;
  const e = scatterM(ruleset);
  for (const [dx, dy] of [[0, 0], [e, 0], [-e, 0], [0, e], [0, -e]] as const) {
    for (const dh of [-0.35 * e, 0, 0.35 * e]) {
      n += 1;
      const r = yield* reverseSJob({ x: set.x[i] + dx, y: set.y[i] + dy, h: set.h[i] + dh }, yard, ruleset, COMMITTED_MARGIN);
      if (r) ok += 1;
    }
  }
  memo.set(i, ok / n);
  return ok / n;
}


/**
 * Poses from which a three-point turn finishes at a launch pose: reverse one arc, drive forward one arc,
 * and the car stands on a launch pose. The reverse S only starts from a launch pose, and from the road a
 * forward-only line reaches few of them with room (bài 7's best are a hand's width from the paint); a car
 * that shuffles reaches the roomy ones, which is how core's own clean line gets in. Built backwards from
 * the roomiest launch poses with the same full-lock arcs, once per figure.
 */
interface Chains {
  x: Float32Array;
  y: Float32Array;
  h: Float32Array;
  margin: Float32Array;
  /** The launch pose each chain ends at, as an index into the launch set. */
  launch: Int32Array;
  /** The two legs driven from the pose: the reverse arc, then the forward arc. */
  legs: Leg[][];
  n: number;
}
const chainCache = new WeakMap<Launch, Chains>();
const CHAIN_ARCS_M = [0.45, 0.9, 1.35, 1.8, 2.4];
const CHAIN_LAUNCHES = 300;

function* chainsJob(set: Launch, yard: Yard, ruleset: Ruleset): Job<Chains> {
  const hit = chainCache.get(set);
  if (hit) return hit;
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  // The roomiest launch poses, one per neighbourhood.
  const order = Array.from({ length: set.n }, (_, i) => i)
    .filter((i) => set.margin[i] >= 0.12)
    .sort((a, b) => set.margin[b] + 0.3 * set.inner[b] - (set.margin[a] + 0.3 * set.inner[a]));
  const chosen: number[] = [];
  for (const i of order) {
    if (chosen.length >= CHAIN_LAUNCHES) break;
    const p = { x: set.x[i], y: set.y[i], h: set.h[i] };
    if (chosen.some((j) => close(p, { x: set.x[j], y: set.y[j], h: set.h[j] }, 0.4, 0.15))) continue;
    chosen.push(i);
  }
  const best = new Map<string, { p: Pose; m: number; i: number; legs: Leg[] }>();
  const walk = (from: Pose, m0: number, dir: 1 | -1, steerRad: number, lengths: readonly number[], visit: (p: Pose, m: number, len: number) => void) => {
    let p = from;
    let m = m0;
    let done = 0;
    for (const len of lengths) {
      while (done < len - 1e-9) {
        const step = Math.min(ARC_STEP, len - done);
        p = endPose(p, [{ dir, steerRad, len: step }], ruleset);
        done += step;
        m = Math.min(m, patchMargin(p, yard, ruleset));
        if (m < MIN_MARGIN) return;
      }
      visit(p, m, len);
    }
  };
  for (const ci of chosen) {
    yield;
    const c: Pose = { x: set.x[ci], y: set.y[ci], h: set.h[ci] };
    const m0 = patchMargin(c, yard, ruleset);
    for (const lam of [lock, -lock]) {
      // Y: where a forward arc at `lam` of length u ends at c, i.e. c driven backwards at `lam`.
      walk(c, m0, -1, lam, CHAIN_ARCS_M, (y, my, u) => {
        for (const mu of [lock, -lock]) {
          // Z: where a reverse arc at `mu` of length t ends at y, i.e. y driven forwards at `mu`.
          walk(y, my, 1, mu, CHAIN_ARCS_M.slice(0, 4), (z, mz, t) => {
            const k = `${Math.round(z.x / 0.15)},${Math.round(z.y / 0.15)},${Math.round(z.h / 0.06)}`;
            const old = best.get(k);
            if (!old || mz > old.m) {
              best.set(k, {
                p: z,
                m: mz,
                i: ci,
                legs: [
                  { dir: -1, steerRad: mu, len: t },
                  { dir: 1, steerRad: lam, len: u },
                ],
              });
            }
          });
        }
      });
    }
  }
  const n = best.size;
  const out: Chains = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    h: new Float32Array(n),
    margin: new Float32Array(n),
    launch: new Int32Array(n),
    legs: [],
    n,
  };
  let k = 0;
  for (const v of best.values()) {
    out.x[k] = v.p.x;
    out.y[k] = v.p.y;
    out.h[k] = v.p.h;
    out.margin[k] = v.m;
    out.launch[k] = v.i;
    out.legs.push(v.legs);
    k += 1;
  }
  chainCache.set(set, out);
  return out;
}

function* leadInJob(
  from: Pose,
  yard: Yard,
  ruleset: Ruleset,
  avoid: readonly Pose[],
  prefer: Pose | null,
  shuffle = false,
): Job<Plan | null> {
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  const radius = ruleset.vehicle.wheelbase_m / Math.tan(lock);
  const floor = floorFrom(from, yard, ruleset, MIN_MARGIN);
  const set = yield* launchSetJob(yard, ruleset);
  /** `chain`: legs driven after the Dubins legs; `i`: the launch pose the plan ends at. */
  const cand: Array<{ len: number; legs: Leg[]; chain: Leg[]; i: number }> = [];
  const consider = (to: Pose, i: number, chain: Leg[], roomM: number, inner: number) => {
    if (avoid.some((a) => close(a, to, 0.35, 0.14))) return;
    const word = dubins(from, to, radius)[0];
    if (!word) return;
    // A leg shorter than a clutch tap can place is not a leg: dropping it moves the end by centimetres.
    const legs = word.map((w) => ({ ...w, steerRad: w.steerRad * lock })).filter((w) => w.len > MIN_LEG_M);
    const all = [...legs, ...chain];
    const len = all.reduce((t, w) => t + w.len, 0) + stopCost(all);
    // Roomier launch poses win over shorter ones: the lead-in lands a few centimetres and degrees off.
    const lp: Pose = { x: set.x[i], y: set.y[i], h: set.h[i] };
    const keep = prefer && close(prefer, lp, 0.5, 0.2) ? KEEP_BONUS_M : 0;
    cand.push({ len: len + ROOM_PRICE * Math.max(0, ROOMY_M - roomM) + INNER_PRICE * (1 - inner) - keep, legs, chain, i });
  };
  for (let i = 0; i < set.n; i += 1) {
    work += 1;
    if (i % 1500 === 0) yield;
    if (set.margin[i] < 0.09) continue;
    consider({ x: set.x[i], y: set.y[i], h: set.h[i] }, i, [], set.margin[i], set.inner[i]);
  }
  // Only when the plain lead-ins have not got the car anywhere: shuffle to a roomier launch pose.
  const chains = shuffle ? yield* chainsJob(set, yard, ruleset) : null;
  for (let k = 0; chains && k < chains.n; k += 1) {
    work += 1;
    if (k % 1500 === 0) yield;
    if (chains.margin[k] < 0.09) continue;
    const li = chains.launch[k];
    consider({ x: chains.x[k], y: chains.y[k], h: chains.h[k] }, li, chains.legs[k], Math.min(chains.margin[k], set.margin[li]), set.inner[li]);
  }
  cand.sort((u, v) => u.len - v.len);
  // The cheapest lead-ins that clear the paint; among them the one whose launch pose the reverse phase can
  // still finish from after the scatter of a real stop, which is the roomy pose and not always the nearest.
  const ok: Array<{ plan: Plan; cost: number }> = [];
  let tried = 0;
  for (const c of cand) {
    if (tried >= 600 || ok.length >= FUNNEL_CANDIDATES) break;
    tried += 1;
    if (tried % 8 === 0) yield;
    let p = from;
    let margin = Infinity;
    let clear = true;
    for (const leg of [...c.legs, ...c.chain]) {
      const w = walkLeg(p, leg, yard, ruleset);
      if (!w || w.margin < floor) {
        clear = false;
        break;
      }
      p = w.end;
      margin = Math.min(margin, w.margin);
    }
    if (!clear) continue;
    // Candidates that land beside one already compared add nothing to the comparison.
    if (ok.some((o) => close(o.plan.launch!, { x: set.x[c.i], y: set.y[c.i], h: set.h[c.i] }, 0.6, 0.25))) continue;
    const launch = { x: set.x[c.i], y: set.y[c.i], h: set.h[c.i] };
    const f = yield* funnelJob(set, c.i, yard, ruleset);
    ok.push({
      plan: { legs: [...c.legs, ...c.chain], end: p, margin, shunts: 0, length: [...c.legs, ...c.chain].reduce((t, w) => t + w.len, 0), launch },
      cost: c.len + FUNNEL_PRICE_M * (1 - f),
    });
  }
  if (ok.length) return ok.reduce((b, c) => (c.cost < b.cost ? c : b)).plan;
  return null;
}

/**
 * The reverse phase from a stop pose, after at most one straight shunt either way.
 *
 * A shunt is a clutch tap, which lands a few decimetres from where it was asked, and the S only works
 * from a narrow band along the lane (bài 8: about 0.4 m at one heading). So among the shunts that work,
 * the one chosen is the middle of the longest unbroken run of them: the tap can land either side of it
 * and the S still closes. The first one found (the shortest shunt) is on the band's edge half the time.
 */
function* reverseWithShuntJob(from: Pose, yard: Yard, ruleset: Ruleset, floor = COMMITTED_MARGIN): Job<Plan | null> {
  // Committed to the S the floor is the paint itself plus a small buffer; the roomy 0.05 is for choosing
  // where to start, not for giving up once the car is a few centimetres off the line it was aimed at.
  const START_M = 2.4;
  const STEP_M = 0.2;
  const n = Math.round(START_M / STEP_M);
  // Signed shunt distance: + forward, − backward, in STEP_M units.
  const found = new Map<number, Plan>();
  const m0 = patchMargin(from, yard, ruleset);
  for (let k = -n; k <= n; k += 1) {
    const d = Math.abs(k) * STEP_M;
    // A clutch tap cannot move the car less than about this far (measured 0.36 m at the creep): a shunt
    // shorter than that is not one the car can make, and asking for it makes the car oscillate about it.
    if (k !== 0 && d < minTapM(ruleset)) continue;
    const shunt: Leg = { dir: k >= 0 ? 1 : -1, steerRad: 0, len: d };
    let p = from;
    let m = m0;
    if (k !== 0) {
      const w = walkLeg(from, shunt, yard, ruleset);
      if (!w || w.margin < floor) continue;
      p = w.end;
      m = Math.min(m, w.margin);
    }
    const r = yield* reverseSJob(p, yard, ruleset, floor);
    if (!r) continue;
    found.set(k, {
      legs: k !== 0 ? [shunt, ...r.legs] : r.legs,
      end: r.end,
      margin: Math.min(m, r.margin),
      shunts: k !== 0 ? 1 : 0,
      length: d + r.length,
    });
  }
  if (found.size === 0) {
    // No straight move helps. The S can be undone along its own arc: drive back the way it went (the same
    // lock, the other direction) until the pose is one the S fits from again. This is how a car that
    // swung a few degrees past the switch gets its heading back, which a straight move cannot do.
    const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
    for (let d = minTapM(ruleset); d <= 1.6 + 1e-9; d += STEP_M) {
      for (const dir of [1 as const, -1 as const]) {
        for (const steerRad of [lock, -lock]) {
          const shunt: Leg = { dir, steerRad, len: d };
          const w = walkLeg(from, shunt, yard, ruleset);
          if (!w || w.margin < floor) continue;
          const r = yield* reverseSJob(w.end, yard, ruleset, floor);
          if (!r) continue;
          return {
            legs: [shunt, ...r.legs],
            end: r.end,
            margin: Math.min(m0, w.margin, r.margin),
            shunts: 1,
            length: d + r.length,
          };
        }
      }
    }
    return null;
  }
  // Slack either side of a shunt: how many neighbouring shunt lengths also work, up to 0.4 m each way.
  const SLACK = 2;
  let best: number | null = null;
  let bestScore = -1;
  for (const k of found.keys()) {
    let score = 0;
    for (let j = 1; j <= SLACK; j += 1) {
      if (found.has(k - j)) score += 1;
      if (found.has(k + j)) score += 1;
    }
    if (score > bestScore || (score === bestScore && best !== null && Math.abs(k) < Math.abs(best))) {
      best = k;
      bestScore = score;
    }
  }
  return found.get(best as number) ?? null;
}

/**
 * Stuck: no lead-in from here (nose into a wall, say). Back out or move on in a straight line until one
 * exists, shortest first. The legs returned are the straight run plus the lead-in found after it.
 */
function* escapeJob(from: Pose, yard: Yard, ruleset: Ruleset, avoid: readonly Pose[], prefer: Pose | null): Job<Plan | null> {
  const floor = floorFrom(from, yard, ruleset, MIN_MARGIN);
  for (let d = 1; d <= 6; d += 1) {
    for (const dir of [-1 as const, 1 as const]) {
      const run: Leg = { dir, steerRad: 0, len: d };
      const w = walkLeg(from, run, yard, ruleset);
      if (!w || w.margin < floor) continue;
      const lead = yield* leadInJob(w.end, yard, ruleset, avoid, prefer);
      if (!lead) continue;
      return { legs: [run, ...lead.legs], end: lead.end, margin: Math.min(w.margin, lead.margin), shunts: 1, length: d + lead.length, launch: lead.launch };
    }
  }
  return null;
}

/**
 * Nothing above found a line: the car is wedged (heading 40 degrees into the bay's mouth, say). Try every
 * one or two moves of full lock or straight, forward or back, 0.4 to 1.6 m each, and take the shortest
 * after which the reverse S fits. It is the last resort, so it may be slow; it is sliced like the rest.
 */
function* recoverJob(from: Pose, yard: Yard, ruleset: Ruleset, floor: number): Job<Plan | null> {
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  const lens = [0.4, 0.8, 1.2, 1.6].filter((l) => l >= minTapM(ruleset) - 1e-9);
  const moves: Leg[] = [];
  for (const len of lens) for (const dir of [1 as const, -1 as const]) for (const steerRad of [0, lock, -lock]) moves.push({ dir, steerRad, len });
  const start = floorFrom(from, yard, ruleset, floor);
  const tried: Array<{ legs: Leg[]; end: Pose; margin: number; length: number }> = [];
  for (const a of moves) {
    const wa = walkLeg(from, a, yard, ruleset);
    if (wa && wa.margin >= start) tried.push({ legs: [a], end: wa.end, margin: wa.margin, length: a.len });
  }
  for (const first of tried.slice()) {
    yield;
    for (const b of moves) {
      if (b.dir === first.legs[0].dir && b.steerRad === first.legs[0].steerRad) continue;
      const wb = walkLeg(first.end, b, yard, ruleset);
      if (wb && wb.margin >= start) tried.push({ legs: [...first.legs, b], end: wb.end, margin: Math.min(first.margin, wb.margin), length: first.length + b.len });
    }
  }
  tried.sort((u, v) => u.length - v.length);
  for (const t of tried) {
    const r = yield* reverseSJob(t.end, yard, ruleset, floor);
    if (!r) continue;
    return { legs: [...t.legs, ...r.legs], end: r.end, margin: Math.min(t.margin, r.margin), shunts: 1, length: t.length + r.length };
  }
  return null;
}

/**
 * The plan from a stopped pose: parked already (no legs), a reverse S (after a shunt if need be), or a
 * forward lead-in to a launch pose followed by the S from there. Null when none is found.
 */
export function* planParkJob(
  from: Pose,
  yard: Yard,
  ruleset: Ruleset,
  avoid: readonly Pose[] = [],
  prefer: Pose | null = null,
  skipDirect = false,
  floor = COMMITTED_MARGIN,
): Job<Plan | null> {
  if (hullInsideBay(from, yard, ruleset, HULL_INSET)) {
    return { legs: [], end: from, margin: patchMargin(from, yard, ruleset), shunts: 0, length: 0 };
  }
  const direct = skipDirect ? null : yield* reverseWithShuntJob(from, yard, ruleset, floor);
  if (direct) return direct;
  const lead = (yield* leadInJob(from, yard, ruleset, avoid, prefer, skipDirect)) ?? (yield* escapeJob(from, yard, ruleset, avoid, prefer));
  // Looping was only a reason to try something else first: with nothing else, the line that exists is taken.
  if (!lead) return (skipDirect ? yield* reverseWithShuntJob(from, yard, ruleset, floor) : null) ?? (yield* recoverJob(from, yard, ruleset, floor));
  const tail = yield* reverseWithShuntJob(lead.end, yard, ruleset);
  if (!tail) return lead;
  return {
    legs: [...lead.legs, ...tail.legs],
    end: tail.end,
    margin: Math.min(lead.margin, tail.margin),
    shunts: tail.shunts + 1,
    length: lead.length + tail.length,
    launch: lead.launch,
  };
}

/** The plan from a stopped pose, solved now. The page slices `planParkJob` instead. */
export function planPark(
  from: Pose,
  yard: Yard,
  ruleset: Ruleset,
  avoid: readonly Pose[] = [],
  prefer: Pose | null = null,
  skipDirect = false,
): Plan | null {
  return drain(planParkJob(from, yard, ruleset, avoid, prefer, skipDirect));
}
