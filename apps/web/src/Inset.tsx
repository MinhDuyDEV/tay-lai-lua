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
import type { Run } from './run.ts';

/** How many metres of road the inset shows, centred on the car. */
const SPAN_M = 16;
/** Wheel colours: clear, on a line, on a curb. */
const WHEEL = ['#dfe6ee', '#ffd24a', '#ff5d5d'] as const;

export default function Inset({ run }: { run: Run }) {
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

      const scale = Math.min(cssW, cssH) / SPAN_M;
      // World -> canvas: x right, y up (the sim's +y is left of the direction of travel).
      const cx = s.carX;
      const cy = s.carY;
      const px = (x: number) => cssW / 2 + (x - cx) * scale;
      const py = (y: number) => cssH / 2 - (y - cy) * scale;

      ctx.fillStyle = '#2b2f35';
      ctx.fillRect(0, 0, cssW, cssH);

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
      ctx.strokeStyle = '#7fb2ff';
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
      ctx.fillText('nhìn từ trên xuống', 8, cssH - 8);
    };

    paint();
    return run.onFrame(paint);
  }, [run]);

  return (
    <section className="hud-inset" aria-label="Hình nhìn từ trên xuống">
      <h2>Vị trí bánh xe</h2>
      <canvas ref={canvas} data-inset="yes" />
      <p className="legend">
        <span data-wheel="clear" /> trống
        <span data-wheel="line" /> đè vạch
        <span data-wheel="curb" /> bó vỉa
      </p>
    </section>
  );
}
