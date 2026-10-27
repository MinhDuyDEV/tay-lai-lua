'use client';
// The HUD: DOM, not three. Numbers are written straight onto refs from the run's frame hook, so the
// 60 Hz loop never causes a React render. Only two rare things are React state — the penalty feed
// and the result overlay — because they change a handful of times per run.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { legendFor } from '../input/driver.ts';
import type { Exercise, Lesson } from './exercise.ts';
import type { Ruleset } from './ruleset.ts';
import { hillOf, junctionOf, roadOf, sourceLabel } from './ruleset.ts';
import type { Penalty } from './ruleset.ts';
import type { Run } from './run.ts';
import Inset from './Inset.tsx';
import { cueGhep, holdAid, hullOutside, newHoldTimer, yardOf, type HoldTimer } from './ghep.ts';
import { lightName, zoneName, type LightName, type SimState, type ZoneName } from './sim/session.ts';
import { secondsLeft, type StepId } from './steps.ts';

/** The park card's own numbers, or a clear error: a park page with no bay cannot draw one. */
function yardOfOrThrow(yard: ReturnType<typeof yardOf> | null): ReturnType<typeof yardOf> {
  if (!yard) throw new Error('bài 7/8: the core published no bay rectangle (sim_course kind 8)');
  return yard;
}

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
  const aidEl = useRef<HTMLDivElement>(null);
  const aidFill = useRef<HTMLDivElement>(null);
  const aidMark = useRef<HTMLDivElement>(null);
  const aidKey = useRef<HTMLSpanElement>(null);
  const aidIn = useRef<HTMLSpanElement>(null);
  const holdEl = useRef<HTMLDivElement>(null);
  const holdFill = useRef<HTMLDivElement>(null);
  const holdText = useRef<HTMLSpanElement>(null);
  const holdTimer = useRef<HoldTimer>(newHoldTimer());
  /** The widest gap the aid has been seen at, so the bar's scale does not jump as the car rolls up. */
  const spanRef = useRef(12);
  /** The figure's centreline, read once from the core; the same polyline the scene draws. */
  const centre = useMemo(() => run.course.find((r) => r.kind === 5)?.points ?? [], [run]);
  /** Bài 7/8: the area and the bay, read once from the core's own course. */
  const yard = useMemo(() => exercise.park?.(run.course) ?? null, [run, exercise]);
  const bai3 = exercise.lesson === 3;
  /** Bài 2, 9 and 11: one straight road, a stop line, and one thing past it. */
  const road = exercise.lesson === 2 || exercise.lesson === 9 || exercise.lesson === 11;
  /** Bài 5: the signalled junction. It shares the road card, and adds the light and the 20/30 s clock. */
  const junction = exercise.lesson === 5;
  const figure = exercise.lesson === 4 || exercise.lesson === 6;
  /** Bài 7 and bài 8: the bay card, the hold counter and the top-down inset of the yard. */
  const park = exercise.lesson === 7 || exercise.lesson === 8;
  const figureEl = useRef<HTMLElement>(null);

  useEffect(() => {
    const hill = hillEl.current ? hillParts(hillEl.current) : null;
    const aidParts = aidEl.current
      ? { el: aidEl.current, fill: aidFill.current!, mark: aidMark.current!, key: aidKey.current!, inn: aidIn.current! }
      : null;
    const fig = figureEl.current ? figureParts(figureEl.current) : null;
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
      if (hill) paintHill(hill, s, ruleset, exercise.lesson);
      if (aidParts) {
        const aid = exercise.stop(s, ruleset);
        if (aid) spanRef.current = Math.max(spanRef.current, aid.gapM);
        paintAid(aidParts, aid, spanRef.current);
      }
      if (fig) paintFigure(fig, s, yard, ruleset, park);
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
        const text = exercise.advice(s, ruleset, centre, yard) ?? '';
        if (advice.current.textContent !== text) advice.current.textContent = text;
        advice.current.dataset.cue = exercise.cue(s, ruleset, centre, yard) ?? '';
        // One value per attribute, and only where the park has them: the pedal word the line asks for
        // and the gear it needs, so a script (and the end-to-end test) reads the same thing a learner does.
        if (park) {
          const cue = cueGhep(s, yardOfOrThrow(yard), ruleset);
          advice.current.dataset.pedal = cue.pedal;
          advice.current.dataset.gearWanted = cue.gear === 0 ? '' : String(cue.gear);
          advice.current.dataset.holdMs = String(cue.holdMs);
          if (holdEl.current && holdFill.current && holdText.current) {
            const h = holdAid(holdTimer.current, s, cue.holdMs);
            holdEl.current.dataset.state = h.state;
            holdFill.current.style.width = h.ms > 0 ? `${Math.round((1 - h.leftMs / h.ms) * 100)}%` : '0%';
            const sec = (h.leftMs / 1000).toFixed(1).replace('.', ',');
            holdText.current.textContent =
              h.state === 'idle' ? '' : h.state === 'ready' ? `Nhả côn + phanh ↓ rồi đếm ${(h.ms / 1000).toFixed(1).replace('.', ',')} giây` : h.state === 'now' ? 'Đạp côn + phanh ↓ ngay' : `Còn ${sec} giây`;
          }
        }
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
  }, [run, exercise, ruleset, rpmLimit, audio, centre]);

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

      {bai3 || road || junction ? (
        <section className="hud-hill" aria-label={bai3 ? 'Dốc' : junction ? 'Ngã tư' : 'Vạch dừng'} ref={hillEl}>
          <div className="cell" data-cell="a">
            <span className="name" data-part="label">
              Còn tới vạch
            </span>
            <strong>
              <span data-part="value">0</span> mm
            </strong>
            <small data-part="limit" />
          </div>
          {bai3 ? (
            <div className="cell" data-cell="rollback">
              <span className="name">Tụt dốc</span>
              <strong>
                <span data-part="value">0</span> mm
              </strong>
              <small data-part="limit" />
            </div>
          ) : null}
          {junction ? (
            <div className="cell" data-cell="light">
              <span className="name">Đèn</span>
              <strong>
                <span data-part="value">—</span>
              </strong>
              <small data-part="limit" />
            </div>
          ) : null}
          <div className="cell" data-cell="clock">
            <span className="name">{junction ? '20 / 30 giây' : road ? 'Vùng' : 'Thời gian'}</span>
            <strong>
              <span data-part="value">—</span>
            </strong>
            <small data-part="limit" />
          </div>
          {exercise.stops ? (
            <div className="aid" data-aid="stop" ref={aidEl} data-state="idle">
              <div className="aid-track">
                <div className="aid-fill" ref={aidFill} />
                <div className="aid-mark" ref={aidMark} />
              </div>
              <p className="aid-now">
                <span className="aid-key" ref={aidKey} />
                <span className="aid-in" ref={aidIn} />
              </p>
            </div>
          ) : null}
          <p className="advice" ref={advice} />
          {junction ? (
            <>
              <p className="aid-note" data-note="a-reading">
                {junctionOf(ruleset).a_reading_note}
              </p>
              <p className="aid-note" data-note="a-source">
                {sourceLabel(junctionOf(ruleset).max_a_source)}
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      {figure || park ? <Inset run={run} ruleset={ruleset} yard={yard} /> : null}

      {park ? (
        <section className="hud-hill hud-figure" aria-label="Ô ghép xe" ref={figureEl}>
          <div className="cell" data-cell="progress">
            <span className="name">Trong ô</span>
            <strong>
              <span data-part="value">chưa</span>
            </strong>
            <small data-part="limit" />
          </div>
          <div className="cell" data-cell="lateral">
            <span className="name">Thân xe ngoài ô</span>
            <strong>
              <span data-part="value">0</span> m
            </strong>
            <small data-part="limit" />
          </div>
          <div className="cell" data-cell="clock">
            <span className="name">Đứng yên / tín hiệu</span>
            <strong>
              <span data-part="value">—</span>
            </strong>
            <small data-part="limit" />
          </div>
          <div className="aid" data-aid="hold" ref={holdEl} data-state="idle">
            <div className="aid-track">
              <div className="aid-fill" ref={holdFill} />
            </div>
            <p className="aid-now">
              <span className="aid-key" ref={holdText} />
            </p>
          </div>
          <p className="advice" ref={advice} />
        </section>
      ) : null}

      {figure ? (
        <section className="hud-hill hud-figure" aria-label="Hình" ref={figureEl}>
          <div className="cell" data-cell="progress">
            <span className="name">Đã đi</span>
            <strong>
              <span data-part="value">0</span> m
            </strong>
            <small data-part="limit" />
          </div>
          <div className="cell" data-cell="lateral">
            <span className="name">Lệch tim đường</span>
            <strong>
              <span data-part="value">0</span> m
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
          {bai3 || figure ? null : (
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
          {legendFor(exercise.lesson, exercise.signals).map((entry) => (
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

interface FigureCell {
  value: HTMLElement;
  limit: HTMLElement;
  cell: HTMLElement;
}

/** The figure card's three cells, looked up once so the 60 Hz paint touches no selector. */
function figureParts(el: HTMLElement): Record<'progress' | 'lateral' | 'clock', FigureCell> {
  const cell = (name: string): FigureCell => {
    const c = el.querySelector<HTMLElement>(`[data-cell="${name}"]`)!;
    return { cell: c, value: c.querySelector<HTMLElement>('[data-part="value"]')!, limit: c.querySelector<HTMLElement>('[data-part="limit"]')! };
  };
  return { progress: cell('progress'), lateral: cell('lateral'), clock: cell('clock') };
}

/** Progress, lateral offset and the clock, and the four wheels' worst contact state. */
function paintFigure(
  parts: ReturnType<typeof figureParts>,
  s: SimState,
  yard: ReturnType<typeof yardOf> | null,
  ruleset: Ruleset,
  park: boolean,
) {
  if (park) {
    paintPark(parts, s, yard, ruleset);
    return;
  }
  const p = parts.progress;
  p.value.textContent = s.progressM.toFixed(1);
  p.limit.textContent = `trên ${s.courseLengthM.toFixed(1)} m`;

  const l = parts.lateral;
  l.value.textContent = s.lateralM.toFixed(2);
  l.limit.textContent = 'dương = lệch trái';
  l.cell.dataset.state = Math.abs(s.lateralM) > 0.45 ? 'bad' : Math.abs(s.lateralM) > 0.25 ? 'warn' : 'ok';

  const t = parts.clock;
  t.value.textContent = s.clockS === 0 ? '—' : `${s.clockS.toFixed(1)} s`;
  t.limit.textContent = s.clockS === 0 ? 'tính từ vạch vào hình' : s.contact.some((c) => c === 2) ? 'đã chạm bó vỉa' : s.contact.some((c) => c === 1) ? 'có bánh đè vạch' : 'chưa đè vạch';
  t.cell.dataset.state = s.contact.some((c) => c === 2) ? 'bad' : s.contact.some((c) => c === 1) ? 'warn' : 'ok';
}

/**
 * Bài 7/8's card: whether the hull is in the bay, how far the worst corner still is, and how the hold
 * to the finish signal is going. Every number comes from the core's own snapshot fields — `hullInside`
 * is the scorer's answer, and `holdTicks` is the counter the signal is given on — so the card cannot
 * congratulate a learner the exam has not credited.
 */
function paintPark(
  parts: ReturnType<typeof figureParts>,
  s: SimState,
  yard: ReturnType<typeof yardOf> | null,
  ruleset: Ruleset,
) {
  const p = parts.progress;
  p.value.textContent = s.finishSignal ? 'rồi' : s.hullInside ? 'rồi' : 'chưa';
  p.limit.textContent = s.finishSignal ? 'đã có tín hiệu báo kết thúc' : s.hullInside ? 'thân xe nằm trọn trong ô' : 'còn thân xe ngoài ô';
  p.cell.dataset.state = s.hullInside ? 'ok' : 'warn';

  const l = parts.lateral;
  const outside = yard ? hullOutside(yard, ruleset, { x: s.carX, y: s.carY, h: s.heading }) : 0;
  l.value.textContent = outside.toFixed(2);
  l.limit.textContent = s.hullInside ? 'đã vào hết' : 'lùi thêm cho hết thân xe';
  l.cell.dataset.state = outside === 0 ? 'ok' : outside > 0.6 ? 'bad' : 'warn';

  const t = parts.clock;
  const need = Math.max(1, Math.round(0.5 * 60));
  t.value.textContent = s.finishSignal ? 'đã báo' : `${Math.min(s.holdTicks, need)}/${need}`;
  t.limit.textContent = s.finishSignal
    ? 'bấm Enter để kết thúc'
    : s.hullInside
      ? 'giữ phanh cho xe đứng yên'
      : 'đứng yên trong ô mới tính';
  t.cell.dataset.state = s.finishSignal ? 'ok' : s.hullInside && s.holdTicks > 0 ? 'warn' : 'ok';
}

interface HillCell {
  cell: HTMLElement;
  label: HTMLElement | null;
  value: HTMLElement;
  limit: HTMLElement;
}

/** The cells of the stop card, looked up once so the 60 Hz paint touches no selector. */
function hillParts(el: HTMLElement): Record<'a' | 'rollback' | 'clock' | 'light', HillCell> & {
  hasRollback: boolean;
  hasLight: boolean;
} {
  const cell = (name: string): HillCell => {
    const c = el.querySelector<HTMLElement>(`[data-cell="${name}"]`)!;
    return {
      cell: c,
      label: c.querySelector<HTMLElement>('[data-part="label"]'),
      value: c.querySelector<HTMLElement>('[data-part="value"]')!,
      limit: c.querySelector<HTMLElement>('[data-part="limit"]')!,
    };
  };
  const hasRollback = el.querySelector('[data-cell="rollback"]') !== null;
  const hasLight = el.querySelector('[data-cell="light"]') !== null;
  return {
    a: cell('a'),
    rollback: hasRollback ? cell('rollback') : (null as unknown as HillCell),
    clock: cell('clock'),
    light: hasLight ? cell('light') : (null as unknown as HillCell),
    hasRollback,
    hasLight,
  };
}

/**
 * The stop card: A (live, then the recorded one), and either the slope's rollback and 30 s clock
 * (bài 3) or the band of the scene the bumper is in (the road lessons), plus the stop aid's bar where
 * the exercise has one. Every number is the core's own field, so the card cannot invent a gap.
 */
function paintHill(parts: ReturnType<typeof hillParts>, s: SimState, ruleset: Ruleset, lesson: Lesson) {
  const maxA = lesson === 3 ? hillOf(ruleset).max_a_m : roadOf(ruleset).max_a_m;
  const stopped = s.sinceStopTicks >= 0;
  const a = parts.a;
  const gap = stopped ? s.stopGapAM : s.lineGapM;
  if (a.label) a.label.textContent = stopped ? 'A lúc dừng' : s.lineGapM < 0 ? 'Quá vạch' : 'Còn tới vạch';
  a.value.textContent = mm(gap);
  a.limit.textContent = `không quá ${mm(maxA)} mm`;
  a.cell.dataset.state = gap >= 0 && gap <= maxA ? 'ok' : stopped ? 'bad' : 'neutral';

  if (parts.hasRollback) {
    const maxRollback = hillOf(ruleset).max_rollback_m;
    const r = parts.rollback;
    r.value.textContent = mm(s.rollbackM);
    r.limit.textContent = `không quá ${mm(maxRollback)} mm`;
    r.cell.dataset.state = s.rollbackM > maxRollback ? 'bad' : s.rollbackM > 0 ? 'warn' : 'neutral';
  }

  if (parts.hasLight) paintLight(parts.light, s);

  const t = parts.clock;
  if (lesson === 5) {
    // The 20 s and 30 s clocks run from the light turning green and stop when the bumper clears the
    // junction; both are the core's own field 48, so the number here is the number it charges on.
    const seconds = s.clockMs / 1000;
    t.value.textContent = s.clockMs === 0 ? '—' : `${seconds.toFixed(1)} s`;
    const over20 = seconds > 20;
    t.limit.textContent = s.clockMs === 0 ? 'tính từ lúc đèn xanh' : over20 ? 'đã quá 20 giây' : 'còn tới 20 giây';
    t.cell.dataset.state = s.clockMs === 0 ? 'neutral' : seconds > 30 ? 'bad' : over20 ? 'warn' : 'ok';
  } else if (lesson === 3) {
    const left = secondsLeft(s, ruleset);
    t.value.textContent = left === null ? '—' : `${Math.ceil(left)} s`;
    t.limit.textContent = left === null ? 'tính từ lúc dừng xe' : 'để qua vạch';
    t.cell.dataset.state = left === null ? 'neutral' : left < 10 ? 'warn' : 'ok';
  } else {
    // The road lessons: which band the bumper is in. This is the same code the page publishes as
    // data-zone, so what the card says and what a script reads are one value.
    const zone = zoneName(s.zone);
    t.value.textContent = ZONE_LABEL[zone];
    t.limit.textContent = ZONE_HINT[zone];
    t.cell.dataset.state = s.zone === 3 || s.zone === 5 ? 'ok' : s.zone === 4 || s.zone === 2 ? 'warn' : 'neutral';
  }
}

/**
 * The signal head's state, in words and in colour. The name is the core's own field 46; the lamp is
 * dark until the car first moves, which is the core's rule and so the page's too.
 */
function paintLight(cell: HillCell, s: SimState) {
  const name = lightName(s.lightColour);
  cell.value.textContent = LIGHT_LABEL[name];
  cell.limit.textContent = s.lightColour === 0 ? 'chưa bật' : `${Math.ceil(s.lightLeftMs / 1000)} s nữa`;
  cell.cell.dataset.state = name === 'green' ? 'ok' : name === 'red' ? 'bad' : name === 'yellow' ? 'warn' : 'neutral';
}

/** The lamps, as a learner reads them. */
const LIGHT_LABEL: Record<LightName, string> = {
  none: '—',
  red: 'Đỏ',
  yellow: 'Vàng',
  green: 'Xanh',
};

/**
 * The zone names and what each one means for the learner, in the order of snapshot field 49. The
 * short names are what a script reads as `data-zone`; these are the words on the card.
 */
const ZONE_LABEL: Record<ZoneName, string> = {
  start: 'Xuất phát',
  approach: 'Tới vạch',
  'stop-zone': 'Vùng dừng',
  'at-line': 'Đúng vạch',
  'past-line': 'Qua vạch',
  'at-crossing': 'Tới vạch qua đường',
  'in-junction': 'Trong ngã tư',
  'exit-lane': 'Ra khỏi ngã tư',
  'past-finish': 'Qua vạch kết thúc',
};

const ZONE_HINT: Record<ZoneName, string> = {
  start: 'còn xa vạch dừng',
  approach: 'chưa tới vùng dừng',
  'stop-zone': 'dừng được trong vùng này',
  'at-line': 'dừng ngay đây',
  'past-line': 'đã qua vạch dừng',
  'at-crossing': 'vạch qua đường / đường sắt',
  'in-junction': 'đang trong ngã tư',
  'exit-lane': 'đang ra',
  'past-finish': 'hết bài',
};

/** The aid bar's parts, looked up once so the 60 Hz paint touches no selector. */
interface AidParts {
  el: HTMLElement;
  fill: HTMLElement;
  mark: HTMLElement;
  key: HTMLElement;
  inn: HTMLElement;
}

/**
 * The stop aid, as something to time against rather than a number to read: a bar that shrinks as the
 * key comes due, with a marker for where the key should land. The bar is the gap from the bumper to
 * the line, drawn against the widest gap the aid has ever been shown at, and the marker sits at the
 * mark's gap — so the fill reaches the marker exactly when the countdown reaches zero, and both keep
 * moving as the car does. A learner times the crossing, not a number.
 *
 * It is deliberately the same simple HUD vocabulary as the rest: a track, a fill and a mark, no art.
 */
function paintAid(parts: AidParts, aid: ReturnType<Exercise['stop']>, widest: number) {
  if (!aid) {
    parts.el.dataset.state = 'idle';
    parts.fill.style.width = '0%';
    parts.mark.style.left = '0%';
    parts.key.textContent = '';
    parts.inn.textContent = '';
    return;
  }
  const span = Math.max(widest, aid.gapM);
  const fillPct = Math.max(0, Math.min(100, (aid.gapM / span) * 100));
  const markPct = Math.max(0, Math.min(100, (aid.markM / span) * 100));
  // The words turn to "bấm ngay" a reaction before the bar meets its mark, so both a learner reading
  // the sentence and one watching the bar stop at the same place.
  parts.el.dataset.state = aid.now ? 'now' : 'counting';
  parts.el.dataset.key = aid.key;
  parts.fill.style.width = `${fillPct}%`;
  parts.mark.style.left = `${markPct}%`;
  parts.key.textContent = aid.key === 'clutch' ? 'Côn' : 'Côn + phanh';
  parts.inn.textContent = aid.now ? '— bấm ngay' : `— còn ${(aid.etaMs / 1000).toFixed(1)} s`;
}

function phaseLabel(phase: string, disqualified: boolean, lesson: Lesson): string {
  if (disqualified) return 'đình chỉ';
  switch (phase) {
    case 'waiting':
      return 'chờ lệnh';
    case 'launched':
      return lesson === 3 ? 'lên dốc' : lesson === 4 || lesson === 6 ? 'trong hình' : lesson === 2 || lesson === 9 || lesson === 11 ? 'tới vạch' : 'đã có lệnh';
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
