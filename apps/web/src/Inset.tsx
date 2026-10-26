'use client';
// The top-down inset for bài 4 and bài 6: the figure, the car and its four wheels, drawn in 2D so a
// learner can see where each wheel is relative to the paint. The 3D chase camera is good for the road
// ahead and bad for exactly this question, which is the one these two exercises are scored on.
//
// It is a plain canvas painted from the run's frame hook, not React state, so 60 Hz costs no renders.
// The figure comes from the core's own polylines (`run.course`), the wheels from the snapshot, so the
// picture, the scoring and the advice line share one source.
//
// Placement: the inset lives in the HUD's own grid column (see `globals.css`, `.hud-inset`), so it
// cannot cover the advice line, the penalty panel or the pedal bars at any window size. It is not a
// floating overlay on purpose.

import { useEffect, useRef } from 'react';
import { holdPose, hull, hullInsideBay, type Yard } from './ghep.ts';
import type { Ruleset } from './ruleset.ts';
import type { Run } from './run.ts';

/** How many metres of road the inset shows, centred on the car. */
const SPAN_M = 16;

/** How many metres the park inset shows: the area plus a margin, so the whole yard is in view. */
function yardSpanM(yard: Yard): number {
  const w = yard.area[2] - yard.area[0];
  const h = yard.area[3] - yard.area[1];
  return Math.max(12, Math.min(30, Math.max(w, h) + 4));
}

/** Where the park inset is centred: the middle of the bay and the car, so both stay in frame. */
function yardCentre(yard: Yard, s: { carX: number; carY: number }): { x: number; y: number } {
  const bx = (yard.bay[0] + yard.bay[2]) / 2;
  const by = (yard.bay[1] + yard.bay[3]) / 2;
  return { x: (bx + s.carX) / 2, y: (by + s.carY) / 2 };
}
/** Wheel colours: clear, on a line, on a curb. */
const WHEEL = ['#dfe6ee', '#ffd24a', '#ff5d5d'] as const;

export default function Inset({ run, ruleset, yard }: { run: Run; ruleset: Ruleset; yard?: Yard | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const paint = () => {
      const s = run.state;
      const dpr = window.devicePixelRatio || 1;
      const cssW = el.clientWidth;
      const cssH = el.clientHeight;
      if (el.width !== Math.round(cssW * dpr) || el.height !== Math.round(cssH * dpr)) {
        el.width = Math.round(cssW * dpr);
        el.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      // The park figures show the whole yard at once: a bay is 6.3 m at most and the car has to be
      // seen against it, so the span is what is in view rather than a fixed window around the car.
      const spanM = yard ? yardSpanM(yard) : SPAN_M;
      const scale = Math.min(cssW, cssH) / spanM;
      // World -> canvas: x right, y up (the sim's +y is left of the direction of travel).
      const centre = yard ? yardCentre(yard, s) : { x: s.carX, y: s.carY };
      const cx = centre.x;
      const cy = centre.y;
      const px = (x: number) => cssW / 2 + (x - cx) * scale;
      const py = (y: number) => cssH / 2 - (y - cy) * scale;

      ctx.fillStyle = '#2b2f35';
      ctx.fillRect(0, 0, cssW, cssH);

      // The park yard first, so the car is drawn on top of it: the bay in a bolder line than the
      // area's walls, because the bay is what the exercise is scored on.
      if (yard) {
        const rect = (r: readonly [number, number, number, number], stroke: string, width: number, dash: number[]) => {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = width;
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.rect(px(r[0]), py(r[3]), (r[2] - r[0]) * scale, (r[3] - r[1]) * scale);
          ctx.stroke();
        };
        rect(yard.area, '#4d5a68', Math.max(1.5, 0.08 * scale), []);
        rect(yard.bay, '#5fd18a', Math.max(2, 0.12 * scale), []);
        // The parked pose the exercise scores, as a ghost outline: where the car has to end up.
        const hold = holdPose(yard);
        ctx.strokeStyle = 'rgba(95,209,138,0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        hull(hold, ruleset).forEach(([hx, hy], i) => (i === 0 ? ctx.moveTo(px(hx), py(hy)) : ctx.lineTo(px(hx), py(hy))));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Painted things, in the core's own order: limit lines, then curbs, then the vệt, then gates.
      for (const kind of [1, 2, 3, 4]) {
        for (const record of run.course) {
          if (record.kind !== kind) continue;
          ctx.strokeStyle = kind === 2 ? '#8a7a52' : kind === 3 ? '#f0c419' : kind === 4 ? '#5fd18a' : '#e8e8e8';
          ctx.lineWidth = kind === 4 ? 1.5 : kind === 2 ? Math.max(2, 0.15 * scale) : Math.max(1.5, 0.1 * scale);
          ctx.setLineDash(kind === 4 ? [5, 4] : []);
          ctx.beginPath();
          record.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(px(x), py(y)) : ctx.lineTo(px(x), py(y))));
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // The car: a box on its own heading, then the four wheels the snapshot reports, each in the
      // colour of what its patch is on.
      const h = s.heading;
      const cos = Math.cos(h);
      const sin = Math.sin(h);
      const carPoint = (lx: number, ly: number) => [px(cx + lx * cos - ly * sin), py(cy + lx * sin + ly * cos)] as const;
      const carHull = hull({ x: s.carX, y: s.carY, h: s.heading }, ruleset);
      ctx.strokeStyle = yard ? (hullInsideBay({ x: s.carX, y: s.carY, h: s.heading }, yard, ruleset) ? '#5fd18a' : '#7fb2ff') : '#7fb2ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [lx, ly] of [
        [2.1, 0.8],
        [2.1, -0.8],
        [-2.1, -0.8],
        [-2.1, 0.8],
      ]) {
        const [x, y] = carPoint(lx, ly);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      s.contact.forEach((code, i) => {
        const [x, y] = s.wheels[i];
        ctx.fillStyle = WHEEL[code];
        ctx.beginPath();
        ctx.arc(px(x), py(y), Math.max(3, 0.22 * scale), 0, Math.PI * 2);
        ctx.fill();
        if (code !== 0) {
          ctx.strokeStyle = '#1b1e22';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });

      // North is the direction of travel at the start, so a learner can tell which way is which.
      ctx.fillStyle = '#9aa6b2';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(yard ? 'nhìn từ trên xuống — ô xanh là nơi phải đỗ' : 'nhìn từ trên xuống', 8, cssH - 8);
      void carHull;
    };

    paint();
    return run.onFrame(paint);
  }, [run]);

  return (
    <section className="hud-inset" aria-label="Hình nhìn từ trên xuống">
      <h2>{yard ? 'Ô ghép xe' : 'Vị trí bánh xe'}</h2>
      <canvas ref={canvas} data-inset="yes" />
      <p className="legend">
        <span data-wheel="clear" /> trống
        <span data-wheel="line" /> đè vạch
        <span data-wheel="curb" /> bó vỉa
        {yard ? (
          <>
            <span data-wheel="bay" /> ô đỗ
          </>
        ) : null}
      </p>
    </section>
  );
}
