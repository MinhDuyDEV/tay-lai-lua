// What differs between the exercises a page can run: the title, the id the core is created with,
// the checklist and the line that tells the learner what to do next. Stage, Hud, Scene and the run
// loop take one of these instead of carrying bài 1 constants.

import { flatRoad, stopAid, type StopAid, type StopRoad } from './stopAid.ts';
import { AUTOMATIC_BIT, seedWord } from './sim/session.ts';
import { adviceFigure, cueFigure, wantSteer, type Centreline } from './figures.ts';
import { adviceGhep, cueGhep, yardOf, type GhepCueNow, type Yard } from './ghep.ts';
import { parkRects, type ParkRects } from './sim/session.ts';
import {
  adviceBai3,
  adviceJunction,
  adviceRoad,
  cueBai3,
  GEAR_STEPS,
  GEAR_STEPS_AUTO,
  FIGURE_STEPS_AUTO,
  PARK_STEPS_AUTO,
  JUNCTION_STEPS,
  JUNCTION_STEPS_AUTO,
  BAI1_STEPS_AUTO,
  BAI3_STEPS_AUTO,
  markGear,
  markJunction,
  markRoad,
  roadSteps,
  FIGURE_STEPS,
  PARK_STEPS,
  markPark,
  markBai1,
  markBai3,
  markFigure,
  BAI1_STEPS,
  BAI3_STEPS,
  type Step,
  type StepId,
} from './steps.ts';
import { adviceGear, gearCue } from './gear.ts';
import { hillOf, junctionOf, type Ruleset } from './ruleset.ts';
import type { SimState } from './sim/session.ts';

export type Lesson = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** Bài 7 and bài 8: the reverse park, whose figures are two rectangles the core publishes. */
export type ParkLesson = 7 | 8;

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
  /** True on the link between bài 6 and bài 7: no per-bài checklist, no stop aid, its own hazard. */
  link?: boolean;
  /** True when this page drives an automatic: the selector's seed bit, the words and the keys. */
  automatic: boolean;
  title: string;
  /** The page's meta description: one line, for a search result or a link preview. */
  description: string;
  /** `sim_create`'s word; the recorded trace starts with the same 8 bytes. */
  seed: bigint;
  steps: readonly Step[];
  mark(done: Set<StepId>, state: SimState, ruleset: Ruleset): void;
  /** The line to do next, or null when the exercise has none. */
  advice(state: SimState, ruleset: Ruleset, centre: Centreline, yard?: Yard | null): string | null;
  /** The key the learner is being asked to press now, if any; published next to the advice line. */
  cue(state: SimState, ruleset: Ruleset, centre: Centreline, yard?: Yard | null): string | null;
  /**
   * The park figures' two rectangles, read from the core's own course once. Null for every other
   * lesson: a page that drew a bay the scorer does not have would be worse than no picture.
   */
  park?: (course: readonly { kind: number; lineId: number; points: readonly (readonly [number, number])[] }[]) => Yard | null;
  /**
   * The park cue in full — steering word, pedal word and the gear it needs — as the HUD publishes it in
   * `data-cue`, `data-pedal` and `data-gear-wanted`. The learner-model test reads this through the same
   * argument list the HUD uses, so the test cannot drift from the page.
   */
  cueNow?: (state: SimState, ruleset: Ruleset, yard: Yard) => GhepCueNow;
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

/**
 * One builder per lesson, taking the transmission the learner chose. The choice changes three things
 * and nothing else: the seed's `AUTOMATIC_BIT`, the checklist's words and keys, and the advice/cue
 * functions, which get the flag so every sentence about a pedal is the sentence for the car in front
 * of the learner. Splitting it here rather than in the page keeps one definition per lesson.
 */
type Build = (automatic: boolean) => Exercise;

