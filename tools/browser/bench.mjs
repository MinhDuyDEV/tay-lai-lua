// The frame-budget bench: how much of a frame the sim core takes on the main thread, where the app
// runs it, at a known sim weight (K sessions per tick) under a known CPU throttle. Headed Chromium
// on this Mac's real GPU, one cell = one page load.
//
//   node bench.mjs [--site apps/web/out] [--quick] [--seed 20261025] [--out ~/.litter/bench]
//
// What it does, in order:
//  1. Calibration: the 1x reference for the in-cell throttle check (200 calls of a fixed ~1 ms spin,
//     unthrottled). Each cell later times the same spin under its own throttle and reports the ratio
//     (`throttleSeen`), so "4x" is a measurement of that cell, not a flag we set (A3.2a).
//  2. The matrix: main only. {1x,4x,6x} x 3 at K=1; K=20 at {1x,4x} x 3 (the budget cell); the K
//     sweep 100/1000/10000 at {1x,4x} x 1. Repeats are interleaved round by round, and the cells run
//     in a random order fixed by --seed.
//  3. Writes the raw per-frame JSON of every cell under <out>/<run-id>/ and prints the table, the
//     budget check and the break-even (bench-report.mjs prints the same from the directory later).
//
// The Worker host was measured and lost (main: frame p95 10.10 ms, callback CPU p95 1.90 ms at K=20,
// 4x; the Worker was no better and cost about a frame plus a millisecond of latency), so the bench is
// main-thread only. git history keeps the Worker host and its dilation model for the day the core
// outgrows the break-even; for the record, CDP cannot throttle a Worker at all (attaching to the
// worker target answers "Operation is only supported for pages"), which is why that model existed.
//
// Every trace pass the first session completes is checked against golden/<trace>.hash, and all K
// sessions against each other, so a cell's numbers belong to golden input only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, homedir, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../apps/web/scripts/serve.mjs';
import { report } from './bench-report.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.replace(/^--/, ''), process.argv[i + 1]?.startsWith('--') ? '1' : (process.argv[++i] ?? '1'));
}
const here = (rel) => resolve(import.meta.dirname, rel);
const site = args.get('site') ?? here('../../apps/web/out');
const quick = args.has('quick') || process.env.BENCH_QUICK === '1' || args.get('quick') === '1';
/** Development aid: run only the first N cells of the plan, to see the plumbing without the wait. */
const limit = args.has('limit') ? Number(args.get('limit')) : Infinity;
/** Re-run part of a plan later: --only sweep runs every cell whose id contains "sweep". */
const only = args.get('only') ?? '';
/** --ks 1,20,1000 runs only cells with those K (an ad-hoc ladder; the decision cells are unaffected). */
const ksArg = args.get('ks');
const ks = ksArg ? ksArg.split(',').map(Number) : null;
const seed = Number(args.get('seed') ?? 20261025);
const root = args.get('out') ?? join(homedir(), '.litter', 'bench');
const CELL_MS = quick ? 5000 : 15000;
const SHORT_MS = quick ? 5000 : 8000;
/** A cell runs past its length if needed, to complete one trace pass (the pass is its hash check). */
const GRACE_S = 8;
/** Sweep Ks (reported only). 10 000 fits one wasm instance; see run.json if one fails. */
const SWEEP_KS = [100, 1000, 10000];

