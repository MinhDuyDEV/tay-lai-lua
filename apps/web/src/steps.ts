// The step checklist and the "what to do next" line, as pure data and pure functions of the core's
// state. The HUD paints them and the end-to-end test drives from them: the test waits for the
// checklist to say a step is done before pressing the next key, so no test step is a guess at timing.
// One list per exercise; `exercise.ts` picks which one a page uses.

import { DT } from '../input/driver.ts';
import { coastDecel, hillOf, junctionOf, roadOf, type Ruleset } from './ruleset.ts';
import type { FigureCue } from './figures.ts';
import type { SimState } from './sim/session.ts';

export type StepId =
  | 'engine'
  | 'belt'
  | 'order'
  | 'signal'
  | 'gear'
  | 'away'
  | 'off'
  // bài 3
  | 'free'
  | 'stop'
  | 'start'
  | 'line'
  // bài 4 / bài 6
  | 'entry'
  | 'vet'
  | 'finish'
  // bài 2 / bài 9 / bài 11 / bài 5
  | 'approach'
  | 'yield'
  | 'through'
  | 'end';

export interface Step {
  id: StepId;
  label: string;
  /** What the learner must do, from the keyboard map. */
  key: string;
}

export const BAI1_STEPS: readonly Step[] = [
  { id: 'engine', label: 'Máy nổ', key: 'E' },
  { id: 'belt', label: 'Thắt dây an toàn', key: 'B' },
  { id: 'order', label: 'Nhận lệnh xuất phát', key: 'Enter' },
  { id: 'signal', label: 'Xi nhan trái', key: 'Q' },
  { id: 'gear', label: 'Côn + số 1', key: 'Space, 1' },
  { id: 'away', label: 'Qua vạch xuất phát', key: '↑' },
  { id: 'off', label: 'Tắt xi nhan ở 05 m sau vạch', key: 'Q' },
];

// The engine is already running in bài 3, so there is no step for it.
export const BAI3_STEPS: readonly Step[] = [
  { id: 'gear', label: 'Côn + số 1', key: 'Space, 1' },
  { id: 'free', label: 'Nhả phanh tay, lăn lên dốc', key: 'P, ↑' },
  { id: 'stop', label: 'Dừng, A không quá 500 mm', key: '↓' },
  { id: 'start', label: 'Khởi hành: kéo P, côn + ga, nhả P', key: 'P, Space, ↑' },
  { id: 'line', label: 'Qua vạch dừng', key: '↑' },
];

/**
 * Add every step this tick's state satisfies. A step stays done for the rest of the run, because
 * the learner has done it even when the signal or the gear changes again afterwards.
 */
export function markBai1(done: Set<StepId>, state: SimState, ruleset: Ruleset): void {
  if (state.engineOn) done.add('engine');
  if (state.belt) done.add('belt');
  if (state.phase !== 'waiting') done.add('order');
  if (state.signal === 'left') done.add('signal');
  if (state.gear === 1 && state.clutch > 0.9) done.add('gear');
  if (state.frontBumperM >= 0) done.add('away');
  if (done.has('signal') && state.signal === 'off' && state.frontBumperM >= ruleset.course.signal_off_early_m) done.add('off');
}

/** How far the car must move forward from where it stopped before it counts as pulling away. */
const AWAY_M = 0.1;

const stopped = (s: SimState) => s.sinceStopTicks >= 0;

export function markBai3(done: Set<StepId>, state: SimState, ruleset: Ruleset): void {
  const hill = hillOf(ruleset);
  if (state.gear === 1 && state.clutch > 0.9) done.add('gear');
  if (done.has('gear') && !state.handbrake) done.add('free');
  if (stopped(state) && state.stopGapAM >= 0 && state.stopGapAM <= hill.max_a_m) done.add('stop');
  // A stop closer to the line than AWAY_M has less road than that to pull away on: the line ends the run.
  if (stopped(state) && state.lineGapM <= Math.max(state.stopGapAM - AWAY_M, 0)) done.add('start');
  if (stopped(state) && state.lineGapM < 0 && !state.disqualified) done.add('line');
}

