'use client';
// /bench: ONE cell per page load, chosen by the query string. The page steps the sim core on the
// main thread from the golden traces, renders the bench scene, records one sample per rAF, and
// publishes everything on window.__bench for tools/browser/bench.mjs to read and write to disk.
//
//   ?k=20 &duration=15 (seconds, warm-up included) &grace=8 (extra seconds to finish a trace pass)
//   &throttle=4 &tag=decision &spin1x=161 &cell=label   (labels only: the CDP throttle is Playwright's)
//   ?mode=calibrate&throttle=4     the 1x spin reference for the in-cell throttle check
//
// One rAF callback per frame does: the sim -> R3F advance(ts) -> the scene's useFrame. So the
// callback's duration is sim + scene CPU, and `en` is when the frame was handed to the GPU.

import { Canvas, type RootState } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { CATCHUP } from '../../run.ts';
import BenchScene from '../scene/BenchScene.tsx';
import { createHost, type Host } from './host.ts';
import { spin } from './spin.ts';
import type { Assets, Gate } from './types.ts';

const TRACES = ['xuat_phat_messy', 'dung_khoi_hanh_doc_messy'];
const WARMUP_MS = 1000;
const PROBE_TICKS = 600;
const VIEW = { width: 1280, height: 720, dpr: 1.5 };
// The in-cell check (A3.2a): a fixed ~1 ms of work per call, so frame-scale work is what gets timed.
// 30 000 iterations of the spin is about 1.1 ms on this Mac at 1x (measured; the loop body is a
// multiply, a modulo and an add).
const CHECK_ITERS = 30_000;
const CHECK_REPS = 200;

interface Config {
  k: number;
  durationS: number;
  /** Extra seconds a cell may run to finish one trace pass, so every measured cell has a hash check. */
  graceS: number;
  throttle: number;
  cell: string;
  /** Why the cell runs (k1 / decision / sweep / budget): carried into the raw JSON and the table. */
  tag: string;
  /** Milliseconds for CHECK_REPS calls of the fixed spin at 1x, measured once per run before the cells. */
  spin1xMs: number;
}

