//! Bài 4 and bài 6 as geometry: the figures, their gates, and what the four wheel patches touch.
//!
//! Everything is generated from `rules::SaHinh` and the car's own dimensions, so the figure that is
//! drawn, the figure that is scored and the car that drives it cannot disagree. The formulas are
//! QCVN 15 mục 2.1.15.4 (vệt bánh xe and đường vòng vuông góc) and 2.1.15.6 (đường vòng quanh co);
//! every reading the text does not fix is an entry under `assumptions` in
//! `content/rulesets/tt108-2026.json`.
//!
//! A figure is a *centreline* — the path the learner is meant to follow — plus the limit lines
//! either side of it, a curb band outside each of those, and the gates across it. Each painted
//! line is one polyline, and that polyline is also the line's identity for the "mỗi lần" counting
//! rule: episodes are per line, so a line must be a single object from end to end.
//!
//! Contact is exact enough to score: a wheel's contact patch is a rectangle, a line is a polyline,
//! and a wheel touches a line when the distance between them is under half the painted width. No
//! trigonometry runs in that loop — only a point-to-segment distance and a point-to-box test.

//!
//! Float discipline of the crate: `+ - * /` and libm. The figure is built once per session, so the
//! `sin`/`cos` there cost nothing at run time.

use crate::rules::Ruleset;
use libm::{atan2, ceil, cos, sin, sqrt};

/// What one wheel's patch is touching, as the snapshot reports it.
pub const CLEAR: u8 = 0;
pub const ON_LINE: u8 = 1;
pub const ON_CURB: u8 = 2;

/// Curb band thickness: `docs/architecture.md` §7 ("bó vỉa ≥ 0,15 m"). The 0,15 m in
/// QCVN 15 mục 2.1.10 is a height; this is the width the drawn band gets.
const CURB_WIDTH_M: f64 = 0.15;

/// Which exercise's figure this is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Figure {
    /// Bài 4 — qua vệt bánh xe và đường vòng vuông góc.
    Vet,
    /// Bài 6 — qua đường vòng quanh co.
    Curve,
}

/// One straight piece of a polyline, in the frame of the car's `x_m`/`y_m`.
#[derive(Clone, Copy, Debug)]
pub struct Segment {
    pub a: (f64, f64),
    pub b: (f64, f64),
}

/// Which gate this is. `line_id` in `sim_course`'s gate records is this number.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Gate {
    Entry = 1,
    Exit = 2,
    VetStart = 3,
    VetEnd = 4,
}

/// A gate, as the two ends of the line drawn across the lane.
#[derive(Clone, Copy, Debug)]
pub struct GateLine {
    pub kind: Gate,
    pub a: (f64, f64),
    pub b: (f64, f64),
}

/// A painted line: one polyline, drawn from `points`.
#[derive(Clone, Debug)]
pub struct Line {
    /// 1 = limit line, 2 = curb band, 3 = vệt bánh xe line. What `sim_course` labels it.
    pub kind: u8,
    /// Half the painted width. A wheel whose patch is closer than this to the centreline touches
    /// the line; for a curb band that means it has climbed it.
    pub band_half_m: f64,
    pub points: Vec<(f64, f64)>,
    pub segments: Vec<Segment>,
}

/// Where a point sits relative to the figure.
#[derive(Clone, Copy, Debug)]
pub struct Projection {
    /// Metres along the centreline from its start.
    pub progress_m: f64,
    /// Signed offset from the centreline, + left of the direction of travel.
    pub lateral_m: f64,
    /// Tangent heading of the centreline at that point.
    pub heading_rad: f64,
    /// Index of the named part of the figure, for the snapshot.
    pub part: usize,
}

/// What one wheel's patch touches.
#[derive(Clone, Copy, Debug, Default)]
pub struct Contact {
    /// Bitset over `Course::lines`: which painted lines the patch reaches.
    pub mask: u64,
    /// Whether the patch reaches a curb band.
    pub curb: bool,
}

