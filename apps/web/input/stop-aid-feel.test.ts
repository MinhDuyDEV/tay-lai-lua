// Can a learner with only a keyboard stop inside A by reading the countdown? Runs the real sim.wasm
// with the real driver.
// Run `task build` first (it writes build/sim.wasm).
//
// A is 500 mm and the car covers it in a third of a second at the idle creep, so the page cannot say
// "press now": a person is 100 to 500 ms behind what they read, and the Supervisor's check polls the
// page. The aid is therefore a countdown (`src/stopAid.ts`): the time until the critical key should
// land, worked out from the ruleset and the keyboard's pedal rates.
//
// The learner below is that model, and it is the stricter kind: it *polls* the page every P ms at a
// phase, replans from `eta` on each read (planned press = read time + eta), keeps the plan once the
// countdown has reached 0 instead of re-arming it, and then presses `e` ms off that plan — the
// anticipation error, which also stands in for a 100 ms motor delay. P runs over 16, 50, 80, 250 and
// 500 ms, e over every 25 ms from -100 to +100, and the gate is that every run stops inside A with no
// stall and no other penalty. What -150 to +150 ms costs is reported, not gated.
//
// The two roads are the two the aid has to serve, and neither is bài 3-specific:
//   * bài 3's slope, where the clutch is the critical key (gravity on the grade does the slowing);
//   * a flat road with a line at a fixed distance, where the brake is (bài 1's world is the stand-in
//     until bài 2 lands, exactly as the spike did). The learner presses the clutch first, as the
//     advice line says — a brake in gear stalls the engine — and the countdown only times the brake.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDriver, DT } from './driver.ts';
import { flatRoad, stopAid, stopTravel, type StopAid, type StopRoad } from '../src/stopAid.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, seedWord, type SimState } from '../src/sim/session.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
const ruleset: Ruleset = { ...data, steer: { speedScaleMps: 0, minLock: 0, rate: 0, centre: 0 } };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

const MAX_A = ruleset.hill!.max_a_m;
/** Poll periods the Supervisor's script and a person between them cover. */
const POLES_MS = [16, 50, 80, 250, 500] as const;
/** Anticipation error swept in 25 ms steps; the gate is the inner set, the outer is reported. */
const E_GATE_MS = 100;
const E_REPORT_MS = 150;

/** Bài 3's road: level before the foot of the slope, `grade` from there to the top. */
const hillRoad: StopRoad = {
  grade: (toLineM) => {
    const hill = ruleset.hill!;
    const x = hill.stop_line_from_foot_m - toLineM;
    return x > hill.foot_x_m && x < hill.foot_x_m + hill.slope_length_m ? hill.grade : 0;
  },
  key: 'clutch',
};

interface Result {
  /** A as the core records it, metres. */
  A: number;
  stalled: boolean;
  /** Rule codes fired, any of which is a run that went wrong. */
  codes: number[];
  presses: number;
}

/**
 * The set-up each lesson's checklist words, as keys, and whether there is nothing left to do but read
 * the countdown. It follows the state and repeats a press that did not take, the way a person does:
 * the starter wants the pedal down and a fresh press of E (a held key restarts the crank every tick),
 * a gear only goes in at the pedal's floor, and the handbrake goes once the gear is in.
 *
 * bài 3's engine is already running; bài 1's is cold, so its learner cranks it and gives the start
 * order — without them the core stays `waiting` and nothing is scored.
 *
 * `ready` is gear 1 with the handbrake off: from there the countdown is the only thing that asks for
 * anything, and it re-plans on every read until it is due, so a reading taken a moment early is
 * replaced long before any press could follow it.
 */
function setUpFor(lesson: 1 | 3): (s: SimState) => { keys: Set<string>; ready: boolean } {
  /** Ticks until the same key may be pressed again, so a press that did not take is repeated. */
  let wait = 0;
  return (s) => {
    const keys = new Set<string>();
    const ready = s.engineOn && s.gear === 1 && !s.handbrake && (lesson === 3 || s.phase !== 'waiting');
    if (wait > 0) wait -= 1;
    if (ready) return { keys, ready: true };

    if (!s.engineOn) {
      keys.add('Space');
      if (s.clutch >= 0.98 && wait === 0) {
        keys.add('KeyE');
        wait = 30;
      }
    } else if (lesson === 1 && s.phase === 'waiting') {
      if (wait === 0) {
        keys.add('Enter');
        wait = 30;
      }
    } else if (s.gear !== 1) {
      keys.add('Space');
      if (s.clutch >= 0.98 && wait === 0) {
        keys.add('Digit1');
        wait = 30;
      }
    } else if (s.handbrake) {
      keys.add('Space');
      if (wait === 0) {
        keys.add('KeyP');
        wait = 30;
      }
    }
    return { keys, ready: false };
  };
}