/** Deterministic PRNG so a run's cell order can be replayed (mulberry32). */
function rng(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(seed);
const shuffled = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** One cell: a sim weight K per tick, run under a given CDP CPU throttle. */
const cell = (tag, k, throttle, ms) => ({
  id: `${tag}-k${k}-${throttle}x`,
  tag,
  k,
  throttle,
  ms,
});

// The smoke run must exercise the same blocks the full run does: the budget cell (K=20 at 1x and 4x)
// and one K=1 cell under a throttle. ~5 s each, plus the grace if a trace pass needs it.
const quickMatrix = () => [cell('budget', 20, 1, CELL_MS), cell('budget', 20, 4, CELL_MS), cell('k1', 1, 4, CELL_MS)];

const matrix = () => {
  const once = [];
  for (const throttle of [1, 4, 6]) once.push(cell('k1', 1, throttle, CELL_MS));
  for (const throttle of [1, 4]) once.push(cell('budget', 20, throttle, CELL_MS));
  // The sweep finds where the main thread starts to pay: 100, 1 000 and 10 000 sessions per tick.
  for (const throttle of [1, 4]) for (const k of SWEEP_KS) once.push(cell('sweep', k, throttle, SHORT_MS));
  // One entry per config: the rounds in `ordered` (below) add the repeats, interleaved.
  return once;
};
const repetitions = (c) => ['k1', 'budget'].includes(c.tag);

const configs = quick ? quickMatrix() : matrix();
// Round 1: every config once, in a random order fixed by --seed. Rounds 2..3: the repeated configs
// only, shuffled again, so drift and background load land on all cells alike.
const ordered = (() => {
  const repeated = configs.filter(repetitions);
  return [configs, repeated, repeated].flatMap((r) => shuffled(r));
})();

const CHROMIUM_ARGS = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const url = (c) =>
  `${origin}/bench/?k=${c.k}&duration=${c.ms / 1000}&grace=${GRACE_S}&throttle=${c.throttle}` +
  `&tag=${c.tag}&spin1x=${SPIN_1X_MS ?? 0}&cell=${encodeURIComponent(c.id)}`;

const server = await serve(site, 0);
const origin = `http://127.0.0.1:${server.address().port}`;
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + (quick ? '-quick' : '');
const dir = join(root, runId);
mkdirSync(dir, { recursive: true });
const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 1));
/** Plain text, for the summary a reader opens directly. */
const writeText = (name, text) => writeFileSync(join(dir, name), text);

const problems = [];
const calibration = [];
/** Frame-scale spin time at 1x, from the calibration: the denominator of each cell's throttleSeen. */
let SPIN_1X_MS = null;
let browserVersion = '';

/**
 * The 1x reference for the in-cell throttle check: the page's fixed spin timed with no throttle.
 * The 4x and 6x points are not calibrated here; every cell measures its own throttle (throttleSeen)
 * against this figure, which is the number A3.2a gates on.
 */
async function calibrate(browser) {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.goto(`${origin}/bench/?mode=calibrate&throttle=1`);
  await page.waitForFunction(() => window.__bench?.status === 'done' || window.__bench?.status === 'failed', null, { timeout: 120_000 });
  const result = await page.evaluate(() => (window.__bench?.result ? window.__bench.result : { error: window.__bench?.error }));
  const vis = await page.evaluate(() => document.visibilityState);
  await context.close();
  if (result.error) throw new Error(`calibration: ${result.error}`);
  return { ...result, visibility: vis };
}

/** Run one cell: fresh context, the throttle set before the page loads, then wait for the cell to end. */
async function runCell(browser, c) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.throttle });
  const log = [];
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && log.push(`console: ${m.text()}`));
  page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

  await page.goto(url(c));
  await page.bringToFront();
  try {
    await page.waitForFunction(() => window.__bench?.status === 'running' || window.__bench?.status === 'failed', null, { timeout: 120_000 });
  } catch (err) {
    const said = await page.evaluate(() => ({ bench: window.__bench ?? null, visibility: document.visibilityState })).catch(() => null);
    await context.close();
    throw new Error(`${c.id} never started (${err.message.split('\n')[0]}); page said ${JSON.stringify(said)}\n${log.join('\n')}`);
  }
  const failed = await page.evaluate(() => window.__bench?.error);
  if (failed) {
    await context.close();
    throw new Error(`${c.id} failed to start: ${failed}`);
  }

  // A cell ends itself (its length, plus the grace to finish one trace pass), or a long timeout says
  // it hung; nothing is pressed.
  await page.waitForFunction(() => window.__bench?.status === 'done', null, { timeout: 180_000 });
  const result = await page.evaluate(() => window.__bench?.result);
  await context.close();
  result.pageLog = log;
  return result;
}

