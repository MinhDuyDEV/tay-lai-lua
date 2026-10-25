'use client';
// The HUD: DOM, not three. Numbers are written straight onto refs from the run's frame hook, so the
// 60 Hz loop never causes a React render. Only two rare things are React state — the penalty feed
// and the result overlay — because they change a handful of times per run.

import { useEffect, useRef, type RefObject } from 'react';
import { legendFor } from '../input/driver.ts';
import type { Exercise } from './exercise.ts';
import type { Ruleset } from './ruleset.ts';
import { hillOf, sourceLabel } from './ruleset.ts';
import type { Penalty } from './ruleset.ts';
import type { Run } from './run.ts';
import type { SimState } from './sim/session.ts';
import { secondsLeft, type StepId } from './steps.ts';

export interface HudProps {
  run: Run;
  exercise: Exercise;
  ruleset: Ruleset;
  penalties: readonly Penalty[];
  /** The rpm the ruleset calls a penalty above (SH.X.RPM params.rpm). */
  rpmLimit: number;
  /** Read each frame: the audio state lives in a ref, so a value passed at render time goes stale. */
  audio: () => 'idle' | 'starting' | 'running' | 'failed';
  glOk: boolean;
}

function audioLabel(state: ReturnType<HudProps['audio']>) {
  return state === 'running' ? 'Âm thanh: sẵn sàng' : state === 'failed' ? 'Âm thanh: không mở được' : 'Âm thanh: chờ';
}

/** Pedal and steer bars show what the core consumed, not what a key is doing. */
function bar(value: number, max = 1) {
  return `${Math.max(0, Math.min(1, value / max)) * 100}%`;
}