impl Contact {
    pub fn code(&self) -> u8 {
        if self.curb {
            ON_CURB
        } else if self.mask != 0 {
            ON_LINE
        } else {
            CLEAR
        }
    }
}

/// A generated figure. Built once per session, read-only afterwards.
pub struct Course {
    /// The path the learner follows, from before the entry gate to past the exit gate.
    pub centre: Vec<(f64, f64)>,
    centre_segments: Vec<Segment>,
    /// Cumulative distance along the centreline to the start of each centre segment.
    centre_cum: Vec<f64>,
    pub lines: Vec<Line>,
    pub gates: Vec<GateLine>,
    /// Named parts of the figure as `[from_m, to_m)` in progress. The snapshot reports the index.
    pub parts: Vec<(f64, f64)>,
    pub length_m: f64,
    /// Half the lane's clear width, centreline to the centre of a limit line.
    pub half_lane_m: f64,
    /// Progress of the entry and exit gates. The clock runs between them.
    pub entry_m: f64,
    pub exit_m: f64,
    /// Bài 4: the vệt strip, as `(x0, x1)` of the figure frame and the lateral centre the two
    /// right wheels must hold between them. `None` in bài 6.
    pub vet: Option<VetStrip>,
    pub start_x_m: f64,
    pub start_y_m: f64,
    pub start_heading_rad: f64,
}

/// Bài 4's vệt bánh xe: a straight strip, so it lives in the figure frame rather than in progress.
#[derive(Clone, Copy, Debug)]
pub struct VetStrip {
    pub x0: f64,
    pub x1: f64,
    /// Lateral centre of the strip in the figure frame (the right wheels' track).
    pub y_m: f64,
    /// Distance from `y_m` to the centre of either vệt line.
    pub line_offset_m: f64,
    /// Half the painted width of a vệt line.
    pub line_half_m: f64,
}

impl VetStrip {
    /// Whether the wheel's patch touches the vệt paint on either side of the strip. This is exactly
    /// the test the contact model uses for any painted line — the patch overlaps the band — so a
    /// wheel charged DE_VACH here is a wheel whose contact code for that line is `ON_LINE`.
    ///
    /// Counting the patch, not the centre, is what keeps DE_VACH and TRUOT_VET from overlapping: a
    /// patch reaches the paint out to `line_offset + line_half + patch_reach`, which is well past
    /// where the strip's own half width ends.
    pub fn touches_paint(&self, wheel_y: f64, patch_reach: f64) -> bool {
        (wheel_y - self.y_m).abs() + patch_reach >= self.line_offset_m - self.line_half_m
    }

    /// Whether the wheel has left the strip on the *outside* of the paint: its patch is entirely
    /// clear of the far side of either vệt line. Anything short of that still has the patch
    /// somewhere within the strip's full painted width, which is what "in the vệt zone" means.
    ///
    /// This is a different act from `touches_paint`, and strictly wider: `touches_paint` implies
    /// `!left_zone` (a patch on the paint is by definition not entirely clear of it), so a wheel can
    /// be on the paint and not have left — the DE_VACH-only case. The two are never both true for one
    /// wheel, by construction.
    pub fn left_zone(&self, wheel_y: f64, patch_reach: f64) -> bool {
        (wheel_y - self.y_m).abs() - patch_reach > self.line_offset_m + self.line_half_m
    }

}

impl Course {
    /// Generate a figure. `None` when the ruleset makes it impossible to draw.
    pub fn new(figure: Figure, rs: &Ruleset) -> Option<Self> {
        let v = &rs.vehicle;
        let sh = &rs.sa_hinh;
        if v.length_m <= 0.0 || v.width_m <= 0.0 || sh.lane_width_m(v) <= 0.0 {
            return None;
        }
        match figure {
            Figure::Vet => vet_figure(rs),
            Figure::Curve => curve_figure(rs),
        }
    }

