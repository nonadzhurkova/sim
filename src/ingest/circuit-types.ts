import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Manual classification — neither Jolpica/Ergast nor OpenF1 exposes circuit
 * type. Judgment calls based on layout: street = temporary public-road
 * circuits with walls; high_speed = low downforce, few slow corners, high
 * average speed; technical = tight, high-downforce, low average speed.
 */
const CIRCUIT_TYPES: Record<string, "street" | "high_speed" | "technical"> = {
  albert_park: "high_speed", // reprofiled 2022+, faster/flowing now
  imola: "technical",
  monza: "high_speed",
  rodriguez: "technical", // Mexico City, high altitude, tight stadium section
  interlagos: "technical",
  bahrain: "high_speed",
  baku: "street",
  villeneuve: "technical", // Montreal, walls but not a classic street track
  zandvoort: "technical", // narrow, banked, low-speed corners
  catalunya: "technical",
  monaco: "street",
  spa: "high_speed",
  americas: "technical", // COTA, mixed but characterized by Esses/technical sections
  hungaroring: "technical",
  jeddah: "street",
  vegas: "street",
  losail: "high_speed",
  madring: "technical", // Madrid, new 2026 street/park hybrid circuit
  marina_bay: "street",
  miami: "street", // temporary circuit around Hard Rock Stadium
  red_bull_ring: "high_speed",
  sepang: "high_speed",
  shanghai: "technical",
  silverstone: "high_speed",
  suzuka: "technical", // iconic but defined by technical Esses/130R combination
  yas_marina: "technical",
};

async function main() {
  const { db } = await import("@/db");
  const { circuits } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  for (const [externalRef, type] of Object.entries(CIRCUIT_TYPES)) {
    const result = await db
      .update(circuits)
      .set({ type })
      .where(eq(circuits.externalRef, externalRef))
      .returning({ name: circuits.name });
    if (result.length === 0) {
      console.warn(`[circuit-types] no circuit found for external_ref=${externalRef}`);
    } else {
      console.log(`[circuit-types] ${result[0].name} -> ${type}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
