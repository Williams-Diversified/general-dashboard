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

## Note on Data

All data in `src/data/mockData.ts` is **fictional** and for demonstration only.
Notice ids, award ids, and dollar amounts are illustrative. To connect real
data, swap the mock arrays for fetches against a source such as the
[SAM.gov](https://sam.gov/) or [USAspending.gov](https://www.usaspending.gov/)
APIs.
