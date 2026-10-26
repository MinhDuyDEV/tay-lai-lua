// Can a keyboard drive bài 4 and bài 6 by following the page? Runs the real sim.wasm with the real
// driver.
// Run `task build` first (it writes build/sim.wasm).
//
// The guarantee: a learner who does what the advice line says — `slow` when it says slow, the arrow
// key the cue names, `straight` when it says hold — with 100, 250 or 400 ms of lag on each key
// group, finishes both figures without touching a painted line and scores 100. Each exercise also
// has a control that must fail: the cue law removed (a learner who never steers, or never slows),
// so the sweep proves something about the technique and not about the car.
//
// The steering is the page's own `cueFigure`, read exactly as the HUD publishes it in `data-cue`.
// The learner's hands are the real `createDriver`, so the self-centring lock, the pedal rates and
// the engine are the shipped ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cueFigure, paceFigure, tightestRadiusM, maxSpeedForRadius } from '../src/figures.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { FEEL, createDriver } from './driver.ts';
import { openSession, seedWord, type SimState } from '../src/sim/session.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
const ruleset: Ruleset = {
  ...data,
  steer: { speedScaleMps: FEEL.steer.speedScaleMps, minLock: FEEL.steer.minLock },
};
const wasmBytes = readFileSync(WASM);

const LATENCY = [6, 15, 24] as const; // ticks: 100, 250, 400 ms from the cue to the key
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
 * One whole run. The learner presses the key the cue names, after `latency.steer`; the pedals are
 * `latency.pedals` behind the line's speed words. Nothing else drives the car.
 */
function drive(lesson: 4 | 6, latency: Latency, { followCue = true, steer = true } = {}): Result {
  const session = openSession(
    wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
    seedWord(lesson),
  );
  const centre = session.course.find((r) => r.kind === 5)?.points ?? [];
  const pace = paceFigure(centre, ruleset);
  const driver = createDriver();
  const wanted: Set<string>[] = [];
  let held = new Set<string>();
  let s: SimState = session.state;
  const cues: string[] = [];
  const out: Result = { finished: false, disqualified: false, score: 0, contact: '', clockS: 0, progressM: 0, cues };

  for (let t = 0; t < 9000 && !(s.phase === 'done' || s.disqualified); t += 1) {
    const k = new Set<string>();
    // The way the page's own checklist says to set off: clutch to the floor, gear 1, handbrake off,
    // clutch up, and only then the throttle. A throttle with the clutch still coming up bogs the
    // engine down and stalls it, which is the learner's mistake, not the page's.
    if (s.gear !== 1) {
      k.add('Space');
      if (s.clutch > 0.95) k.add('Digit1');
    }
    if (s.gear === 1 && s.handbrake) k.add('KeyP');
    const rolling = s.gear === 1 && !s.handbrake && s.clutch < 0.05;

    const cue = followCue ? cueFigure(s, centre) : null;
    if (cue && cues.at(-1) !== cue) cues.push(cue);
    if (followCue) {
      // A person holds the arrow key while the line keeps naming that direction, and lets go when it
      // says straight or the other way — the only reading of a key the page can ask for.
      if (cue === 'left' && steer) k.add('ArrowLeft');
      else if (cue === 'right' && steer) k.add('ArrowRight');
      // Speed is the advice line's own duty, and it names the figure's pace. A person holds a speed
      // by feathering the throttle once the car is rolling; holding it down over-revs the engine,
      // which is its own penalty.
      if (rolling) {
        if (s.speedMps < pace - 0.15 && s.throttle < 0.55) k.add('ArrowUp');
        else if (s.speedMps > pace + 0.25) k.add('ArrowDown');
      }
    }
    wanted.push(k);
    const latOf = (code: string) =>
      code === 'ArrowLeft' || code === 'ArrowRight' ? latency.steer : latency.pedals;
    const down = new Set<string>();
    for (const code of ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyP', 'Digit1']) {
      if (wanted[t - latOf(code)]?.has(code)) down.add(code);
    }
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
function sweep(lesson: 4 | 6, options: { followCue?: boolean; steer?: boolean } = {}): string[] {
  const failures: string[] = [];
  for (const steerLag of LATENCY) {
    for (const pedalLag of LATENCY) {
      const r = drive(lesson, { steer: steerLag, pedals: pedalLag }, options);
      const clean = r.finished && r.score === 100 && r.contact === WHEELS_CLEAR;
      if (!clean) {
        failures.push(
          `steer ${steerLag} pedals ${pedalLag}: score=${r.score} contact=${r.contact} clock=${r.clockS.toFixed(1)}s progress=${r.progressM.toFixed(1)}m finished=${r.finished} dq=${r.disqualified} cues=[${[...new Set(r.cues)]}]`,
        );
      }
    }
  }
  return failures;
}

test('bài 4: following the page cue 100 to 400 ms late finishes with 100 and no line touched', () => {
  assert.deepEqual(sweep(4), []);
});

test('bài 6: following the page cue 100 to 400 ms late finishes with 100 and no line touched', () => {
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

test('the speed bound comes from the tightest bend, and bài 6 is tighter than bài 4', () => {
  const radius = (lesson: 4 | 6) => {
    const session = openSession(
      wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
      seedWord(lesson),
    );
    const centre = session.course.find((r) => r.kind === 5)?.points ?? [];
    const r = tightestRadiusM(centre);
    session.dispose();
    return r;
  };
  const r4 = radius(4);
  const r6 = radius(6);
  assert.ok(r6 < r4, `bài 6 should bend tighter than bài 4: ${r6} vs ${r4}`);
  assert.ok(maxSpeedForRadius(r6, ruleset) < maxSpeedForRadius(r4, ruleset), 'the tighter bend must allow less speed');
});
