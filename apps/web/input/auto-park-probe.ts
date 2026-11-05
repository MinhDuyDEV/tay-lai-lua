// Exploratory: the park-feel grid on an automatic. node input/auto-park-probe.ts 7|8 [manual]
import { drivePark, REACT_MS } from './park-model.ts';
const lesson = Number(process.argv[2]) as 7 | 8;
const automatic = process.argv[3] !== 'manual';
const cells: string[] = [];
for (const react of REACT_MS) for (const phase of [0, 12, 25, 37]) {
  const o = drivePark(lesson, react, phase, 150, 1, { automatic });
  cells.push(`${react}/${phase}:${o.score}${o.signal ? 'S' : '-'}${o.runS.toFixed(0)}s${o.pents.length ? '!' + o.pents.join('+') : ''}`);
}
console.log(`bài ${lesson} ${automatic ? 'auto' : 'manual'}`, cells.join('  '));
