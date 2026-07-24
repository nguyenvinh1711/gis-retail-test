# Plan: Real geocoding + per-layer interactions + extensible layer module system

## Context

The demo MVP renders correctly. Next iteration goals:
1. **Replace city-centroid jitter with real coordinates** for the 377 supermarkets — using an OSS-friendly geocoder.
2. **Rich per-layer interactions**: hover tooltip → click fly-to + right-side detail panel → per-layer custom behavior (catchment rings for supermarkets, province stats for polygons).
3. **Extras**: point clustering, search/filter, URL state, export.
4. **Architecture**: refactor from the current monolithic `MapView` + flat `Layer` union into a **LayerModule plugin contract** — each layer is a self-contained module with a clear interface. This is the foundation for future tenant-uploaded custom layers (per the original plan).

The intended outcome: every new layer is a single file implementing one interface; `MapView` becomes a thin shell that iterates modules. No per-type branching anywhere else.

---

## Geocoding (recommended: OSS Nominatim, batched offline)

**Why Nominatim over alternatives for an OSS-first stack:**

| Option | OSS | Cost | Vietnamese quality | Verdict |
|---|---|---|---|---|
| **Nominatim** (OpenStreetMap) | ✅ AGPL, self-hostable | Free public instance (1 req/s) | Decent for cities/districts; weaker for sub-street | **Use this** |
| Goong | ❌ Proprietary | Free tier limited | Best for VN | Reserve for v2 if accuracy matters |
| MapTiler Geocoding | ❌ Proprietary | Paid above free tier | OK | Skip — locks you in |
| Photon (Komoot) | ✅ Apache, OSM-based | Free public | Similar to Nominatim | Acceptable alt; we'll keep Nominatim |

**Implementation:** `scripts/geocode-supermarkets.mjs`
- Reads `sample_datas/Supermarket.xlsx`.
- For each row, builds query: `"{Address}, {City}, Vietnam"` → falls back to `"{City}, Vietnam"` if Address empty.
- Calls `https://nominatim.openstreetmap.org/search?q=...&format=jsonv2&limit=1&countrycodes=vn&addressdetails=1`.
- Headers: `User-Agent: gis-retail-demo/0.1 (https://github.com/...)` (Nominatim policy requires identification).
- **Throttle**: 1.1 s between requests (policy is ≤1/s).
- **Cache**: writes/reads `scripts/cache/geocode-cache.json` keyed by query string so reruns are instant after first pass.
- On miss / null result → fall back to current city-centroid+jitter (already in `build-supermarkets-geojson.mjs`).
- Output: a **new** file `public/data/supermarkets-real.geojson`. The existing `supermarkets.geojson` (centroid+jitter) is **preserved** so the demo can A/B between the two. Features carry a `geocode_source` property (`"nominatim" | "centroid_fallback"`) for any rows Nominatim couldn't resolve.
- One-time runtime: ~7 minutes; thereafter the cache makes it near-instant.
- The `supermarkets` LayerModule reads `supermarkets-real.geojson` by default; toggle env `NEXT_PUBLIC_SUPERMARKETS_SOURCE=centroid` to use the original.

Run with `npm run geocode` (added to `package.json` scripts).

---

## Architecture: the `LayerModule` interface

**New file:** `src/layers/types.ts`

```ts
export interface LayerContext {
  map: maplibregl.Map;
  setSelection(sel: Selection | null): void;
  setHover(hover: HoverInfo | null): void;
  pushTransient(layerSpec: TransientLayer): () => void; // for catchment rings, highlights
}

export interface LayerModule {
  id: string;
  name: string;
  description: string;
  category: string;
  visibility: "public" | "premium";

  // Lifecycle
  mount(ctx: LayerContext): void | Promise<void>;
  unmount(ctx: LayerContext): void;

  // Visibility / opacity
  setVisible(map: maplibregl.Map, visible: boolean): void;
  setOpacity(map: maplibregl.Map, opacity: number): void;

  // Interaction — all optional; defaults provided by helpers
  interactiveLayerIds(): string[];           // which MapLibre layer ids capture clicks/hover
  getHoverTooltip?(feature: GeoJSON.Feature): ReactNode;
  getDetailPanel?(feature: GeoJSON.Feature, ctx: LayerContext): ReactNode;
  onFeatureClick?(feature: GeoJSON.Feature, ctx: LayerContext): void;

  // Search / filter
  getFilterSchema?(): FilterField[];          // declares searchable fields
  applyFilter?(map: maplibregl.Map, filter: FilterState): void;

  // Export
  getExportableFeatures?(map: maplibregl.Map): GeoJSON.Feature[];
}
```

**Three concrete modules to start** (one file each, registered in `src/layers/index.ts`):

1. `src/layers/provinces.ts` — VN province polygons. Click → highlight outline + side panel with name + count of supermarkets inside (computed via `@turf/booleanPointInPolygon` against currently loaded supermarkets source).
2. `src/layers/supermarkets.ts` — clustered points. Hover → tooltip (brand + city). Click → fly-to + side panel (full attributes) + catchment rings (1/3/5 km using `@turf/buffer`) + count of other supermarkets in each ring.
3. `src/layers/supermarket-density.ts` — premium heatmap derived from the supermarkets source. No click interactions (visualization-only).

`MapView` becomes:
```
modules.filter(accessible).forEach(m => m.mount(ctx));
on('click') → find topmost interactive layer → module.onFeatureClick or default
on('mousemove') → hover tooltip
```

No `kind === "polygon"` branches anywhere outside the module files. Future tenant-uploaded layers just register another `LayerModule`.

---

## Interaction behavior — full detail

**Hover** (any layer that opts in via `getHoverTooltip`):
- On `mouseenter` of an interactive layer: cursor → pointer, set `feature-state {hover: true}` (modules opt into a hover paint variant), show a compact MapLibre `Popup` anchored to mouse with `getHoverTooltip(feature)` content.
- On `mouseleave`: revert all.
- Throttled at 60fps; no React re-render storm.

**Click** (default flow, with per-module override):
1. `queryRenderedFeatures` at click point → topmost interactive feature.
2. Set selection in `MapView` state: `{layerId, feature}`.
3. Camera move:
   - **Polygon**: `fitBounds(turf.bbox(feature), { padding: 80 })`.
   - **Point**: `flyTo({ center, zoom: max(currentZoom+2, 11) })`.
4. Open right-side `<DetailPanel>` (380 px, collapsible). Body comes from `module.getDetailPanel(feature, ctx)`.
5. Module's `onFeatureClick` runs side-effects:
   - `supermarkets`: register transient catchment rings (1/3/5 km) via `ctx.pushTransient`. Detail panel shows count of competitors in each ring (recomputed live from the source).
   - `provinces`: register transient highlight outline. Panel shows aggregate stats.
6. Click empty map → clear selection (closes panel, removes transients).

**Right-side detail panel** (`src/components/DetailPanel.tsx`):
- Slides in from right, fixed width 380 px, dark/light themed.
- Shows: layer name (chip), feature title, attributes table, module-defined custom blocks (e.g., "Competitors in 1 km: 3").
- Persistent across panning; closes on X, Esc, or empty-map click.

---

## Point clustering — what it does and why

MapLibre supports clustering natively on a GeoJSON source via `cluster: true`. At low zoom, nearby points group into a single "cluster bubble" labeled with the count. The cluster expands as you zoom in. This:
- Makes 377 dots readable at country scale (otherwise they overlap into a blob over HCMC/Hanoi).
- Scales to 10k+ points without performance loss (clustering is computed in a worker).
- Gives the user a sense of density before they've zoomed in.

