// Print the table for one bench run directory (the raw JSON bench.mjs wrote), or the newest run.
//
//   node bench-report.mjs [run-dir]
//
// Per config: median over repeats of p50/p95/p99 frame time (rAF delta), callback CPU time, sim
// microseconds per step, long tasks, latency L and L_submit, break-even K. Frames in the first
// `warmupMs` and frames flagged by a trace reopen are excluded. A cell whose hash is not golden, or
// that saw a hidden tab, is printed and not used.
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
  return { L, Lsubmit };
}

const keyOf = (c) => `${c.config.tag}|${c.config.host}|${c.config.k}|${c.config.throttle}|${c.config.slow}|${c.config.uncapped ? 1 : 0}`;
const label = (c) =>
  `${c.config.tag} ${c.config.host} K${c.config.k} ${c.config.throttle}x` +
  (c.config.host === 'worker' ? (c.config.slow > 1 ? `, worker dilated ${c.config.slow}x` : ', worker unpadded') : '') +
  (c.config.uncapped ? ' (vsync off)' : '');

/** The valid cells of one config, or all of them when none is valid (then `valid` says NO). */
function pick(list) {
  const valid = (c) => c.header.hashOk && !c.header.hiddenSeen;
  const good = list.filter(valid);
  return { use: good.length ? good : list, ok: good.length === list.length };
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
  const groups = new Map();
  for (const c of cells) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const order = ['k1', 'decision', 'unpadded', 'sweep', 'uncapped', 'quick'];
  const rows = [...groups.values()].sort(
    (a, b) =>
      order.indexOf(a[0].config.tag) - order.indexOf(b[0].config.tag) ||
      a[0].config.k - b[0].config.k ||
      a[0].config.throttle - b[0].config.throttle ||
      a[0].config.host.localeCompare(b[0].config.host),
  );

  const header = ['config', 'n', 'p50', 'p95', 'p99', 'cpu p95', 't/fr', 'step us', 'sim/fr', 'LT', 'busy', 'L', 'L_sub', 'valid'];
  const table = [header];
  for (const list of rows) {
    const { use, ok } = pick(list);
    const fr = use.map(frames);
    const p = (q) => {
      const per = fr.filter((x) => x.delta.length).map((x) => pct(sorted(x.delta), q));
      return per.length ? median(per) : null;
    };
    const cpuP95 = (() => {
      const per = fr.filter((x) => x.cpu.length).map((x) => pct(sorted(x.cpu), 95));
      return per.length ? median(per) : null;
    })();
    const step = median(use.map((c) => c.header.simProbe?.kUsPerStep).filter((v) => typeof v === 'number'));
    const tpf = median(fr.map((x) => x.ticksPerFrame));
    const lt = median(use.map((c) => c.longtasks.filter((t) => t.start >= c.header.startTs + (c.header.warmupMs ?? WARMUP_MS)).length));
    // Frames where the Worker still had the previous request: an overloaded Worker, made visible.
    const busy = median(use.map((c) => c.header.busyFrames ?? 0));
    const lat = use.map(latencies);
    const L = lat.flatMap((x) => x.L);
    const Lsub = lat.flatMap((x) => x.Lsubmit);
    table.push([
      label(use[0]),
      String(use.length),
      f(p(50)),
      f(p(95)),
      f(p(99)),
      f(cpuP95),
      f(tpf),
      f(step, 1),
      f((step * tpf) / 1000),
      String(lt),
      String(busy),
      f(L.length ? median(L) : null),
      f(Lsub.length ? median(Lsub) : null),
      ok ? 'yes' : `NO (${list.length - use.length})`,
    ]);
  }
  const widths = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  push(`\nms unless marked; step us = one tick of all K sessions, from a tight loop (clock step ${f(cells[0]?.header?.clockStepUs, 0)} us); sim/fr = step x ticks per frame, derived\n`);
  for (const r of table) push(r.map((v, i) => v.padEnd(widths[i])).join('  '));

  // Break-even K from the sweep cells at the same throttle (main thread: it is main that has to stay
  // under the line; the Worker is reported beside it).
  for (const host of ['main', 'worker']) {
    for (const throttle of [1, 4]) {
      const points = rows
        .filter((list) => list[0].config.tag === 'sweep' && list[0].config.host === host && list[0].config.throttle === throttle)
        .map((list) => {
          const { use } = pick(list);
          const per = use.map(frames).filter((x) => x.delta.length);
          return { k: use[0].config.k, p95: per.length ? median(per.map((x) => pct(sorted(x.delta), 95))) : null };
        })
        .filter((x) => x.p95 !== null)
        .sort((a, b) => a.k - b.k);
      if (points.length < 2) continue;
      const over = points.find((x) => x.p95 > FRAME);
      push(
        `\nbreak-even ${host} ${throttle}x: ` +
          (over ? `p95 passes 16.7 ms at K=${over.k}` : `p95 stays under 16.7 ms up to the largest K measured`) +
          ` (${points.map((x) => `K${x.k} ${f(x.p95)} ms`).join(', ')})`,
      );
    }
  }

  const decisionP95 = (host) => {
    const list = rows.find((g) => g[0].config.tag === 'decision' && g[0].config.host === host && g[0].config.k === 20 && g[0].config.throttle === 4 && g[0].config.slow > 1);
    if (!list) return null;
    const { use, ok } = pick(list);
    if (!ok) return null;
    const per = use.map(frames).filter((x) => x.delta.length);
    return per.length ? median(per.map((x) => pct(sorted(x.delta), 95))) : null;
  };
  const unpadded = (() => {
    const list = rows.find((g) => g[0].config.tag === 'unpadded');
    if (!list) return null;
    const { use } = pick(list);
    const per = use.map(frames).filter((x) => x.delta.length);
    return per.length ? median(per.map((x) => pct(sorted(x.delta), 95))) : null;
  })();
  const dm = decisionP95('main');
  const dw = decisionP95('worker');
  if (dm !== null && dw !== null) {
    const win = dm > FRAME && dw <= FRAME;
    push(
      `\ndecision cell K=20 4x: main p95 ${f(dm)} ms, worker (dilated) p95 ${f(dw)} ms -> ` +
        `${win ? 'WORKER' : 'MAIN'} (rule: worker only if main > 16.7 and worker <= 16.7)` +
        (unpadded !== null ? `; worker unpadded p95 ${f(unpadded)} ms, reported not deciding` : ''),
    );
  } else {
    push(run.quick ? '\nquick run: not the decision cell, no verdict' : '\ndecision cell missing or invalid, no verdict');
  }

  if (failed.length) push(`\n${failed.length} cell(s) never started: ${failed.map((c) => c.config.cell).join(', ')}`);
  const invalid = cells.filter((c) => !(c.header.hashOk && !c.header.hiddenSeen));
  if (invalid.length) push(`\n${invalid.length} invalid cell(s): ${invalid.map((c) => c.config.cell).join(', ')}`);
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
