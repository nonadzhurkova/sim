# F1 Predictor — Frontend / UX Documentation

Written for an external reviewer (another AI or a person) being asked: **"is the page structure, navigation, component
organization, and visual design of this app optimal — what would you improve?"** This is not a technical/model
documentation file (see `README.md` for that); it covers pages, navigation, components, and theming/branding only.

This is the second pass. A first pass (see git history) surfaced concrete issues and a reviewer gave feedback in two
rounds ("high — must be changed" and "medium — better to be changed"); every item from both rounds has since been
acted on. This document describes the *current* state after those changes, plus what's still open.

---

## 1. Page inventory

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Home dashboard — next race first, championship odds, calendar, top drivers. |
| `/races` | `src/app/races/page.tsx` | Full season calendar as its own page, with a season picker. *(new)* |
| `/standings` | `src/app/standings/page.tsx` | Championship tables (drivers + teams) for a season, with a season picker. |
| `/drivers` | `src/app/drivers/page.tsx` | Table of every driver this season: team, points, base pace, DNF rate. *(rebuilt — was a card grid)* |
| `/driver/[driverId]` | `src/app/driver/[driverId]/page.tsx` | Individual driver profile — career/recent-form stats, optional circuit history. |
| `/team/[teamId]` | `src/app/team/[teamId]/page.tsx` | Constructor page — season standing, both drivers, full season results table, now with a season picker. |
| `/race/[season]/[round]` | `src/app/race/[season]/[round]/page.tsx` | Main race-weekend dashboard — prediction first, then schedule/session/car data. |
| `/race/[season]/[round]/analysis` | `.../analysis/page.tsx` | Telemetry analysis subpage, live-fetched from OpenF1 per selected team. |
| `/race/[season]/[round]/prediction-review` | `.../prediction-review/page.tsx` | Merged Monte Carlo + XGBoost comparison against the actual result, sorted by finishing order. |
| `/model` | `src/app/model/page.tsx` | Developer/model-internals page: data freshness, imports, driver/team ratings for a chosen race. *(new)* |

`error.tsx` (root) and `loading.tsx` (race detail + analysis routes) now exist — previously there were none anywhere
in the app.

---

## 2. Navigation

`src/components/nav-bar.tsx` (server component, fetches the next-race shortcut from the DB) renders
`src/components/nav-links.tsx` (client component) for the actual link list, so active-link highlighting can read
`usePathname()` without making the whole nav bar client-side.

- Left: logo/home link, `F1// PREDICTOR`.
- Right: `Home`, `Races`, `Standings`, `Drivers` — each highlighted (`text-cyan-300`) when active; `/` matches
  exactly, the others match their own subpaths too (e.g. `/drivers` stays lit while viewing `/driver/44`).
- A `Next Race →` button, resolved server-side, always links straight to the current/upcoming race.
- Still **not sticky/fixed** — scrolls away with the page. Still **no mobile/hamburger treatment** at any
  breakpoint (accepted as-is: three text links plus one button fit a narrow viewport without needing to collapse).

Back-navigation on deep pages now goes through a shared `Breadcrumbs` component (`src/components/breadcrumbs.tsx`)
instead of four independently copy-pasted "← back" links — used on the driver, team, analysis, and
prediction-review pages, e.g. `Races / Singapore / Prediction Review`.

---

## 3. Component inventory (`src/components/`)

**Shared primitives**
`hud-panel.tsx`, `stat-tile.tsx`, `team-badge.tsx`, `animated-number.tsx`, `relative-time.tsx`,
`local-date-time.tsx`, `breadcrumbs.tsx` *(new)*, `season-picker.tsx` *(new — replaces three independently
hand-rolled season-picker implementations)*.

**Navigation**
`nav-bar.tsx`, `nav-links.tsx` *(new, split out of nav-bar.tsx for the active-state client boundary)*.

**Home-page panels**
`race-list.tsx`, `title-odds-panel.tsx`, `top-drivers-panel.tsx`, `next-race-card.tsx` *(new)*.
`freshness-banner.tsx`/`import-button.tsx` and `top-base-pace-panel.tsx` moved off the home page — the freshness
banner now lives on `/model`; the base-pace panel was deleted outright, superseded by the drivers table.

**Race-detail panels**
`race-header.tsx`, `session-schedule-panel.tsx`, `session-pace-table.tsx`, `race-comparison.tsx`,
`fastest-lap-banner.tsx`, `pace-projection-panel.tsx`, `car-performance-panel.tsx`, `prediction-panel.tsx`,
`xgboost-prediction-panel.tsx`, `prediction-tabs.tsx` *(new — wraps the two prediction panels in a tabbed UI)*,
`track-map.tsx`, `telemetry-charts.tsx`, `team-selector.tsx`, `prediction-review-table.tsx`.

**Driver/team/standings panels**
`driver-profile-panel.tsx`, `standings-tables.tsx`, `ratings-panel.tsx` (moved to `/model`, no longer on the race
page directly — reachable via a "Model Ratings →" link).

There is still no generic `Button`/`Card`/`Table` primitive — each panel builds its own markup inline — but the two
most-duplicated patterns identified in the first pass (season pickers, back-links) are now factored out.

