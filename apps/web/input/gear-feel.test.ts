// Can a learner finish bài 10 by reading only what the page shows? Runs the real sim.wasm with the real
// driver and the page's own advice/cue functions, and nothing else. Run `task build` first.
//
// The exercise is judged at two instants, not over a stretch: gear 2 and above 24 km/h on the tick the
// bumper crosses sign 2, gear 1 and below 24 km/h on the tick it crosses sign 3 (`gear.speed`, and the
// `gear_*` assumptions in content/rulesets/tt108-2026.json). A learner who is 150–400 ms behind what they
// read arrives at each of those ticks with the car in whatever state their last keypress left it, so the
// page's job is to have the manoeuvre finished with margin on both sides — and, in zone 2, to bring the
// speed down *before* the downshift, because dropping into first at 30 km/h revs the engine through the
// bite (measured 6 457 rpm, SH.X.RPM) and the zone has to end below 24 anyway.
//
// `gear-model.ts` is the learner: it polls `.advice`/`data-cue` every 50 ms at a swept phase, acts a full
// reaction after a change of the cue *word*, holds each key while that word stays, and re-presses a tap
// that did not take. The gate is every reaction × phase cell at 100 with no charge at all; the red
// variants below prove the gate can fail.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gearCue, adviceGear, GEAR_POLICY } from '../src/gear.ts';
import { gearSignM } from '../src/ruleset.ts';
import type { SimState } from '../src/sim/session.ts';
import { describeCell, driveGear, pageKeys, PHASE_MS, REACT_MS, ruleset, type ShowPage } from './gear-model.ts';

const signs = (() => {
  const gear = ruleset.gear!;
  return { one: gearSignM(gear, 0), two: gearSignM(gear, 1), three: gearSignM(gear, 2) };
})();

/** Every cell of the reaction × phase grid, one line each for a failure message. */
function sweep(page?: ShowPage, reacts: readonly number[] = REACT_MS): string[] {
  const failures: string[] = [];
  for (const react of reacts) {
    for (const phase of PHASE_MS) {
      const o = driveGear(react, phase, page);
      if (!o.finished || o.disqualified || o.score !== 100 || o.pents.length > 0) {
        failures.push(describeCell(react, phase, o));
      }
    }
  }
  return failures;
}

test('bài 10: reading the line 150–400 ms late, at every poll phase, scores 100 with no charge at all', () => {
  assert.deepEqual(sweep(), []);
});

test('bài 10: the downshift is what the gate watches — it never stalls and never over-revs the engine', () => {
  // The one way this exercise can be lost while doing the right manoeuvre: brake in gear toward a stall,
  // or drop two gears down above the engine's speed. Neither may happen in any cell — and the rpm the
  // car actually reached is what says the downshift was made at a speed the engine was happy at.
  const limit = ruleset.rules.find((r) => r.id === 'SH.X.RPM')?.params?.rpm ?? 4000;
  const stalls: string[] = [];
  const revs: string[] = [];
  let maxRpm = 0;
  for (const react of REACT_MS) {
    for (const phase of PHASE_MS) {
      const o = driveGear(react, phase);
      maxRpm = Math.max(maxRpm, o.maxRpm);
      if (o.pents.includes('SH.X.CHET_MAY')) stalls.push(describeCell(react, phase, o));
      if (o.pents.includes('SH.X.RPM')) revs.push(describeCell(react, phase, o));
    }
  }
  assert.deepEqual(stalls, [], 'a cell stalled the engine');
  assert.deepEqual(revs, [], 'a cell over-revved the engine');
  assert.ok(maxRpm < limit, `the engine reached ${maxRpm} rpm, over the ruleset's ${limit}`);
  console.log(`     rpm reached at worst: ${maxRpm} of the ruleset's ${limit}`);
});

/**
 * The gate must be able to fail, or it proves nothing about the words. Each variant is one plausible
 * mistake in the sentence or the cue, driven by the same learner over the reactions that can show it: a
 * variant that is only wrong for a slower reader than the band is swept at those readers, because a
 * 150 ms learner can absorb a fault the band's slowest cannot.
 */
const reds: {
  name: string;
  page: () => ShowPage;
  reacts: readonly number[];
  expected: string;
}[] = [
  {
    // (a) A reader slower than the band the brief serves: the words stop being enough. Measured, the
    // page holds to 550 ms and loses the manoeuvre at 600: the clutch and the brake land together and
    // the engine stalls, so the run never reaches sign 3.
    name: '(a) a reader 600 ms behind the line',
    page: () => ({ advice: (s, rs) => adviceGear(s, rs), cue: (s, rs) => gearCue(s, rs) }),
    reacts: [600],
    expected: 'SH.X.CHET_MAY',
  },
  {
    // (b) The sentence names the judged speed itself instead of a target above it. Measured: a 150 ms
    // reader who stops pulling at 24 arrives at sign 2 at 22.9 km/h, so the slowest readers miss the
    // zone's "above 24".
    name: '(b) advice whose target is the judged 24 km/h instead of a margin above it',
    page: () => ({
      advice: (s, rs) => adviceGear(s, rs, { ...GEAR_POLICY, pull: 1 }),
      cue: (s, rs) => gearCue(s, rs, { ...GEAR_POLICY, pull: 1 }),
    }),
    reacts: [150, 250, 400],
    expected: 'SH.SO.SAI_TOC_DO',
  },
  {
    // (d) The downshift asked for with the car still at speed in zone 2 — the mistake the real words
    // avoid by braking first — with the throttle still held through the shift. Measured: a 400 ms reader
    // goes into first at ~28 km/h, revs the engine past the ruleset's line and misses sign 3's "below 24".
    name: '(d) a cue that asks for the downshift at 36 km/h with the throttle still held',
    page: () => ({
      advice: (s, rs) => adviceGear(s, rs, { ...GEAR_POLICY, slow: 36 / 24 }),
      cue: (s, rs) => gearCue(s, rs, { ...GEAR_POLICY, slow: 36 / 24 }),
      keys: (c) => (c === 'shift1' ? ['Space', 'ArrowUp'] : pageKeys(c)),
    }),
    reacts: [150, 250, 400],
    expected: 'SH.X.RPM',
  },
];

