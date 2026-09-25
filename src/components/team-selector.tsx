"use client";

import { useState } from "react";
import { TeamBadge } from "./team-badge";
import { getTeamColor } from "@/lib/team-colors";
import { TeamAnalysisPanel } from "./team-analysis-panel";

/**
 * Team picker for the analysis page. The chosen team drives a single
 * TeamAnalysisPanel, which is where the actual OpenF1 fetch happens — so
 * switching teams resets the panel rather than running every team at once.
 */
export function TeamSelector({
  raceId,
  teamNames,
  initialTeam,
}: {
  raceId: number;
  teamNames: string[];
  initialTeam: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(
    initialTeam && teamNames.includes(initialTeam) ? initialTeam : null,
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {teamNames.map((name) => {
          const active = selected === name;
          const color = getTeamColor(name);
          return (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className={`flex items-center gap-2 border px-3 py-2 text-xs transition-colors ${
                active
                  ? "bg-slate-900/80 text-slate-100"
                  : "border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
              style={active ? { borderColor: color } : undefined}
            >
              <TeamBadge teamName={name} size={16} />
              {name}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {selected ? (
          // Remounting per team keeps each analysis isolated: a stale report
          // from the previous team should never linger while a new one loads.
          <TeamAnalysisPanel key={selected} raceId={raceId} team={selected} />
        ) : (
          <p className="hud-mono text-xs text-slate-500">
            SELECT A TEAM TO ANALYSE.
          </p>
        )}
      </div>
    </div>
  );
}