/** Bài 4/6 checklist: pass the entry gate, keep the wheels off the painted lines, pass the exit. */
export const FIGURE_STEPS: readonly Step[] = [
  { id: 'gear', label: 'Côn + số 1, nhả phanh tay', key: 'Space, 1, P' },
  { id: 'entry', label: 'Nhả côn, để xe tự bò qua vạch vào hình', key: 'Space' },
  { id: 'line', label: 'Giữ bánh xe trong làn, không đè vạch', key: '← →' },
  { id: 'finish', label: 'Qua vạch kết thúc', key: '← →' },
];

export function markFigure(done: Set<StepId>, state: SimState): void {
  if (state.gear === 1 && state.clutch < 0.1) done.add('gear');
  if (state.clockS > 0) done.add('entry');
  if (state.progressM > 0 && state.contact.every((c) => c === 0)) done.add('line');
  if (state.phase === 'done' && !state.disqualified) done.add('finish');
}

/** Seconds left of the 30 s since the stop, or null before the stop. */
export function secondsLeft(state: SimState, ruleset: Ruleset): number | null {
  if (!stopped(state)) return null;
  const limit = ruleset.rules.find((r) => r.id === 'SH.03.QUA_30S')?.params?.seconds;
  if (limit === undefined) return null;
  return Math.max(0, limit - state.sinceStopTicks * DT);
}

/**
 * Where a learner is told to act, from the state and the road's own physics.
 *
 * A cue is a key press, and a person is 100 to 400 ms late. At speed v that spread alone is 0.3·v
 * metres of road against a 0.50 m window for A, so past about 1.5 m/s the reaction spread fills the
 * whole window whatever distance the cue is given at (measured by `input/hill-feel.test.ts`). The
 * line therefore has two stages. Above the band it says `slow`: lift off, and the engine brake
 * brings the car back to its creep. Inside the band it cues the stop itself: `clutch` at the
 * distance the slope needs to coast the car still, then `brake` once it is nearly still.
 *
 * Both distances come from the measured coast deceleration (gravity along the grade plus rolling
 * resistance, `coastDecel`), read from the ruleset, so a different grade or car moves the cue with
 * it instead of leaving behind a constant that only fits one slope.
 */
export type Bai3Cue = 'slow' | 'clutch' | 'brake';

/**
 * Fastest approach speed the stop cue can hold inside A across a 100–400 ms reaction. The car's own
 * idle creep in gear is ~1.75 m/s, so this sits just above it: a learner who never touches the
 * throttle is never told to slow down.
 */
const V_BAND_MPS = 1.85;
/** The cue is placed for the middle of that sweep, so both ends land inside A. */
const LAG_MID_S = 0.25;
/** Where a mid-lag stop lands, measured back from the line. */
const A_TARGET_M = 0.30;
/** Below this the car is nearly still: the brake catches it and costs no road. */
const V_BRAKE_MPS = 0.3;
/** The slowest reaction the sweep covers. */
const LAG_MAX_S = 0.4;
/** How hard the engine alone sheds speed in gear with the throttle shut, m/s²; measured. */
const ENGINE_BRAKE_MPS2 = 0.9;
/** Road kept spare so a learner who is still slowing is not told to stop too early. */
const SLOW_LEAD_M = 0.35;

/** The coast from `v` to a stop, plus the mid-lag reaction, measured back from the line. */
function stopGap(v: number, coast: number): number {
  return LAG_MID_S * v + (v * v) / (2 * coast) + A_TARGET_M;
}

/**
 * Where `slow` starts. Above the band the car is still on the gas, so the learner has to lift off,
 * let the engine brake bring the car back to its creep, and then stop from there. All of that road,
 * plus the slowest reaction, has to fit before the stop cue.
 */
function slowGap(v: number, coast: number): number {
  const engineDecel = coast - ENGINE_BRAKE_MPS2;
  const shed = Math.max(0, v * v - V_BAND_MPS * V_BAND_MPS) / (2 * Math.max(0.1, engineDecel));
  return LAG_MAX_S * v + shed + stopGap(V_BAND_MPS, coast) + SLOW_LEAD_M;
}

