import buffer from "@turf/buffer";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon, Point, Position } from "geojson";

export function ringAround(coord: Position, km: number): Feature<Polygon | MultiPolygon> {
  return buffer(point(coord), km, { units: "kilometers" }) as Feature<Polygon | MultiPolygon>;
}

export function featureBbox(feature: Feature): [number, number, number, number] {
  return bbox(feature) as [number, number, number, number];
}

export function pointsInsidePolygon(points: Feature<Point>[], poly: Feature<Polygon | MultiPolygon>): Feature<Point>[] {
  return points.filter((p) => booleanPointInPolygon(p, poly));
}

/**
 * Count point features within a km-radius circle around `center`, optionally
 * excluding one feature by id. Used by all "Within N km" detail-panel widgets.
 * Inline point-in-polygon (ray-casting) to avoid the per-call cost of turf's
 * generic walker on hot paths.
 */
export function countPointsInRingKm(
  points: Feature<Point>[],
  center: Position,
  km: number,
  excludeId?: number | string
): number {
  const ring = ringAround(center, km);
  let n = 0;
  for (const f of points) {
    if (excludeId !== undefined && f.id === excludeId) continue;
    if (pointInsideFeature(f.geometry.coordinates as [number, number], ring)) n++;
  }
  return n;
}

function pointInsideFeature(pt: [number, number], poly: Feature<Polygon | MultiPolygon>): boolean {
  const g = poly.geometry as { type: string; coordinates: number[][][] | number[][][][] };
  const polys = g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
  for (const rings of polys) {
    if (ringContains(rings[0], pt) && rings.slice(1).every((h) => !ringContains(h, pt))) return true;
  }
  return false;
}
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
