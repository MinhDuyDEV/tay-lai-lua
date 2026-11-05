// TEMPORARY (the S3 learner-model scope replaces this with the automatic feel tests under input/): a
// quick check that a screen-only learner who reacts 300 ms late finishes each of the 11 bài on the
// automatic, and what each page tells them on the way.
//
// It drives only what the page publishes: `exerciseFor(lesson, true)`'s own advice/cue/stop/step
// functions — the same ones the HUD paints — against the real sim.wasm. One poll of the page every
// 50 ms (a repaint), every key landing `react` milliseconds after the read, and one learner per key
// group. Run `task build` first (it writes build/sim.wasm), then: `node input/auto-page-probe.ts`.
//
// Not a gate on the pages' words: the 300 ms line is the brief's requirement. The other reactions are
// printed so the band is visible, and 7/8 come from `drivePark` (`park-model.ts`), which drives the
// park's own planner rather than this file's simpler loop.
import { readFileSync } from 'node:fs';
import { createDriver, steerFeel } from './driver.ts';
import { drivePark } from './park-model.ts';
import { exerciseFor } from '../src/exercise.ts';
import type { StepId } from '../src/steps.ts';
import { yardOf } from '../src/ghep.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession } from '../src/sim/session.ts';

const wasm = readFileSync(new URL('../../../build/sim.wasm', import.meta.url));
const bytes = () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
const data = JSON.parse(readFileSync(new URL('../../../content/rulesets/tt108-2026.json', import.meta.url), 'utf8'));
const ruleset: Ruleset = { ...data, steer: { ...steerFeel } };
const codes = new Map<number, string>((data.rules as { code: number; id: string }[]).map((r) => [r.code, r.id]));

const POLL_MS = 50;
// The band the aid's stop cue is built for: the words lead the bar's mark by 275 ms, so a learner
// faster than about 150 ms lands early (that is the manual aid's own band too, 150–350 ms), and the
// gate is the 300 ms line this lane owes.
const REACTIONS = [150, 200, 300, 350, 400];
const GATE_MS = 300;

interface Outcome {
  score: number;
  done: boolean;
  A: number;
  ids: string[];
  /** Every advice line and cue the learner was shown, in the order they first appeared. */
  said: string[];
  seconds: number;
}