    /// The four wheel centres in world coordinates, order FL, FR, RL, RR.
    pub fn wheel_centres(&self, rs: &Ruleset, x: f64, y: f64, heading: f64) -> [(f64, f64); 4] {
        let v = &rs.vehicle;
        let half_base = 0.5 * v.wheelbase_m;
        let half_track = 0.5 * rs.sa_hinh.track_m;
        let c = cos(heading);
        let s = sin(heading);
        // Front is +x in the car's own frame, left is +y.
        let local = [
            (half_base, half_track),
            (half_base, -half_track),
            (-half_base, half_track),
            (-half_base, -half_track),
        ];
        let mut out = [(0.0, 0.0); 4];
        for (i, (lx, ly)) in local.into_iter().enumerate() {
            out[i] = (x + lx * c - ly * s, y + lx * s + ly * c);
        }
        out
    }

    /// The contact patch of one wheel as a convex quad, corners in order.
    pub fn patch(&self, rs: &Ruleset, centre: (f64, f64), heading: f64) -> [(f64, f64); 4] {
        let half_w = 0.5 * rs.sa_hinh.tyre_width_m;
        let half_l = 0.5 * rs.sa_hinh.patch_length_m;
        let c = cos(heading);
        let s = sin(heading);
        let local = [(half_l, half_w), (half_l, -half_w), (-half_l, -half_w), (-half_l, half_w)];
        let mut out = [(0.0, 0.0); 4];
        for (i, (lx, ly)) in local.into_iter().enumerate() {
            out[i] = (centre.0 + lx * c - ly * s, centre.1 + lx * s + ly * c);
        }
        out
    }

    /// What one wheel's patch touches: which lines, and whether it is up on a curb.
    ///
    /// The patch is a rectangle and a line is a polyline, so "touching" is the distance between
    /// them against half the painted width. A curb band is just another line, offset outside the
    /// limit line, so one test covers both and the gap between them stays exactly what the ruleset
    /// says it is.
    pub fn contact(&self, rs: &Ruleset, centre: (f64, f64), heading: f64) -> Contact {
        let patch = self.patch(rs, centre, heading);
        let mut reach = 0.0f64;
        for line in &self.lines {
            reach = reach.max(line.band_half_m);
        }
        let reach = reach + patch_radius(&patch);
        let mut out = Contact::default();
        for (i, line) in self.lines.iter().enumerate() {
            let Some(d) = polyline_distance(&line.segments, &patch, centre, reach) else { continue };
            if d <= line.band_half_m {
                if line.kind == 2 {
                    out.curb = true;
                } else {
                    out.mask |= 1u64 << i;
                }
            }
        }
        out
    }

