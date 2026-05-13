# Plan: Multi-tenant GIS SaaS (mapdy.vn / gisxaydung-style + extensible layers)

## Context

You want to build a SaaS GIS web app inspired by mapdy.vn and gisxaydung.tphcm.gov.vn, but generalized so you can keep adding map layers (population, planning, planting season, weather, etc.). v1 must be multi-tenant: tenants get their own workspace, can use shared public layers, can upload/manage their own private layers, and some layers are gated by subscription or one-time purchase. Admins (yours and per-tenant) manage layer visibility and authorization. The goal of this plan is to lock in a tech stack, an MVP feature scope, and the open-source pieces to leverage so you can move fast without painting yourself into a corner — and to honestly assess viability.

---

## Recommended Stack (honest answer)

**Frontend + App server:** Next.js 15 (TypeScript, App Router) on Vercel or Node.
**Database:** PostgreSQL 16 with **PostGIS** extension (single source of truth — vector data, tenant rows, entitlements).
**Vector tiles:** **Martin** (Rust, by the MapLibre org) — serves MVT tiles directly from PostGIS tables/functions. Fastest path for dynamic, tenant-filtered layers.
**Raster tiles (weather, satellite, NDVI):** **TiTiler** (Python/FastAPI) on COG (Cloud-Optimized GeoTIFF) files in S3-compatible storage.
**Map client:** **MapLibre GL JS** (free, open-source, vector + raster, fast).
**Auth + multi-tenant:** **Clerk** or **WorkOS** (built-in Organizations = tenants, RBAC, SSO). Alternative: Auth.js + your own tenants table if you want zero vendor lock-in.
**Billing/entitlements:** **Stripe** (subscriptions + one-time purchases) → write entitlements into Postgres.
**File ingest pipeline:** background worker (BullMQ on Redis, or Inngest) running **GDAL/ogr2ogr** + **Tippecanoe** (only for huge GeoJSON → MBTiles/PMTiles).
**Static tile fallback for huge public datasets:** **PMTiles** on S3/CDN (single-file format, no tile server needed).
**Geocoding / address search:** start with **Nominatim** (self-hosted OSM) for free coverage; if Vietnamese address quality is poor, layer in a paid provider (Goong, Here, Mapbox) behind one interface.
**Base map:** **Protomaps** or **OpenFreeMap** (free, self-hostable) — avoid Mapbox/Google lock-in.

### Why not Python (GeoDjango) or Go?

- **GeoDjango**: mature, great admin, but slower SaaS iteration (billing UIs, Stripe webhooks, real-time client interactions) compared to Next.js. Use Python only where it shines: TiTiler for raster, and Jupyter-style data prep.
- **Go**: excellent for high-throughput tile servers, but Martin (Rust) already solves that and is more featureful. Ecosystem for SaaS scaffolding is thinner.
- **GeoNode / MapStore (full platforms)**: tempting, but they're built for gov/agency single-tenant deployments. Bending them into multi-tenant SaaS with Stripe and per-layer entitlements is more painful than building on a clean Next.js + PostGIS base.

**Bottom line:** Next.js + PostGIS + Martin + MapLibre is the rightmost answer for *fast SaaS dev with serious GIS underneath*. You only reach for Python/Go where they're genuinely better (raster, heavy batch).

---

## Open-source pieces to leverage (don't reinvent)

| Need | Library / Service |
|---|---|
| Map client | MapLibre GL JS |
| Vector tiles from PostGIS | Martin (or pg_tileserv) |
| Raster tiles (weather, NDVI) | TiTiler + rio-cogeo |
| Static tile distribution | PMTiles (protomaps/pmtiles) |
| Base map tiles | Protomaps, OpenFreeMap, MapTiler (paid tier optional) |
| Geocoding | Nominatim (self-host), Pelias |
| Format conversion (Shapefile→GeoJSON→tiles) | GDAL/ogr2ogr, Tippecanoe |
| Drawing/measurement | mapbox-gl-draw (works with MapLibre), Turf.js |
| Heavy WMS/WFS server (if needed later) | GeoServer |
| Auth/Orgs | Clerk, WorkOS, or Auth.js |
| Billing | Stripe |
| Background jobs | BullMQ + Redis, or Inngest |
| Weather data | Open-Meteo (free, no key), NASA POWER, OpenWeather |
| OSM Vietnam data | Geofabrik daily extracts |
| Vietnam admin boundaries | GADM, HDX |

---

## Core features to focus on (MVP — v1)

