//! Rule data: `content/rulesets/tt108-2026.json`, embedded and parsed once per `create`.
//!
//! Every scoring row carries the verbatim sentence it comes from (`source.quote`) and where it
//! sits in `docs/legal/*.md` (`source.loc`). Anything the law does not say lives in `assumptions`
//! instead of being silently baked into code.

use libm::{atan, sqrt};
use serde::Deserialize;

pub const EMBEDDED: &str = include_str!("../../../content/rulesets/tt108-2026.json");

#[derive(Deserialize)]
pub struct Ruleset {
    pub id: String,
    pub scoring: Scoring,
    pub course: Course,
    pub vehicle: Vehicle,
    pub drivetrain: Drivetrain,
    pub hill: Hill,
    /// Bài 4 and bài 6: the figures, generated from the formulas and the car's own dimensions.
    pub sa_hinh: SaHinh,
    /// Bài 2, 5, 9 and 11: the straight-road scene and, for bài 5, the junction and its light.
    pub road: Road,
    pub junction: Junction,
    /// Bài 7 and bài 8: the two bays, generated from the formulas and the car's own dimensions.
    pub park: Park,
    pub rules: Vec<Rule>,
}

/// Bài 2, bài 9 and bài 11: the numbers of a straight-road exercise. Every position the scoring
/// code reads is here, so a layout change is a ruleset change.
///
/// `start_line_x_m` is the one axis of the scene: the start line is at 0, the stop line at
/// `stop_line_m()`, the crosswalk 1,0 m past it (bài 2), the outer rail 5,0 m past it (bài 9), the
/// finish line `finish_offset_m` past it (bài 11).
#[derive(Deserialize)]
pub struct Road {
    /// Where the car's front bumper starts, metres from the start line (negative = short of it).
    pub start_front_bumper_m: f64,
    pub lane_width_m: f64,
    pub stop_line_width_m: f64,
    /// How far before the stop line a stop still counts as a stop of the exercise.
    pub stop_zone_length_m: f64,
    /// Distance A the law allows, 0,5 m.
    pub max_a_m: f64,
    /// After a stop, the bumper reaching this far past the line ends the exercise (bài 2, bài 9).
    pub end_past_line_m: f64,
    /// Passing this far past the line without a stop is KHONG_DUNG.
    pub no_stop_beyond_m: f64,
    /// Where the exercise ends if the car never stops at all.
    pub run_end_past_line_m: f64,
    pub crosswalk_offset_m: f64,
    pub crosswalk_width_m: f64,
    pub crosswalk_stripe_width_m: f64,
    pub crosswalk_stripe_gap_m: f64,
    /// Outer rail this far past the stop line (bài 9).
    pub rail_offset_m: f64,
    pub rail_gauge_m: f64,
    pub rail_width_m: f64,
    /// Finish line this far past the stop line (bài 11).
    pub finish_offset_m: f64,
    /// Half-width of the band across the finish line that reads as "at the line".
    pub end_zone_m: f64,
    /// The exercise's signal head sits here along the lane (bài 2: the crossing; bài 9: the rail).
    pub signal_tick: u32,
}

impl Road {
    /// The stop line, on the scene's single axis.
    pub fn stop_line_m(&self) -> f64 {
        -self.start_front_bumper_m
    }

    pub fn crosswalk_m(&self) -> f64 {
        self.stop_line_m() + self.crosswalk_offset_m
    }

    pub fn rail_m(&self) -> f64 {
        self.stop_line_m() + self.rail_offset_m
    }

    pub fn finish_m(&self) -> f64 {
        self.stop_line_m() + self.finish_offset_m
    }
}

