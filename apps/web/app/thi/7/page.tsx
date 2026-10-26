// /thi/7 — Bài 7 — Ghép xe dọc vào nơi đỗ. Same page body as /thi with lesson 7.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 7 — Ghép xe dọc vào nơi đỗ',
  description: 'Ghép xe dọc vào nơi đỗ (Hình 13): tiến vào khoảng khống chế, lùi chuẩn vào ô, đứng phanh đến khi có tín hiệu, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={7} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
