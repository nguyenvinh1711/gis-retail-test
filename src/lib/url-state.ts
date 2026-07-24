"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type LayerVisState = { visible: boolean; opacity: number };

export type UrlState = {
  center?: [number, number];
  zoom?: number;
  visibility?: Record<string, LayerVisState>;
  filters?: Record<string, Record<string, string | undefined>>;
  options?: Record<string, Record<string, unknown>>;
  sidebar?: { collapsed?: boolean; x?: number; y?: number };
  selection?: { layerId: string; featureId: string | number } | null;
};

const DEBOUNCE_MS = 200;

function readHash(): UrlState {
  if (typeof window === "undefined") return {};
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};
  try {
    const obj = JSON.parse(decodeURIComponent(atob(hash)));
    return obj as UrlState;
  } catch {
    return {};
  }
}

function writeHash(state: UrlState) {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(state);
  const encoded = btoa(encodeURIComponent(json));
  const newUrl = `${window.location.pathname}${window.location.search}#${encoded}`;
  window.history.replaceState(null, "", newUrl);
}

export function useUrlState(): [UrlState, (next: Partial<UrlState>) => void] {
  const [state, setState] = useState<UrlState>(() => readHash());
  const stateRef = useRef(state);
  stateRef.current = state;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((next: Partial<UrlState>) => {
    const merged: UrlState = { ...stateRef.current, ...next };
    setState(merged);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => writeHash(merged), DEBOUNCE_MS);
  }, []);

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  return [state, update];
}
