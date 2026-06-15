# GovDash

A frontend-only **government contracting dashboard** for tracking federal
opportunities, awarded contracts, and agency obligations. Built as a clean,
self-contained demo with mock data — no backend required.

## Features

- **Overview** — KPI cards, monthly obligations trend, obligations-by-agency
  chart, and a "closing soon" feed.
- **Opportunities** — SAM.gov-style solicitation table with status filters and
  search across title, agency, and notice id.
- **Contracts** — Award cards showing obligated-vs-ceiling progress.

## Tech Stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) for dev server and build
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [React Router](https://reactrouter.com/) for navigation
- [Recharts](https://recharts.org/) for charts

## Getting Started

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build      # type-check and build for production
npm run preview    # preview the production build
npm run lint       # run ESLint
npm run typecheck  # type-check without emitting
```

## Project Structure

```
src/
  components/   # Layout, Sidebar, StatCard, StatusBadge
  data/         # types and mock data (opportunities, contracts, spend)
  lib/          # formatting helpers (currency, dates)
  pages/        # Overview, Opportunities, Contracts
  App.tsx       # routes
  main.tsx      # entry point
```

## Data Sources

The app ships with **bundled demo data** (`src/data/mockData.ts`) and runs fully
offline by default. It can also pull **live federal data**, falling back to the
demo data whenever a request is disabled, fails, or returns nothing — so the UI
is never empty.

| Page | Live source | Key required | Browser-friendly? |
|------|-------------|--------------|-------------------|
| Overview (agency spend, monthly obligations) | [USAspending.gov](https://api.usaspending.gov/) | No | ✅ Yes (CORS-enabled) |
| Contracts (recent awards) | USAspending.gov | No | ✅ Yes |
| Opportunities (solicitations) | [SAM.gov](https://open.gsa.gov/api/get-opportunities-public-api/) | Yes | ⚠️ No — needs a proxy |

### Enabling live data

```bash
cp .env.example .env.local
# edit .env.local:
#   VITE_USE_LIVE_DATA=true
#   VITE_SAM_API_KEY=...   (only needed for the Opportunities page)
npm run dev
```

Each page shows a small banner indicating whether it's displaying **live** or
**demo** data, and why.

> **SAM.gov CORS caveat:** SAM.gov's Opportunities API does not send CORS
> headers, so a browser cannot call it directly. The Opportunities page will
> attempt the call and gracefully fall back to demo data. For real live
> opportunities, stand up a small proxy that injects the `api_key` server-side
> and set `VITE_SAM_BASE` to point at it.

### Implementation notes

- API clients live in `src/lib/api/` (`usaspending.ts`, `sam.ts`, `http.ts`).
- `useDataset(loader, fallback)` (`src/hooks/useDataset.ts`) handles the
  live-vs-demo logic, loading state, and fallback.
- USAspending returns a single current award amount per contract, so the
  Contracts page shows obligated = total for live awards.
