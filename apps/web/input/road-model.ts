// The learner for bài 2 and bài 9: the straight road, read only from what the page publishes
// (`exerciseFor(lesson, automatic)`'s advice line and its stop aid — the `data-aid-*` the HUD draws).
// It is the same learner the e2e's `roadStop`/`roadGo` drive in the browser:
//   * set off the checklist's way (manual: clutch, gear 1, handbrake; automatic: D, handbrake);
//   * creep to the line with no throttle — the advice line says "để xe tự bò tới vạch";
//   * press the brake (manual: clutch and brake together) when the aid says "bấm ngay", a full
//     reaction + the poll's phase later, and keep it down until the car has stopped;
//   * the moment the line says the car has stopped inside A, let the brake go: the car creeps on past
//     the line by itself, which ends the exercise.
// Nothing here reads the snapshot to decide an action: the aid and the advice line are the inputs.
import { readFileSync } from 'node:fs';
import { exerciseFor } from '../src/exercise.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, seedWord, type SimState } from '../src/sim/session.ts';
import { createDriver, steerFeel } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
export const ruleset: Ruleset = { ...data, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

/** The reaction band the brief names, and the poll's phase inside the 50 ms repaint. */
export const REACT_MS = [150, 300, 400] as const;
export const POLL_MS = 50;
export const PHASE_MS = [0, 12, 25, 37] as const;

export interface RoadOutcome {
  finished: boolean;
  disqualified: boolean;
  score: number;
  /** A as the core recorded it, metres. */
  stopA: number;
  /** The core's rules, by id. */
  pents: string[];
  /** Seconds of simulated time. */
  runS: number;
}

/**
 * `literal` is the same learner reading only the sentence's trigger ("phanh khi thanh báo «bấm
 * ngay»") and reacting after it: the default reads the countdown the page publishes and starts moving
 * when the key it is about to press would land on the bar's mark, which is what the bar is for (the
 * same anticipating learner `stop-aid-feel.test.ts` calls `plan`). At the flat road's creep a literal
 * 400 ms reader is 125 ms past the mark and overshoots A; that is the red control below.
 */
export function driveRoad(
  lesson: 2 | 9,
  reactMs: number,
  phaseMs: number,
  automatic = false,
  literal = false,
): RoadOutcome {
  const ex = exerciseFor(lesson, automatic);
  const session = openSession(bytes(), seedWord(lesson, 1n, automatic));
  const driver = createDriver({ automatic });
  const ids = new Map<number, string>((data.rules as { code: number; id: string }[]).map((r) => [r.code, r.id]));
  let s: SimState = session.state;
  const pents: string[] = [];
  const lateTicks = Math.round(((reactMs + phaseMs) / 1000) * 60);
  const pollTicks = Math.max(1, Math.round((POLL_MS / 1000) * 60));
  /** What the learner decided, landing `lateTicks` later: the held keys and the taps. */
  const queue: { at: number; held: Set<string>; pressed: string[] }[] = [];
  let held = new Set<string>();
  let stage: 'setup' | 'approach' | 'stopping' | 'away' = 'setup';
  let lastD = -Infinity;
  let lastP = -Infinity;
  let lastAid = false;
  let planned = false;
  let ticks = 0;
  const phaseTicks = Math.round((phaseMs / 1000) * 60);

  for (; ticks < 120 * 60 && !(s.phase === 'done' || s.disqualified); ticks += 1) {
    if (ticks >= phaseTicks && (ticks - phaseTicks) % pollTicks === 0) {
      if (stage === 'setup') {
        // Manual: clutch held to the floor, gear 1, handbrake off, then the pedal up. Automatic: the
        // selector, then P; there is no pedal to hold.
        const at = ticks + lateTicks;
        if (automatic) {
          if (s.gear <= 0 && ticks - lastD > 40) {
            lastD = ticks;
            queue.push({ at, held: new Set(), pressed: ['KeyD'] });
          } else if (s.gear > 0 && s.handbrake && ticks - lastP > 40) {
            lastP = ticks;
            queue.push({ at, held: new Set(), pressed: ['KeyP'] });
          } else if (s.gear > 0 && !s.handbrake) stage = 'approach';
        } else if (s.gear !== 1) {
          queue.push({ at, held: new Set(['Space']), pressed: s.clutch > 0.97 ? ['Digit1'] : [] });
        } else if (s.handbrake) {
          if (ticks - lastP > 40) {
            lastP = ticks;
            queue.push({ at, held: new Set(['Space']), pressed: ['KeyP'] });
          }
        } else {
          queue.push({ at, held: new Set(), pressed: [] });
          stage = 'approach';
        }
      } else if (stage === 'approach') {
        const aid = ex.stop(s, ruleset);
        const brakeNow = new Set<string>(['ArrowDown']);
        if (!automatic) brakeNow.add('Space');
        if (literal) {
          // The sentence's trigger: "bấm ngay". It stays on until the stop, so a poll can read it
          // twice; only the first reading is a new instruction.
          if (aid?.now === true && !lastAid) {
            lastAid = true;
            queue.push({ at: ticks + lateTicks, held: brakeNow, pressed: [] });
          }
        } else if (aid && !planned && aid.etaMs > 0 && aid.etaMs <= reactMs) {
          // The countdown: the hand starts now so the key lands on the bar's mark.
          planned = true;
          queue.push({ at: ticks + lateTicks, held: brakeNow, pressed: [] });
        }
        if (s.phase === 'stopped') stage = 'stopping';
      } else if (stage === 'stopping' && Math.abs(s.speedMps) < 0.02) {
        // Stopped inside A: the advice line says "Qua vạch rồi chạy tiếp". Let go and the car creeps
        // on by itself — no pedal is asked for.
        stage = 'away';
        queue.push({ at: ticks + lateTicks, held: new Set(), pressed: [] });
      }
    }
    const pressed: string[] = [];
    while (queue.length && queue[0].at <= ticks) {
      const e = queue.shift()!;
      held = e.held;
      pressed.push(...e.pressed);
    }
    const r = session.step(driver.step(held, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = r.state;
    for (const e of r.events) {
      const id = ids.get(e.code);
      if (id) pents.push(id);
    }
  }
  const out: RoadOutcome = {
    finished: s.phase === 'done' && !s.disqualified,
    disqualified: s.disqualified,
    score: s.score,
    stopA: s.stopGapAM,
    pents: [...new Set(pents)],
    runS: ticks / 60,
  };
  session.dispose();
  return out;
}