**Implementation in `supermarkets.ts`:**
```
addSource({ type: "geojson", data: url, cluster: true, clusterMaxZoom: 12, clusterRadius: 50 });
```
Then three render layers:
- `clusters` (circles, color/size by `point_count`),
- `cluster-count` (symbol, text = `point_count_abbreviated`),
- `unclustered-points` (the leaf dots).
Click cluster → `getClusterExpansionZoom(clusterId)` → `flyTo(center, zoom)`.

---

## Search / filter

`src/components/FilterBar.tsx` — slim toolbar above the layer panel.
- Each visible LayerModule contributes filter fields via `getFilterSchema()`:
  - `supermarkets` → `{ brand: enum from data, city: enum from data }`.
  - `provinces` → none (skipped).
- Selecting a value calls `module.applyFilter(map, state)`, which sets a MapLibre `filter` expression on the relevant layers.
- State persists in the URL hash (next section).

---

## URL state (permalink)

`src/lib/url-state.ts` — single source of truth for the URL hash, serializing:
- map view: `lng,lat,zoom,bearing` (rounded).
- per-layer visibility + opacity.
- active filter values.
- selected feature: `selected=layerId:featureId`.

Updates are debounced (200 ms). On mount, hash is parsed and applied. Shared link reproduces the same view.

---

## Export

`src/components/ExportButton.tsx` — top-right button.
- Calls `module.getExportableFeatures(map)` for each visible accessible module → merged FeatureCollection.
- Default helper queries `map.queryRenderedFeatures` filtered to the module's interactive layer ids and within current viewport.
- Two formats: GeoJSON (verbatim) and CSV (flat properties via a small `featuresToCsv` helper).

---

## Critical files (new / modified)

**New:**
- `src/layers/types.ts` — interfaces.
- `src/layers/index.ts` — module registry + helpers.
- `src/layers/provinces.ts`
- `src/layers/supermarkets.ts`
- `src/layers/supermarket-density.ts`
- `src/components/DetailPanel.tsx`
- `src/components/FilterBar.tsx`
- `src/components/ExportButton.tsx`
- `src/lib/url-state.ts`
- `src/lib/turf-helpers.ts` (thin wrappers around `@turf/buffer`, `@turf/bbox`, `@turf/booleanPointInPolygon` — kept centralized so we can swap Turf later).
- `scripts/geocode-supermarkets.mjs`
- `scripts/cache/geocode-cache.json` (gitignored or committed; recommend commit so demos are reproducible).

**Modified:**
- `src/components/MapView.tsx` — strip per-type branching; iterate modules; mount detail panel & filter bar.
- `src/lib/layers.ts` — **delete** (replaced by `src/layers/*`).
- `src/app/map/page.tsx` — unchanged shape, but passes session + filter parsed from URL.
- `scripts/build-supermarkets-geojson.mjs` — now reads geocode cache first, falls back to centroid.
- `package.json` — add `@turf/buffer`, `@turf/bbox`, `@turf/boolean-point-in-polygon`, `@turf/helpers`; add `"geocode"` script.

---

## Verification

1. `npm run geocode` completes (≤8 min first run) and writes cache.
2. `npm run build:data` (alias for `node scripts/build-supermarkets-geojson.mjs`) outputs `supermarkets.geojson` with `geocode_source: "nominatim"` on most features.
3. `npm run dev` → `/map`:
   - Hover supermarket → tooltip with brand + city.
   - Click supermarket → fly-to, right panel opens with full details, 1/3/5 km rings appear, panel shows competitor counts per ring.
   - Click province polygon → polygon highlighted, panel shows province name + supermarket count + brand breakdown.
   - At zoom 4–6, supermarkets cluster into bubbles labeled with counts; click cluster → zooms to expansion level.
   - Filter bar: filter by brand "VinMart" → only VinMart points visible; URL hash updates.
   - Share URL in a new tab → same view, same filters, same selection.
   - Export button → downloads `gis-retail-export.geojson` matching visible features.
4. Premium layer flow still works (sign in → buy density → toggle).
5. TypeScript: `npx tsc --noEmit` clean.

---

## Open questions

- **Hover popups on mobile?** They don't make sense on touch. Default: hover only fires on devices with `(hover: hover)`; touch devices go straight to click. Confirm OK or call out otherwise.
- **Geocode cache committed to git?** Recommend yes (~50 KB JSON) so the demo is reproducible without API calls. Confirm or set to gitignore.
- **Catchment radii** fixed at 1/3/5 km, or configurable per-tenant? Recommend fixed for now; expose as a setting later.

---

# Refinement pass: 3 UX bugs after first demo

## Context

User tested the new map and reported:
1. **Cluster click "disappears"** — clicking a cluster runs `getClusterExpansionZoom + flyTo`, which zooms in past `clusterMaxZoom`. The cluster bubble then splits into individual dots that scatter, so visually the cluster "vanishes" with no clear payoff. There's no panel telling the user *what was inside*.
2. **No way to turn clustering off** — at high zooms it's fine, but a user wanting to see every individual location can't.
3. **Hover tooltip text looks washed out** — default MapLibre popup styling: white bg + zinc text, no color emphasis. The feature title reads as "light grey" because it inherits the popup's pale text color.

Goal: keep the architecture clean (no per-layer special cases in `MapView`), fix all three, and ship in one short pass.

---

## Fix 1: cluster click → drill-down panel (not just fly-zoom)

When a cluster is clicked:
- Still `flyTo(clusterCenter, expansionZoom)` so the camera tracks the user's intent.
- **Also open the right-side `DetailPanel`** showing the cluster's contents: `getClusterLeaves(clusterId, 100, 0)` → list of the actual supermarket names with brand + city. Each item in the list is clickable → calls the per-feature select path (fly to point + open its detail panel).
- That way the cluster doesn't "vanish without trace" — its contents are visible in the side panel until the user picks one or closes the panel.

**File:** `src/layers/supermarkets.ts`

Changes:
- Replace `customClick` with a richer handler:
  - Compute expansion zoom AND cluster leaves in parallel (`Promise.all`).
  - Set selection to a synthetic cluster feature with `properties.cluster=true, cluster_id, point_count, leaves: [...]`.
  - Camera move: clamp expansion zoom to `min(expansionZoom, currentZoom + 1.5)` so the cluster doesn't blow apart in one click — keeps context, lets the user click again to drill deeper.
  - Let MapView's normal click flow handle the selection (so `getDetailPanel` is called with the synthetic feature).
- **Visualize the leaves on the map**: after `getClusterLeaves`, push a transient source `super-cluster-leaves-src` containing those leaf points and add a transient layer `super-cluster-leaves` rendering them as larger highlighted markers (8 px, amber stroke, semi-opaque fill) above the normal points layer. Also draw a soft halo around the bounding box of the leaves (`@turf/bbox` → polygon → fill-opacity 0.05) so the user *sees* the cluster's spatial extent. Both are removed in `onSelectionCleared`.
- The detail-panel list is kept in sync with these visuals: hovering a leaf row in the panel sets `feature-state {hover: true}` on the corresponding leaf marker (using its numeric id) so the user can match panel-row to map-dot visually.
- Add a `getDetailPanel` branch: if `feature.properties.cluster`, render a "Cluster: N supermarkets" header + scrollable list of leaves. Each list row is a button that calls a callback (see below).

**File:** `src/layers/types.ts`

Add to `LayerContext`: `selectFeatureById(layerId, featureId)` so the cluster-leaf list rows can drill into a specific supermarket from the panel.

**File:** `src/components/MapView.tsx`

Implement `selectFeatureById` on the ctx by looking up the feature in the module's `getCurrentFeatures()` and re-using the existing click flow.

## Fix 2: toggle clustering on/off per layer (extensible)

Add a generic, declarative per-layer options mechanism — this keeps it reusable for future layers (e.g., toggle "show labels" on provinces).

**File:** `src/layers/types.ts`

Add to `LayerModule`:

```ts
getOptions?(): LayerOption[];
setOption?(map: MLMap, optionId: string, value: unknown): void;
```