/**
 * `slow` is a speed instruction, not a stop: the learner lifts off the throttle and the engine brake
 * brings the car down to its creep, where the stop cue can be honest. `clutch` then holds the car's
 * drive open so the slope does the slowing; `brake` catches it when it is nearly still.
 *
 * The HUD publishes it on the advice line (`data-cue`), so the page and the tests that drive it act
 * on the same thing.
 */
export function cueBai3(s: SimState, ruleset: Ruleset): Bai3Cue | null {
  if (s.disqualified || s.phase === 'done' || !s.engineOn || stopped(s)) return null;
  if (s.gear !== 1 || s.handbrake || s.lineGapM < 0) return null;
  // The stop line is on the slope, so the road the car will slow on is the slope's grade — not the
  // grade under the car now, which is 0 on the flat and would make the cue absurdly early.
  const coast = coastDecel(ruleset, hillOf(ruleset).grade);
  if (s.speedMps > V_BAND_MPS) return s.lineGapM <= slowGap(s.speedMps, coast) ? 'slow' : null;
  if (s.lineGapM > stopGap(s.speedMps, coast)) return null;
  return s.clutch > 0.9 && s.speedMps < V_BRAKE_MPS ? 'brake' : 'clutch';
}

const mm = (m: number) => `${Math.round(m * 1000)} mm`;
const kmh = (mps: number) => (mps * 3.6).toFixed(1);

/**
 * Bài 3: the one thing to do next, and why, read from the state. It also says why a key does
 * nothing (a throttle with the clutch down, a gear that is not 1) because a learner looks here
 * first when the car does not move.
 */
export function adviceBai3(s: SimState, ruleset: Ruleset): string {
  const hill = hillOf(ruleset);
  if (s.disqualified) return 'Đã bị đình chỉ. Bấm Esc để làm lại.';
  if (s.phase === 'done') return 'Đã qua vạch dừng. Bấm Esc để làm lại.';
  if (!s.engineOn) return 'Máy đã tắt. Đạp côn (giữ Space) rồi bấm E để nổ lại.';

  if (!stopped(s)) {
    if (s.gear !== 1) return 'Chưa vào số 1 nên ga không kéo xe. Đạp côn hết cỡ (giữ Space), bấm 1.';
    if (s.handbrake) return 'Phanh tay đang kéo nên xe đứng yên. Bấm P để nhả, rồi nhấc côn từ từ.';
    const cue = cueBai3(s, ruleset);
    if (cue === 'slow') {
      return `Quá nhanh (${kmh(s.speedMps)} km/h): nhả ga cho xe chậm lại, chỉ lăn tới vạch rồi hẵng dừng.`;
    }
    if (cue === 'brake') return 'Xe sắp dừng: phanh ↓ ngay, vẫn giữ Space.';
    if (cue === 'clutch') {
      return s.clutch > 0.9
        ? 'Giữ Space, xe đang chậm dần. Khi xe sắp dừng sẽ có lệnh phanh ↓.'
        : `Còn ${mm(s.lineGapM)} tới vạch. Đạp côn ngay (giữ Space), thả ga; chưa phanh.`;
    }
    if (s.clutch > 0.9) return 'Côn đang đạp xuống nên xe không đi. Nhả Space từ từ, giữ ga ↑ nhẹ.';
    if (s.lineGapM >= 0) {
      return `Còn ${mm(s.lineGapM)} tới vạch. Lăn chậm lên dốc; dừng khi còn không quá ${mm(hill.max_a_m)}.`;
    }
    return 'Đã quá vạch mà chưa dừng.';
  }

  const left = secondsLeft(s, ruleset);
  const clock = left === null ? '' : ` Còn ${Math.ceil(left)} giây để qua vạch.`;
  if (s.rollbackM > hill.max_rollback_m * 0.6) {
    return `Xe đang tụt dốc (${mm(s.rollbackM)}/${mm(hill.max_rollback_m)}). Kéo phanh tay P ngay.`;
  }
  if (s.handbrake) {
    return `Đã dừng, phanh tay giữ xe. Đạp côn, ga ↑ nhẹ, nhả côn tới điểm bắt, rồi nhả P.${clock}`;
  }
  if (s.speedMps < 0.2) return `Xe chỉ được giữ bằng phanh chân. Kéo phanh tay P, rồi khởi hành.${clock}`;
  return `Đang khởi hành. Giữ ga ↑ nhẹ, nhả côn dần.${clock}`;
}