/// Bài 5: the junction figure and its light cycle. The route itself is built by `course.rs` from
/// these numbers, so the figure that is drawn and the figure that is scored are one figure.
#[derive(Deserialize)]
pub struct Junction {
    pub approach_length_m: f64,
    pub stop_zone_length_m: f64,
    pub max_a_m: f64,
    pub end_past_line_m: f64,
    pub no_stop_beyond_m: f64,
    pub crosswalk_offset_m: f64,
    pub crosswalk_width_m: f64,
    /// Depth of the junction from the stop line; the bumper in it is "đi qua ngã tư".
    pub junction_depth_m: f64,
    /// Half the width of the drawn junction, so the arms reach past the lane.
    pub extent_m: f64,
    /// Radius of the right-turn arc; 0 means "derive it from the car" (1,5 × its tightest turn).
    pub arc_radius_m: f64,
    pub red_ticks: u32,
    pub green_ticks: u32,
    pub yellow_ticks: u32,
}

impl Junction {
    /// The stop line's place on the approach axis. The scene's origin is the start line at 0, so
    /// the stop line is where `approach_length_m` puts it.
    pub fn stop_line_m(&self) -> f64 {
        self.approach_length_m
    }

    pub fn cycle_ticks(&self) -> u32 {
        self.red_ticks + self.green_ticks + self.yellow_ticks
    }

    /// The colour at `t` ticks into the cycle from the start of red: 1 red, 2 yellow, 3 green.
    pub fn light_at(&self, t: u32) -> u8 {
        let cycle = self.cycle_ticks();
        if cycle == 0 {
            return 3;
        }
        let t = t % cycle;
        if t < self.red_ticks {
            1
        } else if t < self.red_ticks + self.green_ticks {
            3
        } else {
            2
        }
    }
}


/// The figures of bài 4 and bài 6 (QCVN 15 mục 2.1.15.4 and 2.1.15.6). Only the inputs live here;
/// the geometry itself is generated in `course.rs`, so a figure and what is scored on it cannot
/// drift apart.
#[derive(Deserialize)]
pub struct SaHinh {
    /// Width of a limit line's painted band, and the thickness everything is drawn with.
    pub line_width_m: f64,
    /// Setback of the limit line from the curb face.
    pub line_curb_setback_m: f64,
    pub tyre_width_m: f64,
    /// Half the distance between the two wheel centres on one axle.
    pub track_m: f64,
    /// Depth of the wheel contact patch, fore and aft.
    pub patch_length_m: f64,
    /// The straight lead-in and lead-out the figures are given; where the gates sit.
    pub lead_m: f64,
    /// Centreline samples a figure is broken into.
    pub max_segment_m: f64,
    /// The time the law gives each of the two exercises, before SH.04/06.QUA_THOI_GIAN starts.
    pub time_limit_s: f64,
    /// Bài 4: distance A into the figure by which both right wheels must have reached the vệt.
    pub vet_entry_tolerance_m: f64,
    /// SAI_HINH: how far the car centre may sit outside the driving corridor.
    pub outside_margin_m: f64,
    /// SAI_HINH: how far the car may reverse behind the furthest progress reached.
    pub reverse_limit_m: f64,
}

/// Bài 7 (ghép xe dọc, Hình 13) and bài 8 (ghép xe ngang, Hình 14). The bay sizes are the law's
/// own formulas on the car's own `a` and `b`; the geometry is built in `course.rs` from these
/// numbers, so the bay that is drawn and the bay that is scored are one bay.
#[derive(Deserialize)]
pub struct Park {
    /// "Hoàn thành bài sát hạch trong thời gian 02 phút" — the clock QUA_THOI_GIAN counts on.
    pub time_limit_s: f64,
    /// SAI_HINH: how far the car centre may sit outside (lane ∪ bay).
    pub outside_margin_m: f64,
    /// How long the hull must stay inside the bay before the finish signal is given. Not the law's
    /// number; see `assumptions.park_signal`.
    pub signal_hold_s: f64,
    /// The longest a run may last, so a wrong attempt still has an end. The simulator's own cap;
    /// see `assumptions.park_time_cap`.
    pub exam_cap_s: f64,
    /// Hình 13's three dimensions and Hình 14's two, quoted where they are applied.
    pub formulas: Formulas,
}

