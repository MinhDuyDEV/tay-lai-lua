// Keys -> one TickInput per 1/60 s tick.
//
// A keyboard has no analogue pedals, so each pedal is a *position* that moves toward a target at its
// own rate ("rate pedals"). Holding a key presses the pedal, letting go returns it, and the clutch
// lifts slowly through its bite zone so one release gesture crosses the bite without a stall.
//
// Determinism: everything here happens BEFORE the bytes are written. The recorded TickInput is what
// the core consumed; replay never runs this file.

export const DT = 1 / 60;

export const FLAG = {
  BELT: 1 << 0,
  LEFT: 1 << 1,
  IGNITION: 1 << 2,
  HANDBRAKE: 1 << 3,
  RIGHT: 1 << 4,
  ORDER: 1 << 5,
} as const;

/**
 * How the pedals feel. These numbers are assumptions about the vehicle model in
 * content/rulesets/tt108-2026.json (the clutch bite zone depends on its drivetrain), tuned by
 * pedals.test.ts: a +-150 ms sweep of a normal launch must pull away without a stall.
 * Rates are pedal travel (0..1) per second.
 */
export const FEEL = {
  throttle: { riseBase: 0.6, riseGain: 1.0, fall: 4 },
  brake: { rise: 3, fall: 5 },
  steer: { rate: 2, centre: 3, speedScaleMps: 6, minLock: 0.2 },
  clutch: {
    press: 6,
    /** Above `biteHigh` and below `biteLow` the pedal lifts at `liftFast`, between them at `liftBite`. */
    liftFast: 2.5,
    liftBite: 0.35,
    biteHigh: 0.75,
    biteLow: 0.3,
    /** A gear can only be selected, and the starter used in gear, with the pedal at least this far
     * down: the core's starter wants clutch engagement under 0.05. */
    gearTravel: 0.96,
  },
  /** The starter key is held this long after E (the core needs `crank_ticks` = 18). */
  crankTicks: 30,
  hintTicks: 150,
} as const;

export const KEY = {
  clutch: ['Space', 'ShiftLeft', 'ShiftRight'],
  throttle: 'ArrowUp',
  brake: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  engine: 'KeyE',
  belt: 'KeyB',
  signalLeft: 'KeyQ',
  handbrake: 'KeyP',
  order: 'Enter',
  neutral: ['KeyN', 'Digit0', 'Numpad0'],
  reverse: ['KeyR'],
} as const;
const GEAR_CODES: ReadonlyArray<readonly [string, number]> = [1, 2, 3, 4, 5].flatMap((g) => [
  [`Digit${g}`, g] as const,
  [`Numpad${g}`, g] as const,
]);

/** Every code the page should capture (and stop the browser from scrolling with). */
export const HANDLED_CODES: ReadonlySet<string> = new Set([
  ...KEY.clutch,
  KEY.throttle,
  KEY.brake,
  KEY.left,
  KEY.right,
  KEY.engine,
  KEY.belt,
  KEY.signalLeft,
  KEY.handbrake,
  KEY.order,
  ...KEY.neutral,
  ...KEY.reverse,
  ...GEAR_CODES.map(([c]) => c),
]);

/** One source for the on-screen legend. */
export const KEY_LEGEND: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: 'E', does: 'Nổ máy (cần về số 0 hoặc đạp côn)' },
  { keys: 'B', does: 'Thắt / tháo dây an toàn' },
  { keys: 'Enter', does: 'Giám khảo phát lệnh xuất phát (đèn xanh)' },
  { keys: 'Q', does: 'Xi nhan trái bật / tắt' },
  { keys: 'P', does: 'Phanh tay nhả / kéo' },
  { keys: 'Space hoặc Shift', does: 'Côn: giữ để đạp, nhả từ từ để vào điểm bắt' },
  { keys: '1–5, R, N', does: 'Vào số (phải đạp côn hết cỡ)' },
  { keys: '↑', does: 'Ga: giữ càng lâu càng sâu' },
  { keys: '↓', does: 'Phanh' },
  { keys: '← →', does: 'Lái (càng nhanh càng bớt góc)' },
];

/** What the driver needs to know about the car; read from the sim state of the previous tick. */
export interface DriveView {
  speedMps: number;
  engineOn: boolean;
}

export interface Driver {
  /** The 8 TickInput bytes for the next tick. */
  step(held: ReadonlySet<string>, pressed: readonly string[], view: DriveView): Uint8Array;
  /** Pedal positions 0..1 as last sent, for tests and for the HUD before the first state arrives. */
  readonly pedals: { throttle: number; brake: number; clutch: number; steer: number };
  /** A short Vietnamese reason why the last key press did nothing, or null. */
  readonly hint: string | null;
}

