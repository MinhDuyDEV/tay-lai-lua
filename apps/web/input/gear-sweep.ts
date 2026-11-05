// The bài 10 feel sweep as a script, not a test: every reaction × poll phase of the page-only reader,
// one line of results. The same grid is gated in `gear-feel.test.ts`; this prints it.
//   node apps/web/input/gear-sweep.ts [auto]
// Each cell is `react/phase:score` + `S` when the run finished, run seconds, and `!rules` when the core
// charged anything (rule ids without the SH. prefix). `-` is a run that neither finished nor charged —
// it ran out of time, which is a failure of its own.
import { describeCell, driveGear, pageShow, PHASE_MS, REACT_MS } from './gear-model.ts';

const automatic = process.argv[2] === 'auto';
const page = pageShow(automatic);
const cells: string[] = [];
for (const react of REACT_MS) {
  for (const phase of PHASE_MS) {
    const o = driveGear(react, phase, page, 150, automatic);
    const rules = o.pents.length ? '!' + o.pents.map((p) => p.replace(/^SH\.[^.]+\./, '')).join('+') : '';
    cells.push(`${react}/${phase}:${o.score}${o.finished ? 'S' : '-'}${o.runS.toFixed(0)}s${rules}`);
  }
}
console.log(`bài 10${automatic ? ' auto' : ''}`, cells.join('  '));

// The worst cell of the grid, spelled out: what the band's slowest reader is left with.
const worst = [...REACT_MS]
  .flatMap((react) => PHASE_MS.map((phase) => ({ react, phase, o: driveGear(react, phase, page, 150, automatic) })))
  .sort((a, b) => a.o.score - b.o.score || b.o.runS - a.o.runS)[0];
console.log('  worst cell:', describeCell(worst.react, worst.phase, worst.o));
