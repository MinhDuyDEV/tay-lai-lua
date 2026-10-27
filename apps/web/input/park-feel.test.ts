// Can a keyboard learner finish bài 7 (ghép xe dọc) from what the page shows? The learner is `park-model.ts`:
//   * it reads ONLY what the page publishes: `data-cue` (arrow), `data-pedal` (pedal word) and
//     `data-gear-wanted`, i.e. `cueGhep`'s steer, pedal and gear; it never reads the snapshot to decide;
//   * it polls every 50 ms, and when the reading has changed it acts REACTION ms later on THAT reading,
//     even if the line has moved on (a cue that comes late fails here);
//   * REACTION is one of 150 / 200 / 250 / 300 / 350 / 400 ms, plus the poll's phase inside the 50 ms
//     repaint (0 / 12 / 25 / 37 ms): 6 reactions x 4 phases = 24 cells per bay;
//   * it acts only through key events on the real driver (wheel winds at 2/s, pedal rises) and the real
//     sim.wasm; a cell passes when the core itself scored 100, gave the finish signal and charged nothing.
// The full 24 cells are `node input/park-sweep.ts 7` (about 15 minutes: one core, ~40 s per cell). This
// file runs three of them, one per end and the middle of the reaction band: slow enough to catch a cue
// that assumes a fast reader (READ_S 0.1) or a planner that ignores the scatter between readers (0).
// Bài 8 is `park-feel.pending.ts` until its cells are green. Run `task build` first.
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

test('bài 7: the page alone brings a 150 / 300 / 400 ms reader to 100 and the finish signal, well inside the clock', () => {
  const bad: string[] = [];
  for (const [react, phase] of CELLS) {
    const o = drivePark(7, react, phase, 150);
    console.log(`     bài 7 react ${react} phase ${phase}: score ${o.score} signal ${o.signal} run ${o.runS.toFixed(0)} s [${o.pents}]`);
    if (!(o.score === 100 && o.signal && !o.disqualified && o.runS < CLOCK_S * 0.75)) {
      bad.push(`${react}/${phase}: ${o.score} ${o.signal ? 'signal' : 'no signal'} ${o.runS.toFixed(0)} s [${o.pents}]`);
    }
  }
  assert.deepEqual(bad, [], `cells that did not finish clean and early: ${bad.join(' | ')}`);
});
