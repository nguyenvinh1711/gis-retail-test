"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import maplibregl, { Map as MLMap, MapGeoJSONFeature, Popup, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot, type Root } from "react-dom/client";
import type { Feature } from "geojson";

import { BASE_MAPS, BaseMap, getBaseMap, getDefaultBaseMap } from "@/lib/basemap";
import { LAYER_MODULES } from "@/layers";
import type { LayerContext, FilterState, Selection } from "@/layers";
import { featureBbox } from "@/lib/turf-helpers";
import { useUrlState, type LayerVisState } from "@/lib/url-state";

import DetailPanel from "./DetailPanel";
import ExportButton from "./ExportButton";

type Props = {
  entitlements: string[];
};

export default function MapView({ entitlements }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<{ popup: Popup; root: Root; el: HTMLDivElement } | null>(null);

  const [urlState, setUrlState] = useUrlState();
  const [baseMap, setBaseMap] = useState<BaseMap>(() => getDefaultBaseMap());
  const [selection, setSelectionState] = useState<Selection>(null);
  const selectionRef = useRef<Selection>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [history, setHistory] = useState<Selection[]>([]);
  const [historyIndex, setHistoryIndexState] = useState(-1);
  const historyIndexRef = useRef(-1);
  const setHistoryIndex = (i: number) => {
    historyIndexRef.current = i;
    setHistoryIndexState(i);
  };

  const modules = useMemo(
    () => LAYER_MODULES.filter((m) => m.visibility === "public" || entitlements.includes(m.id)),
    [entitlements]
  );

  const [vis, setVis] = useState<Record<string, LayerVisState>>(() => {
    const init: Record<string, LayerVisState> = {};
    for (const m of LAYER_MODULES) {
      init[m.id] = urlState.visibility?.[m.id] ?? { visible: m.visibility === "public", opacity: 0.85 };
    }
    return init;
  });

  const [filters, setFilters] = useState<Record<string, FilterState>>(() => urlState.filters ?? {});
  const [options, setOptionsState] = useState<Record<string, Record<string, unknown>>>(() => {
    const init: Record<string, Record<string, unknown>> = {};
    for (const m of LAYER_MODULES) {
      const opts = m.getOptions?.() ?? [];
      if (opts.length === 0) continue;
      const layerInit: Record<string, unknown> = {};
      for (const o of opts) layerInit[o.id] = urlState.options?.[m.id]?.[o.id] ?? o.default;
      init[m.id] = layerInit;
    }
    return init;
  });
  const [filterSchemaTick, setFilterSchemaTick] = useState(0);
  const [, startTransition] = useTransition();
  const [mouseLngLat, setMouseLngLat] = useState<[number, number] | null>(null);
  const mouseLngLatRef = useRef<[number, number] | null>(null);
  const rafRef = useRef<number | null>(null);

  // Sidebar UX: collapsable + draggable, persisted to URL.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    (urlState.sidebar as { collapsed?: boolean } | undefined)?.collapsed ?? false
  );
  const [sidebarPos, setSidebarPos] = useState<{ x: number; y: number }>(() =>
    (urlState.sidebar as { x?: number; y?: number } | undefined) ? { x: urlState.sidebar?.x ?? 16, y: urlState.sidebar?.y ?? 16 } : { x: 16, y: 16 }
  );
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ offsetX: number; offsetY: number; x: number; y: number } | null>(null);

  function onSidebarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, input, select")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = { offsetX: e.clientX - sidebarPos.x, offsetY: e.clientY - sidebarPos.y, x: sidebarPos.x, y: sidebarPos.y };
  }
  function onSidebarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragStateRef.current;
    if (!s || !sidebarRef.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - s.offsetX));
    const y = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - s.offsetY));
    // Mutate style directly so React doesn't re-render the whole MapView on every pointermove.
    sidebarRef.current.style.left = `${x}px`;
    sidebarRef.current.style.top = `${y}px`;
    sidebarRef.current.style.maxHeight = `calc(100vh - ${y + 16}px)`;
    s.x = x;
    s.y = y;
  }
  function onSidebarPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragStateRef.current;
    if (s) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      dragStateRef.current = null;
      // Single commit at the end of the drag.
      setSidebarPos({ x: s.x, y: s.y });
      setUrlState({ sidebar: { collapsed: sidebarCollapsed, x: s.x, y: s.y } });
    }
  }

  // Imperative context handed to modules.
  const ctxRef = useRef<LayerContext | null>(null);

  function setSelection(sel: Selection, opts?: { skipHistory?: boolean }) {
    // Clear transient layers from the previous selection.
    if (selectionRef.current) {
      const prev = LAYER_MODULES.find((m) => m.id === selectionRef.current!.layerId);
      prev?.onSelectionCleared?.(mapRef.current!);
    }
    selectionRef.current = sel;
    setSelectionState(sel);
    if (!opts?.skipHistory && sel) {
      setHistory((h) => {
        const trimmed = h.slice(0, historyIndexRef.current + 1);
        const head = trimmed[trimmed.length - 1];
        if (head && head.layerId === sel.layerId && head.feature.id === sel.feature.id) return h;
        const next = [...trimmed, sel];
        setHistoryIndex(next.length - 1);
        return next;
      });
    }
    setUrlState({
      selection: sel ? { layerId: sel.layerId, featureId: (sel.feature.id as string | number) ?? "" } : null,
    });
  }

  function goHistory(delta: number) {
    const next = historyIndexRef.current + delta;
    if (next < 0 || next >= history.length) return;
    const sel = history[next];
    setHistoryIndex(next);
    // Replay without re-pushing.
    if (selectionRef.current) {
      const prev = LAYER_MODULES.find((m) => m.id === selectionRef.current!.layerId);
      prev?.onSelectionCleared?.(mapRef.current!);
    }
    selectionRef.current = sel;
    setSelectionState(sel);
    if (sel) {
      const mod = LAYER_MODULES.find((m) => m.id === sel.layerId);
      mod?.onFeatureClick?.(sel.feature, ctxRef.current!);
      if (sel.feature.geometry.type === "Point") {
        const [lng, lat] = sel.feature.geometry.coordinates as [number, number];
        mapRef.current?.flyTo({ center: [lng, lat], duration: 400 });
      }
    }
  }

  function buildCtx(map: MLMap): LayerContext {
    return {
      map,
      setSelection,
      getOtherFeatures: (layerId: string) => {
        const m = LAYER_MODULES.find((mm) => mm.id === layerId);
        return m?.getCurrentFeatures?.() ?? [];
      },
      getOtherFilteredFeatures: (layerId: string) => {
        const m = LAYER_MODULES.find((mm) => mm.id === layerId);
        return m?.getFilteredFeatures?.() ?? m?.getCurrentFeatures?.() ?? [];
      },
      selectFeatureById: (layerId, featureId) => {
        const m = LAYER_MODULES.find((mm) => mm.id === layerId);
        const feats = m?.getCurrentFeatures?.() ?? [];
        const f = feats.find((ff) => ff.id === featureId);
        if (!f || !m) return;
        // Clear any prior selection (clears its transients) before selecting.
        setSelection({ layerId, feature: f });
        if (f.geometry.type === "Point") {
          const [lng, lat] = f.geometry.coordinates as [number, number];
          map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom() + 1, 12), duration: 500 });
        }
        m.onFeatureClick?.(f, ctxRef.current!);
      },
    };
  }

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseMap.styleUrl as string | StyleSpecification,
      center: urlState.center ?? [106.0, 16.0],
      zoom: urlState.zoom ?? 4.8,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    map.addControl(new maplibregl.ScaleControl({}), "bottom-left");
    mapRef.current = map;
    ctxRef.current = buildCtx(map);
    requestAnimationFrame(() => map.resize());

    map.on("load", () => mountAllModules(map));
    map.on("moveend", () => {
      const c = map.getCenter();
      setUrlState({ center: [Number(c.lng.toFixed(5)), Number(c.lat.toFixed(5))], zoom: Number(map.getZoom().toFixed(2)) });
    });

    map.on("click", handleClick);
    map.on("mousemove", handleMove);
    map.on("mouseleave", clearHoverPopup);

    return () => {
      clearHoverPopup();
      map.remove();
      mapRef.current = null;
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-mount modules whenever style changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(baseMap.styleUrl as string | StyleSpecification);
    const onLoad = () => mountAllModules(map);
    map.once("style.load", onLoad);
    return () => {
      map.off("style.load", onLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMap.id]);

  // Apply visibility/opacity whenever vis state changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const m of modules) {
      m.setVisible(map, vis[m.id]?.visible ?? false);
      m.setOpacity(map, vis[m.id]?.opacity ?? 1);
    }
    setUrlState({ visibility: vis });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vis, modules]);

  // Apply filters when state changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of modules) {
      m.applyFilter?.(map, filters[m.id] ?? {});
    }
    setUrlState({ filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, modules]);

  // Apply per-layer options when state changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const m of modules) {
      const layerOpts = options[m.id];
      if (!layerOpts || !m.setOption) continue;
      for (const [id, value] of Object.entries(layerOpts)) {
        m.setOption(map, id, value);
      }
    }
    setUrlState({ options });
    // After cluster toggle, filters/visibility need re-applying because layers were recreated.
    for (const m of modules) {
      m.setVisible(map, vis[m.id]?.visible ?? false);
      m.setOpacity(map, vis[m.id]?.opacity ?? 1);
      m.applyFilter?.(map, filters[m.id] ?? {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, modules]);

  function mountAllModules(map: MLMap) {
    const ctx = buildCtx(map);
    ctxRef.current = ctx;
    for (const m of modules) {
      try {
        m.mount(ctx);
      } catch (e) {
        console.error(`Failed to mount layer ${m.id}`, e);
      }
      // Apply options first because they may recreate sources/layers.
      const layerOpts = options[m.id];
      if (layerOpts && m.setOption) {
        for (const [id, value] of Object.entries(layerOpts)) m.setOption(map, id, value);
      }
      m.setVisible(map, vis[m.id]?.visible ?? false);
      m.setOpacity(map, vis[m.id]?.opacity ?? 1);
      m.applyFilter?.(map, filters[m.id] ?? {});
    }
    // Schema may now have populated options (e.g., supermarkets needs raw data loaded).
    // Re-render after a delay to refresh the FilterBar options.
    setTimeout(() => setFilterSchemaTick((t) => t + 1), 800);
  }

  function interactiveIds(): string[] {
    return modules.flatMap((m) => m.interactiveLayerIds());
  }

  function topFeatureAt(point: maplibregl.PointLike): { feature: MapGeoJSONFeature; module: typeof LAYER_MODULES[number] } | null {
    const map = mapRef.current!;
    const ids = interactiveIds().filter((id) => map.getLayer(id));
    if (ids.length === 0) return null;
    const features = map.queryRenderedFeatures(point, { layers: ids });
    if (features.length === 0) return null;
    const f = features[0];
    const m = modules.find((mod) => mod.interactiveLayerIds().includes(f.layer.id));
    if (!m) return null;
    return { feature: f, module: m };
  }

  function handleClick(e: maplibregl.MapMouseEvent) {
    const hit = topFeatureAt(e.point);
    if (!hit) {
      setSelection(null);
      return;
    }
    const ctx = ctxRef.current!;
    // Custom click wins.
    if (hit.module.customClick?.(hit.feature, ctx)) return;

    // queryRenderedFeatures returns tile-clipped geometry; prefer the full
    // feature when the module exposes it (otherwise polygons render as slivers).
    const all = hit.module.getCurrentFeatures?.() ?? [];
    const full = hit.feature.id != null ? all.find((f) => f.id === hit.feature.id) : undefined;
    const feat: Feature = full ?? {
      type: "Feature",
      geometry: hit.feature.geometry,
      properties: hit.feature.properties ?? {},
      id: hit.feature.id,
    };

    setSelection({ layerId: hit.module.id, feature: feat });

    // Camera move.
    if (feat.geometry.type === "Point") {
      const [lng, lat] = feat.geometry.coordinates as [number, number];
      ctx.map.flyTo({ center: [lng, lat], zoom: Math.max(ctx.map.getZoom() + 2, 11) });
    } else if (feat.geometry.type === "Polygon" || feat.geometry.type === "MultiPolygon") {
      const [w, s, ee, n] = featureBbox(feat);
      ctx.map.fitBounds([[w, s], [ee, n]], { padding: 80, duration: 600 });
    }

    hit.module.onFeatureClick?.(feat, ctx);
  }

  function handleMove(e: maplibregl.MapMouseEvent) {
    const map = mapRef.current!;
    // Track mouse coords (rAF-batched).
    mouseLngLatRef.current = [e.lngLat.lng, e.lngLat.lat];
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setMouseLngLat(mouseLngLatRef.current);
      });
    }
    const hit = topFeatureAt(e.point);
    if (!hit || !hit.module.getHoverTooltip) {
      clearHoverPopup();
      map.getCanvas().style.cursor = "";
      return;
    }
    map.getCanvas().style.cursor = "pointer";
    const node = hit.module.getHoverTooltip(hit.feature);
    if (!node) {
      clearHoverPopup();
      return;
    }
    let entry = popupRef.current;
    if (!entry) {
      const el = document.createElement("div");
      el.className = "min-w-[160px] text-xs text-zinc-900 dark:text-zinc-50";
      const root = createRoot(el);
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: "gis-hover",
      });
      entry = { popup, root, el };
      popupRef.current = entry;
    }
    entry.root.render(node);
    entry.popup.setLngLat(e.lngLat).setDOMContent(entry.el).addTo(map);
  }

  function clearHoverPopup() {
    if (popupRef.current) {
      popupRef.current.popup.remove();
    }
    mouseLngLatRef.current = null;
    setMouseLngLat(null);
  }

  function toggleLayer(id: string, visible: boolean) {
    setVis((v) => ({ ...v, [id]: { ...v[id], visible } }));
  }
  function setOpacity(id: string, opacity: number) {
    setVis((v) => ({ ...v, [id]: { ...v[id], opacity } }));
  }

  // filterSchemaTick is referenced inline in the per-card filter render to force re-evaluation when data loads.
  void filterSchemaTick;

  const selectedModule = selection ? LAYER_MODULES.find((m) => m.id === selection.layerId) : null;

  return (
    <div className="relative flex-1">
      <div ref={containerRef} className="absolute! inset-0" />

      {/* Draggable, collapsable sidebar */}
      <div
        ref={sidebarRef}
        className={`absolute z-10 flex flex-col rounded-lg bg-white/95 shadow-lg backdrop-blur dark:bg-zinc-900/95 ${
          sidebarCollapsed ? "w-12" : "w-80"
        } overflow-hidden`}
        style={{ left: sidebarPos.x, top: sidebarPos.y, maxHeight: `calc(100vh - ${sidebarPos.y + 16}px)` }}
      >
        <div
          className="flex cursor-grab items-center justify-between gap-1 border-b border-zinc-200 px-3 py-2 select-none active:cursor-grabbing dark:border-zinc-800"
          onPointerDown={onSidebarPointerDown}
          onPointerMove={onSidebarPointerMove}
          onPointerUp={onSidebarPointerUp}
          onPointerCancel={onSidebarPointerUp}
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{sidebarCollapsed ? "≡" : "Layers"}</span>
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            onClick={() => {
              const next = !sidebarCollapsed;
              setSidebarCollapsed(next);
              setUrlState({ sidebar: { collapsed: next, x: sidebarPos.x, y: sidebarPos.y } });
            }}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? "▸" : "▾"}
          </button>
        </div>
        {!sidebarCollapsed && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
        <ul className="space-y-3">
          {LAYER_MODULES.map((m) => {
            const accessible = m.visibility === "public" || entitlements.includes(m.id);
            const state = vis[m.id];
            return (
              <li
                key={m.id}
                className={`rounded border p-2 ${
                  accessible
                    ? "border-zinc-200 dark:border-zinc-700"
                    : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                }`}
              >
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!accessible}
                    checked={accessible && state.visible}
                    onChange={(e) => toggleLayer(m.id, e.target.checked)}
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-50">
                      {m.name}
                      {m.visibility === "premium" && (
                        <span className="rounded bg-amber-200 px-1.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                          {accessible ? "Owned" : "Premium"}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{m.description}</span>
                  </span>
                </label>
                {accessible && (
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    <span className="text-xs text-zinc-500">Opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={state.opacity}
                      onChange={(e) => setOpacity(m.id, Number(e.target.value))}
                      className="flex-1"
                    />
                  </div>
                )}
                {accessible && (m.getOptions?.() ?? []).length > 0 && (
                  <div className="mt-2 space-y-1 pl-6">
                    {(m.getOptions?.() ?? []).map((opt) => {
                      const v = options[m.id]?.[opt.id] ?? opt.default;
                      if (opt.kind === "boolean") {
                        return (
                          <label key={opt.id} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                            <input
                              type="checkbox"
                              checked={Boolean(v)}
                              onChange={(e) =>
                                setOptionsState((o) => ({ ...o, [m.id]: { ...(o[m.id] ?? {}), [opt.id]: e.target.checked } }))
                              }
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      }
                      return (
                        <label key={opt.id} className="block text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="mr-1">{opt.label}</span>
                          <select
                            className="rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                            value={String(v ?? "")}
                            onChange={(e) =>
                              setOptionsState((o) => ({ ...o, [m.id]: { ...(o[m.id] ?? {}), [opt.id]: e.target.value } }))
                            }
                          >
                            {opt.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}
                {accessible && (m.getFilterSchema?.() ?? []).length > 0 && (
                  <div className="mt-2 space-y-1 pl-6">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Filters</div>
                    {(m.getFilterSchema?.() ?? []).map((f) => {
                      const value = filters[m.id]?.[f.id] ?? "";
                      const onWrite = (next: string) =>
                        startTransition(() =>
                          setFilters((curr) => {
                            const layer = { ...(curr[m.id] ?? {}) };
                            if (next) layer[f.id] = next;
                            else delete layer[f.id];
                            return { ...curr, [m.id]: layer };
                          })
                        );
                      if (f.kind === "enum") {
                        return (
                          <label key={f.id} className="block text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="mr-1">{f.label}</span>
                            <select
                              className="w-full rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                              value={value}
                              onChange={(e) => onWrite(e.target.value)}
                            >
                              <option value="">All</option>
                              {f.options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                      return (
                        <label key={f.id} className="block text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="mr-1">{f.label}</span>
                          <input
                            type="text"
                            className="w-full rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                            value={value}
                            onChange={(e) => onWrite(e.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
                {!accessible && (
                  <a
                    href="/dashboard"
                    className="mt-2 inline-block rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-600"
                  >
                    Buy to unlock →
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Base map</h3>
          <select
            className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            value={baseMap.id}
            onChange={(e) => setBaseMap(getBaseMap(e.target.value as BaseMap["id"]))}
          >
            {BASE_MAPS.map((b) => (
              <option key={b.id} value={b.id} disabled={!b.available}>
                {b.name}
                {!b.available ? " (set NEXT_PUBLIC_MAPTILER_KEY)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Export</h3>
          <ExportButton
            collectFeatures={() =>
              modules
                .filter((m) => vis[m.id]?.visible)
                .map((m) => ({
                  layerId: m.id,
                  features: m.getExportableFeatures?.(mapRef.current!) ?? [],
                }))
                .filter((g) => g.features.length > 0)
            }
          />
        </div>
        </div>
        )}
      </div>

      {/* Mouse coordinates pill */}
      {mouseLngLat && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded bg-white/85 px-2 py-1 font-mono text-[11px] text-zinc-700 shadow-sm backdrop-blur sm:block dark:bg-zinc-900/85 dark:text-zinc-300">
          {mouseLngLat[0].toFixed(5)}, {mouseLngLat[1].toFixed(5)}
        </div>
      )}

      <DetailPanel
        open={Boolean(selection)}
        collapsed={panelCollapsed}
        canBack={historyIndex > 0}
        canForward={historyIndex >= 0 && historyIndex < history.length - 1}
        onClose={() => setSelection(null, { skipHistory: true })}
        onToggleCollapse={() => setPanelCollapsed((c) => !c)}
        onBack={() => goHistory(-1)}
        onForward={() => goHistory(1)}
        title={selection ? (selectedModule?.name ?? "Feature") : undefined}
      >
        {selection && selectedModule?.getDetailPanel
          ? selectedModule.getDetailPanel(selection.feature, ctxRef.current!)
          : null}
      </DetailPanel>
    </div>
  );
}
