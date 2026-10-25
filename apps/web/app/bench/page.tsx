// /bench — the sim-core placement bench (main thread or Worker). Not linked from anywhere; the cell
// is chosen by the query string, see src/bench/host/BenchPage.tsx. Browser-only, like /thi.

import BenchPage from '../../src/bench/host/BenchPage.tsx';

export const metadata = { title: 'bench', robots: 'noindex' };

export default function Page() {
  return <BenchPage />;
}
