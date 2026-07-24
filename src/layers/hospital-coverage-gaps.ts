import type { Feature, FeatureCollection, Point } from "geojson";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import { ringAround } from "@/lib/turf-helpers";
import type { LayerContext, LayerModule } from "./types";

const SRC = "gaps-src";
const HEAT = "gaps-heat";

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

function compute(ctx: LayerContext): FeatureCollection<Point> {
  const supermarkets = (ctx.getOtherFeatures("supermarkets") ?? []) as Feature<Point>[];
  const hospitals = (ctx.getOtherFeatures("hospitals") ?? []) as Feature<Point>[];
  if (supermarkets.length === 0) return { type: "FeatureCollection", features: [] };

  const features: Feature<Point>[] = supermarkets.map((s) => {
    const c = s.geometry.coordinates as [number, number];
    const ring = ringAround(c, 3);
    let hospitalsNear = 0;
    for (const h of hospitals) {
      if (pointInsidePoly(h.geometry.coordinates as [number, number], ring)) hospitalsNear++;
    }
    // Demand = 1 per supermarket; supply = 0.5 per nearby hospital.
    // Weight is clamped to [0..1] and squared to emphasize true gaps.
    const w = Math.max(0, 1 - 0.5 * hospitalsNear);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: c },
      properties: { weight: w * w },
    };
  });
  return { type: "FeatureCollection", features };
}

export const hospitalCoverageGapsLayer: LayerModule = {
  id: "hospital-coverage-gaps",
  name: "Hospital coverage gaps",
  description: "Underserved-area heatmap (high retail demand, low hospital supply).",
  category: "Healthcare",
  visibility: "premium",

  mount(ctx) {
    const map = ctx.map;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    // Try to compute immediately; if other layers aren't loaded yet, retry briefly.
    const tryCompute = () => {
      const data = compute(ctx);
      if (data.features.length > 0) {
        (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(data);
      } else {
        setTimeout(tryCompute, 600);
      }
    };
    setTimeout(tryCompute, 300);

    if (!map.getLayer(HEAT)) {
      map.addLayer({
        id: HEAT,
        type: "heatmap",
        source: SRC,
        paint: {
          "heatmap-weight": ["get", "weight"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 1, 12, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 18, 10, 44],
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(250, 204, 21, 0.5)",
            0.5, "rgba(249, 115, 22, 0.75)",
            1, "rgba(190, 18, 60, 0.95)",
          ],
        },
      });
    }
  },

  unmount(map: MLMap) {
    if (map.getLayer(HEAT)) map.removeLayer(HEAT);
    if (map.getSource(SRC)) map.removeSource(SRC);
  },

  setVisible(map, visible) {
    if (map.getLayer(HEAT)) map.setLayoutProperty(HEAT, "visibility", visible ? "visible" : "none");
  },

  setOpacity(map, opacity) {
    if (map.getLayer(HEAT)) map.setPaintProperty(HEAT, "heatmap-opacity", opacity);
  },

  interactiveLayerIds() {
    return [];
  },
};
