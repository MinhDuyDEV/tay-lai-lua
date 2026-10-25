// The sim-core placement bench: main thread or Worker, under the yard+traffic scene, measured on this
// Mac's real GPU in headed Chromium. One cell = one page load = one config, chosen by query string.
//
//   node bench.mjs [--site apps/web/out] [--quick] [--seed 20261025] [--out ~/.litter/bench]
//
// What it does, in order:
//  1. Calibration: the same fixed spin loop timed on the main thread and in the Worker at 1x/4x/6x.
//     CDP's CPU throttle reaches the page's main thread, not a dedicated Worker (measured: attaching
//     to the worker target answers "Operation is only supported for pages"), so the Worker's
//     slow-down is modelled by dilating its sim batch (`slow=` query, see host/worker.ts). The
//     calibration reports the measured ratio for main (CDP), Worker (dilated) and Worker (raw).
//  2. The matrix: {main,worker} x {1x,4x,6x} x 3 at K=1; the decision cell K=20 at {1x,4x} x 3
//     plus the Worker unpadded at 4x x 3 (reported, not deciding); K=10/100/400 x {1x,4x} x 1;
//     one uncapped pass at 1x (a browser launched with vsync off). Repeats are interleaved round by
//     round, and the cells run in a random order fixed by --seed.
//  3. Writes the raw per-frame JSON of every cell under <out>/<run-id>/ and prints the table
//     (bench-report.mjs prints the same table from the directory later).
//
// The page never sees a key as input: a marker is a counter the sim ignores. Every trace pass the
// first session completes is checked against golden/<trace>.hash, and only a valid cell is used.
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
const seed = Number(args.get('seed') ?? 20261025);
const root = args.get('out') ?? join(homedir(), '.litter', 'bench');
const CELL_MS = quick ? 5000 : 15000;
const SHORT_MS = quick ? 5000 : 8000;
/** A cell runs past its length if needed, to complete one trace pass (the pass is its hash check). */
const GRACE_S = 8;
/** Calibration spin loop per call; the measured ratios are what matter, not the absolute size. */
const SPIN_ITERS = Number(args.get('spin-iters') ?? 1_000_000);

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

/**
 * One cell config. `slow` is the Worker's sim dilation: the page throttle reaches the main thread
 * only, so a throttled Worker is modelled by dilating its sim batch by the same factor.
 */
const cell = (tag, host, k, throttle, ms, { uncapped = false, slow = host === 'worker' ? throttle : 1 } = {}) => ({
  id: `${tag}-${host}-k${k}-${throttle}x${slow > 1 ? `-slow${slow}` : ''}${uncapped ? '-uncapped' : ''}`,
  tag,
  host,
  k,
  throttle,
  slow,
  ms,
  uncapped,
});

const quickMatrix = () => [
  cell('quick', 'main', 20, 1, CELL_MS),
  cell('quick', 'main', 20, 4, CELL_MS),
  cell('quick', 'worker', 20, 1, CELL_MS),
  cell('quick', 'worker', 20, 4, CELL_MS),
  cell('quick', 'worker', 20, 4, CELL_MS, { slow: 1 }),
];

const matrix = () => {
  const once = [];
  for (const host of ['main', 'worker']) {
    for (const throttle of [1, 4, 6]) once.push(cell('k1', host, 1, throttle, CELL_MS));
    for (const throttle of [1, 4]) once.push(cell('decision', host, 20, throttle, CELL_MS));
    for (const throttle of [1, 4]) for (const k of [10, 100, 400]) once.push(cell('sweep', host, k, throttle, SHORT_MS));
    once.push(cell('uncapped', host, 20, 1, SHORT_MS, { uncapped: true }));
  }
  once.push(cell('unpadded', 'worker', 20, 4, CELL_MS, { slow: 1 }));
  // One entry per config: the rounds in `ordered` (below) add the repeats, interleaved.
  return once;
};
const repetitions = (c) => ['k1', 'decision', 'unpadded'].includes(c.tag);

const configs = quick ? quickMatrix() : matrix();
// Round 1: every config once, in a random order fixed by --seed. Rounds 2..3: the repeated configs
// only, shuffled again, so drift and background load land on all cells alike. The uncapped pass
// runs last, in a browser of its own (vsync off), so it cannot disturb the vsync cells.
const escape = configs.filter((c) => c.uncapped);
const ordered = (() => {
  const rounds = [configs.filter((c) => !c.uncapped)];
  const repeated = configs.filter((c) => !c.uncapped && repetitions(c));
  rounds.push(repeated, repeated);
  return [...rounds.flatMap((r) => shuffled(r)), ...escape];
})();

const chromiumArgs = (uncapped) => [
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
];
const url = (c) =>
  `${origin}/bench/?host=${c.host}&k=${c.k}&duration=${c.ms / 1000}&grace=${GRACE_S}&slow=${c.slow}&throttle=${c.throttle}` +
  `&uncapped=${c.uncapped ? 1 : 0}&tag=${c.tag}&cell=${encodeURIComponent(c.id)}`;

