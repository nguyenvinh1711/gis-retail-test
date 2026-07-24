"use client";

import { useState } from "react";
import type { Feature } from "geojson";

type Props = {
  collectFeatures: () => { layerId: string; features: Feature[] }[];
};

export default function ExportButton({ collectFeatures }: Props) {
  const [open, setOpen] = useState(false);

  function download(name: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportGeoJSON() {
    const groups = collectFeatures();
    const all: Feature[] = groups.flatMap((g) =>
      g.features.map((f) => ({ ...f, properties: { ...(f.properties ?? {}), _layer: g.layerId } }))
    );
    download("gis-retail-export.geojson", JSON.stringify({ type: "FeatureCollection", features: all }), "application/geo+json");
    setOpen(false);
  }

  function exportCSV() {
    const groups = collectFeatures();
    const rows = groups.flatMap((g) =>
      g.features.map((f) => {
        const p = f.properties ?? {};
        const [lng, lat] = f.geometry.type === "Point" ? (f.geometry.coordinates as number[]) : [null, null];
        return { _layer: g.layerId, lng, lat, ...p };
      })
    );
    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const csv = [
      cols.join(","),
      ...rows.map((r) =>
        cols
          .map((c) => {
            const v = r[c as keyof typeof r];
            if (v == null) return "";
            const s = String(v).replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          })
          .join(",")
      ),
    ].join("\n");
    download("gis-retail-export.csv", csv, "text/csv");
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        Export ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button onClick={exportGeoJSON} className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            GeoJSON
          </button>
          <button onClick={exportCSV} className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            CSV
          </button>
        </div>
      )}
    </div>
  );
}