Ordered by what unlocks the SaaS. **Do these in order.**

1. **Tenant + auth foundation.** Organizations, members, roles (owner/admin/editor/viewer). RBAC enforced via Postgres RLS + app-layer checks. This *is* the SaaS — get it right early.
2. **Map viewer.** MapLibre + base map + layer toggle panel + legend + opacity slider + zoom-to-extent. Cookie-cuttered from MapLibre examples; ~1 week.
3. **Layer catalog & entitlements.** A `layers` table with `visibility` (public / tenant / paid), `price_model` (free / subscription / one-time), and a `tenant_layer_entitlements` join. Backend filters tile requests by entitlement. Hardest *correct* part of the SaaS.
4. **Public seed layers.** You ingest 3–5 baseline layers yourself: Vietnam admin boundaries, population (WorldPop), OSM POIs, basic land-use, weather (Open-Meteo proxy). Proves the platform and gives free-tier users value.
5. **Tenant layer upload.** Drag-drop GeoJSON/Shapefile/CSV-with-lat-lon → background job: validate → ogr2ogr to PostGIS → register layer → if huge, Tippecanoe → PMTiles on S3. Per-tenant table prefix or schema.
6. **Admin dashboard.** Your-side superadmin: manage all layers, set pricing, approve uploads. Tenant-side admin: manage their own layers, members, billing.
7. **Address / parcel search.** Nominatim-backed search box → fly-to + highlight. Parcel data is the Vietnamese-market expectation but is the *hardest* dataset to source legally — flag as risk (see below).
8. **Stripe billing.** Tenant subscribes to a plan or buys access to a paid layer → webhook writes entitlement row. Layer requests check the row.
9. **Drawing & measurement.** mapbox-gl-draw + Turf.js. ~2 days. High perceived value, near-zero cost.

### What I'd push to v2

- **Time-series / animated layers** (weather over time, planting calendar progression). Cool but requires a different data model (temporal partitioning, time slider UI). Ship a static "current week" weather layer in v1, animate in v2.
- **Heavy WMS/WFS server** (GeoServer). Only stand up if a customer specifically needs OGC compliance.
- **In-map editing of features** (collaborative GIS). Big scope creep.

### Service-commerce angle (your instinct is right)

The pure SaaS subscription is rarely enough in GIS. The money tends to be in:

- **Curated premium datasets** (parcel/planning data digitized by you, sold per-layer or per-region).
- **Done-for-you onboarding**: customer hands you their Excel/Shapefile mess, you ingest and style it.
- **White-label deployments** for provincial governments / agritech companies.
- **API access** (per-call pricing) for developers who want your tiles in their own apps.

Architect for this from day 1: every layer has a price, every tile request is authenticated, and your platform can deliver layers via map UI *or* tile API.

---

## Viability assessment

**Yes, viable** — but scope honestly.

- **Solo dev, full-time, no GIS background**: realistic MVP (steps 1–6 above) in **4–6 months**.
- **Solo dev with prior web SaaS experience**: **3–4 months**.
- **2–3 person team**: **8–12 weeks** to a paid-customer-ready MVP.

**Hard parts that will eat time:**

1. **Tile pipeline for large datasets** — first time you ingest a 2 GB Shapefile, expect a week of pain.
2. **Vietnamese parcel/planning data acquisition** — gisxaydung has *years* of digitization behind it. You will not match it from scratch. Strategy: don't try; instead, offer tools so *customers* upload their own parcel data, and you sell the platform, not the data.
3. **Per-layer entitlement enforcement at the tile level** — easy to get wrong (leaking paid tiles via a cached CDN URL). Design tile URLs to be signed/short-lived for paid layers.
4. **Multi-tenant isolation in PostGIS** — Row-Level Security works but every spatial query must include tenant_id. Plan an RLS testing strategy.
5. **Base map cost at scale** — Mapbox/Google get expensive fast. Self-host Protomaps/OpenFreeMap early.

**Red flags / things to validate before building:**

- Do you have at least one *real* customer signal (an agritech firm, a real-estate firm, a provincial planner) who would pay? Without that, you're guessing what layers matter.
- Vietnamese language search/geocoding quality on Nominatim — test before committing.

---

## Architectural sketch (modules)