/** One learner, one lesson: read the page every 50 ms, act `reactMs` later. */
function drive(lesson: number, reactMs: number): Outcome {
  const ex = exerciseFor(lesson as 1, true);
  const session = openSession(bytes(), ex.seed);
  const driver = createDriver({ automatic: true });
  const centre = session.course.find((r) => r.kind === 5)?.points ?? [];
  const yard = ex.park ? ex.park(session.course) : null;
  const lag = Math.round((reactMs / 1000) * 60);
  const poll = Math.max(1, Math.round(POLL_MS / 16.7));
  const done = new Set<StepId>();
  const queue: { at: number; held: Set<string>; pressed: string[] }[] = [];
  let held = new Set<string>();
  /** Taps that have landed (the read plus the learner's reaction) and go to the driver this tick. */
  let landed: string[] = [];
  let s = session.state;
  let tick = 0;
  let lastTap = -99;
  let lastStalk = -99;
  const ids: string[] = [];
  const said: string[] = [];
  // One line per change of *cue*, with the words that came with it: the per-tick gap numbers would
  // otherwise fill the list with the same sentence.
  let lastCue: string | null = null;
  const say = (text: string, cue: string) => {
    if (cue === lastCue) return;
    lastCue = cue;
    said.push(`${cue ? `[${cue}] ` : ''}${text}`);
  };

  for (; tick < 60 * 180 && s.phase !== 'done' && !s.disqualified; tick += 1) {
    if (tick % poll === 0) {
      ex.mark(done, s, ruleset);
      const advice = ex.advice(s, ruleset, centre, yard) ?? '';
      const cue = ex.cue(s, ruleset, centre, yard) ?? '';
      const aid = ex.stop(s, ruleset);
      say(advice, aid?.key === 'brake' && aid.now ? 'brake-now' : cue);
      const want = new Set<string>();
      // Taps made at this read, queued to land `lag` ticks later with the keys.
      const pressed: string[] = [];
      const tap = (code: string) => {
        if (tick - lastTap > 40) {
          pressed.push(code);
          lastTap = tick;
        }
      };
      const has = (id: StepId) => ex.steps.some((step) => step.id === id);

      // The checklist's own keys, in its order: engine, belt, order, signal, selector, handbrake.
      if (has('engine') && !done.has('engine')) tap('KeyE');
      else if (has('belt') && !done.has('belt')) tap('KeyB');
      else if (has('order') && !done.has('order')) tap('Enter');
      else if (has('signal') && lesson === 1 && !done.has('signal')) tap('KeyQ');
      else if (!done.has('gear')) tap('KeyD');
      else if (s.handbrake) tap('KeyP');

      // A stalk is pressed once and looked at; again only if it did not take.
      const stalk = (on: boolean) => {
        if (on && tick - lastStalk > 90) {
          pressed.push(lesson === 1 ? 'KeyQ' : 'KeyW');
          lastStalk = tick;
        }
      };
      if (has('off') && done.has('signal') && !done.has('off') && s.frontBumperM >= ruleset.course.signal_off_early_m) stalk(true);
      if (ex.signals && lesson === 11 && s.signal !== 'right' && !done.has('line')) stalk(true);
      if (ex.signals && lesson === 5 && s.lineGapM < 4 && s.signal !== 'right') stalk(true);

      if (done.has('gear') && !s.handbrake) {
        if (aid?.now || cue === 'brake') want.add('ArrowDown');
        else if (cue === 'throttle') want.add('ArrowUp');
        else if (cue === 'left') want.add('ArrowLeft');
        else if (cue === 'right') want.add('ArrowRight');
        // A pace the page names in words: "Giữ ga ↑ cho tới N km/h". The learner reads the number.
        const pace = /tới (\d+) km\/h/.exec(advice);
        if (pace && s.speedMps * 3.6 < Number(pace[1])) want.add('ArrowUp');
        if (cue === 'runup' || cue === 'pull') want.add('ArrowUp');
        // Bài 11's finish sentence: "Đã qua vạch kết thúc: phanh ↓ cho xe dừng hẳn".
        if (advice.includes('phanh ↓ cho xe dừng hẳn')) want.add('ArrowDown');
        if (cue === 'coast' || cue === 'roll') want.delete('ArrowUp');
      }
      // After a stop: hold the brake for a moment, then the next thing the page says.
      if (s.sinceStopTicks >= 0) {
        if (s.sinceStopTicks < 30) {
          want.add('ArrowDown');
          want.delete('ArrowUp');
        } else if (lesson !== 11 && (cue === 'throttle' || (!cue && !aid)) && s.speedMps < 0.3) {
          want.add('ArrowUp');
          want.delete('ArrowDown');
        }
      }
      queue.push({ at: tick + lag, held: want, pressed });
    }
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= tick) {
      const e = queue.shift()!;
      held = e.held;
      landed.push(...e.pressed);
    }
    const result = session.step(driver.step(held, landed.splice(0), { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = result.state;
    for (const e of result.events) ids.push(codes.get(e.code) ?? String(e.code));
  }
  session.dispose();
  return {
    score: s.score,
    done: s.phase === 'done' && !s.disqualified,
    A: s.stopGapAM,
    ids: [...new Set(ids)],
    said,
    seconds: tick / 60,
  };
}

let failures = 0;
for (const lesson of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const) {
  const at300 = lesson === 7 || lesson === 8 ? null : drive(lesson, GATE_MS);
  const cells = [7, 8].includes(lesson)
    ? [150, 300].map((react) => {
        const o = drivePark(lesson, react, 0, 150, 1, { automatic: true });
        return `${react}:${o.score}${o.finished ? '' : 'x'}${o.pents.length ? '!' + o.pents.join('+') : ''}${o.signal ? ' S' : '-'}`;
      })
    : REACTIONS.map((react) => {
        const o = react === GATE_MS ? at300! : drive(lesson, react);
        return `${react}:${o.score}${o.done ? '' : 'x'}${o.ids.length ? '!' + o.ids.join('+') : ''}`;
      });
  const score300 = at300?.score ?? drivePark(lesson, GATE_MS, 0, 150, 1, { automatic: true }).score;
  const done300 = at300?.done ?? drivePark(lesson, GATE_MS, 0, 150, 1, { automatic: true }).finished;
  if (score300 !== 100 || !done300) failures += 1;
  console.log(`bài ${lesson}: ${cells.join(' | ')}`);
  if (at300) {
    const words = at300.said.filter((line) => line.length > 0);
    for (const line of words.slice(0, 8)) console.log(`    "${line}"`);
  }
}
// park-model's own undo of the shared yard: nothing to dispose.
void yardOf;
if (failures > 0) {
  console.error(`${failures} bài below 100 for a ${GATE_MS} ms learner`);
  process.exit(1);
}
console.log(`every bài is 100 for a ${GATE_MS} ms learner`);
