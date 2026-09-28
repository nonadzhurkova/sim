import { db } from "@/db";
import { races, raceResults, qualifyingResults, drivers } from "@/db/schema";
import { eq, and, lt, or, desc, inArray } from "drizzle-orm";
import { deriveGridFromQualifyingLaps } from "@/sim/entrants";

// How many prior races' results to pull when computing rolling driver/team
// form. Capped well above the 5-race window actually averaged so that a
// team with a mid-season driver swap still has enough races to look back
// through -- but capped, unlike the old code, which queried every prior
// race in the sport's history one at a time per driver per team (thousands
// of sequential round trips against the remote Postgres instance, enough to
// wedge the whole dev server on any race deep into the season history).
const FORM_LOOKBACK_RACES = 40;

/**
 * Computes live feature values (from the production DB, no lookahead) for
 * one race's entrants, in the shape scripts/xgboost/score.py expects. This
 * mirrors scripts/xgboost/build_features.py's feature definitions so a race
 * scored this way sees the same kind of inputs the model was trained on --
 * see xgboost-overlay.ts and project memory (xgboost-poc-rejected.md and
 * its 2014-2026 retest) for why the model needs data/historical/'s longer
 * history to train well, even though a single race's own features come
 * from the live DB.
 */
export type XgboostFeatureRow = {
  driverRef: string;
  grid: number;
  qualiGapToPole: number | null;
  driverFormFinish: number | null;
  driverDnfRate: number | null;
  constructorFormFinish: number | null;
  constructorDnfRate: number | null;
  era: "hybrid_narrow_2014_2016" | "hybrid_wide_2017_2021" | "ground_effect_2022_2026";
};

function eraFor(season: number): XgboostFeatureRow["era"] {
  if (season <= 2016) return "hybrid_narrow_2014_2016";
  if (season <= 2021) return "hybrid_wide_2017_2021";
  return "ground_effect_2022_2026";
}

type FormRow = { raceId: number; driverId: number; teamId: number | null; finishPosition: number | null; status: string | null };

/**
 * Rolling mean of a driver's/team's last `window` races, computed from an
 * already-fetched, already-ordered (most recent prior race first) result
 * set -- one shared query for the whole race instead of one query per
 * driver/team pair.
 */
function rollingForm(
  orderedRows: FormRow[],
  matchPredicate: (row: FormRow) => boolean,
  window: number,
): { formFinish: number | null; dnfRate: number | null } {
  const finishHistory: number[] = [];
  const dnfHistory: number[] = [];
  for (const r of orderedRows) {
    if (finishHistory.length >= window && dnfHistory.length >= window) break;
    if (!matchPredicate(r)) continue;
    if (r.finishPosition != null) finishHistory.push(r.finishPosition);
    dnfHistory.push(r.status === "finished" ? 0 : 1);
  }
  const mean = (arr: number[]) => (arr.length > 0 ? arr.slice(0, window).reduce((a, b) => a + b, 0) / Math.min(arr.length, window) : null);
  return { formFinish: mean(finishHistory), dnfRate: mean(dnfHistory) };
}

/**
 * Builds the feature rows for every entrant of raceId, ready to write as
 * score.py's input JSON. Returns null if the race has no grid yet
 * (qualifying hasn't happened -- the XGBoost overlay needs a real grid,
 * same constraint the production model has for its own predictions).
 */
