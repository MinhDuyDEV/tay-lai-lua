// Does a keyboard launch of bài 1 work? Runs the real sim.wasm with the real driver.
// Run `task build` first (it writes build/sim.wasm).
//
// A person's timing is not exact, so the launch is swept by +-150 ms (9 ticks): when the clutch is
// let go and when the throttle goes down. Every one of those launches must pull away without
// stalling or breaking a rule. Then the same sweep runs with the slow bite switched off and must
// fail: if it does not, the sweep proves nothing about the bite zone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DT, FEEL, createDriver } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const STATE_LEN = 21;
const S = { tick: 0, phase: 1, speed: 7, rpm: 8, bumper: 9, engineOn: 10, score: 2 } as const;
const CODE = { DAY_AN_TOAN: 1, CHET_MAY: 7, RPM: 8 } as const;

const wasm = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {});
const x = wasm.exports as any;

interface Result {
  stalled: boolean;
  codes: number[];
  bumper: number;
  speed: number;
  maxRpm: number;
}

/** Keys held per tick, as a person would: `at` ticks -> codes pressed, `hold` -> codes held. */
interface Script {
  press: Record<number, string[]>;
  held: (t: number) => string[];
  until: (bumper: number, t: number) => boolean;
}

function run(script: Script): Result {
  const handle = x.sim_create(1n);
  const inPtr = x.sim_alloc(8);
  const statePtr = x.sim_alloc(STATE_LEN * 8);
  const evPtr = x.sim_alloc(8 * 64);
  const driver = createDriver();
  const mem = () => new DataView(x.memory.buffer);
  const state = () => {
    x.sim_state(handle, statePtr, STATE_LEN);
    return Array.from({ length: STATE_LEN }, (_, i) => mem().getFloat64(statePtr + i * 8, true));
  };

  let s = state();
  let maxRpm = 0;
  let stalled = false;
  for (let t = 0; t < 2400; t++) {
    const bytes = driver.step(new Set(script.held(t)), script.press[t] ?? [], {
      speedMps: s[S.speed],
      engineOn: s[S.engineOn] === 1,
    });
    new Uint8Array(x.memory.buffer, inPtr, 8).set(bytes);
    x.sim_step(handle, inPtr);
    const was = s[S.engineOn] === 1;
    s = state();
    maxRpm = Math.max(maxRpm, s[S.rpm]);
    if (was && s[S.engineOn] === 0 && s[S.phase] !== 0) stalled = true;
    if (script.until(s[S.bumper], t)) break;
  }
  const n = x.sim_drain_events(handle, evPtr, 64);
  const codes = Array.from({ length: n }, (_, i) => mem().getUint16(evPtr + i * 8 + 4, true));
  const result = { stalled, codes, bumper: s[S.bumper], speed: s[S.speed], maxRpm };
  x.sim_destroy(handle);
  return result;
}

const TICKS = Math.round(0.15 / DT); // 150 ms
const SETUP_END = 90; // belt, signal, order, clutch down, gear 1, handbrake off: all done by here
const LAUNCH = SETUP_END; // nominal moment the clutch starts to lift and the throttle goes down

/** The whole journey: crank, belt, signal, order, clutch, gear 1, release handbrake, pull away. */
function launch(clutchAt: number, throttleAt: number, throttleFor: number): Script {
  return {
    press: {
      0: ['KeyE', 'KeyB', 'KeyQ'],
      40: ['Enter'],
      60: ['Digit1'],
      70: ['KeyP'],
    },
    held: (t) => {
      const keys: string[] = [];
      if (t >= 40 && t < clutchAt) keys.push('Space');
      if (t >= throttleAt && t < throttleAt + throttleFor) keys.push('ArrowUp');
      return keys;
    },
    until: (bumper, t) => bumper > 4.5 || t > 1500,
  };
}

function sweep(): string[] {
  const failures: string[] = [];
  for (const dClutch of [-TICKS, 0, TICKS]) {
    for (const dThrottle of [-TICKS, 0, TICKS]) {
      for (const hold of [-TICKS, 0, TICKS]) {
        const r = run(launch(LAUNCH + dClutch, LAUNCH + dThrottle, 150 + hold));
        if (r.stalled || r.bumper <= 4.5 || r.codes.length > 0) {
          failures.push(
            `clutch ${dClutch} throttle ${dThrottle} hold ${hold}: stalled=${r.stalled} bumper=${r.bumper.toFixed(2)} codes=[${r.codes}]`,
          );
        }
      }
    }
  }
  return failures;
}

test('a normal launch, off by up to 150 ms either way, pulls away without a stall or a penalty', () => {
  assert.deepEqual(sweep(), []);
});

test('the same sweep fails when the clutch does not slow down at the bite', () => {
  const clutch = FEEL.clutch as { liftBite: number };
  const kept = clutch.liftBite;
  clutch.liftBite = FEEL.clutch.liftFast;
  try {
    assert.notEqual(sweep().length, 0, 'the sweep passes without the bite zone, so it proves nothing');
  } finally {
    clutch.liftBite = kept;
  }
});
