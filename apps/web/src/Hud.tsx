'use client';
// The HUD: DOM, not three. Numbers are written straight onto refs from the run's frame hook, so the
// 60 Hz loop never causes a React render. Only two rare things are React state — the penalty feed
// and the result overlay — because they change a handful of times per run.

import { useEffect, useRef, type RefObject } from 'react';
import { KEY_LEGEND } from '../input/driver.ts';
import type { Ruleset } from './ruleset.ts';
import { sourceLabel } from './ruleset.ts';
import type { Penalty } from './ruleset.ts';
import type { Run } from './run.ts';
import { STEPS, stepDone } from './steps.ts';

export interface HudProps {
  run: Run;
  ruleset: Ruleset;
  penalties: readonly Penalty[];
  /** The rpm the ruleset calls a penalty above (SH.X.RPM params.rpm). */
  rpmLimit: number;
  audio: 'idle' | 'starting' | 'running' | 'failed';
  glOk: boolean;
  onRestart(): void;
}

/** Pedal and steer bars show what the core consumed, not what a key is doing. */
function bar(value: number, max = 1) {
  return `${Math.max(0, Math.min(1, value / max)) * 100}%`;
}

export default function Hud({ run, ruleset, penalties, rpmLimit, audio, glOk, onRestart }: HudProps) {
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

  useEffect(() => {
    run.onFrame = () => {
      const s = run.state;
      if (speed.current) speed.current.textContent = (s.speedMps * 3.6).toFixed(1);
      if (rpm.current) rpm.current.textContent = Math.round(s.rpm).toString();
      if (rpmBar.current) {
        rpmBar.current.style.width = bar(s.rpm, rpmLimit * 1.15);
        rpmBar.current.dataset.over = s.rpm > rpmLimit ? 'yes' : 'no';
      }
      if (gear.current) gear.current.textContent = s.gear === 0 ? 'N' : s.gear === -1 ? 'R' : String(s.gear);
      if (bumper.current) bumper.current.textContent = s.frontBumperM.toFixed(2);
      if (score.current) score.current.textContent = s.disqualified ? 'ĐÌNH CHỈ' : String(s.score);
      if (phase.current) phase.current.textContent = phaseLabel(s.phase, s.disqualified);
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
      for (const [id, el] of stepEls.current) {
        const done = stepDone(id as (typeof STEPS)[number]['id'], s, run.ordered);
        el.dataset.done = done ? 'yes' : 'no';
      }
    };
    return () => {
      run.onFrame = undefined;
    };
  }, [run, ruleset, rpmLimit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' && event.code !== 'Backspace') return;
      onRestart();
    };
    // `run` already handles restarts; this keeps the overlay's button and the key in one state.
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRestart]);

  return (
    <div className="hud">
      <section className="hud-steps" aria-label="Trình tự">
        <h2>Trình tự</h2>
        <ol>
          {STEPS.map((step) => (
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
          <div>
            <dt>Qua vạch</dt>
            <dd>
              <span ref={bumper}>-1.00</span> m
            </dd>
          </div>
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
        <p className="audio" data-audio={audio}>
          {audio === 'running' ? 'Âm thanh: sẵn sàng' : audio === 'failed' ? 'Âm thanh: không mở được' : 'Âm thanh: chờ'}
        </p>
      </section>

      <section className="hud-keys" aria-label="Phím">
        <h2>Phím</h2>
        <ul>
          {KEY_LEGEND.map((entry) => (
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

function phaseLabel(phase: string, disqualified: boolean): string {
  if (disqualified) return 'đình chỉ';
  switch (phase) {
    case 'waiting':
      return 'chờ lệnh';
    case 'launched':
      return 'đã có lệnh';
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
