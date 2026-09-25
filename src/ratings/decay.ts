const HALF_LIFE_RACES = 5;
const DECAY_RATE = Math.log(2) / HALF_LIFE_RACES;

/** Weight for a race `racesAgo` races before the target race (0 = most recent prior race). */
export function recencyWeight(racesAgo: number): number {
  return Math.exp(-DECAY_RATE * racesAgo);
}

/** Weighted average, most recent entry first in `values`. */
export function weightedAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  values.forEach((v, i) => {
    const w = recencyWeight(i);
    weightedSum += v * w;
    weightTotal += w;
  });
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}
