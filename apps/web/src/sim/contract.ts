// The ONE TypeScript place that knows the layout of `sim_state`'s output.
//
// `sim_state(handle, out_ptr, cap) -> n` (crates/sim-core/src/abi.rs, peer-sim's lane) writes `n`
// f64 values: n is also the contract. If the Rust side adds, drops or reorders a field, `n` moves
// and `readState` throws on the first tick instead of the scene or the HUD silently drawing a
// wrong number. Keep this list in the same order as the Rust docs when that lands.

/** Indices into the f64 block. Named so a reorder is a compile error at every use, not a silent one. */
export const F = {
  tick: 0,
  phase: 1,
  score: 2,
  disqualified: 3,
  carX: 4,
  carY: 5,
  heading: 6,
  speed: 7,
  rpm: 8,
  frontBumper: 9,
  engineOn: 10,
  cranking: 11,
  steer: 12,
  throttle: 13,
  brake: 14,
  clutch: 15,
  gear: 16,
  handbrake: 17,
  belt: 18,
  signal: 19,
  engineLoad: 20,
  /** Bài 3 only (0 in bài 1): stop line minus front bumper, metres, positive while short of it. */
  lineGap: 21,
  /** A, recorded at the stop; 0 before it. */
  stopGapA: 22,
  /** Metres rolled back since the stop, >= 0. */
  rollback: 23,
  /** Ticks since the stop; -1 before it, 0 on the stop tick. */
  sinceStopTicks: 24,
  /** Road height under the car centre, metres. */
  elevation: 25,
  grade: 26,
  /** Bài 4/6: what each wheel's patch is on, FL FR RL RR. 0 clear, 1 on a line, 2 on a curb. */
  contactFL: 27,
  contactFR: 28,
  contactRL: 29,
  contactRR: 30,
  /** Bài 4/6: metres along the figure's centreline from its start. */
  progress: 31,
  /** Bài 4/6: the centreline's length. */
  courseLength: 32,
  /** Bài 4/6: signed offset from the centreline, + left of it. */
  lateral: 33,
  /** Bài 4/6: car heading minus the centreline's heading. */
  headingErr: 34,
  /** Bài 4/6: which named part of the figure the car is on. */
  segment: 35,
  /** Bài 4/6: seconds on the exercise clock, 0 until the entry gate. */
  clock: 36,
  /** Bài 4/6: the longest contact episode running now, seconds. */
  contactEpisode: 37,
  /** Bài 4/6: the four wheel centres, FL FR RL RR, as (x, y) pairs. */
  wheels: 38,
} as const;

/** How many f64 values `sim_state` must return for this build to trust what it reads. */
export const STATE_LEN = 46;

/**
 * Phase codes `sim_state` writes: 0 waiting, 1 launched, 2 past line, 3 done, 4 stopped. Bài 3 uses
 * 1 (underway toward the line), 4 and 3; 0 and 2 are bài 1's.
 */
export type PhaseName = 'waiting' | 'launched' | 'past-line' | 'done' | 'stopped';

/** Signal codes: 0 off, 1 left, 2 right. */
export type SignalName = 'off' | 'left' | 'right';

export interface SimState {
  tick: number;
  phase: PhaseName;
  score: number;
  disqualified: boolean;
  carX: number;
  carY: number;
  heading: number;
  speedMps: number;
  rpm: number;
  /** Front-bumper centre, metres past the start line. */
  frontBumperM: number;
  engineOn: boolean;
  cranking: boolean;
  /** Controls the core actually consumed, not what a key was doing. */
  steerRad: number;
  throttle: number;
  brake: number;
  clutch: number;
  gear: number;
  handbrake: boolean;
  belt: boolean;
  signal: SignalName;
  engineLoad: number;
  lineGapM: number;
  stopGapAM: number;
  rollbackM: number;
  sinceStopTicks: number;
  elevationM: number;
  grade: number;
  /** Bài 4/6 only; 0 in bài 1/3. One entry per wheel, FL FR RL RR. */
  contact: readonly [ContactCode, ContactCode, ContactCode, ContactCode];
  progressM: number;
  courseLengthM: number;
  /** Positive is left of the centreline. */
  lateralM: number;
  headingErrRad: number;
  /** Index of the named part of the figure; see `figureSegment`. */
  segment: number;
  clockS: number;
  contactEpisodeS: number;
  /** Wheel centres FL FR RL RR in the same frame as `carX`/`carY`. */
  wheels: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
}

/** What a wheel's contact patch is on. */
export type ContactCode = 0 | 1 | 2;
const CONTACT_NAMES = ['clear', 'line', 'curb'] as const;
export type ContactName = (typeof CONTACT_NAMES)[number];
export const contactName = (code: ContactCode): ContactName => CONTACT_NAMES[code];

const PHASE_NAMES: readonly PhaseName[] = ['waiting', 'launched', 'past-line', 'done', 'stopped'];
const SIGNAL_NAMES: readonly SignalName[] = ['off', 'left', 'right'];

/** A contact code outside 0..2 is a contract drift, not a value to guess at. */
function contact(v: number): ContactCode {
  if (v !== 0 && v !== 1 && v !== 2) throw new Error(`sim_state contact code ${v} is not in the contract`);
  return v;
}

/**
 * Read one state block. `count` is what `sim_state` returned; anything but STATE_LEN is a contract
 * drift, not a value to guess at.
 */
export function readState(block: Float64Array, count: number): SimState {
  if (count !== STATE_LEN) {
    throw new Error(`sim_state returned ${count} values, contract is ${STATE_LEN}`);
  }
  const phase = PHASE_NAMES[block[F.phase]];
  const signal = SIGNAL_NAMES[block[F.signal]];
  if (phase === undefined) throw new Error(`sim_state phase ${block[F.phase]} is not in the contract`);
  if (signal === undefined) throw new Error(`sim_state signal ${block[F.signal]} is not in the contract`);
  return {
    tick: block[F.tick],
    phase,
    score: block[F.score],
    disqualified: block[F.disqualified] !== 0,
    carX: block[F.carX],
    carY: block[F.carY],
    heading: block[F.heading],
    speedMps: block[F.speed],
    rpm: block[F.rpm],
    frontBumperM: block[F.frontBumper],
    engineOn: block[F.engineOn] !== 0,
    cranking: block[F.cranking] !== 0,
    steerRad: block[F.steer],
    throttle: block[F.throttle],
    brake: block[F.brake],
    clutch: block[F.clutch],
    gear: block[F.gear],
    handbrake: block[F.handbrake] !== 0,
    belt: block[F.belt] !== 0,
    signal,
    engineLoad: block[F.engineLoad],
    lineGapM: block[F.lineGap],
    stopGapAM: block[F.stopGapA],
    rollbackM: block[F.rollback],
    sinceStopTicks: block[F.sinceStopTicks],
    elevationM: block[F.elevation],
    grade: block[F.grade],
    contact: [contact(block[F.contactFL]), contact(block[F.contactFR]), contact(block[F.contactRL]), contact(block[F.contactRR])],
    progressM: block[F.progress],
    courseLengthM: block[F.courseLength],
    lateralM: block[F.lateral],
    headingErrRad: block[F.headingErr],
    segment: block[F.segment],
    clockS: block[F.clock],
    contactEpisodeS: block[F.contactEpisode],
    wheels: [
      [block[F.wheels], block[F.wheels + 1]],
      [block[F.wheels + 2], block[F.wheels + 3]],
      [block[F.wheels + 4], block[F.wheels + 5]],
      [block[F.wheels + 6], block[F.wheels + 7]],
    ],
  };
}
