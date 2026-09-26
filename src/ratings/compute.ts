import { db } from "@/db";
import type { ProgressReporter } from "@/ingest/progress";
import { races, drivers, teams, driverRatings, teamRatings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { computeRaceFieldRelativePace } from "./race-pace";
import { weightedAverage } from "./decay";
import { computeDriverReliability, fetchAllResults } from "./reliability";
import { computeTeamStrength } from "./team-strength";
import { computeTrackAffinity } from "./track-affinity";
import { computePracticePace } from "./practice-pace";
import { computeBayesianSeasonRatings } from "./bayesian/compute";
import { qualifyingResults } from "@/db/schema";

/**
 * Computes and stores driver_ratings + team_ratings for every race in
 * `season`, in chronological order, using only data strictly before each
 * race (no lookahead — required for valid backtesting later).
 */
export async function computeSeasonRatings(season: number, onProgress?: ProgressReporter) {
  const seasonRaces = await db
    .select({ id: races.id, season: races.season, round: races.round })
    .from(races)
    .where(eq(races.season, season))
    .orderBy(races.round);

  const allDrivers = await db.select({ id: drivers.id }).from(drivers);
  const allTeams = await db.select({ id: teams.id }).from(teams);
  const driverIds = allDrivers.map((d) => d.id);
  const teamIds = allTeams.map((t) => t.id);

  const allResults = await fetchAllResults();

  // Only the variance (uncertainty) output is used here — the Bayesian pace
  // mean itself was A/B tested and rejected (see project memory), but its
  // per-driver, sample-size-aware uncertainty is a genuinely separate signal:
  // how much a driver's own rating should vary iteration to iteration.
  const bayesianRatings = await computeBayesianSeasonRatings(season);

  // Precompute field-relative race pace once per race across all seasons
  // referenced (avoids recomputing per target race).
  const allRacesEver = await db
    .select({ id: races.id, season: races.season, round: races.round })
    .from(races);
  const racePaceByRace = new Map<number, Map<number, number>>();
  for (const race of allRacesEver) {
    racePaceByRace.set(race.id, await computeRaceFieldRelativePace(race.id));
  }

  const qualRows = await db
    .select({ raceId: qualifyingResults.raceId, driverId: qualifyingResults.driverId, gapToPole: qualifyingResults.gapToPole })
    .from(qualifyingResults);
  const qualLookup = new Map<string, number>();
  for (const q of qualRows) {
    if (q.gapToPole != null) qualLookup.set(`${q.raceId}:${q.driverId}`, q.gapToPole);
  }

  for (const targetRace of seasonRaces) {
    const priorRaces = allRacesEver
      .filter((r) => r.season < targetRace.season || (r.season === targetRace.season && r.round < targetRace.round))
      .sort((a, b) => b.season - a.season || b.round - a.round);

    // base pace: blend qualifying gap + race pace, each recency-weighted
    const basePaceByDriver = new Map<number, number | null>();
    for (const driverId of driverIds) {
      const qualHistory: number[] = [];
      const paceHistory: number[] = [];
      for (const race of priorRaces) {
        const gap = qualLookup.get(`${race.id}:${driverId}`);
        if (gap != null) qualHistory.push(gap);
        const pace = racePaceByRace.get(race.id)?.get(driverId);
        if (pace != null) paceHistory.push(pace);
      }
      const qualScore = weightedAverage(qualHistory);
      const paceScore = weightedAverage(paceHistory);
      if (qualScore == null && paceScore == null) basePaceByDriver.set(driverId, null);
      else if (qualScore == null) basePaceByDriver.set(driverId, paceScore);
      else if (paceScore == null) basePaceByDriver.set(driverId, qualScore);
      else basePaceByDriver.set(driverId, (qualScore + paceScore) / 2);
    }

    const driverReliability = await computeDriverReliability(targetRace.id, driverIds, allResults);
    const teamStrength = await computeTeamStrength(targetRace.id, teamIds, priorRaces, racePaceByRace);
    const trackAffinity = await computeTrackAffinity(targetRace.id, driverIds, priorRaces, racePaceByRace);
    const practicePace = await computePracticePace(targetRace.id);
    const bayesianForRace = bayesianRatings.get(targetRace.id);

    const driverRatingRows = driverIds
      .map((driverId) => {
        const bayesian = bayesianForRace?.get(driverId);
        return {
          driverId,
          raceId: targetRace.id,
          basePace: basePaceByDriver.get(driverId) ?? null,
          driverReliability: driverReliability.get(driverId) ?? null,
          trackAffinity: trackAffinity.get(driverId) ?? null,
          practicePace: practicePace.get(driverId) ?? null,
          paceUncertainty: bayesian && bayesian.sampleSize > 0 ? bayesian.variance : null,
        };
      })
      .filter(
        (r) =>
          r.basePace != null ||
          r.driverReliability != null ||
          r.trackAffinity != null ||
          r.practicePace != null,
      );

    if (driverRatingRows.length > 0) {
      await db
        .insert(driverRatings)
        .values(driverRatingRows)
        .onConflictDoUpdate({
          target: [driverRatings.driverId, driverRatings.raceId],
          set: {
            basePace: sql`excluded.base_pace`,
            driverReliability: sql`excluded.driver_reliability`,
            trackAffinity: sql`excluded.track_affinity`,
            practicePace: sql`excluded.practice_pace`,
            paceUncertainty: sql`excluded.pace_uncertainty`,
            computedAt: new Date(),
          },
        });
    }

    const teamRatingRows = teamIds
      .map((teamId) => ({
        teamId,
        raceId: targetRace.id,
        carStrength: teamStrength.get(teamId) ?? null,
        carReliability: null as number | null, // no reliable cause data source yet, see reliability.ts
      }))
      .filter((r) => r.carStrength != null);

    if (teamRatingRows.length > 0) {
      await db
        .insert(teamRatings)
        .values(teamRatingRows)
        .onConflictDoUpdate({
          target: [teamRatings.teamId, teamRatings.raceId],
          set: {
            carStrength: sql`excluded.car_strength`,
            computedAt: new Date(),
          },
        });
    }

    console.log(`[ratings] season ${season} round ${targetRace.round}: ${driverRatingRows.length} driver ratings, ${teamRatingRows.length} team ratings`);
    onProgress?.({
      phase: "ratings",
      message: `Round ${targetRace.round} — ${driverRatingRows.length} driver, ${teamRatingRows.length} team ratings`,
      completed: seasonRaces.indexOf(targetRace) + 1,
      total: seasonRaces.length,
    });
  }
}
