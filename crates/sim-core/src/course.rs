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
    /// Bài 2 — a straight lane with the stop line and the crosswalk.
    Crosswalk,
    /// Bài 9 — a straight lane with the stop line and the two rails.
    Rail,
    /// Bài 11 — a straight lane with the finish line.
    Finish,
    /// Bài 5 — the right-turn route through the signalled junction.
    Junction,
    /// Bài 7 — ghép xe dọc vào nơi đỗ (Hình 13).
    GhepDoc,
    /// Bài 8 — ghép xe ngang vào nơi đỗ (Hình 14).
    GhepNgang,
}

/// A transverse marking: a painted band across the lane, or (for a crosswalk stripe) along it.
/// `sim_course` writes one `[kind = 6, line_id, 2, ax, ay, bx, by]` record per mark.
#[derive(Clone, Copy, Debug)]
pub struct Mark {
    /// 1 stop line | 2 finish/end line | 3 crosswalk stripe | 4 rail.
    pub line_id: u8,
    pub a: (f64, f64),
    pub b: (f64, f64),
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
    /// Bài 7 and bài 8: the bay's open edge, where the car has to reverse through.
    BayMouth = 5,
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
    /// Transverse markings: the stop line, the crosswalk stripes, the rails, the finish line. Not
    /// part of the contact model — they are the picture of the exercise, not its boundaries.
    pub marks: Vec<Mark>,
    /// Where the exercise's signal head stands, if it has one (bài 2, bài 5, bài 9).
    pub signal: Option<(f64, f64)>,
    /// Bài 5: metres along the approach axis where the right-turn arc begins. The turn signal is
    /// judged when the bumper reaches it.
    pub arc_start_m: Option<f64>,
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
    /// Bài 7 and bài 8: the bay, the area it opens onto, and the gate the clock starts at. `None`
    /// in every other exercise.
    pub park: Option<ParkBay>,
    pub start_x_m: f64,
    pub start_y_m: f64,
    pub start_heading_rad: f64,
}

/// Bài 7 and bài 8 as geometry. Both figures are one flat area — the control area of Hình 13 or
/// the road of Hình 14 — with a rectangular bay off it, so the rectangle pair is the whole
/// description: containment, the finish signal and SAI_HINH read it, and the web draws it from the
/// same numbers.
///
/// A rectangle is `(x0, y0, x1, y1)` with `x0 < x1` and `y0 < y1`, in metres in the snapshot's own
/// frame. The bay's boundary is the *centre* of the painted lines round it, so a hull whose corner
/// lands exactly on a line is inside the bay and its wheel is on the paint.
#[derive(Clone, Copy, Debug)]
pub struct ParkBay {
    /// The area the car may drive on outside the bay: the control area of bài 7, the road of bài 8.
    pub area: (f64, f64, f64, f64),
    /// The bay itself. The hull has to be inside this for the finish signal.
    pub bay: (f64, f64, f64, f64),
    /// The gate across the driving axis, where the clock starts: `gate_x`.
    pub gate_x: f64,
    /// Bài 7 drives towards −x (the car enters from +x and passes the bay); bài 8 towards +x.
    pub approach_negative: bool,
}

impl ParkBay {
    /// How far the car centre is outside the drivable area (the area plus the bay), 0 when inside.
    /// This is what SAI_HINH compares against `outside_margin_m`.
    pub fn centre_outside_m(&self, x: f64, y: f64) -> f64 {
        let d = rect_outside(&self.area, x, y).min(rect_outside(&self.bay, x, y));
        d
    }

    /// Whether all four hull corners are inside the bay.
    pub fn hull_inside(&self, corners: &[(f64, f64); 4]) -> bool {
        corners.iter().all(|(x, y)| point_in_rect(&self.bay, *x, *y))
    }
}

fn point_in_rect(r: &(f64, f64, f64, f64), x: f64, y: f64) -> bool {
    x >= r.0 && x <= r.2 && y >= r.1 && y <= r.3
}

