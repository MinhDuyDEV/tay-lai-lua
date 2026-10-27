// PENDING (bài 8): not in `pnpm test` (its glob is input/*.test.ts) until every cell is green.
//   node --test input/park-feel.pending.ts
// Same learner as park-feel.test.ts (page-only reader, 6 reactions x 4 poll phases at 50 ms). Rename to
// park-feel-8.test.ts once `node input/park-sweep.ts 8` is 24/24 with the slowest cell under 90 s.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drivePark, REACT_MS } from './park-model.ts';

const PHASES_MS = [0, 12, 25, 37] as const;

test(`bài 8: the page alone brings every ${REACT_MS.join('/')} ms reader to 100 and the signal`, () => {
  const bad: string[] = [];
  for (const react of REACT_MS) {
    for (const phase of PHASES_MS) {
      const o = drivePark(8, react, phase, 150);
      if (!(o.score === 100 && o.signal && !o.disqualified && o.runS < 90)) bad.push(`${react}/${phase}: ${o.score} ${o.signal ? 'signal' : 'no signal'} ${o.runS.toFixed(0)} s [${o.pents}]`);
    }
  }
  assert.deepEqual(bad, [], `cells that did not finish clean: ${bad.join(' | ')}`);
});
