// Can a keyboard drive bài 4 and bài 6 by following the page? Runs the real sim.wasm with the real
// driver.
// Run `task build` first (it writes build/sim.wasm).
//
// The guarantee: a learner who does what the advice line says — hold the arrow key the cue names, let
// go on `straight`, never touch the throttle (the car creeps at idle) — finishes both figures without
// touching a painted line and scores 100, with 100 to 500 ms between the line changing and the key
// landing (ten lags 50 ms apart) and 100, 250 or 400 ms on the clutch, gear and handbrake. Each figure
// also has a control that must fail (a learner who never steers), so the sweep proves something about
// the cue and not about the car.
//
// The learner polls, like a person glancing at the line and like the Supervisor's hand-check script:
// every `POLL_TICKS` they read the cue, and when it differs from the one they last acted on they wait
// their lag and then press what *that* cue said — even if it has changed again meanwhile — and look
// again. A plain delayed copy of the cue is kinder than that (it never acts on a stale reading), and
// passed where the polling learner did not.
//
// The spec is 500 ms; the sweep runs to 600 ms, because a check that passes only at the exact
// modelled lag is not a margin, and a person reading a Vietnamese sentence is slower than a script.
//
// The steering is the page's own `cueFigure`, read exactly as the HUD publishes it in `data-cue`.
// The learner's hands are the real `createDriver`, so the self-centring lock, the pedal rates and
// the engine are the shipped ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cueFigure, paceFigure } from '../src/figures.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { createDriver, steerFeel } from './driver.ts';
import { openSession, seedWord, type SimState } from '../src/sim/session.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
const ruleset: Ruleset = { ...data, steer: steerFeel };
const wasmBytes = readFileSync(WASM);

/** Ticks of 1/60 s: 100 to 600 ms in 50 ms steps (the spec ends at 500; the rest is margin). */
const STEER_LAG = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36] as const;
const PEDAL_LAG = [6, 15, 24] as const; // 100, 250, 400 ms for the clutch, gear and handbrake
/** How often the learner looks at the line: about 67 ms, a script's 50 ms poll plus its round trip. */
const POLL_TICKS = 4;
const WHEELS_CLEAR = '0000';

interface Latency {
  steer: number;
  pedals: number;
}

interface Result {
  finished: boolean;
  disqualified: boolean;
  score: number;
  contact: string;
  clockS: number;
  progressM: number;
  cues: string[];
}

/**
 * One whole run. The set-up keys (clutch, gear, handbrake) follow the checklist `latency.pedals`
 * late; the arrow keys follow the polled cue `latency.steer` late. Nothing else drives the car.
 */
