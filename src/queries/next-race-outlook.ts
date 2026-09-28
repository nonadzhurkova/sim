import { db } from "@/db";
import { drivers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getFrozenPrediction } from "@/sim/run-simulation";

export type NextRaceContender = { driverId: number; driverName: string; winPct: number };

/**
 * Top-3 win chances for one race, from whatever prediction was actually
 * stored before it (see getFrozenPrediction) — deliberately not a fresh
 * simulation run, since running one on every home-page load would be
 * expensive and simulations are otherwise a user-triggered action (the
 * "Run Simulation" button on the race page). Returns null if nobody has
 * clicked that button yet for this race, in which case the home page falls
 * back to a plain link with no numbers rather than pretending to have data.
 */
export async function getNextRaceTopContenders(raceId: number): Promise<NextRaceContender[] | null> {
  const frozen = await getFrozenPrediction(raceId);
  if (!frozen || frozen.results.length === 0) return null;

  const driverIds = frozen.results.map((r) => r.driverId);
  const nameRows = await db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds));
  const nameById = new Map(nameRows.map((d) => [d.id, d.name]));

  return [...frozen.results]
    .sort((a, b) => (b.winPct ?? 0) - (a.winPct ?? 0))
    .slice(0, 3)
    .map((r) => ({
      driverId: r.driverId,
      driverName: nameById.get(r.driverId) ?? `Driver ${r.driverId}`,
      winPct: r.winPct ?? 0,
    }));
}
