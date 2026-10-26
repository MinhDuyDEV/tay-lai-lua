//! TEMPORARY probe: reverse-entry feasibility for bài 7/8. Deleted before handback.
//!
//! The car model is the core's own: reference point at the centre, yaw rate v·tan(δ)/L, hull
//! 4.2 x 1.6. The search carries the direction of travel, so the bay can only be entered BACKWARDS
//! — which is what "Lùi để ghép xe vào nơi đỗ" asks for.
use std::collections::{HashMap, VecDeque};

const A: f64 = 4.2;
const B: f64 = 1.6;
const WB: f64 = 2.4;
const MAXSTEER: f64 = 0.55;

type Rect = (f64, f64, f64, f64);

#[derive(Clone)]
struct Bay {
    name: &'static str,
    free: Vec<Rect>,
    bay: Rect,
    start: (f64, f64, f64),
    /// Bay mouth: the bay edge the car must cross, and whether the car must be reversing when it
    /// first puts its hull inside the bay.
    reverse_only: bool,
}

fn hull(x: f64, y: f64, th: f64) -> [(f64, f64); 4] {
    let (c, s) = (th.cos(), th.sin());
    let mut out = [(0.0, 0.0); 4];
    for (i, (lx, ly)) in [(-0.5 * A, -0.5 * B), (-0.5 * A, 0.5 * B), (0.5 * A, 0.5 * B), (0.5 * A, -0.5 * B)]
        .into_iter()
        .enumerate()
    {
        out[i] = (x + lx * c - ly * s, y + lx * s + ly * c);
    }
    out
}

fn inside_rect(x: f64, y: f64, r: Rect) -> bool {
    x >= r.0 && x <= r.2 && y >= r.1 && y <= r.3
}

fn hull_in_bay(x: f64, y: f64, th: f64, r: Rect) -> bool {
    hull(x, y, th).iter().all(|p| inside_rect(p.0, p.1, r))
}

fn hull_in_free(x: f64, y: f64, th: f64, free: &[Rect]) -> bool {
    hull(x, y, th).iter().all(|p| free.iter().any(|r| inside_rect(p.0, p.1, *r)))
}

fn plan(bay: &Bay) -> Option<(Vec<(f64, f64, f64, f64)>, usize)> {
    let dth = 2.0f64.to_radians();
    let step = 0.10f64;
    // State: quantised pose + direction (+1 forward, -1 reverse, 0 still).
    let q = |x: f64, y: f64, th: f64, d: i64| -> (i64, i64, i64, i64) {
        ((x / 0.08).round() as i64, (y / 0.08).round() as i64, (th / dth).round() as i64, d)
    };
    let mut prev: HashMap<(i64, i64, i64, i64), ((i64, i64, i64, i64), f64, f64, f64, f64)> = HashMap::new();
    let mut queue = VecDeque::new();
    let k0 = q(bay.start.0, bay.start.1, bay.start.2, 0);
    prev.insert(k0, (k0, bay.start.0, bay.start.1, bay.start.2, 0.0));
    queue.push_back(k0);
    let locks = [-1.0f64, -0.5, 0.0, 0.5, 1.0];
    let mut expanded = 0usize;
    let mut found = None;
    while let Some(k) = queue.pop_front() {
        expanded += 1;
        if expanded > 3_000_000 {
            break;
        }
        let (_, x, y, th, _) = prev[&k];
        if hull_in_bay(x, y, th, bay.bay) && k.3 < 0 {
            found = Some(k);
            break;
        }
        for &lock in &locks {
            for dir in [-1i64, 1] {
                let delta = lock * MAXSTEER;
                let mut cx = x;
                let mut cy = y;
                let mut cth = th;
                let mut ok = true;
                let n = 2;
                let v = dir as f64;
                for _ in 0..n {
                    let yaw = v * delta.tan() / WB * (step / f64::from(n));
                    cth += yaw;
                    cx += v * cth.cos() * step / f64::from(n);
                    cy += v * cth.sin() * step / f64::from(n);
                    if !hull_in_free(cx, cy, cth, &bay.free) {
                        ok = false;
                        break;
                    }
                }
                if !ok {
                    continue;
                }
                let nk = q(cx, cy, cth, dir);
                if prev.contains_key(&nk) {
                    continue;
                }
                prev.insert(nk, (k, cx, cy, cth, 0.0));
                queue.push_back(nk);
            }
        }
    }
    found.map(|k| {
        let mut path = Vec::new();
        let mut cur = k;
        loop {
            let (p, x, y, th, _) = prev[&cur];
            path.push((x, y, th, cur.3 as f64));
            if p == cur {
                break;
            }
            cur = p;
        }
        path.reverse();
        (path, expanded)
    })
}