const EXERCISES: Record<Lesson, Build> = {
  1: (automatic) => ({
    lesson: 1,
    title: 'Bài 1 — Xuất phát',
    description: 'Bài 1 xuất phát: nổ máy, thắt dây, xi nhan trái, vào số 1 và qua vạch xuất phát, bằng bàn phím.',
    automatic,
    seed: seedWord(0, 1n, automatic),
    steps: automatic ? BAI1_STEPS_AUTO : BAI1_STEPS,
    mark: (done, state, ruleset) => markBai1(done, state, ruleset, automatic),
    advice: () => null,
    cue: () => null,
    stop: () => null,
    signals: SIGNAL_LESSONS.has(1),
    stops: false,
    introKeys: 5,
  }),
  3: (automatic) => ({
    lesson: 3,
    title: 'Bài 3 — Dừng và khởi hành xe trên dốc',
    description: 'Tập bài dừng và khởi hành xe trên dốc, sa hình hạng B, bằng bàn phím.',
    automatic,
    seed: seedWord(3, 1n, automatic),
    steps: automatic ? BAI3_STEPS_AUTO : BAI3_STEPS,
    mark: (done, state, ruleset) => markBai3(done, state, ruleset, automatic),
    advice: (state, ruleset) => adviceBai3(state, ruleset, automatic, stopBai3(state, ruleset, automatic)),
    cue: (state, ruleset) => cueBai3(state, ruleset, automatic, stopBai3(state, ruleset, automatic)),
    stop: (state, ruleset) => stopBai3(state, ruleset, automatic),
    signals: SIGNAL_LESSONS.has(3),
    stops: true,
    introKeys: 6,
  }),
  4: (automatic) => ({
    lesson: 4,
    title: 'Bài 4 — Qua vệt bánh xe và đường vòng vuông góc',
    description: 'Tập bài qua vệt bánh xe và đường vòng vuông góc, sa hình hạng B, bằng bàn phím.',
    automatic,
    seed: seedWord(4, 1n, automatic),
    steps: automatic ? FIGURE_STEPS_AUTO : FIGURE_STEPS,
    mark: (done, state) => markFigure(done, state, automatic),
    advice: (state, ruleset, centre) => adviceFigure(state, centre, ruleset, 4, automatic),
    cue: (state, ruleset, centre) => cueFigure(state, centre, ruleset),
    stop: () => null,
    signals: SIGNAL_LESSONS.has(4),
    stops: false,
    introKeys: 5,
  }),
  6: (automatic) => ({
    lesson: 6,
    title: 'Bài 6 — Qua đường vòng quanh co',
    description: 'Tập bài qua đường vòng quanh co, sa hình hạng B, bằng bàn phím.',
    automatic,
    seed: seedWord(6, 1n, automatic),
    steps: automatic ? FIGURE_STEPS_AUTO : FIGURE_STEPS,
    mark: (done, state) => markFigure(done, state, automatic),
    advice: (state, ruleset, centre) => adviceFigure(state, centre, ruleset, 6, automatic),
    cue: (state, ruleset, centre) => cueFigure(state, centre, ruleset),
    stop: () => null,
    signals: SIGNAL_LESSONS.has(6),
    stops: false,
    introKeys: 5,
  }),
  2: (automatic) => road(2, 'Bài 2 — Dừng xe nhường đường cho người đi bộ', 'Dừng đúng vạch cho người đi bộ qua, rồi đi tiếp, bằng bàn phím.', automatic),
  9: (automatic) => road(9, 'Bài 9 — Tạm dừng ở chỗ có đường sắt chạy qua', 'Tạm dừng đúng vạch trước đường sắt, quan sát rồi đi tiếp, bằng bàn phím.', automatic),
  11: (automatic) => road(11, 'Bài 11 — Kết thúc', 'Qua vạch kết thúc với xi nhan phải rồi dừng, bằng bàn phím.', automatic),
  5: (automatic) => junction(5, seedWord(5, 1n, automatic), automatic),
  7: (automatic) => park(7, seedWord(7, 1n, automatic), automatic),
  8: (automatic) => park(8, seedWord(8, 1n, automatic), automatic),
  10: (automatic) => gear(automatic),
};

/** The exercise a page runs: the lesson's own, in the transmission the learner chose. */
export const exerciseFor = (lesson: Lesson, automatic = false): Exercise => EXERCISES[lesson](automatic);

/** The core's exercise id for the link (`LINK_ID` in crates/sim-core/src/lib.rs). */
const LINK_ID = 13;

/**
 * The link between bài 6 and bài 7: a straight 60 m lane the car really drives, with one hazard. It is
 * not a bài: the core's run labels it lesson 0 and no per-bài checklist or stop line applies. The page
 * still needs an advice line and a cue, and the electrics are the run's (`state.hazard`).
 */
export function linkExercise(automatic: boolean): Exercise {
  return {
    // The link is not one of the 11 bài; the value 0 is the core's own label (snapshot field 54).
    lesson: 0 as unknown as Lesson,
    link: true,
    automatic,
    title: 'Đoạn nối — bài 6 sang bài 7',
    description: 'Đoạn nối 60 m giữa bài 6 và bài 7: đi thẳng, xử lý tình huống nguy hiểm rồi đi tiếp.',
    seed: seedWord(LINK_ID, 1n, automatic),
    steps: [],
    mark: () => {},
    advice: (state) => linkAdvice(state, automatic),
    cue: (state) => linkCue(state),
    stop: () => null,
    signals: false,
    stops: false,
    introKeys: 0,
  };
}

/** What the link asks next, from the run's own hazard fields. */
function linkCue(state: SimState): 'setoff' | 'go' | 'brake' | 'button' | 'wait' | 'release' {
  if (state.hazard === 1) {
    if (state.speedMps > 0.1) return 'brake';
    return state.hazardButton ? 'wait' : 'button';
  }
  if (state.hazard === 2) return state.hazardButton ? 'release' : 'go';
  if (state.handbrake || state.gear === 0) return 'setoff';
  return 'go';
}

