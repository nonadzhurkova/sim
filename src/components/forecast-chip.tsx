import type { SessionForecast } from "@/app/api/session-weather/route";

/** Rain-chance color: quiet gray when unlikely, amber climbing to red as it gets more likely. */
function rainColor(pct: number): string {
  if (pct >= 60) return "#ef3a3a";
  if (pct >= 30) return "#f3c13a";
  return "#8a91a3";
}

/** Full-size chip: temperature, rain chance, and wind side by side. */
export function ForecastChip({ forecast }: { forecast: SessionForecast }) {
  return (
    <span className="hud-mono inline-flex items-center gap-2 border border-[#262a35] bg-[#12141a] px-2 py-1 text-[11px]">
      <span className="text-[#f2f3f5]">{Math.round(forecast.temperatureC)}°C</span>
      <span style={{ color: rainColor(forecast.precipitationProbabilityPct) }}>
        {Math.round(forecast.precipitationProbabilityPct)}% rain
      </span>
      <span className="text-[#8a91a3]">{Math.round(forecast.windSpeedKmh)} km/h wind</span>
    </span>
  );
}
