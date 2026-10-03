"use client";

import { useEffect, useState } from "react";
import { HudPanel } from "./hud-panel";

type FieldEntry = { driverId: number; driverName: string; gridPosition: number };
type Penalty = { id: number; driverId: number; driverName: string; placesOffset: number; reason: string | null };

/**
 * Manual grid-penalty entry, inline on the race page -- see gridPenalties'
 * doc comment in schema.ts for why this is manual rather than sourced from
 * an API. Only shown pre-race (the race page only mounts this before the
 * result exists); a penalty entered here is picked up by both the Monte
 * Carlo and XGBoost grid pipelines on their next run (applyGridPenalties in
 * entrants.ts), so re-running the prediction panel after adding one here
 * reflects it immediately.
 */
export function GridPenaltiesPanel({ raceId }: { raceId: number }) {
  const [field, setField] = useState<FieldEntry[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDriverId, setSelectedDriverId] = useState<number | "">("");
  const [places, setPlaces] = useState(5);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/grid-penalties?raceId=${raceId}`);
      const data = await res.json();
      if (res.ok) {
        setField(data.field);
        setPenalties(data.penalties);
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [raceId]);

  async function addPenalty() {
    if (selectedDriverId === "") return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/grid-penalties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceId, driverId: selectedDriverId, placesOffset: places, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      setSelectedDriverId("");
      setReason("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removePenalty(driverId: number) {
    setSaving(true);
    try {
      await fetch(`/api/grid-penalties?raceId=${raceId}&driverId=${driverId}`, { method: "DELETE" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  // No qualifying grid at all yet -- nothing to attach a penalty to.
  if (field.length === 0 && penalties.length === 0) return null;

  const penalizedIds = new Set(penalties.map((p) => p.driverId));
  const pickableField = field.filter((f) => !penalizedIds.has(f.driverId));

  return (
    <HudPanel title="Grid penalties">
      {penalties.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {penalties.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 border border-[#262a35] bg-[#0b0c10] px-3 py-2">
              <span className="text-sm text-[#f2f3f5]">
                <span className="font-medium">{p.driverName}</span>
                <span className="hud-mono ml-2 text-xs text-amber-400">
                  {p.placesOffset >= 99 ? "back of grid" : `+${p.placesOffset} places`}
                </span>
                {p.reason && <span className="ml-2 text-xs text-[#5a6175]">({p.reason})</span>}
              </span>
              <button
                onClick={() => removePenalty(p.driverId)}
                disabled={saving}
                className="hud-mono text-xs uppercase tracking-wider text-[#5a6175] transition-colors hover:text-red-400 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pickableField.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="hud-mono text-[10px] uppercase tracking-wider text-[#8a91a3]">Driver</span>
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value ? Number(e.target.value) : "")}
              className="min-h-10 border border-[#262a35] bg-[#0b0c10] px-2 text-sm text-[#f2f3f5]"
            >
              <option value="">Select driver...</option>
              {pickableField.map((f) => (
                <option key={f.driverId} value={f.driverId}>
                  P{f.gridPosition} {f.driverName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="hud-mono text-[10px] uppercase tracking-wider text-[#8a91a3]">Places</span>
            <input
              type="number"
              min={1}
              value={places}
              onChange={(e) => setPlaces(Math.max(1, Number(e.target.value)))}
              className="min-h-10 w-20 border border-[#262a35] bg-[#0b0c10] px-2 text-sm text-[#f2f3f5]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="hud-mono text-[10px] uppercase tracking-wider text-[#8a91a3]">Reason (optional)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. gearbox change"
              className="min-h-10 w-48 border border-[#262a35] bg-[#0b0c10] px-2 text-sm text-[#f2f3f5]"
            />
          </label>
          <button
            onClick={addPenalty}
            disabled={saving || selectedDriverId === ""}
            className="font-heading min-h-10 border-0 bg-red-500 px-4 text-sm font-bold uppercase tracking-wide text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add penalty
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </HudPanel>
  );
}
