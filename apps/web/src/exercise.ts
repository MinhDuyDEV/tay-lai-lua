// What differs between the exercises a page can run: the title, the id the core is created with,
// the checklist and the line that tells the learner what to do next. Stage, Hud, Scene and the run
// loop take one of these instead of carrying bài 1 constants.

import { flatRoad, stopAid, type StopAid, type StopRoad } from './stopAid.ts';
import { seedWord } from './sim/session.ts';
import { adviceFigure, cueFigure, wantSteer, type Centreline } from './figures.ts';
import {
  adviceBai3,
  adviceJunction,
  adviceRoad,
  cueBai3,
  JUNCTION_STEPS,
  markJunction,
  markRoad,
  roadSteps,
  FIGURE_STEPS,
  markBai1,
  markBai3,
  markFigure,
  BAI1_STEPS,
  BAI3_STEPS,
  type Step,
  type StepId,
} from './steps.ts';
import { hillOf, junctionOf, type Ruleset } from './ruleset.ts';
import type { SimState } from './sim/session.ts';

export type Lesson = 1 | 2 | 3 | 4 | 5 | 6 | 9 | 11;

/**
 * The straight-road lessons: a lane, a stop line, and one thing past it. They share the road scene
 * and the stop aid, and differ in the checklist, the advice and the codes the core charges.
 */
export type RoadLesson = 2 | 9 | 11;
const isRoadLesson = (lesson: Lesson): lesson is RoadLesson => lesson === 2 || lesson === 9 || lesson === 11;

/**
 * Which lessons show the signal keys: bài 1 (left signal at the start), bài 11 (right signal across
 * the finish line), and bài 5 (KHONG_XI_NHAN, charged when the car enters the arc without it). Bài 2
 * and bài 9 score no signal, so their legend does not offer one.
 */
const SIGNAL_LESSONS: ReadonlySet<Lesson> = new Set([1, 5, 11]);

export interface Exercise {
  lesson: Lesson;
  title: string;
  /** The page's meta description: one line, for a search result or a link preview. */
  description: string;
  /** `sim_create`'s word; the recorded trace starts with the same 8 bytes. */
  seed: bigint;
  steps: readonly Step[];
  mark(done: Set<StepId>, state: SimState, ruleset: Ruleset): void;
  /** The line to do next, or null when the exercise has none. */
  advice(state: SimState, ruleset: Ruleset, centre: Centreline): string | null;
  /** The key the learner is being asked to press now, if any; published next to the advice line. */
  cue(state: SimState, ruleset: Ruleset, centre: Centreline): string | null;
  /**
   * The countdown to the one key that decides the stop, or null when this exercise has no stop line
   * to make. The road and the critical key are the exercise's own; the arithmetic is `stopAid`.
   */
  stop(state: SimState, ruleset: Ruleset): StopAid | null;
  /** Whether the lesson's key legend lists the signal stalk, because the lesson scores signals. */
  signals: boolean;
  /** Whether the lesson has a stop line the aid counts down to, so the HUD draws its bar. */
  stops: boolean;
  /** How many key-legend entries the "enter the car" screen lists. */
  introKeys: number;
}

const EXERCISES: Record<Lesson, Exercise> = {
  1: {
    lesson: 1,
    title: 'Bài 1 — Xuất phát',
    description: 'Bài 1 xuất phát: nổ máy, thắt dây, xi nhan trái, vào số 1 và qua vạch xuất phát, bằng bàn phím.',
    seed: seedWord(0),
    steps: BAI1_STEPS,
    mark: markBai1,
    advice: () => null,
    cue: () => null,
    stop: () => null,
    signals: SIGNAL_LESSONS.has(1),
    stops: false,
    introKeys: 5,
  },
  3: {
    lesson: 3,
    title: 'Bài 3 — Dừng và khởi hành xe trên dốc',
    description: 'Tập bài dừng và khởi hành xe trên dốc, sa hình hạng B, bằng bàn phím.',
    seed: seedWord(3),
    steps: BAI3_STEPS,
    mark: markBai3,
    advice: adviceBai3,
    cue: cueBai3,
    stop: stopBai3,
    signals: SIGNAL_LESSONS.has(3),
    stops: true,
    introKeys: 6,
  },
  4: {
    lesson: 4,
    title: 'Bài 4 — Qua vệt bánh xe và đường vòng vuông góc',
    description: 'Tập bài qua vệt bánh xe và đường vòng vuông góc, sa hình hạng B, bằng bàn phím.',
    seed: seedWord(4),
    steps: FIGURE_STEPS,
    mark: markFigure,
    advice: (state, ruleset, centre) => adviceFigure(state, centre, ruleset, 4),
    cue: (state, ruleset, centre) => cueFigure(state, centre, ruleset),
    stop: () => null,
    signals: SIGNAL_LESSONS.has(4),
    stops: false,
    introKeys: 5,
  },
  6: {
    lesson: 6,
    title: 'Bài 6 — Qua đường vòng quanh co',
    description: 'Tập bài qua đường vòng quanh co, sa hình hạng B, bằng bàn phím.',
    seed: seedWord(6),
    steps: FIGURE_STEPS,
    mark: markFigure,
    advice: (state, ruleset, centre) => adviceFigure(state, centre, ruleset, 6),
    cue: (state, ruleset, centre) => cueFigure(state, centre, ruleset),
    stop: () => null,
    signals: SIGNAL_LESSONS.has(6),
    stops: false,
    introKeys: 5,
  },
  2: road(2, 'Bài 2 — Dừng xe nhường đường cho người đi bộ', 'Dừng đúng vạch cho người đi bộ qua, rồi đi tiếp, bằng bàn phím.'),
  9: road(9, 'Bài 9 — Tạm dừng ở chỗ có đường sắt chạy qua', 'Tạm dừng đúng vạch trước đường sắt, quan sát rồi đi tiếp, bằng bàn phím.'),
  11: road(11, 'Bài 11 — Kết thúc', 'Qua vạch kết thúc với xi nhan phải rồi dừng, bằng bàn phím.'),
  5: junction(5, seedWord(5, 1n)),
};