// ---------------------------------------------------------------------------------------------
// Bài 2 (dừng xe nhường đường cho người đi bộ), bài 9 (tạm dừng ở chỗ có đường sắt) and bài 11
// (kết thúc): one straight road, a stop line, and one thing past it.
//
// The checklist is the same manoeuvre in all three — come up at the car's own pace, stop inside A at
// the line, then go on past it — and bài 11 adds the right signal for the finish line. The wording of
// each step is the exercise's own, because "nhường người đi bộ" and "đường sắt" are different things
// to look at even when the keys are the same.

/** A road exercise's three or four steps. `yieldLabel` is what is past the line, in the learner's words. */
export function roadSteps(lesson: 2 | 9 | 11): readonly Step[] {
  const steps: Step[] = [
    { id: 'gear', label: 'Côn + số 1', key: 'Space, 1' },
    { id: 'free', label: 'Nhả phanh tay, để xe tự bò', key: 'P' },
    { id: 'approach', label: 'Tới vạch dừng, giữ tốc độ chậm', key: '↑' },
    { id: 'stop', label: 'Dừng, A không quá 500 mm', key: '↓' },
  ];
  if (lesson === 2) steps.push({ id: 'yield', label: 'Nhường đường cho người đi bộ qua vạch', key: '—' });
  if (lesson === 9) steps.push({ id: 'yield', label: 'Tạm dừng, quan sát đường sắt rồi mới qua', key: '—' });
  if (lesson === 11) steps.push({ id: 'signal', label: 'Bật xi nhan phải trước vạch kết thúc', key: 'W' });
  steps.push({ id: 'line', label: lesson === 11 ? 'Qua vạch kết thúc rồi dừng' : 'Qua vạch, chạy tiếp', key: '↑' });
  return steps;
}

/**
 * Mark the road exercise's steps from the state. The stop is the core's own verdict (`stopGapAM`
 * recorded on the stop tick, `sinceStopTicks` from there), so the checklist and the scorer cannot
 * disagree about whether the car stopped inside A.
 */
export function markRoad(done: Set<StepId>, state: SimState, ruleset: Ruleset): void {
  const road = roadOf(ruleset);
  if (state.gear === 1 && state.clutch > 0.9) done.add('gear');
  if (done.has('gear') && !state.handbrake) done.add('free');
  if (state.sinceStopTicks < 0 && state.lineGapM < 2) done.add('approach');
  if (state.sinceStopTicks >= 0 && state.stopGapAM >= 0 && state.stopGapAM <= road.max_a_m) done.add('stop');
  if (state.sinceStopTicks >= 0 && state.signal === 'right') done.add('signal');
  // "Qua vạch": the bumper is past the line with the exercise still running.
  if (state.frontBumperM > 0) done.add('line');
}

/**
 * The road exercises' advice: a short sentence for the next thing, read from the same state the
 * scorer reads. `what` names the thing past the line so the words fit the lesson.
 */