/** The link's advice line: one sentence for the next act, in the learner's words. */
function linkAdvice(state: SimState, automatic: boolean): string {
  if (state.hazard === 1) {
    if (state.speedMps > 0.1) {
      return automatic
        ? 'Nguy hiểm: phanh ↓ dừng xe ngay, rồi bấm H bật tín hiệu nguy hiểm.'
        : 'Nguy hiểm: đạp côn (Space) và phanh ↓ dừng xe ngay, rồi bấm H bật tín hiệu nguy hiểm.';
    }
    return state.hazardButton
      ? 'Giữ phanh và tín hiệu H cho tới khi tín hiệu kết thúc.'
      : 'Đã dừng: bấm H bật tín hiệu nguy hiểm và giữ.';
  }
  if (state.hazard === 2) {
    return state.hazardButton
      ? 'Tín hiệu đã kết thúc: bấm H tắt tín hiệu, rồi đi tiếp.'
      : 'Đi tiếp tới vạch kết thúc.';
  }
  if (state.handbrake) {
    return automatic
      ? 'Bấm D rồi P nhả phanh tay, đi thẳng tới vạch kết thúc.'
      : 'Đạp côn (Space), bấm 1, bấm P nhả phanh tay, rồi đi thẳng tới vạch kết thúc.';
  }
  if (state.gear !== 1) return automatic ? 'Bấm D để đi tới.' : 'Đạp côn (Space) và bấm 1 để đi tới.';
  return 'Đi thẳng tới vạch kết thúc.';
}

/**
 * Bài 3's stop line is on its slope: the grade under the car is the slope's from the foot on and level
 * before it. That is the road `stopAid` walks along, read from the ruleset's own `hill` block rather
 * than assumed, so a different slope or stop line moves the countdown with it.
 */
function stopBai3(state: SimState, ruleset: Ruleset, automatic = false): StopAid | null {
  const hill = hillOf(ruleset);
  const road: StopRoad = {
    grade: (toLineM) => {
      const x = hill.stop_line_from_foot_m - toLineM;
      return x > hill.foot_x_m && x < hill.foot_x_m + hill.slope_length_m ? hill.grade : 0;
    },
    // No clutch to lift on an automatic: the one pedal that decides the stop is the brake, and the
    // converter keeps pushing while it comes on.
    key: automatic ? 'brake' : 'clutch',
    converterRpm: automatic ? ruleset.automatic?.converter_rpm : undefined,
  };
  return stopAid(state, ruleset, road);
}

/**
 * A straight-road exercise: the same stop aid as bài 3, on the flat, timing the brake — a coasting car
 * on the level sheds only ~0.12 m/s², so the clutch alone would never stop it in time, and the brake is
 * the only key that decides whether A lands inside 500 mm. Bài 11's stop is at the finish line, which
 * charges no distance A, so it gets no countdown: what it times is the right signal, not the gap.
 */
function road(lesson: RoadLesson, title: string, description: string, automatic: boolean): Exercise {
  return {
    lesson,
    title,
    description,
    automatic,
    seed: seedWord(lesson, 1n, automatic),
    steps: roadSteps(lesson, automatic),
    mark: (done, state, ruleset) => markRoad(done, state, ruleset, automatic),
    advice: (state, ruleset) => adviceRoad(state, ruleset, lesson, automatic),
    cue: () => null,
    // An automatic's converter keeps pushing while the brake goes down: the aid is told its speed so the
    // stop it times lands where it says (see StopRoad.converterRpm).
    stop:
      lesson === 11
        ? () => null
        : (state, ruleset) =>
            stopAid(state, ruleset, flatRoad('brake', automatic ? ruleset.automatic?.converter_rpm : undefined)),
    signals: SIGNAL_LESSONS.has(lesson),
    stops: lesson !== 11,
    introKeys: 5,
  };
}

/**
 * Bài 10: the straight road with three signs, driven only from the advice line. The cue is a word the
 * learner acts on (`gear.ts`), not a number to hit, because the judged instants are two sign crossings
 * and the learner is 150–400 ms behind everything they read. Its seed is the exercise's own (`seedWord`
 * puts the exercise id in the top byte), so a recorded trace replays to the same run.
 */
