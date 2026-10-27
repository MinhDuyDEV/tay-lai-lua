// The learner for bài 7 and bài 8: reads only what the page publishes (`data-cue`, `data-pedal`,
// `data-gear-wanted`, which are `cueGhep`'s steer, pedal and gear), re-reads every 50 ms at a phase, is
// late by a fixed reaction, and acts only through key events on the real driver and the real core.
// The words it acts on are the ones the HUD paints; it never reads the snapshot to decide what to do.
// A leg the cue gives a time (`data-hold-ms`) is not stopped on a word: the learner lets go and presses when
// the bar (`holdAid`) says `now`, a full reaction plus the poll phase later (`trackFactor` 1, the gate).
import { readFileSync } from 'node:fs';
import { exerciseFor, type Lesson } from '../src/exercise.ts';
import { holdAid, newHoldTimer, setSliceWork, yardOf, type HoldTimer } from '../src/ghep.ts';
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

/**
 * `trackFactor` is how much of their reaction a learner still loses on the bar's `now`: 1 is a reader who acts on
 * what the page shows a full reaction + poll phase after it shows it (the gate); 0.25 and 0 anticipate the bar
 * and are run for information only.
 */
export interface Variant {
  /** Each action is late by the reaction + phase plus up to this much either way, ms. The gate uses 40. */
  jitterMs?: number;
  /** Off: the bar's lead stays at `LEAD_S`. */
  calibrate?: boolean;
  /** The bar is fed this lag (s) instead of the one it measures: a broken calibration. */
  forceLagS?: number;
}

export function drivePark(lesson: Lesson, reactMs: number, phaseMs: number, maxS = 120, trackFactor = 1, variant: Variant = {}): Outcome {
  const jitterMs = variant.jitterMs ?? 40;
  const ex = exerciseFor(lesson);
  const session = openSession(bytes(), seedWord(lesson));
  const yard = yardOf(parkRects(session.course)!);
  const driver = createDriver();
  const ids = new Map<number, string>(data.rules.map((r: { code: number; id: string }) => [r.code, r.id]));
  const pents: string[] = [];
  let s: SimState = session.state;

  const lateTicks = Math.round(((reactMs + phaseMs) / 1000) * 60);
  const pollTicks = Math.round((POLL_MS / 1000) * 60);
  // Every change of what the learner wants is an action; it lands `lateTicks` plus a jitter of up to
  // `jitterMs` either way later (people are not metronomes), and actions land in the order they were made.
  const pending: { at: number; held: Set<string>; pressed: string[] }[] = [];
  let seed = (reactMs * 1009 + phaseMs * 31 + lesson) >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let lastWant = '';
  let lastAt = 0;
  let jitterTicks = 0;
  let heldNow = new Set<string>(['Space']);
  let want = new Set<string>();
  let owed: string[] = [];
  let tick = 0;
  let lastPedal = '';
  let parkPressTick = -Infinity;
  // A timed pulse: the learner lets go when the line says so, then presses when the bar says `now`.
  let counting = false;
  let countedAt = 0;
  let countTicks = 0;
  let braking = false;
  let stoppedBy = 0;
  // The bar is read where the page reads it: the same `holdAid` on the sim's state, every frame. The learner
  // presses when the bar says `now`, a reaction later (the queue below). `trackFactor` 1 is that, and is the gate;
  // below 1 the learner anticipates the bar by the missing share of the reaction (information only).
  const timer: HoldTimer = newHoldTimer();
  timer.calibrate = variant.calibrate ?? true;
  timer.forceLagS = variant.forceLagS;
  const anticipateMs = (1 - trackFactor) * (reactMs + phaseMs);
  // The page asks for the cue every frame and the planner works a slice of each; a poll reads the last answer.
  setSliceWork(SLICE_WORK);
  let c = ex.cueNow!(s, ruleset, yard);
  while (s.phase !== 'done' && !s.disqualified && tick < maxS * 60) {
    c = ex.cueNow!(s, ruleset, yard);
    const bar = holdAid(timer, s, c.holdMs);
    if (tick % pollTicks === 0) {
      const next = new Set<string>();
      if (c.steer === 'left') next.add('ArrowLeft');
      if (c.steer === 'right') next.add('ArrowRight');
      // Pedals: on the clutch and the brake together (a brake with the clutch up stalls the car) except
      // when the word says the car is to move.
      if (counting && ((bar.state !== 'ready' && bar.state !== 'idle' && bar.leftMs <= timer.lead * 1000 + anticipateMs) || tick > countedAt + countTicks + 90)) {
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
        counting = true;
        countedAt = tick;
        countTicks = Math.round((c.holdMs / 1000) * 60);
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
    const sig = [...want].sort().join(',');
    if (sig !== lastWant || owed.length) {
      lastWant = sig;
      jitterTicks = Math.round(((rand() * 2 - 1) * jitterMs) / (1000 / 60));
    }
    const at = Math.max(lastAt, tick + lateTicks + jitterTicks);
    lastAt = at;
    pending.push({ at, held: new Set(want), pressed: owed });
    owed = [];
    let pressedNow: string[] = [];
    while (pending.length && pending[0].at <= tick) {
      const e = pending.shift()!;
      heldNow = e.held;
      pressedNow = pressedNow.concat(e.pressed);
    }
    const seen = { held: heldNow, pressed: pressedNow };
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
