// /thi/3 — bài 3, dừng và khởi hành xe trên dốc. Same page body as /thi with lesson 3.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 3 — Dừng và khởi hành xe trên dốc',
  description: 'Tập bài dừng và khởi hành xe trên dốc, sa hình hạng B, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={3} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
