// /thi/8 — Bài 8 — Ghép xe ngang vào nơi đỗ. Same page body as /thi with lesson 8.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 8 — Ghép xe ngang vào nơi đỗ',
  description: 'Ghép xe ngang vào nơi đỗ (Hình 14): lùi chuẩn vào ô hẹp bên phải, đứng phanh đến khi có tín hiệu, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={8} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
