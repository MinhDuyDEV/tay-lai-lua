// /lien-hoan — sa hình liên hoàn: all 11 bài in one run, then a result screen and a replay.
// A server component on purpose: it runs at BUILD time, where the ruleset JSON is read. Everything
// interactive is a child client component; this file has no state and no three.js.

import type { Metadata } from 'next';
import Stage from '../../src/Stage.tsx';
import { readRuleset } from '../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Sa hình liên hoàn — 11 bài, hạng B',
  description:
    'Chạy liên hoàn 11 bài sa hình hạng B trong một lượt: điểm trừ khi lỗi, kết quả cuối lượt, và chạy lại đúng lượt đó.',
};

export default function Page() {
  return <Stage lesson={1} lienHoan ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
