// /thi/9 — Tạm dừng ở chỗ có đường sắt chạy qua. Same page body as /thi with lesson 9.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 9 — Tạm dừng ở chỗ có đường sắt chạy qua',
  description: 'Tạm dừng đúng vạch trước đường sắt, quan sát rồi đi tiếp, sa hình hạng B, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={9} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