export default function Hud({ run, exercise, ruleset, penalties, rpmLimit, audio, glOk }: HudProps) {
  const speed = useRef<HTMLSpanElement>(null);
  const rpm = useRef<HTMLSpanElement>(null);
  const rpmBar = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLSpanElement>(null);
  const bumper = useRef<HTMLSpanElement>(null);
  const score = useRef<HTMLSpanElement>(null);
  const phase = useRef<HTMLSpanElement>(null);
  const throttle = useRef<HTMLDivElement>(null);
  const brake = useRef<HTMLDivElement>(null);
  const clutch = useRef<HTMLDivElement>(null);
  const steer = useRef<HTMLDivElement>(null);
  const steerLabel = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const stepEls = useRef(new Map<string, HTMLLIElement>());
  const audioEl = useRef<HTMLParagraphElement>(null);
  const hillEl = useRef<HTMLElement>(null);
  const advice = useRef<HTMLParagraphElement>(null);
  const bai3 = exercise.lesson === 3;

  useEffect(() => {
    const hill = hillEl.current ? hillParts(hillEl.current) : null;
    const stop = run.onFrame(() => {
      const s = run.state;
      if (speed.current) speed.current.textContent = (s.speedMps * 3.6).toFixed(1);
      if (rpm.current) rpm.current.textContent = Math.round(s.rpm).toString();
      if (rpmBar.current) {
        rpmBar.current.style.width = bar(s.rpm, rpmLimit * 1.15);
        rpmBar.current.dataset.over = s.rpm > rpmLimit ? 'yes' : 'no';
      }
      if (gear.current) gear.current.textContent = s.gear === 0 ? 'N' : s.gear === -1 ? 'R' : String(s.gear);
      if (bumper.current) bumper.current.textContent = s.frontBumperM.toFixed(2);
      if (hill) paintHill(hill, s, ruleset);
      if (score.current) score.current.textContent = s.disqualified ? 'ĐÌNH CHỈ' : String(s.score);
      if (phase.current) phase.current.textContent = phaseLabel(s.phase, s.disqualified, exercise.lesson);
      if (throttle.current) throttle.current.style.height = bar(s.throttle);
      if (brake.current) brake.current.style.height = bar(s.brake);
      if (clutch.current) clutch.current.style.height = bar(s.clutch);
      if (steer.current) {
        // Centred bar: steer is -1..1 of full lock.
        const pct = (s.steerRad / ruleset.vehicle.max_steer_rad) * 50;
        steer.current.style.left = `${50 + Math.min(50, Math.max(-50, pct))}%`;
      }
      if (steerLabel.current) steerLabel.current.textContent = (s.steerRad / ruleset.vehicle.max_steer_rad).toFixed(2);
      if (hint.current) {
        const text = run.driver.hint ?? '';
        if (hint.current.textContent !== text) hint.current.textContent = text;
      }
      if (advice.current) {
        const text = exercise.advice(s, ruleset) ?? '';
        if (advice.current.textContent !== text) advice.current.textContent = text;
        advice.current.dataset.cue = exercise.cue(s, ruleset) ?? '';
      }
      if (audioEl.current) {
        const now = audio();
        if (audioEl.current.dataset.audio !== now) {
          audioEl.current.dataset.audio = now;
          audioEl.current.textContent = audioLabel(now);
        }
      }
      for (const [id, el] of stepEls.current) {
        el.dataset.done = run.stepsDone.has(id as StepId) ? 'yes' : 'no';
      }
    });
    return stop;
  }, [run, exercise, ruleset, rpmLimit, audio]);

  return (
    <div className="hud">
      <section className="hud-steps" aria-label="Trình tự">
        <h2>Trình tự</h2>
        <ol>
          {exercise.steps.map((step) => (
            <li
              key={step.id}
              data-step={step.id}
              data-done="no"
              ref={(el) => {
                if (el) stepEls.current.set(step.id, el);
                else stepEls.current.delete(step.id);
              }}
            >
              <span className="key">{step.key}</span>
              {step.label}
            </li>
          ))}
        </ol>
        <p className="hint" ref={hint} />
      </section>

      {bai3 ? (
        <section className="hud-hill" aria-label="Dốc" ref={hillEl}>
          <div className="cell" data-cell="a">
            <span className="name" data-part="label">
              Còn tới vạch
            </span>
            <strong>
              <span data-part="value">0</span> mm
            </strong>
            <small data-part="limit" />
          </div>
          <div className="cell" data-cell="rollback">
            <span className="name">Tụt dốc</span>
            <strong>
              <span data-part="value">0</span> mm
            </strong>
            <small data-part="limit" />
          </div>
          <div className="cell" data-cell="clock">
            <span className="name">Thời gian</span>
            <strong>
              <span data-part="value">—</span>
            </strong>
            <small data-part="limit" />
          </div>
          <p className="advice" ref={advice} />
        </section>
      ) : null}

      <section className="hud-drive" aria-label="Xe">
        <div className="pedals">
          <div className="pedal">
            <div className="track">
              <div className="fill" ref={clutch} data-pedal="clutch" />
            </div>
            <span>Côn</span>
          </div>
          <div className="pedal">
            <div className="track">
              <div className="fill" ref={throttle} data-pedal="throttle" />
            </div>
            <span>Ga</span>
          </div>
          <div className="pedal">
            <div className="track">
              <div className="fill" ref={brake} data-pedal="brake" />
            </div>
            <span>Phanh</span>
          </div>
        </div>

        <dl className="gauges">
          <div>
            <dt>Vòng tua</dt>
            <dd>
              <span ref={rpm}>0</span> v/p
              <div className="rpm-track">
                <div className="rpm-fill" ref={rpmBar} />
              </div>
            </dd>
          </div>
          <div>
            <dt>Tốc độ</dt>
            <dd>
              <span ref={speed}>0.0</span> km/h
            </dd>
          </div>
          <div>
            <dt>Số</dt>
            <dd ref={gear}>N</dd>
          </div>
          <div>
            <dt>Lái</dt>
            <dd>
              <div className="steer-track">
                <div className="steer-mark" ref={steer} />
              </div>
              <span ref={steerLabel}>0.00</span>
            </dd>
          </div>
          {bai3 ? null : (
            <div>
              <dt>Qua vạch</dt>
              <dd>
                <span ref={bumper}>-1.00</span> m
              </dd>
            </div>
          )}
          <div>
            <dt>Điểm</dt>
            <dd>
              <span ref={score}>100</span>
            </dd>
          </div>
          <div>
            <dt>Giai đoạn</dt>
            <dd>
              <span ref={phase}>chờ lệnh</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="hud-penalties" aria-label="Lỗi">
        <h2>Lỗi</h2>
        {penalties.length === 0 ? (
          <p className="none">Chưa có lỗi.</p>
        ) : (
          <ul>
            {penalties.map((p, i) => (
              <li key={`${p.tick}-${p.id}-${i}`} data-penalty={p.id}>
                <p className="rule">
                  <code>{p.id}</code>
                  <span className="points">{p.disqualify ? 'Đình chỉ' : `−${p.points} điểm`}</span>
                </p>
                <blockquote>{p.source.quote}</blockquote>
                <cite>{sourceLabel(p.source)}</cite>
              </li>
            ))}
          </ul>
        )}
        <p className="audio" data-audio="idle" ref={audioEl}>
          {audioLabel('idle')}
        </p>
      </section>

      <section className="hud-keys" aria-label="Phím">
        <h2>Phím</h2>
        <ul>
          {legendFor(exercise.lesson).map((entry) => (
            <li key={entry.keys}>
              <span className="key">{entry.keys}</span>
              {entry.does}
            </li>
          ))}
          <li>
            <span className="key">Esc</span>Làm lại bài
          </li>
        </ul>
      </section>

      {!glOk && <p className="gl-warning">Không vẽ được 3D (WebGL lỗi). Bài thi vẫn chạy bình thường.</p>}
    </div>
  );
}

