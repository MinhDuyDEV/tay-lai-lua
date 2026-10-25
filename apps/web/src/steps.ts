// The step checklist and the "what to do next" line, as pure data and pure functions of the core's
// state. The HUD paints them and the end-to-end test drives from them: the test waits for the
// checklist to say a step is done before pressing the next key, so no test step is a guess at timing.
// One list per exercise; `exercise.ts` picks which one a page uses.

import { DT } from '../input/driver.ts';
import { hillOf, type Ruleset } from './ruleset.ts';
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
  | 'line';

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

/** Seconds left of the 30 s since the stop, or null before the stop. */
export function secondsLeft(state: SimState, ruleset: Ruleset): number | null {
  if (!stopped(state)) return null;
  const limit = ruleset.rules.find((r) => r.id === 'SH.03.QUA_30S')?.params?.seconds;
  if (limit === undefined) return null;
  return Math.max(0, limit - state.sinceStopTicks * DT);
}

/**
 * Where a learner is told to act. The car creeps up at about 1.3 m/s, so a reaction of 100 to
 * 400 ms is 0.13 to 0.52 m of road against a 0.5 m window: the clutch cue comes 1.6 m short of the
 * line and the slope's own deceleration does the slowing; the brake cue comes when the car is
 * nearly still, so a late brake costs no distance (gravity stops it, the brake catches it). Tuned
 * so that every lag from 100 to 400 ms stops inside A (apps/web/input/hill-feel.test.ts).
 */
const CLUTCH_CUE_M = 1.6;
const BRAKE_CUE_MPS = 0.3;

/**
 * 'clutch': press and hold the clutch. 'brake': the car is nearly still with the clutch down, press
 * the brake too. null: nothing to do about the stop (yet, or any more). The HUD publishes it on the
 * advice line (`data-cue`), so the page and the tests that drive it act on the same thing.
 */
export function cueBai3(s: SimState): 'clutch' | 'brake' | null {
  if (s.disqualified || s.phase === 'done' || !s.engineOn || stopped(s)) return null;
  if (s.gear !== 1 || s.handbrake || s.lineGapM < 0 || s.lineGapM >= CLUTCH_CUE_M) return null;
  return s.clutch > 0.9 && s.speedMps < BRAKE_CUE_MPS ? 'brake' : 'clutch';
}

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

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
    const cue = cueBai3(s);
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
