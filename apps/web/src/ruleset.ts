// The ruleset, as the page gets it. The server component reads content/rulesets/tt108-2026.json at
// build time and hands it down as props (Next cannot resolve a JSON import from outside apps/web);
// this module is the single place that turns that data into what the HUD and the course need, so
// the scorer's numbers and the scene's numbers are the same numbers.

export interface RuleSource {
  doc: string;
  loc: string;
  quote: string;
}

export interface Rule {
  id: string;
  code: number;
  exercise: string;
  params?: { seconds?: number; rpm?: number };
  penalty: { kind: 'POINTS'; points: number } | { kind: 'DISQUALIFY' };
  repeat: 'ONCE' | 'EACH';
  source: RuleSource;
}

export interface Course {
  start_line_x_m: number;
  start_line_width_m: number;
  lane_width_m: number;
  signal_off_m: number;
  signal_off_early_m: number;
  signal_off_late_m: number;
  exercise_end_m: number;
  start_front_bumper_m: number;
  start_line: RuleSource;
  lane: RuleSource;
}

/** Bài 3's slope and stop line (the ruleset's `hill` block). Every length is metres, in the sim's x. */
export interface Hill {
  /** Where the slope starts. */
  foot_x_m: number;
  /** Run of the slope, foot to top, along x. */
  slope_length_m: number;
  /** Rise over run (0.10 = 10 %). */
  grade: number;
  stop_line_from_foot_m: number;
  /** The level stretch after the top. */
  flat_top_m: number;
  /** Negative: the car starts on the flat before the foot. */
  start_front_bumper_from_foot_m: number;
  /** Largest A the law allows. */
  max_a_m: number;
  max_rollback_m: number;
  no_stop_beyond_m: number;
}

/** Bài 4 and bài 6's figure numbers (`content/rulesets/tt108-2026.json`'s `sa_hinh` block). */
export interface SaHinh {
  line_width_m: number;
  tyre_width_m: number;
  track_m: number;
  patch_length_m: number;
  lead_m: number;
  max_segment_m: number;
  time_limit_s: number;
  outside_margin_m: number;
  reverse_limit_m: number;
  vet_entry_tolerance_m: number;
}

export interface Drivetrain {
  idle_target_rpm: number;
  crank_ticks: number;
  /** Newtons of rolling resistance; with `mass_kg` it sets the coast deceleration. */
  rolling_n: number;
  brake_max_n: number;
}

export interface Vehicle {
  length_m: number;
  width_m: number;
  wheelbase_m: number;
  max_steer_rad: number;
  wheel_radius_m: number;
  mass_kg: number;
}

/**
 * The keyboard's steering model (`input/driver.ts` FEEL.steer), mirrored into the ruleset so the
 * advice line can work out the fastest speed a bend can be held at. Copied here rather than imported
 * to keep `ruleset.ts` free of the run loop; `test` asserts the two agree.
 */
export interface SteerFeel {
  /** `lock(v) = max(minLock, 1 / (1 + (v / speedScaleMps)^2))` of full lock. */
  speedScaleMps: number;
  minLock: number;
}

export interface Ruleset {
  id: string;
  title: string;
  scoring: { base: number; pass: number; source: RuleSource };
  course: Course;
  vehicle: Vehicle;
  drivetrain: Drivetrain;
  /** Present once the ruleset carries bài 3. */
  hill?: Hill;
  /** Bài 4 and bài 6's figure numbers. */
  sa_hinh?: SaHinh;
  steer: SteerFeel;
  rules: Rule[];
}

/** Standard gravity, m/s². A physical constant, not a ruleset choice. */
export const GRAVITY_MPS2 = 9.81;

/**
 * How fast a car with the clutch down and the throttle off sheds speed on a slope of `grade`, in
 * m/s². The core's own motion: gravity along the road plus rolling resistance
 * (vehicle.rs `step_motion`). Every stop distance the advice line reasons about comes from here, so
 * the picture and the cue cannot disagree about how far the car needs.
 */
export function coastDecel(ruleset: Ruleset, grade: number): number {
  const sinSlope = grade / Math.sqrt(1 + grade * grade);
  return GRAVITY_MPS2 * sinSlope + ruleset.drivetrain.rolling_n / ruleset.vehicle.mass_kg;
}

/** Bài 3's numbers, or a clear error: the page was built against a ruleset that has no slope. */
export function hillOf(ruleset: Ruleset): Hill {
  if (!ruleset.hill) throw new Error(`${ruleset.id} has no "hill" block: bài 3 needs it`);
  return ruleset.hill;
}

/** A fired event, described from the ruleset rather than from a table copied into the app. */
export interface Penalty {
  tick: number;
  code: number;
  points: number;
  id: string;
  source: RuleSource;
  /** True when the row disqualifies instead of subtracting points. */
  disqualify: boolean;
}

/** One place that answers "what does this event code mean", for the HUD and the test alike. */
export function describe(ruleset: Ruleset, code: number): Rule | undefined {
  return ruleset.rules.find((r) => r.code === code);
}

export function toPenalty(ruleset: Ruleset, event: { tick: number; code: number; points: number }): Penalty {
  const rule = describe(ruleset, event.code);
  if (!rule) {
    // A code the app's ruleset does not know is a version skew between sim.wasm and the content
    // JSON. Say so loudly rather than show a blank row.
    throw new Error(`sim.wasm fired rule code ${event.code}, which ${ruleset.id} does not define`);
  }
  return {
    tick: event.tick,
    code: event.code,
    points: event.points,
    id: rule.id,
    source: rule.source,
    disqualify: rule.penalty.kind === 'DISQUALIFY',
  };
}

/** Where the learner can read the rule in the repo; used to label the quote. */
export function sourceLabel(source: RuleSource): string {
  return `${source.doc} — ${source.loc}`;
}
