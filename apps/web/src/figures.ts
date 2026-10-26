// Bài 4 and bài 6: the steering cues and the advice line for the two figures whose path is a drawn
// polyline. One source for the path is the core's own figure (`sim_course`, kind 5); the cue reads
// the snapshot's progress, lateral offset and heading error and turns them into the next thing to do
// with the arrow keys.
//
// The law is feed-forward from the path with a little feedback, and it is *early*: a person reading a
// Vietnamese sentence and then pressing a key is 100 to 500 ms behind the line, and a car at the
// idle creep covers up to a metre in that time. The cue is therefore worked out for where the car
// will be when the key lands, not where it is when the line is read (see `cueFigure`).

import { creepSpeedMps, type Ruleset } from './ruleset.ts';
import type { SimState } from './sim/session.ts';

/** Which figure this is; matches the core's exercise ids. */
export type Figure = 4 | 6;

/** The centreline of a figure, as `sim_course` gives it: metres in the sim's frame. */
export type Centreline = readonly (readonly [number, number])[];

/** The steering key the page is asking for. One value, one key: `straight` means let go. */
export type FigureCue = 'left' | 'right' | 'straight';

/** A point and unit tangent on the centreline at `progress_m`. */
export function pointAt(points: Centreline, progressM: number): { x: number; y: number; tx: number; ty: number } {
  const n = points.length;
  let acc = 0;
  for (let i = 1; i < n; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d === 0) continue;
    if (acc + d >= progressM) {
      const t = (progressM - acc) / d;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, tx: (x1 - x0) / d, ty: (y1 - y0) / d };
    }
    acc += d;
  }
  const [x0, y0] = points[n - 2];
  const [x1, y1] = points[n - 1];
  const d = Math.hypot(x1 - x0, y1 - y0) || 1;
  return { x: x1, y: y1, tx: (x1 - x0) / d, ty: (y1 - y0) / d };
}

