# F1 Predictor — Frontend / UX Documentation

Written for an external reviewer (another AI or a person) being asked: **"is the page structure, navigation, component
organization, and visual design of this app optimal — what would you improve?"** This is not a technical/model
documentation file (see `README.md` for that); it covers pages, navigation, components, and theming/branding only.

The author's own standing concern, stated going in: *"the components, the order, the page, the nav are not optimal"* —
this doc exists to give a reviewer enough concrete detail to have an opinion about that, not to pre-argue a conclusion.

---

## 1. Page inventory

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Home dashboard — season status, stat tiles, top drivers/pace panels, race calendar, championship odds. |
| `/standings` | `src/app/standings/page.tsx` | Championship tables (drivers + teams) for a season, with a season picker. |
| `/drivers` | `src/app/drivers/page.tsx` | Grid/index of all drivers in the latest season. |
| `/driver/[driverId]` | `src/app/driver/[driverId]/page.tsx` | Individual driver profile — career/recent-form stats, optional circuit history. |
| `/team/[teamId]` | `src/app/team/[teamId]/page.tsx` | Constructor page — season standing, both drivers, full season results table. |
| `/race/[season]/[round]` | `src/app/race/[season]/[round]/page.tsx` | Main race-weekend dashboard (the app's most detailed page). |
| `/race/[season]/[round]/analysis` | `.../analysis/page.tsx` | Telemetry analysis subpage, live-fetched from OpenF1 per selected team. |
| `/race/[season]/[round]/prediction-review` | `.../prediction-review/page.tsx` | Post-hoc comparison of the model's prediction vs. actual race result. |

There is exactly **one** `layout.tsx` in the app — the root layout. No nested route segment defines its own
`layout.tsx`, `loading.tsx`, or `error.tsx` (confirmed empty for all three patterns outside the root).

---

## 2. Navigation

`src/app/layout.tsx` renders `<NavBar />` unconditionally above `{children}`, so every page gets the same header.

`src/components/nav-bar.tsx` is the entire nav implementation:
- A `<header>` with `border-b border-cyan-900/60 bg-[#05070a]/90 backdrop-blur` — **not sticky/fixed**, it scrolls
  away with the page.
- Left: a logo/home link styled `F1// PREDICTOR` in monospace cyan.
- Right: exactly **three** links — `Home` (`/`), `Standings` (`/standings`), `Drivers` (`/drivers`).

What's **not** in the nav:
- No link to any race page, and no races/schedule index page at all — the only way into `/race/[season]/[round]`
  is clicking through from the home page's race calendar or "Current Round" stat tile.
- No link to individual driver or team pages (reached only by clicking through from `/drivers`, `/standings`, or a
  race page).
- No breadcrumb. Back-navigation is ad hoc per page — each deep page hand-rolls its own "← back" link with a
  repeated class string (see §6).
- **No mobile/responsive treatment**: no hamburger menu, no collapsing behavior at any breakpoint. On a narrow
  viewport it's just a shrinking flex row.
- **No active-route indicator** — a user on `/standings` sees the same unstyled `Standings` link as everywhere else.

---

## 3. Component inventory (`src/components/`, 30 files)

**Shared primitives (~6)**
`hud-panel.tsx` (the base "card" — see §4), `stat-tile.tsx`, `team-badge.tsx` (custom geometric team marks, not
real logos — see note in §6), `animated-number.tsx`, `relative-time.tsx`, `local-date-time.tsx`.

**Navigation (1)**
`nav-bar.tsx`.

**Home-page panels (~6)**
`freshness-banner.tsx`, `import-button.tsx`, `race-list.tsx`, `title-odds-panel.tsx`, `top-drivers-panel.tsx`,
`top-base-pace-panel.tsx`.

**Race-detail panels (~13)**
`race-header.tsx`, `session-schedule-panel.tsx`, `session-pace-table.tsx`, `race-comparison.tsx`,
`fastest-lap-banner.tsx`, `pace-projection-panel.tsx`, `car-performance-panel.tsx`, `ratings-panel.tsx`,
`prediction-panel.tsx`, `xgboost-prediction-panel.tsx`, `track-map.tsx`, `telemetry-charts.tsx`,
`team-selector.tsx`, `prediction-review-table.tsx`.

**Driver/team/standings panels (~3)**
`driver-profile-panel.tsx`, `standings-tables.tsx` (+ `team-badge.tsx` reused here).

Roughly **20 of 30** components are single-purpose "panel" components (one per data section, built on `HudPanel`);
roughly 6-8 are true shared primitives. There is **no generic `Button`, `Badge`, `Card`, `Table`, or `Input`
primitive** — each panel builds its own table/button markup inline with Tailwind, which has produced some literal
duplication (see §6).

---

## 4. Theming & branding

**Stack**: Tailwind v4 (`@import "tailwindcss"` in `globals.css`; no `tailwind.config.js` — config lives in CSS).
Fonts via `next/font/google`: `Geist` (sans, body/headings) and `Geist_Mono` (exposed as the `.hud-mono` utility
class, used pervasively for labels, timestamps, buttons, section markers).

**Design language — deliberate sci-fi HUD / mission-control dashboard aesthetic.** `HudPanel`'s own doc comment:
*"Shared HUD-style panel: angular corner brackets, glowing cyan border, dark translucent background... so the
sci-fi dashboard aesthetic stays consistent."* Concrete manifestations:
- `HudPanel` draws four absolutely-positioned corner-bracket spans (targeting-reticle corners) plus a soft cyan
  `box-shadow` glow. It wraps nearly every card/table/panel in the app — it is the single dominant visual motif.
- Section headers use a `//` prefix convention (`{"//"} This weekend`, `{"//"} Ratings`) mimicking a code comment.
- Uppercase, letter-spaced, monospace micro-labels everywhere ("SYSTEM ONLINE", "IMPORT LOCKED").
- Custom animations reinforcing a "live system" feel: `.hud-scan` (traveling highlight sweep), `.hud-pulse`
  (brightness flicker), `.hud-ellipsis` (animated "..."), `.hud-bar-fill` (bars growing from 0 width). All four
  respect `prefers-reduced-motion: reduce`.
- Status bands (freshness banner) use colored glowing borders (red/amber/cyan) styled like alert klaxons rather
  than typical toast notifications.

**Palette** (CSS variables in `:root`):
- Background `#05070a` (near-black), panel surface `#0b1015`, border `#164e5c` (dark cyan).
- Accent `#22d3ee` (cyan-400-ish) / dim accent `#0e7490`.
- Text `#e2e8f0` (slate-200) / dim text `#64748b` (slate-500).
- Body background adds two faint radial cyan gradients (opacity 0.05-0.07) for a subtle glow vignette.
- Status colors (amber for "new data," red for "locked"/DNF, green for points-scoring positions, yellow for P1) are
  applied ad hoc via plain Tailwind utility classes per component, **not** defined as reusable theme tokens.
- Per-team colors live separately in `src/lib/team-colors.ts` (`TEAM_COLORS: Record<string, string>`, one hex per
  constructor, e.g. Red Bull `#3671C6`, Ferrari `#E8002D`), applied via inline `style={{ color: accent }}` since
  arbitrary hexes can't be static Tailwind classes. This is the only per-brand color system in the app.

**Dark/light mode**: dark-only by design. `color-scheme: dark` is hardcoded on `:root` and `html`; there is no
light-mode media query, no `dark:` variants anywhere, and no theme toggle. This is a deliberate constraint of the
HUD concept, not an oversight — worth stating explicitly so a reviewer doesn't flag "add light mode" as a
freebie without registering that it cuts against the aesthetic.

---

## 5. Page layout order (top to bottom, as written in JSX)

**Home (`/`)**
1. "System Online" label
2. `<h1>` "F1 Race Predictor"
3. `FreshnessBanner`
4. Stat tile grid: Season / Races Completed / Current Round (links to current race) / Next Race
5. Two-column grid: `TopDriversPanel` + `TopBasePacePanel`
6. `RaceList` (season calendar)
7. `TitleOddsPanel` (championship odds + race-by-race predictions)

**Race detail (`/race/[season]/[round]`)**
1. Header row: `RaceHeader` (prev/next arrows, round/circuit/date) + two buttons linking to the two subpages
   ("Prediction Review →", "Telemetry Analysis →")
2. `SessionSchedulePanel`
3. "// This weekend" — grid of `SessionPaceTable`s (one per session type) or an empty state
4. `CarPerformancePanel`
5. `FastestLapBanner`
6. *(conditional on practice data existing)* two-column grid: `PaceProjectionPanel` × 2 (qualifying pace / race
   pace projections)
7. `PredictionPanel` (Monte Carlo) — shown unconditionally, even for already-run races, deliberately (see its code
   comment: this is how the model gets validated against known results)
8. `XgboostPredictionPanel` — a second, independent model's panel, stacked directly below #7
9. *(conditional)* "// Ratings" → `RatingsPanel`
10. *(conditional)* `RaceComparison` (year-over-year)

**Standings (`/standings`)**
1. "Championship" label
2. `<h1>` "{season} Standings" + inline season-picker pills
3. Either an empty state or `StandingsTables` (drivers + teams)
4. Small footnote disclaimer (fastest-lap point not included)

---

## 6. Known inconsistencies / rough edges

These are observations, not yet-decided fixes — several may be intentional tradeoffs worth defending rather than
changing.

- **Nav omits the app's most-detailed page type.** There is no nav entry and no index page for races/schedule at
  all — getting to any race page requires going through the home page first.
- **No mobile nav.** The header has zero responsive handling at any breakpoint.
- **No active-route highlighting** in the nav bar.
- **No `loading.tsx`/`error.tsx` anywhere**, despite every page being an async server component doing multiple DB
  queries (and the analysis subpage explicitly fetching live from an external API "which takes seconds," per its
  own comment). Failures fall through to Next's default error page; there's no skeleton/spinner during
  server-side data fetches (only `FreshnessBanner`'s and `ImportButton`'s own client-side loading states, which are
  local to those components, not page-level). `notFound()` is used correctly and consistently, though.
- **Duplicated "back link" styling**, copy-pasted verbatim across four pages (`driver/[driverId]`,
  `team/[teamId]`, `race/.../analysis`, `race/.../prediction-review`) rather than factored into one component.
- **Two prediction panels stacked with no distinguishing framing.** `PredictionPanel` (Monte Carlo, production) and
  `XgboostPredictionPanel` (experimental second model) sit directly on top of each other under generic
  `<section className="mt-8">` wrappers, each with only its own internal title. A first-time visitor has no
  structural cue for "these are two different models, one is the real one" beyond reading both panels closely.
- **Inconsistent season-picker idiom.** The standings page exposes season choice as clickable pill links; the
  driver/team pages accept the same `?season=`-style parameter but expose no visible picker UI for it at all
  (you'd need to already know the query param); the race analysis subpage solves a conceptually similar
  "which team am I viewing" problem with its own independent `TeamSelector` component. Three different UI
  solutions to closely related "pick a scope" problems.
- **Data-access pattern is inconsistent.** Most pages fetch through a `@/queries/*` module
  (`getStandings`, `getRaceByRoute`, etc.); `drivers/page.tsx` and the two race subpages instead run raw Drizzle
  queries inline in the route file. Not a UX issue on its own, but it correlates with logic duplication (e.g.
  driver sorting is embedded directly in `drivers/page.tsx` rather than in a query function).
- **Team badges are intentionally not real logos** (`team-badge.tsx`'s own comment: original geometric marks, not
  trademarked logos) — a legal/design constraint, not a bug, but worth flagging so a reviewer doesn't mistake it
  for one.

---

## 7. Questions for the reviewer

Concrete things worth an opinion on, given the above:

1. Should there be a races/schedule index page, and should the nav bar link to it?
2. Is the "3 links, no mobile treatment, no active state" nav sufficient for the app's actual depth (8 route
   patterns, several with sub-pages), or does it need restructuring (e.g. a schedule dropdown, breadcrumbs)?
3. Is stacking the Monte Carlo and XGBoost prediction panels back-to-back the right call, or should they be
   tabbed/toggled, or should XGBoost be demoted to a collapsed/opt-in section given it's explicitly experimental?
4. Is the home page's section order (stat tiles → top drivers/pace → race calendar → title odds) the right
   priority order for a first-time visitor versus a returning one checking on the current race?
5. Should the season-picker pattern be unified into one shared component across standings/driver/team pages?
6. Any opinion on the HUD aesthetic itself (corner brackets, monospace everywhere, `//` section markers) as a
   sustained design language for a 9-page app — does it hold up, or does it start fighting readability on
   data-dense pages (e.g. the full-field prediction tables)?
