// Engine sound. The synthesis is packages/audio/engine-processor.js (peer-sim's AudioWorklet
// processor); the build copies it to /audio/engine-processor.js next to sim.wasm and this file only
// loads it, connects it to the speakers and feeds it the sim state once per frame.
//
// The context is created on the learner's first key (browsers refuse it before a gesture). `state`
// is honest: `running` only once the processor module has loaded AND the context is running,
// `failed` if either did not happen.
//
// An analyser sits between the processor and the speakers so the page can publish how loud the
// output really is (`level`): the end-to-end test measures that instead of trusting a flag.

'use client';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SimState } from './sim/session.ts';

export type AudioState = 'idle' | 'starting' | 'running' | 'failed';

export interface Engine {
  /** Read inside the frame hook; not React state, so it cannot churn the loop. */
  state(): AudioState;
  /** Call from the first key: creating a context before a gesture is refused. */
  start(): void;
  /** Send the processor what the core consumed this frame. No-op until the processor is up. */
  post(state: SimState): void;
  /** RMS of the last ~40 ms the speakers were given; 0 when silent or not running. */
  level(): number;
  dispose(): void;
}

const PROCESSOR_URL = '/audio/engine-processor.js';

export function useEngineAudio(): Engine {
  const ctx = useRef<AudioContext | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const samples = useRef<Float32Array<ArrayBuffer> | null>(null);
  const state = useRef<AudioState>('idle');

  const start = useCallback(() => {
    if (ctx.current) {
      void ctx.current.resume();
      return;
    }
    state.current = 'starting';
    const fail = () => {
      state.current = 'failed';
    };
    try {
      if (!window.AudioContext) return fail();
      const context = new window.AudioContext({ latencyHint: 'interactive' });
      ctx.current = context;
      void (async () => {
        await context.audioWorklet.addModule(PROCESSOR_URL);
        const engine = new AudioWorkletNode(context, 'engine', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        const meter = context.createAnalyser();
        meter.fftSize = 2048;
        engine.connect(meter);
        meter.connect(context.destination);
        node.current = engine;
        analyser.current = meter;
        samples.current = new Float32Array(meter.fftSize);
        await context.resume();
        state.current = context.state === 'running' ? 'running' : 'failed';
      })().catch(fail);
    } catch {
      fail();
    }
  }, []);

  // A backgrounded tab suspends the context; iOS needs an explicit resume on return.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && ctx.current?.state === 'suspended') void ctx.current.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const post = useCallback((s: SimState) => {
    node.current?.port.postMessage({
      rpm: s.rpm,
      load: s.engineLoad,
      clutch: s.clutch,
      engineOn: s.engineOn,
      cranking: s.cranking,
    });
  }, []);

  const level = useCallback(() => {
    const meter = analyser.current;
    const buffer = samples.current;
    if (!meter || !buffer) return 0;
    meter.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }, []);

  const dispose = useCallback(() => {
    void ctx.current?.close();
    ctx.current = null;
    node.current = null;
    analyser.current = null;
  }, []);

  useEffect(() => () => dispose(), [dispose]);

  return useMemo(() => ({ state: () => state.current, start, post, level, dispose }), [start, post, level, dispose]);
}
