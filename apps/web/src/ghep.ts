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
export function hullInsideBay(p: Pose, yard: Yard, ruleset: Ruleset): boolean {
  return hull(p, ruleset).every(([x, y]) => inRect(x, y, yard.bay));
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
function clearance(yard: Yard, x: number, y: number): number {
  const [ax0, ay0, ax1, ay1] = yard.area;
  const [bx0, by0, bx1, by1] = yard.bay;
  const insideArea = x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1;
  const insideBay = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  // The mouth is the bay's edge that the area continues across. Both figures cut it into the area's
  // near side, so it is the bay's y1 = area's y0 edge, over the bay's x span.
  const onMouthSpan = x >= bx0 && x <= bx1;
  const wall = (px: number, py: number, e0: Pt, e1: Pt): number => {
    const [ex, ey] = [e1[0] - e0[0], e1[1] - e0[1]];
    const l2 = ex * ex + ey * ey;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - e0[0]) * ex + (py - e0[1]) * ey) / l2));
    return Math.hypot(px - (e0[0] + t * ex), py - (e0[1] + t * ey));
  };
  const edges: Array<[Pt, Pt]> = [
    // the area's four sides; its near side is split by the mouth so the bay is not walled off
    [[ax0, ay0], [ax0, ay1]],
    [[ax1, ay0], [ax1, ay1]],
    [[ax0, ay1], [ax1, ay1]],
    [[ax0, ay0], [bx0, ay0]],
    [[bx1, ay0], [ax1, ay0]],
    // the bay's three closed sides
    [[bx0, by1], [bx0, by0]],
    [[bx1, by1], [bx1, by0]],
    [[bx0, by0], [bx1, by0]],
  ];
  const inside = insideArea || insideBay;
  const d = Math.min(...edges.map(([a, b]) => wall(x, y, a, b)));
  void onMouthSpan;
  return inside ? d : -d;
}

/**
 * The worst clearance the four wheel patches see at one pose, metres. The patch geometry is the
 * core's (`sa_hinh.tyre_width_m`, `patch_length_m`, `track_m`), so this number is the one the scorer
 * charges on, and a plan is only clean while it stays above zero.
 */
export function patchMargin(p: Pose, yard: Yard, ruleset: Ruleset): number {
  const sh = ruleset.sa_hinh;
  if (!sh) return 0;
  const c = Math.cos(p.h);
  const s = Math.sin(p.h);
  const halfBase = ruleset.vehicle.wheelbase_m / 2;
  const halfTrack = sh.track_m / 2;
  let worst = Infinity;
  for (const [lx, ly] of [
    [halfBase, halfTrack],
    [halfBase, -halfTrack],
    [-halfBase, halfTrack],
    [-halfBase, -halfTrack],
  ]) {
    const wx = p.x + lx * c - ly * s;
    const wy = p.y + lx * s + ly * c;
    for (const dx of [-sh.patch_length_m / 2, 0, sh.patch_length_m / 2]) {
      for (const dy of [-sh.tyre_width_m / 2, 0, sh.tyre_width_m / 2]) {
        worst = Math.min(worst, clearance(yard, wx + dx * c - dy * s, wy + dx * s + dy * c));
      }
    }
  }
  return worst;
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
    x -= (r * leg.dir * (Math.sin(h) - Math.sin(h + dh))) / 1;
    y += (r * leg.dir * (Math.cos(h) - Math.cos(h + dh))) / 1;
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

/** Locks the planner may choose: straight, and the useful fractions of full lock either way. */
const LOCKS = [0, 0.2, 0.35, 0.5, 0.7, 0.85, 1] as const;
/** How far one leg may run. */
const LEG_STEPS = [0.3, 0.6, 1.0, 1.5, 2.1, 2.8, 3.6] as const;
/** Plan depth in legs: a shuffle-in needs three changes of direction at most in the core's own lists. */
const MAX_LEGS = 10;

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
  return { end: p, margin };
}

