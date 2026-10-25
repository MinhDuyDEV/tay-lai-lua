// Does a keyboard stop-and-start on bài 3's slope work? Runs the real sim.wasm with the real driver.
// Run `task build` first (it writes build/sim.wasm).
//
// A person acts late, not on the dot. The learner here follows the page's cue sequence in order — the
// `slow` / `clutch` / `brake` names the advice line publishes in `data-cue` — and each of the three
// key groups (clutch, brake, the rest) has its own lag of 100, 250 or 400 ms. All 27 combinations
// must stop inside A, pull away without a stall or a penalty and roll back no more than the law
// allows, from every approach speed up to 2.5 m/s. Then the same sweep with the technique that
// holds the car on the slope removed must fail, or the sweep proves nothing about the start; and the
// same at 2.5 m/s with the `slow` stage ignored, or the sweep proves nothing about the speed advice.
//
// Why the page needs `slow` at all: a cue is a key press, so the distance the car covers before the
// key lands grows by 0.3 m for every m/s of approach speed (100 to 400 ms of reaction). A is 0.5 m,
// so from about 1.5 m/s that spread alone fills the window whatever distance the stop cue is given
// at. Above that speed the honest thing for the page to say is "too fast, slow down"; the stop cue
// is then issued from the speed the learner has actually reached.
//
// Technique: slow first (Space, then the brake until the line says the speed is in the band), then
// clutch before brake. Brake before clutch in gear stalls the engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Ruleset } from '../src/ruleset.ts';
import { STATE_LEN, readState, type SimState } from '../src/sim/contract.ts';
import { seedWord } from '../src/sim/session.ts';
import { cueBai3 } from '../src/steps.ts';
import { createDriver } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const ruleset = JSON.parse(readFileSync(RULESET_FILE, 'utf8')) as Ruleset;
const { max_a_m: MAX_A, max_rollback_m: MAX_ROLLBACK } = ruleset.hill!;
const CODE = { TUT_DOC: 13 } as const;

const x = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports as any;

const LATENCY = [6, 15, 24] as const; // ticks: 100, 250, 400 ms from the cue to the key
const BITE = 0.65; // let the handbrake go when the clutch bar has come up this far
const PAUSE_TICKS = 30; // a breath between the stop and the start
const FUMBLE_TICKS = 60; // the same, for a learner with nothing holding the car
/** Approach speeds the sweep drives at: creep, then every speed up to the 2.5 m/s of the brief. */
const APPROACH = [0, 1.0, 1.75, 2.0, 2.5] as const;

interface Latency {
  clutch: number;
  brake: number;
  rest: number;
}

interface Result {
  stalled: boolean;
  codes: number[];
  stopGapA: number;
  rollbackMax: number;
  maxRpm: number;
  finished: boolean;
  cues: string[];
  approachMps: number;
}

interface Options {
  /** What keeps the car still between the stop and the start. */
  holdWith: 'handbrake' | 'nothing';
  /** The speed the learner drives at before the page's first cue; 0 is the car's own creep. */
  approach: number;
  /**
   * false drops the `slow` stage's keys: the learner is told the speed is too fast and does nothing
   * about it. The sweep must then fail, or it proves nothing about the speed advice.
   */
  followSlow?: boolean;
}