declare global {
  interface Window {
    __bench?: {
      status: 'loading' | 'running' | 'done' | 'failed';
      error?: string;
      result?: unknown;
      /** Where the page is in the run; only a hang diagnosis needs it. */
      stage?: string;
    };
  }
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/**
 * The smallest positive step performance.now() can take, in microseconds. Chromium coarsens the
 * clock (100 us here), and one sim batch at these K values can be shorter than that; the header
 * carries this so a reader knows why per-step cost is reported from the probe.
 */
function clockStepUs(): number {
  let last = performance.now();
  let min = Infinity;
  for (let i = 0; i < 200_000; i += 1) {
    const now = performance.now();
    if (now > last && now - last < min) min = now - last;
    last = now;
  }
  return min === Infinity ? 0 : min * 1000;
}

function parse(search: string): Config & { mode: string } {
  const q = new URLSearchParams(search);
  const num = (name: string, fallback: number) => (q.has(name) ? Number(q.get(name)) : fallback);
  return {
    mode: q.get('mode') === 'calibrate' ? 'calibrate' : 'cell',
    k: num('k', 1),
    durationS: num('duration', 15),
    graceS: num('grace', 8),
    throttle: num('throttle', 1),
    cell: q.get('cell') ?? '',
    tag: q.get('tag') ?? '',
    spin1xMs: num('spin1x', 0),
  };
}

async function loadAssets(): Promise<Assets> {
  const bytes = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
  const wasm = await bytes('/sim.wasm');
  const traces = await Promise.all(
    TRACES.map(async (name) => ({
      name,
      bytes: new Uint8Array(await bytes(`/${name}.trace`)),
      golden: new TextDecoder().decode(await bytes(`/${name}.hash`)).trim(),
    })),
  );
  return { wasm, traces };
}

/**
 * The 1x reference for the in-cell throttle check: the same fixed spin, 200 calls, no throttle.
 * One cell's `throttleSeen` is this run's in-cell time divided by this.
 */
async function calibrate(c: Config) {
  const timeCheck = () => {
    const t = performance.now();
    for (let i = 0; i < CHECK_REPS; i += 1) spin(CHECK_ITERS);
    return performance.now() - t;
  };
  await timeCheck(); // warm-up, discarded
  const out: number[] = [];
  for (let i = 0; i < 5; i += 1) out.push(timeCheck());
  return { throttle: c.throttle, checkIters: CHECK_ITERS, checkReps: CHECK_REPS, frameScaleMs: median(out) };
}

export default function BenchPage() {
  const [host, setHost] = useState<Host | null>(null);
  const [r3f] = useState(() => {
    let resolve!: (state: RootState) => void;
    const ready = new Promise<RootState>((r) => (resolve = r));
    return { ready, resolve };
  });
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    const config = parse(window.location.search);
    window.__bench = { status: 'loading' };
    let stop = () => {};

    const run = async () => {
      if (config.mode === 'calibrate') {
        setCalibrating(true);
        window.__bench!.result = await calibrate(config);
        window.__bench!.status = 'done';
        return;
      }
      const assets = await loadAssets();
      const h = createHost(assets, config.k);
      await h.ready;
      setHost(h);
      const rootState = await r3f.ready;
      // The scene mounts a commit after setHost; measure only once it has put something in the scene.
      for (let i = 0; i < 100 && rootState.scene.children.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
      if (rootState.scene.children.length === 0) throw new Error('the bench scene never mounted');

      // Everything below is the measured run.
      const S = {
        ts: [] as number[],
        st: [] as number[],
        en: [] as number[],
        ticks: [] as number[],
        simUs: [] as number[],
        reopen: [] as number[],
        seq: [] as number[],
      };
      const longtasks: { start: number; dur: number }[] = [];
      let hiddenSeen = document.visibilityState !== 'visible';
      let start = 0;
      let raf = 0;
      let stopped = false;
      let started = false;
      let finisher: Promise<void> | null = null;
      let gl0: { calls: number; triangles: number } | null = null;

      // A hidden tab stops rAF, and the cell is void (the brief's rule). End it at once, still
      // reporting what it saw, so the run continues and the cell is labelled instead of hanging.
      const onVisibility = () => {
        if (document.visibilityState === 'visible') return;
        hiddenSeen = true;
        if (started) void finishCell();
      };
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longtasks.push({ start: e.startTime, dur: e.duration });
      });
      observer.observe({ type: 'longtask', buffered: true });
      document.addEventListener('visibilitychange', onVisibility);
      stop = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVisibility);
        observer.disconnect();
        h.dispose();
      };

      const finishCell = () => {
        finisher ??= (async () => {
          window.__bench!.stage = 'probe';
          const probe = await h.probe(PROBE_TICKS);
          // The last trace pass is finished here; it never enters the samples.
          window.__bench!.stage = 'finish';
          const gates: Gate[] = await h.finish();
          // A3.2a, last thing in the cell so nothing runs after it: is the throttle still on, at
          // frame scale? ~1 ms of work x 200 calls, divided by the same figure at 1x.
          window.__bench!.stage = 'throttle';
          const check = () => {
            const t = performance.now();
            for (let i = 0; i < CHECK_REPS; i += 1) spin(CHECK_ITERS);
            return performance.now() - t;
          };
          check();
          const spikes = Array.from({ length: 5 }, check).sort((a, b) => a - b);
          const throttleSeenMs = spikes[2];
          const throttleSeen = config.spin1xMs > 0 ? throttleSeenMs / config.spin1xMs : null;
          window.__bench!.stage = 'clock';
          const clockStep = clockStepUs();
          const warmCut = start + WARMUP_MS;
          const keptDeltas = [];
          for (let i = 1; i < S.ts.length; i += 1) {
            if (S.ts[i] < warmCut || S.reopen[i] || S.reopen[i - 1]) continue;
            keptDeltas.push(S.ts[i] - S.ts[i - 1]);
          }
          const periodMs = median(keptDeltas);
          const info = rootState.gl.info.render;
          stop();
          window.__bench!.result = {
            config,
            header: {
              userAgent: navigator.userAgent,
              viewport: { width: window.innerWidth, height: window.innerHeight },
              canvasPx: { width: rootState.gl.domElement.width, height: rootState.gl.domElement.height },
              windowDpr: window.devicePixelRatio,
              canvasDpr: VIEW.dpr,
              warmupMs: WARMUP_MS,
              startTs: start,
              durationMs: S.ts.at(-1)! - start,
              refreshHz: 1000 / periodMs,
              vsyncMs: periodMs,
              maxDeltaMs: keptDeltas.length ? Math.max(...keptDeltas) : null,
              deltasOver50Ms: keptDeltas.filter((d) => d > 50).length,
              // Late frames: deltas well past this cell's own vsync period (A3.3's reported column).
              lateFrames: keptDeltas.filter((d) => d > 1.5 * periodMs).length,
              hiddenSeen,
              crossOriginIsolated,
              gl: { first: gl0, last: { calls: info.calls, triangles: info.triangles } },
              catchup: CATCHUP,
              clockStepUs: clockStep,
              simProbe: probe,
              throttleSeen,
              throttleSeenMs,
              spin1xMs: config.spin1xMs > 0 ? config.spin1xMs : null,
              clips: h.clips,
              // Live wasm instances holding the K sessions: 1 (sim.ts), not K; see its header.
              wasmInstances: h.instances,
              gates,
              hashOk: gates.length > 0 && gates.every((g) => g.ok),
            },
            samples: S,
            longtasks,
          };
          window.__bench!.status = 'done';
        })();
        return finisher;
      };

      const loop = (ts: number) => {
        if (stopped) return;
        const st = performance.now();
        if (document.visibilityState !== 'visible') hiddenSeen = true;
        if (start === 0) start = ts;
        const info = h.frame(ts);
        rootState.advance(ts);
        const en = performance.now();
        S.ts.push(ts);
        S.st.push(st);
        S.en.push(en);
        S.ticks.push(info.ticks);
        S.simUs.push(info.simUs);
        S.reopen.push(info.reopened ? 1 : 0);
        S.seq.push(h.run.tick);
        if (S.ts.length === 30) gl0 = { calls: rootState.gl.info.render.calls, triangles: rootState.gl.info.render.triangles };
        // Stop at/after the cell length, but only once one full trace pass has completed inside the
        // run: that pass is the cell's hash check. The grace bounds the wait.
        const elapsed = ts - start;
        const enough = elapsed >= config.durationS * 1000 && (h.passes > 0 || elapsed >= (config.durationS + config.graceS) * 1000);
        if (enough) {
          void finishCell();
          return;
        }
        raf = requestAnimationFrame(loop);
      };
      // Do not start while hidden: rAF would never tick and every frame would be missing.
      for (let i = 0; i < 100 && document.visibilityState !== 'visible'; i += 1) await new Promise((r) => setTimeout(r, 100));
      window.__bench!.status = 'running';
      started = true;
      raf = requestAnimationFrame(loop);
    };

    run().catch((e: unknown) => {
      window.__bench = { status: 'failed', error: String((e as Error)?.stack ?? e) };
    });
    return () => stop();
  }, [r3f]);

  if (calibrating) return <p>calibrating</p>;
  return (
    <div style={{ width: VIEW.width, height: VIEW.height, overflow: 'hidden' }}>
      <Canvas
        frameloop="never"
        camera={{ position: [-14, 5, 0], fov: 55, near: 0.1, far: 200 }}
        dpr={VIEW.dpr}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={(state) => r3f.resolve(state)}
      >
        {host ? <BenchScene run={host.run} /> : null}
      </Canvas>
    </div>
  );
}
