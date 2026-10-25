//! Rule data: `content/rulesets/tt108-2026.json`, embedded and parsed once per `create`.
//!
//! Every scoring row carries the verbatim sentence it comes from (`source.quote`) and where it
//! sits in `docs/legal/*.md` (`source.loc`). Anything the law does not say lives in `assumptions`
//! instead of being silently baked into code.

use libm::sqrt;
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
    pub rules: Vec<Rule>,
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
