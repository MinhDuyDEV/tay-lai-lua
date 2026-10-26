// The one place TS knows the layout of sim_state: if the core's snapshot length ever differs from
// what this app was written against, reading must throw instead of drawing shifted numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STATE_LEN, readState, routeName, zoneName, ZONE_NAMES, ROUTE_NAMES } from '../src/sim/contract.ts';

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

test('the road lessons publish a zone and a route the page can name', () => {
  // Bài 2, 9 and 11 are the first exercises that use snapshot fields 49 and 50. A page that read them
  // as raw numbers would silently draw the wrong band if the core renumbered them, so they are read
  // through a list and named here.
  const cases: Array<{ lesson: number; route: string }> = [
    { lesson: 2, route: 'road' },
    { lesson: 9, route: 'road' },
    { lesson: 11, route: 'road' },
  ];
  for (const { lesson, route } of cases) {
    const handle = x.sim_create(BigInt(lesson) << 56n | 1n);
    const ptr = x.sim_alloc(64 * 8);
    const n = x.sim_state(handle, ptr, 64);
    const s = readState(new Float64Array(x.memory.buffer, ptr, 64), n);
    assert.equal(routeName(s.route), route, `bài ${lesson} route`);
    // The car starts 1 m short of the line, inside the stop zone: that is the band it must show.
    assert.equal(zoneName(s.zone), 'stop-zone', `bài ${lesson} starts in the stop zone, not ${zoneName(s.zone)}`);
    assert.ok(Math.abs(s.lineGapM - 2) < 1e-9, `bài ${lesson} line gap ${s.lineGapM}`);
  }
});

test('a zone or route outside the lists is a contract drift, not a value to guess at', () => {
  const handle = x.sim_create(1n);
  const ptr = x.sim_alloc(64 * 8);
  const n = x.sim_state(handle, ptr, 64);
  const block = new Float64Array(x.memory.buffer, ptr, 64);
  const zoneAt = 49;
  const saved = block[zoneAt];
  block[zoneAt] = ZONE_NAMES.length;
  assert.throws(() => readState(block, n), /zone/);
  block[zoneAt] = saved;
  const routeAt = 50;
  const savedRoute = block[routeAt];
  block[routeAt] = ROUTE_NAMES.length;
  assert.throws(() => readState(block, n), /route/);
  block[routeAt] = savedRoute;
  assert.equal(routeName(readState(block, n).route), 'none');
});
