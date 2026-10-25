// Print the table for one bench run directory (the raw JSON bench.mjs wrote), or the newest run.
//
//   node bench-report.mjs [run-dir]
//
// Per config: median over repeats of p50/p95/p99 frame time (rAF delta) and callback CPU (en - st),
// sim microseconds per tick, late-frame share, long tasks, latency L and L_submit (median, IQR, p95),
// and the break-even point in milliseconds of sim per tick at 60 Hz and 120 Hz. Frames in the first
// `warmupMs` and frames flagged by a trace reopen are excluded.
//
// A cell is valid only if (A3.2): its hash is golden (and all K sessions hash alike), the tab was
// never hidden, the throttle is seen inside the cell at frame scale, it ran >= 0.99 x 60 ticks/s with
// no CATCHUP clip, and its refresh rate is within 2% of the run's median. An invalid cell is printed
// and not used to decide.
//
// The Worker's CPU slow-down is modelled by dilating its sim batch (see host/worker.ts), so every
// Worker number at a throttle above 1x is labelled with that model.
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

/** Key latency L (the frame after the one that drew the consuming tick) and L_submit. */
function latencies(cell) {
  const { samples: s, markers, header: h } = cell;
  const warm = h.startTs + (h.warmupMs ?? WARMUP_MS);
  // The first frame whose seq reached the tick that consumed the marker; seq only rises, so search.
  const firstAtOrAfter = (tick) => {
    let lo = 0;
    let hi = s.seq.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s.seq[mid] < tick) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const L = [];
  const Lsubmit = [];
  for (const m of markers) {
    const i = firstAtOrAfter(m.tick);
    if (i >= s.ts.length || s.ts[i] < warm || s.reopen[i] || (i > 0 && s.reopen[i - 1])) continue;
    if (i + 1 < s.ts.length && s.ts[i + 1] >= warm) L.push(s.ts[i + 1] - m.keyT);
    Lsubmit.push(s.en[i] - m.keyT);
  }
  const dispatch = markers.map((m) => m.handlerNow - m.keyT).filter((x) => Number.isFinite(x));
  return { L, Lsubmit, dispatch };
}

