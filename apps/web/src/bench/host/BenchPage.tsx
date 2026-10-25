'use client';
// /bench: ONE cell per page load, chosen by the query string. The page steps the sim core (main
// thread or Worker) from the golden traces, renders the bench scene, records one sample per rAF,
// and publishes everything on window.__bench for tools/browser/bench.mjs to read and write to disk.
//
//   ?host=main|worker  &k=20  &duration=15 (seconds, warm-up included)  &slow=4 (Worker only, see worker.ts)
//   &throttle=4 &uncapped=1 &cell=label   (labels only: the page cannot set them, Playwright does)
//   ?mode=calibrate&throttle=4&slow=4      the spin-loop calibration instead of a cell
//
// One rAF callback per frame does: the sim (main) or the reply hand-over (Worker) -> R3F advance(ts)
// -> the scene's useFrame. So the callback's duration is sim + scene CPU, and `en` is when the frame
// was handed to the GPU. A key is only a counter marker: the sim never sees it.

import { Canvas, type RootState } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import BenchScene from '../scene/BenchScene.tsx';
import { CATCHUP } from '../../run.ts';
import { createMainHost, createWorkerHost, type Host } from './host.ts';
import { spin } from './spin.ts';
import type { Assets, Gate, ToWorker } from './types.ts';

const TRACES = ['xuat_phat_messy', 'dung_khoi_hanh_doc_messy'];
const WARMUP_MS = 1000;
const PROBE_TICKS = 600;
const VIEW = { width: 1280, height: 720, dpr: 1.5 };
// The calibration's load per call: big enough that the Chromium clock's 100 us clamp cannot hide it.
const SPIN_ITERS = 8_000_000;

interface Config {
  host: 'main' | 'worker';
  k: number;
  durationS: number;
  /** Extra seconds a cell may run to finish one trace pass, so every measured cell has a hash check. */
  graceS: number;
  slow: number;
  throttle: number;
  uncapped: boolean;
  cell: string;
  /** Why the cell runs (k1 / decision / sweep / ...): carried through to the raw JSON and the table. */
  tag: string;
}