    /// Where `(x, y)` sits relative to the figure.
    pub fn project(&self, x: f64, y: f64) -> Projection {
        let mut best = Projection { progress_m: 0.0, lateral_m: 0.0, heading_rad: 0.0, part: 0 };
        let mut best_d2 = f64::INFINITY;
        for (i, seg) in self.centre_segments.iter().enumerate() {
            let dx = seg.b.0 - seg.a.0;
            let dy = seg.b.1 - seg.a.1;
            let len2 = dx * dx + dy * dy;
            let t = if len2 > 0.0 {
                (((x - seg.a.0) * dx + (y - seg.a.1) * dy) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let px = seg.a.0 + t * dx;
            let py = seg.a.1 + t * dy;
            let ex = x - px;
            let ey = y - py;
            let d2 = ex * ex + ey * ey;
            if d2 < best_d2 {
                best_d2 = d2;
                let len = sqrt(len2);
                best.progress_m = self.centre_cum[i] + t * len;
                best.lateral_m = if len > 0.0 { (dx * ey - dy * ex) / len } else { 0.0 };
                best.heading_rad = atan2(dy, dx);
            }
        }
        best.part = self.part_at(best.progress_m);
        best
    }

    /// The named part of the figure a progress point falls in.
    pub fn part_at(&self, progress_m: f64) -> usize {
        for (i, (_, to)) in self.parts.iter().enumerate() {
            if progress_m < *to {
                return i;
            }
        }
        self.parts.len().saturating_sub(1)
    }

    /// Serialise as `sim_course` returns it: `[kind, line_id, npoints, x0, y0, ...]` per record.
    pub fn write(&self, out: &mut Vec<f64>) {
        let mut push = |kind: f64, id: f64, pts: &[(f64, f64)]| {
            out.push(kind);
            out.push(id);
            out.push(pts.len() as f64);
            for (x, y) in pts {
                out.push(*x);
                out.push(*y);
            }
        };
        for (i, line) in self.lines.iter().enumerate() {
            push(f64::from(line.kind), i as f64, &line.points);
        }
        for gate in &self.gates {
            push(4.0, gate.kind as u8 as f64, &[gate.a, gate.b]);
        }
        push(5.0, 0.0, &self.centre);
    }
}

/// Half the diagonal of a quad: the farthest a point in it can be from its centre.
fn patch_radius(patch: &[(f64, f64); 4]) -> f64 {
    let dx = patch[0].0 - patch[2].0;
    let dy = patch[0].1 - patch[2].1;
    0.5 * sqrt(dx * dx + dy * dy)
}

/// Distance from a convex quad to a polyline, or `None` when `reach` proves they are further
/// apart than `reach`. The `reach` filter is what keeps the per-tick cost down: it is a
/// point-to-box test, and anything it rejects cannot be touching.
fn polyline_distance(
    segments: &[Segment],
    patch: &[(f64, f64); 4],
    centre: (f64, f64),
    reach: f64,
) -> Option<f64> {
    let mut best = f64::INFINITY;
    for seg in segments {
        // Cheap reject: the patch fits inside a disc of `patch_radius` about its centre, so a
        // segment further than `reach` from that centre cannot touch it.
        if point_segment_distance(centre, seg) > reach {
            continue;
        }
        let d = quad_segment_distance(patch, seg);
        if d < best {
            best = d;
            if best == 0.0 {
                return Some(0.0);
            }
        }
    }
    if best.is_finite() { Some(best) } else { None }
}

/// Distance between a convex quad and a segment: zero when they cross. Both are convex, so the
/// minimum is either a vertex of one against the other, or zero when an edge crosses.
fn quad_segment_distance(quad: &[(f64, f64); 4], seg: &Segment) -> f64 {
    if quad_contains(quad, seg.a) || quad_contains(quad, seg.b) {
        return 0.0;
    }
    let mut best = f64::INFINITY;
    for i in 0..4 {
        let p = quad[i];
        let q = quad[(i + 1) % 4];
        if segments_cross(p, q, seg.a, seg.b) {
            return 0.0;
        }
        best = best.min(point_segment_distance(p, seg));
    }
    best = best.min(point_polygon_distance(seg.a, quad));
    best
}

fn quad_contains(quad: &[(f64, f64); 4], p: (f64, f64)) -> bool {
    let mut sign = 0.0;
    for i in 0..4 {
        let a = quad[i];
        let b = quad[(i + 1) % 4];
        let cross = (b.0 - a.0) * (p.1 - a.1) - (b.1 - a.1) * (p.0 - a.0);
        if cross != 0.0 {
            if sign == 0.0 {
                sign = cross;
            } else if cross.signum() != sign.signum() {
                return false;
            }
        }
    }
    true
}

fn point_polygon_distance(p: (f64, f64), quad: &[(f64, f64); 4]) -> f64 {
    if quad_contains(quad, p) {
        return 0.0;
    }
    let mut best = f64::INFINITY;
    for i in 0..4 {
        let seg = Segment { a: quad[i], b: quad[(i + 1) % 4] };
        best = best.min(point_segment_distance(p, &seg));
    }
    best
}

fn point_segment_distance(p: (f64, f64), seg: &Segment) -> f64 {
    let dx = seg.b.0 - seg.a.0;
    let dy = seg.b.1 - seg.a.1;
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((p.0 - seg.a.0) * dx + (p.1 - seg.a.1) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let ex = p.0 - (seg.a.0 + t * dx);
    let ey = p.1 - (seg.a.1 + t * dy);
    sqrt(ex * ex + ey * ey)
}

fn segments_cross(p1: (f64, f64), p2: (f64, f64), p3: (f64, f64), p4: (f64, f64)) -> bool {
    let d1 = cross(p3, p4, p1);
    let d2 = cross(p3, p4, p2);
    let d3 = cross(p1, p2, p3);
    let d4 = cross(p1, p2, p4);
    (d1 * d2 < 0.0) && (d3 * d4 < 0.0)
}

fn cross(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
}

// ---------------------------------------------------------------------------------------------
// The two figures.
// ---------------------------------------------------------------------------------------------

/// A polyline under construction, with its cumulative lengths.
struct Path {
    points: Vec<(f64, f64)>,
}

impl Path {
    fn new(start: (f64, f64)) -> Self {
        Self { points: vec![start] }
    }

    fn line_to(&mut self, p: (f64, f64)) {
        if self.points.last() != Some(&p) {
            self.points.push(p);
        }
    }

    /// Total length so far.
    fn length(&self) -> f64 {
        segments_of(&self.points).1
    }

    /// A circular arc from the current end point. `sweep` is signed: positive turns left.
    fn arc(&mut self, centre: (f64, f64), radius: f64, from: f64, sweep: f64, max_seg: f64) {
        let steps = if radius <= 0.0 || max_seg <= 0.0 {
            1.0
        } else {
            ceil((sweep.abs() * radius) / max_seg).max(1.0)
        };
        let n = steps as u32;
        for i in 1..=n {
            let a = from + sweep * (f64::from(i) / f64::from(n));
            self.points.push((centre.0 + radius * cos(a), centre.1 + radius * sin(a)));
        }
    }
}

fn segments_of(points: &[(f64, f64)]) -> (Vec<Segment>, f64) {
    let mut segs = Vec::with_capacity(points.len().saturating_sub(1));
    let mut length = 0.0;
    for w in points.windows(2) {
        if w[0] == w[1] {
            continue;
        }
        let seg = Segment { a: w[0], b: w[1] };
        length += seg_length(&seg);
        segs.push(seg);
    }
    (segs, length)
}

fn seg_length(seg: &Segment) -> f64 {
    let dx = seg.b.0 - seg.a.0;
    let dy = seg.b.1 - seg.a.1;
    sqrt(dx * dx + dy * dy)
}

/// A painted line with its drawn width.
fn painted(kind: u8, band_half_m: f64, points: Vec<(f64, f64)>) -> Line {
    let (segments, _length) = segments_of(&points);
    Line { kind, band_half_m, points, segments }
}

/// The two curb bands of a figure: offset just outside the limit lines, `CURB_WIDTH_M` wide.
fn curbs(centre: &[(f64, f64)], half_lane: f64, sh: &crate::rules::SaHinh) -> Vec<Line> {
    let offset = half_lane + 0.5 * sh.line_width_m + sh.line_curb_setback_m + 0.5 * CURB_WIDTH_M;
    let half = 0.5 * CURB_WIDTH_M;
    vec![
        painted(2, half, offset_path(centre, offset)),
        painted(2, half, offset_path(centre, -offset)),
    ]
}

fn course_from(rs: &Ruleset, figure: Figure, centre: Vec<(f64, f64)>, lines: Vec<Line>, gates: Vec<GateLine>, parts: Vec<(f64, f64)>, vet: Option<VetStrip>, extra: StartPose) -> Course {
    let _ = rs;
    let (centre_segments, length_m) = segments_of(&centre);
    let mut centre_cum = Vec::with_capacity(centre_segments.len());
    let mut s = 0.0;
    for seg in &centre_segments {
        centre_cum.push(s);
        s += seg_length(seg);
    }
    let _ = figure;
    Course {
        centre,
        centre_segments,
        centre_cum,
        lines,
        gates,
        parts,
        length_m,
        half_lane_m: extra.half_lane_m,
        entry_m: extra.entry_m,
        exit_m: extra.exit_m,
        vet,
        start_x_m: extra.x,
        start_y_m: extra.y,
        start_heading_rad: extra.heading,
    }
}

struct StartPose {
    x: f64,
    y: f64,
    heading: f64,
    half_lane_m: f64,
    entry_m: f64,
    exit_m: f64,
}

/// Offsets a polyline `d` metres to its left (negative: to its right), mitered at the joints. On a
/// discretised arc the result is the concentric arc: every vertex sits exactly `d` from the arc's
/// centre, and a chord joins them.
fn offset_path(points: &[(f64, f64)], d: f64) -> Vec<(f64, f64)> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let mut out = Vec::with_capacity(points.len());
    for i in 0..points.len() {
        let p = points[i];
        let n_in = if i == 0 { None } else { Some(left_normal(points[i - 1], p)) };
        let n_out = if i + 1 == points.len() { None } else { Some(left_normal(p, points[i + 1])) };
        match (n_in, n_out) {
            (None, Some(n)) | (Some(n), None) => out.push((p.0 + n.0 * d, p.1 + n.1 * d)),
            (Some(n1), Some(n2)) => {
                // The miter point: on both offset lines at once. `denom` is 1 + cos of the turn.
                let denom = 1.0 + n1.0 * n2.0 + n1.1 * n2.1;
                if denom < 1e-6 {
                    // A reversal: the offset tears. Push both, so the line stays connected.
                    out.push((p.0 + n1.0 * d, p.1 + n1.1 * d));
                    out.push((p.0 + n2.0 * d, p.1 + n2.1 * d));
                } else {
                    let k = d / denom;
                    out.push((p.0 + (n1.0 + n2.0) * k, p.1 + (n1.1 + n2.1) * k));
                }
            }
            (None, None) => out.push(p),
        }
    }
    out
}

fn left_normal(a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let len = sqrt(dx * dx + dy * dy);
    if len == 0.0 { (0.0, 0.0) } else { (-dy / len, dx / len) }
}

fn gate_across(point: (f64, f64), heading: f64, half_width: f64, kind: Gate) -> GateLine {
    let n = (-sin(heading), cos(heading));
    GateLine {
        kind,
        a: (point.0 - n.0 * half_width, point.1 - n.1 * half_width),
        b: (point.0 + n.0 * half_width, point.1 + n.1 * half_width),
    }
}

/// Bài 4 — Qua vệt bánh xe và đường vòng vuông góc (Hình 10).
///
/// One lane `Bv = 2.2b` wide all the way. The frame: `+x` along the first straight, `+y` to its
/// left, so a right-hand bend takes the lane towards `-y`. The vệt strip sits on the right wheels'
/// track — where they run when the car is centred in the lane — for `Lvb = a` metres, then the lane
/// runs `Lv = 2.0a` to the first bend, turns right, and after the transverse leg turns left again.
///
/// `Sv` is the *clear depth* of each transverse leg: the gap between lane A's right limit line and
/// lane B's left one. So the two lane centrelines are `Sv + Bv` apart. See `assumptions.bai_4_layout`
/// in the ruleset for the arithmetic that makes this the only passable reading.
fn vet_figure(rs: &Ruleset) -> Option<Course> {
    let v = &rs.vehicle;
    let sh = &rs.sa_hinh;
    let lane = sh.lane_width_m(v);
    let half = 0.5 * lane;
    let half_line = 0.5 * sh.line_width_m;
    let a = v.length_m;
    let lvb = a;
    let lv = 2.0 * a;
    let drop = 1.5 * a + lane;
    // `lead_m` is how far the car is placed before a gate, so the car's own half length is what
    // turns that into metres of centreline.
    let lead = sh.lead_m + 0.5 * a;
    let pi = core::f64::consts::PI;
    let half_pi = 0.5 * pi;

    // The car starts at the beginning of the centreline, on it, pointing along it.
    let gate_x = lead;
    let corner_x = gate_x + lvb + lv;

    // A 90° corner of a lane only a little wider than the car cannot be driven as a corner: the car
    // has to begin turning before it and finish after, and the lane's own depth is what limits how
    // wide that turn may be. Each bend is one quarter arc, tangent to both legs, and the two arcs
    // meet in the transverse leg.
    let rho = sh.corner_radius_m(v, drop);
    let c1 = (corner_x - rho, -rho);
    let c2 = (corner_x + rho, -drop + rho);
    let exit_x = corner_x + rho + lv;
    let x_end = exit_x + lead;

    let mut p = Path::new((0.0, 0.0));
    let mut marks: Vec<f64> = Vec::new();
    p.line_to((c1.0, 0.0));
    marks.push(p.length());
    // First bend, right: over the top of the circle and down its right-hand side.
    p.arc(c1, rho, half_pi, -half_pi, sh.max_segment_m);
    marks.push(p.length());
    // The transverse leg, from the first arc's end to the second arc's start.
    p.line_to((c2.0 - rho, c2.1));
    marks.push(p.length());
    // Second bend, left: in at the circle's left-hand side and out at the bottom.
    p.arc(c2, rho, pi, half_pi, sh.max_segment_m);
    marks.push(p.length());
    p.line_to((x_end, -drop));
    marks.push(p.length());
    let centre = p.points;

    let mut lines = vec![
        painted(1, half_line, offset_path(&centre, half)),
        painted(1, half_line, offset_path(&centre, -half)),
    ];
    lines.extend(curbs(&centre, half, sh));

    // The vệt: two thin lines round the right wheels' track while the car is centred, their inner
    // edges `Bvb` apart. That is the strip a right wheel has to stay inside, so with Bvb = B1 + 0,2
    // a wheel centred on the strip has 0,1 m of clear paint either side of its tyre.
    let half_vet = 0.5 * sh.vet_width_m(v);
    let vet_y = -0.5 * sh.track_m;
    let vet_x0 = gate_x;
    let vet_x1 = gate_x + lvb;
    let line_offset = half_vet + half_line;
    lines.push(painted(3, half_line, vec![(vet_x0, vet_y + line_offset), (vet_x1, vet_y + line_offset)]));
    lines.push(painted(3, half_line, vec![(vet_x0, vet_y - line_offset), (vet_x1, vet_y - line_offset)]));

    let total = centre_length_of(&centre);
    let parts = vec![
        (0.0, gate_x),
        (gate_x, vet_x1),
        (vet_x1, marks[0]),
        (marks[0], marks[1]),
        (marks[1], marks[2]),
        (marks[2], marks[3]),
        (marks[3], total),
    ];
    // Marks, in order: the start of the first bend, its end, the second bend's start and end, and
    // the start of the lead-out. The six named spans above map onto them one to one.
    let gates = vec![
        gate_across((gate_x, 0.0), 0.0, half + 0.5, Gate::Entry),
        gate_across((vet_x0, 0.0), 0.0, half + 0.5, Gate::VetStart),
        gate_across((vet_x1, 0.0), 0.0, half + 0.5, Gate::VetEnd),
        gate_across((exit_x, -drop), 0.0, half + 0.5, Gate::Exit),
    ];
    let vet = VetStrip {
        x0: vet_x0,
        x1: vet_x1,
        y_m: vet_y,
        line_offset_m: line_offset,
        line_half_m: half_line,
    };
    let pose = StartPose {
        x: 0.0,
        y: 0.0,
        heading: 0.0,
        half_lane_m: half,
        entry_m: gate_x,
        exit_m: total - lead,
    };
    Some(course_from(rs, Figure::Vet, centre, lines, gates, parts, Some(vet), pose))
}

fn centre_length_of(centre: &[(f64, f64)]) -> f64 {
    segments_of(centre).1
}

/// Bài 6 — Qua đường vòng quanh co (Hình 12).
///
/// Two half-annuli of opposite curvature that meet at a single point, `O1` and `O2` `Sqc = Rn + Rtr`
/// apart along a line at 45°. Because the arc radius is `(Rn + Rtr) / 2`, setting the centres exactly
/// `2` arc radii apart makes the outer circle of one half touch the inner circle of the other at the
/// join — which is what `Sqc = Rn + Rtr` says, since `Rn + Rtr = 2 * arc radius`.
///
/// The two limit lines are therefore one arc of `Rn` and one arc of `Rtr` each, meeting tangentially
/// at the join; the curb runs outside both.
fn curve_figure(rs: &Ruleset) -> Option<Course> {
    let v = &rs.vehicle;
    let sh = &rs.sa_hinh;
    let half = 0.5 * sh.lane_width_m(v);
    let half_line = 0.5 * sh.line_width_m;
    let rn = sh.outer_radius_m(v);
    let rtr = sh.inner_radius_m(v);
    let r = 0.5 * (rn + rtr);
    // `lead_m` of travel before the gate, so the car's half length is part of the lead-in.
    let lead = sh.lead_m + 0.5 * v.length_m;
    let angle = sh.o_line_angle_rad();
    let max_seg = sh.max_segment_m;
    let half_pi = 0.5 * core::f64::consts::PI;
    let pi = core::f64::consts::PI;

    let (ux, uy) = (cos(angle), sin(angle));
    // The join sits at the origin; the two turn centres are one arc radius away from it, opposite
    // each other along `u`. With Sqc = Rn + Rtr = 2r, that is exactly the figure's geometry.
    let o1 = (-r * ux, -r * uy);
    let o2 = (r * ux, r * uy);
    let entry_a = angle + pi;
    let exit_a = angle;

    let entry = (o1.0 + r * cos(entry_a), o1.1 + r * sin(entry_a));
    let entry_tangent = entry_a + half_pi;
    let start = (entry.0 - lead * cos(entry_tangent), entry.1 - lead * sin(entry_tangent));
    let exit = (o2.0 + r * cos(exit_a), o2.1 + r * sin(exit_a));
    let exit_tangent = exit_a - half_pi;
    let end = (exit.0 + lead * cos(exit_tangent), exit.1 + lead * sin(exit_tangent));

    let mut p = Path::new(start);
    p.line_to(entry);
    // First half: round O1, from the entry to the join, turning left.
    p.arc(o1, r, entry_a, pi, max_seg);
    // Second half: round O2, from the join to the exit, turning right.
    p.arc(o2, r, angle + pi, -pi, max_seg);
    p.line_to(end);
    let centre = p.points;

    let mut lines = vec![
        painted(1, half_line, offset_path(&centre, half)),
        painted(1, half_line, offset_path(&centre, -half)),
    ];
    lines.extend(curbs(&centre, half, sh));
    let total = centre_length_of(&centre);
    let gates = vec![
        gate_across(entry, entry_tangent, half + 0.5, Gate::Entry),
        gate_across(exit, exit_tangent, half + 0.5, Gate::Exit),
    ];
    let half_turn = pi * r;
    let parts = vec![
        (0.0, lead),
        (lead, lead + half_turn),
        (lead + half_turn, lead + 2.0 * half_turn),
        (lead + 2.0 * half_turn, total),
    ];
    let pose = StartPose {
        x: start.0,
        y: start.1,
        heading: entry_tangent,
        half_lane_m: half,
        entry_m: lead,
        exit_m: total - lead,
    };
    Some(course_from(rs, Figure::Curve, centre, lines, gates, parts, None, pose))
}


impl Course {
    /// Every line with its band half-width and the exact distance from a point's patch.
    pub fn debug_contacts(&self, rs: &Ruleset, centre: (f64, f64), heading: f64) -> Vec<(u8, f64, f64)> {
        let patch = self.patch(rs, centre, heading);
        let reach = 5.0;
        self.lines
            .iter()
            .map(|l| {
                let d = polyline_distance(&l.segments, &patch, centre, reach).unwrap_or(f64::INFINITY);
                (l.kind, l.band_half_m, d)
            })
            .collect()
    }
}
