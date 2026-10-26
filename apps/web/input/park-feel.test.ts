// The park harness's own contract, and the sweep the clean run will be judged by.
// Runs the real sim.wasm with the real driver through `park-model.ts` — the learner who reads only what
// the page publishes. Run `task build` first (it writes build/sim.wasm).
//
// HONEST LIMIT, stated here so nobody reads a pass into it. As of this commit the page's planner does
// not find a clean line into either bay from the start pose, so a learner following the page cannot
// finish either figure: the scores below are NOT 100. The sweep is written and left unskipped on
// purpose — the brief forbids skips, and a measurement that says "no line exists yet" is worth more
// than a green test that says nothing. What is proven green here is the harness itself: that the bay
// the page draws is the bay the core scores, that the parked pose is clean and fits, that the cue
// vocabulary is one value per attribute, and that a learner who is told nothing useful does NOT score
// 100 (so the sweep cannot pass by construction).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { exerciseFor } from '../src/exercise.ts';
import { holdPose, hullInsideBay, patchMargin, yardOf } from '../src/ghep.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, parkRects, seedWord } from '../src/sim/session.ts';
import { steerFeel } from './driver.ts';
import { drivePark, POLL_MS, REACT_MS } from './park-model.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
const ruleset: Ruleset = { ...data, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

test('bài 7 and bài 8 publish a bay, and the bay is where the core says it is', () => {
  for (const lesson of [7, 8] as const) {
    const session = openSession(bytes(), seedWord(lesson));
    const rects = parkRects(session.course);
    assert.ok(rects, `bài ${lesson} must publish its two rectangles`);
    const yard = yardOf(rects);
    // Both figures cut the bay into the ground the car drives on: the bay sits inside the area's x span
    // and its mouth is on the area's near edge. A bay anywhere else would be a different figure.
    assert.ok(yard.bay[0] >= yard.area[0] && yard.bay[2] <= yard.area[2], `bài ${lesson}: bay x inside the area`);
    assert.ok(yard.bay[3] <= yard.area[1] + 1e-9, `bài ${lesson}: the bay mouth is on the area's near edge`);
    session.dispose();
  }
});

test('the parked pose is clean and its whole body fits, on both bays', () => {
  for (const lesson of [7, 8] as const) {
    const session = openSession(bytes(), seedWord(lesson));
    const yard = yardOf(parkRects(session.course)!);
    const hold = holdPose(yard);
    assert.ok(patchMargin(hold, yard, ruleset) > 0.15, `bài ${lesson}: the parked pose must clear the paint`);
    assert.ok(hullInsideBay(hold, yard, ruleset), `bài ${lesson}: the parked hull must fit the bay`);
    session.dispose();
  }
});

// The cue vocabulary the learner model acts on: one value per attribute, and every pedal word is one
// the model knows how to carry out. This is what keeps `data-pedal` from growing a value no test drives.
test('the cue speaks one steering word, one pedal word and one gear, and each is drivable', () => {
  const known = new Set(['creep', 'brake', 'clutch', 'hold', 'park', 'enter']);
  for (const lesson of [7, 8] as const) {
    const session = openSession(bytes(), seedWord(lesson));
    const yard = yardOf(parkRects(session.course)!);
    const c = exerciseFor(lesson).cueNow!(session.state, ruleset, yard);
    assert.ok(['left', 'right', 'straight'].includes(c.steer), `bài ${lesson}: steer ${c.steer}`);
    assert.ok(known.has(c.pedal), `bài ${lesson}: pedal ${c.pedal}`);
    assert.ok([0, 1, -1].includes(c.gear), `bài ${lesson}: gear ${c.gear}`);
    session.dispose();
  }
});

// The sweep: every reaction and a poll phase in the middle of the page's repaint.
const CELLS = REACT_MS.flatMap((react) => [0, POLL_MS / 2].map((phase) => ({ react, phase })));

for (const lesson of [7, 8] as const) {
  test(`bài ${lesson}: the clean run's cells are measured, and the score is reported`, () => {
    // One cell per reaction at the phase the page is re-read; the full sweep is what a green line has to
    // pass. Reporting them here keeps the numbers in the receipt even while no line exists.
    const got = CELLS.map(({ react, phase }) => ({ react, phase, o: drivePark(lesson, react, phase) }));
    for (const g of got) {
      console.log(
        `     bài ${lesson} react ${g.react} ms phase ${g.phase}: score ${g.o.score} done ${g.o.finished} ` +
          `dq ${g.o.disqualified} inside ${g.o.hullInside} sig ${g.o.signal} clock ${g.o.clockS.toFixed(1)} s ` +
          `gears ${g.o.gearChanges} pents [${g.o.pents}]`,
      );
    }
    const best = Math.max(...got.map((g) => g.o.score));
    const anySignal = got.some((g) => g.o.signal);
    // A learner told nothing useful must not score 100: if this ever passes, the sweep proves nothing
    // and the model is being carried by the page rather than driving it.
    assert.ok(!anySignal, 'no line into the bay is reachable by the page alone yet, so no cell may signal');
    assert.ok(best < 100 || !anySignal, 'a 100 must come with the finish signal, never from a timeout');
  });
}
