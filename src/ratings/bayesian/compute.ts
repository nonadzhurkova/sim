import { db } from "@/db";
import { races, drivers, teams, raceResults, qualifyingResults, circuits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runFilter, projectForward, type KalmanState, type FilterParams } from "./kalman";
import { rookiePrior, CIRCUIT_TYPE_PRIOR } from "./priors";
import { computeRaceFieldRelativePace } from "../race-pace";

/**
 * Bayesian (Kalman-filtered) alternative to the hand-tuned basePace +
 * trackAffinity in compute.ts, kept in its own module so it can be A/B
 * tested against the existing model on the backtest harness before it
 * replaces anything (see project memory: validate every rating change on
 * the backtest before trusting it — several plausible-looking changes this
 * project made turned out to measurably hurt predictions).
 *
 * Two things this is meant to fix, both concrete gaps in the current model:
 *
 * 1. Sample-size blindness. weightedAverage() treats a 3-race rookie and a
 *    60-race veteran identically — same fixed 5-race half-life. Here, a
 *    driver's own uncertainty controls how much a new race moves their
 *    estimate: wide for a rookie (moves a lot), narrow for an established
 *    driver (moves little). A rookie also starts from their team-mate's
 *    estimate, not `null`.
 *
 * 2. Fixed, ungrounded track-affinity weight. The current model applies one
 *    hand-swept weight (0.35) to every driver's circuit-type deviation,
 *    regardless of how much same-type history that specific driver has.
 *    Here, each driver's circuit-type deviation is its own small Kalman
 *    filter starting at prior mean 0 — it only grows away from 0, and only
 *    gets trusted, as that driver accumulates races of that circuit type.
 *    A driver with no street-circuit history contributes ~0 deviation
 *    automatically, rather than needing a separate null-fallback.
 */

/** Tuned once against the observed race-pace spread in the ingested data — see backtest-tune.ts for the sweep that picked these. */
export const DEFAULT_FILTER_PARAMS: FilterParams = {
  processVariancePerRace: 0.02,
  observationVariance: 0.15,
};

export type BayesianDriverRating = {
  /** Field-relative pace estimate, same unit and sign convention as basePace. */
  pace: number;
  /** Uncertainty around that estimate — smaller means more confident. */
  variance: number;
  /** How many prior races fed this estimate. */
  sampleSize: number;
};

type RaceRow = { id: number; season: number; round: number; circuitId: number };
type CircuitRow = { id: number; type: string | null };

/**
 * Computes Bayesian pace ratings for every driver, for every race in
 * `season`, using only data strictly before each race — mirroring
 * computeSeasonRatings()'s no-lookahead guarantee so this is equally valid
 * for backtesting a past race as for predicting a future one.
 */
