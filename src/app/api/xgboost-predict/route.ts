import { db } from "@/db";
import { drivers, teams, raceResults, xgboostPredictions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildXgboostFeatures } from "@/sim/xgboost-features";
import { predictRace, xgboostModelAvailable } from "@/sim/xgboost-model";
import { MODEL_VERSION } from "@/sim/params";
import { isBeforeRaceStart } from "@/sim/run-simulation";

/**
 * Scores one race with the XGBoost overlay (scripts/xgboost/) — trained
 * once, offline, by scripts/xgboost/train.py on the full 2014-2026
 * historical CSVs, then evaluated here entirely in-process (src/sim/
 * xgboost-model.ts walks the saved trees directly, no Python at request
 * time). Live feature values (grid, quali gap, rolling form) come fresh
 * from the production DB — see src/sim/xgboost-features.ts.
 *
 * Experimental / secondary to the production Monte Carlo prediction
 * (src/app/api/simulate/route.ts) — see README's "What's been tried"
 * section and project memory. Retraining is a separate, occasional,
 * manual step (run scripts/xgboost/train.py again after refreshing
 * data/historical/), not something this route ever does.
 */
export async function POST(req: Request) {
  let body: { raceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raceId = Number(body.raceId);
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  if (!xgboostModelAvailable()) {
    return Response.json(
      { error: "No trained XGBoost model found — run `python scripts/xgboost/train.py` once first." },
      { status: 500 },
    );
  }

  const features = await buildXgboostFeatures(raceId);
  if (!features) {
    return Response.json(
      { error: "No qualifying grid available yet for this race — the XGBoost overlay needs a real grid." },
      { status: 400 },
    );
  }

  const driverRows = await db.select({ id: drivers.id, externalRef: drivers.externalRef, name: drivers.name }).from(drivers);
  const driverByRef = new Map(driverRows.map((d) => [d.externalRef, d]));

  const entrants = features
    .map((f) => {
      const driver = driverByRef.get(f.driverRef);
      if (!driver) return null;
      return { driverId: driver.id, ...f };
    })
    .filter((e): e is NonNullable<typeof e> => e != null);

  const predictions = predictRace(entrants);

  // Persist every call, replacing this race's rows wholesale -- same
  // "frozen prediction log" idea as simulation_runs (see run-simulation.ts'
  // getFrozenPrediction doc comment), but for the XGBoost overlay, which
  // previously wrote nothing to the DB at all. A click before the race
  // updates this race's stored prediction; predictedBeforeRace, stamped at
  // write time, is what makes it possible to tell a genuine pre-race call
  // apart from a post-race replay later without guessing from a timestamp.
  const predictedBeforeRace = await isBeforeRaceStart(raceId);
  await db.delete(xgboostPredictions).where(eq(xgboostPredictions.raceId, raceId));
  if (predictions.length > 0) {
    await db.insert(xgboostPredictions).values(
      predictions.map((p) => ({
        raceId,
        driverId: p.driverId,
        predFinishPosition: p.predFinishPosition,
        predDnfProb: p.predDnfProb,
        winProbability: p.winProbability,
        predictedBeforeRace,
        modelVersion: MODEL_VERSION,
      })),
    );
  }

  const resultRows = await db.select({ driverId: raceResults.driverId, teamId: raceResults.teamId }).from(raceResults).where(eq(raceResults.raceId, raceId));
  const teamIdByDriverId = new Map(resultRows.map((r) => [r.driverId, r.teamId]));
  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
  const driverById = new Map(driverRows.map((d) => [d.id, d]));

  const out = predictions
    .map((p) => {
      const driver = driverById.get(p.driverId);
      const teamId = teamIdByDriverId.get(p.driverId) ?? null;
      return {
        driverId: p.driverId,
        driverName: driver?.name ?? "Unknown",
        teamName: teamId != null ? teamNameById.get(teamId) ?? null : null,
        predFinishPosition: p.predFinishPosition,
        predDnfProb: p.predDnfProb,
        winProbability: p.winProbability,
      };
    })
    .sort((a, b) => b.winProbability - a.winProbability);

  return Response.json({ drivers: out });
}
