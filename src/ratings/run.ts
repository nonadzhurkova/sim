import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { computeSeasonRatings } = await import("./compute");
  const [, , seasonArg] = process.argv;
  const season = seasonArg ? parseInt(seasonArg, 10) : new Date().getFullYear();
  await computeSeasonRatings(season);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