/** Total length of a polyline, metres. */
export function centrelineLengthM(points: Centreline): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** The direction of the path at `at` metres, radians: the chord from `half` before to `half` after. */
function pathHeading(points: Centreline, at: number, half: number): number {
  const total = centrelineLengthM(points);
  const a = pointAt(points, Math.max(0, at - half));
  const b = pointAt(points, Math.min(total, at + half));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The path's curvature at `at` metres, 1/m (+ = left), from two chords `half` apart. */
function pathCurvature(points: Centreline, at: number, half: number): number {
  const total = centrelineLengthM(points);
  const mid = Math.max(half, Math.min(total - half, at));
  return wrap(pathHeading(points, mid + half / 2, half) - pathHeading(points, mid - half / 2, half)) / half;
}

/**
 * The steering cue, and why it is shaped like this.
 *
 * A keyboard wheel is a *rate*, not an angle: holding ← winds the wheel toward full lock at
 * `FEEL.steer.rate` and letting go unwinds it at `FEEL.steer.centre`. And the learner is late: 100 to
 * 500 ms of reading and reaching, plus the page being polled, so the key lands 0.2 to 1 m of path
 * after the line changed. Measured on bài 6 with a learner who reads `data-cue` every 50 ms and acts
 * after a fixed delay (the Supervisor's script): the previous law, which named the wheel angle for
 * where the car *is*, failed from 350 ms with the outer front wheel on the paint after the S-bend's
 * reversal, where the wheel has to swing from full left to full right (a whole second at the key's
 * rate) and any lateness is a metre of wrong-way travel.
 *
 * So the cue is for where the car will be when the key lands:
 *   * feed-forward: the wheel angle the path's own curvature asks for, taken at a lead distance
 *     `v · (REACT_S + SWING_SHARE · swing time)` ahead — the reaction the cue assumes, plus the share
 *     of the time the wheel needs to get there, so a learner who is early or late by the same amount
 *     lands on the path either way;
 *   * feedback, small and smooth: the car's heading against the *smoothed* path direction (the core's
 *     centreline is a chain of 6.7° chords, and the raw heading error jumps by 0.12 rad at each joint,
 *     which flickered the cue to `straight` mid-bend and cost the learner a release each time), plus
 *     the cross-track offset, plus where the wheel will be heading once the key is let go.
 * The sum is compared with a dead band: inside it the line says `straight` ("let go").
 */
const REACT_S = 0.45;
const SWING_SHARE = 0.465;
/** Half-length of the chords the path direction and curvature are read from, metres. */
const PATH_CHORD_M = 0.98;
const HEADING_GAIN = 1.06;
/** Cross-track: `atan(CROSS_TRACK_M * lateral / v)`, radians. */
const CROSS_TRACK_M = 0.8;
/** The dead band on the wanted wheel angle, radians. */
const STEER_BAND_RAD = 0.16;

/** The wheel angle the car needs when the key lands, radians (+ = left), from the snapshot. */
export function wantSteer(s: SimState, centre: Centreline, ruleset: Ruleset): number {
  const { wheelbase_m: base, max_steer_rad: lock } = ruleset.vehicle;
  const v = Math.max(s.speedMps, 0.6);
  const target = (ahead: number): number => Math.atan(base * pathCurvature(centre, s.progressM + ahead, PATH_CHORD_M));
  // The lead depends on how far the wheel has to go, which depends on the lead: two passes settle it.
  let lead = v * REACT_S;
  for (let i = 0; i < 2; i += 1) {
    const swingS = Math.abs(target(lead) - s.steerRad) / (lock * ruleset.steer.rate);
    lead = v * (REACT_S + SWING_SHARE * swingS);
  }
  const feedForward = target(lead);
  const heading = wrap(s.heading - pathHeading(centre, s.progressM, PATH_CHORD_M));
  // Letting go leaves the wheel to unwind at `centre` rad/s, and the car keeps yawing meanwhile.
  const unwindS = Math.abs(s.steerRad) / ruleset.steer.centre;
  const yaw = (v * Math.tan(s.steerRad)) / base;
  const feedback = -HEADING_GAIN * (heading + yaw * unwindS) - Math.atan2(CROSS_TRACK_M * s.lateralM, v);
  return feedForward + feedback;
}

/**
 * The steering cue for a figure run, from the snapshot alone: which way to move the wheel now, or
 * `straight` to let go and let it centre. Pure, so the page, the test and the Supervisor read the same
 * answer.
 *
 * Speed is a *separate* channel (`paceFigure`), not a value of this cue: a learner told to speed up
 * would let go of the steering key to reach for the throttle, and the car would swing wide. One key
 * per cue; the speed is in the advice line's words.
 */
export function cueFigure(s: SimState, centre: Centreline, ruleset: Ruleset): FigureCue {
  if (centre.length < 2) return 'straight';
  const want = wantSteer(s, centre, ruleset);
  if (want > STEER_BAND_RAD) return 'left';
  if (want < -STEER_BAND_RAD) return 'right';
  return 'straight';
}

/**
 * The speed a figure is driven at, m/s: the car's own idle creep in first gear, from the ruleset's
 * gearbox — not a number chosen to make a sweep pass.
 *
 * Measured, and this is why. With the clutch up and no throttle the car holds 1.86 m/s (computed from
 * idle rpm × first gear ÷ final drive × wheel; 1.76 m/s measured on the slope). Slower than that has
 * to be held by riding the clutch or by braking, and braking below creep *in gear* stalls the engine
 * (`SH.X.CHET_MAY`), so a pace below creep is not an instruction a learner can carry out. At creep
 * both figures are drivable with no throttle at all: measured, 14 of 14 steer-lag combinations clean
 * on both, at every `FEEL.steer.speedScaleMps` from 6 to 14.
 *
 * So the advice line asks for one thing — "đừng ga, để xe tự bò" (no throttle, let the car creep).
 */
export function paceFigure(ruleset: Ruleset): number {
  return creepSpeedMps(ruleset);
}

const m = (v: number) => `${Math.round(v * 100) / 100} m`;

/** How far ahead the advice line looks for a bend to name, and how sharp counts as one (1/m). */
const BEND_AHEAD_M = 2.2;
const BEND_MIN_PER_M = 0.08;

/**
 * What the advice line says for a figure run: one sentence, the next thing to do. The steering key
 * comes from `cueFigure`; the speed and the "straighten now" come from the snapshot's own numbers, so
 * a learner reading only this line is told the key, the moment to hold and the moment to let go.
 */
export function adviceFigure(s: SimState, centre: Centreline, ruleset: Ruleset, figure: Figure): string {
  const name = figure === 4 ? 'bài 4' : 'bài 6';
  if (s.disqualified) return 'Đã bị đình chỉ. Bấm Esc để làm lại.';
  if (s.phase === 'done') return 'Đã qua vạch kết thúc. Bấm Esc để làm lại.';
  if (s.gear !== 1) return 'Chưa vào số 1 nên ga không kéo xe. Đạp côn hết cỡ (giữ Space), bấm 1.';
  if (s.handbrake) return 'Phanh tay đang kéo nên xe đứng yên. Bấm P để nhả, rồi cứ để côn tự bắt.';

  const pace = paceFigure(ruleset);
  const kmh = (v: number) => (v * 3.6).toFixed(0);
  // The curb is 0.1 m outside the 0.1 m line, so a wheel on the paint is 28 mm from it: a touch is
  // the moment to straighten, not to steer further.
  if (s.contact.some((c) => c === 2)) return 'Đã chạm bó vỉa — đình chỉ. Bấm Esc để làm lại.';
  if (s.contact.some((c) => c === 1)) {
    return `Có bánh đè vạch: trả lái cho thẳng ngay (thả phím ← →), xe tự về tim đường.`;
  }
  // The car creeps at idle by itself; touching the throttle is what makes it too fast, so that is
  // what the line tells the learner to stop doing.
  if (s.speedMps > pace + 0.15) {
    return `Quá nhanh cho ${name} (${kmh(s.speedMps)} km/h): nhả ga ↑ ra, đừng ga nữa — cứ để xe tự bò khoảng ${kmh(pace)} km/h là đủ.`;
  }
  if (s.clockS === 0 && s.progressM < 1) return 'Nhả phanh tay P, vào số 1 rồi cứ để xe tự bò qua vạch, đừng ga.';

  const cue = cueFigure(s, centre, ruleset);
  const side = s.lateralM;
  const off = Math.abs(side);
  if (cue === 'left') {
    return off > 0.25 && side < 0
      ? `Đánh lái ← sang trái, xe đang lệch phải ${m(off)}; giữ phím tới khi về tim đường.`
      : `Đánh lái ← sang trái và giữ, vào cua.`;
  }
  if (cue === 'right') {
    return off > 0.25 && side > 0
      ? `Đánh lái → sang phải, xe đang lệch trái ${m(off)}; giữ phím tới khi về tim đường.`
      : `Đánh lái → sang phải và giữ, vào cua.`;
  }
  // Straight: say the speed to keep, and name the bend that is coming so it is not a surprise.
  const bend = pathCurvature(centre, s.progressM + BEND_AHEAD_M, PATH_CHORD_M);
  const speed = 'đừng ga, cứ để xe tự bò';
  if (bend < -BEND_MIN_PER_M) return `Thả lái cho thẳng (xe đang lệch ${m(side)}), ${speed} — sắp tới cua phải.`;
  if (bend > BEND_MIN_PER_M) return `Thả lái cho thẳng (xe đang lệch ${m(side)}), ${speed} — sắp tới cua trái.`;
  return `Thả lái cho thẳng, ${speed}; xe đang lệch tim đường ${m(side)}.`;
}