Where `LayerOption` is a discriminated union: `{ id, label, kind: 'boolean', default: boolean } | { id, label, kind: 'select', options: FilterOption[], default: string }`.

**File:** `src/layers/supermarkets.ts`

- Declare one option: `{ id: "cluster", label: "Cluster nearby points", kind: "boolean", default: true }`.
- Module keeps an internal `clusterEnabled` flag.
- `setOption("cluster", value)`: if value changes, **remove** the existing source + cluster/cluster-count/points layers and **re-add** them with `cluster: value` on the source. The 3 layers' filter expressions (`["has", "point_count"]` / `["!", ["has", "point_count"]]`) work regardless — the unclustered branch shows all points when `cluster: false` because none of them get the `point_count` property.
- Re-apply filter and visibility/opacity after recreating layers (small reuse helper `mountPointLayers(map)`).

**File:** `src/components/MapView.tsx`

In the left layer panel, below each layer's opacity slider, render any options returned by `module.getOptions()` as compact controls. Persist values in component state, push them into a new URL-state field `options: Record<layerId, Record<optId, value>>`, and call `module.setOption(map, id, value)` on change.

This same plumbing will later support "show labels", "color by", etc., on any module.

## Fix 3: hover tooltip — colorful, readable

Two changes:

**File:** `src/app/globals.css`

Add a small style override for the MapLibre popup container used by hover (scope by a custom class set on the popup). Use brand-coherent colors and a sharper border:

```css
.maplibregl-popup-content { /* applied via popup class */
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgb(228 228 231); /* zinc-200 */
  box-shadow: 0 6px 16px -6px rgb(0 0 0 / 0.2);
}
.gis-hover .maplibregl-popup-tip { border-top-color: rgb(228 228 231); }
```

**File:** `src/components/MapView.tsx`

When creating the popup in `handleMove`, pass `className: "gis-hover"` and explicit theme classes on `el`:

```ts
el.className = "min-w-[160px] text-xs text-zinc-900 dark:text-zinc-50";
const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "gis-hover" });
```

**Files:** `src/layers/supermarkets.ts`, `src/layers/provinces.ts`

In `getHoverTooltip`, give the title:
- a **colored chip** matching the layer (red-100/red-900 for supermarkets, blue-100/blue-900 for provinces),
- bold + `text-zinc-900 dark:text-zinc-50` on the title line,
- secondary text in `text-zinc-600 dark:text-zinc-400` (not the current zinc-500).

The "chip + bold title + secondary line" pattern matches the right-side `DetailPanel` so the hover preview looks like a tiny version of the panel.

---

## Critical files (this pass)

- `src/layers/types.ts` — add `selectFeatureById` to `LayerContext`; add `LayerOption`, `getOptions`, `setOption` to `LayerModule`.
- `src/layers/supermarkets.ts` — cluster drill-down detail panel; `getOptions` for clustering toggle; rewrite cluster click handler with clamped zoom; tooltip styling.
- `src/layers/provinces.ts` — tooltip styling.
- `src/components/MapView.tsx` — implement `selectFeatureById`; render layer options in panel; persist option state in URL; popup styling.
- `src/lib/url-state.ts` — extend `UrlState` with `options?: Record<string, Record<string, unknown>>`.
- `src/app/globals.css` — `.gis-hover` popup styles.

---

## Verification

1. Reload `/map`.
2. Click a dense cluster (e.g., Ho Chi Minh City). Camera zooms in **by ~1.5 levels**. The cluster's leaves are drawn as highlighted amber-ringed markers on the map, with a soft halo over their bounding box. The **right panel** shows "12 supermarkets in this cluster" + a clickable list. Hovering a panel row highlights the matching marker on the map.
3. Click one of the leaves in the panel → flies to that supermarket, panel switches to its full details (rings + competitor counts).
4. In the left panel, untick "Cluster nearby points" under Supermarkets. All clusters dissolve into individual red dots immediately. Re-tick → clusters return.
5. Hover any supermarket → tooltip has red chip "Supermarket", bold black title, lighter subtitle. Hover a province → blue chip "Province". Both readable in light + dark mode.
6. Refresh the page after toggling cluster off — option state survives via URL hash.
7. `npx tsc --noEmit` clean.

---

# Refinement pass 2: surface geolocation everywhere

## Context

