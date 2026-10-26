// /thi/2 — Dừng xe nhường đường cho người đi bộ. Same page body as /thi with lesson 2.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 2 — Dừng xe nhường đường cho người đi bộ',
  description: 'Dừng đúng vạch cho người đi bộ qua rồi đi tiếp, sa hình hạng B, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={2} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
