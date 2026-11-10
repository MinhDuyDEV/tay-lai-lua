'use client';
// The page body: the run, the scene, the HUD, and the one element the end-to-end test reads.
//
// The HUD, the key handling and the sim loop live here, outside the canvas, so a WebGL failure
// cannot take them with it. `data-gl-ok` says which of the two worlds the learner got.

import { Canvas } from '@react-three/fiber';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HANDLED_CODES, legendFor } from '../input/driver.ts';
import { useEngineAudio, type AudioState } from './audio.ts';
import { exerciseFor, linkExercise, type Exercise, type Lesson } from './exercise.ts';
import Hud from './Hud.tsx';
import { HOME_HREF, LESSON_COUNT, lessonHref, lienHoanHref } from './links.ts';
import LienHoanResult, { type ReplayResult } from './lien-hoan/Result.tsx';
import { gearOf, gearSignM, type Penalty, type Ruleset } from './ruleset.ts';
import { createRun, RESTART_CODES, type Run } from './run.ts';
import { AUTOMATIC_BIT, lightName, openSession, seedWord, zoneName, type Session, type SimState } from './sim/session.ts';
import TopBar from './TopBar.tsx';

// three and R3F are the heavy part of the route; keep them out of the first chunk.
const Scene = dynamic(() => import('./scene/Scene.tsx'), { ssr: false, loading: () => null });

export interface StageProps {
  /** Which exercise this page runs; a number because it crosses from a server component. */
  lesson: Lesson;
  ruleset: Ruleset;
  wasmUrl: string;
  /** True for the whole 11-bài run: the exercise follows the core's lesson, not this prop. */
  lienHoan?: boolean;
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

/** The run exercise id (`crates/sim-core/src/chain.rs`, `LIEN_HOAN_ID`). */
const LIEN_HOAN_ID = 12;
/**
 * The low bits a liên hoàn run starts with: bài 5's red-light seed (`junction_seed(1)` in the core's
 * goldens). Every other bài ignores the low bits, so this is the same address a learner gets from
 * `/thi/5` with its own default seed.
 */
const RUN_SEED_LOW = 1n;
/** How many recorded ticks a replay feeds per animation frame: ~24× real time, with the scene live. */
const REPLAY_TICKS_PER_FRAME = 24;

/** Split a recorded trace: the seed word, then one 8-byte record per tick. */
function splitTrace(trace: Uint8Array): { seed: bigint; inputs: Uint8Array[] } {
  if (trace.length < 8 || (trace.length - 8) % 8 !== 0) {
    throw new Error(`a replay trace must be 8 + 8n bytes, got ${trace.length}`);
  }
  const view = new DataView(trace.buffer, trace.byteOffset, trace.byteLength);
  const inputs: Uint8Array[] = [];
  for (let at = 8; at < trace.length; at += 8) inputs.push(trace.slice(at, at + 8));
  return { seed: view.getBigUint64(0, true), inputs };
}

/**
 * The transmission the learner picked: `?so=tu-dong` in the address, or the switch on the page. Read
 * on the client, because the page is prerendered where there is no URL; a bad value is an error rather
 * than a silent fall back to the manual car, so a shared link that says something else says it out loud.
 */
function transmissionFromUrl(): boolean | null {
  if (typeof window === 'undefined') return null;
  const so = new URLSearchParams(window.location.search).get('so');
  if (so === null) return null;
  if (so === 'tu-dong') return true;
  if (so === 'san') return false;
  throw new Error(`?so=${so} is not "tu-dong" or "san"`);
}

/**
 * The seed the page runs this time, or null for the lesson's own. A page's seed is the exercise's
 * default (`exercise.ts`); `?seed=` overrides it so a reviewer or the end-to-end test can drive the
 * same page to a different light or figure. The recorded trace carries the seed in its first 8 bytes,
 * so a run started this way still replays to the same hash. It replaces the low bits only: the exercise
 * id and the transmission come from the exercise (see the `useMemo` in `Stage`).
 */
function seedOverride(): bigint | null {
  // No window during the static export: the page is prerendered on the server, where there is no URL
  // to read and the lesson's own seed is what gets baked in. The override happens on the client.
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`?seed=${raw} is not a whole number`);
  const low = BigInt(raw);
  if (low > 0xffffffffffffn) throw new Error(`?seed=${raw} does not fit below the exercise id`);
  return low;
}