const server = await serve(site, 0);
const origin = `http://127.0.0.1:${server.address().port}`;
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + (quick ? '-quick' : '');
const dir = join(root, runId);
mkdirSync(dir, { recursive: true });
const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 1));

const problems = [];
const calibration = [];
let browserVersion = '';

/** Run one calibration point: main spin (CDP-throttled), Worker spin raw and dilated. */
async function calibrate(browser, throttle) {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`${origin}/bench/?mode=calibrate&throttle=${throttle}&slow=${throttle}`);
  await page.waitForFunction(() => window.__bench?.status === 'done' || window.__bench?.status === 'failed', null, { timeout: 120_000 });
  const result = await page.evaluate(() => (window.__bench?.result ? window.__bench.result : { error: window.__bench?.error }));
  const vis = await page.evaluate(() => document.visibilityState);
  await context.close();
  if (result.error) throw new Error(`calibration at ${throttle}x: ${result.error}`);
  calibration.push(result);
  return { ...result, visibility: vis };
}

/**
 * The question the calibration cannot answer by itself: can CDP's CPU throttle be put on the Worker
 * target directly? Attach to the worker and ask; then time the same spin loop in the Worker again.
 * Reported in run.json so the claim in the summary is a measurement, not a recollection.
 */
async function probeWorkerTarget(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('about:blank');
  // A Worker that can time the spin loop, kept alive until the context closes.
  await page.setContent(`<script>
    const spin = (iters) => { let x = 1; for (let i = 0; i < iters; i += 1) x = (x * 1.0000001 + i) % 7; return x; };
    const src = 'const spin = ' + spin.toString() + '; onmessage = (e) => postMessage(spin(e.data));';
    window.__w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    window.__spinInWorker = (iters) => new Promise((resolve) => {
      const t = performance.now();
      window.__w.onmessage = () => resolve(performance.now() - t);
      window.__w.postMessage(iters);
    });
  </script>`);
  const time = async () => {
    await page.evaluate(() => window.__spinInWorker(8_000_000));
    const reps = [];
    for (let i = 0; i < 5; i += 1) reps.push(await page.evaluate(() => window.__spinInWorker(8_000_000)));
    return reps.sort((a, b) => a - b)[2];
  };
  const before = await time();
  const browserCdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets');
  const workers = targetInfos.filter((t) => t.type === 'worker');
  let attach = 'no worker target found';
  let throttleReply = 'not attempted';
  if (workers.length) {
    try {
      const attached = await browserCdp.send('Target.attachToTarget', { targetId: workers[0].targetId, flatten: false });
      attach = `attached (session ${attached.sessionId.slice(0, 8)})`;
      const replies = [];
      browserCdp.on('Target.receivedMessageFromTarget', (e) => replies.push(e.message));
      await browserCdp.send('Target.sendMessageToTarget', {
        sessionId: attached.sessionId,
        message: JSON.stringify({ id: 1, method: 'Emulation.setCPUThrottlingRate', params: { rate: 4 } }),
      });
      await new Promise((r) => setTimeout(r, 500));
      throttleReply = replies.join(' ') || 'no reply';
      await browserCdp.send('Target.detachFromTarget', { sessionId: attached.sessionId });
    } catch (err) {
      attach = `failed: ${err.message.split('\n')[0]}`;
    }
  }
  const after = await time();
  await context.close();
  return {
    workerTargets: workers.length,
    attach,
    throttleReply,
    spinMsBefore: before,
    spinMsAfter: after,
    ratioAfterAttach: after / before,
  };
}

/** Run one cell: fresh context, throttle set before the page loads, keys at phases the page picks. */
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

  // Keys: the page arms on its own rAF clock, so each press lands at a random phase against vsync.
  // About one every 180 ms, the pace of a learner changing something, not a key storm.
  const t0 = Date.now();
  let keys = 0;
  while (Date.now() - t0 < c.ms - 300) {
    if ((await page.evaluate(() => window.__bench?.status)) !== 'running') break;
    // The offset within the frame comes from the run's seed, so a replayed run presses alike.
    await page.evaluate((phase) => window.__bench?.armKey(phase), random());
    await page.keyboard.press('KeyM');
    keys += 1;
    await page.waitForTimeout(120 + Math.random() * 120);
  }
  await page.waitForFunction(() => window.__bench?.status === 'done', null, { timeout: 120_000 });
  const result = await page.evaluate(() => window.__bench?.result);
  await context.close();
  result.keysPressed = keys;
  result.pageLog = log;
  return result;
}

