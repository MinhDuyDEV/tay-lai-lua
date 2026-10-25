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
  detector: string;
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

export interface Drivetrain {
  idle_target_rpm: number;
  crank_ticks: number;
}

export interface Vehicle {
  length_m: number;
  width_m: number;
  wheelbase_m: number;
  max_steer_rad: number;
  wheel_radius_m: number;
}

export interface Ruleset {
  id: string;
  title: string;
  scoring: { base: number; pass: number; source: RuleSource };
  course: Course;
  vehicle: Vehicle;
  drivetrain: Drivetrain;
  rules: Rule[];
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
