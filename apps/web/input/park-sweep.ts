// The park-feel sweep as a script, not a test: every reaction × poll phase of the page-only reader on
// bài 7 or bài 8, one line of results. Not in `pnpm test` (see park-feel.pending.ts for the assertions).
//   node apps/web/input/park-sweep.ts 7|8 [maxSeconds]
// Each cell is `react/phase:score` + `S` when the core gave the finish signal + run seconds + `!rules`.
import { drivePark, REACT_MS } from './park-model.ts';

const lesson = Number(process.argv[2]);
if (lesson !== 7 && lesson !== 8) throw new Error('usage: park-sweep.ts 7|8 [maxSeconds]');
const maxS = Number(process.argv[3] ?? 150);
const cells: string[] = [];
for (const react of REACT_MS) {
  for (const phase of [0, 12, 25, 37]) {
    const o = drivePark(lesson, react, phase, maxS);
    const rules = o.pents.length ? '!' + o.pents.map((p) => p.replace('SH.GHEP.', '')).join('+') : '';
    cells.push(`${react}/${phase}:${o.score}${o.signal ? 'S' : '-'}${o.runS.toFixed(0)}s${rules}`);
  }
}
console.log(`bài ${lesson}`, cells.join('  '));