declare global {
  interface Window {
    __bench?: {
      status: 'loading' | 'running' | 'done' | 'failed';
      error?: string;
      /** Resolves `phase` (0..1) of a frame period after the next rAF; Playwright presses the key right after. */
      armKey(phase: number): Promise<void>;
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
 * carries this so a reader knows why per-step cost is reported from cell totals.
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
    host: q.get('host') === 'worker' ? 'worker' : 'main',
    k: num('k', 1),
    durationS: num('duration', 15),
    graceS: num('grace', 8),
    slow: num('slow', 1),
    throttle: num('throttle', 1),
    uncapped: q.get('uncapped') === '1',
    cell: q.get('cell') ?? '',
    tag: q.get('tag') ?? '',
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

/** The same spin loop timed on the main thread, in the Worker, and in the Worker with the sim-dilation padding. */
async function calibrate(c: Config) {
  const timeMain = () => {
    const t = performance.now();
    spin(SPIN_ITERS);
    return performance.now() - t;
  };
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const timeWorker = (pad: boolean) =>
    new Promise<number>((resolve) => {
      const t = performance.now();
      worker.onmessage = () => resolve(performance.now() - t);
      const message: ToWorker = { type: 'spin', iters: SPIN_ITERS, pad, slow: c.slow };
      worker.postMessage(message);
    });
  const reps = async (f: () => number | Promise<number>) => {
    await f(); // warm-up, discarded
    const out: number[] = [];
    for (let i = 0; i < 5; i += 1) out.push(await f());
    return median(out);
  };
  const result = {
    throttle: c.throttle,
    slow: c.slow,
    iters: SPIN_ITERS,
    mainMs: await reps(timeMain),
    workerRawMs: await reps(() => timeWorker(false)),
    workerPaddedMs: await reps(() => timeWorker(true)),
  };
  worker.terminate();
  return result;
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
    window.__bench = { status: 'loading', armKey: async () => {} };
    let stop = () => {};

    const run = async () => {
      if (config.mode === 'calibrate') {
        setCalibrating(true);
        window.__bench!.result = await calibrate(config);
        window.__bench!.status = 'done';
        return;
      }
      const assets = await loadAssets();
      const h = config.host === 'worker' ? createWorkerHost(assets, config.k, config.slow) : createMainHost(assets, config.k);
      await h.ready;
      setHost(h);
      const rootState = await r3f.ready;
      // The scene mounts a commit after setHost; measure only once it has put something in the scene.
      for (let i = 0; i < 100 && rootState.scene.children.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
      if (rootState.scene.children.length === 0) throw new Error('the bench scene never mounted');

      // Everything below is the measured run.
      const S = { ts: [] as number[], st: [] as number[], en: [] as number[], ticks: [] as number[], simUs: [] as number[], reopen: [] as number[], seq: [] as number[], busy: [] as number[] };
      const markers: { id: number; keyT: number; tick: number | null }[] = [];
      const longtasks: { start: number; dur: number }[] = [];
      let hiddenSeen = document.visibilityState !== 'visible';
      let start = 0;
      let raf = 0;
      let stopped = false;
      let started = false;
      let finisher: Promise<void> | null = null;
      let gl0: { calls: number; triangles: number } | null = null;

      // A key is only a marker: it gets an id from the page's own clock, the sim never sees it. The
      // host turns that id into "consumed by tick n"; the report pairs it with the first frame showing
      // tick >= n. Filled in below, once the host and the sample arrays exist.
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== 'KeyM' || e.repeat) return;
        const id = markers.length;
        markers.push({ id, keyT: e.timeStamp, tick: null });
        h.mark(id);
      };
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
      window.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
      stop = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibility);
        observer.disconnect();
        h.dispose();
      };

      const period = () => {
        const d = S.ts.slice(-30).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1);
        return d.length ? median(d) : 16.7;
      };
      window.__bench!.armKey = (phase) =>
        new Promise((resolve) =>
          requestAnimationFrame((ts) => setTimeout(resolve, Math.max(0, phase * period() - (performance.now() - ts)))),
        );

      const finishCell = () => {
        finisher ??= (async () => {
        window.__bench!.stage = 'probe';
        // Probe first: the dilating Worker is idle then, so the raw cost is not stretched by it.
        const probe = await h.probe(PROBE_TICKS);
        // The last trace pass is finished here; it never enters the samples.
        window.__bench!.stage = 'finish';
        const gates: Gate[] = await h.finish();
        window.__bench!.stage = 'clock';
        const clockStep = clockStepUs();
        const deltas = S.ts.map((t, i) => (i ? t - S.ts[i - 1] : 0)).slice(1);
        const info = rootState.gl.info.render;
        const kept = markers.filter((m) => m.tick !== null);
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
            refreshHz: 1000 / median(deltas),
            busyFrames: S.busy.reduce((a, b) => a + b, 0),
            hiddenSeen,
            crossOriginIsolated,
            gl: { first: gl0, last: { calls: info.calls, triangles: info.triangles } },
            workerSlow: config.host === 'worker' ? config.slow : null,
            catchup: CATCHUP,
            clockStepUs: clockStep,
            simProbe: probe,
            gates,
            hashOk: gates.length > 0 && gates.every((g) => g.ok),
          },
          samples: S,
          markers: kept,
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
        for (const c of info.consumed) markers[c.id].tick = c.tick;
        rootState.advance(ts);
        const en = performance.now();
        S.ts.push(ts);
        S.st.push(st);
        S.en.push(en);
        S.ticks.push(info.ticks);
        S.simUs.push(info.simUs);
        S.reopen.push(info.reopened ? 1 : 0);
        // run.tick and a marker's `tick` are both the stepper's first-session tick count, so a marker
        // is matched to the first sample whose seq reached it.
        S.seq.push(h.run.tick);
        S.busy.push(info.busy ? 1 : 0);
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
      window.__bench = { status: 'failed', error: String((e as Error)?.stack ?? e), armKey: async () => {} };
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
