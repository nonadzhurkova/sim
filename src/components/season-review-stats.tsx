import type { SeasonReviewSummary } from "@/queries/race-prediction";
import { STAGE_COLOR } from "@/components/hud-panel";

function fmtRate(r: { hits: number; total: number }): string {
  if (r.total === 0) return "—";
  return `${((r.hits / r.total) * 100).toFixed(0)}%`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * A pre-quali vs post-quali pair for one metric, rendered as two stacked
 * bars in one card -- putting the two numbers side by side (rather than as
 * separate same-sized cards, which made "pre" and "post" look unrelated) is
 * the point: the gap between the bars *is* the finding, "qualifying made the
 * model meaningfully more accurate."
 */
function ComparisonCard({
  title,
  sub,
  pre,
  post,
  preLabel,
  postLabel,
}: {
  title: string;
  sub?: string;
  pre: number | null;
  post: number | null;
  preLabel: string;
  postLabel: string;
}) {
  const max = Math.max(pre ?? 0, post ?? 0, 0.01);
  return (
    <div className="border border-[#262a35] bg-[#12141a] p-5">
      <p className="font-heading min-h-[3.25rem] text-lg font-bold leading-tight text-[#f2f3f5]">{title}</p>
      <div className="mt-4 flex flex-col gap-3">
        {([
          ["Pre-quali", pre, preLabel, STAGE_COLOR.preQuali],
          ["Post-quali", post, postLabel, STAGE_COLOR.postQuali],
        ] as const).map(([label, value, detail, color]) => (
          <div key={label}>
            <div className="flex items-baseline justify-between">
              <span className="hud-mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#8a91a3]">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </span>
              <span className="font-heading text-2xl font-extrabold" style={{ color: value == null ? "#f2f3f5" : color }}>
                {value == null ? "—" : `${(value * 100).toFixed(0)}%`}
              </span>
            </div>
            <div className="relative mt-1 h-1.5 bg-[#1e212b]">
              <div
                className="hud-bar-fill h-1.5"
                style={{ width: `${value == null ? 0 : Math.max((value / max) * 100, 2)}%`, backgroundColor: color }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[#5a6175]">{detail}</p>
          </div>
        ))}
      </div>
      {sub && <p className="mt-3 text-[11px] text-[#5a6175]">{sub}</p>}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[#262a35] bg-[#12141a] p-5">
      <p className="font-heading min-h-[3.25rem] text-lg font-bold leading-tight text-[#f2f3f5]">{label}</p>
      <p className="font-heading mt-2 text-4xl font-extrabold text-[#f2f3f5]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[#5a6175]">{sub}</p>}
    </div>
  );
}

/**
 * Season-level aggregates for the prediction-review page -- win-pick and
 * podium-pick hit rates pre- vs post-qualifying, a rough calibration read
 * (how confident the model was in the eventual winner), and how often
 * qualifying actually changed the top-3 call. The two rate metrics render
 * as pre/post comparison bars in one card each, since the pre-vs-post delta
 * is the point of this page, not the raw numbers in isolation.
 */
export function SeasonReviewStats({ summary }: { summary: SeasonReviewSummary }) {
  const preRate = summary.preQualiWinnerHitRate;
  const postRate = summary.postQualiWinnerHitRate;
  const prePodium = summary.preQualiPodiumHitRate;
  const postPodium = summary.postQualiPodiumHitRate;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <ComparisonCard
        title="Win pick hit rate"
        pre={preRate.total > 0 ? preRate.hits / preRate.total : null}
        post={postRate.total > 0 ? postRate.hits / postRate.total : null}
        preLabel={`${preRate.hits} of ${preRate.total} races`}
        postLabel={`${postRate.hits} of ${postRate.total} races`}
      />
      <ComparisonCard
        title="Podium hit rate"
        pre={prePodium.total > 0 ? prePodium.hits / prePodium.total : null}
        post={postPodium.total > 0 ? postPodium.hits / postPodium.total : null}
        preLabel={`${prePodium.hits} of ${prePodium.total} slots`}
        postLabel={`${postPodium.hits} of ${postPodium.total} slots`}
      />
      <ComparisonCard
        title="Confidence in eventual winner"
        sub="Average win% the model gave the driver who actually won"
        pre={summary.preQualiWinnerAvgWinPct}
        post={summary.postQualiWinnerAvgWinPct}
        preLabel={fmtPct(summary.preQualiWinnerAvgWinPct)}
        postLabel={fmtPct(summary.postQualiWinnerAvgWinPct)}
      />
      <StatCard
        label="Top-3 call changed after qualifying"
        value={summary.comparableRaceCount > 0 ? `${summary.topThreeChangedCount} of ${summary.comparableRaceCount}` : "—"}
        sub={
          summary.comparableRaceCount > 0
            ? `${fmtRate({ hits: summary.topThreeChangedCount, total: summary.comparableRaceCount })} of races — qualifying reshuffled the pick`
            : undefined
        }
      />
    </div>
  );
}
