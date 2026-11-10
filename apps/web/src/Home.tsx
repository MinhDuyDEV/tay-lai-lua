'use client';
// The home page: every bài as a card, the whole-course run, and the one choice a learner makes before
// driving — which transmission. No three.js and no sim here; the cards are plain links.
//
// A client component only for the transmission switch: the choice is remembered between visits and
// written into every link as `?so=tu-dong`, which is what the exercise pages read.

import { useEffect, useState } from 'react';
import { lessonHref, lienHoanHref } from './links.ts';
import type { LessonCard } from './lessons.ts';

export interface HomeProps {
  lessons: readonly LessonCard[];
  /** The pass mark and the base score, from the ruleset the site was built with. */
  pass: number;
  base: number;
  /** The document the scoring comes from, as the ruleset names it. */
  lawDoc: string;
}

/** The same key the exercise pages write when the learner flips the switch there. */
const SO_KEY = 'tll.so';

export default function Home({ lessons, pass, base, lawDoc }: HomeProps) {
  const [automatic, setAutomatic] = useState(false);
  useEffect(() => {
    try {
      setAutomatic(window.localStorage.getItem(SO_KEY) === 'tu-dong');
    } catch {
      // A blocked store: the manual car, as on a first visit.
    }
  }, []);
  const choose = (auto: boolean) => {
    setAutomatic(auto);
    try {
      window.localStorage.setItem(SO_KEY, auto ? 'tu-dong' : 'san');
    } catch {
      // The choice still holds for this visit.
    }
  };

  return (
    <main className="home">
      <header className="home-head">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          Tay Lái Lụa
        </a>
        <div className="choice" role="group" aria-label="Chọn loại hộp số">
          <button type="button" aria-pressed={!automatic} onClick={() => choose(false)}>
            Số sàn
          </button>
          <button type="button" aria-pressed={automatic} onClick={() => choose(true)}>
            Số tự động
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">Sa hình hạng B · {lessons.length} bài</p>
        <h1>Tập thi sa hình ngay trên trình duyệt</h1>
        <p className="lead">
          Lái bằng bàn phím trên sân mô phỏng 3D. Màn hình chỉ từng bước và phím cần bấm; mỗi lỗi hiện ngay điểm
          trừ kèm câu trích từ {lawDoc}.
        </p>
        <div className="actions">
          <a className="button primary" href={lessonHref(1, automatic)}>
            Bắt đầu từ bài 1
          </a>
          <a className="button" href={lienHoanHref(automatic)}>
            Thi thử {lessons.length} bài liên hoàn
          </a>
        </div>
        <ul className="facts">
          <li>
            <strong>{lessons.length}</strong> bài sa hình
          </li>
          <li>
            <strong>
              {pass}/{base}
            </strong>{' '}
            điểm để đạt
          </li>
          <li>
            <strong>{automatic ? 'Số tự động' : 'Số sàn'}</strong> đang chọn
          </li>
        </ul>
      </section>

      <section className="home-section" aria-labelledby="chon-bai">
        <h2 id="chon-bai">Chọn bài để tập</h2>
        <p className="section-lead">Tập riêng từng bài cho quen tay; làm lại bao nhiêu lần cũng được.</p>
        <ol className="lesson-grid">
          {lessons.map((card) => (
            <li key={card.lesson}>
              <a className="lesson-card" href={lessonHref(card.lesson, automatic)}>
                <span className="lesson-number">{card.lesson}</span>
                <span className="lesson-text">
                  <strong>{card.name}</strong>
                  <span>{card.blurb}</span>
                </span>
                <span className="lesson-go" aria-hidden="true">
                  ›
                </span>
              </a>
            </li>
          ))}
          <li>
            <a className="lesson-card featured" href={lienHoanHref(automatic)}>
              <span className="lesson-number">★</span>
              <span className="lesson-text">
                <strong>Thi thử: sa hình liên hoàn</strong>
                <span>
                  Cả {lessons.length} bài trong một lượt, có tính giờ. Cuối lượt có kết quả đạt hay không đạt, bảng lỗi
                  và chạy lại đúng lượt vừa lái.
                </span>
              </span>
              <span className="lesson-go" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        </ol>
      </section>

      <section className="home-section" aria-labelledby="cach-lai">
        <h2 id="cach-lai">Cách lái</h2>
        <ul className="howto">
          <li>
            <span className="keys">
              <span className="key">↑</span>
              <span className="key">↓</span>
              <span className="key">←</span>
              <span className="key">→</span>
            </span>
            <strong>Ga, phanh và vô lăng</strong>
            <span>Giữ ↑ càng lâu ga càng sâu. ← → đánh lái, thả ra xe tự trả lái.</span>
          </li>
          <li>
            <span className="keys">
              {automatic ? (
                <>
                  <span className="key">D</span>
                  <span className="key">N</span>
                  <span className="key">R</span>
                </>
              ) : (
                <>
                  <span className="key">Space</span>
                  <span className="key">1–5</span>
                  <span className="key">R</span>
                </>
              )}
            </span>
            <strong>{automatic ? 'Cần số' : 'Côn và số'}</strong>
            <span>
              {automatic
                ? 'D để chạy, N về mo, R để lùi. Hộp số tự chọn số.'
                : 'Giữ Space để đạp côn hết cỡ rồi bấm số. Nhả Space từ từ để xe đi.'}
            </span>
          </li>
          <li>
            <span className="keys">
              <span className="key">Esc</span>
            </span>
            <strong>Làm lại bất cứ lúc nào</strong>
            <span>Bảng phím đầy đủ của từng bài luôn có sẵn trong bài, ở nút “Bảng phím”.</span>
          </li>
        </ul>
        <p className="need">Cần bàn phím máy tính. Điện thoại và máy tính bảng chưa lái được.</p>
      </section>

      <footer className="home-foot">
        <p>
          Đây là mô phỏng để tự tập trình tự và tránh lỗi bị trừ điểm, không thay cho việc học lái trên xe thật. Điểm
          chấm theo {lawDoc}; chỗ nào văn bản không quy định thì trang ghi rõ là giả định.
        </p>
      </footer>
    </main>
  );
}
