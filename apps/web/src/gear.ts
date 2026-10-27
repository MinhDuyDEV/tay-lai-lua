// Bài 10 — thay đổi số trên đường bằng. One manoeuvre, two zones, three signs, and a keyboard:
// the learner shifts 1→2 inside the first 25 m and is above 24 km/h at sign 2, then brings the car down
// and shifts 2→1 and is below 24 km/h at sign 3. The core judges each zone once, on the tick the bumper
// crosses the zone's far sign (`assumptions.gear_speed_reading`), so the page's whole job is to have the
// gear and the speed right at those two instants.
//
// The learner is late: a person reads a sentence and presses 150–400 ms later, and the car has moved by
// then. The cue is therefore a *word* the learner acts on as soon as it changes — one word at a time,
// each naming the one key group of the moment — and the numbers inside the sentences are read off the
// core's own ruleset (`gear.speed_kmh`), never literals here.
//
// Two wheel-keeping rules shape the word order, and both are measured on the real core:
//  * the handbrake comes off *before* the clutch goes up (`ready` → `runup`): a car left in gear with
//    the handbrake on stalls the engine (SH.X.CHET_MAY). The `runup` word cannot appear until the core
//    reports the handbrake released, so the query only asks for the release it can already see.
//  * in zone 2 the brake comes *before* the downshift: dropping into first at 30 km/h revs the engine
//    through the bite to 6457 rpm (SH.X.RPM, measured), and the same zone has to end below 24 anyway.

import { gearSignM, type Gear, type Ruleset } from './ruleset.ts';
import type { SimState } from './sim/session.ts';

/**
 * The one word the page is asking the learner to act on, published as `data-cue`. Each value is one key
 * group; the sentence says which keys, and the learner holds them while the word stays.
 */
export type GearCue =
  | 'engine'
  | 'ready'
  | 'runup'
  | 'roll'
  | 'shift2'
  | 'pull'
  | 'brake'
  | 'shift1'
  | 'coast'
  | 'done';

/**
 * How the three numbers the sentences quote are placed against the judged speed, as a share of it.
 * They are shares rather than km/h so a ruleset that moves the judged speed moves the sentences with
 * it (`gear.speed_kmh` is the only speed either zone is judged at).
 *
 * Measured on the real core with a learner who reads the cue 150–400 ms late (gear-feel.test.ts is the
 * gate; input/gear-sweep.ts prints the table):
 *  * `runUp` — the speed the car coasts at into sign 1. It is in first gear, where the 4 000 rpm line
 *    of SH.X.RPM is 31 km/h, and a late release overshoots the read by ~2–3 km/h, so the run-up is read
 *    at 18 and the car meets sign 1 at about 16–24.
 *  * `pull` — what the sentence asks for in second gear after the shift. This is the number that carries
 *    the judged "above 24" at sign 2: the slowest reader reaches ~29, the fastest ~36. Naming the judged
 *    speed itself is not enough — measured, a 24 km/h target leaves a 150 ms reader at 22.9 km/h at the
 *    sign (SAI_TOC_DO), and 25 km/h passes with 0.2 km/h to spare on the fastest reader — so the target
 *    is a quarter above the judged speed.
 *  * `slow` — where the brake is told to stop in zone 2, before the downshift. The band at sign 3 is
 *    "below 24", so the number sits under it with room for the reaction: a 400 ms reader is still at
 *    ~13 km/h when the brake is released. Braking in second gear from 30 to 19 km/h holds the engine at
 *    1 400–2 400 rpm, far above a stall, so no clutch is needed for it — measured.
 */
export interface GearPolicy {
  runUp: number;
  pull: number;
  slow: number;
}

export const GEAR_POLICY: GearPolicy = { runUp: 0.75, pull: 1.25, slow: 0.8 };

/** The three numbers, in km/h, from the judged speed of the ruleset's `gear` block. */
export interface GearTargets {
  runUpKmh: number;
  pullKmh: number;
  slowKmh: number;
  judgedKmh: number;
  /** Where the exercise ends: the third sign, metres of `frontBumperM`. */
  endM: number;
}

export function gearTargets(gear: Gear, policy: GearPolicy = GEAR_POLICY): GearTargets {
  return {
    runUpKmh: gear.speed_kmh * policy.runUp,
    pullKmh: gear.speed_kmh * policy.pull,
    slowKmh: gear.speed_kmh * policy.slow,
    judgedKmh: gear.speed_kmh,
    endM: gearSignM(gear, 2),
  };
}