export async function buildXgboostFeatures(raceId: number): Promise<XgboostFeatureRow[] | null> {
  const [race] = await db.select({ id: races.id, season: races.season, round: races.round }).from(races).where(eq(races.id, raceId));
  if (!race) return null;

  // Same fallback chain as entrants.ts's real prediction path: the actual
  // starting grid only exists once the race has been run, so before that we
  // fall back to qualifying order, and if the results table lags behind the
  // session itself, to a grid derived from the session's own lap times.
  const teamByDriver = new Map(
    (await db.select({ driverId: raceResults.driverId, teamId: raceResults.teamId }).from(raceResults).where(eq(raceResults.raceId, raceId)))
      .filter((r) => r.teamId != null)
      .map((r) => [r.driverId, r.teamId as number]),
  );

  const realGridRows = await db
    .select({ driverId: raceResults.driverId, gridPosition: raceResults.gridPosition })
    .from(raceResults)
    .where(eq(raceResults.raceId, raceId));
  const realGridByDriver = new Map(
    realGridRows.filter((g) => g.gridPosition != null && g.gridPosition > 0).map((g) => [g.driverId, g.gridPosition as number]),
  );

  const qualiRows = await db
    .select({ driverId: qualifyingResults.driverId, position: qualifyingResults.position, gapToPole: qualifyingResults.gapToPole })
    .from(qualifyingResults)
    .where(eq(qualifyingResults.raceId, raceId));
  const qualiByDriver = new Map(qualiRows.filter((q) => q.position != null).map((q) => [q.driverId, q.position as number]));
  const gapByDriver = new Map(qualiRows.map((q) => [q.driverId, q.gapToPole]));

  const derivedGrid =
    realGridByDriver.size === 0 && qualiByDriver.size === 0 ? await deriveGridFromQualifyingLaps(raceId) : new Map<number, number>();

  const gridByDriver = realGridByDriver.size > 0 ? realGridByDriver : qualiByDriver.size > 0 ? qualiByDriver : derivedGrid;
  if (gridByDriver.size === 0) return null;

  const validGrid = [...gridByDriver.entries()].map(([driverId, gridPosition]) => ({
    driverId,
    gridPosition,
    teamId: teamByDriver.get(driverId) ?? null,
  }));

  const priorRaces = await db
    .select({ id: races.id })
    .from(races)
    .where(or(lt(races.season, race.season), and(eq(races.season, race.season), lt(races.round, race.round))))
    .orderBy(desc(races.season), desc(races.round))
    .limit(FORM_LOOKBACK_RACES);
  const priorRaceIds = priorRaces.map((r) => r.id);
  const priorRaceOrder = new Map(priorRaceIds.map((id, i) => [id, i]));

  // One query for every driver's/team's rolling form across this race's
  // whole field, instead of the old one-query-per-driver-per-team-per-race
  // approach (see FORM_LOOKBACK_RACES's comment).
  const formRows: FormRow[] =
    priorRaceIds.length > 0
      ? (
          await db
            .select({
              raceId: raceResults.raceId,
              driverId: raceResults.driverId,
              teamId: raceResults.teamId,
              finishPosition: raceResults.finishPosition,
              status: raceResults.status,
            })
            .from(raceResults)
            .where(inArray(raceResults.raceId, priorRaceIds))
        ).sort((a, b) => (priorRaceOrder.get(a.raceId) ?? 0) - (priorRaceOrder.get(b.raceId) ?? 0))
      : [];

  const driverRows = await db.select({ id: drivers.id, externalRef: drivers.externalRef }).from(drivers);
  const refById = new Map(driverRows.map((d) => [d.id, d.externalRef]));

  const era = eraFor(race.season);
  const out: XgboostFeatureRow[] = [];
  for (const g of validGrid) {
    const driverRef = refById.get(g.driverId);
    if (!driverRef) continue;
    const driverForm = rollingForm(formRows, (r) => r.driverId === g.driverId, 5);
    const teamForm = g.teamId != null ? rollingForm(formRows, (r) => r.teamId === g.teamId, 5) : { formFinish: null, dnfRate: null };
    out.push({
      driverRef,
      grid: g.gridPosition!,
      qualiGapToPole: gapByDriver.get(g.driverId) ?? null,
      driverFormFinish: driverForm.formFinish,
      driverDnfRate: driverForm.dnfRate,
      constructorFormFinish: teamForm.formFinish,
      constructorDnfRate: teamForm.dnfRate,
      era,
    });
  }
  return out.length > 0 ? out : null;
}
