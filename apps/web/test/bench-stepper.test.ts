// The bench's sim side, the piece a reviewer has to trust: K sessions fed the golden input end on
// the golden hash (only the first is gated), and a key marker never reaches the sim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createStepper } from '../src/bench/host/stepper.ts';
import type { Assets } from '../src/bench/host/types.ts';

const loaded = (name: string): Assets => {
  const wasm = readFileSync(new URL('../../../build/sim.wasm', import.meta.url));
  return {
    wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    traces: [
      {
        name,
        bytes: new Uint8Array(readFileSync(new URL(`../../../golden/${name}.trace`, import.meta.url))),
        golden: readFileSync(new URL(`../../../golden/${name}.hash`, import.meta.url), 'utf8').trim(),
      },
    ],
  };
};
const ticksOf = (assets: Assets) => (assets.traces[0].bytes.length - 8) / 8;

test('K sessions over the golden trace end golden; a key marker is consumed but never becomes input', () => {
  const assets = loaded('xuat_phat_messy');
  const stepper = createStepper(assets, 4);
  const consumed = new Map<number, number>();
  let tick = 0;
  let frame = 0;
  while (tick < ticksOf(assets) + 1) {
    frame += 1;
    const a = stepper.advance(frame * 20, [frame]); // 20 ms a frame: one 1/60 tick, sometimes a catch-up
    tick += a.ticks;
    for (const c of a.consumed) consumed.set(c.id, c.tick);
  }
  // Every key sent was consumed by exactly one tick, and the first tick of a frame is the tick it saw.
  assert.equal(consumed.size, frame);
  // The pass that closed inside the run is measured; the one finish() completes is not, but golden.
  const gates = stepper.finish();
  assert.ok(gates.length >= 1);
  assert.ok(gates.every((g) => g.hash === assets.traces[0].golden && g.ok));
  assert.equal(gates[0]?.measured, true);
  assert.equal(gates.at(-1)?.measured, false);
});

test('a trace end reopens the sessions and gates the pass it closed', () => {
  const assets = loaded('xuat_phat_messy');
  const stepper = createStepper(assets, 1);
  let reopened = 0;
  for (let frame = 1; stepper.gates.length === 0; frame += 1) {
    if (stepper.advance(frame * 20, []).reopened) reopened += 1;
  }
  assert.equal(reopened, 1);
  assert.equal(stepper.reopens, 1);
  assert.deepEqual(
    stepper.gates.map((g) => [g.ticks, g.hash, g.ok, g.measured]),
    [[ticksOf(assets), assets.traces[0].golden, true, true]],
  );
});

test('the probe reports a positive, finite cost per step for one session and for K', () => {
  const assets = loaded('xuat_phat_messy');
  const probe = createStepper(assets, 8).probe(300);
  assert.equal(probe.k, 8);
  assert.equal(probe.ticks, 300);
  assert.ok(probe.oneUsPerStep > 0 && probe.kUsPerStep > probe.oneUsPerStep);
});

test('K=400 sessions on one instance: same golden hash, no instance ceiling', () => {
  const assets = loaded('dung_khoi_hanh_doc_messy');
  const ticks = ticksOf(assets);
  const stepper = createStepper(assets, 400);
  // Six ticks a frame at 100 ms, the CATCHUP cap: the sweep's heaviest cell.
  let frame = 0;
  while (stepper.gates.length === 0) {
    frame += 1;
    stepper.advance(frame * 100, []);
  }
  assert.equal(stepper.gates[0]?.ticks, ticks);
  assert.equal(stepper.gates[0]?.hash, assets.traces[0].golden);
  assert.ok(stepper.gates[0]?.ok);
});