function drive(lesson: 4 | 6, latency: Latency, { steer = true } = {}): Result {
  const session = openSession(
    wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
    seedWord(lesson),
  );
  const centre = session.course.find((r) => r.kind === 5)?.points ?? [];
  const pace = paceFigure(ruleset);
  const driver = createDriver();
  const setup: Set<string>[] = [];
  let held = new Set<string>();
  let s: SimState = session.state;
  const cues: string[] = [];
  const out: Result = { finished: false, disqualified: false, score: 0, contact: '', clockS: 0, progressM: 0, cues };
  // The polling learner: what they last acted on, what they are about to press and when.
  let acted = '';
  let pending = 'straight';
  let actAt = -1;
  let nextLook = 0;
  let arrow = '';

  for (let t = 0; t < 9000 && !(s.phase === 'done' || s.disqualified); t += 1) {
    const k = new Set<string>();
    // The way the page's own checklist says to set off: clutch to the floor, gear 1, handbrake off,
    // clutch up, and only then (never, here) the throttle.
    if (s.gear !== 1) {
      k.add('Space');
      if (s.clutch > 0.95) k.add('Digit1');
    }
    if (s.gear === 1 && s.handbrake) k.add('KeyP');
    setup.push(k);

    const cue = cueFigure(s, centre, ruleset);
    if (actAt >= 0 && t >= actAt) {
      arrow = pending === 'left' ? 'ArrowLeft' : pending === 'right' ? 'ArrowRight' : '';
      actAt = -1;
      nextLook = t + POLL_TICKS;
    }
    if (actAt < 0 && t >= nextLook) {
      if (cue !== acted) {
        acted = cue;
        pending = cue;
        actAt = t + latency.steer;
        if (cues.at(-1) !== cue) cues.push(cue);
      } else {
        nextLook = t + POLL_TICKS;
      }
    }

    const down = new Set<string>(setup[t - latency.pedals] ?? []);
    if (arrow && steer) down.add(arrow);
    // Speed: the advice line says "đừng ga, cứ để xe tự bò", so the throttle is never touched. If the
    // car is ever above the line's pace the line says "nhả ga"; with no throttle held there is nothing
    // to release, so the learner brakes.
    if (s.gear === 1 && !s.handbrake && s.clutch < 0.05 && s.speedMps > pace + 0.15) down.add('ArrowDown');
    const pressed = [...down].filter((code) => !held.has(code));
    held = down;
    session.step(driver.step(down, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = session.state;
  }
  out.finished = s.phase === 'done' && !s.disqualified;
  out.disqualified = s.disqualified;
  out.score = s.score;
  out.contact = s.contact.join('');
  out.clockS = s.clockS;
  out.progressM = s.progressM;
  session.dispose();
  return out;
}

/** Every lag combination; returns what went wrong, in a form the failure message can print. */
function sweep(lesson: 4 | 6, options: { steer?: boolean } = {}): string[] {
  const failures: string[] = [];
  for (const steerLag of STEER_LAG) {
    for (const pedalLag of PEDAL_LAG) {
      const r = drive(lesson, { steer: steerLag, pedals: pedalLag }, options);
      const clean = r.finished && r.score === 100 && r.contact === WHEELS_CLEAR;
      if (!clean) {
        failures.push(
          `steer ${steerLag * 1000 / 60 | 0} ms pedals ${pedalLag}: score=${r.score} contact=${r.contact} clock=${r.clockS.toFixed(1)}s progress=${r.progressM.toFixed(1)}m finished=${r.finished} dq=${r.disqualified} cues=[${[...new Set(r.cues)]}]`,
        );
      }
    }
  }
  return failures;
}

test('bài 4: following the polled page cue 100 to 500 ms late (and 600 for margin) finishes with 100, no line touched', () => {
  assert.deepEqual(sweep(4), []);
});

test('bài 6: following the polled page cue 100 to 500 ms late (and 600 for margin) finishes with 100, no line touched', () => {
  assert.deepEqual(sweep(6), []);
});

test('bài 4 fails when the learner never steers, so the steering cue is what passes it', () => {
  const failures = sweep(4, { steer: false });
  assert.notEqual(failures.length, 0, 'the figure passes without steering, so the sweep proves nothing');
});

test('bài 6 fails when the learner never steers, so the steering cue is what passes it', () => {
  const failures = sweep(6, { steer: false });
  assert.notEqual(failures.length, 0, 'the figure passes without steering, so the sweep proves nothing');
});

// The pace is the car's own idle creep, so it is one number for both figures and it has to be
// derivable from the ruleset rather than chosen to make the sweep pass. If someone later "fixes" a
// failing sweep by lowering it, this fails: below creep the car has to ride the clutch or brake in
// gear, and braking in gear stalls the engine.
test('the pace is the car\'s own idle creep in first gear, from the ruleset gearbox', () => {
  const { idle_target_rpm: idle, final_drive: final, gears } = data.drivetrain;
  const expected =
    (((idle / gears['1']) / final) * 2 * Math.PI * data.vehicle.wheel_radius_m) / 60;
  assert.ok(Math.abs(paceFigure(ruleset) - expected) < 1e-9, `${paceFigure(ruleset)} vs ${expected}`);
  // The car must be able to reach it with no throttle at all: idle creep is what makes the pace true.
  assert.ok(paceFigure(ruleset) > 1.5 && paceFigure(ruleset) < 2.1, `creep ${paceFigure(ruleset)} m/s`);
});

// The cue must be a real function of where the car is on the path: if it answered the same thing
// everywhere, a learner holding that key would still be told to hold it, and the sweep would pass for
// the wrong reason. bài 6 bends both ways, so the line must name both directions somewhere.
test('the cue names both directions over a figure, so it follows the path and not the clock', () => {
  const session = openSession(
    wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
    seedWord(6),
  );
  const centre = session.course.find((r) => r.kind === 5)?.points ?? [];
  const driver = createDriver();
  const seen = new Set<string>();
  let held = new Set<string>();
  let s: SimState = session.state;
  for (let t = 0; t < 4000 && !(s.phase === 'done' || s.disqualified); t += 1) {
    const k = new Set<string>();
    if (s.gear !== 1) {
      k.add('Space');
      if (s.clutch > 0.95) k.add('Digit1');
    }
    if (s.gear === 1 && s.handbrake) k.add('KeyP');
    const cue = cueFigure(s, centre, ruleset);
    seen.add(cue);
    if (cue === 'left') k.add('ArrowLeft');
    else if (cue === 'right') k.add('ArrowRight');
    const pressed = [...k].filter((code) => !held.has(code));
    held = k;
    session.step(driver.step(k, pressed, { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = session.state;
  }
  session.dispose();
  assert.deepEqual([...seen].sort(), ['left', 'right', 'straight']);
});