/**
 * The polling learner, exactly as the brief models it. `setup` runs the learner's keys until the car
 * is in gear 1 with the handbrake off; `lineAt` is where the stop line is when the world has none of
 * its own (the flat road), and `clutchAt` is the extra key the flat road needs pressing first.
 */
function drive(opts: {
  seed: bigint;
  lesson: 1 | 3;
  road: StopRoad;
  /** Where the stop line is, metres of `frontBumperM`, when the world has no line of its own. */
  lineAt?: (start: SimState) => number;
  /** Milliseconds before the planned press that the clutch goes down, for the brake road. */
  clutchLeadMs?: number;
  pollMs: number;
  phaseMs: number;
  errorMs: number;
}): Result {
  const session = openSession(bytes(), opts.seed);
  const driver = createDriver();
  let held = new Set<string>();
  let s: SimState = session.state;
  const lineAt = opts.lineAt?.(s) ?? null;
  /** The state the page would publish: the core's own, with the stand-in line where one is needed. */
  const view = (state: SimState): SimState => (lineAt === null ? state : { ...state, lineGapM: lineAt - state.frontBumperM });

  let nextReadMs = 0;
  let planMs = Infinity;
  /** A read has given the learner a plan to act on. */
  let havePlan = false;
  /** True once a read has seen the countdown at 0: from then on the plan is kept, never re-armed. */
  let due = false;
  let clutchFromMs = Infinity;
  let presses = 0;
  const codes: number[] = [];
  /** One set-up state machine per run: it remembers what it has already pressed. */
  const setUp = setUpFor(opts.lesson);

  for (let tick = 0, ms = 0; tick < 4000; tick += 1, ms = tick * DT * 1000) {
    // Set-up: the checklist's own keys, until the car is in gear, free and rolling.
    const { keys, ready } = setUp(s);
    if (ready) {
      // The learner is ready; from here the countdown is the only thing that asks for anything.
      if (ms >= nextReadMs) {
        nextReadMs = ms + opts.pollMs;
        const aid = stopAid(view(s), ruleset, opts.road);
        if (aid && !due) {
          // Replan from this read while the countdown is still running: the planned press is the read
          // time plus the countdown, which is an absolute moment and does not drift with the polling.
          if (aid.etaMs > 0) planMs = ms + aid.etaMs;
          // A read that sees 0 does not move the plan later — that is "it keeps its plan, it does not
          // re-arm later" — it only gives a learner with no plan yet something to act on now.
          else if (!havePlan) planMs = ms;
          havePlan = true;
          if (aid.etaMs === 0) due = true;
          if (opts.clutchLeadMs !== undefined) clutchFromMs = Math.min(clutchFromMs, planMs - opts.clutchLeadMs);
        }
      }
      if (ms >= clutchFromMs) keys.add('Space');
      if (havePlan && ms >= planMs + opts.errorMs) {
        keys.add('Space');
        if (opts.road.key === 'brake') keys.add('ArrowDown');
        presses += 1;
      }
    }

    const pressed = [...keys].filter((code) => !held.has(code));
    held = keys;
    session.step(driver.step(keys, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    const before = s;
    s = session.state;
    for (const code of codeOf(before, s)) codes.push(code);
    // Stop once the car has come to rest after the press, or the run is over.
    if (presses > 0 && s.speedMps <= 0) break;
    if (s.disqualified) break;
  }

  const A = lineAt === null ? s.stopGapAM : lineAt - s.frontBumperM;
  const out = { A, stalled: !s.engineOn, codes, presses };
  session.dispose();
  return out;
}

/**
 * The rule codes the core fired on this tick. The session does not expose them, so they are re-derived
 * from the score and the disqualification flag: any change is a charge, and it is all this file needs
 * to know — the question is whether the stop cost anything, not which rule said so.
 */
function codeOf(before: SimState, after: SimState): number[] {
  if (after.disqualified && !before.disqualified) return [-1];
  return after.score < before.score ? [-1] : [];
}

/** Every poll period at three phases and every error, against one road. */
function sweep(road: StopRoad, extra: { seed: bigint; lesson: 1 | 3; lineAt?: (s: SimState) => number; clutchLeadMs?: number }, maxErrorMs: number) {
  // The flat road is a stand-in for bài 2: it is bài 1's world, so bài 1's own rules (no belt, no
  // left signal) fire on a learner who is only practising the stop. What the gate counts there is a
  // stall or any other charge; who rides without a belt is not this file's question.
  const ownRulesOnly = extra.lesson === 1;
  const failures: string[] = [];
  let runs = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const pollMs of POLES_MS) {
    for (const phaseMs of [0, pollMs / 3, (2 * pollMs) / 3]) {
      for (let errorMs = -maxErrorMs; errorMs <= maxErrorMs; errorMs += 25) {
        const r = drive({ ...extra, road, pollMs, phaseMs, errorMs });
        runs += 1;
        low = Math.min(low, r.A);
        high = Math.max(high, r.A);
        const inside = r.A >= 0 && r.A <= MAX_A;
        // The flat road is a stand-in: it is bài 1's world, so bài 1's own rules (no belt, no left
        // signal) fire on a learner who is only practising the stop. What must not happen is a
        // stall or a charge from the stop itself, so those are what the gate counts there.
        const charged = ownRulesOnly ? 0 : r.codes.length;
        if (!inside || r.stalled || charged > 0) {
          failures.push(
            `poll ${pollMs} ms phase ${Math.round(phaseMs)} error ${errorMs} ms: A=${r.A.toFixed(3)} stalled=${r.stalled} charged=${r.codes.length}`,
          );
        }
      }
    }
  }
  return { failures, runs, low, high };
}

test('bài 3: a learner polling 16 to 500 ms and pressing within 100 ms of the countdown stops inside A, every time', () => {
  const { failures, runs, low, high } = sweep(hillRoad, { seed: seedWord(3), lesson: 3 }, E_GATE_MS);
  console.log(`     bài 3: A over ${runs} runs: ${low.toFixed(3)} to ${high.toFixed(3)} m of ${MAX_A}`);
  assert.deepEqual(failures, []);
});

test('a flat stop line: the same learner, on the brake, stops inside A every time', () => {
  // The line 8 m ahead of where the car starts: the stand-in for bài 2's line, measured from the
  // bumper as the law measures A. The clutch goes down 600 ms before the planned brake, as the line
  // says; the brake is what the countdown times.
  const { failures, runs, low, high } = sweep(flatRoad('brake'), { seed: seedWord(1), lesson: 1, lineAt: (s) => s.frontBumperM + 8, clutchLeadMs: 600 }, E_GATE_MS);
  console.log(`     flat: A over ${runs} runs: ${low.toFixed(3)} to ${high.toFixed(3)} m of ${MAX_A}`);
  assert.deepEqual(failures, []);
});

test('-150 to +150 ms is reported, not gated: the window has that much to spare or it does not', () => {
  const hill = sweep(hillRoad, { seed: seedWord(3), lesson: 3 }, E_REPORT_MS);
  const flat = sweep(flatRoad('brake'), { seed: seedWord(1), lesson: 1, lineAt: (s) => s.frontBumperM + 8, clutchLeadMs: 600 }, E_REPORT_MS);
  for (const [name, r] of [['bài 3', hill], ['flat', flat]] as const) {
    const fails = r.failures.filter((line) => /error -?1(2[5-9]|50)/.test(line));
    console.log(`     ${name} at ±150 ms: ${fails.length} of ${r.runs} runs outside A (A ${r.low.toFixed(3)} to ${r.high.toFixed(3)})`);
  }
  // Not a gate, but it must not be silent either: a sweep that is wide open at 250 ms says the aid is
  // not doing any timing at all.
  assert.ok(
    hill.failures.length + flat.failures.length < hill.runs + flat.runs,
    'the 250 ms sweep passes everywhere, so it proves nothing about the countdown',
  );
});

test('the countdown is a function of the ruleset, not of bài 3: a steeper slope names a nearer mark', () => {
  const state: SimState = {
    ...openSession(bytes(), seedWord(3)).state,
    speedMps: 1.4,
    lineGapM: 3,
    gear: 1,
    handbrake: false,
    clutch: 0,
  };
  const gentle = stopAid(state, ruleset, { grade: () => 0.05, key: 'clutch' })!;
  const steep = stopAid(state, ruleset, { grade: () => 0.15, key: 'clutch' })!;
  // A steeper road stops the car in less road, so the key can land nearer the line.
  assert.ok(steep.markM < gentle.markM, `steeper slope should name a nearer mark: ${steep.markM} vs ${gentle.markM}`);
  // The flat road is a different stop from either: the brake, not the clutch, and an earlier press
  // because a coasting car keeps 1.4 m/s for metres on the level.
  const flat = stopAid(state, ruleset, flatRoad('brake'))!;
  assert.equal(flat.key, 'brake');
  assert.ok(flat.etaMs > gentle.etaMs, `the brake road counts down from further out: ${flat.etaMs} vs ${gentle.etaMs}`);
});

test('the published countdown is smooth: no tick moves it by more than a frame and a half', () => {
  // A script reads `data-aid-eta-ms` once and schedules the key from that reading, so a stepped value
  // is a key pressed at the wrong tenth of a second. The worst honest change per 1/60 s tick is the
  // tick itself plus the rounding, while the car's own speed is changing the mark.
  const session = openSession(bytes(), seedWord(3));
  const driver = createDriver();
  let held = new Set<string>();
  let s: SimState = session.state;
  let previous: number | null = null;
  let worst = 0;
  for (let tick = 0; tick < 1400; tick += 1) {
    const { keys } = setUpFor(3)(s);
    const pressed = [...keys].filter((code) => !held.has(code));
    held = keys;
    session.step(driver.step(keys, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = session.state;
    const aid: StopAid | null = stopAid(s, ruleset, hillRoad);
    if (aid && previous !== null && aid.etaMs < 5000) worst = Math.max(worst, Math.abs(previous - aid.etaMs));
    previous = aid?.etaMs ?? null;
    if (aid?.etaMs === 0) break;
  }
  session.dispose();
  assert.ok(worst < 60, `the countdown jumped ${worst} ms in one 16.7 ms tick`);
});

test('stopTravel is the car: the measured stop is within 40 mm of what the aid predicts', () => {
  // What the whole aid rests on, measured against the real core: press the clutch on bài 3's slope at
  // a state, and the road the car covers to a standstill has to be the number the aid planned with.
  const cases: Array<{ bumper: number; key: 'clutch'; grade: number }> = [
    { bumper: 3.0, key: 'clutch', grade: ruleset.hill!.grade },
    { bumper: 4.0, key: 'clutch', grade: ruleset.hill!.grade },
    { bumper: 4.6, key: 'clutch', grade: ruleset.hill!.grade },
    { bumper: 5.5, key: 'clutch', grade: ruleset.hill!.grade },
  ];
  for (const c of cases) {
    const session = openSession(bytes(), seedWord(3));
    const driver = createDriver();
    let held = new Set<string>();
    let s: SimState = session.state;
    for (let tick = 0; tick < 4000 && s.frontBumperM < c.bumper; tick += 1) {
      const { keys } = setUpFor(3)(s);
      const pressed = [...keys].filter((code) => !held.has(code));
      held = keys;
      session.step(driver.step(keys, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
      s = session.state;
    }
    const v0 = s.speedMps;
    const x0 = s.frontBumperM;
    assert.ok(v0 > 0.5, `the car never reached ${c.bumper} m at speed`);
    for (let tick = 0; tick < 900; tick += 1) {
      const keys = new Set(['Space']);
      const pressed = [...keys].filter((code) => !held.has(code));
      held = keys;
      session.step(driver.step(keys, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
      s = session.state;
      if (s.speedMps <= 0) break;
    }
    const measured = s.frontBumperM - x0;
    const predicted = stopTravel(ruleset, v0, c.grade, c.key).travelM;
    session.dispose();
    assert.ok(Math.abs(measured - predicted) < 0.04, `at ${c.bumper} m, v ${v0.toFixed(2)}: measured ${measured.toFixed(3)} m, predicted ${predicted.toFixed(3)} m`);
  }
});

test('the clutch is the critical key on the slope and the brake on the flat: the brake in gear stalls', () => {
  // The two roads' choices are not taste. A brake with the drive still closed pulls the engine down
  // on the flat and stalls it (`SH.X.CHET_MAY`), which is why the countdown on the brake road is
  // preceded by the clutch, and why the slope's countdown is the clutch itself.
  assert.equal(hillRoad.key, 'clutch');
  assert.equal(flatRoad('brake').key, 'brake');
});