User wants every data point's coordinates visible:
- on the **map** (so they can read the lng/lat where their cursor is, and see a coords line on each feature's tooltip),
- in the **detail panel** (so they can copy/paste real coordinates for any feature).

Same single-page demo, surgical additions only — no new files unless strictly needed.

---

## Changes

### 1. Hover tooltip: append a coordinates line

**File:** `src/layers/supermarkets.ts`
- In `getHoverTooltip` for a leaf (non-cluster) feature, add a small mono line:
  `lng, lat` formatted to 5 decimals, in `text-[10px] font-mono text-zinc-500`.
- Cluster tooltip gets a coords line showing the cluster's center coordinates.

**File:** `src/layers/provinces.ts`
- Province tooltip stays simple (polygon center coords aren't very useful at a glance). Skip.

### 1b. Province → brand breakdown rows become drill-downs

**File:** `src/layers/provinces.ts`

Each brand row in the breakdown becomes an expandable + clickable row:
- Clicking the row **toggles open an inline list** of the supermarkets of that brand within the province (computed by intersecting `supermarkets` features with the polygon and filtering by brand — both already available in this file via `ctx.getOtherFeatures("supermarkets")` and `pointsInsidePolygon`).
- Each store in that inline list is a button that calls `ctx.selectFeatureById("supermarkets", id)` (already wired in MapView from the previous pass) → flies to the store and switches the right panel to its supermarket detail view (with rings, competitor counts, etc.).
- Visually: also push a transient overlay layer on the map showing **just those brand+province stores** as amber-ringed markers (reuse the cluster-leaves overlay pattern — extract `mountLeavesOverlay(map, features)` / `clearLeavesOverlay(map)` into `src/layers/_overlays.ts` so both provinces and supermarkets share it).
- Toggling the row closed (or selecting a different brand row) clears the overlay.
- `onSelectionCleared` also clears the overlay.

To keep `provinces.ts` from depending on supermarkets module specifics:
- Memoize the intersected feature list per (province feature id) at render time so opening multiple rows in sequence is cheap.
- The overlay helpers in `_overlays.ts` are owned by neither module — they're a shared transient utility.

### 2. Detail panel: dedicated Coordinates row + copy button

**File:** `src/layers/supermarkets.ts`
- In the leaf `getDetailPanel` attribute table, add a row:
  - label: "Coordinates"
  - value: `"{lat}, {lng}"` (lat first, common convention; 6 decimals).
  - small "Copy" button next to it that calls `navigator.clipboard.writeText(...)`.
- In the cluster `getDetailPanel`, show the cluster center coords as a one-line subhead under the count.

**File:** `src/layers/provinces.ts`
- Above the "Brand breakdown" block, add a small "Bounding box" line showing `W {w}, S {s}, E {e}, N {n}` (5 decimals) computed via `@turf/bbox` on the feature. Cheap and informative for the province use case.

### 3. Map-wide mouse coordinates readout

A tiny status pill in the **bottom-right** of the map showing the cursor's current `lng, lat`. Helps when no feature is hovered.

**File:** `src/components/MapView.tsx`
- New piece of state `mouseLngLat: [number, number] | null`.
- In the existing `handleMove`, update it (cheap, since this handler already runs on every mousemove). Setting state every move is a re-render storm — instead, write to a ref and use `requestAnimationFrame` to batch updates into state at ~30Hz.
- Render a `<div>` overlay in the lower-right:
  - `font-mono text-[11px] text-zinc-700 dark:text-zinc-300 bg-white/85 dark:bg-zinc-900/85 rounded px-2 py-1 shadow`
  - Hidden on mobile (`hidden sm:block`).
- On `mouseleave` (already wired), clear to null and hide.

---

## Critical files

- `src/layers/supermarkets.ts` — tooltip coords line; detail-panel coords row + copy button; cluster center coords. Refactor existing leaves-overlay code to use the new shared helpers.
- `src/layers/provinces.ts` — bounding-box line; brand rows become collapsible drill-downs with overlay + per-store buttons.
- `src/layers/_overlays.ts` *(new, tiny)* — `mountLeavesOverlay(map, features)` / `clearLeavesOverlay(map)` shared by supermarkets cluster click and province brand drill-down.
- `src/components/MapView.tsx` — mouse-coords readout pill, rAF-batched state.

No type changes needed (the `Feature.geometry.coordinates` are already accessible).

---

## Verification

1. Hover any supermarket → tooltip ends with a faint mono "106.xxxxx, 10.xxxxx".
2. Click a supermarket → detail panel has a "Coordinates" row showing `lat, lng` (6 decimals) with a working **Copy** button (verify clipboard contains the same string).
3. Click a cluster → detail panel header shows the cluster's center coords below the count.
4. Click a province → detail panel shows "Bounding box: W ..., S ..., E ..., N ...". Brand breakdown rows are clickable; clicking a brand row reveals an inline list of stores of that brand within the province, AND highlights them on the map with amber rings. Clicking a store row flies to it and switches the panel to the supermarket detail view. Clicking the brand row again (or another row) collapses/swaps the highlights.
5. Move the cursor over the map (without hovering a feature) → bottom-right pill shows the cursor's lng/lat live, updating smoothly.
6. Move cursor outside the map → pill disappears.
7. `npx tsc --noEmit` clean.

---

# Refinement pass 3: hospitals layer + sidebar/panel UX + province click bug

## Context

User asks for:
1. **New layer: hospitals in Vietnam** — OSM Overpass as the primary source, healthsites.io as enrichment when available. Four amenity types (hospital, clinic, doctors, pharmacy). Both a **public** layer and a **premium "coverage gaps"** variant. Same interaction surface as supermarkets (hover, click, rings, clustering, filter, export). Cross-layer: when a supermarket is clicked, also count nearby hospitals in each ring.
2. **Filter sidebar**: make it **draggable** and **collapsable**; move the **Export button inside** it, and exporting should cover **all active layers**.
3. **Detail panel**: **collapsable**, plus **routable history** (back/forward across selections).
4. **Province click bug**: clicking a province sometimes shows a "square box" or only part of the polygon. Root cause confirmed below.
5. Keep `docs/PLAN.md` in sync with this plan.

Investigation findings:
- `public/data/vn-provinces.geojson` is **NOT** bbox-shaped. 64 features, 36–400 vertices each, median 177. Data is fine.
- The real bug: **`map.queryRenderedFeatures` returns geometries that are clipped to the vector tile boundaries containing the click point.** For provinces that span several tiles, only the slice within the clicked tile is returned. Our click path then renders that slice as the "selected province" overlay → user sees a partial / box-like sliver.
- Fix: load the source GeoJSON into module memory (we already do this for `supermarkets`); look up the **full** feature by id from the module's `getCurrentFeatures()` instead of using the clipped `queryRenderedFeatures` geometry.

---

## Phase 0 — Documentation discovery (run first, in fresh context)

Dispatch one Documentation Discovery subagent to verify three external APIs we'll consume. The subagent must return Sources + concrete findings + copy-ready snippets + confidence/gaps (per the make-plan skill's reporting contract).

**Topics:**

1. **OSM Overpass API**
   - Endpoint: `https://overpass-api.de/api/interpreter` (or mirror `https://overpass.kumi.systems/api/interpreter`).
   - Query QL syntax for filtering by country area and multiple `amenity` values.
   - `out center;` to collapse ways/relations to a representative point.
   - Result JSON shape (`elements[]` with `type`, `lat`/`lon` for nodes, `center.lat/lon` for ways/relations, `tags{}`).
   - Rate limit / etiquette (single big query is fine; identify with User-Agent).
2. **healthsites.io API**
   - Endpoint and auth: `https://healthsites.io/api/v2/facilities/?api-key=...&country=Vietnam`.
   - Pagination, fields available (uuid, name, type, osm_id when known).
   - Whether anonymous calls work for low volume.
3. **MapLibre `queryRenderedFeatures` clipping behavior** — confirm the documented behavior so we cite it in code comments.

Consolidate the report into `docs/discovery-hospitals.md` (new file) for future reference.

---

## Phase 1 — Fix province click clipping (small, high-value)

**File:** `src/layers/provinces.ts`
- Load the GeoJSON into module memory the way `supermarkets.ts` does:
  - `let raw: FeatureCollection<Polygon | MultiPolygon> = { type, features: [] }; let loaded = false;`
  - `async function loadRaw(map)` — fetch `/data/vn-provinces.geojson`, stamp numeric ids (matching the `generateId: true` ids on the source), call `(map.getSource(SRC) as GeoJSONSource).setData(raw)`.
- Implement `getCurrentFeatures(): Feature[]` returning `raw.features`.

**File:** `src/components/MapView.tsx`
- In `handleClick`, before building `feat`, look up the full feature:
  ```ts
  const all = hit.module.getCurrentFeatures?.() ?? [];
  const full = all.find((f) => f.id === hit.feature.id);
  const feat: Feature = full ?? { type: "Feature", geometry: hit.feature.geometry, properties: hit.feature.properties ?? {}, id: hit.feature.id };
  ```
- Comment: `// queryRenderedFeatures returns tile-clipped geometry; prefer the full feature when the module exposes it.`

**Verification:** click each of the 5 highest-vertex provinces (Điện Biên, Sơn La, Quảng Ninh — MultiPolygon, Nghệ An, Lai Châu). The selected outline now wraps the full province on every click, regardless of zoom / where in the polygon you clicked.

---

## Phase 2 — Build hospitals data (Overpass + healthsites.io enrichment)

**New file:** `scripts/build-hospitals-geojson.mjs`

Flow:
1. **Overpass query** (single request, ~60s timeout):
   ```
   [out:json][timeout:60];
   area["ISO3166-1"="VN"][admin_level=2]->.vn;
   (
     node["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](area.vn);
     way["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](area.vn);
     relation["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](area.vn);
   );
   out center tags;
   ```
   Headers: `User-Agent: gis-retail-demo/0.1 (contact: tidus2102@gmail.com)`.
2. **Cache** raw response at `scripts/cache/overpass-vn-health.json` so re-runs skip the network.
3. **Optional healthsites.io enrichment**: if `HEALTHSITES_API_KEY` env var is set, fetch all VN facilities (paginated; cache at `scripts/cache/healthsites-vn.json`). Build a map keyed by `osm_id` → enrichment record. For each Overpass feature, merge `healthsites_type`, `ownership`, `contact_*` fields where there's a match.
4. **Output:** `public/data/hospitals.geojson` with properties:
   `{ osm_id, name, type (hospital|clinic|doctors|pharmacy), brand?, address?, phone?, website?, ownership?, city?, source: "osm" | "osm+healthsites" }`.
   Use `tags["name:en"] || tags.name` for name. `addr:city` for city. Skip features without a coordinate (rare).
5. **Stats log**: count per type, count enriched.

Add `npm run hospitals` script to `package.json`. Runtime: ~30s.

**Verification:** `public/data/hospitals.geojson` exists, valid GeoJSON, ≥200 hospitals + reasonable counts for other categories.

---

## Phase 3 — Hospitals LayerModule (public)

**New file:** `src/layers/hospitals.ts`

Mirror the structure of `supermarkets.ts`:
- Source `hosp-src` with `cluster: true` by default; cluster boolean option.
- Layers: `hosp-clusters`, `hosp-cluster-count`, `hosp-points`.
- Color palette differentiated from supermarkets: **emerald-600** fill + amber stroke for points; emerald gradient for cluster bubbles.
- Hover tooltip: chip "Hospital" / "Clinic" / "Doctors" / "Pharmacy" (color per type), title, type+city subtitle, coords line.
- Click: fly + open detail panel + draw catchment rings (reuse the existing 1/3/5 km pattern). Detail panel sections:
  - Attributes table (name, type, address, city, phone, website, source).
  - Coordinates row with Copy.
  - "Other facilities nearby" — same ring count pattern as supermarkets but counts within hospitals.
- `getCurrentFeatures` exposed.
- Filters: `type` (enum), `city` (enum derived from data).
- Export + option (cluster toggle) via existing interfaces.
- Cluster click reuses `mountLeavesOverlay` shared helper.

**Register:**
- `src/layers/metadata.ts` — append a `LayerMetadata` entry.
- `src/layers/index.ts` — import and append to `LAYER_MODULES`.

**Verification:** layer appears in the left panel; toggling shows ~2000+ green points clustered. Hover/click behavior matches supermarkets. Filter by `type=hospital` reduces visible features.

---

## Phase 4 — Cross-layer: hospitals nearby in supermarket detail panel

**File:** `src/layers/supermarkets.ts`
- In leaf `getDetailPanel`, below the existing "Competitors nearby" rings block, add **"Hospitals nearby"**:
  - For each ring `[1, 3, 5] km`, count hospitals within the ring from `ctx.getOtherFeatures("hospitals")` using the same in-file `pointInsidePoly` helper.
  - If hospitals layer not loaded yet, show a tiny "Enable the Hospitals layer to see counts" hint.
- Symmetric: in `hospitals.ts` leaf `getDetailPanel`, add "Supermarkets nearby" using `ctx.getOtherFeatures("supermarkets")`.

**Verification:** click any supermarket — panel shows both rings groups. Counts respond to the hospital type filter.

---

## Phase 5 — Premium "Hospital coverage gaps" layer

**New file:** `src/layers/hospital-coverage-gaps.ts`

Demo-grade definition (not a real epidemiological model):
- For each supermarket point: `weight = max(0, 1 − 0.5 × hospitalsWithin3km)` — high where there are supermarkets (proxy for population) and few hospitals.
- Render as a heatmap colored yellow→red over those points.
- Loads hospitals + supermarkets via `ctx.getOtherFeatures` on mount; computes weights once both sources are loaded.

LayerModule similarities to `supermarket-density.ts`: `visibility: "premium"`, no interactions, heatmap only.

**Register** in `metadata.ts` (premium) + `index.ts`. Entitlement check is automatic since `PREMIUM_LAYER_IDS` derives from metadata.

**Verification:** sign-in → buy "Hospital coverage gaps" → toggle on → heatmap concentrates in mid-tier cities.

---

## Phase 6 — Sidebar UX: draggable, collapsable, export-inside

**New file:** `src/components/Sidebar.tsx` *(extract the left layer panel from `MapView.tsx`; pure UI, controlled by props)*

- **Collapsable:** header caret button collapses to a 36 px rail showing just a "Layers" icon. State persisted in URL hash (`sidebar: "open" | "collapsed"`).
- **Draggable:** the header is a drag handle. Position `{x, y}` in state + URL hash (`sidebarPos`). Implementation: bare pointer events (pointerdown → record offset; pointermove → update transform; pointerup → commit). Clamp within viewport. No external DnD library.
- **Export inside:** delete the top-right `<ExportButton>` from MapView JSX; render it inside the sidebar's footer. `collectFeatures` already iterates visible modules — no logic change.
- Filter bar continues to render inside the sidebar below the layer list (already does).

**Verification:** drag panel to a corner; refresh — panel restores in the same place. Collapse → 36 px rail. Expand restores. Export still produces a GeoJSON with all visible layers' features.

---

## Phase 7 — Detail panel: collapsable + routable history

**File:** `src/components/DetailPanel.tsx`
- New props: `collapsed`, `onToggleCollapse`, `canBack`, `canForward`, `onBack`, `onForward`.
- Collapsed mode shows a 36 px strip with chip + title; expanded mode shows the full body.
- Header order: ← Back · → Forward · ▾/▸ Collapse · ✕ Close.

**File:** `src/components/MapView.tsx`
- New state: `selectionHistory: Selection[]`, `historyIndex: number`.
- `setSelection(sel)`: if `sel` is a new entry (not equal by `layerId+id`), truncate forward history, push, advance index.
- `goBack()` / `goForward()`: shift index, replay selection — replay clears the previous module's transients (already wired in `setSelection`) then re-invokes the new module's `onFeatureClick` to redraw.
- Buttons disabled at boundaries.
- Esc clears current selection (already wired).

**Verification:**
1. Click supermarket A → panel A. Back disabled, Forward disabled.
2. Click supermarket B → Back enabled.
3. Back → A reappears, rings redrawn. Forward enabled.
4. Click supermarket C from this state → Forward stack cleared.
5. Collapse panel → 36 px strip; expand restores.

---

## Phase 8 — Sync docs/PLAN.md and verify everything

- Append the new sections of this plan into `docs/PLAN.md` (per `feedback_plan_storage` memory).
- `npx tsc --noEmit` clean.
- Probe every route 200.
- Smoke test: hospitals toggle, cross-layer counts, premium coverage-gaps toggle, draggable+collapsable sidebar, panel back/forward, province full-polygon selection.

---

## Critical files summary

**New:**
- `scripts/build-hospitals-geojson.mjs`
- `src/layers/hospitals.ts`
- `src/layers/hospital-coverage-gaps.ts`
- `src/components/Sidebar.tsx`
- `docs/discovery-hospitals.md` *(from Phase 0)*

**Modified:**
- `src/layers/provinces.ts` — load + expose raw features.
- `src/components/MapView.tsx` — full-feature lookup in handleClick; selection history; remove top-right export; render new `<Sidebar>`.
- `src/components/DetailPanel.tsx` — collapse + back/forward props.
- `src/layers/supermarkets.ts` — "Hospitals nearby" panel section.
- `src/layers/metadata.ts` — hospitals + hospital-coverage-gaps entries.
- `src/layers/index.ts` — module registry append.
- `package.json` — `"hospitals"` script.
- `docs/PLAN.md` — keep in sync.

---

## Anti-patterns to guard against

- Inventing Overpass operators or parameters not in the [Overpass QL docs](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL). Phase 0 must produce the exact query string we use.
- Using `queryRenderedFeatures` geometry for polygon analysis — always look up the full feature from the module's `getCurrentFeatures()`.
- Adding a heavy DnD library for sidebar drag — bare pointer events are sufficient.
- Building selection-history as Next.js routes — it's component state, not URL routes; URL hash can mirror the *current* selection only.

---

# Refinement pass 4: history bug + per-layer filters + scrollable sidebar + filter-aware "nearby" counts

## Context

After shipping the hospitals layer and panel history, user reports four problems:
1. **Back/Forward history doesn't actually work.** Buttons don't replay or get stuck.
2. **Sidebar can't scroll to the end** when many layers are open — the bottom items (e.g., the new Export footer) are unreachable.
3. **Filters are not per-layer-inline.** The current `FilterBar` is a single block at the bottom of the sidebar; user wants each layer's filters under its own card so the panel scales as we keep adding layers and per-layer filter types.
4. **"Nearby" cross-layer counts ignore filters.** Filtering hospitals to `type=hospital` should make "Hospitals nearby" in the supermarket panel count *only* hospitals, not pharmacies. Same for "Supermarkets nearby" when supermarkets are filtered by brand.

These are small but together they're the difference between a "looks like a demo" and "feels like a product" build. TDD-style discipline: each fix is verifiable in isolation. No test harness exists in this repo yet — adding Vitest is out of scope; verification is manual + a `tsc --noEmit` gate. The one piece worth designing for testability is the cross-layer counting helper, which becomes a small pure function.

---

## Phase 1 — Fix routing/history bug (root cause)

**Root cause (confirmed by reading `src/components/MapView.tsx`):**
- `setSelection` reads `historyIndex` from React closure when building the trimmed history:
  ```ts
  const trimmed = h.slice(0, historyIndex + 1);
  ```
  Inside React's `setHistory(updater)`, `historyIndex` is the value at the time the click handler was bound — stale across rapid clicks and after `goHistory` runs (because the `setHistoryIndex` it called hasn't propagated yet).
