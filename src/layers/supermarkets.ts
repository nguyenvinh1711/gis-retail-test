import type { Feature, FeatureCollection, Point } from "geojson";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import { createElement } from "react";
import { countPointsInRingKm, ringAround } from "@/lib/turf-helpers";
import { LEAVES_SRC, clearLeavesOverlay, mountLeavesOverlay, setLeafHover } from "./_overlays";
import type {
  FilterField,
  FilterState,
  LayerContext,
  LayerModule,
  LayerOption,
} from "./types";

const SRC = "super-src";
const CLUSTERS = "super-clusters";
const CLUSTER_COUNT = "super-cluster-count";
const POINTS = "super-points";

const RINGS_SRC = "super-rings-src";
const RINGS_FILL = "super-rings-fill";
const RINGS_LINE = "super-rings-line";

const RING_KM = [1, 3, 5] as const;
const PREFERRED_URL = "/data/supermarkets-real.geojson";
const FALLBACK_URL = "/data/supermarkets.geojson";

let raw: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
let loaded = false;
let filterState: FilterState = {};
let clusterEnabled = true;

async function loadRaw(map: MLMap): Promise<void> {
  if (loaded) return;
  let url = PREFERRED_URL;
  try {
    const head = await fetch(PREFERRED_URL, { method: "HEAD" });
    if (!head.ok) url = FALLBACK_URL;
  } catch {
    url = FALLBACK_URL;
  }
  const r = await fetch(url);
  raw = (await r.json()) as FeatureCollection<Point>;
  raw.features = raw.features.map((f, i) => ({ ...f, id: i }));
  loaded = true;
  const src = map.getSource(SRC) as GeoJSONSource | undefined;
  if (src) src.setData(applyFilterToData());
}

function applyFilterToData(): FeatureCollection<Point> {
  const brand = filterState.brand;
  const city = filterState.city;
  if (!brand && !city) return raw;
  return {
    type: "FeatureCollection",
    features: raw.features.filter((f) => {
      const p = f.properties ?? {};
      if (brand && p.brand !== brand) return false;
      if (city && p.city !== city) return false;
      return true;
    }),
  };
}

function uniqueValues(key: string): string[] {
  const set = new Set<string>();
  for (const f of raw.features) {
    const v = f.properties?.[key];
    if (typeof v === "string" && v.trim()) set.add(v);
  }
  return Array.from(set).sort();
}

function ringContains(ring: number[][], [x, y]: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInsidePoly(pt: [number, number], poly: Feature): boolean {
  const g = poly.geometry as { type: string; coordinates: number[][][] | number[][][][] };
  const polys = g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
  for (const rings of polys) {
    if (ringContains(rings[0], pt) && rings.slice(1).every((h) => !ringContains(h, pt))) return true;
  }
  return false;
}
function countWithinRing(center: [number, number], km: number, excludeId: number | string | undefined): number {
  const ring = ringAround(center, km);
  let n = 0;
  for (const f of raw.features) {
    if (excludeId !== undefined && f.id === excludeId) continue;
    const [lng, lat] = f.geometry.coordinates;
    if (pointInsidePoly([lng, lat], ring)) n++;
  }
  return n;
}

function mountPointLayers(map: MLMap): void {
  // (Re)create source with current cluster flag.
  if (map.getLayer(POINTS)) map.removeLayer(POINTS);
  if (map.getLayer(CLUSTER_COUNT)) map.removeLayer(CLUSTER_COUNT);
  if (map.getLayer(CLUSTERS)) map.removeLayer(CLUSTERS);
  if (map.getSource(SRC)) map.removeSource(SRC);

  map.addSource(SRC, {
    type: "geojson",
    data: applyFilterToData(),
    ...(clusterEnabled ? { cluster: true, clusterMaxZoom: 12, clusterRadius: 50 } : {}),
  });

  if (clusterEnabled) {
    map.addLayer({
      id: CLUSTERS,
      type: "circle",
      source: SRC,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step", ["get", "point_count"],
          "#fca5a5", 10, "#f87171", 30, "#ef4444", 100, "#b91c1c",
        ],
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 30, 22, 100, 28],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });
    map.addLayer({
      id: CLUSTER_COUNT,
      type: "symbol",
      source: SRC,
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": "#ffffff" },
    });
  }
  map.addLayer({
    id: POINTS,
    type: "circle",
    source: SRC,
    filter: clusterEnabled ? ["!", ["has", "point_count"]] : ["literal", true],
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        4, ["case", ["boolean", ["feature-state", "hover"], false], 7, 3],
        12, ["case", ["boolean", ["feature-state", "hover"], false], 10, 6],
      ],
      "circle-color": "#dc2626",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-opacity": 0.9,
    },
  });
}