/** One whole run from the keyboard, following the page's cues in the order they appear. */
function drive(latency: Latency, { holdWith, approach, followSlow = true }: Options): Result {
  const handle = x.sim_create(seedWord(3));
  assert.notEqual(handle, 0, 'sim.wasm refused the bài 3 seed word');
  const inPtr = x.sim_alloc(8);
  const statePtr = x.sim_alloc(STATE_LEN * 8);
  const evPtr = x.sim_alloc(8 * 64);
  const read = () => {
    const n = x.sim_state(handle, statePtr, STATE_LEN);
    return readState(new Float64Array(x.memory.buffer, statePtr, STATE_LEN), n);
  };

  const driver = createDriver();
  const wanted: Set<string>[] = [];
  let held = new Set<string>();
  let s: SimState = read();
  let stage: 'setup' | 'approach' | 'hold' | 'launch' = 'setup';
  let lastP = -Infinity;
  let stoppedAt = 0;
  let released = false;
  let cued = false;
  /** Once the page has said the car is too fast the learner never presses the throttle again. */
  let slowing = false;
  const codes: number[] = [];
  const cues: string[] = [];
  const out: Result = {
    stalled: false,
    codes,
    stopGapA: 0,
    rollbackMax: 0,
    maxRpm: 0,
    finished: false,
    cues,
    approachMps: s.speedMps,
  };

  /** The keys the learner wants down now, from what the screen shows. */
  const want = (t: number): Set<string> => {
    const k = new Set<string>();
    // A person does not press P twice within a second because the light has not changed yet.
    const tapP = () => {
      if (t - lastP > 40) {
        k.add('KeyP');
        lastP = t;
      }
    };
    switch (stage) {
      case 'setup':
        k.add('Space');
        if (s.clutch > 0.95 && s.gear !== 1) k.add('Digit1');
        if (s.gear === 1 && s.handbrake) tapP();
        if (s.gear === 1 && !s.handbrake) stage = 'approach';
        break;
      case 'approach': {
        const cue = cueBai3(s, ruleset);
        if (cues.at(-1) !== cue && cue) cues.push(cue);
        // 'slow' is a speed instruction, so the learner presses the clutch before the brake: a brake
        // in gear pulls the engine down to a stall on this slope.
        // 'slow' is a speed instruction: the learner lifts off the throttle, and the engine brake
        // brings the car back to its creep. The keys come later, from the stop cue itself.
        if (cue === 'slow') {
          slowing = true;
          if (!followSlow) k.add('ArrowUp');
        } else if (cue === 'clutch') k.add('Space');
        else if (cue === 'brake') {
          k.add('Space');
          k.add('ArrowDown');
        } else if (!cued && approach > 0 && s.speedMps < approach) k.add('ArrowUp');
        if (cue) cued = true;
        out.approachMps = Math.max(out.approachMps, s.speedMps);
        if (s.sinceStopTicks >= 0) {
          stoppedAt = t;
          stage = 'hold';
        }
        break;
      }
      case 'hold':
        k.add('Space');
        if (holdWith === 'handbrake') {
          k.add('ArrowDown');
          if (!s.handbrake) tapP();
          // Brake foot comes off once the handbrake light is on.
          if (s.handbrake && t - stoppedAt > PAUSE_TICKS) {
            k.delete('ArrowDown');
            stage = 'launch';
          }
        } else if (t - stoppedAt > FUMBLE_TICKS) stage = 'launch';
        break;
      case 'launch':
        // Clutch up through the bite with the throttle held; the handbrake goes at the bite.
        if (!released || s.clutch > 0.05) k.add('ArrowUp');
        if (!released && s.clutch <= BITE) {
          released = true;
          if (s.handbrake) tapP();
        }
        break;
    }
    return k;
  };

  const keyLatency = (code: string) =>
    code === 'Space' ? latency.clutch : code === 'ArrowDown' ? latency.brake : latency.rest;

  for (let t = 0; t < 3600 && !(s.phase === 'done' || s.disqualified); t++) {
    wanted.push(want(t));
    const down = new Set<string>();
    for (const code of ['Space', 'ArrowUp', 'ArrowDown', 'KeyP', 'Digit1']) {
      if (wanted[t - keyLatency(code)]?.has(code)) down.add(code);
    }
    const pressed = [...down].filter((code) => !held.has(code));
    held = down;
    const bytes = driver.step(down, pressed, { speedMps: s.speedMps, engineOn: s.engineOn });
    new Uint8Array(x.memory.buffer, inPtr, 8).set(bytes);
    const wasOn = s.engineOn;
    x.sim_step(handle, inPtr);
    const n = x.sim_drain_events(handle, evPtr, 64);
    for (let i = 0; i < n; i++) codes.push(new DataView(x.memory.buffer).getUint16(evPtr + i * 8 + 4, true));
    s = read();
    if (wasOn && !s.engineOn) out.stalled = true;
    out.rollbackMax = Math.max(out.rollbackMax, s.rollbackM);
    out.maxRpm = Math.max(out.maxRpm, s.rpm);
  }
  out.stopGapA = s.stopGapAM;
  out.finished = s.phase === 'done' && !s.disqualified;
  x.sim_destroy(handle);
  return out;
}

/** Every early / on time / late combination of the three key groups, at every approach speed. */
function sweep(options: Options, speeds: readonly number[] = APPROACH): string[] {
  const failures: string[] = [];
  let low = Infinity;
  let high = -Infinity;
  for (const approach of speeds) {
    for (const clutch of LATENCY) {
      for (const brake of LATENCY) {
        for (const rest of LATENCY) {
          const r = drive({ clutch, brake, rest }, { ...options, approach });
          low = Math.min(low, r.stopGapA);
          high = Math.max(high, r.stopGapA);
          const inside = r.stopGapA >= 0 && r.stopGapA <= MAX_A;
          if (r.stalled || r.codes.length > 0 || !r.finished || !inside || r.rollbackMax > MAX_ROLLBACK) {
            failures.push(
              `approach ${approach} clutch ${clutch} brake ${brake} rest ${rest}: A=${r.stopGapA.toFixed(3)} reached=${r.approachMps.toFixed(2)} rollback=${r.rollbackMax.toFixed(3)} stalled=${r.stalled} finished=${r.finished} cues=[${r.cues}] codes=[${r.codes}]`,
            );
          }
        }
      }
    }
  }
  if (options.holdWith === 'handbrake' && options.followSlow !== false) {
    console.log(`     A over the ${speeds.length}×27 combinations: ${low.toFixed(3)} to ${high.toFixed(3)} m of ${MAX_A}`);
  }
  return failures;
}

test('a learner following the page cues 100 to 400 ms late, at 2.5 m/s and every speed below it, stops inside A and starts again', () => {
  assert.deepEqual(sweep({ holdWith: 'handbrake', approach: 0 }), []);
});

test('the same sweep fails when the learner ignores the page telling them they are too fast', () => {
  const failures = sweep({ holdWith: 'handbrake', approach: 0, followSlow: false }, [1.75, 2.0, 2.5]);
  assert.notEqual(failures.length, 0, 'the sweep passes while ignoring "slow", so it proves nothing about the speed advice');
});

test('the same sweep fails when nothing holds the car on the slope between the stop and the start', () => {
  const failures = sweep({ holdWith: 'nothing', approach: 0 }, [0]);
  assert.notEqual(failures.length, 0, 'the sweep passes with no hold, so it proves nothing about the start');
  for (const line of failures) {
    // A stall can come first as the car rolls back; it is part of the same mistake.
    assert.ok(/codes=\[(13|7|13,7|7,13)\]/.test(line), `failed for another reason: ${line}`);
  }
  assert.ok(failures.some((line) => line.includes(`${CODE.TUT_DOC}`)), 'no failure was the rollback itself');
});
