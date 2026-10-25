// What differs between the exercises a page can run: the title, the id the core is created with,
// the checklist and the line that tells the learner what to do next. Stage, Hud, Scene and the run
// loop take one of these instead of carrying bài 1 constants.

import { seedWord } from './sim/session.ts';
import { adviceBai3, cueBai3, BAI1_STEPS, BAI3_STEPS, markBai1, markBai3, type Step, type StepId } from './steps.ts';
import type { Ruleset } from './ruleset.ts';
import type { SimState } from './sim/session.ts';

export type Lesson = 1 | 3;

export interface Exercise {
  lesson: Lesson;
  title: string;
  /** `sim_create`'s word; the recorded trace starts with the same 8 bytes. */
  seed: bigint;
  steps: readonly Step[];
  mark(done: Set<StepId>, state: SimState, ruleset: Ruleset): void;
  /** The line to do next, or null when the exercise has none. */
  advice(state: SimState, ruleset: Ruleset): string | null;
  /** The key the learner is being asked to press now, if any; published next to the advice line. */
  cue(state: SimState): string | null;
  /** How many key-legend entries the "enter the car" screen lists. */
  introKeys: number;
}

const EXERCISES: Record<Lesson, Exercise> = {
  1: {
    lesson: 1,
    title: 'Bài 1 — Xuất phát',
    seed: seedWord(0),
    steps: BAI1_STEPS,
    mark: markBai1,
    advice: () => null,
    cue: () => null,
    introKeys: 5,
  },
  3: {
    lesson: 3,
    title: 'Bài 3 — Dừng và khởi hành xe trên dốc',
    seed: seedWord(3),
    steps: BAI3_STEPS,
    mark: markBai3,
    advice: adviceBai3,
    cue: cueBai3,
    introKeys: 6,
  },
};

export const exerciseFor = (lesson: Lesson): Exercise => EXERCISES[lesson];
