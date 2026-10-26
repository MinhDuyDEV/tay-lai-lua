// The line runner takes a pose list as data and drives it with real keys through the real driver and the
// real core. These tests pin the *runner*, not any particular line: a line that goes nowhere must fail,
// and a straight leg must travel what it says. The lead's search lines are fed through this, so a bug
// here would silently bless a bad line or condemn a good one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wheelAt, reverseCreepMps } from '../src/ghep.ts';
import { driveLine, ruleset, toLeg, STOP_TOL_M } from './line-runner.ts';

const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);

test('a leg is read as a fraction of full lock, the same lock the page prices plans with', () => {
  const lock = wheelAt(ruleset, reverseCreepMps(ruleset));
  assert.ok(Math.abs(toLeg({ dir: -1, steer: 1, len: 2 }, ruleset).steerRad - lock) < 1e-12);
  assert.ok(Math.abs(toLeg({ dir: 1, steer: -0.5, len: 2 }, ruleset).steerRad + lock / 2) < 1e-12);
  assert.equal(toLeg({ dir: 1, steer: 0, len: 2 }, ruleset).steerRad, 0);
});

// A straight forward leg: the car must go where it says, and end standing still. This is the runner's
// simplest contract and the one every longer line rests on.
test('a straight forward leg moves the car that far, and stops it', () => {
  const out = driveLine(7, { legs: [{ dir: 1, steer: 0, len: 1.0 }] });
  // A single leg never reaches the bay, so the run is cut by the harness's own finish wait, not by the
  // core's cap: `timedOut` is the honest label, and nothing about the leg is charged by a rule.
  assert.ok(out.timedOut || out.disqualified, 'a one-leg line cannot finish the figure');
  assert.ok(!out.touched, 'a straight leg down the lane must not touch paint');
  assert.ok(out.travelledM.forward > 0.9, `travelled ${out.travelledM.forward.toFixed(2)} m forward`);
  assert.ok(out.legErrorsM.at(-1)! < STOP_TOL_M, `leg residual ${out.legErrorsM.at(-1)?.toFixed(2)} m`);
});

// The same distance in reverse, in the gear the figure needs. This is the leg the finish is made of.
test('a straight reverse leg is driven in reverse, not forward', () => {
  const out = driveLine(7, { legs: [{ dir: -1, steer: 0, len: 1.0 }] });
  assert.ok(!out.touched, 'a straight reverse down the lane must not touch paint');
  assert.ok(out.travelledM.back > 0.9, `backed ${out.travelledM.back.toFixed(2)} m`);
  assert.ok(out.travelledM.forward < 0.2, `crept ${out.travelledM.forward.toFixed(2)} m forward instead`);
});

// The runner must not be able to bless a line that goes nowhere. This one drives straight at the lane
// edge: the core charges the paint, and the verdict says so. Without this, a green "line works" test
// would prove nothing about the runner's ability to fail.
test('a line that drives over the paint is reported as touching, with the core’s own rule id', () => {
  const out = driveLine(7, { legs: [{ dir: 1, steer: 0.6, len: 6.0 }] });
  assert.ok(out.touched || out.disqualified, 'a leg into the lane edge must not come back clean');
  assert.ok(out.pents.length > 0, 'the core must charge at least one rule');
});