/** Does this plan finish in the bay, square enough that the whole hull fits? */
function arrives(plan: Plan, hold: Pose): boolean {
  return Math.hypot(plan.end.x - hold.x, plan.end.y - hold.y) <= 0.35
    && Math.abs(wrap(plan.end.h - hold.h)) <= 0.14;
}

/**
 * The plan from `from` into the bay, or null when nothing clean is reachable within the search budget.
 *
 * One plan is one **pulse train**: the car stands still, the wheel is set to a lock, the clutch is
 * released for a measured tap, the car is stopped again. That is the only manoeuvre the real car makes
 * possible — the reverse creep is 1.74 m/s and a person's 300 ms read is half a metre, so a leg the
 * driver has to steer *through* cannot be aimed; a leg that starts with the wheel already set can.
 *
 * Legs are rounded to what the pedals and the wheel actually do (see `PULSES` and `LOCK_STEPS`), and
 * the search is breadth-first over (direction, lock, tap) with the wheel-patch margin pruned and kept
 * as a cost. A learner's closed-loop positioning is a few centimetres out, so a line that only just
 * fits is not a line: the plan kept is the roomiest, then the one with the fewest direction changes,
 * then the shortest.
 */
export function planPark(from: Pose, yard: Yard, ruleset: Ruleset, budget = 20000): Plan | null {
  const hold = holdPose(yard);
  const mouth = mouthOf(yard);
  const lattice = legLattice(ruleset);
  if (arrivesAt(from, hold)) {
    return { legs: [], end: from, margin: patchMargin(from, yard, ruleset), shunts: 0, length: 0 };
  }
  const key = (p: Pose): string =>
    [Math.round(p.x / 0.25), Math.round(p.y / 0.25), Math.round(p.h / 0.10)].join(',');
  const seen = new Set<string>([key(from)]);
  let frontier: Plan[] = [
    { legs: [], end: from, margin: patchMargin(from, yard, ruleset), shunts: 0, length: 0 },
  ];
  let best: Plan | null = null;
  let expanded = 0;
  for (let depth = 0; depth < MAX_LEGS && !best; depth += 1) {
    const next: Plan[] = [];
    for (const node of frontier) {
      for (const leg of lattice) {
        // Two taps the same way round ARE two taps, not one longer one: the car stops between them and
        // the wheel is re-set, which is the whole point of the pulse model. Only a *repeat of the same
        // leg* is skipped, so the frontier cannot grow by re-trying an identical tap.
        const prev = node.legs[node.legs.length - 1];
        if (prev && prev.dir === leg.dir && prev.steerRad === leg.steerRad && prev.len === leg.len) continue;
        const walked = walkLeg(node.end, leg, yard, ruleset);
        if (!walked) continue;
        expanded += 1;
        const got: Plan = {
          legs: [...node.legs, leg],
          end: walked.end,
          margin: Math.min(node.margin, walked.margin),
          shunts:
            node.shunts + (node.legs.length > 0 && node.legs[node.legs.length - 1].dir !== leg.dir ? 1 : 0),
          length: node.length + leg.len,
        };
        if (arrivesAt(got.end, hold)) {
          if (!best || compare(got, best) < 0) best = got;
          continue;
        }
        if (atMouth(got.end, mouth)) {
          // Square at the mouth: close the plan with one exact straight reverse down the bay.
          const inLeg: Leg = { dir: -1, steerRad: 0, len: got.end.y - hold.y };
          const walkedIn = walkLeg(got.end, inLeg, yard, ruleset);
          if (walkedIn && arrivesAt(walkedIn.end, hold)) {
            const whole: Plan = {
              legs: [...got.legs, inLeg],
              end: walkedIn.end,
              margin: Math.min(got.margin, walkedIn.margin),
              shunts: got.shunts + (got.legs.length > 0 && got.legs[got.legs.length - 1].dir !== inLeg.dir ? 1 : 0),
              length: got.length + inLeg.len,
            };
            if (!best || compare(whole, best) < 0) best = whole;
          }
          continue;
        }
        const k = key(got.end);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(got);
      }
      if (expanded > budget) break;
    }
    if (best) return best;
    if (next.length === 0) return null;
    // Keep the frontier wide but bounded: the roomiest nodes find the clean lines, and the closest
    // ones are where the plan is going. A beam of only the closest never tries the forward shuttle
    // that every clean line on these two figures begins with.
    next.sort((a, b) => Math.min(b.margin, 0.3) - Math.min(a.margin, 0.3));
    frontier = next.slice(0, 900);
  }
  return best;
}