/// The five bay dimensions, each carrying the sentence it comes from. The arithmetic is
/// `Park::doc_length_m` and its neighbours; this block is the verbatim quote, so a reader can check
/// the code against the law without leaving the file they are in.
#[derive(Deserialize)]
pub struct Formulas {
    #[serde(rename = "Ld")]
    pub ld: Source,
    #[serde(rename = "Rd")]
    pub rd: Source,
    #[serde(rename = "Ed")]
    pub ed: Source,
    #[serde(rename = "Lg")]
    pub lg: Source,
    #[serde(rename = "Rg")]
    pub rg: Source,
}

impl Park {
    /// Bài 7: `Ld = a + 1.0` — the bay's length, along the car when it is parked.
    pub fn doc_length_m(&self, v: &Vehicle) -> f64 {
        v.length_m + 1.0
    }

    /// Bài 7: `Rd = b + 0.6` — the bay's width, across the car when it is parked.
    pub fn doc_width_m(&self, v: &Vehicle) -> f64 {
        v.width_m + 0.6
    }

    /// Bài 7: `Ed = 1.2a` — the control distance, which is also the lane's width (Hình 13: "Làn
    /// chính có bề rộng = Ed").
    pub fn doc_lane_m(&self, v: &Vehicle) -> f64 {
        1.2 * v.length_m
    }

    /// Bài 8: `Lg = 3a/2` — the bay's length along the road.
    pub fn ngang_length_m(&self, v: &Vehicle) -> f64 {
        1.5 * v.length_m
    }

    /// Bài 8: `Rg = 5b/4` — the bay's depth, recessed into the road's right edge.
    pub fn ngang_width_m(&self, v: &Vehicle) -> f64 {
        1.25 * v.width_m
    }

    /// How long the hull must be still for the finish signal: the hold, in ticks.
    pub fn signal_hold_ticks(&self) -> u32 {
        seconds_to_ticks(self.signal_hold_s)
    }

    /// The exam's hard cap, in ticks.
    pub fn exam_cap_ticks(&self) -> u32 {
        seconds_to_ticks(self.exam_cap_s)
    }
}

#[derive(Deserialize)]
pub struct Scoring {
    pub base: i32,
    pub pass: i32,
}

#[derive(Deserialize)]
pub struct Course {
    pub start_line_x_m: f64,
    pub start_line_width_m: f64,
    pub lane_width_m: f64,
    pub signal_off_m: f64,
    pub signal_off_early_m: f64,
    pub signal_off_late_m: f64,
    pub exercise_end_m: f64,
    pub start_front_bumper_m: f64,
}

/// Bài 3's course: the longitudinal road profile and the numbers the stop is judged against.
/// Every length is metres along the road; x is the course axis, the foot of the slope at `foot_x_m`.
/// Flat before the foot and, downhill not being modelled, flat after the slope.
#[derive(Deserialize)]
pub struct Hill {
    pub foot_x_m: f64,
    pub slope_length_m: f64,
    /// Rise over run, 0.10 for 10 %.
    pub grade: f64,
    pub stop_line_from_foot_m: f64,
    /// The level stretch above the slope. Drawn, not modelled: the run ends at the stop line.
    pub flat_top_m: f64,
    pub start_front_bumper_from_foot_m: f64,
    pub max_a_m: f64,
    pub max_rollback_m: f64,
    pub no_stop_beyond_m: f64,
}

impl Hill {
    pub fn stop_line_x_m(&self) -> f64 {
        self.foot_x_m + self.stop_line_from_foot_m
    }

    fn on_slope(&self, x_m: f64) -> bool {
        x_m > self.foot_x_m && x_m <= self.foot_x_m + self.slope_length_m
    }

    /// Road grade under `x_m`: 0 off the slope.
    pub fn grade_at(&self, x_m: f64) -> f64 {
        if self.on_slope(x_m) { self.grade } else { 0.0 }
    }

    /// Sine of the climb angle under `x_m`. Positions are along the road, so a metre of travel
    /// climbs `sin`, not `grade`.
    pub fn sin_slope_at(&self, x_m: f64) -> f64 {
        let g = self.grade_at(x_m);
        if g == 0.0 { 0.0 } else { g / sqrt(1.0 + g * g) }
    }

