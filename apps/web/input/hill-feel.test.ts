// Does a keyboard stop-and-start on bài 3's slope work? Runs the real sim.wasm with the real driver.
// Run `task build` first (it writes build/sim.wasm).
//
// A person acts late, not on the dot. The learner here does what the page tells them (the cue on
// the advice line, `cueBai3`, and the handbrake light) a lag after it appears, and each of the
// three key groups (clutch, brake, the rest) has its own lag of 100, 250 or 400 ms. All 27
// combinations must stop inside A, pull away without a stall or a penalty and roll back no more
// than the law allows. Then the same sweep with the technique that holds the car on the slope
// removed must fail, or the sweep proves nothing about the start.
//
// Technique: clutch first, then brake. Idle creep takes the car up at about 1.3 m/s, so the lags
// span 0.39 m of road against a 0.5 m window: the clutch cue comes early and the slope's own
// deceleration slows the car; the brake cue comes when it is nearly still. Brake before clutch
// stalls the engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STATE_LEN, readState, type SimState } from '../src/sim/contract.ts';
import { seedWord } from '../src/sim/session.ts';
import { cueBai3 } from '../src/steps.ts';
import { createDriver } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const hill = JSON.parse(readFileSync(RULESET, 'utf8')).hill as { max_a_m: number; max_rollback_m: number };
const CODE = { TUT_DOC: 13 } as const;

const x = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports as any;

const LATENCY = [6, 15, 24] as const; // ticks: 100, 250, 400 ms from the cue to the key
const BITE = 0.65; // let the handbrake go when the clutch bar has come up this far
const PAUSE_TICKS = 30; // a breath between the stop and the start
const FUMBLE_TICKS = 60; // the same, for a learner with nothing holding the car

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
}

/** One whole run from the keyboard. `holdWith` is what keeps the car still between stop and start. */
function drive(latency: Latency, holdWith: 'handbrake' | 'nothing'): Result {
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
  const codes: number[] = [];
  const out: Result = { stalled: false, codes, stopGapA: 0, rollbackMax: 0, maxRpm: 0, finished: false };

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
      case 'approach':
        if (cueBai3(s)) k.add('Space');
        if (cueBai3(s) === 'brake') k.add('ArrowDown');
        if (s.sinceStopTicks >= 0) {
          stoppedAt = t;
          stage = 'hold';
        }
        break;
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

/** Every early / on time / late combination of the three key groups; returns what went wrong. */
function sweep(holdWith: 'handbrake' | 'nothing'): string[] {
  const failures: string[] = [];
  let low = Infinity;
  let high = -Infinity;
  for (const clutch of LATENCY) {
    for (const brake of LATENCY) {
      for (const rest of LATENCY) {
        const r = drive({ clutch, brake, rest }, holdWith);
        low = Math.min(low, r.stopGapA);
        high = Math.max(high, r.stopGapA);
        const inside = r.stopGapA >= 0 && r.stopGapA <= hill.max_a_m;
        if (r.stalled || r.codes.length > 0 || !r.finished || !inside || r.rollbackMax > hill.max_rollback_m) {
          failures.push(
            `clutch ${clutch} brake ${brake} rest ${rest}: A=${r.stopGapA.toFixed(3)} rollback=${r.rollbackMax.toFixed(3)} stalled=${r.stalled} finished=${r.finished} codes=[${r.codes}]`,
          );
        }
      }
    }
  }
  if (holdWith === 'handbrake') console.log(`     A over the 27 combinations: ${low.toFixed(3)} to ${high.toFixed(3)} m of ${hill.max_a_m}`);
  return failures;
}

test('a stop and a start on the slope, acted on the page cue 100 to 400 ms late, stays inside A and rolls back less than 500 mm', () => {
  assert.deepEqual(sweep('handbrake'), []);
});

test('the same sweep fails when nothing holds the car on the slope between the stop and the start', () => {
  const failures = sweep('nothing');
  assert.notEqual(failures.length, 0, 'the sweep passes with no hold, so it proves nothing about the start');
  for (const line of failures) assert.ok(line.includes(`${CODE.TUT_DOC}`), `failed for another reason: ${line}`);
});
