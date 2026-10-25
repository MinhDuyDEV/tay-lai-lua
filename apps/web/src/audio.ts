// The audio seam. Peer-sim delivers an engine AudioWorklet processor later; this opens the
// AudioContext on the learner's first key (the gesture browsers require) and otherwise does
// nothing audible.
//
// TEMPORARY: the silent gain node is replaced by the engine worklet when peer-sim lands the
// processor. What exists now is the part that is not theirs: the gesture, the resume, the state.

'use client';
import { useCallback, useEffect, useMemo, useRef } from 'react';

export type AudioState = 'idle' | 'starting' | 'running' | 'failed';

export interface Engine {
  /** Read inside the frame hook and the HUD; not React state, so it cannot churn the loop. */
  state(): AudioState;
  /** Call from the first key: creating a context before a gesture is refused. */
  start(): void;
  dispose(): void;
}

export function useEngineAudio(): Engine {
  const ctx = useRef<AudioContext | null>(null);
  const state = useRef<AudioState>('idle');

  const start = useCallback(() => {
    if (ctx.current) {
      state.current = 'running';
      void ctx.current.resume();
      return;
    }
    state.current = 'starting';
    try {
      const AudioCtor = window.AudioContext;
      if (!AudioCtor) {
        state.current = 'failed';
        return;
      }
      const context = new AudioCtor({ latencyHint: 'interactive' });
      // Silent for now: the seam is here, the sound is peer-sim's worklet.
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      ctx.current = context;
      void context.resume().then(
        () => {
          state.current = 'running';
        },
        () => {
          state.current = 'failed';
        },
      );
    } catch {
      state.current = 'failed';
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

  const dispose = useCallback(() => {
    void ctx.current?.close();
    ctx.current = null;
  }, []);

  useEffect(() => () => dispose(), [dispose]);

  return useMemo(() => ({ state: () => state.current, start, dispose }), [start, dispose]);
}
