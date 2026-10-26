'use client';
// The page body: the run, the scene, the HUD, and the one element the end-to-end test reads.
//
// The HUD, the key handling and the sim loop live here, outside the canvas, so a WebGL failure
// cannot take them with it. `data-gl-ok` says which of the two worlds the learner got.

import { Canvas } from '@react-three/fiber';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HANDLED_CODES, legendFor } from '../input/driver.ts';
import { useEngineAudio, type AudioState } from './audio.ts';
import { exerciseFor, type Exercise, type Lesson } from './exercise.ts';
import Hud from './Hud.tsx';
import type { Penalty, Ruleset } from './ruleset.ts';
import { createRun, type Run } from './run.ts';
import { openSession, zoneName, type Session, type SimState } from './sim/session.ts';

// three and R3F are the heavy part of the route; keep them out of the first chunk.
const Scene = dynamic(() => import('./scene/Scene.tsx'), { ssr: false, loading: () => null });

export interface StageProps {
  /** Which exercise this page runs; a number because it crosses from a server component. */
  lesson: Lesson;
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

export default function Stage({ lesson, ruleset, wasmUrl }: StageProps) {
  const exercise = exerciseFor(lesson);
  const root = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [penalties, setPenalties] = useState<readonly Penalty[]>(NO_PENALTIES);
  const [glOk, setGlOk] = useState(true);
  const [entered, setEntered] = useState(false);
  const [done, setDone] = useState(false);
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
        open = await loadCore(wasmUrl, exercise.seed);
      } catch (error) {
        if (!cancelled) setBootProblem((error as Error).message);
        return;
      }
      if (cancelled) return;
      created = createRun({
        exercise,
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
  }, [exercise, ruleset, wasmUrl]);

  // Publish the numbers the test polls, every frame, on the one root element.
  useEffect(() => {
    if (!run) return;
    const write = () => {
      audio.post(run.state);
      // The run changes without a React render; the result card needs one when it ends (or restarts).
      setDone(run.state.phase === 'done' || run.state.disqualified);
      if (root.current) paint(root.current, run, exercise, ruleset, glOk, audio.state(), audio.level(), entered);
    };
    write();
    return run.onFrame(write);
  }, [run, exercise, ruleset, glOk, audio, entered]);

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

