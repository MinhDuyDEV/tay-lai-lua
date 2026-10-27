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

/**
 * The straight-road scene of bài 2, 9 and 11 (`content/rulesets/tt108-2026.json`'s `road` block): one
 * lane, a stop line, and one thing past it — the crosswalk, the rails, or the finish line. Metres
 * along the course axis; the line sits at `stop_line_m()`.
 */
export interface Road {
  start_front_bumper_m: number;
  lane_width_m: number;
  stop_line_width_m: number;
  /** How far before the line a stop is still "at the line" in this exercise. */
  stop_zone_length_m: number;
  /** Largest A the law allows. */
  max_a_m: number;
  /** A stop this far past the line has missed it. */
  no_stop_beyond_m: number;
  /** How far past the line the car goes before the exercise is over. */
  end_past_line_m: number;
  /** The exercise cannot outlast its own scene: done this far past the line whatever happened. */
  run_end_past_line_m: number;
  /** The crosswalk's near edge, past the line (bài 2). */
  crosswalk_offset_m: number;
  crosswalk_width_m: number;
  crosswalk_stripe_width_m: number;
  crosswalk_stripe_gap_m: number;
  /** The rail's near edge, past the line (bài 9). */
  rail_offset_m: number;
  rail_gauge_m: number;
  rail_width_m: number;
  /** The finish line, past the stop line (bài 11). */
  finish_offset_m: number;
  /** Longest a car may stay in the end zone, seconds? (bài 11's end zone, metres). */
  end_zone_m: number;
}

/** The stop line's position on the course axis: the car starts the exercise `start_front_bumper_m` short of it. */
export const stopLineM = (road: Road): number => -road.start_front_bumper_m;
/** Bài 2's crosswalk, its near edge. */
export const crosswalkM = (road: Road): number => stopLineM(road) + road.crosswalk_offset_m;
/** Bài 9's rails, the near rail. */
export const railM = (road: Road): number => stopLineM(road) + road.rail_offset_m;
/** Bài 11's finish line. */
export const finishM = (road: Road): number => stopLineM(road) + road.finish_offset_m;

/**
 * Bài 5's signalled junction (`content/rulesets/tt108-2026.json`'s `junction` block). The route
 * itself is built by the core's `course.rs` from these numbers, so the page draws the figure the
 * scorer judges; the page only needs the line, the light cycle and the two readings of A.
 */
export interface Junction {
  approach_length_m: number;
  stop_zone_length_m: number;
  /** The A this page is built to, 500 mm — the value of the two the law gives. */
  max_a_m: number;
  /** The law's other reading of A, 1000 mm, and the note explaining which the page chose and why. */
  max_a_source: RuleSource;
  a_reading_note: string;
  /** How far past the line the exercise is over. */
  end_past_line_m: number;
  no_stop_beyond_m: number;
  crosswalk_offset_m: number;
  crosswalk_width_m: number;
  junction_depth_m: number;
  extent_m: number;
  /** Red, then green, then yellow, in 1/60 s ticks, from the car's first movement. */
  red_ticks: number;
  green_ticks: number;
  yellow_ticks: number;
  light_source: RuleSource;
}

/**
 * Bài 10's straight road (`content/rulesets/tt108-2026.json`'s `gear` block): three signs, two 25 m
 * zones, and one speed the two zones are judged at. Positions are metres of `frontBumperM` — the
 * core judges the tick the bumper's centre crosses `sign_m(i)` (`assumptions.gear_signs`), which is
 * the same number the page publishes as `data-bumper`, so the picture and the judge read one axis.
 */
export interface Gear {
  first_sign_m: number;
  zone_length_m: number;
  road_length_m: number;
  /** The single speed of both zones, km/h: above it at sign 2, below it at sign 3. */
  speed_kmh: number;
  /** The text that gives the two zones their numbers. */
  speed: RuleSource;
  back: RuleSource;
  /** The "02 phút" of SH.SO.QUA_THOI_GIAN's own sentence is in that rule's params, not here. */
  exam_cap_s: number;
}

