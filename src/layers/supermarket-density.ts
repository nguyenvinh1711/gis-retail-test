import type { FeatureCollection, Point } from "geojson";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import type { LayerModule } from "./types";

const SRC = "density-src";
const HEAT = "density-heat";

const PREFERRED_URL = "/data/supermarkets-real.geojson";
const FALLBACK_URL = "/data/supermarkets.geojson";

async function dataUrl(): Promise<string> {
  try {
    const r = await fetch(PREFERRED_URL, { method: "HEAD" });
    return r.ok ? PREFERRED_URL : FALLBACK_URL;
  } catch {
    return FALLBACK_URL;
  }
}

export const supermarketDensityLayer: LayerModule = {
  id: "supermarket-density",
  name: "Supermarket Density",
  description: "Heatmap of retail density — useful for catchment analysis.",
  category: "Retail",
  visibility: "premium",

  mount(ctx) {
    const map = ctx.map;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      dataUrl().then((url) =>
        fetch(url)
          .then((r) => r.json() as Promise<FeatureCollection<Point>>)
          .then((d) => (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(d))
          .catch(() => {})
      );
    }
    if (!map.getLayer(HEAT)) {
      map.addLayer({
        id: HEAT,
        type: "heatmap",
        source: SRC,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 1, 12, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 14, 10, 40],
          "heatmap-opacity": 0.7,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(245, 158, 11, 0.4)",
            0.5, "rgba(239, 68, 68, 0.7)",
            1, "rgba(127, 29, 29, 1)",
          ],
        },
      });
    }
  },

  unmount(map) {
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
    return []; // visualization-only
  },
};
