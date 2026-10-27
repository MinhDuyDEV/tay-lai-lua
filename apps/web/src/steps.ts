// The step checklist and the "what to do next" line, as pure data and pure functions of the core's
// state. The HUD paints them and the end-to-end test drives from them: the test waits for the
// checklist to say a step is done before pressing the next key, so no test step is a guess at timing.
// One list per exercise; `exercise.ts` picks which one a page uses.

import { DT } from '../input/driver.ts';
import { coastDecel, gearSignM, hillOf, junctionOf, roadOf, type Ruleset } from './ruleset.ts';
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
  // bài 7, 8
  | 'into'
  | 'back'
  | 'inside'
  // bài 4 / bài 6
  | 'entry'
  | 'vet'
  | 'finish'
  // bài 2 / bài 9 / bài 11 / bài 5
  | 'approach'
  | 'yield'
  | 'through'
  | 'end'
  // bài 10
  | 'shift2'
  | 'shift1';

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

/**
 * Bài 7 and bài 8's checklist: the sequence the law itself gives ("2.3.1 lái xe tiến vào khoảng cách
 * khống chế … 2.3.2 lùi để ghép xe vào nơi đỗ … 2.3.3 dừng xe khi bánh xe sau nằm trên vị trí đỗ").
 * The steps are marked from the core's own fields — `hullInside` is the scorer's answer, not the
 * page's — so the checklist cannot claim a step the exam has not credited.
 */
export const PARK_STEPS: readonly Step[] = [
  { id: 'gear', label: 'Côn + số 1, nhả phanh tay', key: 'Space, 1, P' },
  { id: 'into', label: 'Tiến vào khoảng khống chế, qua cửa ô', key: '↑, ↓, ← →' },
  { id: 'back', label: 'Lùi vào ô (R), đánh lái theo lời nhắc', key: 'R, ← →' },
  { id: 'inside', label: 'Thân xe nằm trọn trong ô', key: '← →' },
  { id: 'signal', label: 'Đứng phanh đến khi có tín hiệu, rồi Enter', key: '↓, Enter' },
];

export function markPark(done: Set<StepId>, state: SimState): void {
  if (state.gear !== 0 && state.clutch > 0.9) done.add('gear');
  // The car has entered the control distance once the core's clock is running.
  if (state.clockMs > 0) done.add('into');
  if (state.gear === -1) done.add('back');
  if (state.hullInside) done.add('inside');
  if (state.finishSignal) done.add('signal');
}

/**
 * Bài 10's checklist: the law's own order — start, shift up inside the first 25 m and be above 24 km/h
 * at sign 2, then bring the speed down, shift back and be below 24 km/h at sign 3
 * (`gear.speed`, `gear.back`, `assumptions.gear_speed_reading`). Every step is marked from a sign the
 * bumper has actually crossed, so the checklist cannot tick a step the car has not done yet.
 */
export const GEAR_STEPS: readonly Step[] = [
  { id: 'gear', label: 'Côn + số 1, nhả phanh tay', key: 'Space, 1, P' },
  { id: 'away', label: 'Chạy đà bằng số 1 tới biển thứ nhất', key: '↑' },
  { id: 'shift2', label: 'Qua biển 1: lên số 2, đủ nhanh ở biển 2', key: 'Space, 2, ↑' },
  { id: 'shift1', label: 'Qua biển 2: giảm tốc, về số 1, đủ chậm ở biển 3', key: '↓, Space, 1' },
  { id: 'end', label: 'Qua biển thứ ba là hết bài', key: '—' },
];

export function markGear(done: Set<StepId>, state: SimState, ruleset: Ruleset): void {
  if (!ruleset.gear) return;
  if (state.gear === 1 && state.clutch > 0.9) done.add('gear');
  if (state.frontBumperM >= gearSignM(ruleset.gear, 0)) done.add('away');
  if (state.frontBumperM >= gearSignM(ruleset.gear, 1)) done.add('shift2');
  if (state.frontBumperM >= gearSignM(ruleset.gear, 2)) done.add('shift1');
  if (state.phase === 'done' && !state.disqualified) done.add('end');
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

  // Bài 11 is the finish, not a stop short of a line: SH.KT.KHONG_QUA_VACH disqualifies a car that
  // *stops* before the finish line, and SH.KT.KHONG_XI_NHAN_PHAI charges one that crosses without the
  // right signal. So it must not be told to brake for the line or to read a countdown — it has none —
  // and the signal has to be asked for before the crossing, not after a stop that would end the run.
  if (lesson === 11) return adviceFinish(state, road);
  if (state.sinceStopTicks < 0) {
    if (state.speedMps > 2.6) return 'Chậm lại: nhả ga, để xe tự bò tới vạch dừng.';
    if (state.lineGapM < 0) return 'Đã qua vạch mà chưa dừng.';
    const aid = state.lineGapM > 0 && state.lineGapM < 2 ? ' Bám thanh đếm ngược cạnh số A.' : '';
    return `Còn ${mm(state.lineGapM)} tới vạch dừng; ${STOP_KEYS}${aid}`;
  }

  // Stopped at the line.
  const a = state.stopGapAM;
  if (a < 0 || a > road.max_a_m) {
    return a < 0
      ? `Đã dừng quá vạch ${mm(-a)}. Bấm Esc để làm lại nếu muốn điểm tuyệt đối.`
      : `Đã dừng khi còn ${mm(a)} tới vạch, quá xa. Bấm Esc để làm lại nếu muốn điểm tuyệt đối.`;
  }
  const what = lesson === 2 ? 'người đi bộ' : 'đường sắt';
  return `Dừng đúng vạch. Qua vạch rồi chạy tiếp, chú ý ${what}.`;
}

