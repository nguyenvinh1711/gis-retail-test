export type BaseMapId = "maptiler" | "openfreemap";

export type BaseMap = {
  id: BaseMapId;
  name: string;
  styleUrl: string;
  available: boolean;
};

// Read at module load (NEXT_PUBLIC_* are inlined at build time).
const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";

export const BASE_MAPS: BaseMap[] = [
  {
    id: "maptiler",
    name: "MapTiler Streets",
    styleUrl: maptilerKey
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${maptilerKey}`
      : "",
    available: Boolean(maptilerKey),
  },
  {
    id: "openfreemap",
    name: "OpenFreeMap Liberty",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    available: true,
  },
];

export function getDefaultBaseMap(): BaseMap {
  return BASE_MAPS.find((b) => b.available) ?? BASE_MAPS[1];
}

export function getBaseMap(id: BaseMapId): BaseMap {
  return BASE_MAPS.find((b) => b.id === id && b.available) ?? getDefaultBaseMap();
}