export async function computeBayesianSeasonRatings(
  season: number,
  params: FilterParams = DEFAULT_FILTER_PARAMS,
): Promise<Map<number, Map<number, BayesianDriverRating>>> {
  const seasonRaces: RaceRow[] = await db
    .select({ id: races.id, season: races.season, round: races.round, circuitId: races.circuitId })
    .from(races)
    .where(eq(races.season, season))
    .orderBy(races.round);

  const allRacesEver: RaceRow[] = await db
    .select({ id: races.id, season: races.season, round: races.round, circuitId: races.circuitId })
    .from(races)
    .orderBy(races.season, races.round);

  const allCircuits: CircuitRow[] = await db.select({ id: circuits.id, type: circuits.type }).from(circuits);
  const circuitTypeById = new Map(allCircuits.map((c) => [c.id, c.type]));

  // Field-relative pace per race, reused across every target race — same
  // precomputation strategy as compute.ts, and it's the same underlying
  // signal (race-pace.ts), so results stay comparable between the two models.
  const racePaceByRace = new Map<number, Map<number, number>>();
  for (const race of allRacesEver) {
    racePaceByRace.set(race.id, await computeRaceFieldRelativePace(race.id));
  }

  const qualRows = await db
    .select({ raceId: qualifyingResults.raceId, driverId: qualifyingResults.driverId, gapToPole: qualifyingResults.gapToPole })
    .from(qualifyingResults);
  const qualByRaceDriver = new Map<string, number>();
  for (const q of qualRows) {
    if (q.gapToPole != null) qualByRaceDriver.set(`${q.raceId}:${q.driverId}`, q.gapToPole);
  }

  const driverTeamRows = await db
    .select({ raceId: raceResults.raceId, driverId: raceResults.driverId, teamId: raceResults.teamId })
    .from(raceResults);
  const teamByRaceDriver = new Map<string, number>();
  for (const r of driverTeamRows) teamByRaceDriver.set(`${r.raceId}:${r.driverId}`, r.teamId);

  const allDriverIds = (await db.select({ id: drivers.id }).from(drivers)).map((d) => d.id);
  const allTeamIds = (await db.select({ id: teams.id }).from(teams)).map((t) => t.id);

  const results = new Map<number, Map<number, BayesianDriverRating>>();

  for (const targetRace of seasonRaces) {
    const prior = allRacesEver.filter(
      (r) => r.season < targetRace.season || (r.season === targetRace.season && r.round < targetRace.round),
    );

    const raceMap = new Map<number, BayesianDriverRating>();

    for (const driverId of allDriverIds) {
      // Build this driver's chronological observation series: each prior
      // race where we have a pace signal, paired with how many races since
      // the previous observation (so drift accounts for gaps, e.g. injury).
      const observations: { value: number; racesSincePrevious: number; circuitId: number }[] = [];
      let lastRaceIndex = -1;
      prior.forEach((race, idx) => {
        const pace = racePaceByRace.get(race.id)?.get(driverId);
        const gap = qualByRaceDriver.get(`${race.id}:${driverId}`);
        // Blend race pace and quali gap the same way basePace does when both
        // exist, so the observation is one number per race, not two series.
        const value =
          pace != null && gap != null ? (pace + gap) / 2 : pace != null ? pace : gap != null ? gap : null;
        if (value == null) return;
        const gapRaces = lastRaceIndex === -1 ? 0 : idx - lastRaceIndex;
        observations.push({ value, racesSincePrevious: gapRaces, circuitId: race.circuitId });
        lastRaceIndex = idx;
      });

      if (observations.length === 0) {
        raceMap.set(driverId, {
          pace: 0,
          variance: 999, // effectively "unknown"; caller should treat as no signal
          sampleSize: 0,
        });
        continue;
      }

      // Rookie prior: team-mate's own filtered estimate if we can resolve
      // one for this driver's current team, else field mean of 0 (pace is
      // already field-relative, so 0 is a neutral starting point).
      const currentTeamId = teamByRaceDriver.get(`${targetRace.id}:${driverId}`);
      let teammateEstimate: KalmanState | null = null;
      if (currentTeamId != null) {
        const teammateId = allDriverIds.find(
          (id) => id !== driverId && teamByRaceDriver.get(`${targetRace.id}:${id}`) === currentTeamId,
        );
        if (teammateId != null) {
          const mateObs: { value: number; racesSincePrevious: number }[] = [];
          let mateLast = -1;
          prior.forEach((race, idx) => {
            const pace = racePaceByRace.get(race.id)?.get(teammateId);
            const gap = qualByRaceDriver.get(`${race.id}:${teammateId}`);
            const value =
              pace != null && gap != null ? (pace + gap) / 2 : pace != null ? pace : gap != null ? gap : null;
            if (value == null) return;
            mateObs.push({ value, racesSincePrevious: mateLast === -1 ? 0 : idx - mateLast });
            mateLast = idx;
          });
          if (mateObs.length > 0) {
            teammateEstimate = runFilter({ mean: 0, variance: 1 }, params, mateObs);
          }
        }
      }

      const basePrior = rookiePrior(teammateEstimate, 0);
      const overallState = runFilter(
        basePrior,
        params,
        observations.map((o) => ({ value: o.value, racesSincePrevious: o.racesSincePrevious })),
      );

      // Circuit-type deviation: a second, independent filter over the
      // difference between each observation and the driver's *overall*
      // estimate at the time, restricted to races of the same type as the
      // target race. Starts at prior mean 0 and only moves once there is
      // real same-type history for this specific driver.
      const targetType = circuitTypeById.get(targetRace.circuitId);
      let circuitDeviation = 0;
      if (targetType) {
        const sameTypeObs = observations.filter(
          (o) => circuitTypeById.get(o.circuitId) === targetType,
        );
        if (sameTypeObs.length > 0) {
          const deviations = sameTypeObs.map((o) => ({
            value: o.value - overallState.mean,
            racesSincePrevious: o.racesSincePrevious,
          }));
          const devState = runFilter(CIRCUIT_TYPE_PRIOR, params, deviations);
          circuitDeviation = devState.mean;
        }
      }

      const racesElapsedSinceLast = prior.length - lastRaceIndex - 1;
      const projected = projectForward(overallState, params, Math.max(0, racesElapsedSinceLast));

      raceMap.set(driverId, {
        pace: projected.mean + circuitDeviation,
        variance: projected.variance,
        sampleSize: observations.length,
      });
    }

    results.set(targetRace.id, raceMap);
  }

  void allTeamIds; // reserved: a team-level filter is the natural next extension, not built yet
  return results;
}

/** Debug/reporting helper: prints a small readable summary for one race. */
export function summariseBayesianRatings(
  raceMap: Map<number, BayesianDriverRating>,
  driverNames: Map<number, string>,
): string {
  return [...raceMap.entries()]
    .filter(([, r]) => r.sampleSize > 0)
    .sort((a, b) => a[1].pace - b[1].pace)
    .map(
      ([id, r]) =>
        `  ${(driverNames.get(id) ?? `#${id}`).padEnd(24)} pace=${r.pace.toFixed(3)} ` +
        `sd=${Math.sqrt(r.variance).toFixed(3)} n=${r.sampleSize}`,
    )
    .join("\n");
}