    /// Road height at `x_m`, metres above the flat approach.
    pub fn elevation_at(&self, x_m: f64) -> f64 {
        let up = (x_m - self.foot_x_m).clamp(0.0, self.slope_length_m);
        up * self.grade / sqrt(1.0 + self.grade * self.grade)
    }
}

#[derive(Deserialize)]
pub struct Vehicle {
    pub length_m: f64,
    pub width_m: f64,
    pub wheelbase_m: f64,
    pub max_steer_rad: f64,
    pub mass_kg: f64,
    pub wheel_radius_m: f64,
}

#[derive(Deserialize)]
pub struct Drivetrain {
    pub idle_target_rpm: f64,
    pub stall_rpm: f64,
    pub indicated_torque_nm: f64,
    pub indicated_ref_rpm: f64,
    pub friction_base_nm: f64,
    pub friction_per_rpm: f64,
    pub idle_gain_nm_per_rpm: f64,
    pub idle_max_nm: f64,
    pub engine_inertia_kgm2: f64,
    pub clutch_capacity_nm: f64,
    pub clutch_stiffness_nm_per_rad_s: f64,
    pub crank_ticks: u32,
    pub final_drive: f64,
    pub gears: Gears,
    pub brake_max_n: f64,
    pub handbrake_max_n: f64,
    pub rolling_n: f64,
    pub drag_n_per_mps2: f64,
}

#[derive(Deserialize)]
pub struct Gears {
    #[serde(rename = "-1")]
    pub reverse: f64,
    #[serde(rename = "1")]
    pub first: f64,
    #[serde(rename = "2")]
    pub second: f64,
    #[serde(rename = "3")]
    pub third: f64,
    #[serde(rename = "4")]
    pub fourth: f64,
    #[serde(rename = "5")]
    pub fifth: f64,
}

