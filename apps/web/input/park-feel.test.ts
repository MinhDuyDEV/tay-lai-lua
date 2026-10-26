// Can a keyboard learner finish bài 7 and bài 8 by reading only what the page shows? Each cell is one
// run of the learner in `park-model.ts` (reads `data-cue` / `data-pedal` / `data-gear-wanted`, re-reads
// every 50 ms at a phase, every key change late by the reaction) on the real sim.wasm and the real driver.
// A cell passes when the core itself scored 100 and gave the finish signal. Run `task build` first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Lesson } from '../src/exercise.ts';
import { drivePark, REACT_MS } from './park-model.ts';

/** Poll phases inside one 50 ms repaint: the first, and one in the middle. */
const PHASES_MS = [0, 25] as const;

for (const lesson of [7, 8] as const satisfies readonly Lesson[]) {
  test(`bài ${lesson}: the page's own cue brings a ${REACT_MS.join('/')} ms reader to 100 and the signal`, () => {
    const bad: string[] = [];
    for (const react of REACT_MS) {
      for (const phase of PHASES_MS) {
        const o = drivePark(lesson, react, phase, 150);
        const ok = o.score === 100 && o.signal && !o.disqualified;
        console.log(
          `     bài ${lesson} react ${react} phase ${phase}: score ${o.score} signal ${o.signal} ` +
            `run ${o.runS.toFixed(0)} s [${o.pents.join(',')}]`,
        );
        if (!ok) bad.push(`${react}/${phase}: ${o.score} ${o.signal ? 'signal' : 'no signal'} [${o.pents}]`);
      }
    }
    assert.deepEqual(bad, [], `cells that did not finish clean: ${bad.join(' | ')}`);
  });
}