/**
 * The wheel locks a tap is driven at, as fractions of full lock. A keyboard sets the wheel while the
 * car is stationary (`steer.rate` rad/s, measured: full lock in 0.5 s from centre), so the planner may
 * ask for any of these; the odd fractions are the ones that put a rear wheel where a bay needs it.
 */
const LOCK_FRACTIONS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] as const;

/**
 * How far one tap moves the car, metres, from rest: `clutch out for N ticks, then clutch+brake`. The
 * numbers are the measured ones (`docs`-free, from the real driver): 0.6 s → 0.20 m, 1.0 s → 0.64 m,
 * 1.5 s → 1.37 m. The planner rounds to this ladder so the cue can name a tap the learner can repeat.
 */
const PULSES = [0.2, 0.35, 0.55, 0.8, 1.1, 1.4] as const;

/** Lock fractions and pulse lengths the planner may use, as legs of the real car. */
function legLattice(ruleset: Ruleset): Leg[] {
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  const out: Leg[] = [];
  for (const dir of [-1, 1] as const) {
    for (const frac of LOCK_FRACTIONS) {
      for (const sign of frac === 0 ? [1] : [1, -1]) {
        for (const len of PULSES) out.push({ dir, steerRad: sign * frac * lock, len });
      }
    }
  }
  return out;
}

/** Whether a pose is in the bay, square enough that the whole hull fits and the signal would count. */
function arrivesAt(p: Pose, hold: Pose): boolean {
  return Math.hypot(p.x - hold.x, p.y - hold.y) <= 0.30
    && Math.abs(wrap(p.h - hold.h)) <= 0.12;
}

/**
 * The straight last leg. Once the car is square at the bay's mouth, backing straight in is exact — the
 * bay is a rectangle and the car only has to go along it — so the planner aims for the *mouth* square
 * and this closes the rest. Without it the lattice has to hit the hold pose to a few centimetres with
 * a tap, which no pulse table can do.
 */
function mouthOf(yard: Yard): Pose {
  const hold = holdPose(yard);
  const [bx0, by0, bx1, by1] = yard.bay;
  // The mouth is the bay edge nearest the area. Both figures have the bay below the lane.
  const mouthY = by1;
  const gap = 0.6;
  return { x: hold.x, y: mouthY + gap, h: hold.h };
  void bx0; void bx1; void by0;
}

/** Whether a pose is square at the mouth, within what the straight leg can absorb. */
function atMouth(p: Pose, mouth: Pose): boolean {
  return Math.abs(p.x - mouth.x) <= 0.22
    && p.y >= mouth.y - 0.15
    && p.y <= mouth.y + 1.2
    && Math.abs(wrap(p.h - mouth.h)) <= 0.10;
}

/** Plans are ordered by clearance first, then shunts, then length: `-1` means `a` is better. */
function compare(a: Plan, b: Plan): number {
  const marginA = Math.min(a.margin, 0.25);
  const marginB = Math.min(b.margin, 0.25);
  if (Math.abs(marginA - marginB) > 0.03) return marginB - marginA;
  if (a.shunts !== b.shunts) return a.shunts - b.shunts;
  return a.length - b.length;
}

/** The steering key the page asks for. One value, one key: `straight` means let go. */
export type GhepCue = 'left' | 'right' | 'straight';

/**
 * The pedal the page asks for, one value:
 * `creep` — feet off, the clutch is up and the car is moving on its own;
 * `brake` — hold ↓ now, the car is at the place this leg ends;
 * `clutch` — hold Space, the car has to change gear direction and only shifts with the pedal down;
 * `hold` — stand on ↓ and stay there; the car is parked and the signal is counting.
 */
