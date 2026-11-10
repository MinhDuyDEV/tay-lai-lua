'use client';
// The HUD: DOM, not three. Numbers are written straight onto refs from the run's frame hook, so the
// 60 Hz loop never causes a React render. Only two rare things are React state — the penalty feed
// and the result overlay — because they change a handful of times per run.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { legendFor } from '../input/driver.ts';
import type { Exercise, Lesson } from './exercise.ts';
import type { Ruleset } from './ruleset.ts';
import { gearOf, gearSignM, hillOf, junctionOf, roadOf, sourceLabel } from './ruleset.ts';
import type { Penalty } from './ruleset.ts';
import type { Run } from './run.ts';
import Inset from './Inset.tsx';
import { cueGhep, holdAid, hullOutside, newHoldTimer, yardOf, type HoldTimer } from './ghep.ts';
import { gearAutomaticNote } from './gear.ts';
import { lightName, zoneName, type LightName, type SimState, type ZoneName } from './sim/session.ts';
import { clockText } from './lien-hoan/Result.tsx';
import { secondsLeft } from './steps.ts';

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
  /** True in a sa hình liên hoàn run: the score card then carries the run's clock and the pass mark. */
  lienHoan?: boolean;
}

function audioLabel(state: ReturnType<HudProps['audio']>) {
  return state === 'running' ? 'Âm thanh: sẵn sàng' : state === 'failed' ? 'Âm thanh: không mở được' : 'Âm thanh: chờ';
}

/** Pedal and steer bars show what the core consumed, not what a key is doing. */
function bar(value: number, max = 1) {
  return `${(Math.max(0, Math.min(1, value / max)) * 100).toFixed(1)}%`;
}

// The HUD is painted 60 times a second, and almost every frame almost nothing has changed. These three
// write only when the value is new, so a still car costs the browser no layout and no style work.