const mm = (m: number) => String(Math.round(m * 1000));

interface HillCell {
  cell: HTMLElement;
  label: HTMLElement | null;
  value: HTMLElement;
  limit: HTMLElement;
}

/** The three cells of the slope card, looked up once so the 60 Hz paint touches no selector. */
function hillParts(el: HTMLElement): Record<'a' | 'rollback' | 'clock', HillCell> {
  const cell = (name: string): HillCell => {
    const c = el.querySelector<HTMLElement>(`[data-cell="${name}"]`)!;
    return {
      cell: c,
      label: c.querySelector<HTMLElement>('[data-part="label"]'),
      value: c.querySelector<HTMLElement>('[data-part="value"]')!,
      limit: c.querySelector<HTMLElement>('[data-part="limit"]')!,
    };
  };
  return { a: cell('a'), rollback: cell('rollback'), clock: cell('clock') };
}

/** The slope card: A (live, then the recorded one), the rollback and the 30 s clock, in mm and s. */
function paintHill(parts: ReturnType<typeof hillParts>, s: SimState, ruleset: Ruleset) {
  const hill = hillOf(ruleset);
  const stopped = s.sinceStopTicks >= 0;
  const a = parts.a;
  const gap = stopped ? s.stopGapAM : s.lineGapM;
  if (a.label) a.label.textContent = stopped ? 'A lúc dừng' : s.lineGapM < 0 ? 'Quá vạch' : 'Còn tới vạch';
  a.value.textContent = mm(gap);
  a.limit.textContent = `không quá ${mm(hill.max_a_m)} mm`;
  a.cell.dataset.state = gap >= 0 && gap <= hill.max_a_m ? 'ok' : stopped ? 'bad' : 'neutral';

  const r = parts.rollback;
  r.value.textContent = mm(s.rollbackM);
  r.limit.textContent = `không quá ${mm(hill.max_rollback_m)} mm`;
  r.cell.dataset.state = s.rollbackM > hill.max_rollback_m ? 'bad' : s.rollbackM > 0 ? 'warn' : 'neutral';

  const left = secondsLeft(s, ruleset);
  const t = parts.clock;
  t.value.textContent = left === null ? '—' : `${Math.ceil(left)} s`;
  t.limit.textContent = left === null ? 'tính từ lúc dừng xe' : 'để qua vạch';
  t.cell.dataset.state = left === null ? 'neutral' : left < 10 ? 'warn' : 'ok';
}

function phaseLabel(phase: string, disqualified: boolean, lesson: 1 | 3): string {
  if (disqualified) return 'đình chỉ';
  switch (phase) {
    case 'waiting':
      return 'chờ lệnh';
    case 'launched':
      return lesson === 3 ? 'lên dốc' : 'đã có lệnh';
    case 'stopped':
      return 'đã dừng';
    case 'past-line':
      return 'qua vạch';
    case 'done':
      return 'kết thúc';
    default:
      return phase;
  }
}

/** Pull a ref's element out, for a parent that needs to read it. */
export type ElRef = RefObject<HTMLElement | null>;
