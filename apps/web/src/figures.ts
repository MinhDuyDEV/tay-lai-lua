// Bài 4 and bài 6: the steering cues and the advice line for the two figures whose path is a drawn
// polyline. One source for the path is the core's own figure (`sim_course`, kind 5); the cue reads
// the snapshot's progress, lateral offset and heading error and turns them into the next thing to do
// with the arrow keys.
//
// The law is pursuit: aim at a point a lookahead further along the centreline and steer toward it.
// The lookahead has to be walkable by a person, so it is sized from the reaction: the car covers
// `v·lag` metres before the key lands, so the aim point must sit at least that far ahead or the
// learner is always correcting last second's error. That is also why the pace is limited: the
// driver's lock shrinks with speed (`input/driver.ts` FEEL.steer), and a figure's tightest radius
// sets the fastest speed the car can actually hold the line at.

import type { Ruleset } from './ruleset.ts';
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

/**
 * The tightest radius on the centreline, in metres.
 *
 * The core draws a bend as a chain of short chords, so a measurement window that lands on the join
 * between two arcs (where the turn reverses) reads far too tight. A bend the learner actually has to
 * hold is a *sustained* turn, so this takes the tightest radius that holds across a window as long as
 * the bend is: for every start point, the turn over the next `arc` metres, and the radius only counts
 * when the turn over the following `arc` metres is the same to within 10 %.
 */
export function tightestRadiusM(points: Centreline): number {
  const total = centrelineLengthM(points);
  const arc = 1.5;
  const step = 0.1;
  const turnOver = (at: number): number => {
    const a = pointAt(points, at);
    const b = pointAt(points, at + arc);
    return Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
  };
  let min = Infinity;
  for (let at = 0; at + arc * 2 <= total; at += step) {
    const first = turnOver(at);
    if (first < 1e-3) continue;
    const second = turnOver(at + arc);
    // A sustained bend: the next window turns by the same amount. A chord join does not.
    if (Math.abs(second - first) > first * 0.1) continue;
    const r = arc / first;
    if (r < min) min = r;
  }
  return min;
}

/**
 * The fastest speed the car's steering can hold a `radius` bend at, from the driver's own lock
 * model: `lock(v) = max(minLock, 1 / (1 + (v / speedScale)^2))` of `max_steer_rad`.
 */
export function maxSpeedForRadius(radiusM: number, ruleset: Ruleset): number {
  const { max_steer_rad: maxSteer, wheelbase_m: base } = ruleset.vehicle;
  const feel = ruleset.steer;
  const need = Math.atan(base / radiusM);
  let lo = 0;
  let hi = feel.speedScaleMps * 4;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const lock = Math.max(feel.minLock, 1 / (1 + (mid / feel.speedScaleMps) ** 2));
    if (lock * maxSteer >= need) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The steering law, and why it is shaped like this.
 *
 * A keyboard has no wheel to hold at an angle: the arrow key is a *rate* toward lock and letting go
 * centres it (`FEEL.steer`). So a cue that re-decides every tick makes the learner pump the key, and
 * the car weaves — measured: the 15 m bend on bài 4 swung from 0.6 m one side to 0.6 m the other.
 * What a bend needs is one instruction held for the length of the bend.
 *
 * So the cue is computed from where the car is on the path and what the path does next:
 *   * heading: turn back toward the path's own direction (`headingErrRad`);
 *   * cross-track: turn toward the centreline in proportion to how far off it the car is, scaled by
 *     speed so a slow car corrects sooner (`lateralM`);
 *   * feed-forward: the path's own turn over the next stretch, so the bend is entered, not
 *     discovered.
 * The sum is compared against a band wide enough that a small error does not change the answer, and
 * the answer is held until it genuinely changes — the cue names a key and a direction, and `straight`
 * means "let go, the wheel centres itself".
 */
const CROSS_TRACK_GAIN = 1.15;
/** How far ahead the bend is anticipated, metres: what the car covers in about a reaction. */
const FEED_FORWARD_M = 2.2;
/** The dead zone on the wanted steer, radians. Inside it the line says `straight`. */
const STEER_BAND_RAD = 0.055;
/** The turn the centreline takes over the `span` metres from `at`, radians (+ = left). */
function turnAhead(points: Centreline, at: number, span: number): number {
  const a = pointAt(points, at);
  const b = pointAt(points, Math.min(centrelineLengthM(points), at + span));
  return Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty);
}