function gear(automatic: boolean): Exercise {
  return {
    lesson: 10,
    automatic,
    title: 'Bài 10 — Thay đổi số trên đường bằng',
    description:
      'Thay đổi số trên đường bằng (Hình 17): qua biển thứ nhất thì lên số 2 và trên 24 km/h ở biển thứ hai, rồi giảm tốc, về số 1 và dưới 24 km/h ở biển thứ ba, bằng bàn phím.',
    seed: seedWord(10, 1n, automatic),
    steps: automatic ? GEAR_STEPS_AUTO : GEAR_STEPS,
    mark: (done, state, ruleset) => markGear(done, state, ruleset, automatic),
    advice: (state, ruleset) => adviceGear(state, ruleset, undefined, automatic),
    cue: (state, ruleset) => gearCue(state, ruleset, undefined, automatic),
    stop: () => null,
    signals: SIGNAL_LESSONS.has(10),
    stops: false,
    introKeys: 5,
  };
}

/**
 * Bài 5's seed is one whose arrival is red — the golden's own `qua_nga_tu_den_do_clean` seed — so the
 * page opens on the case the exercise is for: a learner who must stop at the line and wait. The phase
 * offset is the seed's low bits, so a recorded trace replays to the same light; measured, seed 1 is
 * red at the line and seed 900 is green, which is the pair the e2e drives.
 */
function junction(lesson: 5, seed: bigint, automatic: boolean): Exercise {
  return {
    lesson,
    automatic,
    title: 'Bài 5 — Qua ngã tư có tín hiệu điều khiển giao thông',
    description: 'Qua ngã tư có đèn: dừng đúng vạch khi đèn đỏ, chờ đèn xanh, xi nhan phải rồi rẽ, bằng bàn phím.',
    seed,
    steps: automatic ? JUNCTION_STEPS_AUTO : JUNCTION_STEPS,
    mark: (done, state, ruleset) => markJunction(done, state, ruleset, automatic),
    advice: (state, ruleset, centre) => adviceJunction(state, ruleset, cueJunction(state, centre, ruleset), automatic),
    cue: (state, _ruleset, centre) => cueJunction(state, centre, _ruleset),
    stop: (state, ruleset) => stopJunction(state, ruleset, automatic),
    signals: SIGNAL_LESSONS.has(lesson),
    stops: true,
    introKeys: 5,
  };
}

/**
 * Bài 7 and bài 8. The bay comes from the core (`sim_course` kind 8, two rectangles) and the line from
 * `ghep.ts`'s planner, which re-solves from the pose the snapshot publishes every tick: a learner who
 * stops in a different place gets a different line, not a script that no longer fits.
 *
 * The lesson's whole shape is pulses — stop, put the wheel over, tap a little, stop — because the
 * reverse creep is 1.74 m/s and the bays have 0.2 to 0.3 m of slack per side, so a key that lands late
 * by a person's 300 ms is half a metre of travel. That is why the cue has a `clutch` word (the car has
 * to be still and the pedal down before the gear goes in) beside the steer and pedal words.
 */
function park(lesson: ParkLesson, seed: bigint, automatic: boolean): Exercise {
  return {
    lesson,
    automatic,
    title: lesson === 7 ? 'Bài 7 — Ghép xe dọc vào nơi đỗ' : 'Bài 8 — Ghép xe ngang vào nơi đỗ',
    description:
      lesson === 7
        ? 'Ghép xe dọc vào nơi đỗ (Hình 13): tiến vào khoảng khống chế, lùi chuẩn vào ô, đứng phanh đến khi có tín hiệu, bằng bàn phím.'
        : 'Ghép xe ngang vào nơi đỗ (Hình 14): lùi chuẩn vào ô hẹp bên phải, đứng phanh đến khi có tín hiệu, bằng bàn phím.',
    seed,
    steps: automatic ? PARK_STEPS_AUTO : PARK_STEPS,
    mark: (done, state) => markPark(done, state, automatic),
    advice: (state, ruleset, _centre, yard) => {
      if (!yard) return 'Chưa đọc được hình ghép xe từ sim: tải lại trang.';
      return adviceGhep(state, yard, ruleset, lesson, undefined, automatic);
    },
    cue: (state, ruleset, _centre, yard) => (yard ? cueGhep(state, yard, ruleset).steer : null),
    cueNow: (state, ruleset, yard) => cueGhep(state, yard, ruleset),
    stop: () => null,
    signals: false,
    stops: false,
    introKeys: 6,
    park: (course) => {
      const rects: ParkRects | null = parkRects(course as never);
      return rects ? yardOf(rects) : null;
    },
  };
}

/**
 * Bài 5 stops for the light, not for the line: a green light is not a stop, so the aid is silent and
 * the learner just drives through. On red or yellow the countdown is the road lessons' own flat-road
 * brake countdown, because from the bumper to the line the junction's approach is level ground.
 */
function stopJunction(state: SimState, ruleset: Ruleset, automatic = false): StopAid | null {
  if (state.lightColour !== 1 && state.lightColour !== 2) return null;
  return stopAid(state, ruleset, flatRoad('brake', automatic ? ruleset.automatic?.converter_rpm : undefined));
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
