import { db } from "@/db";
import { gridPenalties, drivers, qualifyingResults } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { deriveGridFromQualifyingLaps } from "@/sim/entrants";

/**
 * Manual grid-penalty entry for a pre-race prediction -- see gridPenalties'
 * doc comment in schema.ts for why this is manual rather than sourced from
 * an API. GET returns the pre-penalty field (classified qualifying, or the
 * OpenF1-derived reconstruction -- deliberately NOT buildSimContext's output,
 * which already has penalties applied; showing that here would mean the
 * picker displays a driver's already-penalized slot as if it were their
 * qualifying position) plus any penalties already entered.
 */
export async function GET(req: Request) {
  const raceId = Number(new URL(req.url).searchParams.get("raceId"));
  if (!Number.isInteger(raceId) || raceId < 1) {
    return Response.json({ error: "Invalid raceId" }, { status: 400 });
  }

  const [qualiRows, penaltyRows] = await Promise.all([
    db
      .select({ driverId: qualifyingResults.driverId, position: qualifyingResults.position })
      .from(qualifyingResults)
      .where(eq(qualifyingResults.raceId, raceId)),
    db
      .select({ id: gridPenalties.id, driverId: gridPenalties.driverId, placesOffset: gridPenalties.placesOffset, reason: gridPenalties.reason })
      .from(gridPenalties)
      .where(eq(gridPenalties.raceId, raceId)),
  ]);

  let gridByDriver = new Map(qualiRows.filter((q) => q.position != null).map((q) => [q.driverId, q.position as number]));
  if (gridByDriver.size === 0) {
    gridByDriver = await deriveGridFromQualifyingLaps(raceId);
  }

  const driverIds = [...gridByDriver.keys()];
  const driverRows = driverIds.length ? await db.select({ id: drivers.id, name: drivers.name }).from(drivers) : [];
  const nameById = new Map(driverRows.map((d) => [d.id, d.name]));

  const field = [...gridByDriver.entries()]
    .map(([driverId, gridPosition]) => ({ driverId, driverName: nameById.get(driverId) ?? `Driver ${driverId}`, gridPosition }))
    .sort((a, b) => a.gridPosition - b.gridPosition);

  const penalties = penaltyRows.map((p) => ({ ...p, driverName: nameById.get(p.driverId) ?? `Driver ${p.driverId}` }));

  return Response.json({ field, penalties });
}

export async function POST(req: Request) {
  let body: { raceId?: unknown; driverId?: unknown; placesOffset?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raceId = Number(body.raceId);
  const driverId = Number(body.driverId);
  const placesOffset = Number(body.placesOffset);
  if (!Number.isInteger(raceId) || raceId < 1) return Response.json({ error: "Invalid raceId" }, { status: 400 });
  if (!Number.isInteger(driverId) || driverId < 1) return Response.json({ error: "Invalid driverId" }, { status: 400 });
  if (!Number.isInteger(placesOffset) || placesOffset < 1) {
    return Response.json({ error: "placesOffset must be a positive integer" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  await db
    .insert(gridPenalties)
    .values({ raceId, driverId, placesOffset, reason })
    .onConflictDoUpdate({
      target: [gridPenalties.raceId, gridPenalties.driverId],
      set: { placesOffset, reason },
    });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const raceId = Number(searchParams.get("raceId"));
  const driverId = Number(searchParams.get("driverId"));
  if (!Number.isInteger(raceId) || raceId < 1 || !Number.isInteger(driverId) || driverId < 1) {
    return Response.json({ error: "Invalid raceId or driverId" }, { status: 400 });
  }

  await db.delete(gridPenalties).where(and(eq(gridPenalties.raceId, raceId), eq(gridPenalties.driverId, driverId)));
  return Response.json({ ok: true });
}