- Same staleness affects `goHistory(delta)`'s `const next = historyIndex + delta`.

**Fix:** mirror `historyIndex` in a ref so both functions read the latest synchronously.

**File:** `src/components/MapView.tsx`
- Add `const historyIndexRef = useRef(-1);` next to the existing state, kept in sync via a small helper `setHistoryIndex(next)` that updates both.
- In `setSelection`: replace `historyIndex + 1` with `historyIndexRef.current + 1` for trimming; advance both ref and state with the new index after push.
- In `goHistory`: read `historyIndexRef.current` for the current position; update both on the way out.
- Bonus: when user closes the panel (`onClose`), keep the history stack but reset `historyIndexRef` only if `sel` is null AND they explicitly used Close (already wired with `skipHistory: true`). Forward should remain operative if they re-open via Back.

**Verification (manual, click-by-click):**
1. Click feature A → B → C: stack=[A,B,C], index=2, Back enabled, Forward disabled.
2. Back → C→B: index=1, both enabled, panel shows B + rings.
3. Back → B→A: index=0, only Forward enabled, panel shows A.
4. Forward → A→B → A→C → reaches index=2 with Forward disabled.
5. From middle (after one back, index=1), click feature D → stack=[A,B,D], index=2, Forward disabled.
6. Close panel (X) — stack preserved; opening a new selection appends to it.