fn rect_outside(r: &(f64, f64, f64, f64), x: f64, y: f64) -> f64 {
    let dx = (r.0 - x).max(x - r.2).max(0.0);
    let dy = (r.1 - y).max(y - r.3).max(0.0);
    sqrt(dx * dx + dy * dy)
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
            Figure::Crosswalk | Figure::Rail | Figure::Finish => road_figure(rs, figure),
            Figure::Junction => junction_figure(rs),
            Figure::GhepDoc | Figure::GhepNgang => park_figure(figure, rs),
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
        // Additions for the road exercises, appended so the four older goldens' blocks keep the
        // records they always had, in the order they always had.
        for m in &self.marks {
            push(6.0, f64::from(m.line_id), &[m.a, m.b]);
        }
        if let Some(p) = self.signal {
            push(7.0, 0.0, &[p]);
        }
        // Bài 7 and bài 8 only: the two rectangles the bay exercise is made of. Line 1 is the area
        // the car may drive on, line 2 the bay, both closed quads (first corner repeated).
        if let Some(p) = &self.park {
            push(8.0, 1.0, &rect_quad(&p.area));
            push(8.0, 2.0, &rect_quad(&p.bay));
        }
    }

    /// Whether any wheel's contact patch reaches a limit line (kind 1) of the figure. This is what
    /// bài 5's SAI_VACH_KE is judged on: the same patch test bài 4 and bài 6 charge DE_VACH with,
    /// restricted to the route's own boundary lines.
    pub fn boundary_touch(&self, rs: &Ruleset, x: f64, y: f64, heading: f64) -> bool {
        let mut boundary = 0u64;
        for (i, line) in self.lines.iter().enumerate() {
            if line.kind == 1 {
                boundary |= 1u64 << i;
            }
        }
        for w in self.wheel_centres(rs, x, y, heading) {
            if self.contact(rs, w, heading).mask & boundary != 0 {
                return true;
            }
        }
        false
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
        marks: Vec::new(),
        signal: None,
        arc_start_m: None,
        parts,
        length_m,
        half_lane_m: extra.half_lane_m,
        entry_m: extra.entry_m,
        exit_m: extra.exit_m,
        vet,
        park: None,
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

/// A closed quad for the `kind 8` record: the four corners, first repeated.
fn rect_quad(r: &(f64, f64, f64, f64)) -> Vec<(f64, f64)> {
    vec![(r.0, r.1), (r.2, r.1), (r.2, r.3), (r.0, r.3), (r.0, r.1)]
}

/// Bài 7 (Hình 13) and bài 8 (Hình 14) — the two bay exercises.
///
/// Both are the same shape of figure — one flat area, one rectangular bay cut into its edge — so
/// both are built here from the law's five formulas and the car's own `a` and `b`. Hình 13 gives
/// `Ld = a + 1,0`, `Rd = b + 0,6`, `Ed = 1,2a`; Hình 14 gives `Lg = 3a/2`, `Rg = 5b/4`.
///
/// **Bài 7, dọc.** The control lane is `Ed` wide and runs along `−x` (the car enters from `+x` and
/// drives towards the dead end, as "xe vào từ bên phải, chạy qua ô đỗ vào phần cụt bên trái" says).
/// The bay is `Rd` along the lane by `Ld` away from it, perpendicular, below the lane. Along the
/// lane, reading right to left: `Ed` of lane, the bay's `Rd`, then `Ed` of lane ending in the closed
/// curbed end — "Làn chính kéo dài Ed về bên trái ô đỗ, đầu bên trái bị bó vỉa đóng kín".
///
/// **Bài 8, ngang.** A road `sa_hinh.lane_width_m` wide running along `+x` with the bay `Lg × Rg`
/// recessed into its right edge (`−y`), the road edge kerbed either side of the bay. Nothing is
/// behind the bay, which is what makes it the tighter of the two.
///
/// What is painted and what is kerbed is the figure: the bay's outline is a limit line on its three
/// closed sides and open at its mouth; the area's own edges are limit lines, and where the figure
/// ends in something a car must not mount (the closed end, the far side, the road's edge away from
/// the bay) a curb band runs just outside them. A hull corner on a line's centre is inside the bay;
/// a wheel on the paint is DE_VACH, which the shared contact model charges.
fn park_figure(figure: Figure, rs: &Ruleset) -> Option<Course> {
    let v = &rs.vehicle;
    let p = &rs.park;
    let sh = &rs.sa_hinh;
    let half_line = 0.5 * sh.line_width_m;
    // The car is placed `lead` before the gate, on the driving axis, and the gate is the line across
    // the lane at the near edge of the exercise — where "tiến vào khoảng cách khống chế" ends.
    let lead = sh.lead_m + 0.5 * v.length_m;
    let pi = core::f64::consts::PI;

    // The drivable AREA is the whole figure the car may be on, approach included: leaving it is
    // SAI_HINH, and it starts inside it. The BAY is where the hull has to end up. Along the driving
    // axis, bài 7 reads left to right as [closed end | Ed | bay Rd | open entry], and bài 8 reads
    // left to right as [approach | Lg bay | run-out].
    let (area, bay, heading, approach_negative) = match figure {
        Figure::GhepDoc => {
            let lane = p.doc_lane_m(v);
            let (ld, rd) = (p.doc_length_m(v), p.doc_width_m(v));
            // "Làn chính kéo dài Ed về bên trái ô đỗ, đầu bên trái bị bó vỉa đóng kín": the closed
            // end sits Ed past the bay's far side. To the right of the bay the lane runs on — that is
            // the entry the car comes in through, so the area carries it out to the start pose.
            // "Làn chính kéo dài Ed về bên trái ô đỗ": the closed end is Ed left of the bay's far
            // side. To the right the lane runs on to the open entry; the car starts `lead` inside
            // that end, so the start pose is inside the figure rather than on its edge.
            let area = (-(lane + rd), 0.0, 2.0 * lead + lane, lane);
            let bay = (-rd, -ld, 0.0, 0.0);
            (area, bay, pi, true)
        }
        _ => {
            let lane = sh.lane_width_m(v);
            let (lg, rg) = (p.ngang_length_m(v), p.ngang_width_m(v));
            // "ô đỗ lõm vào lề bên phải của đường": recessed into the road's right edge. The car
            // drives past it and reverses back in, so the road runs on past the bay far enough to
            // line the car up again.
            let area = (-2.0 * lead, 0.0, lg + 3.0 * lane, lane);
            let bay = (0.0, -rg, lg, 0.0);
            (area, bay, 0.0, false)
        }
    };
    let lane_half = 0.5 * (area.3 - area.1);
    let mid_y = 0.5 * (area.1 + area.3);

    // Every painted limit line, one polyline each, so the episode count means what it says: the bay's
    // three closed sides are ONE line (dragging round the bay is one mistake), and each painted edge
    // of the area is its own. Nothing is painted across the bay's mouth.
    let mut lines = vec![
        painted(1, half_line, vec![(bay.0, 0.0), (bay.0, bay.1), (bay.2, bay.1), (bay.2, 0.0)]),
        // The edge of the road/lane away from the bay, and the near edge in two pieces round the bay.
        painted(1, half_line, vec![(area.0, area.3), (area.2, area.3)]),
        painted(1, half_line, vec![(area.0, 0.0), (bay.0, 0.0)]),
        painted(1, half_line, vec![(bay.2, 0.0), (area.2, 0.0)]),
    ];
    // Bài 7's far end is "bó vỉa đóng kín" — a closed curbed end — so it is drawn as a limit line.
    // Bài 8's road runs on in both directions, so its ends are not lines: a car that leaves the drawn
    // road is caught by SAI_HINH, which is measured on the rectangles, not on the paint.
    if figure == Figure::GhepDoc {
        lines.push(painted(1, half_line, vec![(area.0, 0.0), (area.0, area.3)]));
    }

    // Curb bands, `line_curb_setback_m` outside the limit lines: the bay's three closed sides, the
    // far side of the lane, the near side either side of the bay, and bài 7's closed end. A wheel up
    // on any of them is the shared SH.X.VIA_HE.
    let off = sh.line_curb_setback_m + 0.5 * CURB_WIDTH_M;
    let curb_half = 0.5 * CURB_WIDTH_M;
    let mut curbs = vec![
        painted(2, curb_half, vec![
            (bay.0 - off, 0.0),
            (bay.0 - off, bay.1 - off),
            (bay.2 + off, bay.1 - off),
            (bay.2 + off, 0.0),
        ]),
        painted(2, curb_half, vec![(area.0, area.3 + off), (area.2, area.3 + off)]),
        painted(2, curb_half, vec![(area.0, -off), (bay.0 - off, -off)]),
        painted(2, curb_half, vec![(bay.2 + off, -off), (area.2, -off)]),
    ];
    if figure == Figure::GhepDoc {
        curbs.push(painted(2, curb_half, vec![(area.0 - off, -off), (area.0 - off, area.3 + off)]));
    }
    lines.extend(curbs);

    let gates = vec![
        gate_across((0.0, mid_y), heading, lane_half + 0.5, Gate::Entry),
        // The bay's mouth, so the page can draw the line the car has to reverse through.
        GateLine { kind: Gate::BayMouth, a: (bay.0, 0.0), b: (bay.2, 0.0) },
    ];

    // The driving axis along the middle of the lane: the car's guide, and what the page's path cue
    // reads. SAI_HINH does not use it — the two rectangles are what the law describes — so it is free
    // to be the simple line the learner actually drives.
    // The driving axis, starting `lead` inside the approach end.
    let centre = if approach_negative {
        vec![(area.2 - lead, mid_y), (area.0, mid_y)]
    } else {
        vec![(area.0 + lead, mid_y), (area.2, mid_y)]
    };
    let total = centre_length_of(&centre);
    let start = centre[0];
    let mut built = course_from(
        rs,
        figure,
        centre,
        lines,
        gates,
        vec![(0.0, total)],
        None,
        StartPose {
            x: start.0,
            y: mid_y,
            heading,
            half_lane_m: lane_half,
            entry_m: 0.0,
            exit_m: total,
        },
    );
    built.park = Some(ParkBay { area, bay, gate_x: 0.0, approach_negative });
    Some(built)
}

// ---------------------------------------------------------------------------------------------
// The straight-road scene of bài 2, 9 and 11, and bài 5's junction route.
//
// These are figures like the two above — one centreline, its limit lines, a few markings — so the
// lane drawing and the wheel contact model are reused rather than reinvented. The difference from
// bài 4 and bài 6 is what the exercise asks: nothing here is about touching a line (except bài 5's
// SAI_VACH_KE), so the markings are records to draw, not boundaries to score against.
// ---------------------------------------------------------------------------------------------

/// A band across the lane, centred on `x`, `width_m` deep, `reach` metres either side of the
/// centreline.
fn across(a: (f64, f64), b: (f64, f64), x: f64, width_m: f64, reach: f64, line_id: u8) -> Vec<Mark> {
    let (dx, dy) = ((b.0 - a.0), (b.1 - a.1));
    let len = sqrt(dx * dx + dy * dy);
    if len == 0.0 {
        return Vec::new();
    }
    let (ux, uy) = (dx / len, dy / len);
    let (nx, ny) = (-uy, ux);
    let p = (a.0 + ux * x, a.1 + uy * x);
    let half = 0.5 * width_m;
    let (p0, p1) = ((p.0 - ux * half, p.1 - uy * half), (p.0 + ux * half, p.1 + uy * half));
    vec![Mark {
        line_id,
        a: (p0.0 - nx * reach, p0.1 - ny * reach),
        b: (p1.0 + nx * reach, p1.1 + ny * reach),
    }]
}

/// A zebra crossing at `x` past the scene origin: stripes run across the lane, the crossing itself
/// is `width_m` deep along it.
fn crosswalk(
    a: (f64, f64),
    b: (f64, f64),
    x: f64,
    width_m: f64,
    stripe_m: f64,
    gap_m: f64,
    road: &crate::rules::Road,
) -> Vec<Mark> {
    let (dx, dy) = ((b.0 - a.0), (b.1 - a.1));
    let len = sqrt(dx * dx + dy * dy);
    if len == 0.0 {
        return Vec::new();
    }
    let (ux, uy) = (dx / len, dy / len);
    let (nx, ny) = (-uy, ux);
    let p = (a.0 + ux * x, a.1 + uy * x);
    let half_w = 0.5 * road.lane_width_m;
    let mut out = Vec::new();
    let mut across_m = -half_w;
    while across_m + stripe_m <= half_w + 1e-9 {
        let (q0, q1) = (across_m, across_m + stripe_m);
        out.push(Mark {
            line_id: 3,
            a: (p.0 + nx * q0 - ux * 0.5 * width_m, p.1 + ny * q0 - uy * 0.5 * width_m),
            b: (p.0 + nx * q1 + ux * 0.5 * width_m, p.1 + ny * q1 + uy * 0.5 * width_m),
        });
        across_m += stripe_m + gap_m;
    }
    out
}

/// Bài 2, bài 9 and bài 11: one straight lane, the stop line at 0, and one thing past it.
///
/// The car starts on the lane's centreline, pointing along it. The second gate of the figure is the
/// exercise's own end line, so `sim_course` can draw where the run stops.
fn road_figure(rs: &Ruleset, figure: Figure) -> Option<Course> {
    let r = &rs.road;
    let sh = &rs.sa_hinh;
    let half = 0.5 * r.lane_width_m;
    let half_line = 0.5 * r.stop_line_width_m;
    // The scene runs from the start to past the last marking, so nothing is drawn off it.
    let end_m = match figure {
        Figure::Crosswalk => r.crosswalk_m() + r.crosswalk_width_m + r.run_end_past_line_m,
        Figure::Rail => r.rail_m() + r.rail_gauge_m + r.rail_offset_m,
        _ => r.finish_m() + r.run_end_past_line_m,
    };

    let mut p = Path::new((0.0, 0.0));
    p.line_to((end_m, 0.0));
    let centre = p.points;

    let mut lines = vec![
        painted(1, 0.5 * sh.line_width_m, vec![(0.0, half), (end_m, half)]),
        painted(1, 0.5 * sh.line_width_m, vec![(0.0, -half), (end_m, -half)]),
    ];
    lines.extend(curbs(&centre, half, sh));

    let mut marks = Vec::new();
    let a = (0.0, 0.0);
    let b = (end_m, 0.0);
    marks.extend(across(a, b, r.stop_line_m(), r.stop_line_width_m, half, 1));
    let mut signal = None;
    match figure {
        Figure::Crosswalk => {
            marks.extend(crosswalk(
                a,
                b,
                r.crosswalk_m(),
                r.crosswalk_width_m,
                r.crosswalk_stripe_width_m,
                r.crosswalk_stripe_gap_m,
                r,
            ));
            // The sign leans over the right-hand limit line, as on Hình 8.
            signal = Some((r.crosswalk_m(), -half - 0.5));
        }
        Figure::Rail => {
            let rail0 = r.rail_m();
            for k in 0..2 {
                let x = rail0 + f64::from(k) * r.rail_gauge_m;
                marks.extend(across(a, b, x, r.rail_width_m, half, 4));
            }
            signal = Some((rail0, -half - 0.5));
        }
        _ => {}
    }
    if figure == Figure::Finish {
        marks.extend(across(a, b, r.finish_m(), r.stop_line_width_m, half, 2));
    }

    let mut built = course_from(
        rs,
        figure,
        centre,
        lines,
        Vec::new(),
        Vec::new(),
        None,
        StartPose {
            x: 0.0,
            y: 0.0,
            heading: 0.0,
            half_lane_m: half,
            entry_m: 0.0,
            exit_m: end_m,
        },
    );
    built.marks = marks;
    built.signal = signal;
    let _ = half_line;
    Some(built)
}

/// Bài 5 — Qua ngã tư có tín hiệu điều khiển giao thông (Hình 11), right turn only.
///
/// The frame: `+x` down the approach lane, `+y` to its left, so the approach lane's right-hand
/// limit line is at `-half`. Straight approach to the stop line, the crosswalk, then a quarter arc
/// to the right, and out along the exit lane — which runs on in `-y`, the heading the arc leaves the
/// car on, not sideways in `+x`. The arc's radius comes from the car's own tightest turn
/// (`SaHinh::corner_radius_m`, the same rule as bài 4's bends), so the route is always drivable;
/// `course.junction.arc_radius_m` overrides it when a real yard's radius is known.
///
/// The exit lane is the mirror of the approach: it is entered at `x = arc_x` on the approach lane's
/// right-hand line, so the turn is a lane-to-lane right turn and the two lanes are one road width
/// apart, not overlapping.
fn junction_figure(rs: &Ruleset) -> Option<Course> {
    let j = &rs.junction;
    let r = &rs.road;
    let v = &rs.vehicle;
    let sh = &rs.sa_hinh;
    let half = 0.5 * r.lane_width_m;
    let half_line = 0.5 * sh.line_width_m;
    let line_x = j.stop_line_m();
    // The arc leaves the approach lane where the crosswalk ends, so a car stopped at the line is
    // never already turning.
    let arc_x = line_x + j.crosswalk_offset_m + j.crosswalk_width_m;
    let radius = if j.arc_radius_m > 0.0 {
        j.arc_radius_m
    } else {
        sh.corner_radius_m(v, 2.0 * j.extent_m)
    };
    // The arc's centre is `radius` to the right of where the arc starts, so a quarter turn to the
    // right carries the car `radius` outboard: the exit lane's centreline is at `arc_x + radius`,
    // and it runs on in −y — the heading the arc leaves the car on.
    let centre_pt = (arc_x, -radius);
    let half_pi = 0.5 * core::f64::consts::PI;
    let exit_x = arc_x + radius;
    let exit_end_y = -(radius + j.extent_m);

    let mut p = Path::new((0.0, 0.0));
    p.line_to((arc_x, 0.0));
    p.arc(centre_pt, radius, half_pi, -half_pi, sh.max_segment_m);
    p.line_to((exit_x, exit_end_y));
    let centre = p.points;

    let mut lines = vec![
        painted(1, half_line, offset_path(&centre, half)),
        painted(1, half_line, offset_path(&centre, -half)),
    ];
    lines.extend(curbs(&centre, half, sh));

    // The rest of the crossroads, so the picture reads as a junction and not as a bend: the cross
    // street's other two lane edges, running along −y on the far side of the exit lane, and the far
    // side of the junction across the approach. They are boundary lines like the route's own, so a
    // wheel on them is SAI_VACH_KE; none of them is on the route.
    // The cross street's far kerb line runs along −y on the far side of the exit lane, and the far
    // side of the junction runs across the approach: neither may cross the route, or the route's
    // own width would be bounded twice and a car in the middle of the lane would be "on a line".
    let cross_x = exit_x + r.lane_width_m;
    lines.push(painted(1, half_line, vec![(cross_x, -radius + half), (cross_x, exit_end_y)]));
    let far_y = -(radius + r.lane_width_m);
    lines.push(painted(1, half_line, vec![(-j.extent_m, far_y), (exit_x - half, far_y)]));

    let mut marks: Vec<Mark> = Vec::new();
    marks.extend(across((0.0, 0.0), (arc_x, 0.0), line_x, r.stop_line_width_m, half, 1));
    marks.extend(crosswalk(
        (0.0, 0.0),
        (arc_x, 0.0),
        line_x + j.crosswalk_offset_m + 0.5 * j.crosswalk_width_m,
        j.crosswalk_width_m,
        r.crosswalk_stripe_width_m,
        r.crosswalk_stripe_gap_m,
        r,
    ));
    // "Vạch kết thúc ngã tư": the end of the exercise, across the exit lane a little before its
    // end, so the car crosses it and still has road to stop on.
    marks.extend(across((exit_x, -1.0), (exit_x, -2.0), -exit_end_y, r.stop_line_width_m, half, 2));

    let total = centre_length_of(&centre);
    let mut built = course_from(
        rs,
        Figure::Junction,
        centre,
        lines,
        Vec::new(),
        Vec::new(),
        None,
        StartPose {
            x: 0.0,
            y: 0.0,
            heading: 0.0,
            half_lane_m: half,
            entry_m: line_x,
            exit_m: total - 2.0,
        },
    );
    built.marks = marks;
    built.signal = Some((line_x, -half - 0.5));
    built.arc_start_m = Some(arc_x);
    Some(built)
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
    /// The four corners of the car's hull — the rectangle `a × b` the law measures bay sizes from.
    /// `wheel_centres` places the axles; this is the body, whose containment inside the bay is what
    /// the finish signal is judged on.
    pub fn hull_corners(&self, rs: &Ruleset, x: f64, y: f64, heading: f64) -> [(f64, f64); 4] {
        let v = &rs.vehicle;
        let (ha, hb) = (0.5 * v.length_m, 0.5 * v.width_m);
        let c = cos(heading);
        let s = sin(heading);
        let local = [(-ha, -hb), (-ha, hb), (ha, hb), (ha, -hb)];
        let mut out = [(0.0, 0.0); 4];
        for (i, (lx, ly)) in local.into_iter().enumerate() {
            out[i] = (x + lx * c - ly * s, y + lx * s + ly * c);
        }
        out
    }

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