/** The steer the car needs now, radians (+ = left), from the snapshot. */
function wantSteer(s: SimState, centre: Centreline): number {
  const v = Math.max(s.speedMps, 0.6);
  const cross = -Math.atan2(CROSS_TRACK_GAIN * s.lateralM, v);
  const feed = turnAhead(centre, s.progressM, FEED_FORWARD_M);
  return -s.headingErrRad + cross + feed;
}

/**
 * The steering cue for a figure run, from the snapshot alone: which arrow key to hold, or `straight`
 * to let go and let the wheel centre itself. Pure, so the page, the test and the Supervisor read the
 * same answer.
 *
 * Speed is a *separate* channel (`paceFigure`), not a value of this cue: a learner who is told `go`
 * would let go of the steering key to press the throttle, and the car would swing wide. One key per
 * cue, and the speed in the advice line's words.
 */
export function cueFigure(s: SimState, centre: Centreline): FigureCue {
  if (centre.length < 2) return 'straight';
  const want = wantSteer(s, centre);
  if (want > STEER_BAND_RAD) return 'left';
  if (want < -STEER_BAND_RAD) return 'right';
  return 'straight';
}

/**
 * The pace the figure can actually be held at, m/s: the fastest speed the driver's own steering lock
 * can hold the tightest bend at. Published next to the cue and printed in the advice line, so the
 * speed the learner is asked for and the speed the test drives at are the same number.
 */
export function paceFigure(centre: Centreline, ruleset: Ruleset): number {
  const r = tightestRadiusM(centre);
  return Number.isFinite(r) ? maxSpeedForRadius(r, ruleset) : ruleset.steer.speedScaleMps;
}

/** The band the cue uses, exported so a learner model in a test can hold a key the same way. */
export const CUE_BAND_RAD = STEER_BAND_RAD;

const m = (v: number) => `${Math.round(v * 100) / 100} m`;

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
  if (s.handbrake) return 'Phanh tay đang kéo nên xe đứng yên. Bấm P để nhả, rồi nhấn ga ↑ nhẹ.';

  const pace = paceFigure(centre, ruleset);
  const kmh = (v: number) => (v * 3.6).toFixed(0);
  // The curb is 0.1 m outside the 0.1 m line, so a wheel on the paint is 28 mm from it: a touch is
  // the moment to straighten, not to steer further.
  if (s.contact.some((c) => c === 2)) return 'Đã chạm bó vỉa — đình chỉ. Bấm Esc để làm lại.';
  if (s.contact.some((c) => c === 1)) {
    return `Có bánh đè vạch: trả lái cho thẳng ngay (thả phím ← →), xe tự về tim đường.`;
  }
  if (s.speedMps > pace + 0.15) {
    return `Quá nhanh cho ${name} (${kmh(s.speedMps)} km/h): nhả ga cho xe chậm lại, hình này chỉ chạy được khoảng ${kmh(pace)} km/h.`;
  }
  if (s.clockS === 0 && s.progressM < 1) return 'Nhả phanh tay P, vào số 1 rồi nhấn ga ↑ nhẹ đi qua vạch vào hình.';

  const cue = cueFigure(s, centre);
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
  const feed = turnAhead(centre, s.progressM, FEED_FORWARD_M);
  const speed = `giữ khoảng ${kmh(pace)} km/h`;
  if (feed < -0.12) return `Thả lái cho thẳng (xe đang lệch ${m(side)}), ${speed} — sắp tới cua phải.`;
  if (feed > 0.12) return `Thả lái cho thẳng (xe đang lệch ${m(side)}), ${speed} — sắp tới cua trái.`;
  return `Thả lái cho thẳng, ${speed}; xe đang lệch tim đường ${m(side)}.`;
}
