// / — the home page: the list of bài and the whole-course run. A server component on purpose: the
// lesson catalogue and the ruleset's pass mark are read at BUILD time, so the page ships as plain HTML
// plus one small client component for the transmission switch. No three.js and no sim.wasm here.

import type { Metadata } from 'next';
import Home from '../src/Home.tsx';
import { LESSONS } from '../src/lessons.ts';
import { readRuleset } from './read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Tay Lái Lụa — tập thi sa hình hạng B trên trình duyệt',
  description:
    'Tập 11 bài sa hình hạng B bằng bàn phím trên sân mô phỏng 3D: chỉ từng bước, báo điểm trừ kèm câu luật, và thi thử liên hoàn.',
};

export default function Page() {
  const ruleset = readRuleset();
  return (
    <Home
      lessons={LESSONS}
      pass={ruleset.scoring.pass}
      base={ruleset.scoring.base}
      lawDoc={ruleset.scoring.source.doc}
    />
  );
}