fn report(bay: Bay) {
    println!("=== {} free {:?} bay {:?}", bay.name, bay.free, bay.bay);
    match plan(&bay) {
        None => println!("  NO REVERSE PATH"),
        Some((path, expanded)) => {
            let (x, y, th, _) = *path.last().unwrap();
            let mut fwd = 0.0;
            let mut rev = 0.0;
            let mut shunts = 0;
            let mut last_dir = 0.0;
            for w in path.windows(2) {
                let d = ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
                if w[1].3 > 0.0 { fwd += d } else { rev += d }
                if last_dir != 0.0 && w[1].3 != last_dir { shunts += 1 }
                last_dir = w[1].3;
            }
            let end_yaw = th.to_degrees();
            println!(
                "  reverse path: {expanded} expanded, {} poses, end ({x:.2},{y:.2}) {end_yaw:+.1}°, fwd {fwd:.2} m, rev {rev:.2} m, {shunts} direction changes",
                path.len()
            );
            // Largest uniform shrink of the free space that still admits a reverse path.
            let mut lo = 0.0;
            let mut hi = 0.5;
            for _ in 0..6 {
                let mid = 0.5 * (lo + hi);
                let mut b2 = bay.clone();
                b2.free = bay.free.iter().map(|r| (r.0 + mid, r.1 + mid, r.2 - mid, r.3 - mid)).collect();
                if plan(&b2).is_some() { lo = mid } else { hi = mid }
            }
            println!("  slack: passable after shrinking the free space {lo:.3} m on every side");
        }
    }
}

fn main() {
    let (a, b) = (A, B);
    // bài 8 (ngang, Hình 14): parallel bay along the road's right edge. Road y in [0, 3.52]
    // (sa_hinh lane width 2.2b), bay y in [-2.0, 0], x in [0, 6.3].
    let (lg, rg) = (1.5 * a, 1.25 * b);
    report(Bay {
        name: "bai 8 ngang, bay along the road (Lg x Rg = 6.3 x 2.0)",
        free: vec![(-14.0, 0.0, 20.0, 2.2 * b), (0.0, -rg, lg, 0.0)],
        bay: (0.0, -rg, lg, 0.0),
        start: (-6.0, 0.5 * 2.2 * b, 0.0),
        reverse_only: true,
    });
    // bài 7 (dọc, Hình 13): the T. Lane y in [0, Ed=5.04] running along x, bay perpendicular below
    // the lane: x in [-Rd, 0], y in [-Ld, 0]. Lane closed Ed to the left of the bay, open to the
    // right.
    let (ld, rd, ed) = (a + 1.0, b + 0.6, 1.2 * a);
    report(Bay {
        name: "bai 7 doc, bay perpendicular under the lane (Ld x Rd = 5.2 x 2.2)",
        free: vec![(-rd - ed, 0.0, 20.0, ed), (-rd, -ld, 0.0, 0.0)],
        bay: (-rd, -ld, 0.0, 0.0),
        start: (4.0, 0.5 * ed, std::f64::consts::PI),
        reverse_only: true,
    });
}
