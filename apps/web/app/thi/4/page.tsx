// /thi/4 — Qua vệt bánh xe và đường vòng vuông góc. Same page body as /thi/3 with lesson 4.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 4 — Qua vệt bánh xe và đường vòng vuông góc',
  description: 'Tập bài qua vệt bánh xe và đường vòng vuông góc, sa hình hạng B, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={4} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
