// /thi/10 — Thay đổi số trên đường bằng. Same page body as /thi with lesson 10.

import type { Metadata } from 'next';
import Stage from '../../../src/Stage.tsx';
import { readRuleset } from '../../read-ruleset.ts';

export const metadata: Metadata = {
  title: 'Bài 10 — Thay đổi số trên đường bằng',
  description:
    'Thay đổi số trên đường bằng (Hình 17): qua biển thứ nhất thì lên số 2 và trên 24 km/h ở biển thứ hai, rồi giảm tốc, về số 1 và dưới 24 km/h ở biển thứ ba, bằng bàn phím.',
};

export default function Page() {
  return <Stage lesson={10} ruleset={readRuleset()} wasmUrl="/sim.wasm" />;
}
