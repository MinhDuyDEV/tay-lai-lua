'use client';
// The page body: the run, the scene, the HUD, and the one element the end-to-end test reads.
//
// The HUD, the key handling and the sim loop live here, outside the canvas, so a WebGL failure
// cannot take them with it. `data-gl-ok` says which of the two worlds the learner got.

import { Canvas } from '@react-three/fiber';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HANDLED_CODES, KEY_LEGEND } from '../input/driver.ts';
import { useEngineAudio, type AudioState } from './audio.ts';
import Hud from './Hud.tsx';
import type { Penalty, Ruleset } from './ruleset.ts';
import { createRun, type Run } from './run.ts';
import { openSession, type Session } from './sim/session.ts';
import { STEPS, stepDone } from './steps.ts';

// three and R3F are the heavy part of the route; keep them out of the first chunk.
const Scene = dynamic(() => import('./scene/Scene.tsx'), { ssr: false, loading: () => null });

export interface StageProps {
  ruleset: Ruleset;
  wasmUrl: string;
}

/** The window surface the end-to-end test uses to read the recorded run. */
declare global {
  interface Window {
    __thi?: {
      trace(): string;
      hash(): string | null;
      restart(): void;
    };
  }
}

const NO_PENALTIES: readonly Penalty[] = [];

