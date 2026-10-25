// The one place TS knows the layout of sim_state: if the core's snapshot length ever differs from
// what this app was written against, reading must throw instead of drawing shifted numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STATE_LEN, readState } from '../src/sim/contract.ts';

const wasm = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(new URL('../../../build/sim.wasm', import.meta.url))),
  {},
);
const x = wasm.exports as unknown as {
  memory: WebAssembly.Memory;
  sim_alloc(n: number): number;
  sim_create(seed: bigint): number;
  sim_state(h: number, out: number, cap: number): number;
};

test('sim.wasm writes exactly STATE_LEN values and readState refuses any other count', () => {
  const handle = x.sim_create(1n);
  const ptr = x.sim_alloc(64 * 8);
  const n = x.sim_state(handle, ptr, 64);
  assert.equal(n, STATE_LEN, 'the core and apps/web/src/sim/contract.ts disagree on the snapshot length');
  const block = new Float64Array(x.memory.buffer, ptr, 64);
  assert.equal(readState(block, n).phase, 'waiting');
  assert.throws(() => readState(block, n + 1), /contract/);
});