/** Where the page remembers the learner's two choices between visits. */
const SO_KEY = 'tll.so';
const KEYS_KEY = 'tll.keys';
/** The width from which the key legend has a column of its own; the same number as in `globals.css`. */
const WIDE_QUERY = '(min-width: 1200px)';

/** localStorage, or nothing: a private window or a blocked store must not stop the page. */
function recall(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the choice still holds for this visit.
  }
}

export default function Stage({ lesson, ruleset, wasmUrl, lienHoan = false }: StageProps) {
  // The manual car until the URL or the switch says otherwise: the server render has no URL.
  const [automatic, setAutomatic] = useState(false);
  useEffect(() => {
    const so = transmissionFromUrl();
    if (so !== null) setAutomatic(so);
  }, []);
  /**
   * The switch on the page: the new transmission, and the address says so too, so a reload, a shared
   * link and the links to the next bài all keep the car the learner picked.
   */
  const chooseAutomatic = useCallback((auto: boolean) => {
    setAutomatic(auto);
    const url = new URL(window.location.href);
    if (auto) url.searchParams.set('so', 'tu-dong');
    else url.searchParams.delete('so');
    window.history.replaceState(window.history.state, '', url);
    remember(SO_KEY, auto ? 'tu-dong' : 'san');
  }, []);
  /**
   * The key legend: on a wide window it is open until the learner closes it, on a narrow one it is
   * closed until they open it, and the last explicit choice is remembered. `auto` is the answer before
   * the page has looked at the window (the static export has none), so the CSS decides by width.
   */
  const [keys, setKeys] = useState<'auto' | 'open' | 'closed'>('auto');
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const stored = recall(KEYS_KEY);
    if (stored === 'open' || stored === 'closed') setKeys(stored);
    const query = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const keysShown = keys === 'open' || (keys === 'auto' && wide);
  const toggleKeys = useCallback(() => {
    const next = keysShown ? 'closed' : 'open';
    setKeys(next);
    remember(KEYS_KEY, next);
  }, [keysShown]);
  /**
   * The stage the page is showing: the prop on a per-bài page, the core's lesson in a run. The run's
   * link between bài 6 and bài 7 is lesson 0.
   */
  const [lessonNow, setLessonNow] = useState<number>(lesson);
  const lessonRef = useRef<number>(lesson);
  // Memoised: `exerciseFor` builds the page's object, so a fresh one every render would re-boot the run
  // (and its sim session) on every render. In a liên hoàn run this follows the bài the core swapped to.
  const base = useMemo(
    () => (lessonNow === 0 ? linkExercise(automatic) : exerciseFor(lessonNow as Lesson, automatic)),
    [lessonNow, automatic],
  );
  // The lesson's own numbers, with only the seed taken from the URL when one is given. The exercise id
  // and the transmission bit are the page's, not the seed's: `?seed=` replaces the low bits only, so an
  // automatic page opened with `?seed=7` still runs the automatic (and bài 1's id 0 stays 0). A run's
  // seed word is exercise id 12, the transmission bit, and the same low bits for every bài.
  const exercise = useMemo(() => {
    const low = seedOverride();
    if (lienHoan) return { ...base, seed: seedWord(LIEN_HOAN_ID, low ?? RUN_SEED_LOW, automatic) };
    if (low === null) return base;
    const id = base.seed >> 56n;
    return { ...base, seed: (id << 56n) | (base.automatic ? AUTOMATIC_BIT : 0n) | low };
  }, [base, lienHoan, automatic]);
  // One exercise per stage, built once: a run asks `exerciseOf` which one the core's state belongs to.
  // Stage 0 is the link between bài 6 and bài 7; 1..11 are the bài themselves.
  const exerciseByLesson = useMemo(() => {
    const all = new Map<number, Exercise>();
    all.set(0, linkExercise(automatic));
    for (let n = 1; n <= 11; n += 1) all.set(n, exerciseFor(n as Lesson, automatic));
    return all;
  }, [automatic]);
  const exerciseOf = useCallback(
    (state: SimState) => {
      const current = lienHoan && state.lesson >= 0 && state.lesson <= 11 ? state.lesson : lesson;
      return exerciseByLesson.get(current)!;
    },
    [lienHoan, lesson, exerciseByLesson],
  );
  const root = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [penalties, setPenalties] = useState<readonly Penalty[]>(NO_PENALTIES);
  const [glOk, setGlOk] = useState(true);
  const [entered, setEntered] = useState(false);
  const [done, setDone] = useState(false);
  const [bootProblem, setBootProblem] = useState<string | null>(null);
  // Replay: the result screen hands the recorded trace back to a fresh session, which feeds it a few
  // ticks a frame. `epoch` forces a fresh boot when the same button is pressed twice.
  const [mode, setMode] = useState<'drive' | 'replay'>('drive');
  const [replayTrace, setReplayTrace] = useState<Uint8Array | null>(null);
  const [replayExpected, setReplayExpected] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [epoch, setEpoch] = useState(0);
  const replayReported = useRef(false);
  const startOverRef = useRef<() => void>(() => {});
  const core = useRef<Promise<(seed: bigint) => Session> | null>(null);
  const audio = useEngineAudio();

  // The ruleset's own numbers, so the HUD's red line is the scorer's red line.
  const rpmLine = ruleset.rules.find((r) => r.id === 'SH.X.RPM')?.params?.rpm ?? 4000;

  useEffect(() => {
    let cancelled = false;
    let created: Run | null = null;

    const boot = async () => {
      core.current ??= loadCore(wasmUrl);
      let open: (seed: bigint) => Session;
      try {
        open = await core.current;
      } catch (error) {
        if (!cancelled) setBootProblem((error as Error).message);
        return;
      }
      if (cancelled) return;
      const recorded = mode === 'replay' && replayTrace ? splitTrace(replayTrace) : null;
      const seed = recorded ? recorded.seed : exercise.seed;
      created = createRun({
        exercise: exerciseByLesson.get(lesson)!,
        exerciseOf,
        ruleset,
        openSession: () => open(seed),
        target: window,
        handledCodes: HANDLED_CODES,
        automatic,
        replay: recorded ? { inputs: recorded.inputs, ticksPerFrame: REPLAY_TICKS_PER_FRAME } : undefined,
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
    // `exercise.seed` is a primitive: a liên hoàn run's lesson changes the exercise object, not the seed.
  }, [exercise.seed, exerciseByLesson, exerciseOf, lesson, ruleset, wasmUrl, automatic, mode, replayTrace, epoch]);

  // Publish the numbers the test polls, every frame, on the one root element.
  useEffect(() => {
    if (!run) return;
    const write = () => {
      audio.post(run.state);
      // A liên hoàn run swaps the bài inside the core; the HUD and the scene follow it a render later.
      if (lienHoan && run.state.lesson >= 0 && run.state.lesson <= 11 && run.state.lesson !== lessonRef.current) {
        lessonRef.current = run.state.lesson;
        setLessonNow(run.state.lesson);
      }
      // The run changes without a React render; the result card needs one when it ends (or restarts).
      setDone(run.state.phase === 'done' || run.state.disqualified);
      if (run.replay && run.replay.done && !replayReported.current) {
        replayReported.current = true;
        const actual = run.hash();
        setReplayResult({ actual, match: actual === replayExpected });
      }
      if (root.current) paint(root.current, run, exercise, ruleset, glOk, audio.state(), audio.level(), entered);
    };
    write();
    return run.onFrame(write);
  }, [run, exercise, lienHoan, ruleset, glOk, audio, entered, replayExpected]);

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

  /** The top bar's restart: the run's own in a drive, a fresh run when a replay is on screen. */
  const restartFromBar = useCallback(() => {
    if (mode === 'replay') startOverRef.current();
    else runRef.current?.restart();
  }, [mode]);

  /** The result screen's replay: feed the recorded trace to a fresh session, same seed, same hash. */
  const startReplay = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    const expected = current.hash();
    const bytes = Uint8Array.from(atob(current.traceBase64()), (c) => c.charCodeAt(0));
    replayReported.current = false;
    setPenalties(NO_PENALTIES);
    setDone(false);
    setReplayTrace(bytes);
    setReplayExpected(expected);
    setReplayResult(null);
    setMode('replay');
  }, []);

  /** Leave a replay (or a finished run) and boot a fresh run from bài 1. */
  const startOver = useCallback(() => {
    replayReported.current = false;
    lessonRef.current = lesson;
    setLessonNow(lesson);
    setPenalties(NO_PENALTIES);
    setDone(false);
    setReplayTrace(null);
    setReplayExpected(null);
    setReplayResult(null);
    setMode('drive');
    setEpoch((n) => n + 1);
  }, [lesson]);
  startOverRef.current = startOver;

  // A replay has no keyboard run behind it; Esc and Backspace still restart the whole run, as on
  // every other page. In drive mode the run itself handles them.
  useEffect(() => {
    if (!lienHoan || mode !== 'replay') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!RESTART_CODES.includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      startOver();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [lienHoan, mode, startOver]);

  // The first key only enters the car. It is taken in the capture phase and stopped there, so the
  // keyboard module never sees it and it cannot count as an order or a toggle.
  useEffect(() => {
    if (entered) return;
    const onFirstKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Tab moves the focus, and a key pressed on a focused link or button is that control's own: the
      // top bar stays usable from the keyboard before the car is entered.
      if (event.code === 'Tab') return;
      if (event.target instanceof Element && event.target.closest('a, button')) return;
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
      data-aid-now=""
      data-zone=""
      data-zone-label=""
      data-light=""
      data-light-left-ms=""
      data-clock-ms=""
      data-car-x="0.000"
      data-car-y="0.000"
      data-heading="0.000"
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
      data-hull-inside="no"
      data-finish-signal="no"
      data-hold-ticks="0"
      data-so="san"
      data-run={lienHoan ? 'yes' : 'no'}
      data-lesson="0"
      data-course-tick="0"
      data-verdict="running"
      data-on-link="no"
      data-hazard="0"
      data-hazard-elapsed-ms="0"
      data-hazard-button="no"
      data-intro={entered ? 'no' : 'yes'}
      data-keys={keys}
      data-ended={done && entered ? 'yes' : 'no'}
    >
      <TopBar
        lesson={lesson}
        lessonNow={lessonNow}
        lienHoan={lienHoan}
        title={exerciseByLesson.get(lesson)!.title}
        automatic={automatic}
        onAutomatic={chooseAutomatic}
        keysShown={keysShown}
        onKeys={toggleKeys}
        onRestart={restartFromBar}
      />

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
          lienHoan={lienHoan}
        />
      ) : null}

      {!entered ? (
        <div className="overlay intro" role="dialog" aria-label="Vào xe">
          <div className="card">
            <p className="eyebrow">
              {lienHoan ? `Thi thử · ${LESSON_COUNT} bài liên tiếp` : `Sa hình hạng B · bài ${lesson}/${LESSON_COUNT}`}
              <span className="chip">{automatic ? 'Số tự động' : 'Số sàn'}</span>
            </p>
            <h1>{lienHoan ? 'Sa hình liên hoàn' : exercise.title.replace(/^Bài \d+ — /, '')}</h1>
            <p className="lead">
              {lienHoan
                ? `Chạy cả ${LESSON_COUNT} bài trong một lượt. Đạt từ ${ruleset.scoring.pass}/${ruleset.scoring.base} điểm; cuối lượt có bảng lỗi và chạy lại đúng lượt đó.`
                : exercise.description.replace(/, bằng bàn phím\.$/, '.')}
            </p>
            {lienHoan ? (
              <p className="chain-note" data-note="lien-hoan-chain">
                11 bài nối tiếp nhau, không phải một sân thật: giữa bài 6 và bài 7 xe chạy một đoạn nối 60 m có
                tình huống nguy hiểm; các chỗ còn lại, xong mỗi bài xe được đặt ở vị trí xuất phát của bài kế tiếp —
                không có đoạn lái nào khác.
              </p>
            ) : null}
            <h2>Phím dùng trong bài</h2>
            <ul className="keylist">
              {legendFor(exercise.lesson, exercise.lesson === 1, automatic, exercise.link === true).slice(0, exercise.introKeys).map((entry) => (
                <li key={entry.keys}>
                  <span className="key">{entry.keys}</span>
                  {entry.does}
                </li>
              ))}
            </ul>
            <p className="note">Trong lúc lái, màn hình luôn chỉ bước tiếp theo và phím cần bấm.</p>
            <div className="actions">
              <button type="button" className="primary" data-enter-button onClick={enter} disabled={!run}>
                {run ? 'Vào xe' : 'Đang nạp…'}
              </button>
              <span className="or">hoặc bấm phím bất kỳ</span>
            </div>
          </div>
        </div>
      ) : null}

      {done && entered && run ? (
        lienHoan ? (
          <LienHoanResult
            run={run}
            ruleset={ruleset}
            penalties={penalties}
            replayResult={replayResult}
            replayExpected={replayExpected}
            onReplay={startReplay}
            onRestart={startOver}
          />
        ) : (
          <div className="overlay result" role="dialog" aria-label="Kết quả" data-bad={run.state.disqualified ? 'yes' : 'no'}>
            <div className="card">
              <p className="eyebrow">{exercise.title}</p>
              <h1>{run.state.disqualified ? 'Đình chỉ' : `Kết quả: ${run.state.score} điểm`}</h1>
              <p className="lead">
                {run.state.disqualified
                  ? 'Bài thi dừng ở lỗi bị đình chỉ dưới đây.'
                  : penalties.length === 0
                    ? 'Không có lỗi. Làm lại vài lần cho quen tay rồi sang bài kế tiếp.'
                    : `${penalties.length} lỗi, bị trừ ${ruleset.scoring.base - run.state.score} điểm.`}
              </p>
              {penalties.length > 0 ? (
                <ul className="faults">
                  {penalties.map((p, i) => (
                    <li key={`${p.tick}-${p.id}-${i}`}>
                      <span className="minus">{p.disqualify ? 'Đình chỉ' : `−${p.points}`}</span>
                      <span className="why">{p.source.quote}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="actions">
                <button type="button" className="primary" onClick={restart}>
                  Làm lại <span className="key">Esc</span>
                </button>
                <a className="button" href={lesson < LESSON_COUNT ? lessonHref(lesson + 1, automatic) : lienHoanHref(automatic)}>
                  {lesson < LESSON_COUNT ? `Bài ${lesson + 1}` : 'Thi thử liên hoàn'} <span aria-hidden="true">›</span>
                </a>
                <a className="button quiet" href={HOME_HREF}>
                  Các bài
                </a>
              </div>
            </div>
          </div>
        )
      ) : null}

      {lienHoan && mode === 'replay' && !done ? (
        <p className="notice replay" data-replay="running">
          Đang chạy lại lượt vừa chạy ở tốc độ nhanh — cùng đầu vào, cùng hash.
        </p>
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
  d.so = exercise.automatic ? 'tu-dong' : 'san';
  d.exercise = String(s.lesson > 0 ? s.lesson : exercise.lesson);
  d.lesson = String(s.lesson);
  d.courseTick = String(s.courseTick);
  d.verdict = s.verdict;
  d.onLink = s.onLink ? 'yes' : 'no';
  d.hazard = String(s.hazard);
  d.hazardElapsedMs = String(Math.round(s.hazardElapsedMs));
  d.hazardButton = s.hazardButton ? 'yes' : 'no';
  d.replay = run.replay ? (run.replay.done ? 'done' : 'running') : '';
  paintAid(d, exercise.stop(s, ruleset));
  paintScene(d, s, run);
  d.entered = entered ? 'yes' : 'no';
  // Figure runs: everything the advice line reasons about, so a test (and the Supervisor) reads the
  // same numbers the page used. Bài 5 is drawn on a route too, and the core fills the same fields for
  // it, so it publishes them under the same names — a steering script has one shape to read.
  // Bài 7 and bài 8 publish the park's own numbers: the scorer's containment and signal, and the hold
  // counter, so a test (and the learner) reads the same thing. `data-hold-need` is the tick count the
  // core gives the signal on, from the ruleset, never a literal in the page.
  if (exercise.lesson === 7 || exercise.lesson === 8) {
    d.hullInside = s.hullInside ? 'yes' : 'no';
    d.finishSignal = s.finishSignal ? 'yes' : 'no';
    d.holdTicks = String(s.holdTicks);
    d.clock = (s.clockMs / 1000).toFixed(2);
    d.progress = s.progressM.toFixed(3);
    d.lateral = s.lateralM.toFixed(3);
    d.contact = s.contact.join('');
  }
  // Bài 10's own numbers: the gear the core consumed, the next sign ahead of the bumper and the two
  // judged instants, so a script (and the e2e) reads the same signs the scorer's tick used.
  if (exercise.lesson === 10) {
    d.gearUsed = String(s.gear);
    const gear = gearOf(ruleset);
    const signs = [gearSignM(gear, 0), gearSignM(gear, 1), gearSignM(gear, 2)];
    const next = signs.find((m) => s.frontBumperM < m);
    d.nextSign = next === undefined ? '' : String(next);
    d.signsPassed = String(signs.filter((m) => s.frontBumperM >= m).length);
  }
  if (exercise.lesson === 4 || exercise.lesson === 5 || exercise.lesson === 6) {
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
async function loadCore(wasmUrl: string): Promise<(seed: bigint) => Session> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Không nạp được ${wasmUrl}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  // Bài 1's seed word: any known exercise instantiates the same module.
  openSession(bytes, seedWord(0, 1n, false)).dispose();
  return (seed) => openSession(bytes, seed);
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
    d.aidNow = '';
    return;
  }
  d.aidKey = aid.key;
  d.aidEtaMs = String(aid.etaMs);
  // "1" exactly on the tick the words turn to "bấm ngay", so a script and a human reading the line
  // see the same moment; empty when it is counting. `etaMs` is the bar's ideal and does not lead.
  d.aidNow = aid.now ? '1' : '';
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
  // Bài 5's light and clock. Dark (`none`) and zero are the core's own "not yet" values, so they
  // publish as empty rather than as a colour or a time a script would mistake for a reading.
  const lit = lightName(s.lightColour);
  d.light = lit === 'none' ? '' : lit;
  d.lightLeftMs = s.lightColour === 0 ? '' : String(Math.round(s.lightLeftMs));
  d.clockMs = s.clockMs === 0 ? '' : String(Math.round(s.clockMs));
  // The car's pose in the course's own frame. The figure pages reason about this from progress and
  // lateral; bài 5 has no figure block in the snapshot, so the pose is what the scene and a steering
  // script work from. Metres and radians, exactly as `sim_state` reports them.
  d.carX = s.carX.toFixed(3);
  d.carY = s.carY.toFixed(3);
  d.heading = s.heading.toFixed(3);
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
