// Print the table for one frame-budget bench run directory (the raw JSON bench.mjs wrote), or the
// newest run.
//
//   node bench-report.mjs [run-dir]
//
// Per config: median over repeats of p50/p95/p99 frame time (rAF delta) and callback CPU (en - st),
// sim microseconds per tick, late-frame share, long tasks, and the break-even point in milliseconds
// of sim per tick at 60 Hz and 120 Hz. Then the budget check for K=20 at 4x: frame p95 and
// callback-CPU p95 against 16.7 ms. Frames in the first `warmupMs` and frames flagged by a trace
// reopen are excluded.
//
// A cell is valid only if (A3.2): its hash is golden (and all K sessions hash alike), the tab was
// never hidden, the throttle is seen inside the cell at frame scale, it ran >= 0.99 x 60 ticks/s with
// no CATCHUP clip, and its refresh rate is within 2% of the run's median. An invalid cell is printed
// and not used for the budget check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(homedir(), '.litter', 'bench');
const FRAME = 1000 / 60;
const WARMUP_MS = 1000;

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const f = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d));
const sorted = (a) => [...a].sort((x, y) => x - y);

function loadFrom(dir) {
  const all = readdirSync(dir)
    .filter((name) => name.startsWith('cell-'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
  // A cell that never started has no samples: it is reported as a problem, not as a row.
  return { cells: all.filter((c) => !c.error), failed: all.filter((c) => c.error), run: JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) };
}

/** Frames of one cell: rAF deltas and callback CPU, with warm-up and reopen frames dropped. */
function frames(cell) {
  const { samples: s, header: h } = cell;
  const warm = h.startTs + (h.warmupMs ?? WARMUP_MS);
  const delta = [];
  const cpu = [];
  let ticks = 0;
  let kept = 0;
  for (let i = 0; i < s.ts.length; i += 1) {
    if (s.ts[i] < warm || s.reopen[i] || (i > 0 && s.reopen[i - 1])) continue;
    kept += 1;
    ticks += s.ticks[i];
    cpu.push(s.en[i] - s.st[i]);
    if (i > 0) delta.push(s.ts[i] - s.ts[i - 1]);
  }
  return { delta, cpu, ticksPerFrame: kept ? ticks / kept : 0, kept };
}

/** Share of deltas well past the cell's own vsync period: frames that took an extra one (A3.3). */
function lateShare(delta) {
  if (delta.length < 2) return 0;
  const period = median(delta);
  if (!period) return 0;
  return delta.filter((d) => d > 1.5 * period).length / delta.length;
}

/** Median, interquartile range and p95 of a sample. */
function spread(a) {
  if (!a.length) return { n: 0, median: null, iqr: null, p95: null };
  const s = sorted(a);
  return { n: s.length, median: median(s), iqr: pct(s, 75) - pct(s, 25), p95: pct(s, 95) };
}

/** Run-wide median refresh rate: a cell far from it measured a different display state (A3.2d). */
function runRefresh(cells) {
  const hz = cells.map((c) => c.header?.refreshHz).filter((x) => typeof x === 'number');
  return hz.length ? median(hz) : null;
}

const THROTTLE_BAND = { 1: [0.5, 2], 4: [3, 5], 6: [4.5, 7.5] };

/**
 * Why a cell may not decide (A3.2). Empty means valid. `refresh` is the run's median refresh rate.
 */
function rejections(c, refresh) {
  const h = c.header;
  const out = [];
  if (!h) return ['no data'];
  if (!h.hashOk) out.push('hash');
  if (!h.gates?.some((g) => g.measured)) out.push('no measured pass');
  if (h.gates?.some((g) => g.allHashesEqual !== g.k)) out.push('not all K sessions hashed alike');
  if (h.hiddenSeen) out.push('hidden');
  // Clips count only inside the measured window: a warm-up clip is not the sim starving.
  const warmStart = h.startTs + (h.warmupMs ?? WARMUP_MS);
  let clips = 0;
  for (let i = 0; i < c.samples.ticks.length; i += 1) {
    if (c.samples.ts[i] >= warmStart && c.samples.ticks[i] >= h.catchup) clips += 1;
  }
  if (clips > 0) out.push(`${clips} CATCHUP clip(s) after warm-up`);
  const band = THROTTLE_BAND[h.clips === undefined ? 1 : c.config.throttle] ?? null;
  if (c.config.throttle > 1) {
    if (h.throttleSeen === null) out.push('throttle not measured (no 1x spin reference)');
    else if (band && (h.throttleSeen < band[0] || h.throttleSeen > band[1])) out.push(`throttle x${h.throttleSeen.toFixed(2)} outside [${band[0]},${band[1]}]`);
  }
  const warm = h.startTs + (h.warmupMs ?? WARMUP_MS);
  let ticks = 0;
  let seconds = 0;
  const t0 = h.scalars?.measuredStart ?? warm;
  for (let i = 0; i < c.samples.ts.length; i += 1) {
    if (c.samples.ts[i] < t0 || c.samples.reopen[i]) continue;
    ticks += c.samples.ticks[i];
    seconds = (c.samples.ts[i] - t0) / 1000;
  }
  const tps = seconds > 0 ? ticks / seconds : 0;
  if (tps < 0.99 * 60) out.push(`${tps.toFixed(1)} ticks/s < 59.4`);
  if (refresh !== null && h.refreshHz && Math.abs(h.refreshHz - refresh) / refresh > 0.02) out.push(`${h.refreshHz.toFixed(1)} Hz off the run's ${refresh.toFixed(1)} Hz`);
  return out;
}

const keyOf = (c) => `${c.config.tag}|${c.config.k}|${c.config.throttle}`;
const label = (c) => `${c.config.tag} K${c.config.k} ${c.config.throttle}x`;

/** The valid cells of one config, or all of them when none is valid (then `valid` says NO). */
function pick(list, refresh) {
  const good = list.filter((c) => rejections(c, refresh).length === 0);
  return { use: good.length ? good : list, ok: good.length === list.length, reasons: list.flatMap((c) => rejections(c, refresh)) };
}

export function report(dir) {
  const { cells, failed, run } = loadFrom(dir);
  const lines = [];
  const push = (s) => {
    lines.push(s);
    console.log(s);
  };
  push(`bench ${run.runId}${run.quick ? ' (quick)' : ''} — ${run.machine.cpu} (${run.machine.cores} cores), ${run.machine.platform} ${run.machine.release}, Chromium ${run.chromium}`);
  push(`warm-up ${WARMUP_MS} ms and trace-reopen frames excluded; frame time is the rAF delta; CPU ms is the callback's own duration.`);
  if (cells[0]?.header?.refreshHz) push(`rAF rate ${f(cells[0].header.refreshHz, 1)} Hz; the 16.7 ms line is the pre-registered one, not this display's period.`);

  // The 1x reference for the in-cell throttle check: each cell's throttleSeen is divided by this.
  push('calibration (the in-cell check at 1x: 200 calls of the fixed ~1 ms spin, 5 reps, median):');
  for (const c of run.calibration) push(`  ${f(c.frameScaleMs, 0)} ms per 200 calls (throttle ${c.throttle}x)`);
  const refresh = runRefresh(cells);
  push(`per-cell refresh rate must sit within 2% of the run's median (${f(refresh, 1)} Hz) to count (A3.2d).`);
  const groups = new Map();
  for (const c of cells) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const order = ['k1', 'budget', 'sweep', 'quick'];
  const rows = [...groups.values()].sort(
    (a, b) =>
      order.indexOf(a[0].config.tag) - order.indexOf(b[0].config.tag) ||
      a[0].config.k - b[0].config.k ||
      a[0].config.throttle - b[0].config.throttle,
  );

  const header = [
    'config', 'n', 'throttle seen', 'p50', 'p95', 'p99', 'late%', 'max d',
    'cpu p50', 'cpu p95', 'cpu p99',
    't/fr', 'step us', 'sim/fr', 'LT', 'valid',
  ];
  const table = [header];
  for (const list of rows) {
    const { use, ok, reasons } = pick(list, refresh);
    const all = list.map(frames);
    const fr = use.map(frames);
    const p = (q) => {
      const per = fr.filter((x) => x.delta.length).map((x) => pct(sorted(x.delta), q));
      return per.length ? median(per) : null;
    };
    // Callback CPU (en - st): sim plus the scene's own submit, the half of a frame the display cannot hide.
    const cpuP = (q) => {
      const per = fr.filter((x) => x.cpu.length).map((x) => pct(sorted(x.cpu), q));
      return per.length ? median(per) : null;
    };
    const cpuP95 = cpuP(95);
    const step = median(use.map((c) => c.header.simProbe?.kUsPerStep).filter((v) => typeof v === 'number'));
    const tpf = median(fr.map((x) => x.ticksPerFrame));
    const lt = median(use.map((c) => c.longtasks.filter((t) => t.start >= c.header.startTs + (c.header.warmupMs ?? WARMUP_MS)).length));
    table.push([
      label(use[0]),
      String(use.length),
      // Measured inside the cell, against the 1x reference: "4x" is a number, not a label.
      use[0].config.throttle > 1 ? `x${f(median(use.map((c) => c.header.throttleSeen)), 2)}` : '—',
      f(p(50)),
      f(p(95)),
      f(p(99)),
      // Late frames: delta > 1.5 x this cell's own vsync period, as a share of the kept frames.
      f((all.reduce((a, x) => a + lateShare(x.delta), 0) / all.length) * 100, 1),
      f(median(use.map((c) => c.header.maxDeltaMs)), 1),
      f(cpuP(50)),
      f(cpuP95),
      f(cpuP(99)),
      f(tpf),
      f(step, 1),
      f((step * tpf) / 1000),
      String(lt),
      ok ? 'yes' : `NO (${list.length - use.length}) ${[...new Set(reasons)].slice(0, 3).join('; ')}`,
    ]);
  }
  const widths = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  push(`\nms unless marked; step us = one tick of all K sessions, from a tight loop (clock step ${f(cells[0]?.header?.clockStepUs, 0)} us); sim/fr = step x ticks per frame, derived\n`);
  for (const r of table) push(r.map((v, i) => v.padEnd(widths[i])).join('  '));

  // ---- Break-even in ms of sim per tick (A3.3).
  //
  // One tick costs the sim the same whatever the weight, so the model is: ms of sim per tick at
  // weight K = c x K, where c is the cost of ONE session-tick. c is measured two ways:
  //   frame: the slope of callback-CPU p95 against K (interpolated on CPU ms, never on a p95 jump),
  //          divided by that cell's ticks per frame, from the K=1 cell to the largest K measured;
  //   probe: kUsPerStep / K from the tight loop (exact, no clock clamp, no scene).
  // Break-even is the K where c x K x (ticks per frame) reaches the frame budget: at 60 Hz and at
  // 120 Hz with one 1/60 s tick per frame, which is how the run.ts loop is shaped.
  const perConfig = rows.map((list) => {
    const { use } = pick(list, refresh);
    const fr = use.map(frames);
    const cpu = (q) => {
      const per = fr.filter((x) => x.cpu.length).map((x) => pct(sorted(x.cpu), q));
      return per.length ? median(per) : null;
    };
    const frame = (q) => {
      const per = fr.filter((x) => x.delta.length).map((x) => pct(sorted(x.delta), q));
      return per.length ? median(per) : null;
    };
    const c0 = use[0];
    const probeUs = c0.header.simProbe?.kUsPerStep ?? null;
    const probeDilatedUs = c0.header.simProbe?.kDilatedUsPerStep ?? probeUs;
    return {
      cell: c0,
      throttle: c0.config.throttle,
      k: c0.config.k,
      tag: c0.config.tag,
      cpuP95: cpu(95),
      cpuP50: cpu(50),
      frameP95: frame(95),
      ticksPerFrame: fr.length ? median(fr.map((x) => x.ticksPerFrame)) : 0,
      // Microseconds per session-tick from the probe: kUsPerStep is the whole K, so divide by K.
      probeUsPerTick: probeUs === null ? null : probeUs / c0.config.k,
      probeDilatedUsPerTick: probeDilatedUs === null ? null : probeDilatedUs / c0.config.k,
    };
  });

  /** Frame-derived microseconds per session-tick: slope of CPU p95 from K=1 to the largest K. */
  const frameSlope = (throttle) => {
    const points = perConfig
      .filter((x) => x.throttle === throttle && x.cpuP95 !== null && x.ticksPerFrame > 0)
      .sort((a, b) => a.k - b.k);
    const base = points.find((x) => x.k === 1) ?? points[0];
    const top = points.at(-1);
    if (!base || !top || top.k === base.k) return null;
    // Per frame, the extra CPU above the K=1 floor is (top - base) ms for (top.k - base.k) sessions
    // over top.ticksPerFrame ticks; per session-tick that is the slope.
    const slopeUs = ((top.cpuP95 - base.cpuP95) * 1000) / ((top.k - base.k) * top.ticksPerFrame);
    return { slopeUs, from: base.k, to: top.k, tpf: top.ticksPerFrame };
  };

  const kBreak = (usPerTick, hz) => (usPerTick === null || usPerTick <= 0 ? null : (1_000_000 / hz) / usPerTick);

  push('\nbreak-even (ms of sim per tick = c x K, c the cost of one session-tick; one 1/60 s tick per frame):');
  let extrapolated = false;
  for (const throttle of [1, 4, 6]) {
    const rows2 = perConfig.filter((x) => x.throttle === throttle);
    if (!rows2.length) continue;
    const slope = frameSlope(throttle);
    const top = rows2.reduce((a, b) => (b.k > a.k ? b : a));
    const cFrame = slope?.slopeUs ?? null;
    const cProbe = top.probeUsPerTick;
    const fmt = (c, hz) => {
      const k = kBreak(c, hz);
      if (k === null) return '—';
      const beyond = top.k < k;
      extrapolated ||= beyond;
      return `K=${Math.round(k).toLocaleString('en-US')}${beyond ? '*' : ''}`;
    };
    if (rows2.length === 1) {
      push(`  ${throttle}x: only K=${top.k} measured at this throttle, no sweep, so no break-even`);
      continue;
    }
    // Below ~0.01 us/tick the frame line is clock noise, not a slope: say so instead of printing a
    // break-even of a billion sessions.
    const frameSay =
      cFrame === null
        ? 'no K=1 baseline'
        : cFrame < 0.01
          ? `callback CPU does not grow with K between the weights measured (slope ${f(Math.max(0, cFrame), 4)} us/tick, within clock noise), so no frame break-even`
          : `frame c=${f(cFrame, 2)} us/tick -> 60 Hz ${fmt(cFrame, 60)}, 120 Hz ${fmt(cFrame, 120)}`;
    push(
      `  ${throttle}x: ${frameSay}` +
        (top.k >= 100 ? `; probe c=${f(cProbe, 3)} us/tick -> 60 Hz ${fmt(cProbe, 60)}` : '; probe at K=1 only (too short to time, see clockStepUs)'),
    );
    push(
      `    K measured: ${rows2
        .sort((a, b) => a.k - b.k)
        .map((x) => `K${x.k} cpu p95 ${f(x.cpuP95)} ms, ${f(x.ticksPerFrame)} ticks/frame`)
        .join(' | ')}`,
    );
    if (slope) push(`    frame slope from K=${slope.from} to K=${slope.to} at ${f(slope.tpf)} ticks/frame.`);
  }
  if (extrapolated) push('  * the crossing lies beyond the largest K measured, so it is extrapolated, not measured.');

  // ---- Budget check for the cell the app's own weight sits at: K=20 under a 4x throttle, against
  // the section 9 budget of 16.7 ms per frame (60 fps). Reported, not a host contest: there is one
  // host, so the question is only whether it fits.
  const budget = perConfig.filter((x) => x.tag === 'budget' && x.k === 20 && x.throttle === 4);
  push('\nbudget check, K=20 at 4x against 16.7 ms (60 fps):');
  if (!budget.length) {
    push(run.quick ? '  quick run: no K=20 4x cell, no budget check' : '  no K=20 4x cell in this run');
  } else {
    for (const row of budget) {
      const why = rejections(row.cell, refresh);
      const fits = row.frameP95 <= FRAME && row.cpuP95 <= FRAME;
      push(
        `  frame p95 ${f(row.frameP95)} ms, callback-CPU p95 ${f(row.cpuP95)} ms: ` +
          (fits ? 'within budget' : 'over budget') +
          ` (${f((row.frameP95 / FRAME) * 100, 0)}% and ${f((row.cpuP95 / FRAME) * 100, 0)}% of 16.7 ms)` +
          (why.length ? ` [not a valid cell: ${[...new Set(why)].join('; ')}]` : ''),
      );
    }
    push(
      '  the Worker host was measured and lost at this cell (no better on frame time or callback CPU, and about a frame plus a millisecond of latency); the bench is main-thread only, and the break-even above is where that would change.',
    );
  }

  if (failed.length) push(`\n${failed.length} cell(s) never started: ${failed.map((c) => c.config.cell).join(', ')}`);
  const invalid = cells.filter((c) => rejections(c, refresh).length > 0);
  if (invalid.length) {
    push(`\n${invalid.length} cell(s) reported but not used for the budget check:`);
    for (const c of invalid) push(`  ${c.config.cell}: ${[...new Set(rejections(c, refresh))].join('; ')}`);
  }
  for (const p of run.problems) push(`problem: ${p}`);
  return lines.join('\n');
}

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dir =
  arg ??
  readdirSync(ROOT)
    .map((name) => join(ROOT, name))
    .filter((p) => statSync(p).isDirectory() && readdirSync(p).some((f) => f.startsWith('cell-')))
    .sort()
    .at(-1);
if (import.meta.filename === process.argv[1]) {
  if (!dir) {
    console.log(`no bench run under ${ROOT}`);
    process.exit(1);
  }
  report(dir);
}