/** Share of kept samples that are true (1/0 flags in the samples). */
function share(flags) {
  const kept = flags.length ? flags : [];
  return kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0;
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

const keyOf = (c) => `${c.config.tag}|${c.config.host}|${c.config.k}|${c.config.throttle}|${c.config.slow}`;
const label = (c) =>
  `${c.config.tag} ${c.config.host} K${c.config.k} ${c.config.throttle}x` +
  (c.config.host === 'worker' ? (c.config.slow > 1 ? `, worker dilated ${c.config.slow}x` : ', worker unpadded') : '') +
  '';

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

  push('calibration (one spin loop, 5 reps, median; 4x/1x ratio is what matters):');
  for (const c of run.calibration) {
    const base = run.calibration[0];
    push(
      `  ${c.throttle}x: main ${f(c.mainMs, 0)} ms x${f(c.mainMs / base.mainMs)}, ` +
        `worker raw ${f(c.workerRawMs, 0)} ms x${f(c.workerRawMs / base.workerRawMs)}, ` +
        `worker dilated ${f(c.workerPaddedMs, 0)} ms x${f(c.workerPaddedMs / base.workerPaddedMs)}`,
    );
  }

  if (run.workerCdp) {
    const w = run.workerCdp;
    push(
      `worker target direct throttle: ${w.attach}; command -> ${w.throttleReply}; ` +
        `spin ${f(w.spinMsBefore, 0)} -> ${f(w.spinMsAfter, 0)} ms (x${f(w.ratioAfterAttach)})`,
    );
  }
  const refresh = runRefresh(cells);
  push(`per-cell refresh rate must sit within 2% of the run's median (${f(refresh, 1)} Hz) to count (A3.2d).`);
  const groups = new Map();
  for (const c of cells) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const order = ['k1', 'decision', 'unpadded', 'sweep', 'quick'];
  const rows = [...groups.values()].sort(
    (a, b) =>
      order.indexOf(a[0].config.tag) - order.indexOf(b[0].config.tag) ||
      a[0].config.k - b[0].config.k ||
      a[0].config.throttle - b[0].config.throttle ||
      a[0].config.host.localeCompare(b[0].config.host),
  );

  const header = [
    'config', 'n', 'p50', 'p95', 'p99', 'late%', 'max d',
    'cpu p50', 'cpu p95', 'cpu p99',
    't/fr', 'step us', 'sim/fr', 'LT', 'busy%', 'L', 'L_sub', 'valid',
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
    // Frames where the Worker still had the previous request, as a share of the kept frames (A3.5).
    // Read from the raw samples; the summary's `busyFrames` counts the whole run, warm-up included.
    const busy = median(
      use.map((c) => {
        if (c.config.host !== 'worker') return 0;
        const warm = c.header.startTs + (c.header.warmupMs ?? WARMUP_MS);
        const flags = [];
        for (let i = 0; i < c.samples.ts.length; i += 1) {
          if (c.samples.ts[i] < warm || c.samples.reopen[i] || (i > 0 && c.samples.reopen[i - 1])) continue;
          flags.push(c.samples.busy[i]);
        }
        return share(flags) * 100;
      }),
    );
    const lat = use.map(latencies);
    const L = lat.flatMap((x) => x.L);
    const Lsub = lat.flatMap((x) => x.Lsubmit);
    table.push([
      label(use[0]),
      String(use.length),
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
      f(busy, 1),
      f(L.length ? median(L) : null),
      f(Lsub.length ? median(Lsub) : null),
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
      host: c0.config.host,
      throttle: c0.config.throttle,
      slow: c0.config.slow,
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
  const frameSlope = (host, throttle) => {
    const points = perConfig
      .filter((x) => x.host === host && x.throttle === throttle && x.cpuP95 !== null && x.ticksPerFrame > 0)
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
  for (const host of ['main', 'worker']) {
    for (const throttle of [1, 4, 6]) {
      const rows2 = perConfig.filter((x) => x.host === host && x.throttle === throttle);
      if (!rows2.length) continue;
      const slope = frameSlope(host, throttle);
      const top = rows2.reduce((a, b) => (b.k > a.k ? b : a));
      const cFrame = slope?.slopeUs ?? null;
      const cProbe = top.probeUsPerTick;
      const cProbeDilated = top.probeDilatedUsPerTick;
      const fmt = (c, hz) => {
        const k = kBreak(c, hz);
        if (k === null) return '—';
        const extrapolated = top.k < k;
        return `K=${Math.round(k).toLocaleString('en-US')}${extrapolated ? '*' : ''}`;
      };
      const padded = host === 'worker' && throttle > 1;
      const probeOk = top.k >= 100; // a probe at K=1 is one session for 600 ticks: sub-millisecond noise
      if (rows2.length === 1) {
        push(`  ${host} ${throttle}x${padded ? ' (padded)' : ''}: only K=${top.k} measured at this throttle, no sweep, so no break-even`);
        continue;
      }
      const frameSay =
        cFrame === null
          ? 'no K=1 baseline'
          : cFrame <= 0
            ? 'callback CPU does not grow with K (the sim is off the main thread), so no break-even'
            : `frame c=${f(cFrame, 2)} us/tick -> 60 Hz ${fmt(cFrame, 60)}, 120 Hz ${fmt(cFrame, 120)}`;
      push(
        `  ${host} ${throttle}x${padded ? ' (padded)' : ''}: ${frameSay}` +
          (probeOk
            ? `; probe c=${f(cProbe, 3)} us/tick -> 60 Hz ${fmt(cProbe, 60)}` +
              (padded ? `; probe dilated c=${f(cProbeDilated, 3)} -> 60 Hz ${fmt(cProbeDilated, 60)}` : '')
            : '; probe at K=1 only (too short to time, see clockStepUs)'),
      );
      push(
        `    K measured: ${rows2
          .sort((a, b) => a.k - b.k)
          .map((x) => `K${x.k} cpu p95 ${f(x.cpuP95)} ms, ${f(x.ticksPerFrame)} ticks/frame`)
          .join(' | ')}`,
      );
      if (slope) push(`    frame slope from K=${slope.from} to K=${slope.to} at ${f(slope.tpf)} ticks/frame.`);
    }
  }
  push('  * the crossing lies beyond the largest K measured, so it is extrapolated, not measured.');

  // ---- Latency per config: median, IQR and p95 (A3.3), and the key dispatch lag (A3.6).
  push('\nlatency (L = rAF of the frame after the one that drew the consuming tick; L_submit = end of that callback):');
  push(`  ${'config'.padEnd(34)}  ${'L med'.padStart(7)} ${'L iqr'.padStart(7)} ${'L p95'.padStart(7)}  ${'Ls med'.padStart(7)} ${'Ls p95'.padStart(7)}  ${'lag med'.padStart(8)}  n`);
  for (const list of rows) {
    const { use } = pick(list, refresh);
    const lat = use.map(latencies);
    const L = spread(lat.flatMap((x) => x.L));
    const Ls = spread(lat.flatMap((x) => x.Lsubmit));
    const lag = spread(lat.flatMap((x) => x.dispatch));
    push(
      `  ${label(use[0]).slice(0, 34).padEnd(34)}  ${f(L.median).padStart(7)} ${f(L.iqr).padStart(7)} ${f(L.p95).padStart(7)}  ` +
        `${f(Ls.median).padStart(7)} ${f(Ls.p95).padStart(7)}  ${f(lag.median, 3).padStart(8)}  ${L.n}`,
    );
  }
  push('  lag = performance.now() in the keydown handler minus e.timeStamp: near zero means the pressed key\'s timestamp is on the page clock.');

  // ---- The decision (prereg 75433f9 + A3.1): a host misses if frame-time p95 > 16.7 ms OR
  // callback-CPU p95 > 16.7 ms at K=20, 4x; the Worker wins only if main misses and the Worker passes.
  const decisionRow = (host, tag) =>
    perConfig.find((x) => x.tag === tag && x.host === host && x.k === 20 && x.throttle === 4 && (host === 'main' || tag === 'unpadded' || x.slow > 1));
  const miss = (row) => (row ? row.frameP95 > FRAME || row.cpuP95 > FRAME : null);
  const describe = (row) =>
    row
      ? `frame p95 ${f(row.frameP95)} ms, cpu p95 ${f(row.cpuP95)} ms -> ${miss(row) ? 'MISS' : 'pass'}`
      : 'missing';
  const main = decisionRow('main', 'decision');
  const worker = decisionRow('worker', 'decision');
  const unpadded = decisionRow('worker', 'unpadded');
  if (main && worker) {
    const mainValid = rejections(main.cell, refresh);
    const workerValid = rejections(worker.cell, refresh);
    const win = mainValid.length === 0 && workerValid.length === 0 && miss(main) && !miss(worker);
    push('\ndecision cell K=20 4x (A3.1: miss = frame-time p95 > 16.7 ms OR callback-CPU p95 > 16.7 ms):');
    push(`  main: ${describe(main)}${mainValid.length ? ` [not valid: ${[...new Set(mainValid)].join('; ')}]` : ''}`);
    push(`  worker (padded ${worker.slow}x): ${describe(worker)}${workerValid.length ? ` [not valid: ${[...new Set(workerValid)].join('; ')}]` : ''}`);
    if (unpadded) push(`  worker unpadded, reported not deciding: ${describe(unpadded)}`);
    push(
      `  -> ${win ? 'WORKER' : 'MAIN'}` +
        (mainValid.length || workerValid.length ? ' (a decision cell is not valid, so the rule keeps main)' : '') +
        `  (rule: worker only if main misses and the worker passes; a tie or a miss in either direction stays main)`,
    );
  } else {
    const have = [main, worker].filter(Boolean).length;
    push(run.quick ? '\nquick run: not the decision cell, no verdict' : `\ndecision cell: ${have}/2 hosts present, no verdict`);
  }

  if (failed.length) push(`\n${failed.length} cell(s) never started: ${failed.map((c) => c.config.cell).join(', ')}`);
  const invalid = cells.filter((c) => rejections(c, refresh).length > 0);
  if (invalid.length) {
    push(`\n${invalid.length} cell(s) reported but not used to decide:`);
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
