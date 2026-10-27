// The learner for bài 7 and bài 8: reads only what the page publishes (`data-cue`, `data-pedal`,
// `data-gear-wanted`, which are `cueGhep`'s steer, pedal and gear), re-reads every 50 ms at a phase, is
// late by a fixed reaction, and acts only through key events on the real driver and the real core.
// The words it acts on are the ones the HUD paints; it never reads the snapshot to decide what to do.
import { readFileSync } from 'node:fs';
import { exerciseFor, type Lesson } from '../src/exercise.ts';
import { setSliceWork, yardOf } from '../src/ghep.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, parkRects, seedWord, type SimState } from '../src/sim/session.ts';
import { createDriver, steerFeel } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
export const ruleset: Ruleset = { ...data, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

/** The reaction band the brief names, and how often the learner re-reads the page. */
export const REACT_MS = [150, 300, 400] as const;
export const POLL_MS = 50;
/** Planner steps one frame may run: about the 5 ms the page gives it (see `SLICE_WORK` calibration in ghep.ts). */
export const SLICE_WORK = 2400;

export interface Outcome {
  finished: boolean;
  disqualified: boolean;
  score: number;
  inside: boolean;
  signal: boolean;
  /** Seconds of simulated time the whole run took. */
  runS: number;
  /** The core's rule ids charged. */
  pents: string[];
}

export function drivePark(lesson: Lesson, reactMs: number, phaseMs: number, maxS = 120): Outcome {
  const ex = exerciseFor(lesson);
  const session = openSession(bytes(), seedWord(lesson));
  const yard = yardOf(parkRects(session.course)!);
  const driver = createDriver();
  const ids = new Map<number, string>(data.rules.map((r: { code: number; id: string }) => [r.code, r.id]));
  const pents: string[] = [];
  let s: SimState = session.state;

  const lateTicks = Math.round(((reactMs + phaseMs) / 1000) * 60);
  const pollTicks = Math.round((POLL_MS / 1000) * 60);
  const queue: { held: Set<string>; pressed: string[] }[] = [];
  let want = new Set<string>();
  let owed: string[] = [];
  let tick = 0;
  let lastPedal = '';
  let parkPressTick = -Infinity;
  // A timed pulse: the learner lets go when the line says so, counts `holdMs` from there and presses; their
  // press trails the count by a quarter of their reaction (they follow a bar that is filling, not a flash).
  let pulseEnd = -Infinity;
  let counting = false;
  let braking = false;
  let stoppedBy = 0;
  const trackTicks = Math.round(Number(process.env.TRACKF ?? 0.25) * ((reactMs + phaseMs) / 1000) * 60);
  // The page asks for the cue every frame and the planner works a slice of each; a poll reads the last answer.
  setSliceWork(SLICE_WORK);
  let c = ex.cueNow!(s, ruleset, yard);
  while (s.phase !== 'done' && !s.disqualified && tick < maxS * 60) {
    c = ex.cueNow!(s, ruleset, yard);
    if (tick % pollTicks === 0) {
      const next = new Set<string>();
      if (c.steer === 'left') next.add('ArrowLeft');
      if (c.steer === 'right') next.add('ArrowRight');
      // Pedals: on the clutch and the brake together (a brake with the clutch up stalls the car) except
      // when the word says the car is to move.
      if (counting && tick >= pulseEnd) {
        counting = false;
        braking = true;
        stoppedBy = tick + lateTicks + 60;
      }
      // The pedals stay down until the car has stopped: a second after the press, or at the next standing cue
      // once the press has landed (before that the cue still shows the car standing, as it did before the release).
      if (braking && (tick >= stoppedBy || (tick >= stoppedBy - 60 + 20 && (c.holdMs > 0 || c.pedal === 'wheel' || c.pedal === 'clutch')))) braking = false;
      if (counting) {
        // counting: feet stay off whatever the words say until the time is up
      } else if (c.pedal === 'creep' && c.holdMs > 0 && !braking) {
        pulseEnd = tick + Math.round((c.holdMs / 1000) * 60) + trackTicks;
        counting = true;
      } else if (c.pedal !== 'creep' || braking) {
        next.add('Space');
        next.add('ArrowDown');
      }
      // `P` is a toggle: a person presses it once when the line says so, and again only if it is still
      // asking a second later than the press could have landed. Pressed on every poll it would flip back.
      if (c.pedal === 'park') {
        if (lastPedal !== 'park' || tick - parkPressTick > 60 + lateTicks + pollTicks) {
          owed.push('KeyP');
          parkPressTick = tick;
        }
      }
      lastPedal = c.pedal;
      if (c.pedal === 'enter') owed.push('Enter');
      // The lever goes in with the pedal at the floor as the sentence says; the press repeats until it takes.
      if (c.gear !== 0 && s.gear !== c.gear && s.clutch >= 0.97) owed.push(c.gear === 1 ? 'Digit1' : 'KeyR');
      want = next;
      if (process.env.PT && tick % 30 === 0) console.log((tick / 60).toFixed(1), c.pedal, c.steer, c.gear, s.speedMps.toFixed(2), s.carX.toFixed(2), s.carY.toFixed(2), ((s.heading * 180) / Math.PI).toFixed(0), c.plan ? c.plan.legs.map((g) => (g.dir > 0 ? 'F' : 'R') + (g.steerRad > 0 ? '+' : g.steerRad < 0 ? '-' : '0') + g.len.toFixed(1)).join(' ') : '-');
    }
    queue.push({ held: new Set(want), pressed: owed });
    owed = [];
    const seen = queue.length > lateTicks ? queue.shift()! : { held: new Set<string>(['Space']), pressed: [] };
    const r = session.step(driver.step(seen.held, seen.pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = r.state;
    for (const e of r.events) {
      const id = ids.get(e.code);
      if (id) { pents.push(id); if (process.env.PT) console.log('PENALTY', id,  (tick / 60).toFixed(1), s.carX.toFixed(2), s.carY.toFixed(2), ((s.heading * 180) / Math.PI).toFixed(0)); }
    }
    tick += 1;
  }
  const out: Outcome = {
    finished: s.phase === 'done' && !s.disqualified,
    disqualified: s.disqualified,
    score: s.score,
    inside: s.hullInside,
    signal: s.finishSignal,
    runS: tick / 60,
    pents: [...new Set(pents)],
  };
  session.dispose();
  return out;
}
