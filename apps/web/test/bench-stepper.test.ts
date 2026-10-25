// The bench's sim side, the piece a reviewer has to trust: K sessions fed the golden input end on
// the golden hash, and every one of the K hashed alike.
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

test('K sessions over the golden trace end golden, and every one of the K hashes alike', () => {
  const assets = loaded('xuat_phat_messy');
  const stepper = createStepper(assets, 4);
  let tick = 0;
  let frame = 0;
  while (tick < ticksOf(assets) + 1) {
    frame += 1;
    tick += stepper.advance(frame * 20).ticks; // 20 ms a frame: one 1/60 tick, sometimes a catch-up
  }
  // The pass that closed inside the run is measured; the one finish() completes is not, but golden.
  const gates = stepper.finish();
  assert.ok(gates.length >= 1);
  assert.ok(gates.every((g) => g.hash === assets.traces[0].golden && g.ok));
  // Every one of the K sessions ran the trace: the gate records how many hashed to session 0's hash.
  assert.ok(gates.every((g) => g.allHashesEqual === 4 && g.k === 4));
  assert.equal(gates[0]?.measured, true);
  assert.equal(gates.at(-1)?.measured, false);
});

test('a trace end reopens the sessions and gates the pass it closed', () => {
  const assets = loaded('xuat_phat_messy');
  const stepper = createStepper(assets, 1);
  let reopened = 0;
  for (let frame = 1; stepper.gates.length === 0; frame += 1) {
    if (stepper.advance(frame * 20).reopened) reopened += 1;
  }
  assert.equal(reopened, 1);
  assert.equal(stepper.reopens, 1);
  assert.deepEqual(
    stepper.gates.map((g) => [g.ticks, g.hash, g.ok, g.measured]),
    [[ticksOf(assets), assets.traces[0].golden, true, true]],
  );
});