/** The sign's place on the road, metres: sign 1, 2 and 3 for `i` = 0, 1, 2. */
export const gearSignM = (gear: Gear, i: 0 | 1 | 2): number => gear.first_sign_m + gear.zone_length_m * i;

/**
 * Bài 10's numbers, or a clear error: the page was built against a ruleset that has no `gear` block,
 * and the signs it draws must be the signs the scorer judges.
 */
export function gearOf(ruleset: Ruleset): Gear {
  if (!ruleset.gear) throw new Error(`${ruleset.id} has no "gear" block: bài 10 needs it`);
  return ruleset.gear;
}

/** The stop line's place along bài 5's approach axis: the car starts `approach_length_m` short of it. */
export const junctionStopLineM = (junction: Junction): number => junction.approach_length_m;

/** The tick at which the light's colour changes next, from `elapsed` ticks into the cycle. */
export const junctionCycleTicks = (junction: Junction): number =>
  junction.red_ticks + junction.green_ticks + junction.yellow_ticks;

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
  /** Newtons per (m/s)², the air drag that grows with speed. */
  drag_n_per_mps2: number;
  brake_max_n: number;
  final_drive: number;
  /** Gear ratios by gear name; `gears['1']` is first. */
  gears: Record<string, number>;
  //
  // The engine and clutch, as `crates/sim-core/src/vehicle.rs` steps them. The stop aid runs the same
  // motion forward to work out when a key has to land, and it needs the same numbers to do it: a
  // countdown that assumed the current speed holds was wrong on every approach from rest, because the
  // car is still accelerating toward its creep. `stop-aid-feel.test.ts` drives the real wasm and
  // compares, so a divergence here fails a test rather than shipping.
  stall_rpm: number;
  indicated_torque_nm: number;
  indicated_ref_rpm: number;
  friction_base_nm: number;
  friction_per_rpm: number;
  idle_gain_nm_per_rpm: number;
  idle_max_nm: number;
  engine_inertia_kgm2: number;
  clutch_capacity_nm: number;
  clutch_stiffness_nm_per_rad_s: number;
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
  /** How fast the wheel winds toward lock while a key is held, in full-lock units per second. */
  rate: number;
  /** How fast it unwinds toward centre when the key is released, same units. */
  centre: number;
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
  /** Bài 2, 9 and 11's straight-road scene. */
  road?: Road;
  /** Bài 5's signalled junction. */
  junction?: Junction;
  /** Bài 10's three signs and two zones. */
  gear?: Gear;
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

/**
 * The speed the car holds in first gear with the clutch up and no throttle, m/s: idle rpm through the
 * gearbox, so the engine's own idle control sets it. This is the slowest a learner can drive without
 * riding the clutch, and the advice line must never ask for less (braking below it in gear stalls the
 * engine — `SH.X.CHET_MAY`).
 */
export function creepSpeedMps(ruleset: Ruleset): number {
  const { idle_target_rpm: idle, final_drive: final, gears } = ruleset.drivetrain;
  const wheel = ruleset.vehicle.wheel_radius_m;
  return ((idle / gears['1']) / final) * 2 * Math.PI * wheel / 60;
}

/**
 * The road lessons' numbers, or a clear error: the page was built against a ruleset that has no road.
 * Bài 3 measured distances against its `hill` block and bài 4/6 against `sa_hinh`; these three are the
 * straight-road scene, and a page that gets the wrong ruleset must say so rather than draw a line
 * where the scorer does not have one.
 */
export function roadOf(ruleset: Ruleset): Road {
  if (!ruleset.road) throw new Error(`${ruleset.id} has no "road" block: bài 2, 9 and 11 need it`);
  return ruleset.road;
}

/**
 * Bài 5's junction numbers, or a clear error: the page was built against a ruleset with no junction.
 * The light cycle, the stop line and the A window all come from here, so a page given the wrong
 * ruleset says so instead of counting down to a line the scorer does not have.
 */
export function junctionOf(ruleset: Ruleset): Junction {
  if (!ruleset.junction) throw new Error(`${ruleset.id} has no "junction" block: bài 5 needs it`);
  return ruleset.junction;
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
