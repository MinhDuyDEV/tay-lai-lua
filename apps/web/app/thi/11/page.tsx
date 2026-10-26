// /thi/11 — Kết thúc. Same page body as /thi with lesson 11.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 11 — Kết thúc',
  description: 'Qua vạch kết thúc với xi nhan phải rồi dừng, sa hình hạng B, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={11} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
