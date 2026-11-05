// TEMPORARY (removed by the S3 scope when the automatic learner models replace it): the S1 feasibility probe.
// Exploratory (S1 feasibility): bài 3 on an automatic, a keyboard learner who sees speed and the gap
// to the line and is late by `react` ms. node input/auto-hill-probe.ts [vLo vHi]
import { readFileSync } from 'node:fs';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, seedWord } from '../src/sim/session.ts';
import { createDriver } from './driver.ts';
const wasm = readFileSync(new URL('../../../build/sim.wasm', import.meta.url));
const bytes = () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
const ruleset = JSON.parse(readFileSync(new URL('../../../content/rulesets/tt108-2026.json', import.meta.url), 'utf8')) as Ruleset;
const codes = new Map<number, string>(((ruleset as any).rules as any[]).map((r) => [r.code, r.id]));

export function run(react: number, opts: { vLo: number; vHi: number; swap: number; tap: number; pulse?: number; hold: 'brake' | 'handbrake' | 'none'; auto?: boolean }) {
  const auto = opts.auto !== false;
  const session = openSession(bytes(), seedWord(3, 1n, auto));
  const driver = createDriver({ automatic: auto });
  let s = session.state;
  const lag = Math.round((react / 1000) * 60);
  const q: { at: number; held: Set<string>; pressed: string[] }[] = [];
  let held = new Set<string>();
  const ids: string[] = [];
  let rollMax = 0, maxRpm = 0, stalled = false, tick = 0, stopTick = -1, stopA = NaN;
  let slopeAt = -1; let setup = 0, lastP = -99, tapUntil = -1, waitUntil = -1;
  for (; tick < 60 * 90 && s.phase !== 'done' && !s.disqualified; tick++) {
    const want = new Set<string>();
    const pressed: string[] = [];
    if (tick % 3 === 0) {
      if (setup === 0) { pressed.push('KeyD'); setup = 1; }
      else if (setup === 1 && s.handbrake && tick - lastP > 40) { pressed.push('KeyP'); lastP = tick; }
      else if (setup === 1 && !s.handbrake) setup = 2;
      if (setup === 2 && s.phase !== 'stopped') {
        const v = s.speedMps;
        const brakeAt = 0.25 * v + (v * v) / (2 * 6.8) + Number(process.env.AT ?? 0.25);
        if (s.lineGapM <= brakeAt && v > 0.05) want.add('ArrowDown');
        else if (opts.pulse) { if (s.grade > 0 && slopeAt < 0) slopeAt = tick; if (slopeAt >= 0 && tick - slopeAt < opts.pulse) want.add('ArrowUp'); }
        else if (s.grade > 0 && (v < opts.vLo || (v < opts.vHi && held.has('ArrowUp')))) want.add('ArrowUp');
      } else if (s.phase === 'stopped') {
        if (stopTick < 0) { stopTick = tick; stopA = s.stopGapAM; }
        const since = tick - stopTick;
        if (since < 45) { if (opts.hold === 'brake') want.add('ArrowDown'); if (opts.hold === 'handbrake' && !s.handbrake && tick - lastP > 40) { pressed.push('KeyP'); lastP = tick; } }
        else {
          // launch: foot comes off the brake, then onto the throttle `swap` ms later
          if (opts.hold === 'handbrake' && s.handbrake && tick - lastP > 40) { pressed.push('KeyP'); lastP = tick; }
          if (opts.hold === 'brake' && since < 45 + Math.round(opts.swap / 16.7)) want.add('ArrowDown');
          if (since >= 45 + Math.round(opts.swap / 16.7)) want.add('ArrowUp');
        }
      }
      // what is decided now lands `lag` ticks later
      q.push({ at: tick + lag, held: want, pressed });
    }
    while (q.length && q[0].at <= tick) { const e = q.shift()!; held = e.held; for (const p of e.pressed) driverPress.push(p); }
    const input = driver.step(held, driverPress.splice(0), { speedMps: s.speedMps, engineOn: s.engineOn });
    const r = session.step(input);
    s = r.state;
    if (process.env.PT && tick % 15 === 0) console.log((tick/60).toFixed(2), 'v', s.speedMps.toFixed(2), 'gap', s.lineGapM.toFixed(2), 'rpm', s.rpm.toFixed(0), [...held].join(','), 'ph', s.phase);
    rollMax = Math.max(rollMax, s.rollbackM);
    maxRpm = Math.max(maxRpm, s.rpm);
    for (const e of r.events) { const id = codes.get(e.code) ?? String(e.code); ids.push(id); if (id.includes('CHET_MAY')) stalled = true; }
  }
  session.dispose();
  return { done: s.phase === 'done' && !s.disqualified, dq: s.disqualified, score: s.score, A: stopA, roll: rollMax, rpm: maxRpm, t: tick / 60, ids, stalled };
}
const driverPress: string[] = [];
// node input/auto-hill-probe.ts : the throttle is held `pulse` ticks from the foot of the slope, the brake comes
// from the gap; five reaction times x three ways of holding the car for the start.
if (process.argv[1].endsWith('auto-hill-probe.ts')) {
  for (const pulse of [75, 90]) for (const hold of ['brake', 'handbrake', 'none'] as const) {
    const row: string[] = [];
    for (const react of [100, 175, 250, 325, 400]) {
      const o = run(react, { vLo: 0, vHi: 0, swap: 0, tap: 0, pulse, hold });
      row.push(`${react}:${o.score}${o.done ? '' : 'x'} A${o.A.toFixed(2)} rb${o.roll.toFixed(2)}${o.ids.length ? '!' + o.ids.map((i) => i.slice(3)).join('+') : ''}`);
    }
    console.log(`pulse ${pulse} hold ${hold} |`, row.join(' | '));
  }
}