let browser;
let fastBrowser;
try {
  browser = await chromium.launch({ headless: false, args: chromiumArgs(false) });
  browserVersion = browser.version();
  console.log(`bench ${runId}: ${quick ? `quick (${CELL_MS / 1000} s cells)` : `full (${CELL_MS / 1000} s cells)`}, seed ${seed}`);
  console.log(`site ${site} at ${origin}, Chromium ${browserVersion}`);

  // 1. Calibration, before any cell: does the throttle reach each host?
  for (const r of [1, 4, 6]) {
    const point = await calibrate(browser, r);
    const base = calibration[0];
    const x = (ms, ref) => (ms / ref).toFixed(2);
    console.log(
      `calibration ${r}x: main ${point.mainMs.toFixed(0)} ms x${x(point.mainMs, base.mainMs)}, ` +
        `worker raw ${point.workerRawMs.toFixed(0)} ms x${x(point.workerRawMs, base.workerRawMs)}, ` +
        `worker dilated ${point.workerPaddedMs.toFixed(0)} ms x${x(point.workerPaddedMs, base.workerPaddedMs)}`,
    );
  }
  write('calibration.json', calibration);
  const at1 = calibration[0];
  const at4 = calibration.find((c) => c.throttle === 4);
  const reach = {
    main: { ratio: at4.mainMs / at1.mainMs, want: '>= 3' },
    workerDilated: { ratio: at4.workerPaddedMs / at1.workerPaddedMs, want: '>= 3' },
    workerRaw: { ratio: at4.workerRawMs / at1.workerRawMs, want: '<= 1.5' },
  };
  reach.main.ok = reach.main.ratio >= 3;
  reach.workerDilated.ok = reach.workerDilated.ratio >= 3;
  reach.workerRaw.ok = reach.workerRaw.ratio <= 1.5;
  for (const [name, v] of Object.entries(reach)) {
    console.log(`calibration reach ${name} at 4x: x${v.ratio.toFixed(2)} (want ${v.want}) ${v.ok ? 'ok' : 'MISS'}`);
    if (!v.ok) problems.push(`calibration MISS: ${name} at 4x measured x${v.ratio.toFixed(2)}, want ${v.want}`);
  }
  write('reach.json', reach);
  // The direct route: put the throttle on the worker target itself. Reported either way.
  const workerCdp = await probeWorkerTarget(browser);
  console.log(
    `worker target under CDP: ${workerCdp.attach}; Emulation.setCPUThrottlingRate -> ${workerCdp.throttleReply}; ` +
      `spin ${workerCdp.spinMsBefore.toFixed(0)} -> ${workerCdp.spinMsAfter.toFixed(0)} ms (x${workerCdp.ratioAfterAttach.toFixed(2)})`,
  );
  if (workerCdp.ratioAfterAttach >= 3) {
    problems.push('the worker target DID accept the throttle; the dilation model must be reconsidered before any number is used');
  }
  write('worker-cdp.json', workerCdp);

  // 2. The matrix. The uncapped pass gets its own browser (vsync off) after the vsync one is closed.
  console.log(`${ordered.length} cells`);
  const results = [];
  for (const [i, c] of ordered.slice(0, limit).entries()) {
    if (c.uncapped && !fastBrowser) {
      await browser.close();
      fastBrowser = await chromium.launch({ headless: false, args: chromiumArgs(true) });
    }
    const started = Date.now();
    let result;
    try {
      result = await runCell(c.uncapped ? fastBrowser : browser, c);
    } catch (err) {
      problems.push(`${c.id}: ${String(err.message).split('\n')[0]}`);
      console.log(`[${i + 1}/${ordered.length}] ${c.id}: FAILED ${((Date.now() - started) / 1000).toFixed(1)} s — ${String(err.message).split('\n')[0]}`);
      write(`cell-${String(i).padStart(2, '0')}-${c.id}.json`, { config: c, error: String(err.message) });
      continue;
    }
    result.seq = i;
    results.push(result);
    write(`cell-${String(i).padStart(2, '0')}-${c.id}.json`, result);
    const h = result.header;
    const done = h.gates.filter((g) => g.measured);
    const verdict = h.hashOk ? `${done.length} measured pass(es), final ${h.gates.at(-1).hash} golden` : 'HASH MISMATCH';
    console.log(
      `[${i + 1}/${ordered.length}] ${c.id}: ${verdict}${h.hiddenSeen ? ' HIDDEN' : ''} ` +
        `keys ${result.keysPressed}, ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    if (!h.hashOk) {
      const bad = h.gates.find((g) => !g.ok) ?? h.gates[0];
      problems.push(`${c.id}: hash ${bad?.hash} != golden ${bad?.golden}`);
    }
    if (h.hiddenSeen) problems.push(`${c.id}: the tab was hidden during the cell`);
    if (result.pageLog.length) problems.push(`${c.id}: ${result.pageLog.join('; ')}`);
  }
  write('cells.json', results.map((r) => ({ id: r.config.cell, config: r.config, header: r.header, keys: r.keysPressed })));
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
    reach,
    workerCdp,
    cells: ordered.map((c) => c.id),
    problems,
  });

  const summary = report(dir);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
  }
  write('summary.txt', summary);
  console.log(`raw JSON: ${dir}`);
  process.exitCode = problems.length ? 1 : 0;
} finally {
  await browser?.close();
  await fastBrowser?.close();
  server.close();
}
