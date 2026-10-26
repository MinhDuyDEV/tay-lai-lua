// /thi/6 — Qua đường vòng quanh co. Same page body as /thi/3 with lesson 6.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 6 — Qua đường vòng quanh co',
  description: 'Tập bài qua đường vòng quanh co, sa hình hạng B, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={6} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
