// Server-safe layer metadata. Mirrors the modules in src/layers/*.ts but contains
// no client-side imports (React, MapLibre, etc.) so it can be imported from
// server components, server actions, etc. Keep in sync with the module files.

export type LayerMetadata = {
  id: string;
  name: string;
  description: string;
  category: string;
  visibility: "public" | "premium";
};

export const LAYER_METADATA: LayerMetadata[] = [
  {
    id: "vn-provinces",
    name: "Vietnam Provinces",
    description: "Administrative boundaries (level 1).",
    category: "Reference",
    visibility: "public",
  },
  {
    id: "supermarkets",
    name: "Supermarkets",
    description: "377 retail locations across Vietnam.",
    category: "Retail",
    visibility: "public",
  },
  {
    id: "supermarket-density",
    name: "Supermarket Density",
    description: "Heatmap of retail density — useful for catchment analysis.",
    category: "Retail",
    visibility: "premium",
  },
  {
    id: "hospitals",
    name: "Hospitals & health facilities",
    description: "OSM-sourced hospitals, clinics, doctors, pharmacies in Vietnam.",
    category: "Healthcare",
    visibility: "public",
  },
  {
    id: "hospital-coverage-gaps",
    name: "Hospital coverage gaps",
    description: "Underserved-area heatmap (high retail demand, low hospital supply).",
    category: "Healthcare",
    visibility: "premium",
  },
];

export const PREMIUM_LAYER_IDS = new Set(LAYER_METADATA.filter((l) => l.visibility === "premium").map((l) => l.id));
