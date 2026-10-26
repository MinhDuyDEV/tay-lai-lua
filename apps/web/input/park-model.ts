// The learner model for bài 7 and bài 8: a reader who sees only what the page publishes, polling and
// late by a fixed reaction, acting only through real key events on the real driver.
//
// Kept out of the test file so the test, the browser harness and a one-off script all drive the same
// learner — a second copy of this loop is how a model and its test stop agreeing.
//
// What this file is, and is not. It is the *learner model* the brief fixes: a reader who
//   * reads only `.advice` — its text for the words, its `data-cue` for the steering key,
//     `data-pedal` for the pedal and `data-gear-wanted` for the lever — plus `data-aid-*`;
//   * polls every 50 ms at a random phase;
//   * is late by a fixed reaction, swept over 150 to 400 ms;
//   * acts only through real key events on the real driver (rate pedals, clutch travel, gear gate).
// It is not a search for a line, and it does not read the snapshot to steer: the bay and the plan come
// from `exerciseFor(lesson).park(course)` and the page's own `cueGhep`, exactly as the HUD gets them.
//
// HONEST LIMIT: the page's planner does not yet find a clean line into either bay, so a learner
// following the page cannot finish either figure. This module is the model that measures that; it is
// not a search, and a null result here is a real null (see park-feel.test.ts).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { exerciseFor, type Lesson } from '../src/exercise.ts';
import { holdPose, hullInsideBay, patchMargin, yardOf, type GhepPedal, type Yard } from '../src/ghep.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, parkRects, seedWord, type Session, type SimState } from '../src/sim/session.ts';
import { createDriver, DT, steerFeel } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
const ruleset: Ruleset = { ...data, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

/** The reaction band the brief names. */
export const REACT_MS = [150, 200, 250, 300, 350, 400] as const;
/** How often the learner re-reads the page. */
export const POLL_MS = 50;

const KEY_OF: Record<string, string> = { left: 'ArrowLeft', right: 'ArrowRight' };

interface Outcome {
  finished: boolean;
  disqualified: boolean;
  score: number;
  /** The core's own containment and signal fields, not the page's opinion. */
  hullInside: boolean;
  signal: boolean;
  clockS: number;
  pents: string[];
  /** Direction changes the learner actually made, for the manoeuvre's cost. */
  gearChanges: number;
}

/**
 * One run, driven by the page alone.
 *
 * The pedal word is one value (`data-pedal`): `creep` means feet off so the clutch comes up and the car
 * moves, `brake` means hold ↓ now, `clutch` means hold Space and put the lever in the gear the line
 * names, `hold` means stand on ↓ and stay there until the signal. The gear word is
 * `data-gear-wanted` (1 or −1) and is only acted on while the clutch is at the floor, because that is
 * the only time the real driver accepts it.
 */
export function drivePark(lesson: Lesson, reactMs: number, pollOffsetMs: number): Outcome {
  const ex = exerciseFor(lesson);
  const session: Session = openSession(bytes(), seedWord(lesson));
  const yard = ex.park?.(session.course) ?? null;
  const driver = createDriver();
  let s: SimState = session.state;
  const pents: string[] = [];
  const rules = JSON.parse(readFileSync(RULESET_FILE, 'utf8')).rules as { code: number; id: string }[];
  const idOf = new Map(rules.map((r) => [r.code, r.id]));

  const hold = new Set<string>();
  /** A queue of actions owed: the learner decided them `reactMs` ago. */
  const later: { at: number; fn: () => void }[] = [];
  let now = 0;
  let nextPoll = pollOffsetMs;
  let lastCue = '';
  let lastPedal = '' as GhepPedal | '';
  let lastGear = 0;
  let gearChanges = 0;

  while (s.phase !== 'done' && !s.disqualified && now < 240_000) {
    if (now >= nextPoll) {
      nextPoll += POLL_MS;
      // Everything the page publishes about the manoeuvre. Nothing else is read.
      const advice = readAdvice(lesson, yard, s, ruleset);
      if (advice.cue !== lastCue) {
        lastCue = advice.cue;
        const want = advice.cue;
        later.push({
          at: now + reactMs,
          fn: () => {
            hold.delete('ArrowLeft');
            hold.delete('ArrowRight');
            if (want !== 'straight' && KEY_OF[want]) hold.add(KEY_OF[want]);
          },
        });
      }
      if (advice.pedal !== lastPedal) {
        lastPedal = advice.pedal;
        const pedal = advice.pedal;
        const gear = advice.gear;
        later.push({
          at: now + reactMs,
          fn: () => {
            if (pedal === 'park') {
              // `P` is a toggle: press once to release, once to set. The learner presses it when the line
              // says the handbrake is the thing in the way.
              hold.add('__pressP');
            } else if (pedal === 'creep') {
              hold.delete('Space');
              hold.delete('ArrowDown');
            } else if (pedal === 'brake' || pedal === 'hold') {
              // Both pedals together: a brake with the clutch up stalls the engine, and the line says so.
              hold.add('Space');
              hold.add('ArrowDown');
            } else if (pedal === 'enter') {
              // The finish: stand on the brake and press Enter. Both, because the core's finish needs the
              // car still, and a learner who lifts off to press Enter loses the signal.
              hold.add('Space');
              hold.add('ArrowDown');
              hold.add('__pressEnter');
            } else if (pedal === 'clutch') {
              // Clutch to the floor and the brake with it, so the lever can go in and the car does not
              // roll while it does.
              hold.add('Space');
              hold.add('ArrowDown');
            }
            if (gear !== 0 && gear !== lastGear) {
              lastGear = gear;
              gearChanges += 1;
              // The lever only goes in with the pedal at the floor, so the press waits for it.
              later.push({
                at: now + reactMs + GEAR_DELAY_MS,
                fn: () => {
                  if (gear === 1) hold.add('__press1');
                  else hold.add('__pressR');
                },
              });
            }
          },
        });
      }
    }

    // Run every action that is due.
    for (let i = later.length - 1; i >= 0; i -= 1) {
      if (now >= later[i].at) {
        const { fn } = later[i];
        later.splice(i, 1);
        fn();
      }
    }
    const pressed: string[] = [];
    if (hold.delete('__pressEnter')) pressed.push('Enter');
    if (hold.delete('__pressP')) pressed.push('KeyP');
    if (hold.delete('__press1')) pressed.push('Digit1');
    if (hold.delete('__pressR')) pressed.push('KeyR');
    // The clutch has to be at the floor before a gear press is accepted; retry until it is.
    if (pressed.length === 0 && (lastGear === 1 || lastGear === -1) && s.gear !== lastGear && s.clutch > 0.95) {
      pressed.push(lastGear === 1 ? 'Digit1' : 'KeyR');
    }
    const input = driver.step(hold, pressed, { speedMps: s.speedMps, engineOn: s.engineOn });
    const r = session.step(input);
    s = r.state;
    for (const e of r.events) {
      const id = idOf.get(e.code);
      if (id) pents.push(id);
    }
    now += DT * 1000;

  }
  const out: Outcome = {
    finished: s.phase === 'done' && !s.disqualified,
    disqualified: s.disqualified,
    score: s.score,
    hullInside: s.hullInside,
    signal: s.finishSignal,
    clockS: s.clockMs / 1000,
    pents: [...new Set(pents)],
    gearChanges,
  };
  session.dispose();
  return out;
}

/** How long after the sentence asks for a gear the lever actually goes in: the pedal has to be down. */
const GEAR_DELAY_MS = 300;

/**
 * What the page says this tick, in the same names the HUD paints: `adviceGhep` for the words,
 * `cueGhep` for `data-cue` / `data-pedal` / `data-gear-wanted`. Reading the functions the HUD calls is
 * the only way to be sure the test and the page agree — but it means the test also owns the mapping,
 * so `the page publishes the cue it computes` below pins the two together.
 */
function readAdvice(lesson: Lesson, yard: Yard | null, s: SimState, rs: Ruleset) {
  const ex = exerciseFor(lesson);
  if (!ex.cueNow || !yard) return { cue: 'straight', pedal: 'hold' as GhepPedal, gear: 0 as 0 | 1 | -1 };
  const c = ex.cueNow(s, rs, yard);
  return { cue: c.steer, pedal: c.pedal, gear: c.gear };
}

