// Can a keyboard learner finish bài 7 (ghép xe dọc) and bài 8 (ghép xe ngang) from what the page shows? The
// learner is `park-model.ts`:
//   * it reads ONLY what the page publishes: `data-cue` (arrow), `data-pedal` (pedal word), `data-gear-wanted`
//     and `data-hold-ms` (the time of a timed pulse), i.e. `cueGhep`'s steer, pedal, gear and hold; it never
//     reads the snapshot to decide;
//   * it polls every 50 ms, and when the reading has changed it acts REACTION ms later on THAT reading, even
//     if the line has moved on (a cue that comes late fails here); on a timed pulse it lets go, and presses
//     when the bar says `now`, a full reaction + phase later (`trackFactor` 1: no anticipation is assumed), and
//     every action is a further +-40 ms late or early (people are not metronomes);
//   * REACTION is one of 150 / 300 / 400 ms, plus the poll's phase inside the 50 ms repaint (0 / 12 / 25 /
//     37 ms): 3 reactions x 4 phases = 12 cells per bay;
//   * it acts only through key events on the real driver (wheel winds at 2/s, pedal rises) and the real
//     sim.wasm; a cell passes when the core itself scored 100, gave the finish signal and charged nothing.
// The full 12 cells are `node input/park-sweep.ts 7|8` (a few minutes: one core, up to a minute per cell). This
// file runs three of them per bay, one per end and the middle of the reaction band: slow enough to catch a cue
// that assumes a fast reader or a planner that ignores the scatter between readers. Run `task build` first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drivePark } from './park-model.ts';

/** The clock the core charges QUA_THOI_GIAN at; a clean cell must also leave a wide margin under it. */
const CLOCK_S = 120;
const CELLS = [
  [150, 0],
  [300, 25],
  [400, 37],
] as const;

const clean = (o: ReturnType<typeof drivePark>) => o.score === 100 && o.signal && !o.disqualified && o.runS < CLOCK_S * 0.75;

for (const lesson of [7, 8] as const) {
  test(`bài ${lesson}: the page alone brings a 150 / 300 / 400 ms reader to 100 and the finish signal, well inside the clock`, () => {
    const bad: string[] = [];
    for (const [react, phase] of CELLS) {
      const o = drivePark(lesson, react, phase, 150);
      console.log(`     bài ${lesson} react ${react} phase ${phase}: score ${o.score} signal ${o.signal} run ${o.runS.toFixed(0)} s [${o.pents}]`);
      if (!clean(o)) {
        bad.push(`${react}/${phase}: ${o.score} ${o.signal ? 'signal' : 'no signal'} ${o.runS.toFixed(0)} s [${o.pents}]`);
      }
    }
    assert.deepEqual(bad, [], `cells that did not finish clean and early: ${bad.join(' | ')}`);
  });
}

// The gate has to be able to go red: two broken versions of the bar's lead must each fail a cell they fail today.
test('the gate is red when the lead is not calibrated, and when it is calibrated to the wrong reader', () => {
  const fixed = drivePark(8, 400, 25, 150, 1, { calibrate: false });
  assert.equal(clean(fixed), false, `fixed lead: ${fixed.score} ${fixed.signal} ${fixed.runS.toFixed(0)} s [${fixed.pents}]`);
  const wrong = drivePark(7, 400, 12, 150, 1, { forceLagS: 0.15 });
  assert.equal(clean(wrong), false, `lag 0.15 fed to a 400 ms reader: ${wrong.score} ${wrong.signal} ${wrong.runS.toFixed(0)} s [${wrong.pents}]`);
});