export function adviceRoad(state: SimState, ruleset: Ruleset, lesson: 2 | 9 | 11): string {
  const road = roadOf(ruleset);
  const mm = (m: number) => `${Math.round(m * 1000)} mm`;
  if (state.disqualified) return 'Đã bị đình chỉ. Bấm Esc để làm lại.';
  if (state.phase === 'done') return 'Hết bài. Bấm Esc để làm lại.';
  if (!state.engineOn) return 'Máy đã tắt. Đạp côn (giữ Space) rồi bấm E để nổ lại.';
  if (state.gear !== 1) return 'Đạp côn hết cỡ (giữ Space), bấm 1 để vào số.';
  if (state.handbrake) return 'Phanh tay đang kéo. Bấm P để nhả, xe sẽ tự bò tới vạch.';

  if (state.sinceStopTicks < 0) {
    if (state.speedMps > 2.6) return 'Chậm lại: nhả ga, để xe tự bò tới vạch dừng.';
    if (state.lineGapM < 0) return 'Đã qua vạch mà chưa dừng.';
    const aid = state.lineGapM > 0 && state.lineGapM < 2 ? ' Bám thanh đếm ngược cạnh số A.' : '';
    return `Còn ${mm(state.lineGapM)} tới vạch dừng; phanh khi thanh đếm ngược báo.${aid}`;
  }

  // Stopped at the line.
  const a = state.stopGapAM;
  if (a < 0 || a > road.max_a_m) {
    return a < 0
      ? `Đã dừng quá vạch ${mm(-a)}. Bấm Esc để làm lại nếu muốn điểm tuyệt đối.`
      : `Đã dừng khi còn ${mm(a)} tới vạch, quá xa. Bấm Esc để làm lại nếu muốn điểm tuyệt đối.`;
  }
  if (lesson === 11) {
    if (state.speedMps <= 0.05 && state.signal !== 'right') return 'Bật xi nhan phải (W) trước khi qua vạch kết thúc.';
    return 'Qua vạch kết thúc rồi dừng hẳn.';
  }
  const what = lesson === 2 ? 'người đi bộ' : 'đường sắt';
  return `Dừng đúng vạch. Qua vạch rồi chạy tiếp, chú ý ${what}.`;
}

// ---------------------------------------------------------------------------------------------
// Bài 5: a signalled junction, right turn only. The manoeuvre is an order, and the order is what the
// advice line teaches: brake for the line while the light is red or yellow, wait on green at the
// line, signal right before the arc, hold the lane edge round it, then go through.
//
// Unlike bài 2 and bài 9, the stop here is not the exercise's: the light decides whether there is a
// stop at all. A green light is not a stop, so the aid is silent then and the checklist's stop step
// is filled by the light turning green rather than by the car standing still.

/** Bài 5's checklist: the order above, one step per thing the learner does. */
export const JUNCTION_STEPS: readonly Step[] = [
  { id: 'gear', label: 'Côn + số 1', key: 'Space, 1' },
  { id: 'free', label: 'Nhả phanh tay, chạy tới vạch', key: 'P' },
  { id: 'stop', label: 'Đèn đỏ/vàng: dừng trong A trước vạch', key: '↓' },
  { id: 'signal', label: 'Đèn xanh, bật xi nhan phải trước khi rẽ', key: 'W' },
  { id: 'through', label: 'Rẽ phải trong làn, qua vạch kết thúc ngã tư', key: '→' },
];

/** Green, from snapshot field 46. */
const GREEN = 3;
const YELLOW = 2;
const RED = 1;

/**
 * Mark bài 5's steps. The stop step is the light's, not the car's: it is done when the light asked
 * for a stop and the car made one inside A. A learner who meets a green light has nothing to stop
 * for, so the step is marked by carrying on through the line instead — the exercise is the junction,
 * not a stop at it.
 */
export function markJunction(done: Set<StepId>, state: SimState, ruleset: Ruleset): void {
  const junction = junctionOf(ruleset);
  if (state.gear === 1 && state.clutch > 0.9) done.add('gear');
  if (done.has('gear') && !state.handbrake) done.add('free');
  const askedToStop = state.lightColour === RED || state.lightColour === YELLOW;
  if (askedToStop && state.sinceStopTicks >= 0 && state.stopGapAM >= 0 && state.stopGapAM <= junction.max_a_m) {
    done.add('stop');
  }
  // A green light: the stop step is not this learner's to do.
  if (state.lightColour === GREEN && state.frontBumperM > 0) done.add('stop');
  if (state.signal === 'right' && state.frontBumperM > 0) done.add('signal');
  if (state.phase === 'done') done.add('through');
}

/**
 * Bài 5's advice: the order, one sentence at a time, from the state the scorer reads. The light is
 * the core's own field, so the line cannot say "green" on a tick the scorer calls red.
 */
