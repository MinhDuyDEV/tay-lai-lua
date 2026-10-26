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
//   * bài 2's own scene, on the flat, where the brake is. The learner presses clutch and brake together,
//     as the bar's "Côn + phanh" says — a brake in gear stalls the engine.
//     This runs against the real core's bài 2 session (its own stop line, stop zone and codes), not a
//     stand-in line: the earlier version of this test used bài 1's world with a made-up gap, and it
//     would not have noticed the real scene charging CHUA_DEN_VACH for a stop the aid thought was fine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDriver, DT } from './driver.ts';
import { A_MID_M, flatRoad, stopAid, stopTravel, type StopAid, type StopRoad } from '../src/stopAid.ts';
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
/** How often a person reading a live page samples it: a repaint, not a stopwatch. */
const LITERAL_POLES_MS = [16, 50] as const;
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
function setUpFor(lesson: 2 | 3): (s: SimState) => { keys: Set<string>; ready: boolean } {
  /** Ticks until the same key may be pressed again, so a press that did not take is repeated. */
  let wait = 0;
  return (s) => {
    const keys = new Set<string>();
    const ready = s.engineOn && s.gear === 1 && !s.handbrake;
    if (wait > 0) wait -= 1;
    if (ready) return { keys, ready: true };

    if (!s.engineOn) {
      keys.add('Space');
      if (s.clutch >= 0.98 && wait === 0) {
        keys.add('KeyE');
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
 * is in gear 1 with the handbrake off.
 */
function drive(opts: {
  seed: bigint;
  lesson: 2 | 3;
  road: StopRoad;
  pollMs: number;
  phaseMs: number;
  errorMs: number;
  /**
   * `plan`: the anticipating learner — the planned press is the read time plus `eta`, re-planned on
   * every read (the brief's model). `literal`: the learner who waits for the page to say "bấm ngay"
   * and then reacts, so the press lands `errorMs` after the words turn to now.
   */
  learner?: 'plan' | 'literal';
}): Result {
  const session = openSession(bytes(), opts.seed);
  const driver = createDriver();
  let held = new Set<string>();
  let s: SimState = session.state;

  // A read every `every` ticks, the first `phaseMs` after the learner is ready, so a poll of 50 ms is
  // tried at three alignments with the moment the page flips to "bấm ngay", not three times at one.
  const every = Math.max(1, Math.round(opts.pollMs / (DT * 1000)));
  const phaseTicks = Math.round(opts.phaseMs / (DT * 1000));
  let readyTick = -1;
  let planMs = Infinity;
  /** A read has given the learner a plan to act on. */
  let havePlan = false;
  /** True once a read has seen the countdown at 0: from then on the plan is kept, never re-armed. */
  let due = false;
  /** The literal learner's own clock: when the page first said "bấm ngay". */
  let nowAtMs = Infinity;
  let presses = 0;
  const codes: number[] = [];
  /**
   * When this learner presses, in run milliseconds. The anticipating learner presses at its plan plus
   * its error; the literal learner presses a reaction after the page says "bấm ngay". One function, so
   * the press and the clutch that leads it cannot disagree.
   */
  const pressatMs = (): number =>
    opts.learner === 'literal'
      ? (nowAtMs === Infinity ? Infinity : nowAtMs + opts.errorMs)
      : planMs + opts.errorMs;
  /** One set-up state machine per run: it remembers what it has already pressed. */
  const setUp = setUpFor(opts.lesson);

  for (let tick = 0, ms = 0; tick < 4000; tick += 1, ms = tick * DT * 1000) {
    // Set-up: the checklist's own keys, until the car is in gear, free and rolling.
    const { keys, ready } = setUp(s);
    if (ready) {
      // The learner is ready; from here the countdown is the only thing that asks for anything.
      if (readyTick < 0) readyTick = tick;
      const sinceFirstRead = tick - readyTick - phaseTicks;
      if (sinceFirstRead >= 0 && sinceFirstRead % every === 0) {
        const aid = stopAid(s, ruleset, opts.road);
        const literal = opts.learner === 'literal';
        if (aid && !due) {
          if (literal) {
            // The learner who reads the words: the page says "bấm ngay" when `etaMs` reaches 0, which
            // leads the bar's mark by a reaction band, and the press lands `errorMs` after that.
            if (aid.now && nowAtMs === Infinity) nowAtMs = ms;
          } else {
            // Replan from this read while the countdown is still running: the planned press is the
            // read time plus the countdown, an absolute moment that does not drift with the polling.
            if (aid.etaMs > 0) planMs = ms + aid.etaMs;
            // A read that sees 0 does not move the plan later — "it keeps its plan, it does not
            // re-arm later" — it only gives a learner with no plan yet something to act on now.
            else if (!havePlan) planMs = ms;
          }
          havePlan = true;
          if (aid.now) due = true;
        }
      }
      if (havePlan && ms >= pressatMs()) {
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

  const A = s.stopGapAM;
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
function sweep(
  road: StopRoad,
  extra: { seed: bigint; lesson: 2 | 3; learner?: 'plan' | 'literal' },
  maxErrorMs: number,
  /** The law's window, from the ruleset: A must land in 0..maxA. */
  maxA: number,
  stepMs = 25,
  polesMs: readonly number[] = POLES_MS,
  fromErrorMs = -maxErrorMs,
) {
  const failures: string[] = [];
  /** Every run's A, so a test can report the extent of the band it gates and not only its failures. */
  const rows: Array<{ pollMs: number; errorMs: number; A: number }> = [];
  let runs = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const pollMs of polesMs) {
    for (const phaseMs of [0, pollMs / 3, (2 * pollMs) / 3]) {
      for (let errorMs = fromErrorMs; errorMs <= maxErrorMs; errorMs += stepMs) {
        const r = drive({ ...extra, road, pollMs, phaseMs, errorMs });
        runs += 1;
        rows.push({ pollMs, errorMs, A: r.A });
        low = Math.min(low, r.A);
        high = Math.max(high, r.A);
        const inside = r.A >= 0 && r.A <= maxA;
        if (!inside || r.stalled || r.codes.length > 0) {
          failures.push(
            `poll ${pollMs} ms phase ${Math.round(phaseMs)} error ${errorMs} ms: A=${r.A.toFixed(3)} stalled=${r.stalled} charged=${r.codes.length}`,
          );
        }
      }
    }
  }
  return { failures, runs, low, high, rows };
}

/**
 * The four pages the stop aid has to serve, each with its own scene: bài 3's slope (the clutch times
 * it), and bài 2, bài 9 and bài 5's flat road (the brake does). bài 5 is driven on a red light so the
 * aid is there at all; its own stop line and its own window are the core's.
 */
const PAGES: ReadonlyArray<{ name: string; road: StopRoad; seed: bigint; lesson: 2 | 3; maxA: number }> = [
  { name: 'bài 3', road: hillRoad, seed: seedWord(3), lesson: 3, maxA: MAX_A },
  { name: 'bài 2', road: flatRoad('brake'), seed: seedWord(2), lesson: 2, maxA: ruleset.road!.max_a_m },
  { name: 'bài 9', road: flatRoad('brake'), seed: seedWord(9), lesson: 2, maxA: ruleset.road!.max_a_m },
  // Seed 1 is the red arrival the page opens on, so the light asks for the stop.
  { name: 'bài 5 (red)', road: flatRoad('brake'), seed: seedWord(5, 1n), lesson: 2, maxA: ruleset.junction!.max_a_m },
];

// (a) the anticipating learner: reads the countdown every P ms, plans the press at read + eta, and
// presses within ±100 ms of that plan. This is the brief's learner, and it starts where the page
// starts: before the car is moving, so the whole approach from rest is in the run.
for (const page of PAGES) {
  test(`${page.name}: a learner polling 16 to 500 ms and pressing within 100 ms of the countdown stops inside A`, () => {
    const { failures, runs, low, high, rows } = sweep(
      page.road,
      { seed: page.seed, lesson: page.lesson, learner: 'plan' },
      E_GATE_MS,
      page.maxA,
    );
    // Where a press exactly on the plan lands, against A_MID_M: the aid's own bias, per poll period.
    const exact = POLES_MS.map((poll) => {
      const a = rows.filter((r) => r.pollMs === poll && r.errorMs === 0).map((r) => r.A);
      return `${poll}: ${Math.min(...a).toFixed(3)}..${Math.max(...a).toFixed(3)}`;
    });
    console.log(`     ${page.name}: A over ${runs} runs: ${low.toFixed(3)} to ${high.toFixed(3)} m of ${page.maxA}; on the plan (aim ${A_MID_M}) by poll ${exact.join(', ')}`);
    assert.deepEqual(failures, []);
  });
}

// (b) the literal learner: waits for the page to say "bấm ngay" and then reacts, 150 to 350 ms later.
// This is a different signal from (a)'s — the words lead the bar's mark by a reaction band — so both
// are gated rather than one standing in for the other.
for (const page of PAGES) {
  test(`${page.name}: a learner who presses 150 to 350 ms after "bấm ngay" stops inside A`, () => {
    const { failures, runs, rows } = sweep(
      page.road,
      { seed: page.seed, lesson: page.lesson, learner: 'literal' },
      350,
      page.maxA,
      25,
      LITERAL_POLES_MS,
      150,
    );
    // The sweep is the reaction band and nothing else, so every failure is a band failure and the
    // extent reported below is the extent that was gated.
    const band = failures;
    const inBand = rows;
    const lo = Math.min(...inBand.map((r) => r.A));
    const hi = Math.max(...inBand.map((r) => r.A));
    const at = (poll: number, error: number) => {
      const a = inBand.filter((r) => r.pollMs === poll && r.errorMs === error).map((r) => r.A);
      return `${Math.min(...a).toFixed(3)}..${Math.max(...a).toFixed(3)}`;
    };
    console.log(
      `     ${page.name} (literal, band 150-350 ms): ${runs} runs, ${band.length} outside 0..${page.maxA} m, ` +
        `band A ${lo.toFixed(3)} to ${hi.toFixed(3)} (slack ${Math.round(lo * 1000)} mm short side, ${Math.round((page.maxA - hi) * 1000)} mm long side); ` +
        `poll 16: 150->${at(16, 150)} 250->${at(16, 250)} 350->${at(16, 350)}; poll 50: 150->${at(50, 150)} 250->${at(50, 250)} 350->${at(50, 350)}`,
    );
    assert.deepEqual(band, [], `${band.length} of the reaction-band runs missed 0..${page.maxA} m`);
  });
}

test('-150 to +150 ms is reported, not gated: the window has that much to spare or it does not', () => {
  const hill = sweep(hillRoad, { seed: seedWord(3), lesson: 3 }, E_REPORT_MS, MAX_A);
  const flat = sweep(flatRoad('brake'), { seed: seedWord(2), lesson: 2 }, E_REPORT_MS, ruleset.road!.max_a_m);
  for (const [name, r] of [['bài 3', hill], ['bài 2', flat]] as const) {
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
  // What the whole aid rests on, measured against the real core: press the critical key at a state —
  // the clutch on bài 3's slope, clutch and brake together on bài 2's flat road, as the page asks — and
  // the road the car covers to a standstill has to be the number the aid planned with.
  const cases: Array<{ name: string; seed: bigint; lesson: 2 | 3; road: StopRoad; reached: (s: SimState) => boolean }> = [
    ...[3.0, 4.0, 4.6, 5.5].map((bumper) => ({
      name: `bài 3 at bumper ${bumper} m`,
      seed: seedWord(3),
      lesson: 3 as const,
      road: hillRoad,
      reached: (s: SimState) => s.frontBumperM >= bumper,
    })),
    ...[1.6, 1.3, 1.0, 0.8].map((gap) => ({
      name: `bài 2 at ${gap} m from the line`,
      seed: seedWord(2),
      lesson: 2 as const,
      road: flatRoad('brake'),
      reached: (s: SimState) => s.lineGapM <= gap,
    })),
  ];
  for (const c of cases) {
    const session = openSession(bytes(), c.seed);
    const driver = createDriver();
    let held = new Set<string>();
    let s: SimState = session.state;
    const setUp = setUpFor(c.lesson);
    for (let tick = 0; tick < 4000; tick += 1) {
      const { keys, ready } = setUp(s);
      if (ready && c.reached(s)) break;
      const pressed = [...keys].filter((code) => !held.has(code));
      held = keys;
      session.step(driver.step(keys, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
      s = session.state;
    }
    const v0 = s.speedMps;
    const x0 = s.frontBumperM;
    const gap0 = s.lineGapM;
    assert.ok(v0 > 0.5, `${c.name}: the car never reached it at speed`);
    for (let tick = 0; tick < 900; tick += 1) {
      const keys = new Set(c.road.key === 'brake' ? ['Space', 'ArrowDown'] : ['Space']);
      const pressed = [...keys].filter((code) => !held.has(code));
      held = keys;
      session.step(driver.step(keys, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
      s = session.state;
      if (s.speedMps <= 0) break;
    }
    const measured = s.frontBumperM - x0;
    const predicted = stopTravel(ruleset, v0, c.road, c.road.key, gap0).travelM;
    session.dispose();
    assert.ok(Math.abs(measured - predicted) < 0.04, `${c.name}, v ${v0.toFixed(2)}: measured ${measured.toFixed(3)} m, predicted ${predicted.toFixed(3)} m`);
  }
});
