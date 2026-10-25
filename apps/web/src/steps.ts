// The step checklist, as pure data. The HUD paints it and the end-to-end test drives from it: the
// test waits for the checklist to say a step is done before pressing the next key, so no test step
// is a guess at timing.

import type { SimState } from './sim/session.ts';

export type StepId = 'engine' | 'belt' | 'order' | 'signal' | 'gear' | 'away';

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
];

/** Which steps are done, from the state the core is actually in. */
export function stepDone(id: StepId, state: SimState, ordered: boolean): boolean {
  switch (id) {
    case 'engine':
      return state.engineOn;
    case 'belt':
      return state.belt;
    case 'order':
      return ordered;
    case 'signal':
      return state.signal === 'left';
    case 'gear':
      return state.gear === 1 && state.clutch > 0.9;
    case 'away':
      return state.frontBumperM >= 0;
  }
}
