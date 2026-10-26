// /thi/5 — Qua ngã tư có tín hiệu điều khiển giao thông. Same page body as /thi with lesson 5.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 5 — Qua ngã tư có tín hiệu điều khiển giao thông',
  description: 'Qua ngã tư có đèn: dừng đúng vạch khi đèn đỏ, chờ đèn xanh, xi nhan phải rồi rẽ, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={5} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
