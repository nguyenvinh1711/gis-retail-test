import type { ReactNode } from "react";
import type { Map as MLMap, MapGeoJSONFeature } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";

export type LayerVisibility = "public" | "premium";

export type Selection = {
  layerId: string;
  feature: Feature;
} | null;

export type HoverInfo = {
  layerId: string;
  feature: MapGeoJSONFeature;
  lng: number;
  lat: number;
} | null;

export type FilterOption = { value: string; label: string };

export type FilterField =
  | { id: string; label: string; kind: "enum"; options: FilterOption[] }
  | { id: string; label: string; kind: "text" };

export type FilterState = Record<string, string | undefined>;

/**
 * Plugin contract every layer implements. Adding a new layer = adding one file
 * that implements LayerModule and registering it in src/layers/index.ts.
 */
export interface LayerContext {
  map: MLMap;
  setSelection(sel: Selection): void;
  /** Get the currently rendered features for another layer module (for cross-layer stats). */
  getOtherFeatures(layerId: string): Feature[];
  /** Same as getOtherFeatures, but respects the target layer's active filters. */
  getOtherFilteredFeatures(layerId: string): Feature[];
  /** Select a feature by its numeric/string id within a layer (drives drill-down from panels). */
  selectFeatureById(layerId: string, featureId: string | number): void;
}

export type LayerOption =
  | { id: string; label: string; kind: "boolean"; default: boolean }
  | { id: string; label: string; kind: "select"; options: FilterOption[]; default: string };

export type LayerOptionValues = Record<string, unknown>;

export interface LayerModule {
  /** Stable, unique id (also used in URL state and entitlement table). */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly visibility: LayerVisibility;

  /** Add MapLibre sources and layers. Idempotent: called after every style change. */
  mount(ctx: LayerContext): void;
  /** Remove everything mount() added. Safe to call on a style that's already been wiped. */
  unmount(map: MLMap): void;

  setVisible(map: MLMap, visible: boolean): void;
  setOpacity(map: MLMap, opacity: number): void;

  /** MapLibre layer ids that should receive click/hover events. */
  interactiveLayerIds(): string[];

  /** Hover tooltip body. Return null/undefined to suppress. */
  getHoverTooltip?(feature: MapGeoJSONFeature): ReactNode;

  /** Right-side panel body when this layer's feature is selected. */
  getDetailPanel?(feature: Feature, ctx: LayerContext): ReactNode;

  /** Side-effects after click (catchment rings, highlight outline). Selection/fly are handled by MapView. */
  onFeatureClick?(feature: Feature, ctx: LayerContext): void;
  /** Clean up the side-effects when selection changes or is cleared. */
  onSelectionCleared?(map: MLMap): void;

  /** Custom click handler that fully overrides MapView's default click flow. Return true to consume. */
  customClick?(feature: MapGeoJSONFeature, ctx: LayerContext): boolean;

  getFilterSchema?(): FilterField[];
  applyFilter?(map: MLMap, filter: FilterState): void;

  /** Features to include when the user clicks Export. Default: queryRenderedFeatures on interactive ids. */
  getExportableFeatures?(map: MLMap): Feature[];

  /** Expose this layer's loaded features so other modules can do cross-layer analysis (e.g., points-in-polygon). */
  getCurrentFeatures?(): Feature[];

  /** Same as getCurrentFeatures but post-filter (used by filter-aware "nearby" counts). Defaults to getCurrentFeatures. */
  getFilteredFeatures?(): Feature[];

  /** Declarative per-layer options rendered in the layer panel (toggles, dropdowns). */
  getOptions?(): LayerOption[];
  /** Apply a single option value. Called when the user changes it in the UI or on initial mount. */
  setOption?(map: MLMap, optionId: string, value: unknown): void;
}

export type LayerExport = {
  layerId: string;
  features: Feature[];
};

export function asFeatureCollection(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}