---

## Phase 2 — Sidebar scroll: reach the end at every drag position

**Root cause:** outer container uses `max-h-[calc(100%-2rem)]`, where `100%` resolves against the absolute-positioned offset parent (the map root). At the same time the sidebar can be dragged so its `top` is anywhere from 0 to `window.innerHeight - 100`. The inner scroll container has its own `max-h-[calc(100vh-6rem)]` that doesn't account for the current `top`, so when dragged downward the inner viewport overshoots the screen and the last items become unreachable.

**Fix:**
- **File:** `src/components/MapView.tsx`
- On the outer sidebar wrapper, set max-height inline: `style={{ left, top, maxHeight: \`calc(100vh - \${sidebarPos.y + 16}px)\` }}`.
- On the inner scroll container, remove the conflicting `max-h-[calc(100vh-6rem)]`; instead make it `flex flex-col` and rely on the outer's `maxHeight` plus its own `overflow-auto`.
- Restructure the sidebar as `flex flex-col` so the header is fixed at top and the scroll body fills the remainder — that way the body's overflow uses the available height correctly.

**Verification:** drag sidebar to bottom-left corner; expand all layer cards (toggles + options); confirm the scrollbar appears and the bottom "Export" footer is reachable via scroll regardless of `sidebarPos.y`.

---

## Phase 3 — Per-layer filters inline, with an extensible contract

The current architecture is already 90% there — every module declares its filter schema via `getFilterSchema()` and applies via `applyFilter()`. We only need to **move the rendering** from a global `<FilterBar>` to inline under each layer's card.

**File:** `src/components/MapView.tsx`
- Inside the layer-card list, after the layer's options block (cluster toggle), render an inline filter block per layer: one section per filter field from `module.getFilterSchema?.()`. Reuse the existing select/text inputs.
- Remove the bottom `<FilterBar>` block and its import.
- Keep the *single source of truth* for filter state: `filters: Record<layerId, FilterState>` already in MapView state; just reads/writes per-layer in the inline block.