- **`auth/`** — tenant context, RBAC middleware, RLS helpers. Deep module: every other module calls `requireTenant(req)`.
- **`layers/`** — CRUD on layer metadata, visibility, pricing. Source of truth for what exists.
- **`entitlements/`** — given (tenant, layer) → allowed? Single function used by tile server and UI. Stripe webhooks write here.
- **`ingest/`** — upload → validate → convert → register. Background workers. Reused for self-uploads *and* your own seed-data ingestion.
- **`tiles/`** — thin Next.js proxy in front of Martin/TiTiler that checks entitlements and signs URLs.
- **`viewer/`** — MapLibre client, layer panel, legend, drawing tools, search box.
- **`admin/`** — superadmin and tenant-admin dashboards (same React components, different scope filters).
- **`billing/`** — Stripe checkout, portal, webhook handler → entitlements.

The deepest, most reusable modules are **`entitlements/`** and **`ingest/`**. Both should have isolated unit tests from day 1.

---

## Critical files / repo layout (greenfield — repo is currently empty)

```
apps/web/                  Next.js app (viewer, admin, marketing)
apps/tile-proxy/           thin Node service or Next route handlers for tile auth
services/martin/           Docker compose for Martin + config
services/titiler/          Docker compose for TiTiler (optional v1)
services/ingest-worker/    BullMQ workers (ogr2ogr, tippecanoe wrappers)
packages/db/               Prisma or Drizzle schema + migrations (incl. PostGIS)
packages/entitlements/     pure logic, heavy tests
packages/shared-types/     zod schemas shared FE/BE
infra/                     docker-compose for local; Terraform later
```

---

## Verification (how to test end-to-end at MVP)

1. **Local up**: `docker compose up` brings Postgres+PostGIS, Martin, Redis, Next dev server.
2. **Tenant flow**: sign up → org created → invite member → member sees org's layers only.
3. **Public layer**: anonymous visitor sees Vietnam boundary + population layers.
4. **Upload flow**: tenant uploads a GeoJSON of POIs → job completes → layer appears in their map → other tenants cannot see it (verified by signing in as second tenant).
5. **Paid layer**: tenant tries to enable a premium layer → Stripe checkout → webhook → layer becomes accessible. Tile request without entitlement returns 403.
6. **Search**: type a Hanoi address → map flies to result.
7. **Drawing**: draw a polygon → area computed correctly via Turf.
8. **Load test**: 50 concurrent tile requests on a 1M-feature layer stays <200ms p95 (Martin should handle this; if not, materialize a generalized table for low zooms).

---

## Resolved decisions

1. **Pricing model = hybrid**: both per-layer one-time/subscription purchases **and** tiered plans that bundle layers as a package. Schema implication:
   - `plans` (id, name, price, stripe_price_id)
   - `plan_layers` (plan_id, layer_id) — many-to-many bundle definition
   - `layers.standalone_price_id` (nullable) — for per-layer purchase
   - `tenant_entitlements` (tenant_id, layer_id, source: 'plan'|'standalone'|'admin_grant', expires_at)
   - Entitlement check: `EXISTS row in tenant_entitlements for (tenant, layer) AND not expired`. Plan changes are expanded into per-layer rows on subscribe/cancel via Stripe webhook — keeps the read path trivial.
2. **Hosting**: Vercel (Next.js) + **Neon** or **Supabase** for Postgres+PostGIS. Martin + ingest workers + Redis on a small VPS (Fly.io / Railway / Hetzner). Object storage on Cloudflare R2 (S3-compatible, no egress fees — important for tile delivery).
3. **Initial vertical & seed dataset**: **retail / supermarket location intelligence**. You already have Vietnam supermarket location data — this becomes the flagship public/premium layer and shapes the v1 storyline:
   - Seed layers: Vietnam admin boundaries (free), population/WorldPop (free), OSM POIs (free), **supermarket locations (premium / your differentiator)**, weather snapshot (free).
   - Sharpens the buyer persona: retail chains, FMCG brands, real-estate site-selection consultants, market research firms.
   - Add a "buffer/catchment analysis" tool early (Turf.js `buffer` + PostGIS `ST_Intersects`) — turns the supermarket layer into a *decision tool*, not just dots on a map. This is the service-commerce hook.
4. **White-label / custom domains**: v2.

## Suggested next step after this plan

Build a *vertical slice* end-to-end before broadening: one tenant, one public layer (admin boundaries), one premium layer (supermarkets) gated by one Stripe price. Get the entitlement → tile-auth → MapLibre render loop working with real money flowing. Everything else (uploads, plans-with-bundles, drawing, search) layers on cleanly once that spine is proven. Estimated ~3 weeks to that slice; do not start it until this plan is approved.
