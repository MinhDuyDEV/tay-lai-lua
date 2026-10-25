// The class-B sa hình yard as plain data, for the bench: 11 exercise shapes, each with its lines, curbs,
// cones, signs and lights. It is the load, not the product's course generator: dimensions follow
// QCVN 15:2026 for the smallest class-B car (a 4.2 m, b 1.6 m, Rqv 4.9 m; docs/legal/qcvn-15-2026-hinh-ve.md,
// "Ví dụ tính"), laid out in a grid so the whole yard is one scene. Coordinates are three's: (x, z).

export type Pt = readonly [number, number];
export interface Line {
  /** Width in metres: 0.1 for the white limit line, wider for stop lines, zebra bars, sleepers. */
  w: number;
  pts: Pt[];
}
export interface Sign {
  at: Pt;
  colour: string;
}
export interface Exercise {
  name: string;
  lines: Line[];
  /** Curb outlines (bó vỉa, 0.15 m high), cut into short instanced pieces by the scene. */
  curbs: Pt[][];
  /** Cọc chuẩn, 1.6 m. */
  cones: Pt[];
  signs: Sign[];
  /** Traffic-light poles (each is a pole and three lamps). */
  lights: Pt[];
}

const A = 4.2;
const B = 1.6;
const RQV = 4.9;
const LANE = 3.5;
/** One cell of the grid: the room an exercise gets. */
export const CELL_W = 110;
export const CELL_H = 40;
const COLS = 3;

class Cell implements Exercise {
  lines: Line[] = [];
  curbs: Pt[][] = [];
  cones: Pt[] = [];
  signs: Sign[] = [];
  lights: Pt[] = [];
  name: string;
  x: number;
  z: number;
  constructor(name: string, x: number, z: number) {
    this.name = name;
    this.x = x;
    this.z = z;
  }
  /** Local (x, z) to the yard. */
  p = (x: number, z: number): Pt => [this.x + x, this.z + z];
  line(w: number, ...pts: Array<[number, number]>) {
    this.lines.push({ w, pts: pts.map(([x, z]) => this.p(x, z)) });
  }
  curb(...pts: Array<[number, number]>) {
    this.curbs.push(pts.map(([x, z]) => this.p(x, z)));
  }
  rect(x0: number, z0: number, x1: number, z1: number, curb = false) {
    const ring: Array<[number, number]> = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
    if (curb) this.curb(...ring);
    else this.line(0.1, ...ring);
  }
  arc(cx: number, cz: number, r: number, a0: number, a1: number, curb: boolean, n = 32) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i += 1) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    if (curb) this.curb(...pts);
    else this.line(0.1, ...pts);
  }
  dashes(x0: number, x1: number, z: number) {
    for (let x = x0; x + 3 <= x1; x += 6) this.line(0.1, [x, z], [x + 3, z]);
  }
  /** A straight two-lane road along x, with limit lines, curbs and a dashed centre. */
  road(x0: number, x1: number) {
    for (const z of [-LANE, LANE]) {
      this.line(0.1, [x0, z], [x1, z]);
      this.curb([x0, z * 1.06], [x1, z * 1.06]);
    }
    this.dashes(x0, x1, 0);
  }
  /** A bar across the right-hand lane (z from 0 to LANE), like a stop line or one zebra stripe. */
  bar(x: number, w: number) {
    this.line(w, [x, 0], [x, LANE]);
  }
  zebra(x0: number, n: number) {
    for (let i = 0; i < n; i += 1) this.bar(x0 + i * 0.9, 0.45);
  }
  sign(x: number, z: number, colour: string) {
    this.signs.push({ at: this.p(x, z), colour });
  }
}