/**
 * Bài 11's advice: the finish is crossed, not approached for a stop. The order the exercise scores is
 * signal right, cross the finish line, then stop past it — so the line asks for the signal as soon as
 * the car is moving, keeps asking if it is missing, and only asks for the stop once the bumper is over
 * the line. Its own rule is what the words come from: KHONG_QUA_VACH disqualifies a car that does not
 * cross, KHONG_XI_NHAN_PHAI charges one that crosses unsignalled.
 */
function adviceFinish(state: SimState, road: ReturnType<typeof roadOf>): string {
  if (state.signal !== 'right') {
    return state.lineGapM > 0
      ? `Bật xi nhan phải (W) trước khi qua vạch kết thúc, rồi chạy qua vạch. Còn ${Math.round(state.lineGapM * 1000)} mm.`
      : 'Bật xi nhan phải (W) ngay — vạch kết thúc đã qua và chưa có xi nhan.';
  }
  if (state.frontBumperM < road.finish_offset_m + road.start_front_bumper_m) {
    return 'Đã có xi nhan phải. Cứ chạy qua vạch kết thúc, đừng dừng lại trước vạch.';
  }
  if (state.speedMps > 0.05) return `Đã qua vạch kết thúc: ${STOP_KEYS}`;
  return 'Đã qua vạch và dừng. Hết bài.';
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

/**
 * The one sentence that tells the learner both keys of a stop at the line. A brake with the clutch up
 * stalls the engine (`SH.X.CHET_MAY`), and nothing on the page says so; a stop that stalls is not the
 * stop the exercise is teaching. The bar's own words are "bấm ngay", so the sentence names that moment.
 */
const STOP_KEYS =
  'đạp côn (giữ Space) và phanh (↓) cùng lúc khi thanh báo "bấm ngay", rồi giữ cả hai cho tới khi xe dừng.';

/**
 * The speed the line tells the learner to let go of ↑ at, km/h: the band's *read* threshold.
 *
 * This is the band's *read* threshold, not its target, because the learner is late by their own
 * reaction: measured on the core, a car with ↑ held gains ~14 km/h per second in first gear, so a
 * learner who acts 150–400 ms after reading this number has already passed it by 4–7 km/h, and the
 * key itself takes 0.17 s to fall back to nothing. Setting the read at 10 km/h puts that overshoot
 * at 14–16 km/h — under the lane edge, which a steady pace clears at 15 km/h at every reaction in
 * that range but touches at 16 with a 400 ms wheel.
 *
 * The lower bound is the exercise's clock: 20 s from the green to the end line, and the creep alone
 * (6.4 km/h, the car's idle in first gear) takes ~31 s for this route. A released car also falls
 * back to that creep, so the band is not held by one release: the line keeps asking for ↑ whenever
 * the car is under this number, which is what keeps the pace above the clock's floor.
 */
const JUNCTION_READ_KMH = 10;
/**
 * Above this the line stops asking about pace and tells the learner to brake, before anything else
 * that names a key. It is a runaway guard, not the band's ceiling: the band's ceiling is the lane edge
 * the read speed keeps the car under (~16 km/h), and a warning set there would fire on the overshoot
 * of a perfectly ordinary release and tell the learner to brake inside the turn — which is what put
 * the front wheels on the paint. Measured: a car told to brake at 17 km/h in the arc slid onto the
 * lane edge in every run where it happened; at 24 the same runs are clean.
 */
const JUNCTION_FAST_MPS = 24 / 3.6;
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
 * The pace sentence: one number, and the two things to do about it, from the speed the page shows.
 * The band is held by the learner's own loop — under the read speed, hold ↑; at it or above, let go.
 *
 * One number serves the whole route, and it is the *lowest* of the stretch's three bounds, because a
 * learner is late and the car does not stop gaining speed while they read: the release lands 4–6 km/h
 * above the number. Measured with a steady pace the arc clears 15 km/h at every reaction from 150 to
 * 400 ms and touches at 16 with a 400 ms wheel, so a read of 10 puts the car's own peak at 14–16
 * through the turn, and the same number bounds the exit straight, where the wheel is straight but a
 * 23 km/h car has 5 m of lateral drift in it. The lower bound is the clock: 20 s from the green to the
 * end line, with the creep alone (6.4 km/h) taking ~31 s for this route.
 */
function paceJunction(s: SimState): string {
  const n = (v: number) => (v * 3.6).toFixed(0);
  return s.speedMps * 3.6 >= JUNCTION_READ_KMH
    ? `Đủ đà rồi (${n(s.speedMps)} km/h): nhả ga ↑ ra, cứ để xe chạy đà.`
    : `Giữ ga ↑ cho tới ${JUNCTION_READ_KMH} km/h (đang ${n(s.speedMps)} km/h) rồi thả ra, xe còn lên thêm chút nữa.`;
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

  // Still short of the line: the light decides whether to stop or to go on. A car held at the line with
  // the green on is not "short of the line" in the way this sentence means — it has stopped and needs to
  // be told to go — so that case is checked first, before the line-gap branch can hide it.
  if (s.lineGapM > 0 && !(s.sinceStopTicks >= 0 && s.speedMps < 0.3)) {
    if (s.lightColour === RED || s.lightColour === YELLOW) {
      const colour = s.lightColour === RED ? 'Đèn đỏ' : 'Đèn vàng';
      // The sentence has to release the throttle as well as ask for the two keys. A learner who was
      // told to gain speed a moment before the light changed keeps holding ↑ otherwise, and reaches
      // the line at 10 km/h — where the aid's 275 ms lead is 25 cm of slack instead of a metre.
      return s.speedMps > 0.6
        ? `${colour}: nhả ga ↑ ra, rồi ${STOP_KEYS}`
        : `${colour}: dừng trong A (không quá ${mm(junction.max_a_m)}), chờ đèn xanh.`;
    }
    // The light is dark for the first ticks of the run (the core starts its cycle on the car's first
    // movement) or the run has just begun: nothing to decide yet.
    if (s.lightColour !== GREEN) return 'Chạy tới vạch dừng, xem đèn trước khi quyết định dừng hay đi.';
    // The pace is asked for here, in front of the line, and not only past it. The approach is 14 m of
    // the 20 s clock: a learner who waits for the green sentence — or worse, for the line's first pace
    // words after the line — spends most of the clock at the creep and cannot finish. The signal joins
    // the same sentence, because KHONG_XI_NHAN is read at the arc's start.
    const signal = s.signal === 'right' ? '' : 'Bật xi nhan phải (W). ';
    return `${signal}${paceJunction(s)}`;
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
    return `Đã dừng, đèn xanh, xi nhan phải: nhả phanh cho xe đi. ${paceJunction(s)}`;
  }

  // Past the line: the turn. The cue is the same one the figures use.
  if (s.signal !== 'right') return 'Bật xi nhan phải (W) ngay, trước khi vào cua.';

  // Over-speed comes first, before the steering cue: at 29.7 km/h the cue for the bend is what the
  // learner read, the speed warning never showed, and the car went into the lane edge. Speed is the
  // thing that has to be fixed first, and it is checked before anything else that names a key.
  if (s.speedMps > JUNCTION_FAST_MPS) {
    return `Quá nhanh trong ngã tư (${kmh(s.speedMps)} km/h): đạp côn (Space) rồi phanh ↓ cho xe chậm lại ngay.`;
  }
  // The lane edges are what SAI_VACH_KE is charged on, so the warning is the wheels' own contacts
  // (snapshot 27..30), not the car's centre: the outer front corner reaches the edge while the centre
  // is still ~0.5 m inside the lane, so a centre-based warning would come too late to act on.
  if (s.contact.some((c) => c === 2)) return 'Đã chạm bó vỉa — đình chỉ. Bấm Esc để làm lại.';
  if (s.contact.some((c) => c === 1)) {
    const wheel = ['trước trái', 'trước phải', 'sau trái', 'sau phải'][s.contact.findIndex((c) => c === 1)];
    return `Bánh ${wheel} chạm vạch làn: trả lái ngay (thả phím ← →) cho xe về giữa làn.`;
  }

  const pace = paceJunction(s);
  if (cue === 'right') return `${pace} Đánh lái → sang phải và giữ, rẽ phải trong làn.`;
  if (cue === 'left') return `${pace} Trả lái ← lại cho thẳng sau khi qua cua.`;
  return `${pace} Giữ lái cho thẳng, đi hết làn ra khỏi ngã tư.`;
}
