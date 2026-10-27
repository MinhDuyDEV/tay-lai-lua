// Can a keyboard learner finish bài 7 (ghép xe dọc) and bài 8 (ghép xe ngang) from what the page shows? The
// learner is `park-model.ts`:
//   * it reads ONLY what the page publishes: `data-cue` (arrow), `data-pedal` (pedal word), `data-gear-wanted`
//     and `data-hold-ms` (the time of a timed pulse), i.e. `cueGhep`'s steer, pedal, gear and hold; it never
//     reads the snapshot to decide;
//   * it polls every 50 ms, and when the reading has changed it acts REACTION ms later on THAT reading, even
//     if the line has moved on (a cue that comes late fails here); on a timed pulse it lets go, counts the
//     time and presses a quarter of a reaction late;
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

for (const lesson of [7, 8] as const) {
  test(`bài ${lesson}: the page alone brings a 150 / 300 / 400 ms reader to 100 and the finish signal, well inside the clock`, () => {
    const bad: string[] = [];
    for (const [react, phase] of CELLS) {
      const o = drivePark(lesson, react, phase, 150);
      console.log(`     bài ${lesson} react ${react} phase ${phase}: score ${o.score} signal ${o.signal} run ${o.runS.toFixed(0)} s [${o.pents}]`);
      if (!(o.score === 100 && o.signal && !o.disqualified && o.runS < CLOCK_S * 0.75)) {
        bad.push(`${react}/${phase}: ${o.score} ${o.signal ? 'signal' : 'no signal'} ${o.runS.toFixed(0)} s [${o.pents}]`);
      }
    }
    assert.deepEqual(bad, [], `cells that did not finish clean and early: ${bad.join(' | ')}`);
  });
}
