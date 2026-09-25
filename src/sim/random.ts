/**
 * Deterministic RNG + distribution helpers for the simulation engine.
 *
 * A seedable generator (rather than Math.random) means a run can be replayed
 * exactly — essential for backtesting, where a change in predicted
 * probabilities must be attributable to a model change and not to sampling
 * noise between two runs of the same code.
 */

/** mulberry32 — small, fast, good enough statistically for Monte Carlo. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal sample via Box-Muller. Draws two uniforms and keeps one
 * of the pair; discarding the second costs a little throughput but keeps
 * the generator stateless from the caller's perspective.
 */
export function sampleNormal(rng: () => number, mean = 0, stdDev = 1): number {
  let u1 = rng();
  // guard against log(0) — u1 of exactly 0 is possible and yields -Infinity
  if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
  const u2 = rng();
  const magnitude = Math.sqrt(-2 * Math.log(u1));
  return mean + stdDev * magnitude * Math.cos(2 * Math.PI * u2);
}

/** True with probability `p`. */
export function sampleBernoulli(rng: () => number, p: number): boolean {
  return rng() < p;
}