/** The word the learner acts on now: the same function paints `.advice` and its `data-cue`. */
export function gearCue(s: SimState, ruleset: Ruleset, policy: GearPolicy = GEAR_POLICY): GearCue {
  const gear = ruleset.gear;
  if (!gear) throw new Error('bài 10 needs the ruleset’s "gear" block');
  if (s.disqualified || s.phase === 'done') return 'done';
  const kmh = s.speedMps * 3.6;
  const t = gearTargets(gear, policy);
  const b = s.frontBumperM;
  const sign1 = gearSignM(gear, 0);
  const sign2 = gearSignM(gear, 1);

  if (b >= t.endM) return 'done';
  // The shift 1→2 belongs to the first zone, past sign 1: short of it the line asks for first gear and
  // the run-up only, which is the manoeuvre the exercise actually is. (`assumptions.gear_end_state` is
  // lenient about an early shift; the page is not, and must not teach one.)
  if (b < sign1) {
    if (!s.engineOn) return 'engine';
    if (s.gear !== 1 || s.handbrake) return 'ready';
    return kmh < t.runUpKmh ? 'runup' : 'roll';
  }
  if (b < sign2) {
    if (s.gear !== 2) return 'shift2';
    return kmh < t.pullKmh ? 'pull' : 'roll';
  }
  // Zone 2: slow first, then the downshift. In first gear there is nothing to slow for — brake in gear
  // below the creep drags the engine toward a stall — so the car is simply left to run to sign 3.
  if (s.gear === 1) return 'coast';
  if (kmh > t.slowKmh) return 'brake';
  return 'shift1';
}

const kmhOf = (v: number) => (v * 3.6).toFixed(0);

/**
 * The sentence for the cue, for a human reading it. It names the keys of the current word and the one
 * number that decides the next sign, and says how far away that sign is; the live speed it quotes comes
 * from the same snapshot the HUD's km/h readout is painted from, so the number in the words and the
 * number on the dial are one number.
 */
export function adviceGear(s: SimState, ruleset: Ruleset, policy: GearPolicy = GEAR_POLICY): string {
  const gear = ruleset.gear;
  if (!gear) throw new Error('bài 10 needs the ruleset’s "gear" block');
  if (s.disqualified) return 'Đã bị đình chỉ. Bấm Esc để làm lại.';
  const t = gearTargets(gear, policy);
  const cue = gearCue(s, ruleset, policy);
  if (cue === 'done') return 'Hết bài: đã qua biển thứ ba. Bấm Esc để làm lại.';
  const kmh = s.speedMps * 3.6;
  const b = s.frontBumperM;
  const to = (m: number) => `${Math.max(0, m - b).toFixed(0)} m`;
  const n = (v: number) => v.toFixed(0);
  const sign1 = gearSignM(gear, 0);
  const sign2 = gearSignM(gear, 1);
  const sign3 = gearSignM(gear, 2);

  switch (cue) {
    case 'engine':
      return 'Máy đã tắt. Đạp côn (giữ Space) rồi bấm E để nổ lại.';
    case 'ready':
      return `Đạp côn (giữ Space), bấm 1, rồi bấm P nhả phanh tay. Còn ${to(sign1)} tới biển thứ nhất.`;
    case 'runup':
      return `Giữ ga ↑ cho tới ${n(t.runUpKmh)} km/h (đang ${kmhOf(s.speedMps)} km/h) rồi thả ra, để xe chạy đà tới biển thứ nhất, còn ${to(sign1)}.`;
    case 'roll':
      return `Thả ga, giữ số 1 cho xe chạy đà. Qua biển thứ nhất (còn ${to(sign1)}) mới đổi lên số 2.`;
    case 'shift2':
      return `Qua biển thứ nhất rồi: đạp côn (giữ Space), bấm 2, rồi nhả côn và giữ ga ↑ cho tới ${n(t.pullKmh)} km/h. Còn ${to(sign2)} tới biển thứ hai, ở đó phải trên ${n(t.judgedKmh)} km/h.`;
    case 'pull':
      return `Giữ ga ↑ cho tới ${n(t.pullKmh)} km/h (đang ${kmhOf(s.speedMps)} km/h): ở biển thứ hai (còn ${to(sign2)}) phải trên ${n(t.judgedKmh)} km/h.`;
    case 'brake':
      return `Qua biển thứ hai rồi: thả ga ↑, phanh ↓ xuống dưới ${n(t.slowKmh)} km/h (đang ${kmhOf(s.speedMps)} km/h), rồi mới về số 1.`;
    case 'shift1':
      return `Đạp côn (giữ Space), bấm 1, rồi nhả côn. Còn ${to(sign3)} tới biển thứ ba, ở đó phải dưới ${n(t.judgedKmh)} km/h.`;
    default:
      return `Số 1, đang ${kmhOf(s.speedMps)} km/h: cứ để xe chạy tới biển thứ ba, còn ${to(sign3)}, giữ dưới ${n(t.judgedKmh)} km/h.`;
  }
}

/** The gear a cue is asking for, or 0 for a cue that shifts nothing. */
export const gearWanted = (cue: GearCue): number => (cue === 'ready' || cue === 'shift1' ? 1 : cue === 'shift2' ? 2 : 0);
