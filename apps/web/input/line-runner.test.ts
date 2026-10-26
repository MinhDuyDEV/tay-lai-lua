// The line runner takes a pose list as data and drives it with real keys through the real driver and the
// real core. These pin the runner, because a bug here would bless a bad line or condemn a good one: it
// must land a leg where it says, it must say so when a line touches paint, and core's own clean bài 7
// recipe, replayed by keys, must come out 100 with the finish signal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { driveLine, lineOf, STOP_TOL_M, type PoseLeg } from './line-runner.ts';

const lines = JSON.parse(readFileSync(new URL('./lines/bay-lines.json', import.meta.url), 'utf8')) as Record<
  string,
  PoseLeg[]
>;
const ONE_LEG = { closeLast: false, finishWaitS: 0.1 } as const;

test('a straight leg of 2 m, forward or back, moves the car 2 m and stops it', () => {
  for (const dir of [1, -1] as const) {
    const out = driveLine(7, { legs: [{ dir, steer: 0, len: 2 }] }, ONE_LEG);
    const moved = dir === 1 ? out.travelledM.forward : out.travelledM.back;
    assert.ok(!out.touched, 'a straight leg down the lane must not touch paint');
    assert.ok(Math.abs(moved - 2) < 0.15, `dir ${dir}: moved ${moved.toFixed(2)} m of 2`);
    assert.ok(out.legErrorsM[0] < STOP_TOL_M, `dir ${dir}: residual ${out.legErrorsM[0].toFixed(2)} m`);
  }
});

// Without this a green replay would prove nothing about the runner's ability to fail.
test('a line that drives into the lane edge is reported as touching, with the core’s own rule id', () => {
  const out = driveLine(7, { legs: [{ dir: 1, steer: 0.6, len: 6 }] }, ONE_LEG);
  assert.ok(out.touched && out.pents.length > 0, `touched ${out.touched}, rules [${out.pents}]`);
});

test('core’s clean bài 7 recipe, replayed by keys, scores 100 with the finish signal', () => {
  const out = driveLine(7, lineOf(lines.ghep_doc));
  assert.ok(out.signal && out.score === 100 && !out.touched, `score ${out.score} signal ${out.signal} [${out.pents}]`);
});