---

## 4. Theming & branding

Unchanged from the first pass except one fix: **all secondary/dim text moved from `text-slate-500` (`#64748b`,
~4:1 contrast on the panel background) to `text-slate-400` (`#94a3b8`, meets the 4.5:1 guideline)**, applied
across all 32 files that used it. Everything else — the HUD/mission-control aesthetic, `HudPanel`'s corner
brackets, the `//` section-header convention, the monospace micro-labels, the dark-only palette, per-team colors
via `getTeamColor()` — is as documented in the first pass and hasn't changed.

---

## 5. Page layout order (top to bottom, as written in JSX)

**Home (`/`)** — reordered to lead with what a returning visitor wants first:
1. "System Online" label, `<h1>`
2. `NextRaceCard` — the next/current race, its top-3 win chances (from a stored prediction if one exists), a link
   to the full race page
3. `TitleOddsPanel` (championship odds, expected wins, race-by-race predictions)
4. `RaceList` (season calendar)
5. Stat tile row: Season / Races Completed
6. `TopDriversPanel` (top 5) + a "View all drivers →" link to `/drivers`

**Race detail (`/race/[season]/[round]`)** — reordered so the prediction leads, not buried at position 7:
1. Header row: `RaceHeader` (prev/next arrows) + three buttons (Prediction Review, Telemetry Analysis, Model
   Ratings)
2. `PredictionTabs` — Monte Carlo ("Main Model") and XGBoost ("Experimental") as tabs, not stacked panels
3. `SessionSchedulePanel`
4. "// This weekend" — session pace tables
5. `CarPerformancePanel`
6. `FastestLapBanner`
7. *(conditional)* practice-pace projection panels
8. *(conditional)* `RaceComparison` (year-over-year)

`RatingsPanel` no longer appears here — moved to `/model`.

**`/model`** *(new)*: `FreshnessBanner` (+ its `ImportButton`), then `RatingsPanel` for a chosen race (defaults to
current/next, or `?race=season-round`).

**`/races`** *(new)*: title + `SeasonPicker`, then `RaceList` — the same calendar component the home page uses.

**Standings / Team** — both now use the shared `SeasonPicker`; the team page gained one where it previously had
none (a `?season=` param existed but no visible control for it).

---

## 6. What changed since the first pass (mapped to reviewer feedback)

**High priority — all addressed:**
1. Prediction moved from position 7 to position 2 on the race page.
2. Home page reordered to lead with the next race.
3. `/races` page added, linked from the nav.
4. `error.tsx` (root) and `loading.tsx` (race + analysis routes) added.

**Medium priority — all addressed:**
5. Developer/model tooling (freshness, imports, ratings) split onto `/model`, off the fan-facing pages.
6. Monte Carlo vs. XGBoost are now tabs, Monte Carlo default, labelled Main Model / Experimental.
7. Nav has active-link highlighting; four copy-pasted back-links replaced with one `Breadcrumbs` component.
8. Text contrast fixed (`slate-500` → `slate-400`, 32 files).
9. One shared `SeasonPicker` component, used on standings/races/team pages.

**Additional fixes made along the way, not in the original feedback:**
- The drivers page was rebuilt from a card grid into a sortable-by-points table with the model's actual ratings
  (base pace, DNF rate) per driver, since a user asked to see that data in one place. Two columns considered for
  it — practice pace and track affinity — were deliberately *not* included: both are computed relative to one
  specific race (practice pace to that weekend's sessions, track affinity to that race's circuit type), so neither
  has a single meaningful season-level value: showing "the value from whichever race happened to be stored last"
  would silently mislabel a per-race number as a season stat. They remain visible per-race on the driver/race
  pages instead, where "which race" is unambiguous.
- Base pace on the drivers table is colored green (negative — faster than the field) vs. red (positive), so the
  faster/slower split is readable at a glance rather than requiring the reader to parse the sign.
- DNF rate is recency-weighted (5-race half-life), not a plain DNFs/races count, which can make two drivers with
  an identical DNF *count* show different percentages depending on how recently each one happened — flagged
  explicitly in a footnote and column tooltip after it read as an inconsistency without that context.

---

## 7. Still open / not addressed

- **No mobile nav** — accepted as fine for the current link count (four links + one button), revisit if the nav
  grows further.
- **No generic UI primitives** (`Button`, `Card`, `Table`) — panels still each build their own markup. Lower
  priority than the season-picker/breadcrumb duplication that was fixed, since it's more pervasive and would be a
  larger refactor for less immediate benefit.
- **No backtest/calibration UI** — `/model` currently shows live ratings only; backtest results and calibration
  buckets (mentioned as a possible `/model` addition) still only exist as CLI script output
  (`npm run backtest`, `npm run calibrate`). Deliberately out of scope for this pass — a UI for that would be new
  work, not a relocation of existing UI.
- **Data-access pattern is still inconsistent** — most pages fetch through `@/queries/*`; `drivers/page.tsx` and
  the race subpages still run raw Drizzle queries inline. Not touched in this pass.
