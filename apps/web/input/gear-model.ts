// The honest learner for bài 10, shared by gear-feel.test.ts (the gate) and gear-sweep.ts (the table
// the Supervisor runs). It reads nothing but what the page shows: `exerciseFor(10)`'s advice line and
// its cue word — the two things the HUD paints into `.advice` and `data-cue` — plus the snapshot the
// HUD's km/h, gear and clutch readouts are painted from.
//
// The learner is the strictest one the page can be asked to serve:
//   * it polls the line every `pollMs`, at a phase offset, and acts on a *change of the cue word*
//     after a full `reactMs` of reading and reaching — never on the live number inside the sentence,
//     which a person holding a key does not re-press every poll;
//   * what it does is read off the sentence's words (the key groups below), not off a plan: the cue
//     says "đạp côn … bấm 2 … giữ ga ↑", so the learner holds the clutch, taps 2, then holds ↑;
//   * a press that did not take is made again: a gear tap needs the clutch at the floor, and a learner
//     who tapped early taps again while the line still asks for that gear — one reaction later, not
//     faster than the line can have been re-read;
//   * it never anticipates: if the line moves on while the learner is waiting, the key that lands is
//     the one they read.
import { readFileSync } from 'node:fs';
import { exerciseFor } from '../src/exercise.ts';
import { gearWanted, type GearCue } from '../src/gear.ts';
import type { Ruleset } from '../src/ruleset.ts';
import { openSession, seedWord, type Session, type SimState } from '../src/sim/session.ts';
import { createDriver, DT, steerFeel } from './driver.ts';

const WASM = new URL('../../../build/sim.wasm', import.meta.url);
const RULESET_FILE = new URL('../../../content/rulesets/tt108-2026.json', import.meta.url);
const data = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));
export const ruleset: Ruleset = { ...data, steer: steerFeel };
const wasmBytes = readFileSync(WASM);
const bytes = () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);

/** The reaction band the brief names, and the two phase offsets a reader's clock can have. */
export const REACT_MS = [150, 200, 250, 300, 350, 400] as const;
export const POLL_MS = 50;
export const PHASE_MS = [0, 12, 25, 37] as const;

/** The gear the run is about: the top byte of the seed (`seedWord`). */
export const LESSON = 10;

export interface Outcome {
  finished: boolean;
  disqualified: boolean;
  score: number;
  /** Every rule the core charged, by id. */
  pents: string[];
  /** Highest rpm the engine reached: SH.X.RPM is charged above the ruleset's own line. */
  maxRpm: number;
  /** Seconds of simulated time the run took. */
  runS: number;
  /** Speed and gear on the tick the bumper first crossed each sign, for the failure message. */
  at: { kmh: number; gear: number }[];
  /** The cue words the learner acted on, in order: what the page asked for, as read. */
  cues: string[];
}

const ids = new Map<number, string>((data.rules as { code: number; id: string }[]).map((r) => [r.code, r.id]));

/**
 * One run of bài 10 by one learner. `phaseMs` shifts the learner's polling clock against the page's,
 * so a cue that is only readable for a moment is caught at a different point in its life each run.
 *
 * `show` defaults to the real page's. A variant passes its own `advice`/`cue`, and may pass its own
 * `keys` to say what its words ask the hands to hold: the page's cue words are tied to key groups here,
 * so a variant that asks a different thing with the same word has to say so.
 */
export interface ShowPage {
  advice: (s: SimState, rs: Ruleset) => string | null;
  cue: (s: SimState, rs: Ruleset) => string | null;
  /** The key groups one cue word asks for; the page's own when not given. */
  keys?: (cue: GearCue) => string[];
}

/**
 * What the page's own words ask the hands to do. Every word is one key group, and the learner holds it
 * while the word stays: `ready` the clutch (the gear and the handbrake are taps, in `driveGear` below),
 * `runup` and `pull` the throttle, `brake` the brake and nothing else — the page's zone-2 sentence says
 * "thả ga ↑, phanh ↓", and a learner who also pressed the clutch would be doing something the words do
 * not ask for. Braking in second gear from 30 to 19 km/h holds the engine at 1 400–2 400 rpm, well above
 * a stall, which is what makes the clutch unnecessary there; the gate below proves it on the core.
 */
export function pageKeys(cue: GearCue): string[] {
  switch (cue) {
    case 'ready':
    case 'shift2':
    case 'shift1':
      return ['Space'];
    case 'runup':
    case 'pull':
      return ['ArrowUp'];
    case 'brake':
      return ['ArrowDown'];
    default:
      return [];
  }
}

/** The page under test: the exercise's own two functions, plus the key groups its words ask for. */
export function pageShow(): ShowPage {
  const ex = exerciseFor(LESSON as 10);
  return { advice: (s, rs) => ex.advice(s, rs, []), cue: (s, rs) => ex.cue(s, rs, []) };
}

