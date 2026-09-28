/**
 * Maps Jolpica/Ergast's free-text circuit country names to ISO 3166-1
 * alpha-2 codes for flagcdn.com. Jolpica has no circuit-image or flag field
 * of its own (confirmed against its live API) -- this is the full,
 * confirmed set of countries in this app's circuits table, not a general
 * country-name parser.
 */
const COUNTRY_TO_ISO2: Record<string, string> = {
  Australia: "au",
  Austria: "at",
  Azerbaijan: "az",
  Bahrain: "bh",
  Belgium: "be",
  Brazil: "br",
  Canada: "ca",
  China: "cn",
  Hungary: "hu",
  Italy: "it",
  Japan: "jp",
  Malaysia: "my",
  Mexico: "mx",
  Monaco: "mc",
  Netherlands: "nl",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Singapore: "sg",
  Spain: "es",
  UAE: "ae",
  UK: "gb",
  USA: "us",
};

export function flagUrlForCountry(country: string | null): string | null {
  if (!country) return null;
  const iso2 = COUNTRY_TO_ISO2[country];
  if (!iso2) return null;
  return `https://flagcdn.com/w80/${iso2}.png`;
}