export default function Stage({ ruleset, wasmUrl }: StageProps) {
  const root = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [penalties, setPenalties] = useState<readonly Penalty[]>(NO_PENALTIES);
  const [glOk, setGlOk] = useState(true);
  const [entered, setEntered] = useState(false);
  const [bootProblem, setBootProblem] = useState<string | null>(null);
  const audio = useEngineAudio();

  // The ruleset's own numbers, so the HUD's red line is the scorer's red line.
  const rpmLine = ruleset.rules.find((r) => r.id === 'SH.X.RPM')?.params?.rpm ?? 4000;

  useEffect(() => {
    let cancelled = false;
    let created: Run | null = null;

    const boot = async () => {
      let open: () => Session;
      try {
        open = await loadCore(wasmUrl);
      } catch (error) {
        if (!cancelled) setBootProblem((error as Error).message);
        return;
      }
      if (cancelled) return;
      created = createRun({
        ruleset,
        openSession: open,
        target: window,
        handledCodes: HANDLED_CODES,
        onPenalty: (penalty) => setPenalties((prev) => [...prev, penalty]),
        onRestart: () => setPenalties(NO_PENALTIES),
      });
      runRef.current = created;
      setRun(created);
    };
    void boot();

    return () => {
      cancelled = true;
      created?.dispose();
      runRef.current = null;
    };
  }, [ruleset, wasmUrl]);

  // Publish the numbers the test polls, every frame, on the one root element.
  useEffect(() => {
    if (!run) return;
    const write = () => {
      audio.post(run.state);
      if (root.current) paint(root.current, run, glOk, audio.state(), audio.level(), entered);
    };
    write();
    return run.onFrame(write);
  }, [run, glOk, audio, entered]);

  useEffect(() => {
    if (!run) return;
    window.__thi = {
      trace: () => run.traceBase64(),
      hash: () => run.hash(),
      restart: () => run.restart(),
    };
    return () => {
      delete window.__thi;
    };
  }, [run]);

  const enter = useCallback(() => {
    audio.start();
    setEntered(true);

  }, [audio]);

  // The run owns restart (Esc/Backspace and this button alike); `onRestart` clears the feed.
  const restart = useCallback(() => runRef.current?.restart(), []);

  // The first key only enters the car. It is taken in the capture phase and stopped there, so the
  // keyboard module never sees it and it cannot count as an order or a toggle.
  useEffect(() => {
    if (entered) return;
    const onFirstKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      enter();
    };
    window.addEventListener('keydown', onFirstKey, { capture: true });
    return () => window.removeEventListener('keydown', onFirstKey, { capture: true });
  }, [entered, enter]);

  const done = run ? run.state.phase === 'done' || run.state.disqualified : false;

  return (
    <div
      id="stage"
      ref={root}
      data-phase="waiting"
      data-ordered="no"
      data-engine-on="yes"
      data-belt="no"
      data-signal="off"
      data-gear="0"
      data-clutch="0.00"
      data-handbrake="yes"
      data-speed="0"
      data-bumper="-1.000"
      data-rpm="850"
      data-score={ruleset.scoring.base}
      data-disqualified="no"
      data-penalties=""
      data-gl-ok="yes"
      data-audio="idle"
      data-audio-level="0.0000"
      data-hash=""
      data-entered="no"
    >
      <div className="viewport">
        <Canvas
          camera={{ position: [-14, 5, 0], fov: 55, near: 0.1, far: 200 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            // A context that exists is the only honest signal that WebGL worked.
            gl.domElement.dataset.webgl = 'yes';
            setGlOk(Boolean(gl.getContext()));
          }}
          fallback={<p className="gl-warning">WebGL không khả dụng: HUD và bài thi vẫn chạy.</p>}
        >
          {run ? <Scene run={run} ruleset={ruleset} /> : null}
        </Canvas>
      </div>

      {run ? (
        <Hud
          run={run}
          ruleset={ruleset}
          penalties={penalties}
          rpmLimit={rpmLine}
          audio={audio.state()}
          glOk={glOk}
        />
      ) : null}

      {!entered ? (
        <div className="overlay" role="dialog" aria-label="Vào xe">
          <h1>Bài 1 — Xuất phát</h1>
          <p>Bấm phím bất kỳ để vào xe. Bàn phím là đủ.</p>
          <ul>
            {KEY_LEGEND.slice(0, 5).map((entry) => (
              <li key={entry.keys}>
                <span className="key">{entry.keys}</span>
                {entry.does}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {done && entered ? (
        <div className="overlay result" role="dialog" aria-label="Kết quả">
          <h1>{run?.state.disqualified ? 'Đình chỉ' : `Kết quả: ${run?.state.score} điểm`}</h1>
          <p>{penalties.length === 0 ? 'Không có lỗi.' : `${penalties.length} lỗi.`}</p>
          <p>
            Bấm <span className="key">Esc</span> hoặc nút bên dưới để làm lại.
          </p>
          <button type="button" onClick={restart}>
            Làm lại
          </button>
        </div>
      ) : null}

      {bootProblem ? <p className="notice boot">{bootProblem}</p> : null}
      
    </div>
  );
}

/** Everything the test polls, written on the root element each frame. */
function paint(el: HTMLElement, run: Run, glOk: boolean, audio: AudioState, level: number, entered: boolean) {
  const s = run.state;
  const d = el.dataset;
  d.phase = s.phase;
  d.ordered = run.ordered ? 'yes' : 'no';
  d.engineOn = s.engineOn ? 'yes' : 'no';
  d.belt = s.belt ? 'yes' : 'no';
  d.signal = s.signal;
  d.gear = String(s.gear);
  d.clutch = s.clutch.toFixed(2);
  d.handbrake = s.handbrake ? 'yes' : 'no';
  d.speed = s.speedMps.toFixed(3);
  d.bumper = s.frontBumperM.toFixed(3);
  d.rpm = Math.round(s.rpm).toString();
  d.score = String(s.score);
  d.disqualified = s.disqualified ? 'yes' : 'no';
  d.penalties = run.penalties.map((p) => p.id).join(' ');
  d.glOk = glOk ? 'yes' : 'no';
  d.audio = audio;
  d.audioLevel = level.toFixed(4);
  d.hash = run.hash() ?? '';
  d.entered = entered ? 'yes' : 'no';
  for (const step of STEPS) d[`step_${step.id}`] = stepDone(step.id, s, run.ordered) ? 'yes' : 'no';
}

/** Fetch sim.wasm once. A module that will not instantiate fails here, not on the first key. */
async function loadCore(wasmUrl: string): Promise<() => Session> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Không nạp được ${wasmUrl}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  openSession(bytes).dispose();
  return () => openSession(bytes);
}