**Extensibility note** (best practice we already follow — restate so future contributors don't break it):
- A new layer adding filters needs zero MapView changes. Implement `getFilterSchema(): FilterField[]` and `applyFilter(map, state)` and your filters render inline automatically.
- Filter field kinds are extensible through the discriminated union in `src/layers/types.ts` (`enum`, `text` today). To add a new kind (e.g., `range`, `boolean`), add a discriminator branch and one render arm — affects only the inline filter renderer.

**File:** `src/components/FilterBar.tsx` — delete (no longer used).

**Verification:** Supermarkets card shows Brand + City selectors under its options; Hospitals card shows Type + City selectors under its options. Setting a value re-renders the matching layer correctly. Adding a (hypothetical) `getFilterSchema` to provinces would surface filters there with zero MapView edits.

---

## Phase 4 — "Nearby" cross-layer counts respect each layer's filters

Today, `ctx.getOtherFeatures("hospitals")` returns the module's raw features (all 5,336), so "Hospitals nearby" in the supermarket panel ignores the active Hospitals type/city filter. Same for "Supermarkets nearby" inside the hospital panel. And the "Competitors nearby" block in the supermarket panel iterates `raw.features` for that module — also ignoring its own filter.

**Design (extensible):**
- **File:** `src/layers/types.ts` — add to `LayerModule`:
  ```ts
  getFilteredFeatures?(): Feature[];
  ```
  Default: `getCurrentFeatures()` if filter isn't applied. Modules with filters override to return the post-filter list (they already compute it internally for `setData`).
- **File:** `src/layers/types.ts` — add to `LayerContext`:
  ```ts
  getOtherFilteredFeatures(layerId: string): Feature[];
  ```
- **File:** `src/components/MapView.tsx` — implement: `module.getFilteredFeatures?.() ?? module.getCurrentFeatures?.() ?? []`.
- **Files:** `src/layers/supermarkets.ts`, `src/layers/hospitals.ts` — implement `getFilteredFeatures()` returning `applyFilterToData().features`.
- **Files:** `src/layers/supermarkets.ts`, `src/layers/hospitals.ts` — replace cross-layer count sources:
  - `supermarkets.getDetailPanel`: hospitals counts use `ctx.getOtherFilteredFeatures("hospitals")`.
  - `hospitals.getDetailPanel`: supermarkets counts use `ctx.getOtherFilteredFeatures("supermarkets")`.
- **Same modules** — apply to within-layer "competitors nearby": iterate the same module's `applyFilterToData().features` (already accessible locally) rather than `raw.features`, excluding the currently-selected feature.

**Pure-function extraction** (smallest deep module):
- Move the ring-counting logic to a tiny helper exported from `src/lib/turf-helpers.ts`:
  ```ts
  export function countPointsInRingKm(points: Feature<Point>[], center: [number, number], km: number, excludeId?: number | string): number
  ```
  Replaces three near-identical copies (supermarkets, hospitals, hospital-coverage-gaps).

**Verification:**
1. Filter Hospitals → `type=pharmacy`. Click a supermarket in HCMC — "Hospitals nearby" counts go down (only pharmacies count); the actual hospitals visible on the map also restrict to pharmacies. The numbers in the panel and the dots on the map match conceptually.
2. Filter Supermarkets → `brand=VinMart`. Click a pharmacy in HCMC — "Supermarkets nearby" counts only VinMart stores.
3. Within supermarkets panel: "Competitors nearby" reflects the brand filter (so if you filter to VinMart and click a VinMart, you count only VinMart competitors).

---

## Critical files (this pass)

- `src/components/MapView.tsx` — `historyIndexRef`; refactored sidebar layout (flex column, dynamic maxHeight); inline filter render per layer; delete `<FilterBar>` usage.
- `src/components/FilterBar.tsx` — **delete**.
- `src/layers/types.ts` — `getFilteredFeatures` on `LayerModule`; `getOtherFilteredFeatures` on `LayerContext`.
- `src/layers/supermarkets.ts`, `src/layers/hospitals.ts` — implement `getFilteredFeatures`; switch in-panel counts to filtered sources; use new `countPointsInRingKm` helper.
- `src/layers/hospital-coverage-gaps.ts` — switch to filtered sources for symmetry (so the gaps recompute when the user changes hospital type filter).
- `src/lib/turf-helpers.ts` — add `countPointsInRingKm`.

No new components.

---

## Verification summary

- `npx tsc --noEmit` clean.
- All 4 phases pass their per-phase manual checks above.
- No new bundle deps.
- Adding a hypothetical new filter (e.g., `ownership` on hospitals) requires only adding one entry to `getFilterSchema` and one branch in `applyFilterToData`. Zero MapView changes — confirms the per-layer-filter contract is sound.

## Anti-patterns to guard

- Reintroducing closure-captured `historyIndex` reads — always go through the ref or `useRef.current`.
- Hardcoding `max-h-[100vh-...]` magic numbers — use the `sidebarPos.y` value so the constraint follows the panel.
- Adding a `<FilterBar>`-like global filter component — filters belong inside the layer card; the contract is `getFilterSchema` + `applyFilter`, not a centralized UI registry.
- Reading `raw.features` for cross-layer math — use `getOtherFilteredFeatures` so filters compose.

---

## Vercel best-practices applied

### Composition (from `vercel-composition-patterns`)

**Refactor the layer card into a compound component.** Instead of one giant `<li>` switch inside `MapView`, expose a small composable API:

```tsx
<LayerCard module={m} state={vis[m.id]} entitled={...} onChange={...}>
  <LayerCard.Toggle />
  <LayerCard.Opacity />
  <LayerCard.Options />     {/* renders module.getOptions() */}
  <LayerCard.Filters />     {/* renders module.getFilterSchema() */}
  <LayerCard.LockedCTA />   {/* shown only when not entitled */}
</LayerCard>
```

- Each subcomponent reads from a `LayerCardContext` provided by the wrapper — no prop drilling.
- Slots are optional: a future "labels" or "color-by" knob is a new subcomponent, not a `MapView` edit.
- Keeps the per-layer rendering localised; `MapView` becomes shorter and the layer-list `.map()` body is one line of JSX.

Single file `src/components/LayerCard.tsx`. Trade-off vs. inline JSX: ~150 LOC moved out for a real boundary that pays back the first time we add a new control type — which we already plan to.

### Performance (from `vercel-react-best-practices`)

- **Don't memoize blindly.** Detail-panel ring counts re-compute on selection change, which is rare (driven by clicks). Wrapping them in `useMemo` adds noise without measurable gain. Keep the pure helper `countPointsInRingKm` and call it directly.
- **Hot path = sidebar drag.** Today, every `pointermove` calls `setSidebarPos`, which re-renders `MapView` (the heaviest component) at ~120 Hz. Fix: drag updates a CSS variable on the sidebar's own ref via `element.style.setProperty('--x', ...)` — no React state during drag. Commit `sidebarPos` to React state once on `pointerup` (for URL persistence). This is the same pattern the Vercel React guide recommends for drag/scroll/resize handles.
- **Stable references for handlers passed into `LayerCard`.** Use `useCallback` only where the child is `React.memo`'d. We won't pre-memoize cards; they're cheap to render until the list grows past ~20 layers.
- **Avoid `getOptions()` / `getFilterSchema()` called on every render.** Today both run in the render path (and the filter schema in particular walks `raw.features`). Cache the result per `(layerId, raw-length)` inside MapView via a `useMemo` keyed on the data-load tick (`filterSchemaTick` already exists — reuse it).

### View Transitions (from `vercel-react-view-transitions`)

The panel back/forward (and any selection swap) is a perfect fit for native View Transitions:
- Wrap selection updates in `startViewTransition`: `document.startViewTransition?.(() => setSelectionState(sel))` inside `goHistory` and the click path.
- Mark the panel root with `style={{ viewTransitionName: 'gis-panel' }}` so the API knows what to crossfade.
- Add transition types so back/forward go *backward* visually and a fresh click goes *forward*: `addTransitionType('back' | 'forward' | 'new')` and CSS rules in `globals.css` that flip the slide direction.
- Progressive enhancement: if `startViewTransition` is unavailable (Safari < 18), just `setSelectionState(sel)` directly.

Reference: the View Transitions skill's "directional navigation" pattern.

### Accessibility (from `web-design-guidelines`)

- **Focus management on the panel:** when opening, move focus to the title `<h2>` (use `tabIndex={-1}` + `ref.focus()` inside an effect keyed on `selection`). On close, restore focus to the map canvas. Trap focus *within* the panel only when fully expanded.
- **Keyboard for nav buttons:** keep ←/→ buttons reachable in tab order; add `aria-keyshortcuts="Alt+ArrowLeft"` / `"Alt+ArrowRight"` and wire those keys globally.
- **`aria-disabled`** on Back/Forward when at boundary (today only the visual `:disabled` is set; screen readers benefit from the ARIA hint).
- **Color contrast:** the type chips for clinic / pharmacy use 100-shade backgrounds against 900-shade text — within AA. Verify against the actual rendered values with a contrast check, no code change unless failing.
- **`aria-live="polite"`** on the cross-layer counts so screen readers announce updated numbers when filters change.

These are surgical additions; none change the visual design. They turn the demo from "ships" to "ships and passes an axe-core run".

---

## Updated critical files

- `src/components/LayerCard.tsx` *(new)* — compound component owning the per-card UI.
- `src/components/MapView.tsx` — use `LayerCard`; drag via CSS-variable + ref (no state thrash); wrap selection swaps in `startViewTransition` when available; focus management for the panel; memoize schemas keyed on `filterSchemaTick`.
- `src/app/globals.css` — `gis-panel` view-transition names + CSS rules for back/forward slide.
- `src/components/DetailPanel.tsx` — `aria-disabled`, `aria-live`, focus management, `viewTransitionName`.

(All other files from the earlier phase list are unchanged.)

---

## React 19 hooks — chosen where proven, skipped where not

Stable in React 19 (the version this project ships): `useTransition`, `useDeferredValue`, `useSyncExternalStore`, `useId`, `useOptimistic`, `useActionState`. Use them only where they map cleanly to the problems we have.

### `useTransition` — selection swaps + filter changes

Selection swap and filter changes can trigger heavy renders (panel body recomputes ring counts; layer data is re-`setData`'d). Wrap them so they're interruptible and the map stays responsive:

```tsx
const [isPending, startTransition] = useTransition();
function setSelection(sel, opts) {
  startTransition(() => {
    // existing body
  });
}
function setFilterFor(layerId, next) {
  startTransition(() => setFilters((f) => ({ ...f, [layerId]: next })));
}
```

- `isPending` drives a subtle opacity / spinner on the panel during the swap (≤200 ms but useful on slower devices).
- Pairs with `startViewTransition` from the View Transitions section — wrap *both*: `startViewTransition(() => startTransition(() => …))`.

### `useDeferredValue` — text filters (when we add them)

When a future `text`-kind filter is added (e.g., "search name"), wrap the typed value:
```tsx
const deferredQuery = useDeferredValue(query);
useEffect(() => module.applyFilter(map, { ...state, name: deferredQuery }), [deferredQuery]);
```
Keeps typing snappy on large datasets (hospitals = 5,336 features).

### `useSyncExternalStore` — MapLibre map state

The map is an external store; today we wire `move`/`moveend` listeners manually and reconcile with React state. Replace with one `useSyncExternalStore` hook for the bits we *display*:
```ts
function useMapView(map: maplibregl.Map | null) {
  return useSyncExternalStore(
    (cb) => { map?.on("move", cb); return () => map?.off("move", cb); },
    () => map ? { lng: map.getCenter().lng, lat: map.getCenter().lat, zoom: map.getZoom() } : null,
    () => null,
  );
}
```
- Single subscription, no React state churn from move events.
- Replaces the URL-state `moveend` writer pattern with a derived value committed by an effect on `useDeferredValue(view)`.

### `useId` — a11y associations

Filter `<label>`/`<select>` and `<button aria-controls>` pairs in `LayerCard` get unique IDs from `useId()` so multiple cards on screen don't collide and `aria-controls` actually points somewhere.

### `useOptimistic` — only when there's a server round-trip

Skip. The mock entitlement "buy" form uses a server action; that's the *one* place `useOptimistic` would apply (instantly mark the layer as owned before the server confirms). If we wire it: in the dashboard's Buy form, optimistically push the layer id into `session.entitlements`. Until then, leave the server action as-is.

### `useActionState` — also defer

Same dashboard form would benefit (pending state, last result). Not in this pass.

### Hooks we **don't** use

- `useEffectEvent` — still RFC, not in stable React 19. Skip.
- `use()` on promises in render — appealing for the async geojson loads, but the map mount path already handles that fine via effects; switching to `use()` would force Suspense boundaries we don't need.
- `useCallback`/`useMemo` blanket-wrapping — only memoize when a child is `React.memo`'d AND the parent re-renders frequently. We'll add it only on the drag-update path and the deferred-view derivation.

### Trade-off honestly

Adopting `useTransition` + `useSyncExternalStore` adds ~30 lines of code total but flips the perf profile from "occasional stutter when filtering 5k points" to "stays at 60fps under most interactions". `useId` is a one-liner per label; pure win.

We are **not** rewriting the map integration around `useSyncExternalStore` in this pass — only the read-side derivations (current center/zoom for the URL hash and the mouse-coords pill). The map *control* effects (mount, style change, layer mount) stay as effects. Keeps the change reviewable.

---

## Trade-off analysis — is this worth it, and does it scale?

A blunt cost/value table for every change proposed in this pass, scored on three axes that matter for the demo's trajectory (more layers, more data, more filters):

| Change | LOC delta | Perf gain today | Perf gain at 10× scale | Maintainability | Verdict |
|---|---|---|---|---|---|
| `historyIndexRef` fix | +8 | Correctness, not perf | Same | ↑ (no closure foot-gun) | **Ship now** |
| Dynamic sidebar `maxHeight` | +3 | None | None | ↑ | **Ship now** |
| Inline filters per layer | ±50 | Neutral | ↑ (filters scale linearly with layer count, not panel) | ↑↑ | **Ship now** |
| Filter-aware "nearby" counts | +30 | Tiny | ↑ (no wasted work on filtered-out features) | ↑ | **Ship now** |
| `countPointsInRingKm` helper | +0 net (extracts dup) | None | Allows a future spatial-index swap *without* touching callers | ↑↑ | **Ship now** |
| CSS-variable drag (no React state) | +20 | Drag goes 120 Hz state-free | Same | → | **Ship now** |
| `useTransition` on filter/select | +20 | Subtle smoothness | ↑↑ (filter on 50k pts no longer blocks input) | → | **Ship now** |
| `useDeferredValue` on text filters | +5 (when added) | n/a today | ↑↑ for text search | → | Ship **with** first text filter |
| `useSyncExternalStore` for map view | +15 (−20 manual) | Drops 2 event listeners + 1 state | Same; eliminates a re-render path | ↑ | **Ship now** |
| `useId` for a11y | +1/label | None | None | ↑ (a11y) | **Ship now** |
| `LayerCard` compound component | +150 / −100 in MapView | None | ↑↑ (each new layer adds ~10 LOC, not 40) | ↑↑ | **Ship now** |
| View Transitions for panel back/fwd | +50 + CSS | UX polish | Same | → | **Optional this pass** — skip if pressed for time |
| `useOptimistic` / `useActionState` for Buy | +20 | Tiny | Same | → | **Defer** until real Stripe |
| Spatial index (RBush/Flatbush) for cross-layer | +30 + dep | None | **10–100×** on cross-layer queries | ↑ | **Defer** — add when a layer >10k pts AND user reports lag |
| Tenant-upload registry (`registerLayer`) | +50 | None | Enables uploads | ↑↑↑ | **Defer to vertical-slice phase** in the original PRD |

### Where the architecture breaks down (and what we'd do about it)

| Scale milestone | What hurts first | Fix when we hit it |
|---|---|---|
| 5 layers, 20k features total (≈3× today) | Nothing — current design handles this | — |
| 10 layers, 100k features | Cluster source `removeSource + addSource` on toggle/filter (~200 ms hitch) | Replace with `setData` only; never recreate source. Already half-done; finish in next pass. |
| 10 layers, filter active on 3+ | Cross-layer `pointInsidePoly` loops (O(n × m)) | Swap `countPointsInRingKm` to a Flatbush index built per-layer on data load |
| 50+ provinces or polygons, polygon filters | Polygon click → `getCurrentFeatures().find(id)` is O(n) | Build a `Map<id, Feature>` on data load; constant-time lookup |
| Tenant uploads (any size) | Static `LAYER_MODULES` array | Promote registry to runtime: `registerLayer(module)` + per-tenant entitlement scope |
| Tenant uploads >100k pts | Browser memory (geojson all-in-memory) | Pipeline through PMTiles or Martin tile server; module loads tile URLs instead of in-memory GeoJSON |

The good news: **every fix above is a local change to one module file or one helper**, not an architecture rewrite. That's the dividend of the LayerModule contract we already shipped.

### Maintainability — concretely, what does "adding a new layer" cost?

Today, adding e.g. a "Schools" layer means:
1. One new file: `src/layers/schools.ts` (~250 LOC, copy-pasted from hospitals.ts and edited).
2. One entry in `metadata.ts`.
3. One import + one push in `index.ts`.
4. Zero changes in `MapView.tsx`, `DetailPanel.tsx`, `Sidebar`-related code, URL state, or export.
5. If schools has unique filters (e.g., "education_level"), they appear automatically inline in its card.
6. Cross-layer "schools nearby in supermarket panel" requires one line of code in `supermarkets.ts` (already symmetric for hospitals).

After this pass with `LayerCard` compound: same as above, no extra steps.

### Flexibility — how easily do we add new filter *kinds*?

Today: `enum` and `text`. Adding `range` (e.g., "year built >") is:
1. Add `{ kind: "range", min, max }` branch to `FilterField` union in `types.ts`.
2. Add render arm in `LayerCard.Filters` (~20 LOC).
3. Modules that want it implement applyFilter accordingly.

The same shape works for `multiselect`, `date-range`, `geofence`, etc. We're not painted into a corner.

### Performance — what guarantees no lag?

We aren't *guaranteeing* anything without measuring. What this plan does is:

- Keep the **hot interaction paths (click, hover, drag, filter)** off the React render path where possible.
- Make the *first* re-render cheap and any subsequent re-renders interruptible (`useTransition`).
- Push expensive work (point-in-polygon, geojson parsing) out of the render path into helpers we can later swap for indexed implementations.

**Recommendation for the next pass after this one:** add a tiny `perf-check.ts` that wraps key interactions with `performance.measure` and logs anything > 50 ms (one main-thread frame budget at 60fps). Catches regressions early. ~30 LOC, no library.

### Bottom line on the question "is it worth it?"

Yes for everything marked **Ship now**. The total diff is ~300 LOC of additions, ~150 LOC moved, and zero new dependencies. Three of those changes (`useTransition`, `useSyncExternalStore`, CSS-variable drag) are pure perf with no UX risk; the rest are correctness + ergonomics that *make the next 5 layers cheap to add*. The one item with real risk — View Transitions — is optional and easy to back out.