let browser;
try {
  browser = await chromium.launch({ headless: false, args: CHROMIUM_ARGS });
  browserVersion = browser.version();
  console.log(`bench ${runId}: ${quick ? `quick (${CELL_MS / 1000} s cells)` : `full (${CELL_MS / 1000} s cells)`}, seed ${seed}`);
  console.log(`site ${site} at ${origin}, Chromium ${browserVersion}`);

  // 1. The 1x reference for the in-cell throttle check.
  calibration.push(await calibrate(browser));
  write('calibration.json', calibration);
  SPIN_1X_MS = calibration[0].frameScaleMs;
  console.log(`calibration 1x: ${SPIN_1X_MS.toFixed(0)} ms for ${calibration[0].checkReps} x ${calibration[0].checkIters} spin iterations`);

  // 2. The matrix.
  console.log(`${ordered.filter((c) => c.id.includes(only) && (ks === null || ks.includes(c.k))).length} cells${only ? ` (only "${only}")` : ''}`);
  const results = [];
  const chosen = ordered.filter((c) => c.id.includes(only) && (ks === null || ks.includes(c.k)));
  for (const [i, c] of chosen.slice(0, limit).entries()) {
    const started = Date.now();
    let result;
    try {
      result = await runCell(browser, c);
    } catch (err) {
      problems.push(`${c.id}: ${String(err.message).split('\n')[0]}`);
      console.log(`[${i + 1}/${chosen.length}] ${c.id}: FAILED ${((Date.now() - started) / 1000).toFixed(1)} s — ${String(err.message).split('\n')[0]}`);
      write(`cell-${String(i).padStart(2, '0')}-${c.id}.json`, { config: c, error: String(err.message) });
      continue;
    }
    result.seq = i;
    results.push(result);
    write(`cell-${String(i).padStart(2, '0')}-${c.id}.json`, result);
    const h = result.header;
    // K=1000 and K=10000 only fit because the K sessions share one wasm instance (sim.ts).
    if (h.wasmInstances !== 1) problems.push(`${c.id}: ${h.wasmInstances} wasm instances, expected 1 (K sessions share one)`);
    const done = h.gates.filter((g) => g.measured);
    const verdict = h.hashOk ? `${done.length} measured pass(es), final ${h.gates.at(-1).hash} golden` : 'HASH MISMATCH';
    const seen = h.throttleSeen === null ? 'n/a' : `x${h.throttleSeen.toFixed(2)}`;
    console.log(
      `[${i + 1}/${chosen.length}] ${c.id}: ${verdict}${h.hiddenSeen ? ' HIDDEN' : ''} ` +
        `throttle ${seen} clips ${h.clips} ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    if (!h.hashOk) {
      const bad = h.gates.find((g) => !g.ok) ?? h.gates[0];
      problems.push(`${c.id}: hash ${bad?.hash} != golden ${bad?.golden}`);
    }
    if (h.hiddenSeen) problems.push(`${c.id}: the tab was hidden during the cell`);
    if (result.pageLog.length) problems.push(`${c.id}: ${result.pageLog.join('; ')}`);
  }
  write('cells.json', results.map((r) => ({ id: r.config.cell, config: r.config, header: r.header })));
  write('run.json', {
    runId,
    quick,
    seed,
    site,
    chromium: browserVersion,
    machine: {
      cpu: cpus()[0].model,
      cores: cpus().length,
      memGiB: Math.round(totalmem() / 2 ** 30),
      platform: platform(),
      release: release(),
      arch: arch(),
    },
    calibration,
    cells: ordered.map((c) => c.id),
    problems,
  });

  const summary = report(dir);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
  }
  writeText('summary.txt', summary);
  console.log(`raw JSON: ${dir}`);
  process.exitCode = problems.length ? 1 : 0;
} finally {
  await browser?.close();
  server.close();
}