/** Set an element's text, if it is not already that. */
function put(el: HTMLElement | null, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Set a `data-*` attribute, if it is not already that. */
function mark(el: HTMLElement | null, name: string, value: string) {
  if (el && el.dataset[name] !== value) el.dataset[name] = value;
}

const lastStyle = new WeakMap<HTMLElement, Map<string, string>>();

/** Set one inline style property, if it is not already that. */
function style(el: HTMLElement | null, name: 'width' | 'height' | 'left', value: string) {
  if (!el) return;
  let seen = lastStyle.get(el);
  if (!seen) lastStyle.set(el, (seen = new Map()));
  if (seen.get(name) === value) return;
  seen.set(name, value);
  el.style[name] = value;
}

export default function Hud({ run, exercise, ruleset, penalties, rpmLimit, audio, glOk, lienHoan = false }: HudProps) {
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
  const stepCount = useRef<HTMLSpanElement>(null);
  const nextEl = useRef<HTMLParagraphElement>(null);
  const lampsEl = useRef<HTMLDivElement>(null);
  const runClock = useRef<HTMLSpanElement>(null);
  const audioEl = useRef<HTMLParagraphElement>(null);
  const hillEl = useRef<HTMLElement>(null);
  const hazardEl = useRef<HTMLParagraphElement>(null);
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
  /** The figure's centreline, read from the core; a liên hoàn run replaces it when the bài changes. */
  const centre = useMemo(() => run.course.find((r) => r.kind === 5)?.points ?? [], [run, run.course]);
  /** Bài 7/8: the area and the bay, read once from the core's own course. */
  const yard = useMemo(() => exercise.park?.(run.course) ?? null, [run, run.course, exercise]);
  const bai3 = exercise.lesson === 3;
  /** The link between bài 6 and bài 7: no per-bài card, one hazard lamp and the advice line. */
  const link = exercise.link === true;
  /** Bài 2, 9 and 11: one straight road, a stop line, and one thing past it. */
  const road = !link && (exercise.lesson === 2 || exercise.lesson === 9 || exercise.lesson === 11);
  /** Bài 5: the signalled junction. It shares the road card, and adds the light and the 20/30 s clock. */
  const junction = !link && exercise.lesson === 5;
  const figure = !link && (exercise.lesson === 4 || exercise.lesson === 6);
  /** Bài 7 and bài 8: the bay card, the hold counter and the top-down inset of the yard. */
  const park = !link && (exercise.lesson === 7 || exercise.lesson === 8);
  /** Bài 10: the three signs and the two zones, and the one speed both zones are judged at. */
  const gearLesson = !link && exercise.lesson === 10;
  /** Bài 1 has no advice line of its own, so its card is the checklist's next step, said large. */
  const stepsOnly = !(bai3 || road || junction || figure || park || gearLesson || link);
  const figureEl = useRef<HTMLElement>(null);
  const gearEl = useRef<HTMLElement>(null);
  /** Bài 10 on an automatic: the note the ruleset carries, or a page that says why it has none. */
  const gearNote = gearLesson && exercise.automatic ? gearAutomaticNote(ruleset) : null;
  const newest = penalties.at(-1);

  useEffect(() => {
    const hill = hillEl.current ? hillParts(hillEl.current) : null;
    const aidParts = aidEl.current
      ? { el: aidEl.current, fill: aidFill.current!, mark: aidMark.current!, key: aidKey.current!, inn: aidIn.current! }
      : null;
    const fig = figureEl.current ? figureParts(figureEl.current) : null;
    const gearParts = gearEl.current ? gearCardParts(gearEl.current) : null;
    const lamps = lampsEl.current ? lampParts(lampsEl.current) : null;
    const next = nextEl.current
      ? { el: nextEl.current, label: nextEl.current.querySelector<HTMLElement>('[data-part="label"]')!, key: nextEl.current.querySelector<HTMLElement>('[data-part="key"]')! }
      : null;
    const stop = run.onFrame(() => {
      const s = run.state;
      put(speed.current, (s.speedMps * 3.6).toFixed(1));
      put(rpm.current, Math.round(s.rpm).toString());
      style(rpmBar.current, 'width', bar(s.rpm, rpmLimit * 1.15));
      mark(rpmBar.current, 'over', s.rpm > rpmLimit ? 'yes' : 'no');
      put(gear.current, s.gear === 0 ? 'N' : s.gear === -1 ? 'R' : String(s.gear));
      put(bumper.current, s.frontBumperM.toFixed(2));
      if (hill) paintHill(hill, s, ruleset, exercise.lesson);
      if (hazardEl.current) {
        const h = s.hazard;
        mark(hazardEl.current, 'state', h === 1 ? 'on' : h === 2 ? 'ended' : h === 3 ? 'over' : 'off');
        put(
          hazardEl.current,
          h === 1
            ? '⚠ NGUY HIỂM — phanh dừng xe và bật tín hiệu H'
            : h === 2
              ? 'Tín hiệu đã kết thúc — tắt H rồi đi tiếp'
              : h === 3
                ? 'Đã xử lý tình huống'
                : 'Đoạn nối giữa bài 6 và bài 7',
        );
      }
      if (aidParts) {
        const aid = exercise.stop(s, ruleset);
        if (aid) spanRef.current = Math.max(spanRef.current, aid.gapM);
        paintAid(aidParts, aid, spanRef.current, exercise.automatic);
      }
      if (fig) paintFigure(fig, s, yard, ruleset, park);
      if (gearParts) paintGearCard(gearParts, s, ruleset);
      if (lamps) paintLamps(lamps, s);
      put(score.current, s.disqualified ? 'Đình chỉ' : String(s.score));
      mark(score.current, 'state', s.disqualified ? 'out' : s.score < ruleset.scoring.base ? 'cut' : 'full');
      put(runClock.current, clockText(s.courseTick));
      put(phase.current, phaseLabel(s.phase, s.disqualified, exercise.lesson));
      style(throttle.current, 'height', bar(s.throttle));
      style(brake.current, 'height', bar(s.brake));
      style(clutch.current, 'height', bar(s.clutch));
      // Centred bar: steer is -1..1 of full lock, and positive is a left turn (the core's yaw is
      // counter-clockwise), so the mark goes left when the wheel does.
      const lock = s.steerRad / ruleset.vehicle.max_steer_rad;
      style(steer.current, 'left', `${(50 - Math.min(50, Math.max(-50, lock * 50))).toFixed(1)}%`);
      put(steerLabel.current, Math.abs(lock) < 0.005 ? 'thẳng' : `${lock > 0 ? 'trái' : 'phải'} ${Math.round(Math.abs(lock) * 100)}%`);
      if (hint.current) {
        const text = run.driver.hint ?? '';
        put(hint.current, text);
        mark(hint.current, 'on', text === '' ? 'no' : 'yes');
      }
      if (advice.current) {
        const text = exercise.advice(s, ruleset, centre, yard) ?? '';
        put(advice.current, text);
        mark(advice.current, 'cue', exercise.cue(s, ruleset, centre, yard) ?? '');
        // One value per attribute, and only where the park has them: the pedal word the line asks for
        // and the gear it needs, so a script (and the end-to-end test) reads the same thing a learner does.
        if (park) {
          const cue = cueGhep(s, yardOfOrThrow(yard), ruleset);
          mark(advice.current, 'pedal', cue.pedal);
          mark(advice.current, 'gearWanted', cue.gear === 0 ? '' : String(cue.gear));
          mark(advice.current, 'holdMs', String(cue.holdMs));
          if (holdEl.current && holdFill.current && holdText.current) {
            const h = holdAid(holdTimer.current, s, cue.holdMs);
            mark(holdEl.current, 'state', h.state);
            style(holdFill.current, 'width', h.ms > 0 ? `${Math.round((1 - h.leftMs / h.ms) * 100)}%` : '0%');
            const sec = (h.leftMs / 1000).toFixed(1).replace('.', ',');
            put(
              holdText.current,
              h.state === 'idle'
                ? ''
                : h.state === 'ready'
                  ? exercise.automatic
                    ? `Nhả phanh ↓ rồi đếm ${(h.ms / 1000).toFixed(1).replace('.', ',')} giây`
                    : `Nhả côn + phanh ↓ rồi đếm ${(h.ms / 1000).toFixed(1).replace('.', ',')} giây`
                  : h.state === 'now'
                    ? exercise.automatic
                      ? 'Phanh ↓ ngay'
                      : 'Đạp côn + phanh ↓ ngay'
                    : `Còn ${sec} giây`,
            );
          }
        }
      }
      if (audioEl.current) {
        const now = audio();
        mark(audioEl.current, 'audio', now);
        put(audioEl.current, audioLabel(now));
      }
      // The checklist: what is done, and the step to do now. While the car stands still that is the
      // first step not done, because anything before the car moves can still be put right. Once it
      // rolls, a step left behind is behind for good: the step to do now is the next one after the
      // last thing done, and the ones skipped on the way are marked as missed instead.
      const steps = exercise.steps;
      let doneCount = 0;
      let lastDone = -1;
      steps.forEach((step, i) => {
        if (!run.stepsDone.has(step.id)) return;
        doneCount += 1;
        lastDone = i;
      });
      const over = s.phase === 'done' || s.disqualified;
      const rolling = Math.abs(s.speedMps) > 0.05;
      const ahead = rolling ? steps.findIndex((step, i) => i > lastDone && !run.stepsDone.has(step.id)) : -1;
      const at = over ? -1 : ahead >= 0 ? ahead : steps.findIndex((step) => !run.stepsDone.has(step.id));
      const current = at >= 0 ? steps[at].id : null;
      steps.forEach((step, i) => {
        const el = stepEls.current.get(step.id);
        if (!el) return;
        const isDone = run.stepsDone.has(step.id);
        mark(el, 'done', isDone ? 'yes' : 'no');
        mark(el, 'current', i === at ? 'yes' : 'no');
        mark(el, 'missed', !isDone && i < lastDone && i !== at ? 'yes' : 'no');
      });
      put(stepCount.current, `${doneCount}/${steps.length}`);
      if (next) {
        const step = steps.find((st) => st.id === current);
        mark(next.el, 'state', step ? 'todo' : 'clear');
        put(next.label, step ? step.label : over ? 'Hết bài' : 'Đã xong các bước');
        put(next.key, step ? step.key : '');
      }
    });
    return stop;
  }, [run, exercise, ruleset, rpmLimit, audio, centre, yard, park]);

  return (
    <div className="hud" data-card={stepsOnly ? 'next' : 'advice'}>
      <div className="hud-left">
        <section className="hud-steps" aria-label="Trình tự">
          <header>
            <h2>Trình tự</h2>
            <span className="count" ref={stepCount}>
              0/{exercise.steps.length}
            </span>
          </header>
          <ol>
            {exercise.steps.map((step) => (
              <li
                key={step.id}
                data-step={step.id}
                data-done="no"
                data-current="no"
                data-missed="no"
                ref={(el) => {
                  if (el) stepEls.current.set(step.id, el);
                  else stepEls.current.delete(step.id);
                }}
              >
                <span className="label">{step.label}</span>
                <span className="key">{step.key}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="hud-keys" aria-label="Phím">
          <h2>Bảng phím</h2>
          <ul>
            {legendFor(exercise.lesson, exercise.signals, exercise.automatic, link).map((entry) => (
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
      </div>

      {stepsOnly ? (
        <section className="hud-hill hud-next" aria-label="Bước tiếp theo">
          <p className="next" ref={nextEl} data-state="todo">
            <span className="next-name">Bước tiếp theo</span>
            <span className="next-label" data-part="label" />
            <span className="key" data-part="key" />
          </p>
        </section>
      ) : null}

      {bai3 || road || junction ? (
        <section className="hud-hill" aria-label={bai3 ? 'Dốc' : junction ? 'Ngã tư' : 'Vạch dừng'} ref={hillEl}>
          <p className="advice" ref={advice} />
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
          {junction ? (
            // The two readings of A are a footnote, not an instruction: closed until asked for. The
            // summary gives the focus back, like every other control on the page, so Space stays the clutch.
            <details className="aid-note">
              <summary onClick={(event) => event.currentTarget.blur()}>Vì sao A không quá {mm(junctionOf(ruleset).max_a_m)} mm?</summary>
              <p data-note="a-reading">{junctionOf(ruleset).a_reading_note}</p>
              <p data-note="a-source">{sourceLabel(junctionOf(ruleset).max_a_source)}</p>
            </details>
          ) : null}
        </section>
      ) : null}

      {link ? (
        <section className="hud-hill hud-link" aria-label="Đoạn nối">
          <p className="hazard-lamp" ref={hazardEl} data-state="off">
            Đoạn nối giữa bài 6 và bài 7
          </p>
          <p className="advice" ref={advice} />
          <p className="aid-note" data-note="link">
            Đoạn nối là đường thật: đi thẳng tới vạch kết thúc. Tình huống nguy hiểm phải phanh dừng và bật tín hiệu H.
          </p>
        </section>
      ) : null}

      {figure || park ? <Inset run={run} ruleset={ruleset} yard={yard} /> : null}

      {park ? (
        <section className="hud-hill hud-figure" aria-label="Ô ghép xe" ref={figureEl}>
          <p className="advice" ref={advice} />
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
        </section>
      ) : null}

      {figure ? (
        <section className="hud-hill hud-figure" aria-label="Hình" ref={figureEl}>
          <p className="advice" ref={advice} />
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
        </section>
      ) : null}

      {gearLesson ? (
        <section className="hud-hill hud-gear" aria-label="Thay đổi số" ref={gearEl}>
          <p className="advice" ref={advice} />
          <div className="cell" data-cell="sign">
            <span className="name" data-part="label">
              Tới biển
            </span>
            <strong>
              <span data-part="value">—</span> m
            </strong>
            <small data-part="limit" />
          </div>
          <div className="cell" data-cell="speed">
            <span className="name">Tốc độ chấm</span>
            <strong>{Math.round(gearOf(ruleset).speed_kmh)} km/h</strong>
            <small>trên ở biển 2, dưới ở biển 3</small>
          </div>
          <div className="cell" data-cell="gearnow">
            <span className="name">Số đang dùng</span>
            <strong>
              <span data-part="value">N</span>
            </strong>
            <small>{exercise.automatic ? 'hộp số tự động' : 'số 1, rồi số 2, rồi số 1'}</small>
          </div>
          {gearNote ? (
            // The reading behind the automatic's scoring is a footnote: closed until asked for.
            <details className="aid-note">
              <summary onClick={(event) => event.currentTarget.blur()}>Số tự động: bài này chỉ chấm tốc độ — vì sao?</summary>
              <p data-note="gear-automatic">
                {gearNote.value} {gearNote.why}
              </p>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* The newest fault, said once in the middle of the view: a learner watching the road does not
          see the panel on the right. Keyed by the fault, so each one plays its own fade. */}
      {newest ? (
        <p className="fault-toast" key={`${newest.tick}-${newest.id}-${penalties.length}`} role="status">
          <strong>{newest.disqualify ? 'Đình chỉ' : `−${newest.points} điểm`}</strong>
          <span>{newest.source.quote}</span>
        </p>
      ) : null}

      {/* Why the last key press did nothing, next to the pedals the learner is looking at. */}
      <p className="hint" ref={hint} data-on="no" role="status" />

      <section className="hud-drive" aria-label="Xe">
        <div className="lamps" ref={lampsEl} aria-label="Trạng thái xe">
          <span className="lamp" data-lamp="engine" data-on="no">
            Máy
          </span>
          <span className="lamp" data-lamp="belt" data-on="no">
            Dây an toàn
          </span>
          <span className="lamp" data-lamp="handbrake" data-on="no">
            Phanh tay
          </span>
          <span className="lamp" data-lamp="left" data-on="no" aria-label="Xi nhan trái">
            ◀
          </span>
          <span className="lamp" data-lamp="right" data-on="no" aria-label="Xi nhan phải">
            ▶
          </span>
          {link ? (
            <span className="lamp" data-lamp="hazard" data-on="no">
              Nguy hiểm
            </span>
          ) : null}
        </div>

        <div className="dash">
          <div className="pedals">
            {/* An automatic has two pedals: the snapshot's clutch is the converter's slip, not something
                the learner can press, so it is not drawn as one. The order is the car's own, left to right. */}
            {exercise.automatic ? null : (
              <div className="pedal">
                <div className="track">
                  <div className="fill" ref={clutch} data-pedal="clutch" />
                </div>
                <span>Côn</span>
              </div>
            )}
            <div className="pedal">
              <div className="track">
                <div className="fill" ref={brake} data-pedal="brake" />
              </div>
              <span>Phanh</span>
            </div>
            <div className="pedal">
              <div className="track">
                <div className="fill" ref={throttle} data-pedal="throttle" />
              </div>
              <span>Ga</span>
            </div>
          </div>

          <div className="dial" data-dial="speed">
            <strong ref={speed}>0.0</strong>
            <small>km/h</small>
          </div>

          <div className="dial" data-dial="gear">
            <strong ref={gear}>N</strong>
            <small>Số</small>
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
              <dt>Vô lăng</dt>
              <dd>
                <span ref={steerLabel}>thẳng</span>
                <div className="steer-track">
                  <div className="steer-mark" ref={steer} />
                </div>
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
              <dt>Giai đoạn</dt>
              <dd>
                <span ref={phase}>chờ lệnh</span>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="hud-penalties" aria-label="Điểm và lỗi">
        <div className="scorebox">
          <span className="score" ref={score} data-state="full">
            {ruleset.scoring.base}
          </span>
          <span className="score-of">
            điểm
            {lienHoan ? <small>đạt từ {ruleset.scoring.pass}</small> : null}
          </span>
          {lienHoan ? (
            <span className="run-clock">
              <span ref={runClock}>00:00</span>
              <small>thời gian lượt</small>
            </span>
          ) : null}
        </div>
        <h2>
          Lỗi
          {penalties.length > 0 ? <span className="count">{penalties.length}</span> : null}
        </h2>
        {penalties.length === 0 ? (
          <p className="none">Chưa có lỗi. Lỗi nào xảy ra sẽ hiện ở đây, kèm điểm trừ và câu luật.</p>
        ) : (
          <ul>
            {/* Newest first: the fault that has just happened is the one to read. */}
            {penalties
              .map((p, i) => ({ p, i }))
              .reverse()
              .map(({ p, i }) => (
                <li key={`${p.tick}-${p.id}-${i}`} data-penalty={p.id} data-out={p.disqualify ? 'yes' : 'no'}>
                  <p className="rule">
                    <span className="points">{p.disqualify ? 'Đình chỉ' : `−${p.points} điểm`}</span>
                    <code>{p.id}</code>
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

      {!glOk && <p className="gl-warning">Không vẽ được 3D (WebGL lỗi). Bài thi vẫn chạy bình thường.</p>}
    </div>
  );
}

interface LampParts {
  engine: HTMLElement;
  belt: HTMLElement;
  handbrake: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  hazard: HTMLElement | null;
}

/** The dashboard lamps, looked up once so the 60 Hz paint touches no selector. */
function lampParts(el: HTMLElement): LampParts {
  const lamp = (name: string) => el.querySelector<HTMLElement>(`[data-lamp="${name}"]`);
  return {
    engine: lamp('engine')!,
    belt: lamp('belt')!,
    handbrake: lamp('handbrake')!,
    left: lamp('left')!,
    right: lamp('right')!,
    hazard: lamp('hazard'),
  };
}

/**
 * The lamps a real dashboard has, from the core's own fields: what the car's switches are, not what
 * the learner last pressed. A learner who cannot tell whether the belt or the handbrake is on has no
 * way to know why the car will not move.
 */
function paintLamps(parts: LampParts, s: SimState) {
  mark(parts.engine, 'on', s.engineOn ? 'yes' : 'no');
  mark(parts.belt, 'on', s.belt ? 'yes' : 'no');
  mark(parts.handbrake, 'on', s.handbrake ? 'yes' : 'no');
  mark(parts.left, 'on', s.signal === 'left' ? 'yes' : 'no');
  mark(parts.right, 'on', s.signal === 'right' ? 'yes' : 'no');
  mark(parts.hazard, 'on', s.hazardButton ? 'yes' : 'no');
}

const mm = (m: number) => String(Math.round(m * 1000));

interface FigureCell {
  value: HTMLElement;
  limit: HTMLElement;
  cell: HTMLElement;
}

/** The bài 10 card's two live cells: the next sign ahead, and the gear the core has. */
function gearCardParts(el: HTMLElement): { sign: FigureCell; gearnow: HTMLElement } {
  const cell = (name: string): FigureCell => {
    const c = el.querySelector<HTMLElement>(`[data-cell="${name}"]`)!;
    return { cell: c, value: c.querySelector<HTMLElement>('[data-part="value"]')!, limit: c.querySelector<HTMLElement>('[data-part="limit"]')! };
  };
  return { sign: cell('sign'), gearnow: el.querySelector<HTMLElement>('[data-cell="gearnow"] [data-part="value"]')! };
}

/**
 * Bài 10's card: how far to the next sign the exercise is judged at, and the gear the core has. The sign
 * is the next one *ahead of the bumper*, from the ruleset's own positions, so the number counts down to the
 * same crossing the core judges on. The judged speed is fixed by the ruleset and written once in the JSX.
 */
function paintGearCard(parts: ReturnType<typeof gearCardParts>, s: SimState, ruleset: Ruleset) {
  const gear = gearOf(ruleset);
  const signs = [gearSignM(gear, 0), gearSignM(gear, 1), gearSignM(gear, 2)];
  const next = signs.find((m) => s.frontBumperM < m);
  const sign = parts.sign;
  if (next === undefined) {
    put(sign.value, '—');
    put(sign.limit, 'đã qua biển thứ ba');
    mark(sign.cell, 'state', 'neutral');
  } else {
    put(sign.value, Math.max(0, next - s.frontBumperM).toFixed(0));
    put(sign.limit, `biển ${signs.indexOf(next) + 1} (${next} m)`);
    mark(sign.cell, 'state', next - s.frontBumperM < 10 ? 'warn' : 'neutral');
  }
  put(parts.gearnow, s.gear === 0 ? 'N' : s.gear === -1 ? 'R' : String(s.gear));
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
  put(p.value, s.progressM.toFixed(1));
  put(p.limit, `trên ${s.courseLengthM.toFixed(1)} m`);

  const l = parts.lateral;
  put(l.value, s.lateralM.toFixed(2));
  put(l.limit, 'dương = lệch trái');
  mark(l.cell, 'state', Math.abs(s.lateralM) > 0.45 ? 'bad' : Math.abs(s.lateralM) > 0.25 ? 'warn' : 'ok');

  const t = parts.clock;
  put(t.value, s.clockS === 0 ? '—' : `${s.clockS.toFixed(1)} s`);
  put(t.limit, s.clockS === 0 ? 'tính từ vạch vào hình' : s.contact.some((c) => c === 2) ? 'đã chạm bó vỉa' : s.contact.some((c) => c === 1) ? 'có bánh đè vạch' : 'chưa đè vạch');
  mark(t.cell, 'state', s.contact.some((c) => c === 2) ? 'bad' : s.contact.some((c) => c === 1) ? 'warn' : 'ok');
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
  put(p.value, s.finishSignal ? 'rồi' : s.hullInside ? 'rồi' : 'chưa');
  put(p.limit, s.finishSignal ? 'đã có tín hiệu báo kết thúc' : s.hullInside ? 'thân xe nằm trọn trong ô' : 'còn thân xe ngoài ô');
  mark(p.cell, 'state', s.hullInside ? 'ok' : 'warn');

  const l = parts.lateral;
  const outside = yard ? hullOutside(yard, ruleset, { x: s.carX, y: s.carY, h: s.heading }) : 0;
  put(l.value, outside.toFixed(2));
  put(l.limit, s.hullInside ? 'đã vào hết' : 'lùi thêm cho hết thân xe');
  mark(l.cell, 'state', outside === 0 ? 'ok' : outside > 0.6 ? 'bad' : 'warn');

  const t = parts.clock;
  const need = Math.max(1, Math.round(0.5 * 60));
  put(t.value, s.finishSignal ? 'đã báo' : `${Math.min(s.holdTicks, need)}/${need}`);
  put(
    t.limit,
    s.finishSignal ? 'bấm Enter để kết thúc' : s.hullInside ? 'giữ phanh cho xe đứng yên' : 'đứng yên trong ô mới tính',
  );
  mark(t.cell, 'state', s.finishSignal ? 'ok' : s.hullInside && s.holdTicks > 0 ? 'warn' : 'ok');
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
  put(a.label, stopped ? 'A lúc dừng' : s.lineGapM < 0 ? 'Quá vạch' : 'Còn tới vạch');
  put(a.value, mm(gap));
  put(a.limit, `không quá ${mm(maxA)} mm`);
  mark(a.cell, 'state', gap >= 0 && gap <= maxA ? 'ok' : stopped ? 'bad' : 'neutral');

  if (parts.hasRollback) {
    const maxRollback = hillOf(ruleset).max_rollback_m;
    const r = parts.rollback;
    put(r.value, mm(s.rollbackM));
    put(r.limit, `không quá ${mm(maxRollback)} mm`);
    mark(r.cell, 'state', s.rollbackM > maxRollback ? 'bad' : s.rollbackM > 0 ? 'warn' : 'neutral');
  }

  if (parts.hasLight) paintLight(parts.light, s);

  const t = parts.clock;
  if (lesson === 5) {
    // The 20 s and 30 s clocks run from the light turning green and stop when the bumper clears the
    // junction; both are the core's own field 48, so the number here is the number it charges on.
    const seconds = s.clockMs / 1000;
    put(t.value, s.clockMs === 0 ? '—' : `${seconds.toFixed(1)} s`);
    const over20 = seconds > 20;
    put(t.limit, s.clockMs === 0 ? 'tính từ lúc đèn xanh' : over20 ? 'đã quá 20 giây' : 'còn tới 20 giây');
    mark(t.cell, 'state', s.clockMs === 0 ? 'neutral' : seconds > 30 ? 'bad' : over20 ? 'warn' : 'ok');
  } else if (lesson === 3) {
    const left = secondsLeft(s, ruleset);
    put(t.value, left === null ? '—' : `${Math.ceil(left)} s`);
    put(t.limit, left === null ? 'tính từ lúc dừng xe' : 'để qua vạch');
    mark(t.cell, 'state', left === null ? 'neutral' : left < 10 ? 'warn' : 'ok');
  } else {
    // The road lessons: which band the bumper is in. This is the same code the page publishes as
    // data-zone, so what the card says and what a script reads are one value.
    const zone = zoneName(s.zone);
    put(t.value, ZONE_LABEL[zone]);
    put(t.limit, ZONE_HINT[zone]);
    mark(t.cell, 'state', s.zone === 3 || s.zone === 5 ? 'ok' : s.zone === 4 || s.zone === 2 ? 'warn' : 'neutral');
  }
}

/**
 * The signal head's state, in words and in colour. The name is the core's own field 46; the lamp is
 * dark until the car first moves, which is the core's rule and so the page's too.
 */
function paintLight(cell: HillCell, s: SimState) {
  const name = lightName(s.lightColour);
  put(cell.value, LIGHT_LABEL[name]);
  put(cell.limit, s.lightColour === 0 ? 'chưa bật' : `${Math.ceil(s.lightLeftMs / 1000)} s nữa`);
  mark(cell.cell, 'state', name === 'green' ? 'ok' : name === 'red' ? 'bad' : name === 'yellow' ? 'warn' : 'neutral');
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
function paintAid(parts: AidParts, aid: ReturnType<Exercise['stop']>, widest: number, automatic: boolean) {
  if (!aid) {
    mark(parts.el, 'state', 'idle');
    style(parts.fill, 'width', '0%');
    style(parts.mark, 'left', '0%');
    put(parts.key, '');
    put(parts.inn, '');
    return;
  }
  const span = Math.max(widest, aid.gapM);
  const fillPct = Math.max(0, Math.min(100, (aid.gapM / span) * 100));
  const markPct = Math.max(0, Math.min(100, (aid.markM / span) * 100));
  // The words turn to "bấm ngay" a reaction before the bar meets its mark, so both a learner reading
  // the sentence and one watching the bar stop at the same place.
  mark(parts.el, 'state', aid.now ? 'now' : 'counting');
  mark(parts.el, 'key', aid.key);
  style(parts.fill, 'width', `${fillPct}%`);
  style(parts.mark, 'left', `${markPct}%`);
  put(parts.key, automatic ? 'Phanh ↓' : aid.key === 'clutch' ? 'Côn' : 'Côn + phanh');
  put(parts.inn, aid.now ? '— bấm ngay' : `— còn ${(aid.etaMs / 1000).toFixed(1)} s`);
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
