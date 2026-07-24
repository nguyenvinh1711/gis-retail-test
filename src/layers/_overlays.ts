import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import bbox from "@turf/bbox";

export const LEAVES_SRC = "shared-leaves-src";
export const LEAVES_LAYER = "shared-leaves";
export const LEAVES_HALO_SRC = "shared-leaves-halo-src";
export const LEAVES_HALO_FILL = "shared-leaves-halo-fill";
export const LEAVES_HALO_LINE = "shared-leaves-halo-line";

/** Draw a transient overlay of point features with amber rings + a bounding-box halo. */
export function mountLeavesOverlay(map: MLMap, features: Feature<Point>[]): void {
  const fc: FeatureCollection<Point> = { type: "FeatureCollection", features };
  if (map.getSource(LEAVES_SRC)) {
    (map.getSource(LEAVES_SRC) as GeoJSONSource).setData(fc);
  } else {
    map.addSource(LEAVES_SRC, { type: "geojson", data: fc, promoteId: "id" });
  }
  if (!map.getLayer(LEAVES_LAYER)) {
    map.addLayer({
      id: LEAVES_LAYER,
      type: "circle",
      source: LEAVES_SRC,
      paint: {
        "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 11, 8],
        "circle-color": "#dc2626",
        "circle-stroke-color": "#f59e0b",
        "circle-stroke-width": 2.5,
        "circle-opacity": 0.95,
      },
    });
  }
  if (features.length > 1) {
    const [w, s, e, n] = bbox(fc) as [number, number, number, number];
    const pad = 0.005;
    const halo: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad], [w - pad, s - pad]]],
      },
    };
    const haloFc: FeatureCollection = { type: "FeatureCollection", features: [halo] };
    if (map.getSource(LEAVES_HALO_SRC)) {
      (map.getSource(LEAVES_HALO_SRC) as GeoJSONSource).setData(haloFc);
    } else {
      map.addSource(LEAVES_HALO_SRC, { type: "geojson", data: haloFc });
    }
    if (!map.getLayer(LEAVES_HALO_FILL)) {
      map.addLayer(
        {
          id: LEAVES_HALO_FILL,
          type: "fill",
          source: LEAVES_HALO_SRC,
          paint: { "fill-color": "#f59e0b", "fill-opacity": 0.06 },
        },
        LEAVES_LAYER
      );
    }
    if (!map.getLayer(LEAVES_HALO_LINE)) {
      map.addLayer(
        {
          id: LEAVES_HALO_LINE,
          type: "line",
          source: LEAVES_HALO_SRC,
          paint: { "line-color": "#f59e0b", "line-width": 1, "line-dasharray": [3, 3] },
        },
        LEAVES_LAYER
      );
    }
  } else {
    // Clear any prior halo since this overlay has 0 or 1 features.
    for (const id of [LEAVES_HALO_LINE, LEAVES_HALO_FILL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(LEAVES_HALO_SRC)) map.removeSource(LEAVES_HALO_SRC);
  }
}

export function clearLeavesOverlay(map: MLMap): void {
  for (const id of [LEAVES_LAYER, LEAVES_HALO_LINE, LEAVES_HALO_FILL]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [LEAVES_SRC, LEAVES_HALO_SRC]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

export function setLeafHover(map: MLMap, id: string | number, hover: boolean): void {
  if (!map.getSource(LEAVES_SRC)) return;
  map.setFeatureState({ source: LEAVES_SRC, id: id as number }, { hover });
}