const approach = (p: number, target: number, rate: number) =>
  p < target ? Math.min(target, p + rate * DT) : Math.max(target, p - rate * DT);

const anyHeld = (held: ReadonlySet<string>, codes: readonly string[]) => codes.some((c) => held.has(c));

export function createDriver(): Driver {
  // The learner sits with every pedal at rest (clutch up = 0) and the lever in neutral.
  const pedals = { throttle: 0, brake: 0, clutch: 0, steer: 0 };
  let gear = 0;
  let belt = false;
  let signalLeft = false;
  let handbrake = true;
  let ordered = false;
  let crankLeft = 0;
  let hint: string | null = null;
  let hintLeft = 0;

  const say = (text: string) => {
    hint = text;
    hintLeft = FEEL.hintTicks;
  };

  return {
    pedals,
    get hint() {
      return hint;
    },
    step(held, pressed, view) {
      for (const code of pressed) {
        if (code === KEY.belt) belt = !belt;
        else if (code === KEY.signalLeft) signalLeft = !signalLeft;
        else if (code === KEY.handbrake) handbrake = !handbrake;
        else if (code === KEY.order) ordered = true;
        else if (code === KEY.engine) {
          if (view.engineOn) say('Máy đã nổ rồi.');
          else if (gear !== 0 && pedals.clutch < FEEL.clutch.gearTravel) {
            say('Về số 0 hoặc đạp côn (Space) rồi mới nổ máy.');
          } else crankLeft = FEEL.crankTicks;
        } else {
          const wanted = gearFor(code);
          if (wanted === null) continue;
          if (pedals.clutch < FEEL.clutch.gearTravel) say('Đạp côn hết cỡ (giữ Space) rồi mới vào số.');
          else gear = wanted;
        }
      }

      const f = FEEL;
      // Throttle: eases in, so a short hold is a light touch; falls quickly.
      pedals.throttle = held.has(KEY.throttle)
        ? Math.min(1, pedals.throttle + (f.throttle.riseBase + f.throttle.riseGain * pedals.throttle) * DT)
        : Math.max(0, pedals.throttle - f.throttle.fall * DT);
      pedals.brake = approach(pedals.brake, held.has(KEY.brake) ? 1 : 0, held.has(KEY.brake) ? f.brake.rise : f.brake.fall);

      // Clutch: down fast, up fast outside the bite zone and slowly inside it.
      const c = pedals.clutch;
      if (anyHeld(held, KEY.clutch)) pedals.clutch = Math.min(1, c + f.clutch.press * DT);
      else {
        const inBite = c < f.clutch.biteHigh && c > f.clutch.biteLow;
        pedals.clutch = Math.max(0, c - (inBite ? f.clutch.liftBite : f.clutch.liftFast) * DT);
      }

      // Steering: toward the key, shrinking lock with speed; centres by itself.
      const dir = (held.has(KEY.left) ? 1 : 0) - (held.has(KEY.right) ? 1 : 0);
      const v = view.speedMps / f.steer.speedScaleMps;
      const lock = Math.max(f.steer.minLock, 1 / (1 + v * v));
      pedals.steer =
        dir === 0
          ? approach(pedals.steer, 0, f.steer.centre)
          : approach(pedals.steer, dir * lock, f.steer.rate);

      let flags = 0;
      if (belt) flags |= FLAG.BELT;
      if (signalLeft) flags |= FLAG.LEFT;
      if (handbrake) flags |= FLAG.HANDBRAKE;
      if (ordered) flags |= FLAG.ORDER;
      if (crankLeft > 0) {
        flags |= FLAG.IGNITION;
        crankLeft -= 1;
      }

      if (hintLeft > 0 && --hintLeft === 0) hint = null;

      const out = new Uint8Array(8);
      const dv = new DataView(out.buffer);
      dv.setInt16(0, Math.round(pedals.steer * 32767), true);
      out[2] = Math.round(pedals.throttle * 255);
      out[3] = Math.round(pedals.brake * 255);
      out[4] = Math.round(pedals.clutch * 255);
      dv.setInt8(5, gear);
      out[6] = flags;
      return out;
    },
  };
}

function gearFor(code: string): number | null {
  if ((KEY.neutral as readonly string[]).includes(code)) return 0;
  if ((KEY.reverse as readonly string[]).includes(code)) return -1;
  for (const [c, g] of GEAR_CODES) if (c === code) return g;
  return null;
}