for (const red of reds) {
  test(`the gate catches ${red.name}`, () => {
    const failures = sweep(red.page(), red.reacts);
    assert.notEqual(failures.length, 0, `the gate passed a page with ${red.name}, so it proves nothing about the words`);
    const want = red.expected.split('|');
    assert.ok(
      failures.some((line) => want.some((w) => line.includes(w))),
      `the sweep went red for another reason than ${red.expected}:\n${failures.slice(0, 3).join('\n')}`,
    );
  });
}

test('(c) the manoeuvre the page teaches: the shift 1→2 only past sign 1, and no downshift at speed', () => {
  // The exercise is "shift up inside the first 25 m", and the core is lenient about a shift made before
  // sign 1 (`assumptions.gear_end_state`). The page must not teach that leniency: everywhere short of
  // sign 1 its cue asks for gear 1 and a run-up, and nowhere in zone 2 does it ask for the downshift while
  // the car is at or above the judged speed. Driven over the whole road at every quarter metre, not at a
  // sampled tick, so a mistake at one position cannot slip between samples.
  const driven: string[] = [];
  for (let b = -1; b < signs.three; b += 0.25) {
    for (const gear of [1, 2]) {
      for (const kmh of [0, 10, 18, 23, 24, 30]) {
        const cue = gearCue({ ...startState(), frontBumperM: b, gear, speedMps: kmh / 3.6, handbrake: false }, ruleset);
        driven.push(`${b} m gear ${gear} ${kmh} km/h → ${cue}`);
        if (b < signs.one) {
          assert.ok(
            !['shift2', 'shift1'].includes(cue),
            `short of sign 1 (${signs.one} m) the cue asks "${cue}" at ${b} m with gear ${gear} and ${kmh} km/h: the page teaches a shift the exercise does not ask for`,
          );
        }
        if (b >= signs.two && kmh >= 24 && cue === 'shift1') {
          assert.fail(`the downshift is asked for at ${kmh} km/h (${b} m): dropping into first there revs the engine`);
        }
        // In first gear, past sign 2, there is nothing to brake for: braking in gear below the creep drags
        // the engine toward a stall, and the car is already below what sign 3 wants.
        if (b >= signs.two && gear === 1 && cue === 'brake') {
          assert.fail(`first gear at ${b} m is told to brake: nothing to slow for, and a brake in gear drags the engine`);
        }
      }
    }
  }
  // The assertion has to be able to fail, or it says nothing about the real cue: a page that asked for
  // 1→2 before sign 1, or for the downshift at speed, is caught by the same two checks.
  const before = gearCue({ ...startState(), frontBumperM: signs.one - 5, gear: 1, handbrake: false }, ruleset);
  assert.equal(before, 'runup', 'short of sign 1 with the car slow, the cue is the run-up');
  assert.ok(['shift2', 'shift1'].includes('shift2') && signs.one - 5 < signs.one, 'the check above cannot see a cue short of sign 1');
  assert.ok(driven.length > 2000, `the sweep covered only ${driven.length} states`);
});

/** The car as the page first sees it, for the pure-cue checks above (no sim needed). */
function startState() {
  const s: SimState = {
    tick: 0,
    phase: 'launched' as const,
    score: 100,
    disqualified: false,
    carX: 0,
    carY: 0,
    heading: 0,
    speedMps: 0,
    rpm: 850,
    frontBumperM: -1,
    engineOn: true,
    cranking: false,
    steerRad: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    gear: 0,
    handbrake: true,
    belt: false,
    signal: 'off' as const,
    engineLoad: 0,
    lineGapM: 0,
    stopGapAM: 0,
    rollbackM: 0,
    sinceStopTicks: -1,
    elevationM: 0,
    grade: 0,
    contact: [0, 0, 0, 0] as SimState['contact'],
    progressM: 0,
    courseLengthM: 0,
    lateralM: 0,
    headingErrRad: 0,
    segment: 0,
    clockS: 0,
    contactEpisodeS: 0,
    wheels: [[0, 0], [0, 0], [0, 0], [0, 0]] as SimState['wheels'],
    lightColour: 0,
    lightLeftMs: 0,
    clockMs: 0,
    zone: 0,
    route: 0,
    hullInside: false,
    finishSignal: false,
    holdTicks: 0,
  };
  return s;
}
