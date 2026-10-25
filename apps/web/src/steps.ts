// The step checklist, as pure data. The HUD paints it and the end-to-end test drives from it: the
// test waits for the checklist to say a step is done before pressing the next key, so no test step
// is a guess at timing.

import type { SimState } from './sim/session.ts';

export type StepId = 'engine' | 'belt' | 'order' | 'signal' | 'gear' | 'away' | 'off';

export interface Step {
  id: StepId;
  label: string;
  /** What the learner must do, from the keyboard map. */
  key: string;
}

export const STEPS: readonly Step[] = [
  { id: 'engine', label: 'Máy nổ', key: 'E' },
  { id: 'belt', label: 'Thắt dây an toàn', key: 'B' },
  { id: 'order', label: 'Nhận lệnh xuất phát', key: 'Enter' },
  { id: 'signal', label: 'Xi nhan trái', key: 'Q' },
  { id: 'gear', label: 'Côn + số 1', key: 'Space, 1' },
  { id: 'away', label: 'Qua vạch xuất phát', key: '↑' },
  { id: 'off', label: 'Tắt xi nhan ở 05 m sau vạch', key: 'Q' },
];

/**
 * Add every step this tick's state satisfies. A step stays done for the rest of the run, because
 * the learner has done it even when the signal or the gear changes again afterwards.
 * `offFromM` is where turning the signal off stops being too early (the ruleset's early edge).
 */
export function markDone(done: Set<StepId>, state: SimState, ordered: boolean, offFromM: number): void {
  if (state.engineOn) done.add('engine');
  if (state.belt) done.add('belt');
  if (ordered) done.add('order');
  if (state.signal === 'left') done.add('signal');
  if (state.gear === 1 && state.clutch > 0.9) done.add('gear');
  if (state.frontBumperM >= 0) done.add('away');
  if (done.has('signal') && state.signal === 'off' && state.frontBumperM >= offFromM) done.add('off');
}