  return (
    <div
      id="stage"
      ref={root}
      data-exercise={lesson}
      data-tick="0"
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
      data-line-gap="0.000"
      data-stop-a="0.000"
      data-rollback="0.000"
      data-aid-key=""
      data-aid-eta-ms=""
      data-aid-gap-mm=""
      data-aid-mark-mm=""
      data-zone=""
      data-zone-label=""
      data-last-penalty=""
      data-last-penalty-points=""
      data-last-penalty-quote=""
      data-since-stop="-1"
      data-elevation="0.000"
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
          {run ? <Scene run={run} ruleset={ruleset} exercise={exercise} /> : null}
        </Canvas>
      </div>

      {run ? (
        <Hud
          run={run}
          exercise={exercise}
          ruleset={ruleset}
          penalties={penalties}
          rpmLimit={rpmLine}
          audio={audio.state}
          glOk={glOk}
        />
      ) : null}

      {!entered ? (
        <div className="overlay" role="dialog" aria-label="Vào xe">
          <h1>{exercise.title}</h1>
          <p>Bấm phím bất kỳ để vào xe. Bàn phím là đủ.</p>
          <ul>
            {legendFor(lesson).slice(0, exercise.introKeys).map((entry) => (
              <li key={entry.keys}>
                <span className="key">{entry.keys}</span>
                {entry.does}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {done && entered ? (
        <div className="overlay result" role="dialog" aria-label="Kết quả" data-bad={run?.state.disqualified ? 'yes' : 'no'}>
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
function paint(el: HTMLElement, run: Run, exercise: Exercise, ruleset: Ruleset, glOk: boolean, audio: AudioState, level: number, entered: boolean) {
  const s = run.state;
  const d = el.dataset;
  d.tick = String(s.tick);
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
  d.lineGap = s.lineGapM.toFixed(3);
  d.stopA = s.stopGapAM.toFixed(3);
  d.rollback = s.rollbackM.toFixed(3);
  d.sinceStop = String(s.sinceStopTicks);
  d.elevation = s.elevationM.toFixed(3);
  d.rpm = Math.round(s.rpm).toString();
  d.score = String(s.score);
  d.disqualified = s.disqualified ? 'yes' : 'no';
  d.penalties = run.penalties.map((p) => p.id).join(' ');
  d.glOk = glOk ? 'yes' : 'no';
  d.audio = audio;
  d.audioLevel = level.toFixed(4);
  d.hash = run.hash() ?? '';
  paintAid(d, exercise.stop(s, ruleset));
  paintScene(d, s, run);
  d.entered = entered ? 'yes' : 'no';
  // Figure runs: everything the advice line reasons about, so a test (and the Supervisor) reads the
  // same numbers the page used.
  if (exercise.lesson === 4 || exercise.lesson === 6) {
    d.progress = s.progressM.toFixed(3);
    d.courseLen = s.courseLengthM.toFixed(3);
    d.lateral = s.lateralM.toFixed(3);
    d.headingErr = s.headingErrRad.toFixed(3);
    d.segment = String(s.segment);
    d.clock = s.clockS.toFixed(2);
    d.contactEpisode = s.contactEpisodeS.toFixed(2);
    d.contact = s.contact.join('');
  }
  for (const step of exercise.steps) d[`step_${step.id}`] = run.stepsDone.has(step.id) ? 'yes' : 'no';
}

/** Fetch sim.wasm once. A module that will not instantiate fails here, not on the first key. */
async function loadCore(wasmUrl: string, seed: bigint): Promise<() => Session> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Không nạp được ${wasmUrl}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  openSession(bytes, seed).dispose();
  return () => openSession(bytes, seed);
}

/**
 * The stop aid on the root element, in the names the Supervisor's scripts and the end-to-end test
 * read: the key, the milliseconds until it should land, the gap in mm and the gap it should land at.
 * All four go empty when there is no aid, so "no aid" and "aid with no time left" cannot be confused.
 */
function paintAid(d: DOMStringMap, aid: ReturnType<Exercise['stop']>) {
  if (!aid) {
    d.aidKey = '';
    d.aidEtaMs = '';
    d.aidGapMm = '';
    d.aidMarkMm = '';
    return;
  }
  d.aidKey = aid.key;
  d.aidEtaMs = String(aid.etaMs);
  d.aidGapMm = String(Math.round(aid.gapM * 1000));
  d.aidMarkMm = String(Math.round(aid.markM * 1000));
}

/**
 * What a polling script needs to follow a road lesson without parsing the HUD's words: which band of
 * the scene the bumper is in, and the last rule that fired with its own points and its verbatim
 * quote. The quote is the ruleset's, not a paraphrase, so a script reading it sees exactly what the
 * learner sees in the penalty panel.
 *
 * A run with no penalty publishes empty strings for all three, so "no penalty yet" is not a code.
 */
function paintScene(d: DOMStringMap, s: SimState, run: Run) {
  d.zone = s.route === 0 ? '' : zoneName(s.zone);
  d.zoneLabel = d.zone === '' ? '' : ZONE_TEXT[zoneName(s.zone)];
  const last = run.penalties.at(-1);
  if (!last) {
    d.lastPenalty = '';
    d.lastPenaltyPoints = '';
    d.lastPenaltyQuote = '';
    return;
  }
  d.lastPenalty = last.id;
  d.lastPenaltyPoints = last.disqualify ? 'DISQUALIFY' : String(last.points);
  d.lastPenaltyQuote = last.source.quote;
}

/** The bands of the scene, in words a learner reads rather than the short names scripts use. */
const ZONE_TEXT: Record<ReturnType<typeof zoneName>, string> = {
  start: 'Điểm xuất phát',
  approach: 'Trên đường tới vạch',
  'stop-zone': 'Trong vùng dừng xe',
  'at-line': 'Ngay vạch dừng',
  'past-line': 'Đã qua vạch dừng',
  'at-crossing': 'Tới vạch qua đường / đường sắt',
  'in-junction': 'Trong ngã tư',
  'exit-lane': 'Đang ra khỏi ngã tư',
  'past-finish': 'Đã qua vạch kết thúc',
};
