/** The calibration load: a fixed amount of float work, the same function on the main thread and in the Worker. */
export function spin(iters: number): number {
  let x = 1;
  for (let i = 0; i < iters; i += 1) x = (x * 1.0000001 + i) % 7;
  return x;
}