export type GhepPedal = 'creep' | 'brake' | 'clutch' | 'hold';

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
export function cueGhep(s: SimState, yard: Yard, ruleset: Ruleset, reactionS = 0.3): GhepCueNow {
  const pose: Pose = { x: s.carX, y: s.carY, h: s.heading };
  const parked = s.hullInside && Math.abs(s.speedMps) < 0.05;
  if (parked) return { steer: 'straight', pedal: 'hold', gear: 0, parked: true, plan: null };
  if (s.finishSignal || s.disqualified || s.phase === 'done') {
    return { steer: 'straight', pedal: 'hold', gear: 0, parked, plan: null };
  }
  const plan = planPark(pose, yard, ruleset);
  if (!plan || plan.legs.length === 0) return { steer: 'straight', pedal: 'hold', gear: 0, parked, plan: null };

  const first = plan.legs[0];
  const speed = Math.abs(s.speedMps);
  const lead = stoppingLeadM(ruleset, speed, reactionS);
  // How much of this leg is left. The plan starts where the car is, so the leg's own length is the
  // road still to run; when the car is already rolling on it, the boss is the brake, not a new key.
  const steer: GhepCue = first.steerRad > 0.06 ? 'left' : first.steerRad < -0.06 ? 'right' : 'straight';
  const gearOut = s.gear !== first.dir;
  if (speed > 0.05) {
    // Moving: finish this leg. The pedal word is the only thing that matters now.
    return { steer, pedal: first.len <= lead ? 'brake' : 'creep', gear: 0, parked, plan };
  }
  if (gearOut) return { steer, pedal: 'clutch', gear: first.dir, parked, plan };
  return { steer, pedal: 'creep', gear: 0, parked, plan };
}

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
  reactionS = 0.3,
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
  if (!plan || !leg) {
    return `Đạp côn, vào số 1 hoặc R rồi đánh lái theo ô: ${name} rộng ${m(bayW)} và sâu ${m(bayD)}.`;
  }

  // The reversing stage: the sentence names the wheel, when to straighten, and when to brake.
  if (leg.dir === -1) {
    if (cue.pedal === 'clutch') {
      return `Đạp côn hết cỡ (giữ Space), bấm R, rồi nhả côn thật chậm để lùi ${m(leg.len)} rồi phanh ↓ dừng hẳn.`;
    }
    if (cue.pedal === 'brake') {
      return 'Giữ phanh ↓ ngay cho xe dừng hẳn, rồi đạp côn và chuẩn bị đổi chiều.';
    }
    if (cue.steer === 'left') return `Lùi và đánh hết lái ← (giữ phím); thả tay lái khi thân xe song song với ô.`;
    if (cue.steer === 'right') return `Lùi và đánh hết lái → (giữ phím); thả tay lái khi thân xe song song với ô.`;
    return 'Thẳng lái, lùi thật chậm vào ô; giữ phanh ↓ khi đuôi xe tới vạch cuối ô.';
  }
  // The forward stage: this is the "tiến vào khoảng khống chế" the law names, and the shuffle.
  if (cue.pedal === 'clutch') {
    return `Đạp côn hết cỡ, bấm 1 để tiến ${m(leg.len)} vào khoảng khống chế rồi phanh ↓ dừng hẳn.`;
  }
  if (cue.pedal === 'brake') return 'Giữ phanh ↓ cho xe dừng hẳn ở đây, rồi đạp côn để đổi chiều.';
  if (cue.steer === 'left') return `Tiến và đánh lái ← (giữ phím) ${m(leg.len)}, rồi phanh ↓ dừng hẳn.`;
  if (cue.steer === 'right') return `Tiến và đánh lái → (giữ phím) ${m(leg.len)}, rồi phanh ↓ dừng hẳn.`;
  return `Thẳng lái, tiến ${m(leg.len)} vào khoảng khống chế rồi phanh ↓ dừng hẳn.`;
}