/** The 11 class-B exercises, in the order of the course. */
export function buildYard(): Exercise[] {
  const names = [
    'xuất phát / kết thúc',
    'dừng nhường người đi bộ',
    'dốc',
    'vệt bánh xe',
    'đường vuông góc',
    'ngã tư',
    'quanh co',
    'ghép dọc',
    'ghép ngang',
    'đường sắt',
    'đổi số',
  ];
  const cells = names.map((name, i) => new Cell(name, (i % COLS) * CELL_W - 10, Math.floor(i / COLS) * CELL_H));
  const [start, ped, hill, track, right, cross, s, par, perp, rail, gear] = cells;

  start.road(0, 60);
  start.bar(10, 0.4);
  start.bar(50, 0.4);

  ped.road(0, 60);
  ped.bar(20, 0.4);
  ped.zebra(22, 8);
  ped.sign(19, LANE + 1, '#d33');
  ped.sign(23, -LANE - 1, '#2a6bd3');

  hill.road(0, 60);
  hill.bar(6, 0.4);
  for (const x of [10, 25, 35]) hill.bar(x, 0.15);
  hill.sign(5, LANE + 1, '#d33');
  hill.sign(24, LANE + 1, '#e8b020');
  hill.sign(36, -LANE - 1, '#e8b020');

  // Vệt bánh xe (Bvb = B1 + 0.2 ≈ 0.4 m, Lvb = a) and, after it, the square-corner lane.
  track.line(0.1, [0, 1.0], [A, 1.0]);
  track.line(0.1, [0, 1.4], [A, 1.4]);
  track.rect(-1, -3, A + 1, 3);
  track.rect(-1.2, -3.2, A + 1.2, 3.2, true);
  for (const [x, z] of [[-1, -3], [A + 1, -3], [A + 1, 3], [-1, 3]] as const) track.cones.push(track.p(x, z));

  // Đường vuông góc: Sv = 1.5a, Lv = 2.0a, Bv = 2.2b.
  const bv = 2.2 * B;
  right.rect(0, 0, 2 * A, bv);
  right.rect(2 * A - bv, -1.5 * A, 2 * A, bv);
  right.rect(-0.2, -0.2, 2 * A + 0.2, bv + 0.2, true);
  right.rect(2 * A - bv - 0.2, -1.5 * A - 0.2, 2 * A + 0.2, 0, true);
  right.sign(-1, -1, '#2a6bd3');

  // Ngã tư: two two-way roads crossing, 4 stop lines, 4 zebra crossings of 7 bars, 4 lights, 12 signs.
  for (const z of [-LANE, LANE]) {
    cross.line(0.1, [0, z], [32, z]);
    cross.line(0.1, [48, z], [80, z]);
    cross.curb([0, z * 1.06], [32, z * 1.06]);
    cross.curb([48, z * 1.06], [80, z * 1.06]);
  }
  cross.dashes(0, 32, 0);
  cross.dashes(48, 80, 0);
  for (const sx of [-1, 1]) {
    for (const z of [-1, 1]) {
      cross.line(0.1, [40 + sx * LANE, z * 4], [40 + sx * LANE, z * 20]);
      cross.curb([40 + sx * LANE * 1.06, z * 4], [40 + sx * LANE * 1.06, z * 20]);
    }
    cross.line(0.4, [40 + sx * 10, 0], [40 + sx * 10, sx * LANE]);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i += 1) {
      cross.line(0.45, [40 + side * 12 + i * 0.9 * side, -LANE], [40 + side * 12 + i * 0.9 * side, LANE]);
      cross.line(0.45, [40 - LANE, side * 12 + i * 0.9 * side], [40 + LANE, side * 12 + i * 0.9 * side]);
    }
    cross.lights.push(cross.p(40 + side * (LANE + 1), side * (LANE + 1)));
    cross.lights.push(cross.p(40 + side * (LANE + 1), -side * (LANE + 1)));
    cross.arc(40 + side * (LANE + 3), side * (LANE + 3), 3, side > 0 ? Math.PI : 0, side > 0 ? 1.5 * Math.PI : 0.5 * Math.PI, true, 12);
    for (const k of [0, 1, 2]) cross.sign(40 + side * (LANE + 2 + k), (k % 2 ? 1 : -1) * (LANE + 1.5), ['#2a6bd3', '#e8b020', '#d33'][k]);
  }

  // Quanh co: two half circles, Rn = Rqv + 1.2, Bqc = 2.2b, centres on a 45° line.
  const rn = RQV + 1.2;
  const rtr = rn - 2.2 * B;
  const o2 = (rn + rtr) / Math.SQRT2;
  s.arc(0, 0, rn, -Math.PI / 2, Math.PI / 2, true, 48);
  s.arc(0, 0, rtr, -Math.PI / 2, Math.PI / 2, false, 48);
  s.arc(o2, o2, rn, Math.PI / 2, 1.5 * Math.PI, true, 48);
  s.arc(o2, o2, rtr, Math.PI / 2, 1.5 * Math.PI, false, 48);

  // Ghép dọc: Ld = a + 1.0, Rd = b + 0.6, Ed = 1.2a.
  const ed = 1.2 * A;
  par.rect(-ed, 0, ed, ed, true);
  par.rect(-(A + 1) / 2, -(B + 0.6), (A + 1) / 2, 0);
  for (const [x, z] of [[-(A + 1) / 2, -(B + 0.6)], [(A + 1) / 2, -(B + 0.6)]] as const) par.cones.push(par.p(x, z));
  par.sign(-ed, -1, '#2a6bd3');

  // Ghép ngang: Lg = 3a/2, Rg = 5b/4, set into the side of a road.
  perp.road(0, 40);
  perp.rect(10, -LANE - 1.25 * B, 10 + 1.5 * A, -LANE);
  perp.curb([10 - 0.2, -LANE * 1.06], [10 - 0.2, -LANE - 1.25 * B - 0.2], [10 + 1.5 * A + 0.2, -LANE - 1.25 * B - 0.2], [10 + 1.5 * A + 0.2, -LANE * 1.06]);
  perp.sign(9, -LANE - 1.5, '#2a6bd3');

  // Đường sắt: two rails across the road, sleepers, a stop line 5 m before the rail.
  rail.road(0, 60);
  rail.line(0.15, [30, -LANE], [30, LANE]);
  rail.line(0.15, [31.4, -LANE], [31.4, LANE]);
  for (let i = 0; i < 12; i += 1) rail.line(0.3, [29.6 + i * 0.3, -LANE], [29.6 + i * 0.3, LANE]);
  rail.bar(25, 0.4);
  for (const k of [0, 1, 2]) rail.sign(24 - k * 0.5, LANE + 1, ['#e8b020', '#e8b020', '#d33'][k]);

  // Đổi số: a straight of at least 100 m with five signs at 0, 25 and 50 m from the first.
  gear.road(0, 100);
  for (const x of [20, 45, 70]) gear.sign(x, LANE + 1, '#e8b020');
  gear.sign(45, -LANE - 1, '#2a6bd3');
  gear.sign(70, -LANE - 1, '#d33');

  return cells;
}

/** What the yard holds, for a cell's header. */
export function yardCounts(yard: Exercise[]) {
  const sum = (f: (e: Exercise) => number) => yard.reduce((n, e) => n + f(e), 0);
  const segs = (pts: Pt[]) => Math.max(0, pts.length - 1);
  return {
    exercises: yard.length,
    lineSegments: sum((e) => e.lines.reduce((n, l) => n + segs(l.pts), 0)),
    curbSegments: sum((e) => e.curbs.reduce((n, c) => n + segs(c), 0)),
    cones: sum((e) => e.cones.length),
    signs: sum((e) => e.signs.length),
    lights: sum((e) => e.lights.length),
  };
}