impl Gears {
    /// `0` is neutral, `-1` reverse. An out-of-range gear is neutral: the wire accepts any `i8`.
    pub fn ratio(&self, gear: i8) -> Option<f64> {
        match gear {
            -1 => Some(self.reverse),
            1 => Some(self.first),
            2 => Some(self.second),
            3 => Some(self.third),
            4 => Some(self.fourth),
            5 => Some(self.fifth),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
pub struct Rule {
    pub id: String,
    pub code: u16,
    #[serde(default)]
    pub params: Params,
    pub penalty: Penalty,
    pub repeat: Repeat,
    pub source: Source,
}

/// Rule thresholds that the law states as numbers. Absent where the rule needs none.
#[derive(Deserialize, Default, Clone, Copy)]
pub struct Params {
    #[serde(default)]
    pub seconds: f64,
    #[serde(default)]
    pub rpm: f64,
}

/// The two shapes the law uses: subtract points, or stop the test.
#[derive(Deserialize, Clone, Copy)]
#[serde(tag = "kind")]
pub enum Penalty {
    #[serde(rename = "POINTS")]
    Points { points: i16 },
    #[serde(rename = "DISQUALIFY")]
    Disqualify,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Repeat {
    Once,
    Each,
}

#[derive(Deserialize)]
pub struct Source {
    pub doc: String,
    pub loc: String,
    pub quote: String,
}

/// The law states these in seconds and rpm; the core counts ticks and compares volts-free floats.
pub struct Thresholds {
    pub rpm_limit: f64,
    pub timeout_20_ticks: u32,
    pub timeout_30_ticks: u32,
    /// Bài 3: ticks allowed from the stop to the stop line.
    pub hill_timeout_ticks: u32,
    /// Bài 4 and bài 6: seconds one contact episode must last before DE_VACH_KEO_DAI charges.
    pub de_vach_keo_dai_ticks: u32,
    /// Bài 5: the 20 s and 30 s marks, counted from the light clock's arming.
    pub junction_20_ticks: u32,
    pub junction_30_ticks: u32,
    /// Bài 7 and bài 8: the 2 × 120 s marks QUA_THOI_GIAN charges at, and the hold the finish
    /// signal needs.
    pub park_time_limit_ticks: u32,
    pub park_signal_hold_ticks: u32,
}

impl SaHinh {
    /// The car's own minimum turning radius on the front outer wheel's contact point — QCVN 15's
    /// `Rqv`.
    ///
    /// Follow the model, not the textbook: `vehicle.rs` turns the *reference point* (the car's
    /// centre) at `v · tan(δ) / L`, so at full lock the centre traces a circle of `L / tan(δ)` —
    /// 3,914 m for this car — and the turning centre lies on the line through the centre,
    /// perpendicular to the heading. The front axle is `wheelbase / 2` *ahead of that line*, not a
    /// whole wheelbase ahead, and the front outer wheel's centre is half a track outboard of its
    /// axle. So the wheel centre traces `sqrt((L/2)² + (pivot + track/2)²)` = 4,744 m, and the
    /// patch's outer edge adds half a tyre width: 4,841 m.
    ///
    /// This is `Rqv` for this model. It is a hair under the legal 4,9 m floor for an exam car (see
    /// `assumptions.rqv_against_the_legal_minimum`), which makes the figures marginally easier than
    /// they would be with a real one — the honest direction to be wrong in, and named rather than
    /// hidden.
    pub fn rqv_m(&self, v: &Vehicle) -> f64 {
        let pivot = self.min_centre_radius_m(v);
        let half_base = 0.5 * v.wheelbase_m;
        let out = pivot + 0.5 * self.track_m;
        sqrt(half_base * half_base + out * out) + 0.5 * self.tyre_width_m
    }

    /// Bài 4's figure: Bvb = B1 + 0.2, Lvb = a, Sv = 1.5a, Lv = 2.0a, Bv = 2.2b.
    pub fn vet_width_m(&self, _v: &Vehicle) -> f64 {
        self.tyre_width_m + 0.2
    }

    /// The radius the car's own reference point traces at full lock: the tightest turn it can hold.
    /// `vehicle.rs` turns it at `v · tan(δ) / L`, so the radius is exactly `L / tan(δ)`.
    pub fn min_centre_radius_m(&self, v: &Vehicle) -> f64 {
        v.wheelbase_m / libm::tan(v.max_steer_rad)
    }

    /// The radius a bend is drawn at: comfortably above the car's tightest (`1,5×`), so the learner
    /// is not asked for full lock on the ideal line, but never so wide that the bend stops fitting
    /// the figure's own depth — two opposite quarter turns need `2·radius` of the drop between the
    /// lanes. Rounded down to the centimetre, so the figure is never tighter than intended.
    pub fn corner_radius_m(&self, v: &Vehicle, drop_m: f64) -> f64 {
        let want = 1.5 * self.min_centre_radius_m(v);
        let fits = 0.5 * drop_m;
        let r = if want < fits { want } else { fits };
        libm::floor(r * 100.0) / 100.0
    }

    /// Bài 6's figure: Bqc = 2.2b.
    pub fn lane_width_m(&self, v: &Vehicle) -> f64 {
        2.2 * v.width_m
    }

    /// Bài 6's figure: Rn = Rqv + 1.2, Rtr = Rn − Bqc.
    pub fn outer_radius_m(&self, v: &Vehicle) -> f64 {
        self.rqv_m(v) + 1.2
    }

    pub fn inner_radius_m(&self, v: &Vehicle) -> f64 {
        self.outer_radius_m(v) - self.lane_width_m(v)
    }

    /// The heading of the 45° line O1–O2 of Hình 12. Only the figure has it.
    pub fn o_line_angle_rad(&self) -> f64 {
        atan(1.0)
    }

    /// Distance between the two turn centres, Sqc = Rn + Rtr.
    pub fn o_distance_m(&self, v: &Vehicle) -> f64 {
        self.outer_radius_m(v) + self.inner_radius_m(v)
    }
}

impl Ruleset {
    pub fn parse(text: &str) -> Result<Self, String> {
        serde_json::from_str(text).map_err(|e| e.to_string())
    }

    pub fn load() -> Self {
        Self::parse(EMBEDDED).expect("embedded ruleset content/rulesets/tt108-2026.json is valid")
    }

    /// Rules are addressed by their legal id, never by position.
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.rules.iter().position(|r| r.id == id)
    }

    pub fn rule(&self, id: &str) -> &Rule {
        let i = self.index_of(id).unwrap_or_else(|| panic!("ruleset has no rule {id}"));
        &self.rules[i]
    }

    /// Everything the hot path needs, resolved once at `create` so no string lookup runs per tick.
    pub fn thresholds(&self) -> Thresholds {
        Thresholds {
            rpm_limit: self.rule("SH.X.RPM").params.rpm,
            timeout_20_ticks: seconds_to_ticks(self.rule("SH.01.QUA_20S").params.seconds),
            timeout_30_ticks: seconds_to_ticks(self.rule("SH.01.QUA_30S").params.seconds),
            hill_timeout_ticks: seconds_to_ticks(self.rule("SH.03.QUA_30S").params.seconds),
            de_vach_keo_dai_ticks: seconds_to_ticks(self.rule("SH.04.DE_VACH_KEO_DAI").params.seconds),
            junction_20_ticks: seconds_to_ticks(self.rule("SH.05.QUA_20S").params.seconds),
            junction_30_ticks: seconds_to_ticks(self.rule("SH.05.QUA_30S").params.seconds),
            park_time_limit_ticks: seconds_to_ticks(self.rule("SH.GHEP.QUA_THOI_GIAN").params.seconds),
            park_signal_hold_ticks: self.park.signal_hold_ticks(),
        }
    }
}

/// Fixed 1/60 s step; durations in the law become a tick count once, here.
pub fn seconds_to_ticks(seconds: f64) -> u32 {
    (seconds * 60.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legal_corpus() -> String {
        let files = [
            include_str!("../../../docs/legal/tt-108-2026-bca.md"),
            include_str!("../../../docs/legal/tt-108-2026-phu-luc-iii-oto.md"),
            include_str!("../../../docs/legal/qcvn-15-2026-bca.md"),
            include_str!("../../../docs/legal/qcvn-15-2026-hinh-ve.md"),
            include_str!("../../../docs/legal/qcvn-41-2024-va-bo-cau-hoi.md"),
            include_str!("../../../docs/legal/luat-giao-thong-nen-tang.md"),
        ];
        files.join("\n")
    }

    fn quotes(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(m) => {
                for (k, x) in m {
                    if k == "quote" {
                        out.push(x.as_str().expect("quote is a string").to_owned());
                    } else {
                        quotes(x, out);
                    }
                }
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| quotes(x, out)),
            _ => {}
        }
    }

    /// Every `source.quote` in the ruleset must appear verbatim in `docs/legal/*.md`.
    /// This is the check that keeps the data from drifting into invented law.
    #[test]
    fn every_quote_appears_verbatim_in_the_legal_docs() {
        let legal = legal_corpus();
        let json: serde_json::Value = serde_json::from_str(EMBEDDED).expect("ruleset json parses");
        let mut all = Vec::new();
        quotes(&json, &mut all);
        assert!(!all.is_empty(), "ruleset carries quotes");
        for q in &all {
            assert!(legal.contains(q.as_str()), "quote not found in docs/legal: {q}");
        }
    }

    /// The core charges rules by id and a charge for an id the ruleset lacks is silently dropped,
    /// so every id passed to `charge` in the exercise code must be a row of the ruleset.
    #[test]
    fn every_rule_id_the_core_charges_exists_in_the_ruleset() {
        let rs = Ruleset::load();
        let ids: Vec<&str> = include_str!("exercise.rs")
            .split("self.charge(rs, \"")
            .skip(1)
            .map(|rest| rest.split('"').next().unwrap())
            .collect();
        assert!(!ids.is_empty(), "found no charge calls to check");
        for id in ids {
            assert!(rs.index_of(id).is_some(), "the core charges {id}, which the ruleset lacks");
        }
    }
}