export function adviceJunction(s: SimState, ruleset: Ruleset, cue: FigureCue | null): string {
  const junction = junctionOf(ruleset);
  const mm = (m: number) => `${Math.round(m * 1000)} mm`;
  const kmh = (v: number) => (v * 3.6).toFixed(1);
  if (s.disqualified) return 'Đã bị đình chỉ. Bấm Esc để làm lại.';
  if (s.phase === 'done') return 'Hết bài. Bấm Esc để làm lại.';
  if (!s.engineOn) return 'Máy đã tắt. Đạp côn (giữ Space) rồi bấm E để nổ lại.';
  if (s.gear !== 1) return 'Đạp côn hết cỡ (giữ Space), bấm 1 để vào số.';
  if (s.handbrake) return 'Phanh tay đang kéo. Bấm P để nhả, rồi chạy tới vạch dừng.';

  // Still short of the line: the light decides whether to stop or to go on.
  if (s.lineGapM > 0) {
    if (s.lightColour === GREEN) return 'Đèn xanh: cứ qua vạch, nhưng bật xi nhan phải (W) trước khi vào cua.';
    if (s.lightColour === RED || s.lightColour === YELLOW) {
      const colour = s.lightColour === RED ? 'Đèn đỏ' : 'Đèn vàng';
      if (s.speedMps > 3.4) return `${colour}: nhả ga cho xe chậm lại, phanh khi thanh đếm ngược báo.`;
      return `${colour}: dừng trong A (không quá ${mm(junction.max_a_m)}), chờ đèn xanh.`;
    }
    return 'Chạy tới vạch dừng, xem đèn trước khi quyết định dừng hay đi.';
  }

  // At a stop inside A: the order says wait for green, then signal, then turn.
  if (s.sinceStopTicks >= 0 && s.speedMps < 0.3) {
    const a = s.stopGapAM;
    if (a < 0 || a > junction.max_a_m) {
      return a < 0
        ? `Đã dừng quá vạch ${mm(-a)}. Bấm Esc để làm lại nếu muốn điểm tuyệt đối.`
        : `Đã dừng khi còn ${mm(a)} tới vạch, quá xa. Bấm Esc để làm lại nếu muốn điểm tuyệt đối.`;
    }
    if (s.lightColour !== GREEN) return `Dừng đúng vạch (A ${mm(a)}). Chờ đèn xanh rồi mới đi.`;
    if (s.signal !== 'right') return 'Đèn xanh rồi: bật xi nhan phải (W) trước khi vào cua.';
    return 'Đã dừng, đèn xanh, xi nhan phải: nhả phanh cho xe đi, rồi đánh lái sang phải.';
  }

  // Past the line: the turn. The cue is the same one the figures use.
  if (s.signal !== 'right') return 'Bật xi nhan phải (W) ngay, trước khi vào cua.';
  // The 20 s clock runs from the green and a junction is crossed at a real pace: at the idle creep
  // the route alone takes ~25 s, so "để xe tự bò" — the right advice for the figures — is the wrong
  // advice here. The number is the core's own clock, so this says "go faster" exactly when it does.
  const left20 = 20 - s.clockMs / 1000;
  if (s.clockMs > 0 && left20 > 0 && left20 < 12 && s.speedMps < 3.6) {
    return `Chỉ còn ${Math.ceil(left20)} giây để qua ngã tư: giữ ga ↑ cho xe nhanh lên, đừng bò.`;
  }
  // The lane edges are what SAI_VACH_KE is charged on, so the warning is the wheels' own contacts
  // (snapshot 27..30), not the car's centre: the outer front corner reaches the edge while the centre
  // is still ~0.5 m inside the lane, so a centre-based warning would come too late to act on.
  if (s.contact.some((c) => c === 2)) return 'Đã chạm bó vỉa — đình chỉ. Bấm Esc để làm lại.';
  if (s.contact.some((c) => c === 1)) {
    const wheel = ['trước trái', 'trước phải', 'sau trái', 'sau phải'][s.contact.findIndex((c) => c === 1)];
    return `Bánh ${wheel} chạm vạch làn: trả lái ngay (thả phím ← →) cho xe về giữa làn.`;
  }
  if (cue === 'right') return 'Đánh lái → sang phải và giữ, rẽ phải trong làn.';
  if (cue === 'left') return 'Trả lái ← lại cho thẳng sau khi qua cua.';
  if (s.speedMps > 5) return `Quá nhanh trong ngã tư (${kmh(s.speedMps)} km/h): nhả ga cho xe chậm lại.`;
  return 'Giữ lái cho thẳng, đi hết làn ra khỏi ngã tư.';
}
