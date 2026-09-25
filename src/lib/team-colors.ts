/**
 * Approximate current-livery team colors, keyed by the team name as stored
 * in our `teams` table (from Ergast/Jolpica constructor names). Used for
 * accent bars/badges in tables. Falls back to hud cyan for unknown teams
 * (e.g. a historical team name not in this list).
 */
export const TEAM_COLORS: Record<string, string> = {
  "Red Bull": "#3671C6",
  Ferrari: "#E8002D",
  Mercedes: "#27F4D2",
  McLaren: "#FF8000",
  "Aston Martin": "#229971",
  Alpine: "#00A1E8",
  "Alpine F1 Team": "#00A1E8",
  Williams: "#64C4FF",
  "RB F1 Team": "#6692FF",
  Sauber: "#52E252",
  "Haas F1 Team": "#B6BABD",
  Audi: "#00B562",
  "Cadillac F1 Team": "#8B8B8B",
};

export function getTeamColor(teamName: string | null | undefined): string {
  if (!teamName) return "#22d3ee";
  return TEAM_COLORS[teamName] ?? "#22d3ee";
}