export const supermarketsLayer: LayerModule = {
  id: "supermarkets",
  name: "Supermarkets",
  description: "377 retail locations across Vietnam.",
  category: "Retail",
  visibility: "public",

  mount(ctx) {
    const map = ctx.map;
    mountPointLayers(map);
    loadRaw(map).catch((e) => console.error("supermarkets data load failed", e));
  },

  unmount(map: MLMap) {
    clearLeavesOverlay(map);
    for (const id of [POINTS, CLUSTER_COUNT, CLUSTERS, RINGS_LINE, RINGS_FILL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SRC)) map.removeSource(SRC);
    if (map.getSource(RINGS_SRC)) map.removeSource(RINGS_SRC);
  },

  setVisible(map, visible) {
    const v = visible ? "visible" : "none";
    for (const id of [CLUSTERS, CLUSTER_COUNT, POINTS]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    }
  },

  setOpacity(map, opacity) {
    for (const id of [CLUSTERS, POINTS]) {
      if (map.getLayer(id)) map.setPaintProperty(id, "circle-opacity", opacity);
    }
  },

  interactiveLayerIds() {
    return [POINTS, CLUSTERS];
  },

  getOptions(): LayerOption[] {
    return [{ id: "cluster", label: "Cluster nearby points", kind: "boolean", default: true }];
  },

  setOption(map, optionId, value) {
    if (optionId === "cluster") {
      const next = Boolean(value);
      if (next === clusterEnabled) return;
      clusterEnabled = next;
      // Clear leaves overlay (refers to old source) and re-mount.
      clearLeavesOverlay(map);
      mountPointLayers(map);
    }
  },

  getHoverTooltip(feature) {
    if (feature.properties?.cluster) {
      const n = feature.properties.point_count as number;
      const [lng, lat] = ((feature.geometry as Point)?.coordinates as [number, number]) ?? [0, 0];
      return createElement("div", { className: "space-y-0.5" }, [
        createElement(
          "div",
          { key: "chip", className: "inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-900 dark:bg-red-900 dark:text-red-100" },
          "Cluster"
        ),
        createElement("div", { key: "n", className: "font-semibold text-zinc-900 dark:text-zinc-50" }, `${n} supermarkets`),
        createElement("div", { key: "h", className: "text-[11px] text-zinc-600 dark:text-zinc-400" }, "Click to explore"),
        createElement("div", { key: "c", className: "font-mono text-[10px] text-zinc-500" }, `${lng.toFixed(5)}, ${lat.toFixed(5)}`),
      ]);
    }
    const p = feature.properties ?? {};
    const [lng, lat] = ((feature.geometry as Point)?.coordinates as [number, number]) ?? [0, 0];
    return createElement("div", { className: "space-y-0.5" }, [
      createElement(
        "div",
        { key: "chip", className: "inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-900 dark:bg-red-900 dark:text-red-100" },
        "Supermarket"
      ),
      createElement(
        "div",
        { key: "n", className: "font-semibold text-zinc-900 dark:text-zinc-50" },
        (p.name as string) || (p.brand as string) || "Unnamed"
      ),
      createElement("div", { key: "b", className: "text-[11px] text-zinc-600 dark:text-zinc-400" }, (p.brand as string) || ""),
      createElement("div", { key: "city", className: "text-[10px] text-zinc-500" }, (p.city as string) || ""),
      createElement("div", { key: "c", className: "font-mono text-[10px] text-zinc-500" }, `${lng.toFixed(5)}, ${lat.toFixed(5)}`),
    ]);
  },

  customClick(feature, ctx) {
    if (!feature.properties?.cluster) return false;
    const clusterId = feature.properties.cluster_id as number;
    const center = (feature.geometry as Point).coordinates as [number, number];
    const src = ctx.map.getSource(SRC) as GeoJSONSource;

    Promise.all([
      src.getClusterExpansionZoom(clusterId),
      src.getClusterLeaves(clusterId, 100, 0),
    ])
      .then(([expansionZoom, leaves]) => {
        // Clamp zoom so the cluster doesn't shatter on a single click.
        const clamped = Math.min(expansionZoom, ctx.map.getZoom() + 1.5);
        ctx.map.flyTo({ center, zoom: clamped, duration: 600 });

        // Draw leaves overlay on the map (shared helper).
        mountLeavesOverlay(ctx.map, leaves as Feature<Point>[]);

        // Selection: synthetic cluster feature drives the detail panel.
        const synth: Feature = {
          type: "Feature",
          geometry: { type: "Point", coordinates: center },
          properties: {
            cluster: true,
            cluster_id: clusterId,
            point_count: feature.properties?.point_count ?? leaves.length,
            leaf_ids: leaves.map((l) => (l as Feature).id),
          },
          id: `cluster-${clusterId}`,
        };
        ctx.setSelection({ layerId: "supermarkets", feature: synth });
      })
      .catch((e) => console.error("cluster expansion failed", e));
    return true;
  },

  onFeatureClick(feature, ctx) {
    if (feature.properties?.cluster) return; // handled in customClick
    const center = (feature.geometry as Point).coordinates as [number, number];
    const ringFeatures: Feature[] = RING_KM.map((km) => {
      const r = ringAround(center, km);
      return { ...r, properties: { km } };
    });
    const data: FeatureCollection = { type: "FeatureCollection", features: ringFeatures };
    if (ctx.map.getSource(RINGS_SRC)) {
      (ctx.map.getSource(RINGS_SRC) as GeoJSONSource).setData(data);
    } else {
      ctx.map.addSource(RINGS_SRC, { type: "geojson", data });
    }
    if (!ctx.map.getLayer(RINGS_FILL)) {
      ctx.map.addLayer(
        {
          id: RINGS_FILL, type: "fill", source: RINGS_SRC,
          paint: {
            "fill-color": "#dc2626",
            "fill-opacity": ["interpolate", ["linear"], ["get", "km"], 1, 0.18, 5, 0.04],
          },
        },
        POINTS
      );
    }
    if (!ctx.map.getLayer(RINGS_LINE)) {
      ctx.map.addLayer(
        {
          id: RINGS_LINE, type: "line", source: RINGS_SRC,
          paint: { "line-color": "#dc2626", "line-width": 1, "line-dasharray": [2, 2] },
        },
        POINTS
      );
    }
  },

  onSelectionCleared(map) {
    for (const id of [RINGS_LINE, RINGS_FILL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(RINGS_SRC)) map.removeSource(RINGS_SRC);
    clearLeavesOverlay(map);
  },

  getDetailPanel(feature, ctx) {
    if (feature.properties?.cluster) {
      const leafIds = (feature.properties.leaf_ids as (string | number)[]) ?? [];
      const leafFeatures = leafIds
        .map((id) => raw.features.find((f) => f.id === id))
        .filter(Boolean) as Feature<Point>[];
      const [clng, clat] = (feature.geometry as Point).coordinates as [number, number];

      return createElement("div", { className: "space-y-4" }, [
        createElement("div", { key: "h" }, [
          createElement(
            "div",
            { key: "chip", className: "inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
            "Cluster"
          ),
          createElement("h2", { key: "n", className: "mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50" }, `${leafFeatures.length} supermarkets`),
          createElement("div", { key: "h2", className: "text-sm text-zinc-600 dark:text-zinc-400" }, "Click any to drill in"),
          createElement("div", { key: "c", className: "mt-1 font-mono text-[11px] text-zinc-500" }, `Center: ${clng.toFixed(5)}, ${clat.toFixed(5)}`),
        ]),
        createElement(
          "ul",
          { key: "ul", className: "max-h-[60vh] space-y-1 overflow-auto rounded border border-zinc-200 dark:border-zinc-700" },
          leafFeatures.map((f) =>
            createElement(
              "li",
              { key: String(f.id) },
              createElement(
                "button",
                {
                  className: "block w-full px-3 py-2 text-left text-sm hover:bg-amber-50 dark:hover:bg-amber-950/30",
                  onMouseEnter: () => setLeafHover(ctx.map, f.id as number, true),
                  onMouseLeave: () => setLeafHover(ctx.map, f.id as number, false),
                  onClick: () => ctx.selectFeatureById("supermarkets", f.id as number),
                },
                [
                  createElement("div", { key: "n", className: "font-medium text-zinc-900 dark:text-zinc-50" }, (f.properties?.name as string) || (f.properties?.brand as string) || "Unnamed"),
                  createElement("div", { key: "b", className: "text-xs text-zinc-500" }, [(f.properties?.brand as string) || "", " · ", (f.properties?.city as string) || ""].join("")),
                ]
              )
            )
          )
        ),
      ]);
    }

    const p = feature.properties ?? {};
    const center = (feature.geometry as Point).coordinates as [number, number];
    // "Competitors nearby" respects the active supermarket filter.
    const ownFiltered = applyFilterToData().features;
    const counts = RING_KM.map((km) => ({ km, n: countPointsInRingKm(ownFiltered, center, km, feature.id) }));
    const [lng, lat] = center;
    const coordsStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    // "Hospitals nearby" respects the active hospital filter.
    const hospitals = (ctx.getOtherFilteredFeatures("hospitals") ?? []) as Feature<Point>[];
    const hospCounts = RING_KM.map((km) => ({ km, n: countPointsInRingKm(hospitals, center, km) }));

    return createElement("div", { className: "space-y-4" }, [
      createElement("div", { key: "h" }, [
        createElement(
          "div",
          { key: "chip", className: "inline-block rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-900 dark:bg-red-900 dark:text-red-100" },
          "Supermarket"
        ),
        createElement("h2", { key: "n", className: "mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50" }, (p.name as string) || "Unnamed"),
        createElement("div", { key: "b", className: "text-sm text-zinc-600 dark:text-zinc-400" }, (p.brand as string) || ""),
      ]),
      createElement("dl", { key: "attrs", className: "rounded border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800" }, [
        kv("Address", (p.address as string) || "—"),
        kv("City", (p.city as string) || "—"),
        kv("Type", (p.type as string) || "—"),
        p.geocode_source ? kv("Coords source", (p.geocode_source as string)) : null,
        coordsRow(coordsStr),
      ].filter(Boolean) as ReturnType<typeof kv>[]),
      createElement("div", { key: "rings" }, [
        createElement("div", { key: "l", className: "mb-2 text-xs uppercase tracking-wide text-zinc-500" }, "Competitors nearby"),
        createElement(
          "ul",
          { key: "ul", className: "space-y-1" },
          counts.map(({ km, n }) =>
            createElement(
              "li",
              { key: km, className: "flex items-center justify-between rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700" },
              [
                createElement("span", { key: "k", className: "text-sm text-zinc-600 dark:text-zinc-300" }, `Within ${km} km`),
                createElement("span", { key: "v", className: "text-lg font-semibold text-zinc-900 dark:text-zinc-50" }, String(n)),
              ]
            )
          )
        ),
      ]),
      createElement("div", { key: "hosp" }, [
        createElement("div", { key: "l", className: "mb-2 text-xs uppercase tracking-wide text-zinc-500" }, "Hospitals nearby"),
        hospitals.length === 0
          ? createElement("div", { key: "hint", className: "rounded border border-dashed border-zinc-300 p-2 text-xs text-zinc-500 dark:border-zinc-700" }, "Enable the Hospitals layer to see counts")
          : createElement(
              "ul",
              { key: "ul", className: "space-y-1" },
              hospCounts.map(({ km, n }) =>
                createElement(
                  "li",
                  { key: km, className: "flex items-center justify-between rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700" },
                  [
                    createElement("span", { key: "k", className: "text-sm text-zinc-600 dark:text-zinc-300" }, `Within ${km} km`),
                    createElement("span", { key: "v", className: "text-lg font-semibold text-emerald-700 dark:text-emerald-300" }, String(n)),
                  ]
                )
              )
            ),
      ]),
    ]);
  },

  getFilterSchema(): FilterField[] {
    return [
      { id: "brand", label: "Brand", kind: "enum", options: uniqueValues("brand").map((v) => ({ value: v, label: v })) },
      { id: "city", label: "City", kind: "enum", options: uniqueValues("city").map((v) => ({ value: v, label: v })) },
    ];
  },

  applyFilter(map, state) {
    filterState = state;
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(applyFilterToData());
  },

  getExportableFeatures() {
    return applyFilterToData().features;
  },

  getCurrentFeatures() {
    return raw.features;
  },

  getFilteredFeatures() {
    return applyFilterToData().features;
  },
};

function kv(label: string, value: string) {
  return createElement("div", { key: label, className: "flex justify-between gap-3 py-1 text-xs" }, [
    createElement("dt", { key: "k", className: "text-zinc-500" }, label),
    createElement("dd", { key: "v", className: "text-right text-zinc-900 dark:text-zinc-50" }, value),
  ]);
}

function coordsRow(value: string) {
  return createElement("div", { key: "coords", className: "flex items-center justify-between gap-3 py-1 text-xs" }, [
    createElement("dt", { key: "k", className: "text-zinc-500" }, "Coordinates"),
    createElement("dd", { key: "v", className: "flex items-center gap-1 text-right" }, [
      createElement("span", { key: "s", className: "font-mono text-zinc-900 dark:text-zinc-50" }, value),
      createElement(
        "button",
        {
          key: "btn",
          type: "button",
          className: "rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700",
          onClick: () => {
            navigator.clipboard?.writeText(value).catch(() => {});
          },
        },
        "Copy"
      ),
    ]),
  ]);
}