export const exerciseFor = (lesson: Lesson): Exercise => EXERCISES[lesson];

/**
 * Bài 3's stop line is on its slope: the grade under the car is the slope's from the foot on and level
 * before it. That is the road `stopAid` walks along, read from the ruleset's own `hill` block rather
 * than assumed, so a different slope or stop line moves the countdown with it.
 */
function stopBai3(state: SimState, ruleset: Ruleset): StopAid | null {
  const hill = hillOf(ruleset);
  const road: StopRoad = {
    grade: (toLineM) => {
      const x = hill.stop_line_from_foot_m - toLineM;
      return x > hill.foot_x_m && x < hill.foot_x_m + hill.slope_length_m ? hill.grade : 0;
    },
    key: 'clutch',
  };
  return stopAid(state, ruleset, road);
}

/**
 * A straight-road exercise: the same stop aid as bài 3, on the flat, timing the brake — a coasting car
 * on the level sheds only ~0.12 m/s², so the clutch alone would never stop it in time, and the brake is
 * the only key that decides whether A lands inside 500 mm. Bài 11's stop is at the finish line, which
 * charges no distance A, so it gets no countdown: what it times is the right signal, not the gap.
 */
function road(lesson: RoadLesson, title: string, description: string): Exercise {
  return {
    lesson,
    title,
    description,
    seed: seedWord(lesson),
    steps: roadSteps(lesson),
    mark: markRoad,
    advice: (state, ruleset) => adviceRoad(state, ruleset, lesson),
    cue: () => null,
    stop: lesson === 11 ? () => null : (state, ruleset) => stopAid(state, ruleset, flatRoad('brake')),
    signals: SIGNAL_LESSONS.has(lesson),
    stops: lesson !== 11,
    introKeys: 5,
  };
}

/**
 * Bài 5's seed is one whose arrival is red — the golden's own `qua_nga_tu_den_do_clean` seed — so the
 * page opens on the case the exercise is for: a learner who must stop at the line and wait. The phase
 * offset is the seed's low bits, so a recorded trace replays to the same light; measured, seed 1 is
 * red at the line and seed 900 is green, which is the pair the e2e drives.
 */
function junction(lesson: 5, seed: bigint): Exercise {
  return {
    lesson,
    title: 'Bài 5 — Qua ngã tư có tín hiệu điều khiển giao thông',
    description: 'Qua ngã tư có đèn: dừng đúng vạch khi đèn đỏ, chờ đèn xanh, xi nhan phải rồi rẽ, bằng bàn phím.',
    seed,
    steps: JUNCTION_STEPS,
    mark: markJunction,
    advice: (state, ruleset, centre) => adviceJunction(state, ruleset, cueJunction(state, centre, ruleset)),
    cue: (state, _ruleset, centre) => cueJunction(state, centre, _ruleset),
    stop: stopJunction,
    signals: SIGNAL_LESSONS.has(lesson),
    stops: true,
    introKeys: 5,
  };
}

/**
 * Bài 5 stops for the light, not for the line: a green light is not a stop, so the aid is silent and
 * the learner just drives through. On red or yellow the countdown is the road lessons' own flat-road
 * brake countdown, because from the bumper to the line the junction's approach is level ground.
 */
function stopJunction(state: SimState, ruleset: Ruleset): StopAid | null {
  if (state.lightColour !== 1 && state.lightColour !== 2) return null;
  return stopAid(state, ruleset, flatRoad('brake'));
}

/**
 * The steering cue past the line, from the same `wantSteer` the figures use: the core now publishes
 * bài 5's progress, lateral offset and heading error (snapshot 31..34), so the cue is computed from
 * the car's real place on the route rather than guessed from its pose. Before the line the car runs
 * straight at the approach, so the cue is only asked for once the bumper is past it.
 */
function cueJunction(state: SimState, centre: Centreline, ruleset: Ruleset): 'left' | 'right' | 'straight' | null {
  if (state.lineGapM > 0 || centre.length < 2) return null;
  const want = wantSteer(state, centre, ruleset);
  if (want > 0.16) return 'left';
  if (want < -0.16) return 'right';
  return 'straight';
}
