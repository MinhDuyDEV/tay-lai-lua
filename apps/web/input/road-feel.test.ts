// Can a screen-only learner finish bài 2 (người đi bộ) and bài 9 (đường sắt) on an automatic? The
// learner is `road-model.ts`: it reads only what the page publishes — the advice line and the stop
// aid's countdown (`data-aid-*`) — creeps to the line, presses the brake when the bar says the key
// should land, and lets the car go again when the line says it has stopped inside A.
//
// The page's countdown is what a person with a reaction uses: they start moving when the countdown
// equals their reaction, so the key lands on the bar's mark. In the model that is a key that lands
// `reactMs` after it was read, at 150 / 300 / 400 ms, at four poll phases; every cell must score 100
// with A inside the law's window and nothing charged. The red control is the learner who instead
// reacts *after* the bar says "bấm ngay": at the flat road's creep 400 ms is 40 mm past the window,
// which is what makes the countdown, not the car, the thing that passes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driveRoad, PHASE_MS, REACT_MS } from './road-model.ts';
import { ruleset } from './road-model.ts';

const CELLS = REACT_MS.flatMap((react) => PHASE_MS.map((phase) => [react, phase] as const));
const clean = (o: ReturnType<typeof driveRoad>) => o.finished && !o.disqualified && o.score === 100 && o.pents.length === 0;

for (const lesson of [2, 9] as const) {
  test(`bài ${lesson} on an automatic: reading the countdown 150 / 300 / 400 ms out stops inside A and finishes with 100`, () => {
    const bad: string[] = [];
    let low = Infinity;
    let high = -Infinity;
    for (const [react, phase] of CELLS) {
      const o = driveRoad(lesson, react, phase, true);
      low = Math.min(low, o.stopA);
      high = Math.max(high, o.stopA);
      if (!clean(o) || o.stopA < 0 || o.stopA > ruleset.road!.max_a_m) {
        bad.push(`react ${react} phase ${phase}: score ${o.score} stopped ${o.finished} A ${o.stopA.toFixed(3)} [${o.pents}]`);
      }
    }
    console.log(`     bài ${lesson} auto: A ${low.toFixed(3)} to ${high.toFixed(3)} m of ${ruleset.road!.max_a_m} over ${CELLS.length} cells`);
    assert.deepEqual(bad, []);
  });
}

test('bài 2 on an automatic: a learner who reacts 400 ms after "bấm ngay" overshoots A, so the countdown is what passes', () => {
  const id = 'SH.02.QUA_VACH';
  const o = driveRoad(2, 400, 25, true, true);
  assert.equal(clean(o), false, 'the literal 400 ms reader finished clean, so the grid proves nothing about the countdown');
  assert.ok(o.pents.includes(id), `the overshoot was not charged ${id}: [${o.pents}]`);
  assert.ok(o.stopA < 0, `A ${o.stopA.toFixed(3)} is not past the line`);
});
