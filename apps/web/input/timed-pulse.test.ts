// A timed pulse is the one claim the park pages' bar makes: let go of the pedals, count `holdMs`, press, and
// the car has moved the distance the plan asked for. It is checked on the real core with the keyboard driver,
// so a change to the gear ratio, the clutch feel or the brake that moves the car differently fails here and
// not in a learner's hands. The learner is TRACK_S late on the count, as the cue assumes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { holdMsFor, TRACK_S } from '../src/ghep.ts';
import { openSession, seedWord } from '../src/sim/session.ts';
import { createDriver } from './driver.ts';
import { ruleset } from './park-model.ts';

const wasm = readFileSync(new URL('../../../build/sim.wasm', import.meta.url));

function moved(dir: 1 | -1, distM: number): number {
  const session = openSession(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength), seedWord(8));
  const driver = createDriver();
  let s = session.state;
  const step = (held: string[], pressed: string[] = []) => {
    s = session.step(driver.step(new Set(held), pressed, { speedMps: s.speedMps, engineOn: s.engineOn })).state;
  };
  const down = ['Space', 'ArrowDown'];
  for (let i = 0; i < 60; i++) step(down);
  step(down, [dir === 1 ? 'Digit1' : 'KeyR']);
  for (let i = 0; i < 30; i++) step(down);
  step(down, ['KeyP']);
  for (let i = 0; i < 30; i++) step(down);
  const [x0, y0] = [s.carX, s.carY];
  const ticks = Math.round(((holdMsFor(distM, dir, ruleset) / 1000 + TRACK_S) * 60));
  for (let i = 0; i < ticks; i++) step([]);
  for (let i = 0; i < 300 && !(i > 10 && Math.abs(s.speedMps) < 0.01); i++) step(down);
  session.dispose();
  return Math.hypot(s.carX - x0, s.carY - y0);
}

test('a timed pulse moves the car the distance it was timed for, within ten centimetres', () => {
  const off: string[] = [];
  for (const [dir, d] of [[-1, 0.3], [-1, 0.8], [1, 0.5], [1, 1.5]] as const) {
    const got = moved(dir, d);
    if (Math.abs(got - d) > 0.1) off.push(`${dir > 0 ? 'forward' : 'reverse'} ${d} m moved ${got.toFixed(2)} m`);
  }
  assert.deepEqual(off, []);
});
