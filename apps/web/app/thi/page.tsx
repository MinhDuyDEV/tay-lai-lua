// /thi — bài 1. A server component on purpose: it runs at BUILD time, where the ruleset JSON is read
// (see ../read-ruleset.ts). Everything interactive is a child client component; this file has no
// state and no three.js.

import type { Metadata } from 'next';
import Stage from '../../src/Stage.tsx';
import { readRuleset } from '../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 1 — Xuất phát',
  description: 'Tập bài xuất phát sa hình hạng B bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={1} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
