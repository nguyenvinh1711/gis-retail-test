import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { createElement, useState } from "react";
import { featureBbox, pointsInsidePolygon } from "@/lib/turf-helpers";
import { clearLeavesOverlay, mountLeavesOverlay, setLeafHover } from "./_overlays";
import type { LayerContext, LayerModule } from "./types";

let raw: FeatureCollection<Polygon | MultiPolygon> = { type: "FeatureCollection", features: [] };
let loaded = false;

async function loadRaw(map: MLMap): Promise<void> {
  if (loaded) return;
  const r = await fetch("/data/vn-provinces.geojson");
  raw = (await r.json()) as FeatureCollection<Polygon | MultiPolygon>;
  raw.features = raw.features.map((f, i) => ({ ...f, id: i }));
  loaded = true;
  const src = map.getSource(SRC) as GeoJSONSource | undefined;
  if (src) src.setData(raw);
}

const SRC = "prov-src";
const FILL = "prov-fill";
const LINE = "prov-line";
const SEL_LINE = "prov-sel-line";
const SEL_FILL = "prov-sel-fill";

export const provincesLayer: LayerModule = {
  id: "vn-provinces",
  name: "Vietnam Provinces",
  description: "Administrative boundaries (level 1).",
  category: "Reference",
  visibility: "public",

  mount(ctx) {
    const map = ctx.map;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, {
        type: "geojson",
        data: loaded ? raw : { type: "FeatureCollection", features: [] },
        // We assign deterministic ids in loadRaw() so feature-state + selection work.
      });
    }
    loadRaw(map).catch((e) => console.error("provinces data load failed", e));
    if (!map.getLayer(FILL)) {
      map.addLayer({
        id: FILL,
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": "#2563eb",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.25,
            0.08,
          ],
        },
      });
    }
    if (!map.getLayer(LINE)) {
      map.addLayer({
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": "#1d4ed8",
          "line-width": 0.8,
        },
      });
    }
  },

  unmount(map) {
    for (const id of [SEL_LINE, SEL_FILL, FILL, LINE]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SRC)) map.removeSource(SRC);
  },

  setVisible(map, visible) {
    const v = visible ? "visible" : "none";
    for (const id of [FILL, LINE]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    }
  },

  setOpacity(map, opacity) {
    if (map.getLayer(FILL)) {
      map.setPaintProperty(FILL, "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        0.25 * opacity,
        0.08 * opacity,
      ]);
    }
    if (map.getLayer(LINE)) map.setPaintProperty(LINE, "line-opacity", opacity);
  },

  interactiveLayerIds() {
    return [FILL];
  },

  getHoverTooltip(feature) {
    const name = (feature.properties?.shapeName as string) ?? "Province";
    return createElement("div", { className: "space-y-0.5" }, [
      createElement(
        "div",
        { key: "chip", className: "inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-900 dark:bg-blue-900 dark:text-blue-100" },
        "Province"
      ),
      createElement("div", { key: "n", className: "font-semibold text-zinc-900 dark:text-zinc-50" }, name),
      createElement("div", { key: "h", className: "text-[11px] text-zinc-600 dark:text-zinc-400" }, "Click for details"),
    ]);
  },

  onFeatureClick(feature, ctx) {
    const map = ctx.map;
    // Transient highlight layers driven by a one-feature source.
    const data = { type: "FeatureCollection" as const, features: [feature] };
    const srcId = "prov-sel-src";
    if (map.getSource(srcId)) {
      (map.getSource(srcId) as maplibregl.GeoJSONSource).setData(data);
    } else {
      map.addSource(srcId, { type: "geojson", data });
    }
    if (!map.getLayer(SEL_FILL)) {
      map.addLayer({
        id: SEL_FILL,
        type: "fill",
        source: srcId,
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.18 },
      });
    }
    if (!map.getLayer(SEL_LINE)) {
      map.addLayer({
        id: SEL_LINE,
        type: "line",
        source: srcId,
        paint: { "line-color": "#d97706", "line-width": 2.5 },
      });
    }
  },

  onSelectionCleared(map) {
    for (const id of [SEL_LINE, SEL_FILL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    const srcId = "prov-sel-src";
    if (map.getSource(srcId)) map.removeSource(srcId);
    clearLeavesOverlay(map);
  },

  getDetailPanel(feature, ctx) {
    return createElement(ProvincePanel, { feature, ctx });
  },

  getCurrentFeatures() {
    return raw.features;
  },

  // No filtering UX for provinces in v1.
  // No export — provinces are a reference layer.
};

function ProvincePanel({ feature, ctx }: { feature: Feature; ctx: LayerContext }) {
  const name = (feature.properties?.shapeName as string) ?? "Province";
  const supermarketFeatures = ctx.getOtherFeatures("supermarkets") as Feature<Point>[];

  let inside: Feature<Point>[] = [];
  if (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") {
    inside = pointsInsidePolygon(
      supermarketFeatures,
      feature as Feature<typeof feature.geometry & { type: "Polygon" | "MultiPolygon" }>
    );
  }
  const brandCounts: Record<string, number> = {};
  for (const p of inside) {
    const b = (p.properties?.brand as string) ?? "Unknown";
    brandCounts[b] = (brandCounts[b] ?? 0) + 1;
  }
  const sortedBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  const [w, s, e, n] = featureBbox(feature);

  const [openBrand, setOpenBrand] = useState<string | null>(null);

  function selectBrand(brand: string) {
    if (openBrand === brand) {
      setOpenBrand(null);
      clearLeavesOverlay(ctx.map);
      return;
    }
    const stores = inside.filter((f) => (f.properties?.brand as string) === brand);
    setOpenBrand(brand);
    mountLeavesOverlay(ctx.map, stores);
  }

  return createElement("div", { className: "space-y-4" }, [
    createElement("div", { key: "header" }, [
      createElement(
        "div",
        { key: "chip", className: "inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-900 dark:bg-blue-900 dark:text-blue-100" },
        "Province"
      ),
      createElement("h2", { key: "name", className: "mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50" }, name),
      createElement(
        "div",
        { key: "bbox", className: "mt-1 font-mono text-[11px] text-zinc-500" },
        `bbox: W ${w.toFixed(4)}, S ${s.toFixed(4)}, E ${e.toFixed(4)}, N ${n.toFixed(4)}`
      ),
    ]),
    createElement("div", { key: "stat", className: "rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800" }, [
      createElement("div", { key: "l", className: "text-xs uppercase tracking-wide text-zinc-500" }, "Supermarkets in province"),
      createElement("div", { key: "v", className: "text-3xl font-semibold text-zinc-900 dark:text-zinc-50" }, String(inside.length)),
    ]),
    sortedBrands.length > 0 &&
      createElement("div", { key: "brands" }, [
        createElement("div", { key: "l", className: "mb-2 text-xs uppercase tracking-wide text-zinc-500" }, "Brand breakdown — click a row to see locations"),
        createElement(
          "ul",
          { key: "ul", className: "divide-y divide-zinc-100 rounded border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-700" },
          sortedBrands.map(([brand, count]) => {
            const isOpen = openBrand === brand;
            const stores = isOpen ? inside.filter((f) => (f.properties?.brand as string) === brand) : [];
            return createElement("li", { key: brand }, [
              createElement(
                "button",
                {
                  key: "row",
                  type: "button",
                  className: `flex w-full items-center justify-between px-3 py-2 text-left ${
                    isOpen ? "bg-amber-50 dark:bg-amber-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`,
                  onClick: () => selectBrand(brand),
                },
                [
                  createElement("span", { key: "b", className: "flex items-center gap-2" }, [
                    createElement("span", { key: "arrow", className: "text-xs text-zinc-400" }, isOpen ? "▾" : "▸"),
                    createElement("span", { key: "name", className: "font-medium text-zinc-900 dark:text-zinc-50" }, brand),
                  ]),
                  createElement("span", { key: "c", className: "rounded bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" }, String(count)),
                ]
              ),
              isOpen &&
                createElement(
                  "ul",
                  { key: "stores", className: "border-t border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900" },
                  stores.map((f) =>
                    createElement(
                      "li",
                      { key: String(f.id) },
                      createElement(
                        "button",
                        {
                          type: "button",
                          className: "block w-full px-4 py-2 text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-950/30",
                          onMouseEnter: () => setLeafHover(ctx.map, f.id as number, true),
                          onMouseLeave: () => setLeafHover(ctx.map, f.id as number, false),
                          onClick: () => ctx.selectFeatureById("supermarkets", f.id as number),
                        },
                        [
                          createElement("div", { key: "n", className: "font-medium text-zinc-900 dark:text-zinc-50" }, (f.properties?.name as string) || "Unnamed"),
                          createElement("div", { key: "city", className: "text-[11px] text-zinc-500" }, (f.properties?.city as string) || ""),
                        ]
                      )
                    )
                  )
                ),
            ]);
          })
        ),
      ]),
  ]);
}
