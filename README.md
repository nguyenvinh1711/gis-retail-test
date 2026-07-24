# gis-retail

Multi-tenant GIS SaaS demo MVP. See [`docs/PLAN.md`](docs/PLAN.md) for the full product plan.

## What's in this demo

- **Public layers**: Vietnam province boundaries, 377 sample supermarket locations.
- **Premium layer**: supermarket density heatmap — locked behind a mock per-tenant entitlement.
- **Mock auth**: cookie-based sign-in (no real backend yet).
- **Dashboard**: per-tenant view to "buy" / refund the premium layer.
- **Base map switcher**: MapTiler (if API key set) or OpenFreeMap; toggle live in the UI.

## Run it

```bash
npm install         # if not done already
npm run dev
```

Open http://localhost:3000.

### Optional: MapTiler key

Create `.env.local`:

```
NEXT_PUBLIC_MAPTILER_KEY=your_free_tier_key
```

Without it, the app uses OpenFreeMap by default.

## Regenerating demo data

```bash
node scripts/build-supermarkets-geojson.mjs
```

Reads `sample_datas/Supermarket.xlsx` and writes `public/data/supermarkets.geojson`.
Because the source file has no lat/lng, the script approximates locations from city centroids
with deterministic jitter. Replace with real geocoding for production.

Vietnam province boundaries (`public/data/vn-provinces.geojson`) come from geoBoundaries
([ADM1 simplified](https://www.geoboundaries.org/)) and are already checked in.

## Layout

```
src/
  app/
    page.tsx             landing
    map/page.tsx         map demo
    signin/page.tsx      mock sign-in
    dashboard/page.tsx   tenant dashboard
    actions.ts           server actions (signin, buy, refund)
  components/
    Navbar.tsx
    MapView.tsx          MapLibre client + layer panel
  lib/
    auth.ts              cookie-based session helpers
    layers.ts            static layer catalog
    basemap.ts           base map style URLs
public/data/             GeoJSON sources
sample_datas/            raw inputs (xlsx)
scripts/                 one-off data prep
docs/PLAN.md             product plan
```

## Next steps (from the plan)

Real PostGIS, Martin tile server, Stripe billing, multi-tenant RLS, file upload pipeline — see `docs/PLAN.md`.
