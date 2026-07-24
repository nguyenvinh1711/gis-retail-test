import { provincesLayer } from "./provinces";
import { supermarketsLayer } from "./supermarkets";
import { supermarketDensityLayer } from "./supermarket-density";
import { hospitalsLayer } from "./hospitals";
import { hospitalCoverageGapsLayer } from "./hospital-coverage-gaps";
import type { LayerModule } from "./types";

export { type LayerModule, type LayerContext, type Selection, type HoverInfo, type FilterState, type FilterField } from "./types";

// Order matters: lower-z layers first (so points sit on top of polygons).
export const LAYER_MODULES: LayerModule[] = [
  provincesLayer,
  supermarketsLayer,
  hospitalsLayer,
  supermarketDensityLayer,
  hospitalCoverageGapsLayer,
];

export function getModule(id: string): LayerModule | undefined {
  return LAYER_MODULES.find((m) => m.id === id);
}
