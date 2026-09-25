import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { ingestSeason } = await import("./jolpica");
  const { ingestSeasonSessions } = await import("./openf1");

  const [, , source, seasonArg] = process.argv;
  const season = seasonArg ? parseInt(seasonArg, 10) : new Date().getFullYear();

  if (source === "jolpica") {
    await ingestSeason(season);
  } else if (source === "openf1") {
    await ingestSeasonSessions(season);
  } else if (source === "all") {
    await ingestSeason(season);
    await ingestSeasonSessions(season);
  } else {
    console.error("Usage: tsx src/ingest/run.ts <jolpica|openf1|all> [season]");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
