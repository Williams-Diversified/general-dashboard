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

### SAM.gov proxy (bundled)

SAM.gov's Opportunities API needs an API key **and** doesn't send CORS headers,
so the browser can't call it directly. This repo ships a small proxy that
injects the key server-side:

- **Production:** `api/sam.ts` is a serverless function — Vercel deploys any
  file in `api/` automatically (works the same on Netlify/other Node hosts).
- **Local dev:** a Vite middleware (`samDevProxy` in `vite.config.ts`) serves
  the identical route at `/api/sam` during `npm run dev`.

Both share `api/_samProxy.ts` and read the key from **`SAM_API_KEY`** (note: no
`VITE_` prefix, so it stays server-side and never reaches the browser bundle).
The client calls `/api/sam` by default (`VITE_SAM_PROXY`).

```bash
# .env.local
VITE_USE_LIVE_DATA=true
SAM_API_KEY=your_sam_gov_key   # server-side only
```

Deploy to Vercel:

```bash
npm i -g vercel
vercel            # set SAM_API_KEY in the project's Environment Variables
```

### Implementation notes

- API clients live in `src/lib/api/` (`usaspending.ts`, `sam.ts`, `http.ts`).
- The SAM proxy lives in `api/` (`sam.ts` endpoint + `_samProxy.ts` core).
- `useDataset(loader, fallback)` (`src/hooks/useDataset.ts`) handles the
  live-vs-demo logic, loading state, and fallback.
- USAspending returns a single current award amount per contract, so the
  Contracts page shows obligated = total for live awards.
