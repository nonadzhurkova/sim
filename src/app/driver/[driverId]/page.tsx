import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { races, circuits } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getDriverProfile,
  getDriverCircuitHistory,
  type DriverRaceRow,
} from "@/queries/driver-profile";
import { DriverProfilePanel } from "@/components/driver-profile-panel";

/**
 * Driver page: career and recent-form statistics.
 *
 * Accepts an optional `?race=<season>-<round>` so a link from a race page can
 * surface that circuit's history for the driver ("how did they go here last
 * year?") alongside their general form.
 */
export default async function DriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ driverId: string }>;
  searchParams: Promise<{ race?: string }>;
}) {
  const { driverId: driverIdStr } = await params;
  const { race: raceParam } = await searchParams;
  const driverId = parseInt(driverIdStr, 10);
  if (!Number.isInteger(driverId)) notFound();

  const profile = await getDriverProfile(driverId);
  if (!profile) notFound();

  // Optional circuit context, when arriving from a race page.
  let circuitHistory: DriverRaceRow[] = [];
  let circuitName: string | null = null;
  if (raceParam) {
    const [s, r] = raceParam.split("-").map((n) => parseInt(n, 10));
    if (Number.isInteger(s) && Number.isInteger(r)) {
      const [race] = await db
        .select({ circuitId: races.circuitId, name: circuits.name })
        .from(races)
        .innerJoin(circuits, eq(races.circuitId, circuits.id))
        .where(and(eq(races.season, s), eq(races.round, r)));
      if (race) {
        circuitName = race.name;
        circuitHistory = (await getDriverCircuitHistory(driverId, race.circuitId)).filter(
          (h) => h.season < s || (h.season === s && h.round < r),
        );
      }
    }
  }

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <Link
        href="/drivers"
        className="hud-mono text-xs uppercase tracking-widest text-cyan-500 hover:text-cyan-300"
      >
        ← All drivers
      </Link>
      <div className="mt-4">
        <DriverProfilePanel
          profile={profile}
          circuitHistory={circuitHistory}
          circuitName={circuitName}
        />
      </div>
    </main>
  );
}
