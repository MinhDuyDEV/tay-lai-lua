'use client';
// The end of a sa hình liên hoàn run: the score, the pass line and its law quote, and every fault
// with where on the course it happened. The quotes and the pass mark come from the ruleset the page
// was built with, never from a string in this file. From here the learner can replay the same run or
// start a fresh one.

import type { Penalty, Ruleset } from '../ruleset.ts';
import { sourceLabel } from '../ruleset.ts';
import type { Run } from '../run.ts';

export interface ReplayResult {
  actual: string;
  match: boolean;
}

export interface LienHoanResultProps {
  run: Run;
  ruleset: Ruleset;
  penalties: readonly Penalty[];
  /** The hash the replayed run ended on, once the replay has finished. */
  replayResult: ReplayResult | null;
  /** The hash the recorded run ended on, for the "same as the run" line. */
  replayExpected: string | null;
  onReplay(): void;
  onRestart(): void;
}

/** The run's clock as mm:ss, from the course tick (60 steps a second, from bài 1's order). */
export function clockText(courseTick: number): string {
  const total = Math.max(0, Math.floor(courseTick / 60));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function LienHoanResult({
  run,
  ruleset,
  penalties,
  replayResult,
  replayExpected,
  onReplay,
  onRestart,
}: LienHoanResultProps) {
  const s = run.state;
  const suspended = s.disqualified;
  const passed = s.verdict === 'passed';
  const title = suspended ? 'Đình chỉ' : passed ? `Đạt: ${s.score} điểm` : `Không đạt: ${s.score} điểm`;
  return (
    <div
      className="overlay result lien-hoan"
      role="dialog"
      aria-label="Kết quả sa hình liên hoàn"
      data-run-result="yes"
      data-bad={suspended ? 'yes' : 'no'}
      data-score={s.score}
      data-verdict={s.verdict}
      data-disqualified={suspended ? 'yes' : 'no'}
      data-course-tick={s.courseTick}
    >
      <h1>{title}</h1>
      <p className="result-line" data-pass-line>
        Điểm đạt: từ <strong>{ruleset.scoring.pass}</strong> điểm trở lên.
      </p>
      <blockquote className="result-quote" data-scoring-quote>
        {ruleset.scoring.source.quote}
      </blockquote>
      <p className="result-clock" data-run-clock>
        Tổng thời gian: <strong>{clockText(s.courseTick)}</strong> (bài {s.lesson}/11)
      </p>

      <section className="result-faults" aria-label="Lỗi">
        <h2>{penalties.length === 0 ? 'Không có lỗi' : `${penalties.length} lỗi`}</h2>
        <ul>
          {penalties.map((p, i) => (
            <li key={`${p.tick}-${p.id}-${i}`} data-fault={p.id} data-fault-lesson={p.lesson} data-fault-tick={p.tick}>
              <p className="rule">
                <code>{p.id}</code>
                <span className="points">{p.disqualify ? 'Đình chỉ' : `−${p.points} điểm`}</span>
              </p>
              <p className="where" data-fault-where>
                Bài {p.lesson} · {clockText(p.tick)}
              </p>
              <blockquote>{p.source.quote}</blockquote>
              <cite>{sourceLabel(p.source)}</cite>
            </li>
          ))}
        </ul>
      </section>

      {replayResult ? (
        <p className="replay-result" data-replay-result data-replay-match={replayResult.match ? 'yes' : 'no'}>
          Chạy lại: hash <code>{replayResult.actual}</code>{' '}
          {replayResult.match
            ? '— khớp với lượt vừa chạy.'
            : `— KHÔNG khớp với lượt vừa chạy${replayExpected ? ` (${replayExpected})` : ''}.`}
        </p>
      ) : null}

      <div className="result-actions">
        <button type="button" data-replay-button onClick={onReplay}>
          Chạy lại lượt này
        </button>
        <button type="button" data-restart-button onClick={onRestart}>
          Làm lại từ bài 1
        </button>
      </div>
      <p className="result-hint">
        Bấm <span className="key">Esc</span> hoặc <span className="key">Backspace</span> để làm lại.
      </p>
    </div>
  );
}
