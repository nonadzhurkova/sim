import { getTeamColor } from "@/lib/team-colors";

/**
 * Small team marker shown before a driver's name, in the slot F1 broadcasts
 * use for a constructor logo.
 *
 * These are original geometric marks in each team's livery colour, not the
 * teams' actual logos — those are trademarked and aren't part of this project.
 * The goal is the same at-a-glance grouping a logo provides: each team gets a
 * distinct silhouette, so the two cars of a team read as a pair even when the
 * colours are close (Red Bull's blue against RB's, say).
 */

type MarkShape =
  | "bull"
  | "prancing"
  | "star"
  | "chevron"
  | "wings"
  | "arrow"
  | "wave"
  | "hex"
  | "circle"
  | "bars"
  | "rings"
  | "crest";

/** Which silhouette each team gets. Nods to the real marks where one exists. */
const TEAM_SHAPES: Record<string, MarkShape> = {
  "Red Bull": "bull",
  Ferrari: "prancing",
  Mercedes: "star",
  McLaren: "chevron",
  "Aston Martin": "wings",
  Alpine: "arrow",
  "Alpine F1 Team": "arrow",
  Williams: "wave",
  "RB F1 Team": "hex",
  Sauber: "circle",
  "Haas F1 Team": "bars",
  Audi: "rings",
  "Cadillac F1 Team": "crest",
};

function shapeFor(teamName: string | null | undefined): MarkShape {
  if (!teamName) return "circle";
  return TEAM_SHAPES[teamName] ?? "circle";
}

function MarkPath({ shape }: { shape: MarkShape }) {
  switch (shape) {
    case "bull":
      // Charging silhouette: two horns over a body.
      return (
        <path d="M2 5 L5 3 L6 6 L10 6 L11 3 L14 5 L12.5 8 Q8 12 3.5 8 Z" />
      );
    case "prancing":
      // Rearing form, tall and narrow.
      return <path d="M6 2 L9 4 L8.5 7 L11 9 L10 13 L7 11 L5 13 L5.5 8 L4 5 Z" />;
    case "star":
      // Three-pointed star.
      return (
        <path d="M8 1.5 L9.1 7 L14 10.2 L12.9 12 L8 9.2 L3.1 12 L2 10.2 L6.9 7 Z" />
      );
    case "chevron":
      // Speedmark swoosh.
      return <path d="M1 11 Q6 4 15 3 Q9 6.5 6.5 12 Z" />;
    case "wings":
      return (
        <path d="M8 3 L14.5 7 L10 7.5 L8 12.5 L6 7.5 L1.5 7 Z" />
      );
    case "arrow":
      return <path d="M8 2 L14 12 L8 9.5 L2 12 Z" />;
    case "wave":
      return (
        <path d="M1 9 Q4.5 3 8 6.5 Q11.5 10 15 4.5 L15 8 Q11.5 13.5 8 10 Q4.5 6.5 1 12 Z" />
      );
    case "hex":
      return <path d="M8 1.5 L14 5 L14 11 L8 14.5 L2 11 L2 5 Z" />;
    case "circle":
      return <circle cx="8" cy="8" r="5.5" />;
    case "bars":
      return <path d="M2 3 L6 3 L6 13 L2 13 Z M9 3 L13.5 3 L13.5 8 L9 8 Z" />;
    case "rings":
      // Interlocking rings, drawn as strokes rather than fills.
      return (
        <g fill="none" strokeWidth="1.6">
          <circle cx="5.5" cy="8" r="3.4" />
          <circle cx="10.5" cy="8" r="3.4" />
        </g>
      );
    case "crest":
      return <path d="M8 1.5 L14 4 L14 8.5 Q14 12.5 8 14.5 Q2 12.5 2 8.5 L2 4 Z" />;
  }
}

export function TeamBadge({
  teamName,
  size = 16,
  className = "",
}: {
  teamName: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const color = getTeamColor(teamName);
  const shape = shapeFor(teamName);
  const isStroked = shape === "rings";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      // The name is the accessible label; the mark itself is decoration.
      role="img"
      aria-label={teamName ?? "Unknown team"}
      fill={isStroked ? "none" : color}
      stroke={isStroked ? color : "none"}
    >
      <title>{teamName ?? "Unknown team"}</title>
      <MarkPath shape={shape} />
    </svg>
  );
}