export function driveGear(
  reactMs: number,
  phaseMs: number,
  page: ShowPage = pageShow(),
  maxS = 150,
): Outcome {
  const show = page;
  const keysOf = page.keys ?? pageKeys;
  const session: Session = openSession(bytes(), seedWord(LESSON));
  const driver = createDriver();
  let s: SimState = session.state;
  const held = new Set<string>();
  const owed: string[] = [];
  /**
   * What the learner has decided, landing at `at` ms: either a new word's key set (which replaces what
   * they were holding, even when it is empty — "thả ga" is a release) or a bare retry tap that leaves
   * the held keys alone.
   */
  const queue: { at: number; keys: string[] | null; taps: string[] }[] = [];
  const pents: string[] = [];
  const cues: string[] = [];
  const at: { kmh: number; gear: number }[] = [];
  let maxRpm = 0;
  let now = 0;
  let nextPoll = phaseMs;
  let seen: string | null = null;
  /** When the learner's last tap of each key landed: a retry has to be a full re-read later. */
  const tappedAt = new Map<string, number>();
  const late = reactMs;
  const tapOf = (g: number) => (g === 1 ? 'Digit1' : 'Digit2');
  const retryMs = POLL_MS + late;
  /** The signs, from the core's own ruleset, so the message reads the axis the judge uses. */
  const gear = ruleset.gear!;
  const signs = [gear.first_sign_m, gear.first_sign_m + gear.zone_length_m, gear.first_sign_m + 2 * gear.zone_length_m];

  while (s.phase !== 'done' && !s.disqualified && now < maxS * 1000) {
    const text = show.advice(s, ruleset) ?? '';
    const cue = (show.cue(s, ruleset) ?? '') as GearCue;
    if (now >= nextPoll) {
      nextPoll = now + POLL_MS;
      // The learner decides now and the action lands one reaction later; what they decided, and when,
      // is what the next poll knows — otherwise the polls in between queue the same tap again.
      const decideTap = (key: string) => {
        tappedAt.set(key, now);
        queue.push({ at: now + late, keys: null, taps: [key] });
      };
      if (cue !== seen) {
        seen = cue;
        cues.push(cue);
        // A new word is a new action: whatever the previous one wanted is let go of.
        queue.push({ at: now + late, keys: keysOf(cue), taps: [] });
        // The sentence's own taps: "bấm 1", "bấm 2", "bấm P".
        const want = gearWanted(cue);
        if (want && s.gear !== want) decideTap(tapOf(want));
        if (cue === 'ready' && s.handbrake) decideTap('KeyP');
      } else {
        // Same word still on screen: the learner re-presses only what did not take — the clutch was not
        // down yet, or the lever stayed where it was — and not before a full re-read has gone by.
        const want = gearWanted(cue);
        if (want && s.gear !== want && s.clutch >= 0.96 && now - (tappedAt.get(tapOf(want)) ?? -Infinity) > retryMs) {
          decideTap(tapOf(want));
        }
        if (cue === 'ready' && s.handbrake && now - (tappedAt.get('KeyP') ?? -Infinity) > retryMs) decideTap('KeyP');
      }
    }
    for (let i = 0; i < queue.length; i += 1) {
      if (now < queue[i].at) continue;
      const a = queue.splice(i, 1)[0];
      i -= 1;
      // A new word replaces what is held (an empty set is a release); a retry tap leaves it alone.
      if (a.keys !== null) {
        held.clear();
        for (const k of a.keys) held.add(k);
      }
      for (const t of a.taps) owed.push(t);
    }
    const r = session.step(driver.step(held, owed.splice(0), { speedMps: s.speedMps, engineOn: s.engineOn }));
    s = r.state;
    maxRpm = Math.max(maxRpm, s.rpm);
    for (const e of r.events) {
      const id = ids.get(e.code);
      if (id) pents.push(id);
    }
    for (let i = 0; i < signs.length; i += 1) {
      if (!at[i] && s.frontBumperM >= signs[i]) at[i] = { kmh: s.speedMps * 3.6, gear: s.gear };
    }
    now += DT * 1000;
    void text;
  }
  session.dispose();
  return {
    finished: s.phase === 'done' && !s.disqualified,
    disqualified: s.disqualified,
    score: s.score,
    pents: [...new Set(pents)],
    maxRpm: Math.round(maxRpm),
    runS: now / 1000,
    at,
    cues,
  };
}

/** One line per cell, for a failure message or the sweep's table. */
export function describeCell(reactMs: number, phaseMs: number, o: Outcome): string {
  const sign = (i: number) => (o.at[i] ? `${o.at[i].kmh.toFixed(1)} km/h ở số ${o.at[i].gear}` : 'chưa qua');
  return (
    `react ${reactMs} ms, phase ${phaseMs} ms: score ${o.score}, ${o.finished ? 'hết bài' : 'chưa hết bài'}` +
    `${o.disqualified ? ', đình chỉ' : ''}, ${o.runS.toFixed(1)} s, rpm tối đa ${o.maxRpm}, ` +
    `biển 1 ${sign(0)}, biển 2 ${sign(1)}, biển 3 ${sign(2)}, lỗi [${o.pents.join(', ')}]`
  );
}
