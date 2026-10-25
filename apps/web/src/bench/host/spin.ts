/** The fixed load behind the in-cell throttle check: a known amount of float work, so the time it
 * takes under a throttle can be compared with the same work at 1x. */
export function spin(iters: number): number {
  let x = 1;
  for (let i = 0; i < iters; i += 1) x = (x * 1.0000001 + i) % 7;
  return x;
}
