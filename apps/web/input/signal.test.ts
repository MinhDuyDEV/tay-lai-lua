// The turn stalk: Q is the left signal, W the right one, and they behave like one stalk, not two
// switches. A learner told to "signal right" who finds a left signal already on must be able to
// press one key, not two; and a signal that cannot be cancelled is a signal left on, which is a
// penalty in every exercise that scores one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDriver, HANDLED_CODES, KEY, legendFor } from './driver.ts';

/** What the core would see for this set of presses: the flag byte of the 8 the driver writes. */
const FLAG = { LEFT: 1 << 1, RIGHT: 1 << 4 } as const;

const view = { speedMps: 0, engineOn: true };

/** Press `codes` in order, one tick apart, and report the signal flags after each press. */
function presses(codes: string[]): number[] {
  const driver = createDriver();
  const flags: number[] = [];
  for (const code of codes) {
    driver.step(new Set(), [code], view);
    flags.push(driver.step(new Set(), [], view)[6] & (FLAG.LEFT | FLAG.RIGHT));
  }
  return flags;
}

const LEFT = FLAG.LEFT;
const RIGHT = FLAG.RIGHT;
const OFF = 0;

test('W turns the right signal on, and pressing it again turns it off', () => {
  assert.deepEqual(presses([KEY.signalRight, KEY.signalRight]), [RIGHT, OFF]);
});

test('Q keeps its toggle behaviour for bài 1: on, then off', () => {
  assert.deepEqual(presses([KEY.signalLeft, KEY.signalLeft]), [LEFT, OFF]);
});

test('the two keys are one stalk: turning one side on cancels the other', () => {
  assert.deepEqual(presses([KEY.signalLeft, KEY.signalRight]), [LEFT, RIGHT]);
  assert.deepEqual(presses([KEY.signalRight, KEY.signalLeft]), [RIGHT, LEFT]);
  // And the cancelled side is off, not merely hidden: pressing it again turns it on from scratch.
  assert.deepEqual(presses([KEY.signalLeft, KEY.signalRight, KEY.signalRight]), [LEFT, RIGHT, OFF]);
});

test('the right signal is a key the page captures, so the browser does not eat it', () => {
  assert.ok(HANDLED_CODES.has(KEY.signalRight), 'W is not in HANDLED_CODES: the page would never see it');
  assert.ok(HANDLED_CODES.has(KEY.signalLeft), 'Q is not in HANDLED_CODES');
});

test('the legend lists the signal stalk only on a lesson that scores signals', () => {
  const keys = (lesson: number, signals: boolean) => legendFor(lesson, signals).map((e) => e.keys);
  // Bài 1 scores the left signal, so it shows the stalk — for both sides, because the right one is
  // the same key family and a learner who is told about one will look for the other.
  const bai1 = keys(1, true);
  assert.ok(bai1.some((k) => k.includes('Q') && k.includes('W')), `bài 1's legend does not list Q / W: ${bai1}`);
  // Bài 3 has no signals at all: the legend must not offer a key the exercise never asks for.
  assert.ok(!keys(3, false).some((k) => k.includes('Q') || k.includes('W')), 'bài 3 lists a signal key');
  // The figures likewise.
  assert.ok(!keys(4, false).some((k) => k.includes('Q') || k.includes('W')), 'bài 4 lists a signal key');
  assert.ok(!keys(6, false).some((k) => k.includes('Q') || k.includes('W')), 'bài 6 lists a signal key');
});
