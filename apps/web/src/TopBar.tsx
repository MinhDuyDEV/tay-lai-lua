'use client';
// The bar across the top of every exercise page: where the learner is, how to get somewhere else, and
// the three things that are chosen rather than driven — the transmission, the key legend and restart.
//
// Nothing here is the car. Every button gives the focus back after a click, because a focused button
// would eat Enter (the start order) and Space (the clutch).

import type { MouseEvent } from 'react';
import { HOME_HREF, LESSON_COUNT, lessonHref } from './links.ts';

export interface TopBarProps {
  /** The bài this page was opened on. */
  lesson: number;
  /** The stage on screen now: the same as `lesson` on a per-bài page, the core's lesson in a run (0 = the link). */
  lessonNow: number;
  lienHoan: boolean;
  /** The exercise's full title, "Bài N — …". */
  title: string;
  automatic: boolean;
  onAutomatic(automatic: boolean): void;
  keysShown: boolean;
  onKeys(): void;
  onRestart(): void;
}

/** Run the handler, then drop the focus so the next key press goes to the car. */
const then = (fn: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  event.currentTarget.blur();
  fn();
};

export default function TopBar({
  lesson,
  lessonNow,
  lienHoan,
  title,
  automatic,
  onAutomatic,
  keysShown,
  onKeys,
  onRestart,
}: TopBarProps) {
  const [number, name] = lienHoan ? ['Thi thử', 'Sa hình liên hoàn'] : splitTitle(title);
  // In a run the link between bài 6 and bài 7 is stage 0: six bài are behind the car, none is "now".
  const behind = lessonNow === 0 ? 6 : lessonNow - 1;
  return (
    <header className="topbar">
      <a className="topbar-home" href={HOME_HREF} aria-label="Về danh sách bài">
        <span aria-hidden="true">‹</span> Các bài
      </a>

      <div className="topbar-title">
        <span className="topbar-number">{number}</span>
        <strong>{name}</strong>
      </div>

      {lienHoan ? (
        <div className="run-progress" aria-label={lessonNow === 0 ? 'Đoạn nối giữa bài 6 và bài 7' : `Bài ${lessonNow} trên ${LESSON_COUNT}`}>
          <ol aria-hidden="true">
            {Array.from({ length: LESSON_COUNT }, (_, i) => i + 1).map((n) => (
              <li key={n} data-state={n <= behind ? 'done' : n === lessonNow ? 'now' : 'todo'}>
                {n}
              </li>
            ))}
          </ol>
          <span className="run-where">{lessonNow === 0 ? 'Đoạn nối 6 → 7' : `Bài ${lessonNow}/${LESSON_COUNT}`}</span>
        </div>
      ) : (
        <nav className="topbar-steps" aria-label="Bài trước và bài sau">
          {lesson > 1 ? (
            <a href={lessonHref(lesson - 1, automatic)}>
              <span aria-hidden="true">‹</span> Bài {lesson - 1}
            </a>
          ) : null}
          {lesson < LESSON_COUNT ? (
            <a href={lessonHref(lesson + 1, automatic)}>
              Bài {lesson + 1} <span aria-hidden="true">›</span>
            </a>
          ) : null}
        </nav>
      )}

      <div className="topbar-tools">
        <div className="choice" role="group" aria-label="Chọn loại hộp số">
          {([
            ['san', 'Số sàn', false],
            ['tu-dong', 'Số tự động', true],
          ] as const).map(([value, label, auto]) => (
            <button
              key={value}
              type="button"
              data-choice={value}
              aria-pressed={automatic === auto}
              onClick={then(() => onAutomatic(auto))}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="tool" data-tool="keys" aria-pressed={keysShown} onClick={then(onKeys)}>
          Bảng phím
        </button>
        <button type="button" className="tool" data-tool="restart" onClick={then(onRestart)}>
          Làm lại <span className="key">Esc</span>
        </button>
      </div>
    </header>
  );
}

/** "Bài 3 — Dừng và khởi hành xe trên dốc" → ["Bài 3", "Dừng và khởi hành xe trên dốc"]. */
function splitTitle(title: string): [string, string] {
  const at = title.indexOf(' — ');
  return at < 0 ? ['', title] : [title.slice(0, at), title.slice(at + 3)];
}
