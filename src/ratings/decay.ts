export const DEFAULT_HALF_LIFE_RACES = 5;

/** Weight for a race `racesAgo` races before the target race (0 = most recent prior race). */
export function recencyWeight(racesAgo: number, halfLifeRaces: number = DEFAULT_HALF_LIFE_RACES): number {
  const decayRate = Math.log(2) / halfLifeRaces;
  return Math.exp(-decayRate * racesAgo);
}

/**
 * Weighted average, most recent entry first in `values`. `halfLifeRaces`
 * defaults to DEFAULT_HALF_LIFE_RACES (5) -- every existing caller keeps
 * today's behavior unless it explicitly passes a different value. Added to
 * let qualiForm/basePace's qualifying component be swept against a longer
 * half-life: at 5, three separate signals (qualScore, qualiForm, and the
 * simulated grid via qualiForm) all forget a driver's earlier-season form at
 * the same fast rate, so one recent slump moves the rating three times over
 * — see project memory on the Russell/Antonelli investigation.
 */
export function weightedAverage(values: number[], halfLifeRaces: number = DEFAULT_HALF_LIFE_RACES): number | null {
  if (values.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  values.forEach((v, i) => {
    const w = recencyWeight(i, halfLifeRaces);
    weightedSum += v * w;
    weightTotal += w;
  });
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

/**
 * Recency-weighted average with the single best and single worst value in
 * the window dropped first (symmetric trim -- dropping only the worst would
 * flatter every driver and specifically favor "one bad day, otherwise
 * consistent" over genuinely steady form). Needs at least 3 values to trim
 * anything; falls back to the plain weightedAverage below that.
 *
 * Built after ruling out two other fixes for the same underlying case (a
 * driver whose qualifying form looked mediocre despite a strong season,
 * because of one late outlier session -- see project memory): widening the
 * half-life uniformly was tested and rejected (every wider value scored
 * worse on 2025+2026); blending toward a season-long average was rejected
 * even faster, because "season-long" pools every ingested season including
 * a driver's earlier, weaker rookie year, reintroducing a different bias
 * rather than fixing the recency one. Trimming targets the actual shape of
 * the problem (a genuine outlier session, not a real trend) without either
 * of those side effects.
 */
export function trimmedWeightedAverage(values: number[], halfLifeRaces: number = DEFAULT_HALF_LIFE_RACES): number | null {
  if (values.length < 3) return weightedAverage(values, halfLifeRaces);
  const withIndex = values.map((v, i) => ({ v, i }));
  const minEntry = withIndex.reduce((a, b) => (b.v < a.v ? b : a));
  const maxEntry = withIndex.reduce((a, b) => (b.v > a.v ? b : a));
  const dropIndices = new Set([minEntry.i, maxEntry.i]);
  const trimmed = withIndex.filter((e) => !dropIndices.has(e.i));
  // Recency position (i) is preserved from the original array so a value's
  // weight still reflects how many races ago it actually happened, not its
  // position in the shortened trimmed array.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const { v, i } of trimmed) {
    const w = recencyWeight(i, halfLifeRaces);
    weightedSum += v * w;
    weightTotal += w;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

/**
 * Recency-weighted median: sorts values, then walks the recency-weighted
 * cumulative distribution to find the weighted 50th percentile. A single
 * extreme outlier moves this far less than it moves a mean, without needing
 * to decide how many values to drop the way trimming does.
 */
export function weightedMedian(values: number[], halfLifeRaces: number = DEFAULT_HALF_LIFE_RACES): number | null {
  if (values.length === 0) return null;
  const weighted = values.map((v, i) => ({ v, w: recencyWeight(i, halfLifeRaces) })).sort((a, b) => a.v - b.v);
  const totalWeight = weighted.reduce((sum, e) => sum + e.w, 0);
  if (totalWeight <= 0) return null;
  let cumulative = 0;
  for (const e of weighted) {
    cumulative += e.w;
    if (cumulative >= totalWeight / 2) return e.v;
  }
  return weighted[weighted.length - 1].v;
}
